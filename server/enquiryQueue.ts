/**
 * ── A PROVIDER'S ENQUIRY WORK QUEUE ───────────────────────────────────────
 *
 * `rfq.eligible` was the only list a provider had, and it answers a different
 * question than the one the screen claims to answer. Three defects, each
 * verified against the running product before this file existed:
 *
 *   A LEAD THE PROVIDER PAID FOR DISAPPEARS. The board reads
 *   `where status = 'open'`, so the moment the customer closes or awards the
 *   request it is gone from the only place the provider could see it - while
 *   the credit stays spent and the usage meter still counts it. Proven live:
 *   open an enquiry, close the request, and the row vanishes from a queue that
 *   still bills for it. Nothing else in the product listed it either; every
 *   other provider-scoped read of `qualifiedEnquiries` is a single-row
 *   existence check or a monthly count. A provider could not answer "what did
 *   I spend this month's leads on".
 *
 *   IT TRUNCATES SILENTLY AT 50. `listEligibleRfqs(userId, limit = 50)`
 *   returns a bare array with no total - the exact defect class
 *   `server/adminList.ts` exists to end, on a provider's commercial work queue
 *   rather than an administration screen. It also sat in a HELPER MODULE
 *   rather than in `routers.ts`, which is why the truncation census never saw
 *   it; see `server/adminList.test.ts`.
 *
 *   AND THE PAGE LIED ABOUT ITSELF. `/enquiries` is titled "Qualified
 *   enquiries" and subtitled "The requests you have opened", over a list of
 *   requests the provider COULD open.
 *
 * ── WHAT IS IN THE QUEUE, AND WHY ─────────────────────────────────────────
 *
 * Three ways a request reaches a provider, unioned in ONE query so the count
 * and the rows cannot disagree:
 *
 *   OPENED     a `qualifiedEnquiries` row exists. Included AT ANY RFQ STATUS -
 *              this is the paid record, and a receipt that disappears when the
 *              other party closes the file is not a receipt.
 *   INVITED    an `rfqSuppliers` row exists, at any invitation status,
 *              including `declined`: a provider is entitled to see what they
 *              turned down. Also at any RFQ status, for the same reason.
 *   AVAILABLE  an OPEN request in a category the provider has declared. This
 *              arm alone is restricted to open requests, because it is the
 *              only one that is an offer rather than a record.
 *
 * The rest is derived, never stored twice: `source` says why it is here,
 * `responseState` how far it has got. Both are computed from the joined rows,
 * so they cannot drift from the facts the way a status column copied at write
 * time does.
 */
import { and, desc, eq, gte, isNotNull, isNull, like, lte, or, sql } from 'drizzle-orm';
import { qualifiedEnquiries, quotations, rfqSuppliers, rfqs } from '../drizzle/schema';
import { adminPage, allOf, COUNT, type AdminPage } from './adminList';
import { containsTerm, MAX_SEARCH_LENGTH } from './_core/searchTerms';

type Db = any;

/** A page of a work queue, not a feed: small enough to read, bounded by `adminPage`. */
export const ENQUIRY_PAGE_SIZE_DEFAULT = 20;

/** Why this request is in this provider's queue. An invitation outranks a category match. */
export const ENQUIRY_SOURCES = ['invitation', 'category'] as const;
export type EnquirySource = (typeof ENQUIRY_SOURCES)[number];

/**
 * How far the provider has got with it.
 *
 * ORDERED BY PROGRESS, and `declined` is terminal rather than a stage: a
 * provider who said no has made a decision, and showing it as "not started"
 * would invite them to be chased for work they already refused.
 */
export const ENQUIRY_RESPONSE_STATES = ['available', 'opened', 'quoted', 'declined'] as const;
export type EnquiryResponseState = (typeof ENQUIRY_RESPONSE_STATES)[number];

export const ENQUIRY_RFQ_STATUSES = ['open', 'closed', 'awarded'] as const;

