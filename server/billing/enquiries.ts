// ── RFQ Targeting & Qualified-Enquiry Engine (Phase 4B.3) ──────────────────
// Three deliberately separate concepts, never conflated:
//
//   ELIGIBILITY  - does this RFQ's category match one the vendor declared?
//                  Pure, deterministic, no scoring, no inference, no AI.
//   ENTITLEMENT  - how many qualified enquiries may this vendor consume this
//                  month? Answered ONLY by the Phase 4B.2 resolver.
//   CONSUMPTION  - the vendor opened an eligible RFQ's full detail, which
//                  spends exactly one credit, once, ever, for that RFQ.
//
// Visibility, paid placement, verification and reviews are none of these and
// appear nowhere in this file.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { isClassifiableRfqCategory } from '@shared/rfqCategories';
import { qualifiedEnquiries, rfqs, vendorCategories, type Rfq } from '../../drizzle/schema';
import { getDb } from '../db';
import { allowancePeriodFor, resolveVendorEntitlements } from './entitlements';
import { recordEventAsync } from '../analytics/events';
import { ANALYTICS_EVENTS } from '@shared/analyticsEvents';

/** MySQL duplicate-key error, surfaced by mysql2 through drizzle's `cause`. */
function isDuplicateKeyError(error: unknown): boolean {
  const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code
    ?? (error as { code?: string })?.code;
  return code === 'ER_DUP_ENTRY';
}

export async function getVendorCategories(userId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ category: vendorCategories.category })
    .from(vendorCategories)
    .where(eq(vendorCategories.userId, userId));
  return rows.map(row => row.category);
}

/**
 * Deterministic OR match: eligible when the RFQ's category is one the vendor
 * declared. Exact string equality on the shared taxonomy - no fuzzy matching,
 * no role inference, no scoring.
 *
 * An unclassifiable RFQ (null, empty, or a value outside the taxonomy) is
 * eligible for NOBODY - see isClassifiableRfqCategory for why that fallback is
 * the conservative one.
 */
export function isVendorEligibleForCategory(
  vendorCategoriesList: readonly string[],
  rfqCategory: string | null | undefined,
): boolean {
  if (!isClassifiableRfqCategory(rfqCategory)) return false;
  return vendorCategoriesList.includes(rfqCategory);
}

export type EnquiryUsage = {
  /** Credits consumed in the current UTC month. */
  used: number;
  /** null = unlimited (PREMIUM). */
  allowance: number | null;
  /** null = unlimited. Never negative. */
  remaining: number | null;
  limitReached: boolean;
  periodKey: string;
  resetsAt: Date;
};

async function countUsage(userId: number, yearMonth: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(qualifiedEnquiries)
    .where(and(eq(qualifiedEnquiries.userId, userId), eq(qualifiedEnquiries.yearMonth, yearMonth)));
  return Number(row?.count ?? 0);
}

/** Current usage against the vendor's live entitlement. Read-only. */
export async function getEnquiryUsage(userId: number, now: Date = new Date()): Promise<EnquiryUsage> {
  const resolution = await resolveVendorEntitlements(userId, now);
  const period = allowancePeriodFor(now);
  const used = await countUsage(userId, period.key);
  const allowance = resolution.qualifiedEnquiryAllowance;
  return {
    used,
    allowance,
    remaining: allowance === null ? null : Math.max(0, allowance - used),
    limitReached: allowance !== null && used >= allowance,
    periodKey: period.key,
    resetsAt: period.resetsAt,
  };
}

export type OpenEnquiryResult =
  | { outcome: 'granted'; rfq: Rfq; alreadyConsumed: boolean; usage: EnquiryUsage }
  | { outcome: 'not_found' }
  | { outcome: 'not_eligible'; reason: 'unclassified_rfq' | 'category_mismatch' }
  | { outcome: 'limit_reached'; usage: EnquiryUsage };

/**
 * Open the full detail of an RFQ as a vendor, consuming one qualified-enquiry
 * credit if this is the first time.
 *
 * Every decision is made server-side from the authenticated `userId`: the
 * vendor's declared categories, the RFQ's category, and the billing
 * entitlement are all re-read here. Nothing about eligibility, plan, or
 * allowance is accepted from the caller - the only input is which RFQ to open.
 *
 * CONCURRENCY (Phase 4B.3 §8). Two distinct races are defended against, both
 * at the database level rather than in application logic:
 *
 *  1. Same vendor + same RFQ (refresh, second tab, duplicate request, retry).
 *     Guarded by UNIQUE(userId, rfqId). A losing concurrent insert raises
 *     ER_DUP_ENTRY, which is caught and treated as "already consumed" - access
 *     is granted and no second credit is spent.
 *
 *  2. Same vendor + several different unseen RFQs at once, which a naive
 *     count-then-insert would let exceed the allowance. Guarded by performing
 *     the count and the insert inside one transaction, where the count is a
 *     `SELECT ... FOR UPDATE` over the (userId, yearMonth) index range. In
 *     InnoDB's REPEATABLE READ this takes next-key/gap locks across that
 *     range, so a concurrent transaction for the same vendor and month blocks
 *     until this one commits and then re-reads the true count. The check and
 *     the insert are therefore serialised per vendor-month, and the allowance
 *     cannot be exceeded no matter how many requests arrive simultaneously.
 *     Locking is scoped to one vendor's own month, so vendors never contend
 *     with each other.
 */
