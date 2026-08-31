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

import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { isClassifiableRfqCategory } from '@shared/rfqCategories';
import { qualifiedEnquiries, quotations, rfqs, vendorCategories, type Rfq } from '../../drizzle/schema';
import { getDb } from '../db';
import { allowancePeriodFor, resolveVendorEntitlements } from './entitlements';
import { recordEventAsync } from '../analytics/events';
import { hasOpenInvitation, invitedRfqIds, markInvitationViewed } from '../rfqInvitations';
import { ANALYTICS_EVENTS } from '@shared/analyticsEvents';

function mysqlErrorCode(error: unknown): string | undefined {
  return (error as { cause?: { code?: string }; code?: string })?.cause?.code
    ?? (error as { code?: string })?.code;
}

/** MySQL duplicate-key error, surfaced by mysql2 through drizzle's `cause`. */
function isDuplicateKeyError(error: unknown): boolean {
  return mysqlErrorCode(error) === 'ER_DUP_ENTRY';
}

/**
 * InnoDB refused to serialize two transactions and rolled one back.
 *
 * THIS IS NOT A DUPLICATE KEY, and treating it as an unexpected failure is
 * what made a double-click return HTTP 500 to a supplier.
 *
 * Two concurrent openEnquiry calls for the same vendor both take the range
 * lock over that vendor's rows for the month, then both insert. Whichever
 * ordering InnoDB sees, it can deadlock rather than queue - and it did,
 * reproducibly, under two genuinely parallel requests. The money was never at
 * risk: one transaction is rolled back whole, and the unique index on
 * (userId, rfqId) is the backstop. What was wrong is the ANSWER the loser got.
 *
 * A deadlock here always means "another transaction was doing this same thing
 * at the same moment", which is the same situation as the duplicate-key race
 * and deserves the same handling: look again, and report what is now true.
 */
