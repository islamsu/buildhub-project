// ── Subscription Lifecycle Orchestration (Phase 4B.4) ──────────────────────
//
// The layer that actually MOVES a vendor through the commercial lifecycle,
// binding together the three pieces that already existed:
//
//   Phase 4B.1  domain.ts   - pure transitions, no I/O
//   Phase 4B.2  entitlements.ts - what a state entitles you to, right now
//   Phase 4B.3  enquiries.ts - what you can consume with those entitlements
//
// Three properties every operation in this file guarantees, because a
// commercial state machine that lacks any one of them corrupts silently:
//
//  1. SERVER AUTHORITY. Every function is keyed by a `userId` the caller
//     derived from an authenticated session. Nothing accepts a plan, status,
//     price, trial, cancellation, or entitlement from a client payload. The
//     only thing a vendor may say is *which* transition they want.
//
//  2. IDEMPOTENCY. Every operation reports `applied` or `noop`. Running the
//     same transition twice never double-applies it: a repeated cancellation
//     does not re-stamp `canceledAt`, a repeated payment failure does not
//     extend the grace window, a repeated trial start does not re-award the
//     founder offer. This is what makes Phase 4B.5's provider webhooks safe to
//     retry, which every payment provider eventually does.
//
//  3. SERIALISATION. Each operation runs inside one transaction holding a
//     `SELECT ... FOR UPDATE` row lock on the vendor's single subscription
//     row. Concurrent transitions for one vendor therefore queue rather than
//     interleave, so cancel-vs-resume or upgrade-vs-downgrade cannot produce a
//     row that reflects neither.
//
// NO PAYMENT PROVIDER. Nothing here talks to Paymob, Stripe, or any provider.
// `recordPaymentFailure` / `recordPaymentRecovery` record a payment outcome
// that something ELSE observed; they never assert that a charge happened, and
// they never retry one. Provider integration is Phase 4B.5.

import { and, eq, isNotNull, lte, or } from 'drizzle-orm';
import { PLAN_IDS, isFounderPriceAvailable, isPlanId, type BillingInterval, type PlanId } from '@shared/billing';
import { vendorSubscriptions, type VendorSubscription } from '../../drizzle/schema';
import { getDb } from '../db';
import {
  BillingDomainError,
  activate,
  cancelAtPeriodEnd,
  changePlan,
  deriveBillingState,
  downgradeToFree,
  expireFounderPrice,
  grantPaidAccess,
  isFounderEligible,
  lifecycleStateOf,
  markPaymentFailed,
  reverseCancellation,
  startTrial,
  type BillingState,
  type LifecycleState,
  type SubscriptionPatch,
} from './domain';
import { getFounderOfferEndsAt, getSubscription, recordBillingEvent } from './service';

/** Who asked for the transition. Mirrors billingEvents.source. */
export type LifecycleSource = 'vendor' | 'admin' | 'system' | 'provider';

/**
 * Facts about the row as it was BEFORE the operation, carried out so a caller
 * can word a message from what actually changed rather than re-reading the row
 * afterwards and describing the wrong thing. Optional because the three early
 * refusal paths below never got as far as reading a row.
 */
type LifecycleBefore = {
  /** The stored plan before this operation. */
  previousPlan?: PlanId;
  /** The plan whose entitlements actually applied before this operation. */
  previousEffectivePlan?: PlanId;
  /**
   * WHAT THE CHANGE WAS, in the vendor's terms. Set by the manual plan change
   * so a caller can word a message without comparing plan strings itself.
   *
   * The router used to derive this - `rank(to) > rank(from)`, plus a check for
   * `input.plan === 'free'` - and that is a plan comparison living outside the
   * engine, which is precisely what billingAuthorization.test.ts forbids and
   * was right to. The engine already knows which branch it took; asking it is
   * both simpler and the only place the answer is authoritative.
   *
   *   upgraded      moved to a higher plan, live now
   *   downgraded    moved to a lower plan, live now
   *   scheduled_end paid access will not renew, and continues until the period
   *                 the vendor already paid for runs out
   */
  planChange?: 'upgraded' | 'downgraded' | 'scheduled_end';
};

