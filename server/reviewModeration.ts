/**
 * ── REVIEWS: THE HALF THAT WAS MISSING ────────────────────────────────────
 *
 * Eligibility, self-review refusal, duplicate refusal and live-derived ratings
 * already worked. What did not exist: a reviewed provider had no right of
 * reply, nobody could report an abusive review, and no administrator could act
 * on one. This module is those three, and the rules they need.
 *
 * THE RULE THAT MATTERS MOST, stated once here so no reader re-derives it:
 *
 *   A HIDDEN REVIEW LEAVES THE AVERAGE.
 *
 * Hiding a review that still counts toward the rating is a remedy in
 * appearance only - the provider's score carries the same damage with the
 * evidence removed, which is worse than leaving it visible. Every read below
 * applies `visibleReviewFilter()`. The guard that holds every reader in the
 * codebase to that one definition is the census in vendorReputation.test.ts -
 * it lives there because it is the restatement of the test that used to assert
 * an inline `reviews.verified, true` inside statsForUser. The behaviour of the
 * three operations below is pinned in reviewModeration.test.ts.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { reviews, reviewResponses, reviewReports, users } from '../drizzle/schema';
import { adminPage, COUNT, allOf, enumFilter, type AdminPage } from './adminList';
import type { ReviewReportReason, ReviewReportStatus } from '../shared/reviews';

type Db = any;

export class ReviewModerationError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'BAD_REQUEST' | 'CONFLICT', message: string) {
    super(message);
  }
}

/**
 * THE ONE VISIBILITY RULE for public review reads.
 *
 * `verified` was always required - it marks a review that came from a real
 * relationship. `hiddenAt is null` is the new half. Both live here so a new
 * reader cannot apply one and forget the other, which is precisely how a
 * hidden review would go on counting.
 */
export function visibleReviewFilter() {
  return and(eq(reviews.verified, true), isNull(reviews.hiddenAt));
}

/**
 * A provider answers a review about them.
 *
 * ONLY THE REVIEWEE. Not the reviewer, not another provider, not an
 * administrator writing on somebody's behalf - a reply attributed to a person
 * who did not write it is worse than no reply.
 *
 * ONE RESPONSE, enforced by a unique key in the database as well as here: two
 * checks would let a race through, and the constraint is the one that cannot.
 * Editing replaces the body rather than adding a second row, so the page shows
 * one answer as it stands today.
 */
export async function respondToReview(db: Db, params: {
  reviewId: number; authorId: number; body: string;
}): Promise<{ ok: true }> {
  const [review] = await db.select({
    id: reviews.id, revieweeId: reviews.revieweeId, hiddenAt: reviews.hiddenAt,
  }).from(reviews).where(eq(reviews.id, params.reviewId)).limit(1);

  if (!review) throw new ReviewModerationError('NOT_FOUND', 'Review not found');
  if (review.revieweeId !== params.authorId) {
    // NOT FOUND rather than FORBIDDEN: confirming a review exists to somebody
    // who may not answer it lets ids be walked.
    throw new ReviewModerationError('NOT_FOUND', 'Review not found');
  }
  if (review.hiddenAt) {
    throw new ReviewModerationError(
      'BAD_REQUEST',
      'This review is hidden while it is reviewed, so it cannot be answered yet.',
    );
  }

  const [existing] = await db.select({ id: reviewResponses.id })
    .from(reviewResponses).where(eq(reviewResponses.reviewId, params.reviewId)).limit(1);

  if (existing) {
    await db.update(reviewResponses).set({ body: params.body })
      .where(eq(reviewResponses.id, existing.id));
  } else {
    await db.insert(reviewResponses).values({
      reviewId: params.reviewId, authorId: params.authorId, body: params.body,
    });
  }
  return { ok: true };
}

/**
 * Report a review.
 *
 * ONE REPORT PER PERSON PER REVIEW, by unique key. Repeat-reporting is not a
 * louder vote, and letting it through would let one account manufacture a
 * queue full of the same complaint.
 *
 * THE REVIEWER CANNOT REPORT THEIR OWN REVIEW. If they regret it they can ask
 * support; a self-report is either a mistake or an attempt to get a genuine
 * review pulled without anybody weighing it.
 */
export async function reportReview(db: Db, params: {
  reviewId: number; reporterId: number; reason: ReviewReportReason; detail?: string | null;
}): Promise<{ ok: true }> {
  const [review] = await db.select({
    id: reviews.id, reviewerId: reviews.reviewerId,
  }).from(reviews).where(eq(reviews.id, params.reviewId)).limit(1);
  if (!review) throw new ReviewModerationError('NOT_FOUND', 'Review not found');
  if (review.reviewerId === params.reporterId) {
    throw new ReviewModerationError('BAD_REQUEST', 'You cannot report your own review.');
  }

  const [existing] = await db.select({ id: reviewReports.id }).from(reviewReports)
    .where(and(
      eq(reviewReports.reviewId, params.reviewId),
      eq(reviewReports.reporterId, params.reporterId),
    )).limit(1);
  if (existing) {
    throw new ReviewModerationError('CONFLICT', 'You have already reported this review.');
  }

  await db.insert(reviewReports).values({
    reviewId: params.reviewId,
    reporterId: params.reporterId,
    reason: params.reason,
    detail: params.detail ?? null,
    status: 'open',
  });
  return { ok: true };
}

/**
 * Hide or restore a review.
 *
 * A REASON IS REQUIRED TO HIDE. Removing somebody's published words from a
 * provider's page without a recorded reason is the kind of decision that
 * cannot be defended later, to either party.
 */
