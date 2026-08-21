import { and, eq, gte, lt } from 'drizzle-orm';
import { getDb } from '../db';
import { billingEvents, users, vendorSubscriptions } from '../../drizzle/schema';
import { deriveBillingState } from '../billing/domain';
import { BILLING_CURRENCY, PLAN_IDS, resolvePrice, type PlanId } from '@shared/billing';

/**
 * ── Commercial KPIs (Slice 7) ──────────────────────────────────────────────
 *
 * MRR, ARR, ARPV and churn, computed from `vendorSubscriptions` - the financial
 * record - and priced from shared/billing.ts. Never from the analytics event
 * stream: an event stream can drop a write, and an owner reporting revenue to
 * an investor cannot be working from a log that is allowed to be lossy.
 *
 * Three properties this file is built around:
 *
 * 1. NOTHING IS HARDCODED. Every price comes from `resolvePrice`, including the
 *    founder discount. If a plan's price changes in shared/billing.ts, these
 *    numbers change with it and no line here needs editing.
 *
 * 2. TIME IS RESPECTED. Revenue counts a subscription only if
 *    `deriveBillingState` says it is paid RIGHT NOW. A row still marked
 *    `active` whose period ended last month is not revenue, and a lifecycle
 *    sweep that has not run yet must not be able to inflate MRR.
 *
 * 3. A TRIAL IS NOT REVENUE. Trialing vendors have paid nothing. They are
 *    counted and reported separately, because counting them as MRR is the most
 *    common way a subscription business lies to itself.
 */

/** Annual subscriptions are divided across twelve months to state MRR on one scale. */
const MONTHS_PER_YEAR = 12;

export type PlanBreakdownRow = {
  plan: PlanId;
  /** Subscriptions currently entitled to this plan, priced. */
  payingVendors: number;
  /** On this plan but inside a trial, so paying nothing yet. */
  trialingVendors: number;
  /** Monthly recurring revenue from this plan, in the billing currency. */
  mrr: number;
};

export type CommercialKpis = {
  currency: string;
  /** Monthly recurring revenue across all paying vendors. */
  mrr: number;
  /** MRR x 12. A run rate, not a forecast, and not a promise about next year. */
  arr: number;
  /** Average revenue per paying vendor. null when nobody is paying - never 0. */
  arpv: number | null;
  payingVendors: number;
  trialingVendors: number;
  /** Vendors in grace after a failed payment: revenue currently at risk. */
  atRiskVendors: number;
  /** Paid subscriptions with a cancellation already scheduled. */
  scheduledToCancel: number;
  freeVendors: number;
  byPlan: PlanBreakdownRow[];
  /**
   * How many subscriptions carry data the billing domain considers malformed.
   * Surfaced rather than hidden: these rows fail closed to FREE, so a non-zero
   * number here means someone is being under-served, not over-billed.
   */
  dataIntegrityIssues: number;
  /**
   * Founder-priced subscriptions currently active. They earn less per vendor by
   * design, so seeing them separately explains a lower ARPV.
   */
  founderPricedVendors: number;
};

/**
 * What one subscription contributes to MRR right now.
 *
 * Returns 0 for anything not currently paid - free, trialing, lapsed, or
 * malformed. Exported because the churn calculation and the tests both need to
 * agree with it exactly.
 */
export function monthlyRevenueOf(
  subscription: typeof vendorSubscriptions.$inferSelect,
  now: Date = new Date(),
): number {
  const state = deriveBillingState(subscription, now);
  // Not paid, or paid-but-in-trial: no money has changed hands.
  if (!state.isPaid || state.inTrial) return 0;
  if (state.dataIntegrityIssue) return 0;

  const interval = state.billingInterval ?? 'month';
  const price = resolvePrice(state.effectivePlan, interval, state.founderPriceActive);
  if (price === null) return 0;

  return interval === 'year' ? price / MONTHS_PER_YEAR : price;
}

