/**
 * ── PRODUCT Q&A: REPORT, CORRECT, HIDE, RESTORE ──────────────────────────
 *
 * `productQuestions` had three surfaces - list, ask, answer - and no remedy of
 * any kind. A question carrying abuse, a third party's phone number or a
 * competitor's contact details was published on a supplier's product page and
 * nobody could act on it: not the supplier, not an administrator. An answer
 * was write-once, so a supplier who mistyped a dimension could never correct
 * it and the wrong answer stayed public forever.
 *
 * This is the missing half. It follows the SAME lifecycle as review
 * moderation rather than inventing a second one - see
 * shared/contentModeration.ts for the rules both obey, and note what is
 * shared and what is not:
 *
 *   SHARED   open -> upheld | rejected; hide | restore; hidden never deleted;
 *            upholding a report is a SEPARATE decision from hiding content
 *   NOT      the reasons. "The reviewer was never a customer" is meaningless
 *            here, and a reason list that does not fit produces reports
 *            nobody can triage.
 *
 * ── THE TWO HALVES ARE MODERATED SEPARATELY ──────────────────────────────
 *
 * A question and its answer are written by different people and go wrong
 * independently. A reasonable question can get an abusive reply; an abusive
 * question can get a patient one. Hiding the exchange to act on half of it
 * punishes whoever wrote the other half, so each carries its own state.
 *
 * ── AN EDIT IS A CORRECTION, NEVER AN ERASURE ────────────────────────────
 *
 * An editable public answer is a way to rewrite history: answer "yes, we ship
 * to Alexandria", take the order, quietly change it to "no". Every superseded
 * version is written to productAnswerRevisions before the new one lands, the
 * page carries an "Edited" marker, and the buyer who asked can see that it
 * changed. The history is append-only and nothing in this module deletes from
 * it.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import {
  productAnswerRevisions, productQuestionReports, productQuestions, products, users,
} from '../drizzle/schema';
import { adminPage, COUNT, allOf, enumFilter, type AdminPage } from './adminList';
import type {
  ProductQuestionReportReason, ProductQuestionReportTarget,
} from '../shared/productQuestions';
import type { ContentReportStatus } from '../shared/contentModeration';

type Db = any;

export class ProductQuestionModerationError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'BAD_REQUEST' | 'CONFLICT', message: string) {
    super(message);
  }
}

/**
 * THE ONE VISIBILITY RULE for public question reads.
 *
 * A hidden question does not render publicly. Kept here as a function rather
 * than written inline at each call site for the same reason the review filter
 * is: two readers applying it slightly differently is exactly how hidden
 * content comes back.
 */
export function visibleQuestionFilter() {
  return isNull(productQuestions.hiddenAt);
}

/**
 * What the public may see of one question row.
 *
 * A HIDDEN ANSWER LEAVES THE QUESTION STANDING. The question was asked in
 * good faith and deserves to stay; what is withdrawn is the reply. The reader
 * is told an answer was removed rather than being shown a question that looks
 * as though the supplier ignored it - silence and moderation mean very
 * different things to somebody deciding whether to buy.
 */
export function publicQuestionView<T extends {
  answer: string | null; answerHiddenAt: Date | null; answerEditedAt: Date | null;
}>(row: T) {
  const answerHidden = row.answerHiddenAt != null;
  return {
    ...row,
    answer: answerHidden ? null : row.answer,
    answerHidden,
    answerEdited: !answerHidden && row.answerEditedAt != null,
  };
}

/**
 * Somebody reports a question or an answer.
 *
 * NOBODY REPORTS THEIR OWN WORDS. Reporting your own question is not a
 * moderation request, it is a deletion request wearing one - and deletion is
 * exactly what this system does not offer.
 *
 * ONE REPORT PER PERSON PER TARGET, enforced by a unique key in the database
 * as well as here. Two checks would let a race through; the constraint is the
 * one that cannot.
 */