export type EnquiryQueueRow = {
  rfqId: number;
  title: string;
  category: string | null;
  location: string | null;
  budget: string | null;
  deadline: Date | null;
  rfqStatus: string;
  createdAt: Date;
  source: EnquirySource;
  responseState: EnquiryResponseState;
  /** The credit, if one was spent: when, and under which plan. Null when it was free. */
  openedAt: Date | null;
  planAtConsumption: string | null;
  invitedAt: Date | null;
  invitationStatus: string | null;
  quotationId: number | null;
  quotationStatus: string | null;
  quotedAt: Date | null;
  /** True when opening it costs nothing: an invitation, or a lead already paid for. */
  free: boolean;
};

export type EnquiryQueueFilters = {
  rfqStatus?: string | null;
  source?: EnquirySource | null;
  responseState?: EnquiryResponseState | null;
  category?: string | null;
  from?: Date | null;
  to?: Date | null;
  search?: string | null;
};

/**
 * The three joins every query here shares.
 *
 * All three are LEFT joins and all three are constrained TO THIS PROVIDER in
 * the ON clause, not in the WHERE. Moving any of them to the WHERE turns the
 * left join into an inner one and drops every row the provider has NOT done
 * that thing to - which is most of the board. The quotation join also excludes
 * superseded revisions, so a provider who revised a bid is "quoted" once
 * rather than once per version.
 */
function joinsFor(query: any, userId: number) {
  return query
    .leftJoin(qualifiedEnquiries, and(
      eq(qualifiedEnquiries.rfqId, rfqs.id),
      eq(qualifiedEnquiries.userId, userId),
    ))
    .leftJoin(rfqSuppliers, and(
      eq(rfqSuppliers.rfqId, rfqs.id),
      eq(rfqSuppliers.supplierId, userId),
    ))
    .leftJoin(quotations, and(
      eq(quotations.rfqId, rfqs.id),
      eq(quotations.providerId, userId),
      isNull(quotations.supersededAt),
    ));
}

/**
 * WHICH REQUESTS REACH THIS PROVIDER AT ALL.
 *
 * Returns undefined when nothing can - no declared category, no invitation, no
 * opened enquiry - so the caller filters on "nothing" explicitly rather than
 * on an empty `or()`, which Drizzle would drop and turn into "everything".
 */
export function reachableFilter(declaredCategories: readonly string[]) {
  const arms: any[] = [
    // The paid record and the named invitation, at ANY status.
    isNotNull(qualifiedEnquiries.id),
    isNotNull(rfqSuppliers.id),
  ];
  if (declaredCategories.length > 0) {
    arms.push(and(
      eq(rfqs.status, 'open'),
      sql`${rfqs.category} in ${declaredCategories}`,
    ));
  }
  return or(...arms);
}

/** `source` and `responseState` as SQL, so the SAME rule can be filtered on and returned. */
const sourceExpression = sql<string>`case when ${rfqSuppliers.id} is not null then 'invitation' else 'category' end`;
const responseStateExpression = sql<string>`case
  when ${rfqSuppliers.status} = 'declined' then 'declined'
  when ${quotations.id} is not null then 'quoted'
  when ${qualifiedEnquiries.id} is not null or ${rfqSuppliers.id} is not null then 'opened'
  else 'available' end`;

function filterClause(filters: EnquiryQueueFilters) {
  const clauses: any[] = [];
  if (filters.rfqStatus) clauses.push(eq(rfqs.status, filters.rfqStatus as any));
  if (filters.category) clauses.push(eq(rfqs.category, filters.category));
  if (filters.from) clauses.push(gte(rfqs.createdAt, filters.from));
  if (filters.to) clauses.push(lte(rfqs.createdAt, filters.to));
  // FILTERED ON THE EXPRESSION, not on a second reading of the same rule. A
  // hand-written `rfqSuppliers.id is not null` here would be a copy that drifts
  // the first time either definition changes.
  if (filters.source) clauses.push(sql`${sourceExpression} = ${filters.source}`);
  if (filters.responseState) clauses.push(sql`${responseStateExpression} = ${filters.responseState}`);
  if (filters.search) {
    const term = filters.search.trim().slice(0, MAX_SEARCH_LENGTH);
    if (term.length > 0) {
      const numeric = /^#?\d+$/.test(term) ? Number(term.replace('#', '')) : null;
      // A provider quotes the reference off an email - "#412" and "412" are the
      // same request to them - so a numeric term matches the id as well as the
      // title, rather than searching for the digits inside a title.
      clauses.push(numeric === null
        ? like(rfqs.title, containsTerm(term))
        : or(eq(rfqs.id, numeric), like(rfqs.title, containsTerm(term))));
    }
  }
  return allOf(and, clauses);
}

