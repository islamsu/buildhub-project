// ── Reversing a referral reward takes the reward back ──────────────────────
//
// `admin.reverseReferralReward` set `status: 'REVERSED'` on the ledger row and
// stopped. The entitlement stayed granted, the Spotlight kept running, the
// subscription kept its extra days. These tests are about the EFFECT, because
// the word was never the part that was broken.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseEffectRef, reverseRewardEffect, markRewardReversed, markReferralAfterReversal,
  REFERRAL_STATUS_AFTER_REVERSAL,
} from './referralReversal';
import {
  referralRewards, referrals, vendorEntitlementOverrides, vendorSponsorships,
} from '../drizzle/schema';

const NOW = new Date('2026-06-01T12:00:00Z');
const ACTOR = 9;
const RECIPIENT = 42;

/**
 * A database stand-in keyed by TABLE, which is all this module distinguishes:
 * it reads one row from one table and writes at most one update to it. Every
 * select and every update is recorded, so "did not touch it" is an assertion
 * this file can actually make rather than an absence it hopes for.
 */
function fakeDb(rows: Array<[unknown, unknown[]]>) {
  const table = new Map<unknown, unknown[]>(rows);
  const selects: unknown[] = [];
  const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];
  const db: any = {
    selects, updates,
    select: () => ({ from: (t: unknown) => ({ where: async () => { selects.push(t); return table.get(t) ?? []; } }) }),
    update: (t: unknown) => ({
      set: (values: Record<string, unknown>) => ({ where: async () => { updates.push({ table: t, set: values }); } }),
    }),
  };
  return db;
}

const reward = (over: Record<string, unknown> = {}) => ({
  id: 7,
  rewardType: 'EXTRA_QUALIFIED_ENQUIRIES',
  rewardValue: '5',
  effectRef: 'OVERRIDE:123',
  recipientUserId: RECIPIENT,
  ...over,
}) as any;

describe('reading an effect reference', () => {
  it('splits a well-formed reference into its kind and its id', () => {
    expect(parseEffectRef('OVERRIDE:123')).toEqual({ kind: 'OVERRIDE', id: 123 });
    expect(parseEffectRef('PLACEMENT:45')).toEqual({ kind: 'PLACEMENT', id: 45 });
  });

  it('refuses anything that is not one', () => {
    // Each of these reached the revoke path as a number once parsed loosely.
    for (const bad of [null, undefined, '', 'OVERRIDE', 'OVERRIDE:', ':123', 'OVERRIDE:0',
      'OVERRIDE:-4', 'OVERRIDE:abc', 'OVERRIDE:1.5',
      // Number() accepted both of these: 1e3 became row 1000, and the trailing
      // segment was silently dropped. Neither is a value the grant writes.
      'OVERRIDE:1e3', 'OVERRIDE:123:456', 'OVERRIDE: 123', 'override:123',
      'OVERRIDE:0123', 'OVERRIDE:99999999999999999999']) {
      expect(parseEffectRef(bad as any), String(bad)).toBeNull();
    }
  });
});

describe('an entitlement bonus', () => {
  it('is revoked, stamped with the time and the administrator who did it', async () => {
    const db = fakeDb([[vendorEntitlementOverrides, [{ id: 123, userId: RECIPIENT, revokedAt: null }]]]);
    const result = await reverseRewardEffect(db, reward(), ACTOR, NOW);

    expect(result).toEqual({ ok: true, effect: 'bonus_revoked', detail: 'Withdrew the 5 enquiry bonus.' });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].table).toBe(vendorEntitlementOverrides);
    expect(db.updates[0].set).toEqual({ revokedAt: NOW, revokedBy: ACTOR });
  });

  it('leaves everything else on the row alone', async () => {
    // The row records what was granted and why. Reversal withdraws it; it does
    // not rewrite the history of the grant.
    const db = fakeDb([[vendorEntitlementOverrides, [{ id: 123, userId: RECIPIENT, revokedAt: null }]]]);
    await reverseRewardEffect(db, reward(), ACTOR, NOW);
    expect(Object.keys(db.updates[0].set).sort()).toEqual(['revokedAt', 'revokedBy']);
  });

  it('reports honestly when it was already withdrawn, and writes nothing', async () => {
    const db = fakeDb([[vendorEntitlementOverrides, [{ id: 123, userId: RECIPIENT, revokedAt: NOW }]]]);
    const result = await reverseRewardEffect(db, reward(), ACTOR, NOW);
    expect(result).toMatchObject({ ok: true, effect: 'nothing_to_undo' });
    expect(db.updates).toEqual([]);
  });

  it('reports honestly when the row is gone, and writes nothing', async () => {
    const db = fakeDb([[vendorEntitlementOverrides, []]]);
    const result = await reverseRewardEffect(db, reward(), ACTOR, NOW);
    expect(result).toMatchObject({ ok: true, effect: 'nothing_to_undo' });
    expect(db.updates).toEqual([]);
  });
});