export async function reportProductQuestion(db: Db, params: {
  questionId: number;
  target: ProductQuestionReportTarget;
  reporterId: number;
  reason: ProductQuestionReportReason;
  detail?: string | null;
}): Promise<{ ok: true }> {
  const [question] = await db.select({
    id: productQuestions.id,
    askerId: productQuestions.askerId,
    answer: productQuestions.answer,
    supplierId: products.supplierId,
  }).from(productQuestions)
    .innerJoin(products, eq(products.id, productQuestions.productId))
    .where(eq(productQuestions.id, params.questionId)).limit(1);
  if (!question) throw new ProductQuestionModerationError('NOT_FOUND', 'Question not found');

  if (params.target === 'answer' && !question.answer) {
    throw new ProductQuestionModerationError('BAD_REQUEST', 'There is no answer to report.');
  }
  const authorId = params.target === 'question' ? question.askerId : question.supplierId;
  if (authorId === params.reporterId) {
    throw new ProductQuestionModerationError(
      'BAD_REQUEST', 'You cannot report your own words.');
  }

  const [existing] = await db.select({ id: productQuestionReports.id })
    .from(productQuestionReports)
    .where(and(
      eq(productQuestionReports.questionId, params.questionId),
      eq(productQuestionReports.target, params.target),
      eq(productQuestionReports.reporterId, params.reporterId),
    )).limit(1);
  if (existing) {
    throw new ProductQuestionModerationError('CONFLICT', 'You have already reported this.');
  }

  await db.insert(productQuestionReports).values({
    questionId: params.questionId,
    target: params.target,
    reporterId: params.reporterId,
    reason: params.reason,
    detail: params.detail ?? null,
    status: 'open',
  });
  return { ok: true };
}

/**
 * A supplier corrects their own answer.
 *
 * THE PREVIOUS TEXT IS WRITTEN FIRST. If the revision insert fails the answer
 * is left as it was, which is the safe direction: a correction that loses the
 * thing it replaced is the failure this whole table exists to prevent.
 */
export async function editProductAnswer(db: Db, params: {
  questionId: number; supplierId: number; answer: string;
}): Promise<{ ok: true; revisions: number }> {
  const trimmed = params.answer.trim();
  if (!trimmed) {
    throw new ProductQuestionModerationError('BAD_REQUEST', 'An answer cannot be empty.');
  }

  const [question] = await db.select({
    id: productQuestions.id,
    answer: productQuestions.answer,
    answeredAt: productQuestions.answeredAt,
    answerHiddenAt: productQuestions.answerHiddenAt,
    hiddenAt: productQuestions.hiddenAt,
    supplierId: products.supplierId,
  }).from(productQuestions)
    .innerJoin(products, eq(products.id, productQuestions.productId))
    .where(eq(productQuestions.id, params.questionId)).limit(1);

  // ONE ANSWER for "no such question" and "not your product": distinguishing
  // them would let a caller map which question ids exist and which products
  // belong to whom.
  if (!question || question.supplierId !== params.supplierId) {
    throw new ProductQuestionModerationError('NOT_FOUND', 'Question not found');
  }
  if (!question.answer) {
    throw new ProductQuestionModerationError(
      'BAD_REQUEST', 'There is no answer to edit yet.');
  }
  // A MODERATED ANSWER IS NOT EDITABLE. Letting a supplier rewrite an answer
  // that an administrator has hidden would turn moderation into a round trip:
  // hide, rewrite, and the decision is gone.
  if (question.answerHiddenAt) {
    throw new ProductQuestionModerationError(
      'CONFLICT', 'This answer was hidden by BuildHub and cannot be edited.');
  }
  if (question.hiddenAt) {
    throw new ProductQuestionModerationError(
      'CONFLICT', 'This question was hidden by BuildHub.');
  }
  if (question.answer.trim() === trimmed) {
    throw new ProductQuestionModerationError('BAD_REQUEST', 'That is the same answer.');
  }

  await db.insert(productAnswerRevisions).values({
    questionId: params.questionId,
    answer: question.answer,
    answeredAt: question.answeredAt ?? null,
    replacedBy: params.supplierId,
  });
  await db.update(productQuestions).set({
    answer: trimmed,
    answerEditedAt: new Date(),
  }).where(eq(productQuestions.id, params.questionId));

  const [count] = await db.select({ total: sql<number>`count(*)` })
    .from(productAnswerRevisions)
    .where(eq(productAnswerRevisions.questionId, params.questionId));
  return { ok: true, revisions: Number(count?.total ?? 0) };
}