/**
 * One page of the provider's queue.
 *
 * `declaredCategories` is passed IN rather than read here: the caller already
 * holds it, and re-reading it would make this function's answer depend on a
 * second query that could disagree with the eligibility the act enforces.
 */
export async function listEnquiryQueue(db: Db, params: {
  userId: number;
  page?: number;
  pageSize?: number;
  declaredCategories: readonly string[];
  filters?: EnquiryQueueFilters;
}): Promise<AdminPage<EnquiryQueueRow>> {
  const filters = params.filters ?? {};
  const where = allOf(and, [reachableFilter(params.declaredCategories), filterClause(filters)]);

  const page = await adminPage<any>({
    countQuery: joinsFor(db.select(COUNT).from(rfqs), params.userId),
    rowsQuery: joinsFor(db.select({
      rfqId: rfqs.id,
      title: rfqs.title,
      category: rfqs.category,
      location: rfqs.location,
      budget: rfqs.budget,
      deadline: rfqs.deadline,
      rfqStatus: rfqs.status,
      createdAt: rfqs.createdAt,
      source: sourceExpression,
      responseState: responseStateExpression,
      openedAt: qualifiedEnquiries.createdAt,
      planAtConsumption: qualifiedEnquiries.planAtConsumption,
      invitedAt: rfqSuppliers.invitedAt,
      invitationStatus: rfqSuppliers.status,
      quotationId: quotations.id,
      quotationStatus: quotations.status,
      quotedAt: quotations.createdAt,
    }).from(rfqs), params.userId),
    where,
    orderBy: [desc(rfqs.createdAt), desc(rfqs.id)],
    page: params.page ?? 0,
    pageSize: params.pageSize ?? ENQUIRY_PAGE_SIZE_DEFAULT,
  });

  return {
    ...page,
    rows: page.rows.map((row: any): EnquiryQueueRow => ({
      ...row,
      rfqStatus: String(row.rfqStatus),
      source: row.source as EnquirySource,
      responseState: row.responseState as EnquiryResponseState,
      // FREE IS A FACT ABOUT THIS ROW, not a plan lookup: an invitation is
      // exempt by the owner's decision, and a lead already paid for does not
      // charge twice. Both are visible right here in the joined row.
      free: row.invitedAt !== null || row.openedAt !== null,
    })),
  };
}

/**
 * The counts the dashboard card shows, over the WHOLE queue rather than a page.
 *
 * Taken with the same joins and the same reachability clause as the list, so
 * "3 awaiting a quote" and the queue filtered to `opened` cannot disagree.
 */
export async function enquiryQueueSummary(db: Db, params: {
  userId: number;
  declaredCategories: readonly string[];
}): Promise<Record<EnquiryResponseState | 'total', number>> {
  const rows = await joinsFor(
    db.select({ state: responseStateExpression, ...COUNT }).from(rfqs),
    params.userId,
  )
    .where(reachableFilter(params.declaredCategories))
    .groupBy(responseStateExpression);

  const counts: Record<string, number> = { available: 0, opened: 0, quoted: 0, declined: 0, total: 0 };
  for (const row of rows as Array<{ state: string; count: number }>) {
    const value = Number(row.count ?? 0);
    counts[row.state] = value;
    counts.total += value;
  }
  return counts as Record<EnquiryResponseState | 'total', number>;
}

/** The categories actually present in this provider's queue, for the filter control. */
export async function enquiryQueueCategories(db: Db, params: {
  userId: number;
  declaredCategories: readonly string[];
}): Promise<string[]> {
  const rows = await joinsFor(db.selectDistinct({ category: rfqs.category }).from(rfqs), params.userId)
    .where(reachableFilter(params.declaredCategories));
  return (rows as Array<{ category: string | null }>)
    .map(row => row.category)
    .filter((category): category is string => typeof category === 'string' && category.length > 0)
    .sort();
}