export async function openQualifiedEnquiry(
  userId: number,
  rfqId: number,
  now: Date = new Date(),
): Promise<OpenEnquiryResult> {
  const db = await getDb();
  if (!db) return { outcome: 'not_found' };

  const [rfq] = await db.select().from(rfqs).where(eq(rfqs.id, rfqId)).limit(1);
  if (!rfq) return { outcome: 'not_found' };

  // Eligibility, decided server-side from stored state only.
  if (!isClassifiableRfqCategory(rfq.category)) {
    return { outcome: 'not_eligible', reason: 'unclassified_rfq' };
  }
  const declared = await getVendorCategories(userId);
  if (!isVendorEligibleForCategory(declared, rfq.category)) {
    return { outcome: 'not_eligible', reason: 'category_mismatch' };
  }

  const period = allowancePeriodFor(now);
  const resolution = await resolveVendorEntitlements(userId, now);
  const allowance = resolution.qualifiedEnquiryAllowance;

  // Already consumed? Grant immediately without touching the allowance. This
  // fast path keeps the common case (re-opening a lead) cheap and lock-free.
  const [existing] = await db
    .select({ id: qualifiedEnquiries.id })
    .from(qualifiedEnquiries)
    .where(and(eq(qualifiedEnquiries.userId, userId), eq(qualifiedEnquiries.rfqId, rfqId)))
    .limit(1);
  if (existing) {
    return { outcome: 'granted', rfq, alreadyConsumed: true, usage: await getEnquiryUsage(userId, now) };
  }

  let limitReached = false;
  let duplicate = false;

  try {
    await db.transaction(async tx => {
      if (allowance !== null) {
        // Range lock over this vendor's rows for this month (see doc above).
        const locked = await tx
          .select({ id: qualifiedEnquiries.id })
          .from(qualifiedEnquiries)
          .where(and(eq(qualifiedEnquiries.userId, userId), eq(qualifiedEnquiries.yearMonth, period.key)))
          .for('update');
        if (locked.length >= allowance) {
          limitReached = true;
          return;
        }
      }
      await tx.insert(qualifiedEnquiries).values({
        userId,
        rfqId,
        yearMonth: period.key,
        planAtConsumption: resolution.effectivePlan,
        matchedCategory: rfq.category,
      });
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    // Lost a race against ourselves for the same RFQ - already consumed.
    duplicate = true;
  }

  if (limitReached) {
    // The single clearest upgrade signal the product produces: a vendor who
    // wanted an enquiry their plan would not give them. Recorded so the owner
    // can see demand for the next tier rather than infer it.
    recordEventAsync({
      type: ANALYTICS_EVENTS.ENQUIRY_LIMIT_REACHED,
      userId,
      subjectType: 'rfq',
      subjectId: rfqId,
      plan: resolution.effectivePlan,
    });
    return { outcome: 'limit_reached', usage: await getEnquiryUsage(userId, now) };
  }
  if (!duplicate) {
    recordEventAsync({
      type: ANALYTICS_EVENTS.ENQUIRY_OPENED,
      userId,
      subjectType: 'rfq',
      subjectId: rfqId,
      plan: resolution.effectivePlan,
      metadata: { category: rfq.category ?? undefined },
    });
  }
  return {
    outcome: 'granted',
    rfq,
    alreadyConsumed: duplicate,
    usage: await getEnquiryUsage(userId, now),
  };
}

/**
 * RFQs this vendor is eligible for. Pure targeting - listing costs nothing and
 * consumes no credit; only opening an RFQ's detail does. `alreadyOpened` lets
 * the UI show which leads are already paid for.
 */
export async function listEligibleRfqs(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  const declared = await getVendorCategories(userId);
  if (declared.length === 0) return [];

  const rows = await db
    .select({
      id: rfqs.id,
      title: rfqs.title,
      category: rfqs.category,
      location: rfqs.location,
      budget: rfqs.budget,
      deadline: rfqs.deadline,
      status: rfqs.status,
      createdAt: rfqs.createdAt,
    })
    .from(rfqs)
    .where(and(eq(rfqs.status, 'open'), inArray(rfqs.category, declared)))
    .orderBy(sql`${rfqs.createdAt} desc`)
    .limit(limit);

  if (rows.length === 0) return [];
  const opened = await db
    .select({ rfqId: qualifiedEnquiries.rfqId })
    .from(qualifiedEnquiries)
    .where(and(eq(qualifiedEnquiries.userId, userId), inArray(qualifiedEnquiries.rfqId, rows.map(r => r.id))));
  const openedSet = new Set(opened.map(o => o.rfqId));

  return rows.map(row => ({ ...row, alreadyOpened: openedSet.has(row.id) }));
}