/**
 * Hide or restore a question, or an answer.
 *
 * A REASON IS REQUIRED TO HIDE. Removing somebody's published words from a
 * product page without a recorded reason is a decision that cannot be
 * defended afterwards to either party.
 */
export async function moderateProductQuestion(db: Db, params: {
  questionId: number;
  target: ProductQuestionReportTarget;
  actorId: number;
  action: 'hide' | 'restore';
  reason?: string | null;
}): Promise<{ ok: true; hidden: boolean }> {
  const [question] = await db.select({
    id: productQuestions.id,
    answer: productQuestions.answer,
    hiddenAt: productQuestions.hiddenAt,
    answerHiddenAt: productQuestions.answerHiddenAt,
  }).from(productQuestions).where(eq(productQuestions.id, params.questionId)).limit(1);
  if (!question) throw new ProductQuestionModerationError('NOT_FOUND', 'Question not found');

  const onQuestion = params.target === 'question';
  if (!onQuestion && !question.answer) {
    throw new ProductQuestionModerationError('BAD_REQUEST', 'There is no answer to moderate.');
  }
  const alreadyHidden = onQuestion ? question.hiddenAt : question.answerHiddenAt;

  if (params.action === 'hide') {
    if (alreadyHidden) {
      throw new ProductQuestionModerationError('BAD_REQUEST', 'That is already hidden.');
    }
    const reason = (params.reason ?? '').trim();
    if (!reason) {
      throw new ProductQuestionModerationError(
        'BAD_REQUEST',
        'Say why it is being hidden. A removal with no recorded reason cannot be defended to either party.',
      );
    }
    await db.update(productQuestions).set(onQuestion
      ? { hiddenAt: new Date(), hiddenBy: params.actorId, hiddenReason: reason }
      : { answerHiddenAt: new Date(), answerHiddenBy: params.actorId, answerHiddenReason: reason },
    ).where(eq(productQuestions.id, params.questionId));
    return { ok: true, hidden: true };
  }

  if (!alreadyHidden) {
    throw new ProductQuestionModerationError('BAD_REQUEST', 'That is not hidden.');
  }
  // RESTORING CLEARS THE STAMP rather than adding a "restored" flag: the row's
  // current state answers "is this visible", and two fields meaning one thing
  // is how they come to disagree. Who did what lives in the audit trail.
  await db.update(productQuestions).set(onQuestion
    ? { hiddenAt: null, hiddenBy: null, hiddenReason: null }
    : { answerHiddenAt: null, answerHiddenBy: null, answerHiddenReason: null },
  ).where(eq(productQuestions.id, params.questionId));
  return { ok: true, hidden: false };
}

/** Resolve a report. Upholding does NOT hide - that is a separate decision. */
export async function resolveProductQuestionReport(db: Db, params: {
  reportId: number; actorId: number;
  status: Exclude<ContentReportStatus, 'open'>;
  note?: string | null;
}): Promise<{ ok: true }> {
  const [report] = await db.select({
    id: productQuestionReports.id, status: productQuestionReports.status,
  }).from(productQuestionReports)
    .where(eq(productQuestionReports.id, params.reportId)).limit(1);
  if (!report) throw new ProductQuestionModerationError('NOT_FOUND', 'Report not found');
  if (report.status !== 'open') {
    throw new ProductQuestionModerationError('BAD_REQUEST', `This report was already ${report.status}.`);
  }
  await db.update(productQuestionReports).set({
    status: params.status,
    resolutionNote: params.note ?? null,
    resolvedBy: params.actorId,
    resolvedAt: new Date(),
  }).where(eq(productQuestionReports.id, params.reportId));
  return { ok: true };
}

