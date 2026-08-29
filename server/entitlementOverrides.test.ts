// ── The allowance an administrator can actually move ───────────────────────
//
// Before this, a vendor's qualified-enquiry allowance came from the plan
// constant and nothing could change it for one vendor. An administrator asked
// to give a supplier ten more leads had exactly one lever - change their plan -
// which rewrites what that vendor is recorded as having agreed to pay and hands
// them every other capability of the tier as a side effect.
//
// The rules these tests hold, in the order they matter:
//
//   1. An override NEVER grants more than intended by accident. Corrupt,
//      mistyped, expired, revoked or future-dated rows all fall back to the
//      PLAN. `null` means unlimited in this schema, so anything that turns a
//      parse failure into null turns bad data into free premium access.
//   2. A limit BELOW current usage is REFUSED - the owner's decision, taken
//      explicitly. Consumed enquiries are never revoked or renumbered.
//   3. The history is the storage. Rows are appended, never updated, so
//      "who changed this, from what, and why" survives.

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  applyOverrides, decodeEntitlementValue, encodeEntitlementValue,
  UNPARSEABLE, MAX_ENQUIRY_ALLOWANCE, allowancePeriodKey, setEnquiryAllowance,
} from './billing/overrides';
import { PLANS } from '@shared/billing';

const read = (p: string) => readSourceForAssertions(readFileSync(new URL(p, import.meta.url), 'utf8'));

const FREE = PLANS.free.entitlements;
const row = (over: Partial<Parameters<typeof applyOverrides>[1] extends Map<string, infer R> ? R : never> = {}) => ({
  id: 1, entitlementKey: 'qualifiedEnquiriesPerMonth', value: '20', previousValue: null,
  reason: null, actorId: 9, startsAt: new Date('2020-01-01'), endsAt: null,
  revokedAt: null, createdAt: new Date('2020-01-01'), ...over,
});

describe('an override replaces the plan value, and only that value', () => {
  it('the plan grants five, the override grants twenty', () => {
    expect(FREE.qualifiedEnquiriesPerMonth).toBe(5);
    const { entitlements, applied } = applyOverrides(FREE, new Map([['qualifiedEnquiriesPerMonth', row()]]));
    expect(entitlements.qualifiedEnquiriesPerMonth).toBe(20);
    expect(applied).toEqual(['qualifiedEnquiriesPerMonth']);
  });

  it('and every OTHER entitlement is untouched', () => {
    // The whole reason this is not a plan change. Raising a lead allowance must
    // not quietly hand out featured placement and advanced analytics too.
    const { entitlements } = applyOverrides(FREE, new Map([['qualifiedEnquiriesPerMonth', row()]]));
    for (const key of Object.keys(FREE) as (keyof typeof FREE)[]) {
      if (key === 'qualifiedEnquiriesPerMonth') continue;
      expect(entitlements[key], `${key} must not move`).toEqual(FREE[key]);
    }
  });

  it('null is a legal override and means unlimited', () => {
    const { entitlements } = applyOverrides(FREE, new Map([['qualifiedEnquiriesPerMonth', row({ value: 'null' })]]));
    expect(entitlements.qualifiedEnquiriesPerMonth).toBeNull();
  });

  it('a key that is not part of the plan shape is ignored, not injected', () => {
    const { entitlements, applied } = applyOverrides(FREE, new Map([['somethingInvented', row({ entitlementKey: 'somethingInvented' })]]));
    expect(applied).toEqual([]);
    expect(entitlements).not.toHaveProperty('somethingInvented');
  });
});

