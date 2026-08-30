// ── SPONSORED PLACEMENT AS A REAL RECORD ───────────────────────────────────
//
// BuildHub already sold a sponsored slot one way: a Premium plan buys rotating
// placement, derived from live billing state. The owner approved a SECOND
// route - an administrator grants a named vendor a slot in a named category,
// for a period, with a reason.
//
// The alternative was a hard-coded list of "sponsored" firms in the UI, which
// would invent commercial relationships that do not exist. That is the failure
// these tests exist to make impossible: every slot traces to a row somebody
// created, and an expired or revoked one provably disappears.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import {
  grantSponsorship, listSponsorships, revokeSponsorship, sponsoredVendorIds,
} from './vendorSponsorship';
import { users, vendorSponsorships } from '../drizzle/schema';

const VENDOR = 80;
const ADMIN = 90;
const NOW = new Date('2026-06-15T12:00:00Z');

const APPROVED_VENDOR = {
  id: VENDOR, userRole: 'supplier', onboardingStatus: 'approved', accountStatus: 'active',
};

function makeDb(options: {
  vendor?: Record<string, unknown> | null;
  sponsorships?: Record<string, unknown>[];
  /** Rows the liveness-filtered lookup should find. Kept separate because the
   *  double cannot interpret a WHERE clause - see the note at the bottom. */
  liveLookup?: Record<string, unknown>[];
} = {}) {
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];

  const chain = (rows: unknown[]): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      where: () => c, orderBy: () => c, limit: () => c, for: () => c,
      leftJoin: () => c, innerJoin: () => c, groupBy: () => c, offset: () => c,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(res, rej),
    };
    return c;
  };

  const db: Record<string, unknown> = {
    select: () => ({
      from: (table: unknown) => {
        if (table === users) {
          const v = options.vendor === undefined ? APPROVED_VENDOR : options.vendor;
          return chain(v ? [v] : []);
        }
        if (table === vendorSponsorships) {
          return chain(options.liveLookup ?? options.sponsorships ?? []);
        }
        return chain([]);
      },
    }),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => { inserts.push({ table, values }); return [{ insertId: 700 }]; },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { updates.push({ table, values }); },
      }),
    }),
  };

  return {
    db, inserts, updates,
    into: (t: unknown) => inserts.filter(r => r.table === t).map(r => r.values),
    patched: (t: unknown) => updates.filter(r => r.table === t).map(r => r.values),
  };
}

// ── 1. Granting ────────────────────────────────────────────────────────────

describe('grantSponsorship - a real arrangement, or a refusal that says why', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records the grant with the category, the granter and the reason', async () => {
    const rec = makeDb({ liveLookup: [] });
    const result = await grantSponsorship({
      db: rec.db, vendorId: VENDOR, category: 'Materials',
      grantedBy: ADMIN, reason: 'Launch partner agreement', now: NOW,
    });
    expect(result).toEqual({ outcome: 'granted', sponsorshipId: 700 });
    expect(rec.into(vendorSponsorships)[0]).toMatchObject({
      vendorId: VENDOR, category: 'Materials', grantedBy: ADMIN,
      grantedReason: 'Launch partner agreement',
    });
  });

  it('RECORDS NO PRICE, NO INVOICE AND NO PAYMENT - BuildHub has no payment provider', async () => {
    const rec = makeDb({ liveLookup: [] });
    await grantSponsorship({
      db: rec.db, vendorId: VENDOR, category: 'Materials', grantedBy: ADMIN, reason: 'x', now: NOW,
    });
    const written = Object.keys(rec.into(vendorSponsorships)[0]).join(' ').toLowerCase();
    for (const invented of ['price', 'amount', 'invoice', 'paid', 'currency']) {
      expect(written).not.toContain(invented);
    }
  });

  it('refuses a vendor who is not APPROVED - a grant they could never use is worse than none', async () => {
    const rec = makeDb({ vendor: { ...APPROVED_VENDOR, onboardingStatus: 'under_review' }, liveLookup: [] });
    const result = await grantSponsorship({
      db: rec.db, vendorId: VENDOR, category: 'Materials', grantedBy: ADMIN, reason: 'x', now: NOW,
    });
    expect(result).toMatchObject({ outcome: 'rejected' });
    expect(rec.into(vendorSponsorships)).toEqual([]);
  });

  it('refuses a DEACTIVATED account', async () => {
    const rec = makeDb({ vendor: { ...APPROVED_VENDOR, accountStatus: 'frozen' }, liveLookup: [] });
    await expect(grantSponsorship({
      db: rec.db, vendorId: VENDOR, category: 'Materials', grantedBy: ADMIN, reason: 'x', now: NOW,
    })).resolves.toMatchObject({ outcome: 'rejected' });
  });

  it('refuses a vendor that does not exist', async () => {
    const rec = makeDb({ vendor: null, liveLookup: [] });
    await expect(grantSponsorship({
      db: rec.db, vendorId: 999, category: 'Materials', grantedBy: ADMIN, reason: 'x', now: NOW,
    })).resolves.toMatchObject({ outcome: 'rejected', reason: 'Vendor not found.' });
  });

  it('refuses a window that ends before it starts - a row that is never live', async () => {
    const rec = makeDb({ liveLookup: [] });
    const result = await grantSponsorship({
      db: rec.db, vendorId: VENDOR, category: 'Materials', grantedBy: ADMIN, reason: 'x',
      startsAt: new Date('2026-07-01'), endsAt: new Date('2026-06-01'), now: NOW,
    });
    expect(result).toMatchObject({ outcome: 'rejected' });
    expect(rec.into(vendorSponsorships)).toEqual([]);
  });

  it('refuses a SECOND live grant in the same category - one arrangement, not two slots', async () => {
    const rec = makeDb({ liveLookup: [{ id: 1 }] });
    const result = await grantSponsorship({
      db: rec.db, vendorId: VENDOR, category: 'Materials', grantedBy: ADMIN, reason: 'x', now: NOW,
    });
    expect(result).toMatchObject({ outcome: 'rejected' });
    expect(rec.into(vendorSponsorships)).toEqual([]);
  });
});

