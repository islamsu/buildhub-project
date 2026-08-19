// ── Billing Domain (Phase 4B.1) ────────────────────────────────────────────
// Pure, provider-agnostic lifecycle logic. No database access, no network, no
// provider SDK - every function here is a total function of its inputs, which
// is what makes the whole commercial lifecycle exhaustively testable without a
// payment provider existing yet.
//
// The DB-facing layer is service.ts; the provider seam is provider.ts.

import {
  BILLING_CURRENCY,
  DEFAULT_PLAN_ID,
  FOUNDER_OFFER_MONTHS,
  GRACE_PERIOD_DAYS,
  TRIAL_DAYS,
  getEntitlements,
  resolvePrice,
  type BillingInterval,
  type PlanEntitlements,
  type PlanId,
} from '@shared/billing';
import type { VendorSubscription } from '../../drizzle/schema';

export type SubscriptionStatus = VendorSubscription['status'];

/**
 * What a vendor is ACTUALLY entitled to right now.
 *
 * Deliberately derived from stored state *and the current time*, never from
 * the stored status alone. If a scheduled lifecycle sweep is late, fails, or
 * never runs, a lapsed trial or an expired grace period still resolves to FREE
 * here - entitlements can never be over-granted because a background job did
 * not fire. The sweep persists what this function already computes; it is not
 * what makes it true.
 */
export type BillingState = {
  /** The plan whose entitlements actually apply right now. */
  effectivePlan: PlanId;
  /** The plan the vendor is nominally subscribed to (may differ from effectivePlan when lapsed). */
  storedPlan: PlanId;
  status: SubscriptionStatus;
  entitlements: PlanEntitlements;
  isPaid: boolean;
  inTrial: boolean;
  trialEndsAt: Date | null;
  inGracePeriod: boolean;
  gracePeriodEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  billingInterval: 'month' | 'year' | null;
  /**
   * Set when a paid status is missing the timestamp that governs it (e.g. a
   * `trialing` row with no `trialEndsAt`). Such a row is malformed: every
   * domain transition always writes the governing timestamp, so this can only
   * arise from corrupt data - a manual edit, a partial write, or a future
   * provider-sync bug. The state fails CLOSED to FREE and reports the problem
   * here rather than granting unbounded paid access off bad data.
   */
  dataIntegrityIssue: string | null;
  /** True when the founder discount is currently applied to this subscription. */
  founderPriceActive: boolean;
  founderPriceEndsAt: Date | null;
  /**
   * True when the stored state says 'active' but the billing period has already
   * elapsed and no cancellation was requested - i.e. a renewal we have not yet
   * heard about. Entitlements are intentionally retained (a provider sync gap
   * must not punish a paying vendor), and reconciliation belongs to the
   * provider integration (Phase 4B.5). No downgrade deadline is invented here.
   */
  awaitingRenewalSync: boolean;
};

const FREE_STATE: BillingState = {
  effectivePlan: DEFAULT_PLAN_ID,
  storedPlan: DEFAULT_PLAN_ID,
  status: 'free',
  entitlements: getEntitlements(DEFAULT_PLAN_ID),
  isPaid: false,
  inTrial: false,
  trialEndsAt: null,
  inGracePeriod: false,
  gracePeriodEndsAt: null,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  billingInterval: null,
  dataIntegrityIssue: null,
  founderPriceActive: false,
  founderPriceEndsAt: null,
  awaitingRenewalSync: false,
};

function elapsed(at: Date | null, now: Date): boolean {
  return at !== null && now.getTime() >= at.getTime();
}