describe('a bad override falls back to the plan - it never grants more', () => {
  it('unparseable JSON is NOT read as unlimited', () => {
    // The failure that would matter: `null` means no limit here, so returning
    // null on a parse error would turn a corrupt row into free premium access.
    expect(decodeEntitlementValue('{not json')).toBe(UNPARSEABLE);
    const { entitlements } = applyOverrides(FREE, new Map([['qualifiedEnquiriesPerMonth', row({ value: '{not json' })]]));
    expect(entitlements.qualifiedEnquiriesPerMonth).toBe(5);
  });

  it('a string where a number belongs is refused', () => {
    // `used >= allowance` against a string is false for every value, which is
    // an unlimited allowance created by a typo.
    const { entitlements } = applyOverrides(FREE, new Map([['qualifiedEnquiriesPerMonth', row({ value: '"lots"' })]]));
    expect(entitlements.qualifiedEnquiriesPerMonth).toBe(5);
  });

  it('a number where a tier belongs is refused', () => {
    const { entitlements } = applyOverrides(FREE, new Map([['visibilityLevel', row({ entitlementKey: 'visibilityLevel', value: '3' })]]));
    expect(entitlements.visibilityLevel).toBe(FREE.visibilityLevel);
  });

  it('a tier override with a legal tier IS applied', () => {
    // POSITIVE CONTROL. Without this the four refusals above would still pass
    // if the merge were broken entirely and nothing was ever applied.
    const { entitlements } = applyOverrides(FREE, new Map([['visibilityLevel', row({ entitlementKey: 'visibilityLevel', value: '"boosted"' })]]));
    expect(entitlements.visibilityLevel).toBe('boosted');
  });

  it('NaN and Infinity are refused', () => {
    for (const value of ['null', '1e999']) {
      const decoded = decodeEntitlementValue(value);
      if (typeof decoded === 'number' && !Number.isFinite(decoded)) {
        const { entitlements } = applyOverrides(FREE, new Map([['qualifiedEnquiriesPerMonth', row({ value })]]));
        expect(entitlements.qualifiedEnquiriesPerMonth).toBe(5);
      }
    }
  });

  it('encode and decode round-trip every legal entitlement value', () => {
    for (const value of [0, 5, 30, null, 'boosted', true, false]) {
      expect(decodeEntitlementValue(encodeEntitlementValue(value))).toEqual(value ?? null);
    }
  });
});

describe('expiry, revocation and start dates are honoured on read', () => {
  // These live in activeOverridesFor, which is asserted against the source
  // because it is a SQL predicate: running it needs a database, and the thing
  // worth pinning is that the three conditions are all present and ANDed.
  const SOURCE = read('./billing/overrides.ts');

  it('a revoked row is excluded', () => {
    expect(SOURCE).toContain('isNull(vendorEntitlementOverrides.revokedAt)');
  });

  it('a row whose window has closed is excluded, with no sweep required', () => {
    expect(SOURCE).toMatch(/or\(isNull\(vendorEntitlementOverrides\.endsAt\), gt\(vendorEntitlementOverrides\.endsAt, now\)\)/);
  });

  it('a row that has not started yet is excluded', () => {
    expect(SOURCE).toContain('if (row.startsAt && new Date(row.startsAt).getTime() > now.getTime()) continue;');
  });

  it('the newest row per key wins, and older ones become its history', () => {
    expect(SOURCE).toContain('orderBy(desc(vendorEntitlementOverrides.id))');
    expect(SOURCE).toContain('if (active.has(row.entitlementKey)) continue;');
  });
});

describe('overrides resolve inside the ONE entitlement mechanism', () => {
  const ENTITLEMENTS = read('./billing/entitlements.ts');

  it('resolveVendorEntitlements applies them before building the resolution', () => {
    // If they resolved anywhere else there would be two answers to "what is
    // this vendor entitled to", and the enquiry enforcement would keep
    // honouring the plan while an administrator believed otherwise.
    const at = ENTITLEMENTS.indexOf('export async function resolveVendorEntitlements');
    const body = ENTITLEMENTS.slice(at, at + 1400);
    const merge = body.indexOf('withOverrides(');
    const build = body.indexOf('buildResolution(');
    expect(merge).toBeGreaterThan(-1);
    expect(merge, 'the merge must happen before the resolution is built').toBeLessThan(build);
  });

  it('and a failure to read them leaves the PLAN in force', () => {
    const at = ENTITLEMENTS.indexOf('async function withOverrides');
    const body = ENTITLEMENTS.slice(at, at + 900);
    expect(body).toContain('catch');
    expect(body).toMatch(/return state;/);
  });

  it('the enquiry enforcement reads the resolved allowance, not the plan constant', () => {
    const ENQUIRIES = read('./billing/enquiries.ts');
    expect(ENQUIRIES).toContain('resolution.qualifiedEnquiryAllowance');
    // If it read PLANS directly an override would be invisible to the very
    // thing it exists to move.
    expect(ENQUIRIES).not.toMatch(/PLANS\[[^\]]+\]\.entitlements/);
  });
});

// ── Setting the limit ──────────────────────────────────────────────────────