export async function moderateReview(db: Db, params: {
  reviewId: number; actorId: number; action: 'hide' | 'restore'; reason?: string | null;
}): Promise<{ ok: true; hidden: boolean }> {
  const [review] = await db.select({ id: reviews.id, hiddenAt: reviews.hiddenAt })
    .from(reviews).where(eq(reviews.id, params.reviewId)).limit(1);
  if (!review) throw new ReviewModerationError('NOT_FOUND', 'Review not found');

  if (params.action === 'hide') {
    if (review.hiddenAt) throw new ReviewModerationError('BAD_REQUEST', 'This review is already hidden.');
    if (!params.reason || !params.reason.trim()) {
      throw new ReviewModerationError('BAD_REQUEST', 'Say why it is being hidden. A removal with no recorded reason cannot be defended to either party.');
    }
    await db.update(reviews).set({
      hiddenAt: new Date(), hiddenBy: params.actorId, hiddenReason: params.reason.trim(),
    }).where(eq(reviews.id, params.reviewId));
    return { ok: true, hidden: true };
  }

  if (!review.hiddenAt) throw new ReviewModerationError('BAD_REQUEST', 'This review is not hidden.');
  // RESTORING CLEARS THE STAMP rather than adding a "restored" flag: the row's
  // current state is the answer to "is this visible", and two fields meaning
  // one thing is how they come to disagree. The account audit carries the
  // history of who did what.
  await db.update(reviews).set({ hiddenAt: null, hiddenBy: null, hiddenReason: null })
    .where(eq(reviews.id, params.reviewId));
  return { ok: true, hidden: false };
}

/** Resolve a report. Upholding does NOT hide - that is a separate decision. */
export async function resolveReviewReport(db: Db, params: {
  reportId: number; actorId: number; status: Exclude<ReviewReportStatus, 'open'>; note?: string | null;
}): Promise<{ ok: true }> {
  const [report] = await db.select({ id: reviewReports.id, status: reviewReports.status })
    .from(reviewReports).where(eq(reviewReports.id, params.reportId)).limit(1);
  if (!report) throw new ReviewModerationError('NOT_FOUND', 'Report not found');
  if (report.status !== 'open') {
    throw new ReviewModerationError('BAD_REQUEST', `This report was already ${report.status}.`);
  }
  await db.update(reviewReports).set({
    status: params.status,
    resolutionNote: params.note ?? null,
    resolvedBy: params.actorId,
    resolvedAt: new Date(),
  }).where(eq(reviewReports.id, params.reportId));
  return { ok: true };
}

export type ReportQueueRow = {
  id: number; reviewId: number; reason: string; detail: string | null;
  status: string; createdAt: Date;
  reporterId: number; reporterName: string | null;
  rating: number; comment: string | null;
  revieweeId: number; revieweeName: string | null;
  reviewHidden: boolean;
};

/** The moderation queue: open reports first, oldest first inside each band. */
export async function listReviewReports(db: Db, input: {
  page?: number; pageSize?: number; status?: string;
}): Promise<AdminPage<ReportQueueRow>> {
  const reporter = alias(users, 'reportReporter');
  const reviewee = alias(users, 'reportReviewee');

  const joined = (builder: any) => builder
    .innerJoin(reviews, eq(reviews.id, reviewReports.reviewId))
    .innerJoin(reporter, eq(reporter.id, reviewReports.reporterId))
    .innerJoin(reviewee, eq(reviewee.id, reviews.revieweeId));

  const where = allOf(and, [enumFilter(reviewReports.status, input.status, eq)]);

  const page = await adminPage<any>({
    countQuery: joined(db.select(COUNT).from(reviewReports)),
    rowsQuery: joined(db.select({
      id: reviewReports.id,
      reviewId: reviewReports.reviewId,
      reason: reviewReports.reason,
      detail: reviewReports.detail,
      status: reviewReports.status,
      createdAt: reviewReports.createdAt,
      reporterId: reviewReports.reporterId,
      reporterName: reporter.name,
      rating: reviews.rating,
      comment: reviews.comment,
      revieweeId: reviews.revieweeId,
      revieweeName: reviewee.name,
      hiddenAt: reviews.hiddenAt,
    }).from(reviewReports)),
    where,
    orderBy: [
      sql`field(${reviewReports.status}, 'open', 'upheld', 'rejected')`,
      reviewReports.createdAt,
    ],
    page: input.page ?? 0,
    pageSize: input.pageSize ?? 20,
  });

  return {
    ...page,
    rows: page.rows.map((row: any) => ({
      ...row,
      reviewHidden: row.hiddenAt != null,
    })) as ReportQueueRow[],
  };
}

/** Public reviews about one provider, with the provider's replies attached. */
export async function visibleReviewsFor(db: Db, userId: number) {
  const rows = await db.select({
    id: reviews.id,
    projectId: reviews.projectId,
    reviewerId: reviews.reviewerId,
    revieweeId: reviews.revieweeId,
    rating: reviews.rating,
    comment: reviews.comment,
    createdAt: reviews.createdAt,
    responseBody: reviewResponses.body,
    responseAt: reviewResponses.updatedAt,
  }).from(reviews)
    // LEFT: most reviews have no reply, and an inner join would publish only
    // the ones a provider chose to answer - which would be a rating made of
    // whichever reviews the subject engaged with.
    .leftJoin(reviewResponses, eq(reviewResponses.reviewId, reviews.id))
    .where(and(eq(reviews.revieweeId, userId), visibleReviewFilter()))
    .orderBy(desc(reviews.createdAt));
  return rows;
}