export async function getCommercialKpis(
  options: { includeDummy?: boolean; now?: Date } = {},
): Promise<CommercialKpis> {
  const now = options.now ?? new Date();
  const empty: CommercialKpis = {
    currency: BILLING_CURRENCY,
    mrr: 0, arr: 0, arpv: null,
    payingVendors: 0, trialingVendors: 0, atRiskVendors: 0, scheduledToCancel: 0, freeVendors: 0,
    byPlan: PLAN_IDS.map(plan => ({ plan, payingVendors: 0, trialingVendors: 0, mrr: 0 })),
    dataIntegrityIssues: 0,
    founderPricedVendors: 0,
  };

  const db = await getDb();
  if (!db) return empty;

  const dummyIds = options.includeDummy
    ? new Set<number>()
    : new Set((await db.select({ id: users.id }).from(users).where(eq(users.isDummy, true))).map(row => row.id));

  const subscriptions = await db.select().from(vendorSubscriptions);

  const byPlan = new Map<PlanId, PlanBreakdownRow>(
    PLAN_IDS.map(plan => [plan, { plan, payingVendors: 0, trialingVendors: 0, mrr: 0 }]),
  );

  let mrr = 0;
  let payingVendors = 0;
  let trialingVendors = 0;
  let atRiskVendors = 0;
  let scheduledToCancel = 0;
  let freeVendors = 0;
  let dataIntegrityIssues = 0;
  let founderPricedVendors = 0;

  for (const subscription of subscriptions) {
    if (dummyIds.has(subscription.userId)) continue;

    const state = deriveBillingState(subscription, now);
    if (state.dataIntegrityIssue) dataIntegrityIssues++;

    const row = byPlan.get(state.effectivePlan)!;

    if (state.inTrial) {
      trialingVendors++;
      row.trialingVendors++;
      continue;
    }
    if (!state.isPaid) {
      freeVendors++;
      continue;
    }

    const revenue = monthlyRevenueOf(subscription, now);
    mrr += revenue;
    payingVendors++;
    row.payingVendors++;
    row.mrr += revenue;

    if (state.inGracePeriod) atRiskVendors++;
    if (state.cancelAtPeriodEnd) scheduledToCancel++;
    if (state.founderPriceActive) founderPricedVendors++;
  }

  const round = (value: number) => Math.round(value * 100) / 100;

  return {
    currency: BILLING_CURRENCY,
    mrr: round(mrr),
    arr: round(mrr * MONTHS_PER_YEAR),
    // null, not 0. "Average revenue per vendor is 0" reads as a business that
    // is failing; "there are no paying vendors yet" is what is actually true.
    arpv: payingVendors > 0 ? round(mrr / payingVendors) : null,
    payingVendors,
    trialingVendors,
    atRiskVendors,
    scheduledToCancel,
    freeVendors,
    byPlan: PLAN_IDS.map(plan => {
      const row = byPlan.get(plan)!;
      return { ...row, mrr: round(row.mrr) };
    }),
    dataIntegrityIssues,
    founderPricedVendors,
  };
}

export type ChurnWindow = {
  /** Inclusive start of the window. */
  from: Date;
  /** Exclusive end. */
  to: Date;
  /** Paid subscriptions that ended within the window. */
  churned: number;
  /** Paid subscriptions at the start of the window - the denominator. */
  atStart: number;
  /**
   * Churned / atStart, as a percentage. null when there were no paid
   * subscriptions to churn: a rate over a denominator of zero is not 0%, it is
   * undefined, and reporting 0% would look like perfect retention.
   */
  ratePercent: number | null;
};

/**
 * Churn over a window, counted from the billing audit trail.
 *
 * `billingEvents` is append-only and records every lifecycle transition with
 * its from/to status, so it can answer "what ended, and when" - which the
 * current subscriptions table cannot, because a row that lapsed and later
 * resubscribed looks identical to one that never left.
 *
 * A subscription counts as churned when a paid status transitioned to one that
 * is not paid. Trial expiry is NOT churn: nobody was paying, so nothing was
 * lost - it belongs in trial-conversion, which is a different question.
 */
export async function getChurn(
  options: { from: Date; to: Date; includeDummy?: boolean },
): Promise<ChurnWindow> {
  const db = await getDb();
  const base: ChurnWindow = { from: options.from, to: options.to, churned: 0, atStart: 0, ratePercent: null };
  if (!db) return base;

  const dummyIds = options.includeDummy
    ? new Set<number>()
    : new Set((await db.select({ id: users.id }).from(users).where(eq(users.isDummy, true))).map(row => row.id));

  const PAID_STATUSES = new Set(['active', 'past_due']);
  const ENDED_STATUSES = new Set(['canceled', 'expired', 'free']);

  const events = await db
    .select({
      userId: billingEvents.userId,
      fromStatus: billingEvents.fromStatus,
      toStatus: billingEvents.toStatus,
      createdAt: billingEvents.createdAt,
    })
    .from(billingEvents)
    .where(and(gte(billingEvents.createdAt, options.from), lt(billingEvents.createdAt, options.to)));

  const churnedUsers = new Set<number>();
  for (const event of events) {
    if (event.userId === null || dummyIds.has(event.userId)) continue;
    if (!event.fromStatus || !event.toStatus) continue;
    if (PAID_STATUSES.has(event.fromStatus) && ENDED_STATUSES.has(event.toStatus)) {
      churnedUsers.add(event.userId);
    }
  }

  // The denominator: subscriptions that were paid at the START of the window.
  // Evaluated with deriveBillingState at that instant, so the same
  // time-derived rule that governs entitlement governs the count.
  const subscriptions = await db.select().from(vendorSubscriptions);
  let atStart = 0;
  for (const subscription of subscriptions) {
    if (dummyIds.has(subscription.userId)) continue;
    const state = deriveBillingState(subscription, options.from);
    if (state.isPaid && !state.inTrial) atStart++;
  }

  // A vendor who churned inside the window was, by definition, paid at some
  // point in it; if the denominator missed them (their row has since been
  // reused or reset) they still belong in it.
  const denominator = Math.max(atStart, churnedUsers.size);

  return {
    from: options.from,
    to: options.to,
    churned: churnedUsers.size,
    atStart: denominator,
    ratePercent: denominator > 0 ? Math.round((churnedUsers.size / denominator) * 1000) / 10 : null,
  };
}