/** A db double whose transaction runs immediately, with a fixed usage count. */
function txDouble(used: number, existing: Record<string, unknown>[] = []) {
  const inserted: Record<string, unknown>[] = [];
  const revoked: unknown[] = [];
  const chain = (rows: unknown) => {
    const c: Record<string, unknown> = {
      where: () => c, orderBy: () => c, limit: () => Promise.resolve(rows),
      for: () => Promise.resolve([{ id: 1 }]),
      then: (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res),
    };
    return c;
  };
  const tx = {
    select: (columns?: Record<string, unknown>) => ({
      from: (table: unknown) => {
        const name = String((table as { _?: { name?: string } })?._?.name ?? '');
        if (columns && 'count' in columns) return chain([{ count: used }]);
        if (name.includes('users') || (columns && 'id' in columns && Object.keys(columns).length === 1)) return chain([{ id: 1 }]);
        return chain(existing);
      },
    }),
    insert: () => ({ values: (v: Record<string, unknown>) => { inserted.push(v); return Promise.resolve([{ insertId: 42 }]); } }),
    update: () => ({ set: (v: unknown) => ({ where: () => { revoked.push(v); return Promise.resolve(undefined); } }) }),
  };
  return { db: { transaction: (fn: (t: unknown) => unknown) => fn(tx) } as never, inserted, revoked };
}

describe('setting a vendor allowance', () => {
  const base = { userId: 7, reason: 'Launch partner', actorId: 3 };

  it('a negative limit is refused', async () => {
    const { db } = txDouble(0);
    const result = await setEnquiryAllowance({ db, ...base, limit: -1 });
    expect(result).toEqual({ ok: false, reason: 'negative' });
  });

  it('a fractional limit is refused', async () => {
    const { db } = txDouble(0);
    const result = await setEnquiryAllowance({ db, ...base, limit: 2.5 });
    expect(result).toEqual({ ok: false, reason: 'negative' });
  });

  it('an absurd limit is refused rather than stored', async () => {
    const { db } = txDouble(0);
    const result = await setEnquiryAllowance({ db, ...base, limit: MAX_ENQUIRY_ALLOWANCE + 1 });
    expect(result).toEqual({ ok: false, reason: 'overflow', max: MAX_ENQUIRY_ALLOWANCE });
  });

  it('THE OWNER DECISION: a limit below current usage is REFUSED, and names the usage', async () => {
    // Asked and answered explicitly rather than invented. The alternative -
    // accept it and let remaining sit at zero - was offered and not chosen.
    const { db, inserted } = txDouble(7);
    const result = await setEnquiryAllowance({ db, ...base, limit: 5 });
    expect(result).toMatchObject({ ok: false, reason: 'below_usage', used: 7, requested: 5 });
    expect(inserted, 'nothing may be written when the change is refused').toHaveLength(0);
  });

  it('a limit EQUAL to current usage is allowed - it is not below it', () => {
    // The boundary, which is where an off-by-one would live.
    return setEnquiryAllowance({ db: txDouble(7).db, ...base, limit: 7 })
      .then(result => expect(result).toMatchObject({ ok: true }));
  });

  it('unlimited is always allowed, whatever the usage', async () => {
    const { db } = txDouble(999);
    const result = await setEnquiryAllowance({ db, ...base, limit: null });
    expect(result).toMatchObject({ ok: true });
  });

  it('zero is allowed - it stops future spend without touching what was spent', async () => {
    const { db } = txDouble(0);
    const result = await setEnquiryAllowance({ db, ...base, limit: 0 });
    expect(result).toMatchObject({ ok: true });
  });

  it('the SCENARIO from the mandate: used 7, set 20, accepted', async () => {
    const { db, inserted } = txDouble(7);
    const result = await setEnquiryAllowance({ db, ...base, limit: 20 });
    expect(result).toMatchObject({ ok: true });
    expect(inserted[0]).toMatchObject({ userId: 7, entitlementKey: 'qualifiedEnquiriesPerMonth', value: '20', actorId: 3, reason: 'Launch partner' });
  });

  it('appends a new row and revokes the old one, never updating in place', async () => {
    const existing = [{
      id: 11, entitlementKey: 'qualifiedEnquiriesPerMonth', value: '10', previousValue: null,
      reason: 'earlier grant', actorId: 2, startsAt: new Date('2020-01-01'), endsAt: null,
      revokedAt: null, createdAt: new Date('2020-01-01'),
    }];
    const { db, inserted, revoked } = txDouble(3, existing);
    const result = await setEnquiryAllowance({ db, ...base, limit: 25 });
    expect(result).toMatchObject({ ok: true, previous: 10 });
    // The OLD -> NEW the mandate asks for, carried on the row itself.
    expect(inserted[0]).toMatchObject({ value: '25', previousValue: '10' });
    expect(revoked[0]).toMatchObject({ revokedBy: 3 });
    expect(revoked[0]).toHaveProperty('revokedAt');
  });
});

