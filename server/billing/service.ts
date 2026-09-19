// ── Billing Service (Phase 4B.1) ───────────────────────────────────────────
// The only layer that reads or writes billing tables. Pure lifecycle rules
// live in domain.ts; the provider seam is provider.ts. Nothing here talks to a
// payment provider.
//
// Every function is keyed by a server-derived userId. No function accepts a
// plan, price, status, or entitlement from a caller-supplied payload - the
// commercial values come from shared/billing.ts and the state transitions come
// from domain.ts, so there is no request shape that could upgrade a vendor.

import { desc, eq } from 'drizzle-orm';
import { FOUNDER_OFFER_ENDS_AT_SETTING_KEY } from '@shared/billing';
import { adminSettings, billingEvents, vendorSubscriptions, type VendorSubscription } from '../../drizzle/schema';
import { recordEventAsync } from '../analytics/events';
import { ANALYTICS_EVENTS, type AnalyticsEventType } from '@shared/analyticsEvents';
import { getDb } from '../db';
import { requireDb } from '../_core/requireDb';
import { deriveBillingState, isFounderEligible, type BillingState, type SubscriptionPatch } from './domain';

/** Columns exposed to a vendor about their OWN subscription. */
export const VENDOR_SUBSCRIPTION_COLUMNS = {
  plan: vendorSubscriptions.plan,
  status: vendorSubscriptions.status,
  billingInterval: vendorSubscriptions.billingInterval,
  currency: vendorSubscriptions.currency,
  priceAmount: vendorSubscriptions.priceAmount,
  isFounderPrice: vendorSubscriptions.isFounderPrice,
  founderPriceEndsAt: vendorSubscriptions.founderPriceEndsAt,
  trialEndsAt: vendorSubscriptions.trialEndsAt,
  currentPeriodStart: vendorSubscriptions.currentPeriodStart,
  currentPeriodEnd: vendorSubscriptions.currentPeriodEnd,
  cancelAtPeriodEnd: vendorSubscriptions.cancelAtPeriodEnd,
  canceledAt: vendorSubscriptions.canceledAt,
  gracePeriodEndsAt: vendorSubscriptions.gracePeriodEndsAt,
} as const;

/**
 * SECURITY: the columns an administrator may see. Deliberately EXCLUDES every
 * providerCustomerRef / providerSubscriptionRef / providerPriceRef - opaque
 * provider handles have no administrative value and are needless exposure.
 * BuildHub never stores card data, tokens, or provider credentials anywhere,
 * so there is nothing of that kind to leak here by construction. Same explicit
 * allowlist discipline as ADMIN_USER_LIST_COLUMNS / COMPLIANCE_APPLICANT_COLUMNS
 * (Phase 4A): adding a column to the table does NOT expose it to admins.
 */
export const ADMIN_SUBSCRIPTION_COLUMNS = {
  userId: vendorSubscriptions.userId,
  plan: vendorSubscriptions.plan,
  status: vendorSubscriptions.status,
  billingInterval: vendorSubscriptions.billingInterval,
  currency: vendorSubscriptions.currency,
  priceAmount: vendorSubscriptions.priceAmount,
  isFounderPrice: vendorSubscriptions.isFounderPrice,
  founderPriceUsedAt: vendorSubscriptions.founderPriceUsedAt,
  founderPriceEndsAt: vendorSubscriptions.founderPriceEndsAt,
  trialEndsAt: vendorSubscriptions.trialEndsAt,
  currentPeriodStart: vendorSubscriptions.currentPeriodStart,
  currentPeriodEnd: vendorSubscriptions.currentPeriodEnd,
  cancelAtPeriodEnd: vendorSubscriptions.cancelAtPeriodEnd,
  canceledAt: vendorSubscriptions.canceledAt,
  gracePeriodEndsAt: vendorSubscriptions.gracePeriodEndsAt,
  provider: vendorSubscriptions.provider,
  createdAt: vendorSubscriptions.createdAt,
  updatedAt: vendorSubscriptions.updatedAt,
} as const;