/** The single server-authoritative answer to "what is this vendor entitled to?". */
export function deriveBillingState(
  subscription: VendorSubscription | null | undefined,
  now: Date = new Date(),
): BillingState {
  if (!subscription) return { ...FREE_STATE };

  const storedPlan = subscription.plan as PlanId;
  const status = subscription.status;
  const founderPriceActive =
    subscription.isFounderPrice && !elapsed(subscription.founderPriceEndsAt, now);

  const base = {
    storedPlan,
    status,
    trialEndsAt: subscription.trialEndsAt,
    gracePeriodEndsAt: subscription.gracePeriodEndsAt,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd,
    billingInterval: subscription.billingInterval,
    founderPriceEndsAt: subscription.founderPriceEndsAt,
  };

  const grant = (extra: Partial<BillingState> = {}): BillingState => ({
    ...FREE_STATE,
    ...base,
    effectivePlan: storedPlan,
    entitlements: getEntitlements(storedPlan),
    isPaid: true,
    ...extra,
  });

  const lapse = (extra: Partial<BillingState> = {}): BillingState => ({
    ...FREE_STATE,
    ...base,
    effectivePlan: DEFAULT_PLAN_ID,
    entitlements: getEntitlements(DEFAULT_PLAN_ID),
    isPaid: false,
    founderPriceActive: false,
    ...extra,
  });

  // Phase 4B.2 hardening: a paid status whose governing timestamp is missing is
  // malformed data, not a valid entitlement. Every transition in this module
  // writes that timestamp, so this is unreachable through normal flow and can
  // only mean corruption - which must fail closed, never grant paid access
  // indefinitely off a row nothing can ever expire.
  const malformed = (field: string): BillingState =>
    lapse({ dataIntegrityIssue: `status "${status}" without ${field}` });

  switch (status) {
    case 'free':
    case 'canceled':
    case 'expired':
      return lapse();

    case 'trialing':
      if (subscription.trialEndsAt === null) return malformed('trialEndsAt');
      // A lapsed trial grants nothing, even before a sweep records it.
      return elapsed(subscription.trialEndsAt, now)
        ? lapse()
        : grant({ inTrial: true, founderPriceActive });

    case 'active':
      if (subscription.currentPeriodEnd === null) return malformed('currentPeriodEnd');
      if (elapsed(subscription.currentPeriodEnd, now)) {
        // Cancellation requested and the paid-for period is over: downgrade.
        if (subscription.cancelAtPeriodEnd) return lapse();
        // Otherwise this is a provider sync gap, not a lapse - keep access.
        return grant({ founderPriceActive, awaitingRenewalSync: true });
      }
      return grant({ founderPriceActive });

    case 'past_due':
      if (subscription.gracePeriodEndsAt === null) return malformed('gracePeriodEndsAt');
      // Approved policy: paid entitlements are retained through the grace
      // window, and only removed once it has fully elapsed.
      return elapsed(subscription.gracePeriodEndsAt, now)
        ? lapse()
        : grant({ inGracePeriod: true, founderPriceActive });

    default:
      return lapse({ dataIntegrityIssue: `unrecognised status "${status}"` });
  }
}

export function addDays(from: Date, days: number): Date {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addMonths(from: Date, months: number): Date {
  const next = new Date(from.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export function periodEndFor(start: Date, interval: BillingInterval): Date {
  return interval === 'year' ? addMonths(start, 12) : addMonths(start, 1);
}

/**
 * Founder eligibility. Requires an open offer window AND a vendor who has
 * never used the offer before - `founderPriceUsedAt` is write-once, so a
 * cancel-and-resubscribe cycle can never re-award it, and an already-
 * subscribed vendor is never granted it retroactively (eligibility is only
 * ever evaluated when a new paid subscription starts).
 */
export function isFounderEligible(
  subscription: VendorSubscription | null | undefined,
  offerEndsAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!offerEndsAt) return false;
  if (now.getTime() >= offerEndsAt.getTime()) return false;
  if (subscription?.founderPriceUsedAt) return false;
  return true;
}

/** Field patches produced by lifecycle transitions, applied by service.ts. */
export type SubscriptionPatch = Partial<{
  plan: PlanId;
  status: SubscriptionStatus;
  billingInterval: BillingInterval | null;
  currency: string;
  priceAmount: string | null;
  isFounderPrice: boolean;
  founderPriceUsedAt: Date | null;
  founderPriceEndsAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  gracePeriodEndsAt: Date | null;
}>;

export class BillingDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingDomainError';
  }
}