export type LifecycleOutcome = LifecycleBefore & (
  /** State changed and was persisted. */
  | { outcome: 'applied'; action: string; state: BillingState; lifecycleState: LifecycleState }
  /** Already in the requested state. Safe repeat - nothing written. */
  | { outcome: 'noop'; action: string; reason: string; state: BillingState; lifecycleState: LifecycleState }
  /** The transition is not legal from the current state. Nothing written. */
  | { outcome: 'rejected'; action: string; reason: string; state: BillingState; lifecycleState: LifecycleState }
);

function isDuplicateKeyError(error: unknown): boolean {
  const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code
    ?? (error as { code?: string })?.code;
  return code === 'ER_DUP_ENTRY';
}

function describe(subscription: VendorSubscription | null, now: Date) {
  const state = deriveBillingState(subscription, now);
  return { state, lifecycleState: lifecycleStateOf(state) };
}

/**
 * Guarantee a subscription row exists so the lock below always has something
 * to take. Racing callers are resolved by `UNIQUE(userId)` on the table: the
 * loser catches ER_DUP_ENTRY and proceeds against the winner's row. A vendor
 * therefore can never end up with two subscriptions.
 */
async function ensureSubscriptionRow(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await getSubscription(userId);
  if (existing) return;
  try {
    await db.insert(vendorSubscriptions).values({ userId, plan: 'free', status: 'free' });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
}

/**
 * The one way this module writes. Takes the vendor's subscription row lock,
 * hands the decision function the CURRENT row (re-read under the lock, never a
 * stale copy from before the wait), and applies whatever patch it returns.
 *
 * A decision function returning `null` means "already in the target state" -
 * the idempotent no-op path, which writes nothing at all.
 */
async function withSubscriptionLock(
  userId: number,
  action: string,
  source: LifecycleSource,
  actorId: number | null,
  decide: (subscription: VendorSubscription, now: Date) => Promise<SubscriptionPatch | null | { reject: string }>,
  now: Date,
  /**
   * Free text an administrator wrote to justify the operation. Prefixed to the
   * composed note so history reads "why" before "what". Never a credential:
   * the only caller passing this bounds and trims it first.
   */
  reason?: string | null,
): Promise<LifecycleOutcome> {
  const db = await getDb();
  if (!db) {
    // Fail closed and loudly: refusing a transition is always safer than
    // pretending one happened.
    const { state, lifecycleState } = describe(null, now);
    return { outcome: 'rejected', action, reason: 'Billing storage is unavailable.', state, lifecycleState };
  }

  await ensureSubscriptionRow(userId);

  let result: { patch: SubscriptionPatch | null; reject?: string; before: VendorSubscription } | null = null;

  await db.transaction(async tx => {
    const [locked] = await tx
      .select()
      .from(vendorSubscriptions)
      .where(eq(vendorSubscriptions.userId, userId))
      .for('update')
      .limit(1);
    if (!locked) return;

    const decision = await decide(locked, now);
    if (decision && 'reject' in decision) {
      result = { patch: null, reject: decision.reject, before: locked };
      return;
    }
    if (decision === null) {
      result = { patch: null, before: locked };
      return;
    }
    await tx.update(vendorSubscriptions).set(decision).where(eq(vendorSubscriptions.id, locked.id));
    result = { patch: decision, before: locked };
  });

  if (!result) {
    const { state, lifecycleState } = describe(null, now);
    return { outcome: 'rejected', action, reason: 'Subscription row could not be located.', state, lifecycleState };
  }

  const settled = result as { patch: SubscriptionPatch | null; reject?: string; before: VendorSubscription };
  const before = settled.before;

  // The plan as it stood before anything was written. Read from the LOCKED row
  // rather than from a fresh query, so a concurrent operation that lands in
  // between cannot make this describe a change that did not happen.
  const was = {
    previousPlan: before.plan as PlanId,
    previousEffectivePlan: deriveBillingState(before, now).effectivePlan,
  };

  if (settled.reject) {
    const { state, lifecycleState } = describe(before, now);
    return { ...was, outcome: 'rejected', action, reason: settled.reject, state, lifecycleState };
  }
  if (!settled.patch) {
    const { state, lifecycleState } = describe(before, now);
    return { ...was, outcome: 'noop', action, reason: 'Already in the requested state.', state, lifecycleState };
  }

  const after = await getSubscription(userId);
  const { state, lifecycleState } = describe(after, now);

  // Audit is best-effort by design (see recordBillingEvent): failing to write
  // history must never roll back the commercial change it describes.
  await recordBillingEvent({
    userId,
    subscriptionId: after?.id ?? null,
    action,
    fromStatus: before.status,
    toStatus: after?.status ?? null,
    source,
    actorId,
    note: `${reason ? `${reason} · ` : ''}${before.plan} → ${after?.plan ?? '?'} · ${lifecycleStateOf(deriveBillingState(before, now))} → ${lifecycleState}`,
  });

  return { ...was, outcome: 'applied', action, state, lifecycleState };
}

// ── Vendor-initiated transitions ───────────────────────────────────────────

/**
 * FREE → TRIALING on a paid plan. The 30-day trial, founder eligibility, and
 * the price snapshot are all resolved server-side; the caller chooses only the
 * plan and interval.
 *
 * Idempotent: starting a trial the vendor is already running is a no-op, which
 * critically means it cannot burn the one-time founder offer twice.
 *
 * One trial per vendor, ever - see the `trialStartedAt` guard below.
 */
export async function startPaidTrial(params: {
  userId: number;
  planId: PlanId;
  interval: BillingInterval;
  source?: LifecycleSource;
  actorId?: number | null;
  now?: Date;
}): Promise<LifecycleOutcome> {
  const now = params.now ?? new Date();
  const { userId, planId, interval } = params;

  if (!isPlanId(planId) || planId === 'free') {
    const { state, lifecycleState } = describe(await getSubscription(userId), now);
    return { outcome: 'rejected', action: 'trial_started', reason: 'A trial applies to a paid plan only.', state, lifecycleState };
  }

  const offerEndsAt = await getFounderOfferEndsAt();

  return withSubscriptionLock(userId, 'trial_started', params.source ?? 'vendor', params.actorId ?? userId, async (locked, at) => {
    const current = deriveBillingState(locked, at);

    if (current.inTrial && locked.plan === planId) return null;
    if (current.isPaid) {
      return { reject: 'This vendor already has paid access. Change the plan instead of starting a new trial.' };
    }
    // ONE trial per vendor, ever. `trialStartedAt` is write-once and survives
    // every downgrade, so a lapsed trial - which leaves the vendor unpaid, and
    // therefore superficially eligible again - cannot be used to start an
    // endless chain of free 30-day paid-plan trials.
    if (locked.trialStartedAt !== null) {
      return { reject: 'This vendor has already used their trial. A trial is available once per vendor.' };
    }

    // Founder eligibility is evaluated HERE, under the lock, against the row as
    // it actually is - never from a value a caller passed in.
    //
    // Founder pricing is approved for the monthly interval only. A vendor who
    // is eligible but chooses annual simply pays the standard annual price -
    // the sale is not blocked, and no annual founder price is invented. The
    // domain still refuses an unapproved combination outright if anything ever
    // asks for one; this just never asks.
    const founder = isFounderEligible(locked, offerEndsAt, at)
      && isFounderPriceAvailable(planId, interval);
    try {
      return startTrial({ planId, interval, founder, now: at });
    } catch (error) {
      if (error instanceof BillingDomainError) return { reject: error.message };
      throw error;
    }
  }, now);
}

/**
 * Vendor cancels. Approved policy: no future renewal, paid access continues to
 * the end of the period already paid for, downgrade afterwards.
 *
 * Idempotent: a second cancellation request does not re-stamp `canceledAt`, so
 * the audit trail keeps the moment the vendor actually decided.
 */
export async function requestCancellation(params: {
  userId: number;
  source?: LifecycleSource;
  actorId?: number | null;
  now?: Date;
}): Promise<LifecycleOutcome> {
  const now = params.now ?? new Date();
  return withSubscriptionLock(params.userId, 'cancellation_requested', params.source ?? 'vendor', params.actorId ?? params.userId, async (locked, at) => {
    if (locked.cancelAtPeriodEnd) return null;
    const current = deriveBillingState(locked, at);
    if (!current.isPaid) {
      return { reject: 'There is no active paid subscription to cancel.' };
    }
    return cancelAtPeriodEnd(at);
  }, now);
}

/**
 * Vendor changes their mind while the paid period is still running.
 * Idempotent: resuming a subscription that was never cancelled is a no-op.
 */
export async function resumeSubscription(params: {
  userId: number;
  source?: LifecycleSource;
  actorId?: number | null;
  now?: Date;
}): Promise<LifecycleOutcome> {
  const now = params.now ?? new Date();
  return withSubscriptionLock(params.userId, 'cancellation_reversed', params.source ?? 'vendor', params.actorId ?? params.userId, async (locked, at) => {
    if (!locked.cancelAtPeriodEnd) return null;
    const current = deriveBillingState(locked, at);
    if (!current.isPaid) {
      return { reject: 'The paid period has already ended. Start a new subscription instead.' };
    }
    return reverseCancellation();
  }, now);
}

/**
 * PROFESSIONAL ⇄ PREMIUM. Moving to FREE is deliberately NOT accepted here -
 * that is a cancellation, so the vendor keeps what they already paid for.
 *
 * Idempotent: changing to the plan already held is a no-op.
 */
export async function changeVendorPlan(params: {
  userId: number;
  targetPlan: PlanId;
  source?: LifecycleSource;
  actorId?: number | null;
  now?: Date;
}): Promise<LifecycleOutcome> {
  const now = params.now ?? new Date();
  return withSubscriptionLock(params.userId, 'plan_changed', params.source ?? 'vendor', params.actorId ?? params.userId, async (locked, at) => {
    if (locked.plan === params.targetPlan) return null;
    const current = deriveBillingState(locked, at);
    if (!current.isPaid) {
      return { reject: 'A plan change requires live paid access. Start a subscription first.' };
    }
    try {
      return changePlan({ subscription: locked, targetPlan: params.targetPlan, now: at });
    } catch (error) {
      if (error instanceof BillingDomainError) return { reject: error.message };
      throw error;
    }
  }, now);
}

/**
 * ── SUPER ADMIN MANUAL PLAN / MEMBERSHIP CHANGE ────────────────────────────
 *
 * The one operation in this file that exists because a HUMAN decided, rather
 * than because a payment, a clock, or a vendor's own click decided.
 *
 * WHY IT IS NOT `changeVendorPlan` WITH A WIDER PERMISSION. That function
 * requires live paid access to change FROM, so the case an administrator
 * actually faces - a vendor on FREE who has agreed a deal off-platform, or
 * whose bank transfer no payment provider will ever report - was refused by
 * every route into the engine. This adds the missing edge; it does not add a
 * second engine.
 *
 * IT ROUTES THROUGH THE ENGINE, NOT AROUND IT. Every branch below returns a
 * domain patch and is applied under the same `SELECT ... FOR UPDATE` lock as
 * every other transition, so a manual change cannot interleave with a
 * cancellation, a renewal, or another administrator. Nothing here writes a
 * subscription column directly, and nothing here touches users.userRole - a
 * membership is a subscription, and changing what someone IS in order to
 * change what they may DO is the confusion this engine exists to prevent.
 *
 * MOVING TO FREE IS STILL A CANCELLATION. The domain refuses `changePlan` to
 * FREE on purpose: paid access must run to the end of the period the vendor
 * already paid for. An administrator selecting FREE therefore SCHEDULES the
 * end rather than revoking access mid-period - the outcome says so, and the
 * caller must render that rather than claiming the plan changed today. The
 * only immediate downgrade is for a row whose paid access has already lapsed,
 * where there is nothing left to revoke.
 *
 * A REASON IS REQUIRED, not optional. The whole difference between this and an
 * unaudited manual grant is that somebody has to say why, and the reason is
 * carried into billing history where a dispute can find it.
 */
/**
 * Rank a plan for the sole purpose of saying whether a move was up or down.
 * Lives here, in the billing layer, because comparing plans is the engine's
 * job - see the note on `planChange`.
 */
function planRank(plan: PlanId): number {
  return PLAN_IDS.indexOf(plan);
}

export async function setVendorPlanManually(params: {
  userId: number;
  targetPlan: PlanId;
  /** Only consulted when granting fresh paid access. Defaults to the vendor's existing interval, else monthly. */
  interval?: BillingInterval;
  reason: string;
  actorId: number;
  now?: Date;
}): Promise<LifecycleOutcome> {
  const now = params.now ?? new Date();
  const { targetPlan } = params;
  const reason = params.reason.trim();

  if (!isPlanId(targetPlan)) {
    const { state, lifecycleState } = describe(await getSubscription(params.userId), now);
    return { outcome: 'rejected', action: 'plan_changed_manually', reason: 'Unknown plan.', state, lifecycleState };
  }
  if (reason.length === 0) {
    const { state, lifecycleState } = describe(await getSubscription(params.userId), now);
    return {
      outcome: 'rejected',
      action: 'plan_changed_manually',
      reason: 'A manual plan change requires a reason. It is recorded in billing history.',
      state,
      lifecycleState,
    };
  }

  const outcome = await withSubscriptionLock(
    params.userId,
    'plan_changed_manually',
    'admin',
    params.actorId,
    async (locked, at) => {
      const current = deriveBillingState(locked, at);

      if (targetPlan === 'free') {
        // Already there, and nothing paid is still running: nothing to do.
        if (locked.plan === 'free' && !current.isPaid) return null;
        if (current.isPaid) {
          // Already scheduled to end - a second request must not re-stamp
          // `canceledAt` and lose the moment the decision was actually taken.
          if (locked.cancelAtPeriodEnd) return null;
          return cancelAtPeriodEnd(at);
        }
        // A paid plan on the row whose access has already lapsed. Persisting
        // FREE here revokes nothing that was still live.
        return downgradeToFree('canceled');
      }

      // Already on this paid plan AND actually receiving it: a no-op, which
      // matters because it is what stops a repeated click sending the vendor a
      // second "your plan changed" notification about a change that did not
      // happen.
      if (locked.plan === targetPlan && current.isPaid) return null;

      try {
        // Live paid access already: this is a genuine plan change, and the
        // domain's own rules about period, price and founder pricing apply
        // unchanged. A manual change is not a licence to rewrite them.
        if (current.isPaid) {
          return changePlan({ subscription: locked, targetPlan, now: at });
        }
        // No live paid access: the case nothing else in this file could serve.
        const interval = params.interval
          ?? (locked.billingInterval as BillingInterval | null)
          ?? 'month';
        return grantPaidAccess({ targetPlan, interval, now: at });
      } catch (error) {
        if (error instanceof BillingDomainError) return { reject: error.message };
        throw error;
      }
    },
    now,
    reason,
  );

  if (outcome.outcome !== 'applied') return outcome;

  const from = outcome.previousPlan ?? 'free';
  const to = outcome.state.storedPlan;
  // Selecting FREE while paid access was live does not move the plan at all -
  // it sets the row not to renew. Saying "downgraded to free" there would be
  // false: the vendor still has the plan, and still has it tomorrow.
  const scheduledEnd = targetPlan === 'free' && to !== 'free' && outcome.state.cancelAtPeriodEnd;

  return {
    ...outcome,
    planChange: scheduledEnd
      ? 'scheduled_end'
      : planRank(to) > planRank(from) ? 'upgraded' : 'downgraded',
  };
}

// ── Payment-outcome transitions (driven by the provider in Phase 4B.5) ─────

/**
 * Record that a renewal payment did not succeed, opening the approved 7-day
 * grace window during which paid entitlements are RETAINED.
 *
 * Idempotent in the way that matters commercially: a repeat while already in
 * grace is a no-op, so duplicate provider events cannot keep pushing the
 * deadline further out and hand a non-paying vendor unlimited access.
 *
 * This records an outcome someone else observed. It does not charge, retry, or
 * assert anything about a provider's own retry schedule.
 */
/**
 * ── EXTEND AN EXISTING SUBSCRIPTION PERIOD ─────────────────────────────────
 *
 * The owner's decision, taken explicitly: SUBSCRIPTION_EXTENSION is a REAL
 * period extension, and PAYMENT REMAINS DEFERRED. So this may move a
 * subscription's end date, and it must NEVER fabricate a payment, an invoice,
 * a transaction, revenue, GMV, commission, a card charge, a payment
 * confirmation, or a paid renewal. Nothing here touches a price or an amount,
 * and the history entry it writes is named for what actually happened.
 *
 * THREE RULES THAT DECIDE WHETHER IT CAN HAPPEN AT ALL
 *
 *   EXTEND FROM THE EXISTING END DATE, NEVER FROM NOW. A vendor with three
 *   weeks left who is granted thirty days must end up with fifty-one days, not
 *   thirty. Extending from `now` would silently CONFISCATE the unused time and
 *   call it a reward.
 *
 *   REFUSE HONESTLY WHEN THERE IS NO FINITE PERIOD TO EXTEND. A free account
 *   has no end date to move, and inventing one would grant paid access that
 *   nobody decided to give. The caller records the refusal; it does not
 *   pretend.
 *
 *   NEVER SHORTEN. The new end date is taken as the LATER of the computed one
 *   and what is already there, so this cannot walk a period backwards however
 *   it is called - including by a caller passing a negative number of days.
 */
export async function extendSubscriptionPeriod(params: {
  userId: number;
  /** Whole days to add. Must be positive; a non-positive value is refused. */
  days: number;
  reason: string;
  source?: LifecycleSource;
  /** Null for the platform - a referral reward has no administrator behind it. */
  actorId?: number | null;
  now?: Date;
}): Promise<LifecycleOutcome> {
  const now = params.now ?? new Date();
  const reason = params.reason.trim();

  if (!Number.isInteger(params.days) || params.days <= 0) {
    const { state, lifecycleState } = describe(await getSubscription(params.userId), now);
    return {
      outcome: 'rejected',
      action: 'subscription_extended',
      reason: 'An extension must be a positive whole number of days.',
      state,
      lifecycleState,
    };
  }
  if (reason.length === 0) {
    const { state, lifecycleState } = describe(await getSubscription(params.userId), now);
    return {
      outcome: 'rejected',
      action: 'subscription_extended',
      reason: 'An extension requires a reason. It is recorded in billing history.',
      state,
      lifecycleState,
    };
  }

  return withSubscriptionLock(
    params.userId,
    'subscription_extended',
    params.source ?? 'system',
    params.actorId ?? null,
    async (locked, at) => {
      const current = deriveBillingState(locked, at);

      /*
       * WHICH DATE IS BEING EXTENDED.
       *
       * A trial has its own end date, and extending a trial is extending the
       * access the vendor actually has. A paid period has currentPeriodEnd.
       * An account with neither has nothing to extend - and manufacturing a
       * period here would hand out paid access nobody granted.
       */
      const anchorDate = current.inTrial && locked.trialEndsAt
        ? new Date(locked.trialEndsAt)
        : locked.currentPeriodEnd ? new Date(locked.currentPeriodEnd) : null;

      if (!anchorDate || Number.isNaN(anchorDate.getTime())) {
        return {
          reject: 'This account has no finite subscription period to extend. '
            + 'BuildHub does not create one - that would be granting paid access nobody decided to give.',
        };
      }

      // FROM THE EXISTING END DATE. Extending from `now` would confiscate
      // whatever time is left and call it a reward.
      const extended = new Date(anchorDate.getTime() + params.days * 24 * 60 * 60 * 1000);

      // AND NEVER BACKWARDS, whatever was asked for.
      if (extended.getTime() <= anchorDate.getTime()) {
        return { reject: 'That extension would not move the period forward.' };
      }

      return current.inTrial && locked.trialEndsAt
        ? { trialEndsAt: extended }
        : { currentPeriodEnd: extended };
    },
    now,
    reason,
  );
}

export async function recordPaymentFailure(params: {
  userId: number;
  source?: LifecycleSource;
  actorId?: number | null;
  note?: string;
  now?: Date;
}): Promise<LifecycleOutcome> {
  const now = params.now ?? new Date();
  return withSubscriptionLock(params.userId, 'payment_failed', params.source ?? 'system', params.actorId ?? null, async (locked, at) => {
    if (locked.status === 'past_due' && locked.gracePeriodEndsAt !== null) return null;
    const current = deriveBillingState(locked, at);
    if (!current.isPaid) {
      return { reject: 'There is no paid subscription that could have failed a renewal.' };
    }
    return markPaymentFailed(at);
  }, now);
}

/**
 * Record that payment recovered. Clears grace and starts a fresh billing
 * period. Idempotent: recovering an already-active subscription whose period
 * is still running is a no-op, so a duplicate event cannot silently extend the
 * period for free.
 */
export async function recordPaymentRecovery(params: {
  userId: number;
  source?: LifecycleSource;
  actorId?: number | null;
  now?: Date;
}): Promise<LifecycleOutcome> {
  const now = params.now ?? new Date();
  return withSubscriptionLock(params.userId, 'payment_recovered', params.source ?? 'system', params.actorId ?? null, async (locked, at) => {
    const current = deriveBillingState(locked, at);
    if (locked.status === 'active' && !current.awaitingRenewalSync) return null;
    if (locked.plan === 'free') {
      return { reject: 'There is no paid subscription to recover.' };
    }
    const interval = (locked.billingInterval ?? 'month') as BillingInterval;
    return activate({ interval, periodStart: at, now: at });
  }, now);
}

/**
 * First successful payment: TRIALING → ACTIVE. Also the renewal path.
 * Idempotent: activating an already-active, still-running period is a no-op.
 */
export async function recordPaymentSucceeded(params: {
  userId: number;
  source?: LifecycleSource;
  actorId?: number | null;
  now?: Date;
}): Promise<LifecycleOutcome> {
  const now = params.now ?? new Date();
  return withSubscriptionLock(params.userId, 'subscription_activated', params.source ?? 'system', params.actorId ?? null, async (locked, at) => {
    const current = deriveBillingState(locked, at);
    if (locked.status === 'active' && !current.awaitingRenewalSync) return null;
    if (locked.plan === 'free') {
      return { reject: 'There is no paid plan selected to activate.' };
    }
    const interval = (locked.billingInterval ?? 'month') as BillingInterval;
    return activate({ interval, periodStart: at, now: at });
  }, now);
}

// ── Convergence ────────────────────────────────────────────────────────────

/**
 * Persist what `deriveBillingState` already knows to be true.
 *
 * This is a bookkeeping step, NOT the thing that revokes access: a lapsed
 * trial, a completed cancellation, or an expired grace period already resolve
 * to FREE the instant they elapse, whether or not this ever runs. Reconciling
 * simply brings the stored row into agreement so admin views, provider syncs,
 * and audit history read correctly.
 *
 * Idempotent by construction: it converges to a fixed point, so running it
 * twice - or a hundred times - produces the same row and only the first run
 * writes anything.
 */
export async function reconcileSubscription(params: {
  userId: number;
  source?: LifecycleSource;
  actorId?: number | null;
  now?: Date;
}): Promise<LifecycleOutcome> {
  const now = params.now ?? new Date();
  return withSubscriptionLock(params.userId, 'lifecycle_reconciled', params.source ?? 'system', params.actorId ?? null, async (locked, at) => {
    const current = deriveBillingState(locked, at);

    // Founder window elapsed while the subscription continues: reprice to
    // standard. One row, repriced - never a second subscription.
    if (locked.isFounderPrice && locked.founderPriceEndsAt !== null && at.getTime() >= locked.founderPriceEndsAt.getTime()) {
      if (current.isPaid || current.awaitingRenewalSync) {
        try {
          return expireFounderPrice(locked);
        } catch (error) {
          if (error instanceof BillingDomainError) return { reject: error.message };
          throw error;
        }
      }
    }

    if (current.isPaid) return null;

    // Not paid any more. Work out which terminal reason applies, and persist
    // it only if the row does not already say so.
    if (locked.status === 'trialing') return downgradeToFree('trial_expired');
    if (locked.status === 'active' && locked.cancelAtPeriodEnd) return downgradeToFree('canceled');
    if (locked.status === 'past_due') return downgradeToFree('grace_expired');

    // RECONCILIATION_REQUIRED is deliberately NOT downgraded here. The row is
    // preserved exactly as it is so the eventual provider event can still
    // settle it; entitlements are already withheld by deriveBillingState, so
    // nothing is over-granted while we wait. Inventing a failure would be
    // asserting something we do not know.
    return null;
  }, now);
}

/**
 * The scheduled sweep's worklist: subscriptions whose governing deadline has
 * passed. Scans only the three indexed columns Phase 4B.1 provisioned for it.
 *
 * Deliberately NOT wired to a scheduler in this phase - BuildHub has no job
 * runner, and inventing one is outside Phase 4B.4. Access revocation does not
 * depend on it (see reconcileSubscription).
 */
export async function findSubscriptionsNeedingReconciliation(now: Date = new Date(), limit = 200) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ userId: vendorSubscriptions.userId, status: vendorSubscriptions.status })
    .from(vendorSubscriptions)
    .where(or(
      and(eq(vendorSubscriptions.status, 'trialing'), isNotNull(vendorSubscriptions.trialEndsAt), lte(vendorSubscriptions.trialEndsAt, now)),
      and(eq(vendorSubscriptions.status, 'past_due'), isNotNull(vendorSubscriptions.gracePeriodEndsAt), lte(vendorSubscriptions.gracePeriodEndsAt, now)),
      and(eq(vendorSubscriptions.status, 'active'), isNotNull(vendorSubscriptions.currentPeriodEnd), lte(vendorSubscriptions.currentPeriodEnd, now)),
      and(eq(vendorSubscriptions.isFounderPrice, true), isNotNull(vendorSubscriptions.founderPriceEndsAt), lte(vendorSubscriptions.founderPriceEndsAt, now)),
    ))
    .limit(limit);
}

