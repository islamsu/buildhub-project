/**
 * READING THE DISPUTE QUEUE.
 *
 * `admin.disputes` was:
 *
 *     const rows = await db.select().from(disputes).orderBy(desc(disputes.createdAt));
 *     const userRows = await db.select({ id: users.id, name: users.name }).from(users);
 *
 * Two defects in three lines, and the second is the one that would have hurt.
 *
 * NO PAGINATION AND NO FILTER: every dispute ever filed, in one response, with
 * the search and the status filter applied in the browser afterwards. That is
 * the shape `admin.users` had before P0-3, and it fails the same way - not by
 * erroring, but by confidently answering "no matching disputes" when the match
 * is on a row the response did not carry.
 *
 * EVERY USER ON THE PLATFORM READ INTO MEMORY to resolve two names per row. At
 * a hundred accounts that is invisible; at fifty thousand it is a table scan of
 * the largest table in the database on every load of a support screen, to
 * answer a question two joins answer exactly.
 *
 * The shape here follows listAdminReferrals in server/referralRewardView.ts:
 * filter and search IN THE QUERY, a real total from a count, and only the users
 * the page actually needs.
 */
import { and, asc, desc, eq, inArray, isNull, isNotNull, like, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import {
  adminNotes, disputeEvidence, disputeMessages, disputeStatusHistory, disputes, users,
} from '../drizzle/schema';
import { parseDisputeReference } from '../shared/disputes';
import { hasSubject } from './disputeSubject';
import { partiesForSubject } from './disputeEligibility';

export type AdminDisputeQuery = {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  priority?: string;
  category?: string;
  subjectType?: string;
  /** 'all' | 'unassigned' | 'mine' - the three questions a support queue is asked. */
  assignment?: string;
  /** Who "mine" means. Supplied by the router from the session, never the client. */
  actorId?: number;
};

export type DisputePage<T> = { rows: T[]; total: number; page: number; pageSize: number };

/**
 * ── WHAT A SEARCH TERM MEANS ───────────────────────────────────────────────
 *
 * `DSP-2026-000123` is an EXACT identifier, and matching it with a LIKE over
 * free text is wrong in both directions: it would miss the dispute if the
 * stored reference were ever formatted differently, and it would return other
 * disputes whose description happens to quote the reference - which is exactly
 * what a description of a related dispute would do.
 *
 * So a term that parses as a reference becomes an id lookup, and only a term
 * that does not becomes a text search. Pure, because the decision is the part
 * worth testing.
 */
export function interpretDisputeSearch(raw: string | null | undefined): {
  referenceId: number | null;
  text: string | null;
} {
  const term = (raw ?? '').trim();
  if (!term) return { referenceId: null, text: null };
  const referenceId = parseDisputeReference(term);
  if (referenceId !== null) return { referenceId, text: null };
  return { referenceId: null, text: term };
}

/**
 * A closed set, or nothing.
 *
 * The client sends the filter values, and a value outside the set must not
 * reach the query builder - not because it is dangerous (drizzle parameterises
 * it) but because an enum column compared against a value it cannot hold
 * returns nothing, and "no results" is indistinguishable from "no matches". A
 * filter this cannot recognise is dropped, which shows everything, which is
 * visibly wrong rather than quietly wrong.
 */
function inSet<T extends string>(value: string | undefined, allowed: readonly T[]): T | null {
  if (!value || value === 'all') return null;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

const STATUSES = ['open', 'investigating', 'resolved', 'rejected', 'withdrawn'] as const;
const PRIORITIES = ['low', 'medium', 'high'] as const;
const CATEGORIES = ['quality', 'delivery', 'quantity', 'specification', 'communication', 'conduct', 'pricing', 'other'] as const;
const SUBJECTS = ['project', 'rfq', 'quotation'] as const;

const reporter = alias(users, 'disputeReporter');
const respondent = alias(users, 'disputeRespondent');
const assignee = alias(users, 'disputeAssignee');

/**
 * The conditions for one queue view.
 *
 * Separated from the query so a test can assert WHICH filters a given input
 * produces without standing up a database - the failure mode being guarded
 * against is a filter silently not applied, and a fake that returns rows
 * regardless cannot see that.
 */
export function disputeQueueFilters(query: AdminDisputeQuery): unknown[] {
  const { referenceId, text } = interpretDisputeSearch(query.search);
  const filters: unknown[] = [];

  const status = inSet(query.status, STATUSES);
  if (status) filters.push(eq(disputes.status, status));
  const priority = inSet(query.priority, PRIORITIES);
  if (priority) filters.push(eq(disputes.priority, priority));
  const category = inSet(query.category, CATEGORIES);
  if (category) filters.push(eq(disputes.category, category));
  const subjectType = inSet(query.subjectType, SUBJECTS);
  if (subjectType) filters.push(eq(disputes.subjectType, subjectType));

  if (query.assignment === 'unassigned') filters.push(isNull(disputes.assignedTo));
  else if (query.assignment === 'mine') {
    /*
     * "Mine" with no signed-in actor is not "everybody's". Answering it with an
     * unfiltered list would show an administrator the whole queue under a label
     * that says it is theirs; a condition that cannot match is the honest
     * reading of a question that cannot be answered.
     */
    filters.push(query.actorId ? eq(disputes.assignedTo, query.actorId) : sql`1 = 0`);
  } else if (query.assignment === 'assigned') filters.push(isNotNull(disputes.assignedTo));

  if (referenceId !== null) filters.push(eq(disputes.id, referenceId));
  else if (text) {
    filters.push(or(
      like(disputes.title, `%${text}%`),
      like(disputes.reference, `%${text}%`),
      like(reporter.name, `%${text}%`),
      like(reporter.email, `%${text}%`),
      like(respondent.name, `%${text}%`),
      like(respondent.email, `%${text}%`),
    ));
  }
  return filters;
}

/** One page of the support queue, with the identities the page needs and no others. */
export async function listAdminDisputes(
  db: any,
  query: AdminDisputeQuery,
): Promise<DisputePage<Record<string, unknown>>> {
  const filters = disputeQueueFilters(query);
  const where = filters.length > 0 ? and(...(filters as any[])) : undefined;

  /*
   * The count runs over the SAME joins as the page. A total taken from an
   * unjoined `count(*)` would disagree with the rows the moment a filter
   * touched a joined column, and a pager that says "1 of 4" over one page of
   * results is a worse lie than no pager.
   */
  const joined = (builder: any) => builder
    .innerJoin(reporter, eq(reporter.id, disputes.reporterId))
    .leftJoin(respondent, eq(respondent.id, disputes.respondentId));

  const totalQuery = joined(db.select({ count: sql<number>`count(*)` }).from(disputes));
  const [totalRow] = where ? await totalQuery.where(where) : await totalQuery;

  const base = joined(db.select({
    id: disputes.id,
    reference: disputes.reference,
    title: disputes.title,
    description: disputes.description,
    status: disputes.status,
    priority: disputes.priority,
    category: disputes.category,
    type: disputes.type,
    subjectType: disputes.subjectType,
    subjectId: disputes.subjectId,
    reporterId: disputes.reporterId,
    respondentId: disputes.respondentId,
    assignedTo: disputes.assignedTo,
    assignedAt: disputes.assignedAt,
    resolutionType: disputes.resolutionType,
    resolutionNotes: disputes.resolutionNotes,
    resolvedAt: disputes.resolvedAt,
    createdAt: disputes.createdAt,
    updatedAt: disputes.updatedAt,
    reporterName: reporter.name,
    reporterEmail: reporter.email,
    respondentName: respondent.name,
    respondentEmail: respondent.email,
    assigneeName: assignee.name,
  }).from(disputes))
    .leftJoin(assignee, eq(assignee.id, disputes.assignedTo));

  const rows = await (where ? base.where(where) : base)
    /*
     * OPEN WORK FIRST, then newest. Ordering a support queue by date alone puts
     * a resolved dispute from this morning above an open one from last week,
     * which is the opposite of what the queue is for.
     */
    .orderBy(
      sql`field(${disputes.status}, 'open', 'investigating', 'resolved', 'rejected', 'withdrawn')`,
      desc(disputes.createdAt),
    )
    .limit(query.pageSize)
    .offset(query.page * query.pageSize);

  return {
    rows,
    total: Number(totalRow?.count ?? 0),
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** How many disputes sit in each status right now - the queue's own summary. */
export async function disputeStatusCounts(db: any): Promise<Record<string, number>> {
  const rows = await db.select({ status: disputes.status, count: sql<number>`count(*)` })
    .from(disputes).groupBy(disputes.status);
  const counts: Record<string, number> = {};
  for (const status of STATUSES) counts[status] = 0;
  for (const row of rows as any[]) counts[String(row.status)] = Number(row.count ?? 0);
  return counts;
}

/** Resolve a handful of user ids to names, in one query, for ids that exist. */
async function namesFor(db: any, ids: Array<number | null | undefined>): Promise<Map<number, string | null>> {
  const wanted = Array.from(new Set(ids.map(id => Number(id)).filter(id => Number.isSafeInteger(id) && id > 0)));
  if (wanted.length === 0) return new Map();
  const rows = await db.select({ id: users.id, name: users.name })
    .from(users).where(inArray(users.id, wanted));
  return new Map((rows as any[]).map(row => [Number(row.id), row.name ?? null]));
}

/**
 * ONE DISPUTE, for an administrator working it.
 *
 * The same record the participants see - history, their messages, their
 * evidence - plus the things only an administrator has: the internal notes, and
 * the identities behind every id on the row.
 *
 * The caller has already been through `adminWith('support.manage')`. There is
 * no per-dispute eligibility here on purpose: a support administrator's remit
 * IS every dispute, and inventing a second rule that says otherwise would be a
 * rule nothing enforces and nobody could rely on.
 */
export async function adminDisputeDetail(db: any, disputeId: number) {
  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, disputeId));
  if (!dispute) return null;

  const subject = hasSubject(dispute)
    ? await partiesForSubject(db, dispute.subjectType, Number(dispute.subjectId))
    : null;

  const [history, messages, evidence, notes] = await Promise.all([
    db.select().from(disputeStatusHistory)
      .where(eq(disputeStatusHistory.disputeId, disputeId))
      .orderBy(desc(disputeStatusHistory.createdAt)).limit(200),
    db.select({
      id: disputeMessages.id, authorId: disputeMessages.authorId,
      body: disputeMessages.body, createdAt: disputeMessages.createdAt,
    }).from(disputeMessages)
      .where(eq(disputeMessages.disputeId, disputeId))
      .orderBy(asc(disputeMessages.createdAt)).limit(200),
    db.select({
      id: disputeEvidence.id, uploadedBy: disputeEvidence.uploadedBy,
      fileName: disputeEvidence.fileName, contentType: disputeEvidence.contentType,
      sizeBytes: disputeEvidence.sizeBytes, storageKey: disputeEvidence.storageKey,
      removedAt: disputeEvidence.removedAt, createdAt: disputeEvidence.createdAt,
    }).from(disputeEvidence)
      .where(eq(disputeEvidence.disputeId, disputeId))
      .orderBy(desc(disputeEvidence.createdAt)).limit(100),
    db.select({
      id: adminNotes.id, note: adminNotes.note,
      authorId: adminNotes.authorId, createdAt: adminNotes.createdAt,
    }).from(adminNotes)
      .where(and(eq(adminNotes.subjectType, 'dispute'), eq(adminNotes.subjectId, disputeId)))
      .orderBy(desc(adminNotes.createdAt)).limit(100),
  ]);

  const names = await namesFor(db, [
    dispute.reporterId, dispute.respondentId, dispute.assignedTo, dispute.assignedBy,
    dispute.resolvedBy, dispute.reopenedBy,
    ...(history as any[]).map(row => row.actorId),
    ...(messages as any[]).map(row => row.authorId),
    ...(evidence as any[]).map(row => row.uploadedBy),
    ...(notes as any[]).map(row => row.authorId),
  ]);
  const nameOf = (id: unknown) => (id == null ? null : names.get(Number(id)) ?? null);

  return {
    dispute: {
      ...dispute,
      reporterName: nameOf(dispute.reporterId),
      respondentName: nameOf(dispute.respondentId),
      assigneeName: nameOf(dispute.assignedTo),
      assignedByName: nameOf(dispute.assignedBy),
      resolvedByName: nameOf(dispute.resolvedBy),
      reopenedByName: nameOf(dispute.reopenedBy),
    },
    subjectLabel: subject?.label ?? null,
    history: (history as any[]).map(row => ({ ...row, actorName: nameOf(row.actorId) })),
    messages: (messages as any[]).map(row => ({ ...row, authorName: nameOf(row.authorId) })),
    /*
     * A WITHDRAWN FILE IS NOT DOWNLOADABLE, FOR AN ADMINISTRATOR EITHER. The
     * storage proxy refuses a removed key to every caller, so handing back a
     * url here would produce a link that 403s - and the row is kept precisely
     * so the record shows the file existed and who withdrew it, which is what
     * an administrator needs to see.
     */
    evidence: (evidence as any[]).map(row => ({
      ...row,
      uploaderName: nameOf(row.uploadedBy),
      url: row.removedAt ? null : `/manus-storage/${row.storageKey}`,
      storageKey: undefined,
    })),
    notes: (notes as any[]).map(row => ({ ...row, authorName: nameOf(row.authorId) })),
  };
}
