/**
 * ── WHAT IS WAITING FOR AN ADMINISTRATOR RIGHT NOW ────────────────────────
 *
 * The console showed queues and nothing said whether any of them needed
 * anybody. An administrator had to open each page to find out, which means a
 * queue is only attended to by someone who already suspected it needed
 * attending to. The owner's complaint named Vendor Enquiries; the same
 * omission applies to every operational queue beside it.
 *
 * THE RULES THIS FOLLOWS, because a badge that lies is worse than no badge.
 *
 * EVERY COUNT IS A REAL COUNT over real rows. No estimate, no sample, no
 * cached figure. An administrator acts on these numbers.
 *
 * AN OUTAGE IS NOT ZERO. Every read goes through requireDb(), so a database
 * that cannot be reached raises instead of reporting an empty, calm console.
 * "No disputes are waiting" is the single most dangerous thing this file
 * could say untruthfully.
 *
 * "NEW" IS DEFINED PER QUEUE, and it is a state the domain already models
 * rather than a read-receipt invented here. A per-administrator "unseen"
 * model would need its own table and would make the number personal - two
 * administrators would see different counts for the same shared queue and
 * neither could tell whether the other had dealt with anything. For a small
 * operations team that is worse. Where a queue has a canonical actionable
 * state, that state IS the definition, and it is named in the type below so
 * the screen can say what it is counting.
 *
 * EACH COUNT CARRIES THE FILTER THAT REPRODUCES IT. The badge and the queue
 * it opens answer the same question because they are given the same question,
 * not because two pieces of code were written to agree.
 *
 * NOT EVERY QUEUE GETS A BADGE. A sidebar where everything is decorated tells
 * you nothing. Only queues with a genuine pending-action state appear here.
 */
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  disputes, productQuestionReports, reviewReports, supportTickets, users,
  vendorNameChangeRequests,
} from '../drizzle/schema';
import { CONTENT_REPORT_OPEN_STATUSES } from '../shared/contentModeration';
import { requireDb } from './_core/requireDb';
import { enquiryAttention } from './vendorEnquiryQuery';
import { DISPUTE_OPEN_STATUSES } from '../shared/disputes';

/** The queues that can carry an attention badge. */
import { ATTENTION_QUEUES, type AttentionQueue } from '../shared/adminAttentionQueues';
import { attentionMeaningEn } from '../shared/adminAttention';
export { ATTENTION_QUEUES };
export type { AttentionQueue };

export type AttentionCount = {
  /** How many items are waiting. A real count. */
  count: number;
  /**
   * What "waiting" means for this queue, in the product's own words, so the
   * screen can label the badge rather than leaving a bare number to be
   * guessed at.
   */
  meaning: string;
  /** Where the badge goes, with the filter that reproduces exactly this set. */
  href: string;
};

export type AdminAttention = Record<AttentionQueue, AttentionCount>;

/**
 * WHAT EACH QUEUE MEANS AND WHERE IT LIVES, in one place and separate from
 * the counting. A badge and the page it opens have to answer the same
 * question, and they do that by being handed the same question rather than
 * by two pieces of code being written to agree. Keeping this out of the
 * query also lets a test read it without a database, which is how a queue
 * that is counted but rendered nowhere gets caught.
 */
export const ATTENTION_META: Readonly<Record<AttentionQueue, { meaning: string; href: string }>> = {
  enquiries: {
    meaning: attentionMeaningEn('enquiries'),
    href: '/admin/enquiries?assignee=none&rfqStatus=open',
  },
  registrations: {
    meaning: attentionMeaningEn('registrations'),
    href: '/admin/registrations',
  },
  disputes: {
    meaning: attentionMeaningEn('disputes'),
    href: '/admin/disputes',
  },
  support: {
    meaning: attentionMeaningEn('support'),
    href: '/admin/support',
  },
  reviews: {
    meaning: attentionMeaningEn('reviews'),
    href: '/admin/reviews',
  },
  nameChanges: {
    meaning: attentionMeaningEn('nameChanges'),
    href: '/admin/name-changes',
  },
  /*
   * Public Q&A had no moderation path at all until 0056, so it had nothing to
   * count. A reported question or answer sits on a supplier's product page
   * until somebody acts on it, which makes it exactly the kind of queue that
   * must not depend on an administrator remembering to look.
   */
  productQuestions: {
    meaning: attentionMeaningEn('productQuestions'),
    href: '/admin/reviews?tab=questions',
  },
};

/** Provider roles whose registration goes through compliance review. */
const PROVIDER_ROLES = ['contractor', 'engineer', 'architect', 'supplier', 'project_manager'] as const;

/** Registration states that are still waiting on a decision from us. */
const REGISTRATION_PENDING = ['not_started', 'under_review', 'update_required'] as const;

/** Name-change states that are still open. Mirrors the admin list's own filter. */
const NAME_CHANGE_OPEN = ['pending', 'under_review', 'needs_information'] as const;

export async function adminAttention(): Promise<AdminAttention> {
  const db = await requireDb();

  const one = async (query: Promise<{ total: number }[]>) =>
    Number((await query)[0]?.total ?? 0);

  const [
    enquiries, registrations, openDisputes, openSupport, reportedReviews, nameChanges,
    reportedQuestions,
  ] = await Promise.all([
      enquiryAttention(db),
      one(db.select({ total: count() }).from(users).where(and(
        inArray(users.userRole, PROVIDER_ROLES),
        inArray(users.onboardingStatus, REGISTRATION_PENDING),
      )) as unknown as Promise<{ total: number }[]>),
      one(db.select({ total: count() }).from(disputes).where(
        inArray(disputes.status, DISPUTE_OPEN_STATUSES),
      ) as unknown as Promise<{ total: number }[]>),
      /*
       * `awaiting_user` is deliberately NOT counted. The ball is with the
       * requester, and badging it would tell an administrator to chase work
       * that is not theirs to do.
       */
      one(db.select({ total: count() }).from(supportTickets).where(
        inArray(supportTickets.status, ['open', 'in_progress'] as const),
      ) as unknown as Promise<{ total: number }[]>),
      one(db.select({ total: count() }).from(reviewReports).where(
        isNull(reviewReports.resolvedAt),
      ) as unknown as Promise<{ total: number }[]>),
      one(db.select({ total: count() }).from(vendorNameChangeRequests).where(
        inArray(vendorNameChangeRequests.status, NAME_CHANGE_OPEN),
      ) as unknown as Promise<{ total: number }[]>),
      // Only 'open'. An upheld or rejected report has been decided, and
      // counting a decision as work is how a queue stops being believed.
      one(db.select({ total: count() }).from(productQuestionReports).where(
        inArray(productQuestionReports.status, [...CONTENT_REPORT_OPEN_STATUSES]),
      ) as unknown as Promise<{ total: number }[]>),
    ]);

  const counts: Record<AttentionQueue, number> = {
    enquiries: enquiries.actionable,
    registrations,
    disputes: openDisputes,
    support: openSupport,
    reviews: reportedReviews,
    nameChanges,
    productQuestions: reportedQuestions,
  };

  return Object.fromEntries(ATTENTION_QUEUES.map(
    queue => [queue, { count: counts[queue], ...ATTENTION_META[queue] }],
  )) as AdminAttention;
}