export async function getSubscription(userId: number): Promise<VendorSubscription | null> {
  /*
   * `null` HERE MEANS "THIS VENDOR HAS NO SUBSCRIPTION", which every caller
   * reads as the free plan. Returning it for an unreachable database silently
   * downgrades a paying vendor - their entitlements shrink, their allowance
   * drops, and nothing anywhere says why.
   *
   * It fails toward LESS access, which is the safer direction, and it is still
   * a false statement about a commercial relationship.
   */
  const db = await requireDb();
  const rows = await db
    .select()
    .from(vendorSubscriptions)
    .where(eq(vendorSubscriptions.userId, userId))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * THE server-authoritative entitlement lookup. Every plan-gated check in
 * BuildHub must go through this - never a client-supplied plan, never a value
 * cached in a session token. Fails closed to FREE when the database is
 * unavailable: an outage must never hand out paid entitlements, and FREE
 * itself needs no subscription row to work.
 */
export async function getBillingState(userId: number, now: Date = new Date()): Promise<BillingState> {
  const subscription = await getSubscription(userId);
  return deriveBillingState(subscription, now);
}

/** The founder-offer cut-off, read from the runtime-configurable admin setting. */
export async function getFounderOfferEndsAt(): Promise<Date | null> {
  // Same shape, same rule: `null` means "there is no founder offer", which is
  // a statement about what BuildHub is currently selling.
  const db = await requireDb();
  const rows = await db
    .select({ value: adminSettings.value })
    .from(adminSettings)
    .where(eq(adminSettings.settingKey, FOUNDER_OFFER_ENDS_AT_SETTING_KEY))
    .limit(1);
  const raw = rows[0]?.value?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Whether a vendor may be sold founder pricing right now. Server-side only. */
export async function checkFounderEligibility(userId: number, now: Date = new Date()): Promise<boolean> {
  const [subscription, offerEndsAt] = await Promise.all([
    getSubscription(userId),
    getFounderOfferEndsAt(),
  ]);
  return isFounderEligible(subscription, offerEndsAt, now);
}

export type BillingEventInput = {
  userId: number;
  subscriptionId?: number | null;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  source?: 'system' | 'provider' | 'admin' | 'vendor';
  actorId?: number | null;
  note?: string | null;
};

/**
 * Append to the billing audit trail. Best-effort in the same spirit as
 * notifyUser: a failure to write history is logged, never thrown, so it can
 * never roll back or block the commercial state change it describes.
 */
export async function recordBillingEvent(event: BillingEventInput): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(billingEvents).values({
      userId: event.userId,
      subscriptionId: event.subscriptionId ?? null,
      action: event.action,
      fromStatus: event.fromStatus ?? null,
      toStatus: event.toStatus ?? null,
      source: event.source ?? 'system',
      actorId: event.actorId ?? null,
      note: event.note ?? null,
    });
  } catch (error) {
    console.warn('[Billing] Failed to write billing event:', error);
  }

  // Slice 7: mirror the transition into the product analytics stream.
  //
  // Done HERE rather than at the eight lifecycle call sites, because this
  // function is already the single choke point every commercial transition
  // passes through - instrumenting the call sites instead would mean eight
  // places to forget, and the funnel would quietly develop holes.
  //
  // The analytics row is a description of the transition, never the record of
  // it: `billingEvents` above stays the audit trail, and revenue is computed
  // from `vendorSubscriptions`, not from either log.
  recordEventAsync({
    type: analyticsEventFor(event),
    userId: event.userId,
    subjectType: 'subscription',
    subjectId: event.subscriptionId ?? null,
    metadata: {
      action: event.action,
      from: event.fromStatus ?? undefined,
      to: event.toStatus ?? undefined,
      source: event.source ?? 'system',
    },
  });
}

/** Statuses that mean the vendor is paying, for deciding what a transition was. */
const PAID_STATUSES = new Set(['active', 'past_due']);
const ENDED_STATUSES = new Set(['canceled', 'expired', 'free']);