function isSerializationFailure(error: unknown): boolean {
  const code = mysqlErrorCode(error);
  return code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT';
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

/**
 * Existing authority to prepare or submit a response to one RFQ.
 *
 * Reading the free marketplace summary is not this authority. A supplier must
 * either have opened the qualified enquiry, hold a live invitation, or already
 * own a quotation on the request (the last arm preserves idempotent retries
 * after an invitation advances to `responded`). This is deliberately read-only:
 * only openQualifiedEnquiry may consume an allowance.
 */
export async function getRfqResponseAccess(db: any, userId: number, rfqId: number): Promise<{
  canRespond: boolean;
  byInvitation: boolean;
  alreadyOpened: boolean;
  hasExistingQuotation: boolean;
}> {
  const byInvitation = await hasOpenInvitation(db, rfqId, userId);
  const [opened] = await db
    .select({ id: qualifiedEnquiries.id })
    .from(qualifiedEnquiries)
    .where(and(eq(qualifiedEnquiries.userId, userId), eq(qualifiedEnquiries.rfqId, rfqId)))
    .limit(1);
  const [existingQuotation] = await db
    .select({ id: quotations.id })
    .from(quotations)
    .where(and(eq(quotations.providerId, userId), eq(quotations.rfqId, rfqId)))
    .limit(1);
  const hasExistingQuotation = !!existingQuotation;
  return {
    canRespond: byInvitation || !!opened || hasExistingQuotation,
    byInvitation,
    alreadyOpened: byInvitation || !!opened,
    hasExistingQuotation,
  };
}

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
  | {
      outcome: 'granted';
      rfq: Rfq;
      alreadyConsumed: boolean;
      usage: EnquiryUsage;
      /**
       * The qualifiedEnquiries row this grant corresponds to - the billable
       * record itself, which is what a billing dispute is actually about.
       * Null only if the row could not be read back, which does not fail the
       * grant: the vendor has paid and must get their lead.
       */
      enquiryId: number | null;
      /**
       * True when this grant came from an INVITATION and therefore spent no
       * allowance. The caller must be able to tell the two apart: a screen
       * that says "1 of 20 enquiries used" after an exempt open would be
       * describing a charge that did not happen.
       */
      byInvitation?: boolean;
    }
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

  // ── INVITED SUPPLIERS TAKE A DIFFERENT ROUTE, AND IT IS SHORT ───────────
  //
  // Checked FIRST, before the category gate and before the allowance, because
  // both would otherwise refuse a supplier the customer explicitly asked for:
  //
  //   the category gate, because an invitation is the requester naming this
  //     firm - it is incoherent to let them invite someone the platform then
  //     refuses on a taxonomy the customer never saw;
  //   the allowance, because the owner's decision is that an invitation is
  //     exempt (see server/rfqInvitations.ts).
  //
  // NO `qualifiedEnquiries` ROW IS WRITTEN. Writing one "for consistency"
  // would make the vendor's usage say they consumed something they did not,
  // and a usage figure that is wrong is worse than one that is absent. The
  // invitation row carries the record instead - status and viewedAt - so the
  // event stays fully reconstructable without corrupting the meter.
  if (await hasOpenInvitation(db, rfqId, userId)) {
    await markInvitationViewed(db, rfqId, userId);
    return {
      outcome: 'granted',
      rfq,
      alreadyConsumed: false,
      byInvitation: true,
      usage: await getEnquiryUsage(userId, now),
      enquiryId: null,
    };
  }

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
    return {
      outcome: 'granted', rfq, alreadyConsumed: true,
      usage: await getEnquiryUsage(userId, now), enquiryId: existing.id,
    };
  }

  let limitReached = false;
  let duplicate = false;
  let enquiryId: number | null = null;

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
      const written = await tx.insert(qualifiedEnquiries).values({
        userId,
        rfqId,
        yearMonth: period.key,
        planAtConsumption: resolution.effectivePlan,
        matchedCategory: rfq.category,
      });
      // OPTIONAL CHAINING ALL THE WAY DOWN, deliberately. This runs INSIDE the
      // transaction that spends the credit: if reading the insertId threw, the
      // grant would roll back and the vendor would lose a lead to an audit
      // bookkeeping detail. Capturing an id must never be able to fail the
      // thing it is recording.
      enquiryId = Number(written?.[0]?.insertId) || null;
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      // Lost a race against ourselves for the same RFQ - already consumed.
      duplicate = true;
    } else if (isSerializationFailure(error)) {
      // InnoDB rolled this transaction back to break a deadlock with the
      // concurrent one. Nothing here was written. Two outcomes are possible and
      // they are distinguished by looking, not by guessing:
      //
      //   the other transaction committed -> the row exists -> already
      //     consumed, and this caller is told they have the lead. No second
      //     charge: the row is the charge.
      //
      //   the other transaction ALSO rolled back -> no row -> nobody was
      //     charged and nobody got the lead, so this is retried once. Retrying
      //     is safe for the same reason: the unique index and the re-read below
      //     make a second charge impossible even if both attempts proceed.
      const [raced] = await db
        .select({ id: qualifiedEnquiries.id })
        .from(qualifiedEnquiries)
        .where(and(eq(qualifiedEnquiries.userId, userId), eq(qualifiedEnquiries.rfqId, rfqId)))
        .limit(1);
      if (raced) {
        duplicate = true;
        enquiryId = raced.id;
      } else {
        try {
          await db.transaction(async tx => {
            if (allowance !== null) {
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
            const written = await tx.insert(qualifiedEnquiries).values({
              userId,
              rfqId,
              yearMonth: period.key,
              planAtConsumption: resolution.effectivePlan,
              matchedCategory: rfq.category,
            });
            enquiryId = Number(written?.[0]?.insertId) || null;
          });
        } catch (retryError) {
          // One retry, not a loop. If the second attempt also loses, the honest
          // answer is a failure the caller can retry themselves - not an
          // unbounded retry holding a request open against a contended row.
          if (!isDuplicateKeyError(retryError)) throw retryError;
          duplicate = true;
        }
      }
    } else {
      throw error;
    }
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
  // A duplicate-key race means somebody else's transaction wrote the row, so
  // there is no insertId to have captured - read it back rather than reporting
  // null for a record that plainly exists.
  if (enquiryId === null) {
    const [row] = await db
      .select({ id: qualifiedEnquiries.id })
      .from(qualifiedEnquiries)
      .where(and(eq(qualifiedEnquiries.userId, userId), eq(qualifiedEnquiries.rfqId, rfqId)))
      .limit(1);
    enquiryId = row?.id ?? null;
  }
  return {
    outcome: 'granted',
    rfq,
    alreadyConsumed: duplicate,
    usage: await getEnquiryUsage(userId, now),
    enquiryId,
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

  // TWO ROUTES ONTO ONE BOARD, and the union is the whole point.
  //
  //   category match  the open board, unchanged - what a supplier declared
  //                   they do
  //   invitation      a customer named this supplier specifically
  //
  // An invited RFQ appears EVEN WHEN THE CATEGORY DOES NOT MATCH. That is not
  // a leak: someone with the authority to commit the request to spend chose
  // this supplier by hand, which is a stronger signal than a taxonomy the
  // customer never sees. The reverse - showing a customer an invite button and
  // then hiding the RFQ from the firm they picked - would be the defect.
  //
  // Note the early return this REPLACES: a supplier with no declared
  // categories used to get an empty board full stop, so an invitation to a
  // brand-new supplier who had not yet filled in their categories would have
  // been invisible to them.
  const declared = await getVendorCategories(userId);
  const invited = await invitedRfqIds(db, userId);
  if (declared.length === 0 && invited.length === 0) return [];

  const reachable = declared.length > 0 && invited.length > 0
    ? or(inArray(rfqs.category, declared), inArray(rfqs.id, invited))
    : declared.length > 0
      ? inArray(rfqs.category, declared)
      : inArray(rfqs.id, invited);

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
    .where(and(eq(rfqs.status, 'open'), reachable))
    .orderBy(sql`${rfqs.createdAt} desc`)
    .limit(limit);

  if (rows.length === 0) return [];
  const invitedSet = new Set(invited);
  const opened = await db
    .select({ rfqId: qualifiedEnquiries.rfqId })
    .from(qualifiedEnquiries)
    .where(and(eq(qualifiedEnquiries.userId, userId), inArray(qualifiedEnquiries.rfqId, rows.map(r => r.id))));
  const openedSet = new Set(opened.map(o => o.rfqId));

  // `invited` is surfaced so the board can say WHY an RFQ is there, and so a
  // supplier can see that opening it will not cost them a lead.
  return rows.map(row => ({
    ...row,
    alreadyOpened: openedSet.has(row.id),
    invited: invitedSet.has(row.id),
  }));
}