/**
 * Begin a 30-day trial of a paid plan. Price is resolved server-side from the
 * catalogue - a caller cannot supply one. A founder-priced combination that is
 * not an approved product (currently: any annual founder price) is rejected
 * rather than silently falling back to standard pricing, so an unapproved
 * commercial value can never be sold by accident.
 */
export function startTrial(params: {
  planId: PlanId;
  interval: BillingInterval;
  founder: boolean;
  now?: Date;
}): SubscriptionPatch {
  const { planId, interval, founder } = params;
  const now = params.now ?? new Date();

  const price = resolvePrice(planId, interval, founder);
  if (price === null) {
    throw new BillingDomainError(
      founder
        ? `No approved founder price exists for plan "${planId}" on the "${interval}" interval.`
        : `Plan "${planId}" is not sold on the "${interval}" interval.`,
    );
  }

  return {
    plan: planId,
    status: 'trialing',
    billingInterval: interval,
    currency: BILLING_CURRENCY,
    priceAmount: price.toFixed(2),
    isFounderPrice: founder,
    founderPriceUsedAt: founder ? now : null,
    founderPriceEndsAt: founder ? addMonths(now, FOUNDER_OFFER_MONTHS) : null,
    trialEndsAt: addDays(now, TRIAL_DAYS),
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    gracePeriodEndsAt: null,
  };
}

/** First successful payment, or a renewal. Clears any grace state. */
export function activate(params: {
  interval: BillingInterval;
  periodStart?: Date;
  now?: Date;
}): SubscriptionPatch {
  const now = params.now ?? new Date();
  const start = params.periodStart ?? now;
  return {
    status: 'active',
    currentPeriodStart: start,
    currentPeriodEnd: periodEndFor(start, params.interval),
    trialEndsAt: null,
    gracePeriodEndsAt: null,
  };
}

/** A renewal payment failed: enter the approved 7-day grace window. */
export function markPaymentFailed(now: Date = new Date()): SubscriptionPatch {
  return {
    status: 'past_due',
    gracePeriodEndsAt: addDays(now, GRACE_PERIOD_DAYS),
  };
}

/** Payment recovered inside the grace window. */
export function recoverPayment(params: {
  interval: BillingInterval;
  periodStart?: Date;
  now?: Date;
}): SubscriptionPatch {
  return activate(params);
}

/**
 * Vendor cancels. Approved policy: no future renewal, paid access continues to
 * the end of the already-paid period, downgrade afterwards. Nothing is removed
 * here and no vendor data is ever touched.
 */
export function cancelAtPeriodEnd(now: Date = new Date()): SubscriptionPatch {
  return { cancelAtPeriodEnd: true, canceledAt: now };
}

/**
 * Terminal downgrade to FREE - after a lapsed trial, a completed cancellation,
 * or an expired grace period. Clears commercial state only. Vendor profile,
 * reviews, portfolio, enquiries, quotations and history are untouched: this
 * function returns a patch for the subscription row and nothing else, and no
 * caller in the billing domain deletes business data.
 *
 * `founderPriceUsedAt` is deliberately NOT cleared - the founder offer stays
 * spent forever.
 */
export function downgradeToFree(reason: 'trial_expired' | 'canceled' | 'grace_expired'): SubscriptionPatch {
  return {
    plan: 'free',
    status: reason === 'canceled' ? 'canceled' : 'expired',
    billingInterval: null,
    priceAmount: null,
    isFounderPrice: false,
    founderPriceEndsAt: null,
    trialEndsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    gracePeriodEndsAt: null,
  };
}

/**
 * The founder window has elapsed: the same subscription continues at the
 * plan's standard price. Not a new subscription, not a second pricing model -
 * one row, repriced.
 */
export function expireFounderPrice(subscription: VendorSubscription): SubscriptionPatch {
  const planId = subscription.plan as PlanId;
  const interval = (subscription.billingInterval ?? 'month') as BillingInterval;
  const standard = resolvePrice(planId, interval, false);
  if (standard === null) {
    throw new BillingDomainError(
      `Cannot expire founder pricing: plan "${planId}" has no standard "${interval}" price.`,
    );
  }
  return {
    isFounderPrice: false,
    founderPriceEndsAt: null,
    priceAmount: standard.toFixed(2),
  };
}