/**
 * Translate a billing action into the analytics vocabulary.
 *
 * Two actions are ambiguous on their name alone and are resolved from the
 * transition itself:
 *
 *  - `subscription_activated` fires both on a first payment and on every
 *    renewal. Coming from an already-active status makes it a renewal, and
 *    conflating the two would make first-purchase counts meaningless.
 *  - `lifecycle_reconciled` is the sweep. It only counts as a lapse when it
 *    actually moved a paying subscription to an ended state; most of the time
 *    it changes nothing that matters commercially.
 */
export function analyticsEventFor(event: BillingEventInput): AnalyticsEventType {
  const from = event.fromStatus ?? '';
  const to = event.toStatus ?? '';

  switch (event.action) {
    case 'trial_started':
      return ANALYTICS_EVENTS.SUBSCRIPTION_TRIAL_STARTED;
    case 'subscription_activated':
      return PAID_STATUSES.has(from)
        ? ANALYTICS_EVENTS.SUBSCRIPTION_RENEWED
        : ANALYTICS_EVENTS.SUBSCRIPTION_ACTIVATED;
    case 'cancellation_requested':
      return ANALYTICS_EVENTS.SUBSCRIPTION_CANCELLATION_SCHEDULED;
    case 'cancellation_reversed':
      return ANALYTICS_EVENTS.SUBSCRIPTION_RESUMED;
    case 'plan_changed':
    // A SUPER ADMIN MANUAL CHANGE IS A PLAN CHANGE, and must be named as one.
    //
    // Without this case it fell to `default`, which reads a transition out of
    // FREE into a paid status as a RENEWAL - so every comped plan an
    // administrator granted would have been counted in the renewal KPI as
    // revenue that nobody paid. The metadata still carries
    // `action: 'plan_changed_manually'` and `source: 'admin'`, so an analyst
    // can separate a manual grant from a purchased change; what they must not
    // be given is a renewal that did not happen.
    case 'plan_changed_manually':
      return ANALYTICS_EVENTS.SUBSCRIPTION_PLAN_CHANGED;
    case 'payment_failed':
      return ANALYTICS_EVENTS.SUBSCRIPTION_PAYMENT_FAILED;
    case 'payment_recovered':
      return ANALYTICS_EVENTS.SUBSCRIPTION_PAYMENT_RECOVERED;
    case 'lifecycle_reconciled':
    default:
      return PAID_STATUSES.has(from) && ENDED_STATUSES.has(to)
        ? ANALYTICS_EVENTS.SUBSCRIPTION_LAPSED
        : ANALYTICS_EVENTS.SUBSCRIPTION_RENEWED;
  }
}

/*
 * `applySubscriptionPatch` WAS HERE, AND IT WAS REMOVED RATHER THAN REPAIRED.
 *
 * It was the last entry on the outage-honesty debt list: an unreachable
 * database made it answer `null`, so a subscription change silently did not
 * happen - neither fail-open nor fail-closed but fail-silent, which is the
 * worst of the three on a commercial mutation.
 *
 * Repairing it would have preserved the wrong thing. NOTHING CALLED IT. The
 * real write path is `billing/lifecycle.ts`, which does the same job inside a
 * TRANSACTION with the subscription row LOCKED - `SELECT ... FOR UPDATE`, then
 * a domain decision, then the update - so two concurrent lifecycle actions on
 * one vendor cannot interleave. This function took no lock. Keeping a second,
 * weaker writer for the same table, reachable by import, is how the careful
 * path gets bypassed later by somebody reaching for the obvious name.
 *
 * `billingAuthorization.test.ts` asserted that "the only writes to
 * vendorSubscriptions go through applySubscriptionPatch", which was not true
 * when it was written - lifecycle.ts has always written directly. The
 * assertion it carried is still right and still passes; the sentence
 * explaining it was wrong, and now names the real path.
 */

export async function getBillingEvents(userId: number, limit = 50) {
  // A vendor's billing history, reported as never having happened.
  const db = await requireDb();
  return db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.userId, userId))
    .orderBy(desc(billingEvents.createdAt))
    .limit(limit);
}