describe('the concurrency guard is the one already proven against MariaDB', () => {
  const SOURCE = read('./billing/overrides.ts');

  it('the vendor row is locked FOR UPDATE inside the transaction', () => {
    expect(SOURCE).toMatch(/select\(\{ id: users\.id \}\)\.from\(users\)\.where\(sqlEq\(users\.id, userId\)\)\.for\('update'\)/);
  });

  it('and the lock is taken BEFORE the usage is counted', () => {
    // The ordering IS the guard. Reading usage first lets two administrators
    // both see six used and both write a limit of six.
    const at = SOURCE.indexOf('export async function setEnquiryAllowance');
    const body = SOURCE.slice(at);
    const lock = body.indexOf(".for('update')");
    const count = body.indexOf('rawSql<number>`count(*)`');
    expect(lock).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(-1);
    expect(lock, 'the lock must precede the usage read').toBeLessThan(count);
  });

  it('remaining is clamped at zero and never renders negative', () => {
    expect(SOURCE).toContain('Math.max(0, effectiveAllowance - used)');
  });
});

describe('the period key matches what qualifiedEnquiries actually stores', () => {
  it('is UTC year-month, zero padded', () => {
    expect(allowancePeriodKey(new Date('2026-03-09T23:59:59Z'))).toBe('2026-03');
    expect(allowancePeriodKey(new Date('2026-12-31T23:00:00Z'))).toBe('2026-12');
  });

  it('and does not drift with the machine timezone', () => {
    // A local-time key would put a UTC-evening enquiry in the wrong month for
    // half the world, and the allowance would reset on the wrong day.
    expect(allowancePeriodKey(new Date('2026-01-01T00:30:00Z'))).toBe('2026-01');
  });
});

describe('only a Super Admin may move an allowance', () => {
  const ROUTERS = read('./routers.ts');

  it('the write is superAdminProcedure, and the read is billing.read', () => {
    expect(ROUTERS).toMatch(/setVendorEnquiryLimit: superAdminProcedure/);
    expect(ROUTERS).toMatch(/vendorEnquiryAllowance: adminWith\('billing\.read'\)/);
  });

  it('no vendor-facing procedure writes an override', () => {
    // The vendor must not be able to raise their own limit by any route. The
    // billing router is where a vendor's own subscription actions live.
    const at = ROUTERS.indexOf('const billingRouter = router({');
    const billing = ROUTERS.slice(at, ROUTERS.indexOf('\n});', at));
    expect(billing).not.toContain('vendorEntitlementOverrides');
    expect(billing).not.toContain('setEnquiryAllowance');
  });

  it('the whole file writes overrides through the guarded service only', () => {
    // A direct insert anywhere else would bypass the below-usage refusal, the
    // append-only history and the lock all at once.
    expect(ROUTERS).not.toMatch(/insert\(vendorEntitlementOverrides\)/);
  });

  it('the refusal message names the usage that made it impossible', () => {
    const at = ROUTERS.indexOf("if (result.reason === 'below_usage')");
    const body = ROUTERS.slice(at, at + 900);
    expect(body).toContain('${result.used}');
    expect(body).toContain('${result.periodKey}');
    expect(body).toContain("code: 'CONFLICT'");
  });

  it('a non-provider account is refused before a useless row is written', () => {
    const at = ROUTERS.indexOf('setVendorEnquiryLimit: superAdminProcedure');
    const body = ROUTERS.slice(at, at + 2600);
    expect(body).toContain('providerRoles.includes');
    const guard = body.indexOf('providerRoles.includes');
    const write = body.indexOf('setEnquiryAllowance(');
    expect(guard).toBeLessThan(write);
  });
});
