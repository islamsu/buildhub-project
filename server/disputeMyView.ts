/**
 * THE DISPUTE LIST A USER SEES.
 *
 * `disputes.myDisputes` had NO CLIENT CALLER and there was no `/disputes`
 * route: a person could raise a dispute and had nowhere to read it, answer it,
 * or find out what became of it. The notification the respondent receives links
 * to `/disputes/:id`, which resolved to nothing.
 *
 * Two things were wrong with the procedure itself, and both are fixed here.
 *
 * IT CAPPED AT `.limit(200)` WITH NO COUNT - the silent truncation `admin.users`
 * had before P0-3, in a smaller place. A person with more than two hundred
 * disputes is unlikely, but "unlikely" is not "cannot", and a list that quietly
 * stops is one nobody can tell has stopped.
 *
 * AND IT RESOLVED THE SUBJECT LABEL ROW BY ROW - `Promise.all(rows.map(...))`
 * over `partiesForSubject`, which reads the project or RFQ or quotation AND its
 * whole cast, per dispute. Twenty disputes was up to sixty queries to render
 * twenty short strings. The labels are read here in one query per subject type,
 * and the cast - which is not the user's business anyway - is never loaded.
 */
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { disputes, projects, quotations, rfqs } from '../drizzle/schema';
import type { DisputeSubjectType } from '../shared/disputes';

export type MyDisputeQuery = { page: number; pageSize: number; status?: string };

const OPEN = ['open', 'investigating'] as const;
const CLOSED = ['resolved', 'rejected', 'withdrawn'] as const;

/**
 * THE LABELS FOR A WHOLE PAGE, in one query per subject type.
 *
 * A dispute names its subject by type and id, and a screen showing "dispute
 * about project 7" is showing an id to somebody who has never seen one. This
 * reads only the TITLE of each subject - never its cast, never its other
 * parties - because the label is all the list needs and the rest is not the
 * reader's business.
 */
export async function subjectLabels(
  db: any,
  rows: Array<{ subjectType: string; subjectId: number | null }>,
): Promise<Map<string, string>> {
  const wanted = new Map<DisputeSubjectType, number[]>();
  for (const row of rows) {
    const id = Number(row.subjectId ?? 0);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const type = row.subjectType as DisputeSubjectType;
    if (type !== 'project' && type !== 'rfq' && type !== 'quotation') continue;
    wanted.set(type, [...(wanted.get(type) ?? []), id]);
  }

  const labels = new Map<string, string>();
  const load = async (
    type: DisputeSubjectType,
    read: (ids: number[]) => Promise<Array<{ id: number; title: string | null }>>,
  ) => {
    const ids = wanted.get(type);
    if (!ids || ids.length === 0) return;
    for (const row of await read(Array.from(new Set(ids)))) {
      if (row.title) labels.set(`${type}:${Number(row.id)}`, row.title);
    }
  };

  await Promise.all([
    load('project', ids => db.select({ id: projects.id, title: projects.title })
      .from(projects).where(inArray(projects.id, ids))),
    load('rfq', ids => db.select({ id: rfqs.id, title: rfqs.title })
      .from(rfqs).where(inArray(rfqs.id, ids))),
    /*
     * A quotation has no title of its own - it is a bid ON an RFQ - so it is
     * labelled by the RFQ it answers. Reading `quotations.id` alone would give
     * the screen "quotation 30", which is the id problem with extra steps.
     */
    load('quotation', async ids => {
      const bids = await db.select({ id: quotations.id, rfqId: quotations.rfqId })
        .from(quotations).where(inArray(quotations.id, ids));
      if (bids.length === 0) return [];
      const rfqRows = await db.select({ id: rfqs.id, title: rfqs.title })
        .from(rfqs).where(inArray(rfqs.id, bids.map((bid: any) => Number(bid.rfqId))));
      const byRfq = new Map(rfqRows.map((row: any) => [Number(row.id), row.title]));
      return bids.map((bid: any) => ({
        id: Number(bid.id),
        title: byRfq.get(Number(bid.rfqId)) ? `Quotation on ${byRfq.get(Number(bid.rfqId))}` : null,
      }));
    }),
  ]);
  return labels;
}

/**
 * One page of the caller's own disputes - raised by them, or against them.
 *
 * SELF-SCOPED BY CONSTRUCTION: the user id is a parameter of this function and
 * comes from the session at the call site. There is no userId in the procedure's
 * input, so there is nothing for a caller to tamper with.
 */
export async function listMyDisputes(db: any, userId: number, query: MyDisputeQuery) {
  const mine = or(eq(disputes.reporterId, userId), eq(disputes.respondentId, userId));
  const scope = query.status === 'open' ? and(mine, inArray(disputes.status, OPEN as any))
    : query.status === 'closed' ? and(mine, inArray(disputes.status, CLOSED as any))
      : mine;

  const [totalRow] = await db.select({ count: sql<number>`count(*)` }).from(disputes).where(scope);
  const rows = await db.select({
    id: disputes.id, reference: disputes.reference, title: disputes.title,
    status: disputes.status, priority: disputes.priority, category: disputes.category,
    subjectType: disputes.subjectType, subjectId: disputes.subjectId,
    reporterId: disputes.reporterId, respondentId: disputes.respondentId,
    resolutionType: disputes.resolutionType, resolvedAt: disputes.resolvedAt,
    createdAt: disputes.createdAt, updatedAt: disputes.updatedAt,
  }).from(disputes).where(scope)
    // Open work first, then newest - the same ordering the support queue uses,
    // and for the same reason: a resolved dispute is not what you came to read.
    .orderBy(
      sql`field(${disputes.status}, 'open', 'investigating', 'resolved', 'rejected', 'withdrawn')`,
      desc(disputes.createdAt),
    )
    .limit(query.pageSize)
    .offset(query.page * query.pageSize);

  const labels = await subjectLabels(db, rows as any[]);
  return {
    rows: (rows as any[]).map(row => ({
      ...row,
      /*
       * A pre-0046 row with no project had nothing to backfill a subject from.
       * Reported as unknown rather than rendered as "project 0", which would be
       * a relationship the record does not contain.
       */
      subjectLabel: labels.get(`${row.subjectType}:${Number(row.subjectId)}`) ?? null,
      /** Which side of it this reader is on - the list says so without a second query. */
      yourSide: Number(row.reporterId) === userId ? 'reporter' as const
        : Number(row.respondentId) === userId ? 'respondent' as const
          : 'party' as const,
    })),
    total: Number(totalRow?.count ?? 0),
    page: query.page,
    pageSize: query.pageSize,
  };
}
