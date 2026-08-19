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
import { getDb } from '../db';
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
  const db = await getDb();
  if (!db) return null;
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
  const db = await getDb();
  if (!db) return null;
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
}

/**
 * Apply a domain-produced patch to a vendor's subscription row, creating the
 * row on first use, and record the transition in the audit trail.
 *
 * Patches only ever come from domain.ts's transition functions - this is
 * intentionally not a general-purpose "set any field" writer, so there is no
 * path by which an arbitrary caller could write a plan or price of its own
 * choosing.
 */
export async function applySubscriptionPatch(params: {
  userId: number;
  patch: SubscriptionPatch;
  action: string;
  source?: BillingEventInput['source'];
  actorId?: number | null;
  note?: string | null;
}): Promise<VendorSubscription | null> {
  const db = await getDb();
  if (!db) return null;

  const existing = await getSubscription(params.userId);
  const fromStatus = existing?.status ?? null;

  if (existing) {
    await db
      .update(vendorSubscriptions)
      .set(params.patch)
      .where(eq(vendorSubscriptions.id, existing.id));
  } else {
    await db.insert(vendorSubscriptions).values({
      userId: params.userId,
      ...params.patch,
    });
  }

  const updated = await getSubscription(params.userId);
  await recordBillingEvent({
    userId: params.userId,
    subscriptionId: updated?.id ?? null,
    action: params.action,
    fromStatus,
    toStatus: updated?.status ?? null,
    source: params.source,
    actorId: params.actorId,
    note: params.note,
  });
  return updated;
}

export async function getBillingEvents(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.userId, userId))
    .orderBy(desc(billingEvents.createdAt))
    .limit(limit);
}
