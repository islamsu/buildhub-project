/**
 * UNDOING A REFERRAL REWARD - the effect, not just the word.
 *
 * `admin.reverseReferralReward` set `status: 'REVERSED'` on the ledger row and
 * stopped. The entitlement stayed granted, the Spotlight kept running, the
 * subscription kept its extra days. An administrator reversing a fraudulent
 * referral changed a label and nothing else, and the ledger then disagreed with
 * the platform about what the vendor actually had.
 *
 * WHAT MAKES THIS SAFE TO DO AT ALL is `referralRewards.effectRef`, written
 * when the effect committed (drizzle/0045). Without it, reversal would have to
 * find the effect by matching a reason string - which works right up until two
 * campaigns share a name, and then revokes an innocent administrator's grant.
 *
 * THE ONE THING IT MUST NEVER DO is take away something this reward did not
 * give. A vendor's allowance is the plan, plus an administrator's absolute
 * override, plus any bonuses; reversing a referral removes ONE BONUS ROW and
 * touches nothing else. A subscription's period may have been paid for, or
 * granted manually, or extended by several rewards; the owner's decision is
 * explicit that reversal must never shorten legitimate time, so the extension
 * is the one effect this reports as NOT REVERSIBLE rather than guessing which
 * days belonged to which grant.
 */
import { eq } from 'drizzle-orm';
import { referralRewards, referrals, vendorEntitlementOverrides, vendorSponsorships } from '../drizzle/schema';

export type ReversalOutcome =
  | { ok: true; effect: 'bonus_revoked' | 'placement_revoked' | 'nothing_to_undo'; detail: string }
  | { ok: false; reason: string };

/**
 * `OVERRIDE:123` / `PLACEMENT:45` -> its two halves, or null if unusable.
 *
 * ONE CANONICAL SHAPE, matched whole. Splitting on ':' and running the tail
 * through Number() accepted `OVERRIDE:1e3` as row 1000 and `OVERRIDE:123:456`
 * as row 123 with the rest quietly dropped. Neither is a value this codebase
 * writes, so either one means the column has been altered by something other
 * than the grant - and the answer to that is to refuse, not to interpret it.
 */
const EFFECT_REF = /^([A-Z]+):([1-9][0-9]*)$/;

export function parseEffectRef(raw: string | null | undefined): { kind: string; id: number } | null {
  if (!raw) return null;
  const match = EFFECT_REF.exec(String(raw));
  if (!match) return null;
  const id = Number(match[2]);
  // A row id beyond exact integer range would compare wrongly against the id
  // the database holds, so it is not a reference this can act on.
  if (!Number.isSafeInteger(id)) return null;
  return { kind: match[1], id };
}

/**
 * Undo the effect a reward created.
 *
 * Reports what it did rather than throwing, because the caller has to record
 * the reversal either way - a reward whose effect cannot be undone is still a
 * reward an administrator has decided to withdraw, and the ledger must say so
 * truthfully rather than the whole operation failing.
 */
export async function reverseRewardEffect(
  db: any,
  reward: {
    id: number;
    rewardType: string;
    rewardValue: string;
    effectRef: string | null;
    recipientUserId: number;
  },
  actorId: number | null,
  now: Date = new Date(),
): Promise<ReversalOutcome> {
  // A reward that never paid out has nothing to undo, and saying so is more
  // useful than a silent success.
  const ref = parseEffectRef(reward.effectRef);

  if (reward.rewardType === 'SUBSCRIPTION_EXTENSION') {
    /*
     * NOT REVERSED, AND SAID PLAINLY.
     *
     * The owner's decision: "Never shorten current/paid/manually granted
     * subscription period." Once days are added to a period there is no way to
     * tell, from the period alone, which days this reward contributed - the
     * vendor may have paid for a renewal since, or an administrator may have
     * extended it again. Shortening it by the reward's value would take back
     * time that was not this reward's to take.
     *
     * So the ledger records the reversal and this reports that the time
     * stands. An administrator who wants those days back can change the period
     * deliberately, which is a decision with their name on it.
     */
    return {
      ok: true,
      effect: 'nothing_to_undo',
      detail: 'The subscription time already granted is left in place. '
        + 'BuildHub does not shorten a period it cannot prove this reward alone extended.',
    };
  }

  if (!ref) {
    return {
      ok: true,
      effect: 'nothing_to_undo',
      detail: 'This reward records no applied effect, so there is nothing to withdraw.',
    };
  }

  if (ref.kind === 'OVERRIDE') {
    const [row] = await db.select().from(vendorEntitlementOverrides)
      .where(eq(vendorEntitlementOverrides.id, ref.id));
    if (!row) return { ok: true, effect: 'nothing_to_undo', detail: 'The entitlement row no longer exists.' };
    if (row.revokedAt) return { ok: true, effect: 'nothing_to_undo', detail: 'That entitlement was already withdrawn.' };
    // BELONGS TO THIS RECIPIENT. A malformed or tampered effectRef must not
    // become a way to revoke somebody else's entitlement.
    if (Number(row.userId) !== reward.recipientUserId) {
      return { ok: false, reason: 'That entitlement belongs to a different account.' };
    }
    await db.update(vendorEntitlementOverrides)
      .set({ revokedAt: now, revokedBy: actorId })
      .where(eq(vendorEntitlementOverrides.id, ref.id));
    return { ok: true, effect: 'bonus_revoked', detail: `Withdrew the ${reward.rewardValue} enquiry bonus.` };
  }

  if (ref.kind === 'PLACEMENT') {
    const [row] = await db.select().from(vendorSponsorships)
      .where(eq(vendorSponsorships.id, ref.id));
    if (!row) return { ok: true, effect: 'nothing_to_undo', detail: 'The placement no longer exists.' };
    if (row.revokedAt) return { ok: true, effect: 'nothing_to_undo', detail: 'That placement was already revoked.' };
    if (Number(row.vendorId) !== reward.recipientUserId) {
      return { ok: false, reason: 'That placement belongs to a different account.' };
    }
    await db.update(vendorSponsorships)
      .set({ revokedAt: now, revokedBy: actorId })
      .where(eq(vendorSponsorships.id, ref.id));
    // Named for what it is. The reward books a root-scope BOOST that re-ranks
    // the vendor directory, not the Spotlight block - saying "Spotlight" would
    // send a vendor looking for something they never had.
    return { ok: true, effect: 'placement_revoked', detail: 'Withdrew the featured placement in the vendor directory.' };
  }

  return { ok: false, reason: `Unrecognised effect reference "${reward.effectRef}".` };
}

/**
 * The referral's own status after a reversal.
 *
 * It stays QUALIFIED rather than reverting to `registered`: the qualification
 * genuinely happened, and rewriting history to say it did not would lose the
 * fact an administrator is reversing. `revoked` is reserved for a referral
 * judged illegitimate, which is a different decision and has its own reason.
 */
export const REFERRAL_STATUS_AFTER_REVERSAL = 'qualified' as const;

export async function markReferralAfterReversal(db: any, referralId: number): Promise<void> {
  await db.update(referrals)
    .set({ status: REFERRAL_STATUS_AFTER_REVERSAL })
    .where(eq(referrals.id, referralId));
}

/** The ledger half. Kept beside the effect half so the two cannot drift apart. */
export async function markRewardReversed(
  db: any, rewardId: number, reason: string, now: Date = new Date(),
): Promise<void> {
  await db.update(referralRewards).set({
    status: 'REVERSED',
    reversedAt: now,
    reversalReason: reason.slice(0, 500),
  }).where(eq(referralRewards.id, rewardId));
}