// ── 2. Revoking, softly ────────────────────────────────────────────────────

describe('revokeSponsorship - the row survives so the audit can', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stamps revokedAt and who did it, rather than deleting the row', async () => {
    const rec = makeDb({ sponsorships: [{ id: 5, revokedAt: null }] });
    await expect(revokeSponsorship(rec.db, 5, ADMIN, NOW)).resolves.toBe(true);
    expect(rec.patched(vendorSponsorships)[0]).toMatchObject({ revokedAt: NOW, revokedBy: ADMIN });
  });

  it('a second revocation does NOT re-stamp the moment the decision was taken', async () => {
    const rec = makeDb({ sponsorships: [{ id: 5, revokedAt: new Date('2026-01-01') }] });
    await expect(revokeSponsorship(rec.db, 5, ADMIN, NOW)).resolves.toBe(false);
    expect(rec.patched(vendorSponsorships)).toEqual([]);
  });

  it('revoking something that does not exist writes nothing', async () => {
    const rec = makeDb({ sponsorships: [] });
    await expect(revokeSponsorship(rec.db, 404, ADMIN, NOW)).resolves.toBe(false);
    expect(rec.patched(vendorSponsorships)).toEqual([]);
  });
});

// ── 3. Liveness, computed rather than swept ────────────────────────────────

describe('listSponsorships - answers the whole question, including what ended', () => {
  beforeEach(() => vi.clearAllMocks());

  const row = (over: Record<string, unknown>) => ({
    id: 1, vendorId: VENDOR, vendorName: 'Nile Steel', category: 'Materials',
    startsAt: new Date('2026-01-01'), endsAt: null, grantedBy: ADMIN,
    grantedReason: 'Launch partner', revokedAt: null, revokedBy: null,
    createdAt: new Date('2026-01-01'), ...over,
  });

  it('an open-ended, started, unrevoked grant is LIVE', async () => {
    const { db } = makeDb({ sponsorships: [row({})] });
    expect((await listSponsorships(db, NOW))[0].live).toBe(true);
  });

  it('a grant whose endsAt has PASSED is not live - no sweep required', async () => {
    // Time-derived, exactly like every billing entitlement: it stops appearing
    // the moment it elapses, whether or not anything ran overnight.
    const { db } = makeDb({ sponsorships: [row({ endsAt: new Date('2026-06-01') })] });
    expect((await listSponsorships(db, NOW))[0].live).toBe(false);
  });

  it('a FUTURE-DATED grant is not live yet', async () => {
    const { db } = makeDb({ sponsorships: [row({ startsAt: new Date('2026-12-01') })] });
    expect((await listSponsorships(db, NOW))[0].live).toBe(false);
  });

  it('a REVOKED grant is not live, but is still listed - that is what auditable means', async () => {
    const { db } = makeDb({ sponsorships: [row({ revokedAt: new Date('2026-05-01'), revokedBy: ADMIN })] });
    const rows = await listSponsorships(db, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].live).toBe(false);
    expect(rows[0].revokedBy).toBe(ADMIN);
  });

  it('the listing carries no credential', async () => {
    const { db } = makeDb({ sponsorships: [row({})] });
    const serialised = JSON.stringify(await listSponsorships(db, NOW)).toLowerCase();
    for (const forbidden of ['password', 'token', 'secret', 'hash']) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

// ── 4. What the directory asks for ─────────────────────────────────────────

describe('sponsoredVendorIds', () => {
  beforeEach(() => vi.clearAllMocks());

  it('de-duplicates - two overlapping grants are untidiness, not two slots', async () => {
    const { db } = makeDb({ liveLookup: [{ vendorId: VENDOR }, { vendorId: VENDOR }, { vendorId: 81 }] });
    await expect(sponsoredVendorIds(db, 'Materials', NOW)).resolves.toEqual([VENDOR, 81]);
  });

  it('returns IDS, never vendor rows - the directory applies its own visibility filter', async () => {
    const { db } = makeDb({ liveLookup: [{ vendorId: VENDOR }] });
    const result = await sponsoredVendorIds(db, 'Materials', NOW);
    // A sponsorship must never smuggle a suspended vendor into the directory.
    // Returning ids forces the caller to resolve them through its own filter.
    expect(result).toEqual([VENDOR]);
    expect(typeof result[0]).toBe('number');
  });
});

/**
 * ── ONE RULE DELIBERATELY NOT TESTED HERE ──────────────────────────────────
 *
 * `liveSponsorshipFilter` is a WHERE clause, and the double above answers by
 * table without interpreting conditions - so a test of "an expired grant is
 * excluded from sponsoredVendorIds" would pass with the filter deleted.
 *
 * The liveness LOGIC is tested above against listSponsorships, which computes
 * it in JavaScript and therefore can be. The FILTER is proven against MariaDB
 * in evidence/zg-sponsorship.mjs, where a grant is expired and then confirmed
 * absent from the directory strip.
 */
