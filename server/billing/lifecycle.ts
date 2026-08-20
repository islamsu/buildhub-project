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
import { isFounderPriceAvailable, isPlanId, type BillingInterval, type PlanId } from '@shared/billing';
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

export type LifecycleOutcome =
  /** State changed and was persisted. */
  | { outcome: 'applied'; action: string; state: BillingState; lifecycleState: LifecycleState }
  /** Already in the requested state. Safe repeat - nothing written. */
  | { outcome: 'noop'; action: string; reason: string; state: BillingState; lifecycleState: LifecycleState }
  /** The transition is not legal from the current state. Nothing written. */
  | { outcome: 'rejected'; action: string; reason: string; state: BillingState; lifecycleState: LifecycleState };

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

  if (settled.reject) {
    const { state, lifecycleState } = describe(before, now);
    return { outcome: 'rejected', action, reason: settled.reject, state, lifecycleState };
  }
  if (!settled.patch) {
    const { state, lifecycleState } = describe(before, now);
    return { outcome: 'noop', action, reason: 'Already in the requested state.', state, lifecycleState };
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
    note: `${before.plan} → ${after?.plan ?? '?'} · ${lifecycleStateOf(deriveBillingState(before, now))} → ${lifecycleState}`,
  });

  return { outcome: 'applied', action, state, lifecycleState };
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