describe('a featured placement', () => {
  const placementReward = () => reward({ rewardType: 'TEMPORARY_FEATURED', effectRef: 'PLACEMENT:45' });

  it('is revoked on the sponsorship row it actually created', async () => {
    const db = fakeDb([[vendorSponsorships, [{ id: 45, vendorId: RECIPIENT, revokedAt: null }]]]);
    const result = await reverseRewardEffect(db, placementReward(), ACTOR, NOW);

    expect(result).toMatchObject({
      ok: true, effect: 'placement_revoked',
      // Named for what the reward actually books - a root-scope BOOST that
      // re-ranks the directory - not the Spotlight block it never used.
      detail: 'Withdrew the featured placement in the vendor directory.',
    });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].table).toBe(vendorSponsorships);
    expect(db.updates[0].set).toEqual({ revokedAt: NOW, revokedBy: ACTOR });
  });

  it('is not revoked twice', async () => {
    const db = fakeDb([[vendorSponsorships, [{ id: 45, vendorId: RECIPIENT, revokedAt: NOW }]]]);
    const result = await reverseRewardEffect(db, placementReward(), ACTOR, NOW);
    expect(result).toMatchObject({ ok: true, effect: 'nothing_to_undo' });
    expect(db.updates).toEqual([]);
  });
});

describe('the effect must belong to the account that received the reward', () => {
  /*
   * THE GUARD THIS SECTION EXISTS FOR. `effectRef` is a string in a column. If
   * reversal followed it without checking, a wrong or tampered value would be a
   * way to revoke an unrelated vendor's entitlement - one an administrator
   * granted for their own reasons - through a referral screen.
   *
   * MUTATION PROOF: delete the `row.userId !== recipientUserId` check and the
   * first assertion of each test flips to ok:true AND the second flips to one
   * update written. Both fail, and they fail describing the damage.
   */
  it('refuses an entitlement row owned by somebody else, and revokes nothing', async () => {
    const db = fakeDb([[vendorEntitlementOverrides, [{ id: 123, userId: RECIPIENT + 1, revokedAt: null }]]]);
    const result = await reverseRewardEffect(db, reward(), ACTOR, NOW);
    expect(result).toEqual({ ok: false, reason: 'That entitlement belongs to a different account.' });
    expect(db.updates).toEqual([]);
  });

  it('refuses a placement owned by somebody else, and revokes nothing', async () => {
    const db = fakeDb([[vendorSponsorships, [{ id: 45, vendorId: RECIPIENT + 1, revokedAt: null }]]]);
    const result = await reverseRewardEffect(
      db, reward({ rewardType: 'TEMPORARY_FEATURED', effectRef: 'PLACEMENT:45' }), ACTOR, NOW);
    expect(result).toEqual({ ok: false, reason: 'That placement belongs to a different account.' });
    expect(db.updates).toEqual([]);
  });

  it('compares as numbers, so a driver returning a string id is still checked', async () => {
    // mysql2 can hand back a BIGINT column as a string. `'42' !== 42` would
    // have refused every legitimate reversal; `42 == '43'` must still refuse.
    const owned = fakeDb([[vendorEntitlementOverrides, [{ id: 123, userId: String(RECIPIENT), revokedAt: null }]]]);
    expect(await reverseRewardEffect(owned, reward(), ACTOR, NOW)).toMatchObject({ ok: true, effect: 'bonus_revoked' });

    const other = fakeDb([[vendorEntitlementOverrides, [{ id: 123, userId: String(RECIPIENT + 1), revokedAt: null }]]]);
    expect(await reverseRewardEffect(other, reward(), ACTOR, NOW)).toMatchObject({ ok: false });
    expect(other.updates).toEqual([]);
  });
});