/** Reconcile every subscription whose deadline has passed. Safe to re-run. */
export async function reconcileDueSubscriptions(params: { now?: Date; limit?: number } = {}) {
  const now = params.now ?? new Date();
  const due = await findSubscriptionsNeedingReconciliation(now, params.limit ?? 200);
  const results: { userId: number; outcome: LifecycleOutcome['outcome']; lifecycleState: LifecycleState }[] = [];
  for (const row of due) {
    const result = await reconcileSubscription({ userId: row.userId, source: 'system', now });
    results.push({ userId: row.userId, outcome: result.outcome, lifecycleState: result.lifecycleState });
  }
  return { scanned: due.length, results };
}

// ── Read model ─────────────────────────────────────────────────────────────

/**
 * The lifecycle view Phase 4B.4 §14 asks to be *prepared* for a future admin
 * billing surface. Contains no provider handle, no price reference, and no
 * credential of any kind - there is nothing of that sort in BuildHub to leak.
 */
export async function getLifecycleSnapshot(userId: number, now: Date = new Date()) {
  const [subscription, offerEndsAt] = await Promise.all([
    getSubscription(userId),
    getFounderOfferEndsAt(),
  ]);
  const state = deriveBillingState(subscription, now);
  return {
    userId,
    lifecycleState: lifecycleStateOf(state),
    effectivePlan: state.effectivePlan,
    storedPlan: state.storedPlan,
    status: state.status,
    isPaid: state.isPaid,
    inTrial: state.inTrial,
    trialEndsAt: state.trialEndsAt,
    currentPeriodEnd: state.currentPeriodEnd,
    billingInterval: state.billingInterval,
    cancelAtPeriodEnd: state.cancelAtPeriodEnd,
    canceledAt: subscription?.canceledAt ?? null,
    inGracePeriod: state.inGracePeriod,
    gracePeriodEndsAt: state.gracePeriodEndsAt,
    awaitingRenewalSync: state.awaitingRenewalSync,
    reconciliationRequired: state.reconciliationRequired,
    dataIntegrityIssue: state.dataIntegrityIssue,
    founderPriceActive: state.founderPriceActive,
    founderPriceEndsAt: state.founderPriceEndsAt,
    founderOfferUsed: subscription?.founderPriceUsedAt !== null && subscription?.founderPriceUsedAt !== undefined,
    founderEligible: isFounderEligible(subscription, offerEndsAt, now),
    entitlements: state.entitlements,
    qualifiedEnquiryAllowance: state.entitlements.qualifiedEnquiriesPerMonth,
  };
}