export type ProductQuestionReportRow = {
  id: number; questionId: number; target: string;
  reason: string; detail: string | null;
  status: string; createdAt: Date;
  reporterId: number; reporterName: string | null;
  askerId: number; askerName: string | null;
  supplierId: number; supplierName: string | null;
  productId: number; productName: string | null;
  question: string; answer: string | null;
  questionHidden: boolean; answerHidden: boolean;
  resolutionNote: string | null;
};

/**
 * The moderation queue: open reports first, oldest first inside each band.
 *
 * EVERY PIECE OF CONTEXT A DECISION NEEDS travels with the row - the words
 * themselves, who wrote them, which product, which supplier, who reported it
 * and why. A queue that shows an id and a reason forces a moderator to go
 * hunting before they can act, and a moderator who has to hunt acts less.
 */
export async function listProductQuestionReports(db: Db, input: {
  page?: number; pageSize?: number; status?: string;
}): Promise<AdminPage<ProductQuestionReportRow>> {
  const reporter = alias(users, 'pqReporter');
  const asker = alias(users, 'pqAsker');
  const supplier = alias(users, 'pqSupplier');

  const joined = (builder: any) => builder
    .innerJoin(productQuestions, eq(productQuestions.id, productQuestionReports.questionId))
    .innerJoin(products, eq(products.id, productQuestions.productId))
    .innerJoin(reporter, eq(reporter.id, productQuestionReports.reporterId))
    .innerJoin(asker, eq(asker.id, productQuestions.askerId))
    .innerJoin(supplier, eq(supplier.id, products.supplierId));

  const where = allOf(and, [enumFilter(productQuestionReports.status, input.status, eq)]);

  const page = await adminPage<any>({
    countQuery: joined(db.select(COUNT).from(productQuestionReports)),
    rowsQuery: joined(db.select({
      id: productQuestionReports.id,
      questionId: productQuestionReports.questionId,
      target: productQuestionReports.target,
      reason: productQuestionReports.reason,
      detail: productQuestionReports.detail,
      status: productQuestionReports.status,
      resolutionNote: productQuestionReports.resolutionNote,
      createdAt: productQuestionReports.createdAt,
      reporterId: productQuestionReports.reporterId,
      reporterName: reporter.name,
      askerId: productQuestions.askerId,
      askerName: asker.name,
      supplierId: products.supplierId,
      supplierName: supplier.name,
      productId: products.id,
      productName: products.name,
      question: productQuestions.question,
      answer: productQuestions.answer,
      hiddenAt: productQuestions.hiddenAt,
      answerHiddenAt: productQuestions.answerHiddenAt,
    }).from(productQuestionReports)),
    where,
    orderBy: [
      sql`field(${productQuestionReports.status}, 'open', 'upheld', 'rejected')`,
      productQuestionReports.createdAt,
    ],
    page: input.page ?? 0,
    pageSize: input.pageSize ?? 20,
  });

  return {
    ...page,
    rows: page.rows.map((row: any) => ({
      ...row,
      questionHidden: row.hiddenAt != null,
      answerHidden: row.answerHiddenAt != null,
    })) as ProductQuestionReportRow[],
  };
}

/** What an answer used to say, newest replacement first. */
export async function answerRevisions(db: Db, questionId: number) {
  const editor = alias(users, 'pqEditor');
  return db.select({
    id: productAnswerRevisions.id,
    answer: productAnswerRevisions.answer,
    answeredAt: productAnswerRevisions.answeredAt,
    replacedAt: productAnswerRevisions.replacedAt,
    replacedBy: productAnswerRevisions.replacedBy,
    replacedByName: editor.name,
  }).from(productAnswerRevisions)
    .innerJoin(editor, eq(editor.id, productAnswerRevisions.replacedBy))
    .where(eq(productAnswerRevisions.questionId, questionId))
    .orderBy(desc(productAnswerRevisions.replacedAt));
}

/** How many reports are waiting. Drives the admin attention badge. */
export async function openProductQuestionReportCount(db: Db): Promise<number> {
  const [row] = await db.select({ total: sql<number>`count(*)` })
    .from(productQuestionReports)
    .where(inArray(productQuestionReports.status, ['open']));
  return Number(row?.total ?? 0);
}