describe('subscription time already granted', () => {
  /*
   * The owner's decision: "Never shorten current/paid/manually granted
   * subscription period." Once days are on a period there is no way to tell
   * which ones this reward contributed - the vendor may have renewed since.
   */
  it('is left in place, and the reason is stated rather than implied', async () => {
    const db = fakeDb([]);
    const result = await reverseRewardEffect(
      db, reward({ rewardType: 'SUBSCRIPTION_EXTENSION', rewardValue: '30', effectRef: null }), ACTOR, NOW);

    expect(result).toMatchObject({ ok: true, effect: 'nothing_to_undo' });
    expect((result as any).detail).toMatch(/does not shorten a period/i);
    expect(db.updates).toEqual([]);
    expect(db.selects).toEqual([]);
  });

  it('is left in place even when an effect reference points at a revocable row', async () => {
    // The reward TYPE decides this, not the reference. A SUBSCRIPTION_EXTENSION
    // that somehow carries `OVERRIDE:123` must not revoke override 123.
    const db = fakeDb([[vendorEntitlementOverrides, [{ id: 123, userId: RECIPIENT, revokedAt: null }]]]);
    const result = await reverseRewardEffect(
      db, reward({ rewardType: 'SUBSCRIPTION_EXTENSION', effectRef: 'OVERRIDE:123' }), ACTOR, NOW);

    expect(result).toMatchObject({ ok: true, effect: 'nothing_to_undo' });
    expect(db.updates).toEqual([]);
  });
});

describe('a reward that never applied', () => {
  it('has nothing to withdraw and says so', async () => {
    const db = fakeDb([]);
    const result = await reverseRewardEffect(db, reward({ effectRef: null }), ACTOR, NOW);
    expect(result).toMatchObject({ ok: true, effect: 'nothing_to_undo' });
    expect(db.updates).toEqual([]);
  });

  it('an unrecognised reference is refused, not guessed at', async () => {
    const db = fakeDb([]);
    const result = await reverseRewardEffect(db, reward({ effectRef: 'SUBSCRIPTION:9' }), ACTOR, NOW);
    expect(result).toMatchObject({ ok: false });
    expect((result as any).reason).toContain('SUBSCRIPTION:9');
    expect(db.updates).toEqual([]);
  });
});

describe('the ledger half', () => {
  it('records REVERSED, when, and why', async () => {
    const db = fakeDb([]);
    await markRewardReversed(db, 7, 'Fraudulent signup ring', NOW);
    expect(db.updates).toEqual([{
      table: referralRewards,
      set: { status: 'REVERSED', reversedAt: NOW, reversalReason: 'Fraudulent signup ring' },
    }]);
  });

  it('trims a reason to the column it is stored in rather than failing the reversal', async () => {
    const db = fakeDb([]);
    await markRewardReversed(db, 7, 'x'.repeat(900), NOW);
    expect((db.updates[0].set.reversalReason as string).length).toBe(500);
  });
});

describe('the referral itself after a reversal', () => {
  it('stays qualified, because the qualification genuinely happened', async () => {
    const db = fakeDb([]);
    await markReferralAfterReversal(db, 11);
    expect(db.updates).toEqual([{ table: referrals, set: { status: REFERRAL_STATUS_AFTER_REVERSAL } }]);
    expect(REFERRAL_STATUS_AFTER_REVERSAL).toBe('qualified');
  });

  it('is a status the column can actually hold', () => {
    // A status the enum rejects would fail at the database, after the effect
    // had already been withdrawn.
    const schema = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');
    const enumLine = schema.match(/status:\s*mysqlEnum\('status',\s*\[('registered'[^\]]*)\]\)/);
    expect(enumLine, 'referrals.status enum not found').toBeTruthy();
    expect(enumLine![1]).toContain(`'${REFERRAL_STATUS_AFTER_REVERSAL}'`);
  });
});
