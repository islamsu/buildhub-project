/**
 * ── READING THE ENQUIRY UNIVERSE ──────────────────────────────────────────
 *
 * WHAT AN "ENQUIRY THAT EXISTS" IS, and why the Admin overview cannot simply
 * count all seven states.
 *
 * AVAILABLE is not a record. It is the absence of one: every approved vendor
 * whose declared categories match every open RFQ is "available" to it. Counting
 * that would mean counting a cartesian product - a KPI that jumps when a vendor
 * signs up and has nothing to do with enquiries at all - and paginating it would
 * mean paginating a join nobody wrote a row for.
 *
 * So the universe an administrator can look at is the set of pairs SOMETHING
 * HAPPENED TO: a vendor was invited, a vendor consumed an allowance unit, or a
 * vendor answered. Exactly the union of the three tables that record those:
 *
 *     rfqSuppliers  UNION  qualifiedEnquiries  UNION  quotations
 *
 * A pair in that union then has its state derived from the same four pieces of
 * evidence as everywhere else. AVAILABLE therefore appears in ENQUIRY_STATES
 * (it is a real state for a single pair a screen asks about) but never in the
 * overview counts, because no row can be in the union and still be AVAILABLE.
 *
 * WHY THERE IS SQL HERE AT ALL.
 *
 * The counting could be done in Node: load the union, derive each row, tally.
 * That is one round trip and O(n) memory, which is fine at demo scale and is a
 * dashboard that times out at real scale. The overview is counted in the
 * database instead - but WITHOUT a second copy of the precedence ladder, which
 * would be the exact drift vendorEnquiry.ts exists to prevent. The CASE below
 * is GENERATED from ENQUIRY_STATE_RULES, in order, so there is one ladder with
 * two renderings and no way to update one without the other.
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  DEFAULT_ENQUIRY_STATE,
  ENQUIRY_STATE_RULES,
  ENQUIRY_STATES,
  deriveEnquiryState,
  enquiryReference,
  parseEnquiryReference,
  usageReason,
  type EnquiryEvidence,
  type EnquiryState,
  type EnquiryUsageReason,
  type EvidenceColumns,
} from './vendorEnquiry';

/**
 * The four evidence expressions as the universe query exposes them.
 *
 * Named once so the CASE emitter and the query cannot disagree about a column
 * name - a mismatch there is a SQL error at best and a silently wrong state at
 * worst.
 */
export const UNIVERSE_COLUMNS: EvidenceColumns = {
  rfqStatus: 'e.rfqStatus',
  invitationStatus: 'e.invitationStatus',
  creditSpent: 'e.creditSpent',
  hasQuotation: 'e.hasQuotation',
};

/**
 * The precedence ladder as a SQL CASE, emitted from ENQUIRY_STATE_RULES.
 *
 * NOT hand-written, and deliberately not hand-maintainable: adding a state to
 * the rule list adds it here, and reordering the list reorders here. The ELSE
 * is DEFAULT_ENQUIRY_STATE for the same reason the function's fall-through is.
 */
export function enquiryStateSql(columns: EvidenceColumns = UNIVERSE_COLUMNS): string {
  const branches = ENQUIRY_STATE_RULES
    .map(rule => `WHEN ${rule.sql(columns)} THEN '${rule.state}'`)
    .join('\n         ');
  return `CASE ${branches}\n         ELSE '${DEFAULT_ENQUIRY_STATE}' END`;
}

/**
 * The union of pairs something has happened to, with its evidence.
 *
 * EXISTS rather than joins for the two boolean columns: a vendor may hold more
 * than one quotation on an RFQ, and joining would multiply the pair into as
 * many rows, inflating every count that reads it. The invitation joins normally
 * because (rfqId, supplierId) is unique there.
 */
export const ENQUIRY_UNIVERSE_FROM = `
  FROM (
    SELECT rfqId, supplierId AS vendorId FROM rfqSuppliers
    UNION
    SELECT rfqId, userId     AS vendorId FROM qualifiedEnquiries
    UNION
    SELECT rfqId, providerId AS vendorId FROM quotations
  ) p
  JOIN rfqs r ON r.id = p.rfqId
  LEFT JOIN rfqSuppliers s ON s.rfqId = p.rfqId AND s.supplierId = p.vendorId
`;

/** The evidence columns, aliased to exactly the names UNIVERSE_COLUMNS uses. */
export const ENQUIRY_UNIVERSE_SELECT = `
    p.rfqId                  AS rfqId,
    p.vendorId               AS vendorId,
    r.status                 AS rfqStatus,
    s.status                 AS invitationStatus,
    EXISTS (SELECT 1 FROM qualifiedEnquiries q
             WHERE q.rfqId = p.rfqId AND q.userId = p.vendorId)     AS creditSpent,
    EXISTS (SELECT 1 FROM quotations qt
             WHERE qt.rfqId = p.rfqId AND qt.providerId = p.vendorId) AS hasQuotation
`;

/** Counts per derived state, plus the totals a drill-down has to reconcile to. */
export type EnquiryOverview = {
  /** Every state in ENQUIRY_STATES, so a zero renders as a zero, not as absence. */
  byState: Record<EnquiryState, number>;
  /** Rows in the union: what the state counts must add up to. */
  total: number;
  /** Distinct vendors and RFQs the union touches. */
  vendors: number;
  rfqs: number;
  /** Allowance units consumed - the entitlement figure, not a money figure. */
  consumedAllowanceUnits: number;
};

/**
 * The overview, counted in the database.
 *
 * Every number here is a COUNT over real rows. There is no estimate, no
 * projection and no sample: a dashboard that shows an administrator an
 * approximation of how many vendors are waiting is worse than one that shows
 * nothing, because they will act on it.
 */
export async function enquiryOverview(db: unknown): Promise<EnquiryOverview> {
  const execute = (db as { execute: (q: unknown) => Promise<unknown> }).execute.bind(db);

  const stateRows = await execute(sql.raw(`
    SELECT state, COUNT(*) AS total FROM (
      SELECT ${enquiryStateSql()} AS state FROM (
        SELECT ${ENQUIRY_UNIVERSE_SELECT} ${ENQUIRY_UNIVERSE_FROM}
      ) e
    ) derived
    GROUP BY state
  `)) as unknown;

  const byState = Object.fromEntries(
    ENQUIRY_STATES.map(state => [state, 0]),
  ) as Record<EnquiryState, number>;
  let total = 0;
  for (const row of rowsOf(stateRows)) {
    const state = String(row.state) as EnquiryState;
    const count = Number(row.total ?? 0);
    // An unrecognised state means the CASE emitted something ENQUIRY_STATES does
    // not contain, which can only happen if the two have been allowed to drift.
    // Counting it into the total but not into byState would make the numbers
    // silently fail to add up, so it is refused loudly instead.
    if (!(state in byState)) throw new Error(`unknown derived enquiry state: ${state}`);
    byState[state] = count;
    total += count;
  }

  const [reach] = rowsOf(await execute(sql.raw(`
    SELECT COUNT(DISTINCT p.vendorId) AS vendors, COUNT(DISTINCT p.rfqId) AS rfqs
    ${ENQUIRY_UNIVERSE_FROM}
  `)));
  const [consumed] = rowsOf(await execute(sql.raw(
    'SELECT COUNT(*) AS total FROM qualifiedEnquiries',
  )));

  return {
    byState,
    total,
    vendors: Number(reach?.vendors ?? 0),
    rfqs: Number(reach?.rfqs ?? 0),
    consumedAllowanceUnits: Number(consumed?.total ?? 0),
  };
}


/**
 * ── THE LIST ──────────────────────────────────────────────────────────────
 *
 * The same universe, with the columns an administrator reads rather than the
 * ones the counting needs, and with the filtering, sorting and paging done in
 * the DATABASE.
 *
 * That last part is the whole design. Deriving the state in Node and then
 * filtering the page in Node means loading every enquiry on the platform to
 * show twenty of them - the shape that works on a demo and falls over on a
 * marketplace. It is only possible to filter on a DERIVED state in SQL because
 * the ladder is generated (enquiryStateSql), so the filter and the badge cannot
 * disagree about what INVITED means.
 *
 * WHAT IS DELIBERATELY ABSENT: any quotation figure. An administrator's list of
 * enquiries has no business carrying a supplier's price, and a competitor who
 * reached this endpoint would be reading the whole market's bids. The list says
 * WHETHER a quotation exists (that is the state) and nothing about what is in
 * it.
 */

/** The columns the screen shows, on top of the four pieces of evidence. */
const LIST_SELECT = `
    p.rfqId                  AS rfqId,
    p.vendorId               AS vendorId,
    r.status                 AS rfqStatus,
    r.title                  AS rfqTitle,
    r.category               AS rfqCategory,
    r.createdAt              AS rfqCreatedAt,
    u.name                   AS vendorName,
    vp.companyName           AS vendorCompany,
    s.status                 AS invitationStatus,
    s.invitedAt              AS invitedAt,
    s.viewedAt               AS viewedAt,
    s.respondedAt            AS respondedAt,
    s.declinedAt             AS declinedAt,
    (SELECT q.createdAt FROM qualifiedEnquiries q
      WHERE q.rfqId = p.rfqId AND q.userId = p.vendorId)            AS consumedAt,
    EXISTS (SELECT 1 FROM qualifiedEnquiries q
             WHERE q.rfqId = p.rfqId AND q.userId = p.vendorId)     AS creditSpent,
    EXISTS (SELECT 1 FROM quotations qt
             WHERE qt.rfqId = p.rfqId AND qt.providerId = p.vendorId) AS hasQuotation
`;

/**
 * The vendor's display identity is joined, not fetched per row.
 *
 * A list that renders a name by calling a lookup per row is the N+1 the mandate
 * forbids: twenty rows become forty-one queries, and it is invisible until the
 * page is real.
 */
const LIST_FROM = `${ENQUIRY_UNIVERSE_FROM}
  LEFT JOIN users u ON u.id = p.vendorId
  LEFT JOIN vendorProfiles vp ON vp.userId = p.vendorId
`;

/** How a list may be ordered. An allowlist, because this reaches ORDER BY. */
export const ENQUIRY_SORTS = {
  /** Default. What changed most recently, whichever event it was. */
  activity: 'COALESCE(enq.respondedAt, enq.declinedAt, enq.consumedAt, enq.viewedAt, enq.invitedAt, enq.rfqCreatedAt)',
  rfq: 'enq.rfqId',
  vendor: 'enq.vendorName',
  state: 'enq.state',
} as const;

export type EnquirySort = keyof typeof ENQUIRY_SORTS;

export type EnquiryListFilters = {
  state?: EnquiryState;
  rfqStatus?: string;
  vendorId?: number;
  rfqId?: number;
  /** Matches an RFQ title, a vendor name or company, or a pasted ENQ-/RFQ id. */
  search?: string;
  sort?: EnquirySort;
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

export type EnquiryListRow = {
  reference: string;
  rfqId: number;
  rfqTitle: string | null;
  rfqCategory: string | null;
  rfqStatus: string | null;
  vendorId: number;
  vendorName: string | null;
  vendorCompany: string | null;
  state: EnquiryState;
  usageReason: EnquiryUsageReason;
  invitedAt: Date | null;
  viewedAt: Date | null;
  respondedAt: Date | null;
  declinedAt: Date | null;
  consumedAt: Date | null;
};

export const ENQUIRY_LIST_MAX_LIMIT = 100;

/**
 * One page of enquiries, and the total the pager needs.
 *
 * TWO queries, whatever the page size and whatever the filters: the page and
 * its count. Not one per row, and not one per vendor.
 */
export async function enquiryList(
  db: unknown,
  filters: EnquiryListFilters = {},
): Promise<{ rows: EnquiryListRow[]; total: number; limit: number; offset: number }> {
  const execute = (db as { execute: (q: unknown) => Promise<unknown> }).execute.bind(db);

  const limit = Math.min(Math.max(filters.limit ?? 25, 1), ENQUIRY_LIST_MAX_LIMIT);
  const offset = Math.max(filters.offset ?? 0, 0);

  // EVERY user-supplied value is BOUND, never interpolated. The only strings
  // that reach the SQL as text are the sort key and direction, and both come
  // from allowlists above - a sort parameter is an ORDER BY, and an ORDER BY
  // built from user input is an injection point like any other.
  const conditions: SQL[] = [];
  if (filters.state) conditions.push(sql`enq.state = ${filters.state}`);
  if (filters.rfqStatus) conditions.push(sql`enq.rfqStatus = ${filters.rfqStatus}`);
  if (filters.vendorId != null) conditions.push(sql`enq.vendorId = ${filters.vendorId}`);
  if (filters.rfqId != null) conditions.push(sql`enq.rfqId = ${filters.rfqId}`);
  if (filters.search) {
    const term = `%${filters.search.trim()}%`;
    // A pasted ENQ-501-10 or "RFQ #501" should find the thing it names rather
    // than nothing: the reference is parsed first, and the free-text match is
    // the fallback.
    const reference = parseEnquiryReference(filters.search.trim());
    if (reference) {
      conditions.push(sql`(enq.rfqId = ${reference.rfqId} AND enq.vendorId = ${reference.vendorId})`);
    } else {
      const numeric = /^(?:RFQ\s*#?\s*)?(\d+)$/i.exec(filters.search.trim());
      conditions.push(numeric
        ? sql`(enq.rfqId = ${Number(numeric[1])} OR enq.rfqTitle LIKE ${term})`
        : sql`(enq.rfqTitle LIKE ${term} OR enq.vendorName LIKE ${term} OR enq.vendorCompany LIKE ${term})`);
    }
  }

  const where = conditions.length
    ? sql` WHERE ${sql.join(conditions, sql` AND `)}`
    : sql``;

  // The alias is `enq` and not the obvious `rows`: ROWS is a RESERVED WORD in
  // MariaDB 10.11 (window functions), and `) rows WHERE rows.state = ...` is a
  // syntax error. Checked against the real server rather than assumed.
  const base = sql.raw(`
    FROM (
      SELECT e.*, ${enquiryStateSql()} AS state
        FROM ( SELECT ${LIST_SELECT} ${LIST_FROM} ) e
    ) enq
  `);

  const order = sql.raw(
    ` ORDER BY ${ENQUIRY_SORTS[filters.sort ?? 'activity']} `
    + `${filters.direction === 'asc' ? 'ASC' : 'DESC'}, enq.rfqId DESC, enq.vendorId DESC`,
  );

  const pageRows = rowsOf(await execute(
    sql`SELECT enq.* ${base}${where}${order} LIMIT ${limit} OFFSET ${offset}`,
  ));
  const [counted] = rowsOf(await execute(sql`SELECT COUNT(*) AS total ${base}${where}`));

  return {
    rows: pageRows.map(row => {
      const evidence: EnquiryEvidence = {
        rfqStatus: (row.rfqStatus as string) ?? null,
        invitationStatus: (row.invitationStatus as string) ?? null,
        creditSpent: Number(row.creditSpent) === 1,
        hasQuotation: Number(row.hasQuotation) === 1,
      };
      return {
        reference: enquiryReference(Number(row.rfqId), Number(row.vendorId)),
        rfqId: Number(row.rfqId),
        rfqTitle: (row.rfqTitle as string) ?? null,
        rfqCategory: (row.rfqCategory as string) ?? null,
        rfqStatus: evidence.rfqStatus,
        vendorId: Number(row.vendorId),
        vendorName: (row.vendorName as string) ?? null,
        vendorCompany: (row.vendorCompany as string) ?? null,
        // The state comes from the SQL ladder, and is re-derived here from the
        // same evidence as a cross-check: if the two ever disagree the row is
        // refused rather than rendered, because a badge that contradicts the
        // filter that returned it is worse than an error.
        state: agreedState(String(row.state), evidence),
        usageReason: usageReason(evidence),
        invitedAt: asDate(row.invitedAt),
        viewedAt: asDate(row.viewedAt),
        respondedAt: asDate(row.respondedAt),
        declinedAt: asDate(row.declinedAt),
        consumedAt: asDate(row.consumedAt),
      };
    }),
    total: Number(counted?.total ?? 0),
    limit,
    offset,
  };
}

/**
 * The SQL ladder and the TypeScript ladder must agree about this row.
 *
 * They are generated from one array and compared exhaustively against real
 * MariaDB by evidence/zg-enquiryderivation.mjs, so this should never fire. It
 * exists because the failure it guards against is silent: a row returned BY a
 * state filter and then rendered with a different badge.
 */
function agreedState(fromSql: string, evidence: EnquiryEvidence): EnquiryState {
  const derived = deriveEnquiryState(evidence);
  if (fromSql !== derived) {
    throw new Error(`enquiry state disagreement: SQL said ${fromSql}, derivation says ${derived}`);
  }
  return derived;
}

function asDate(value: unknown): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * mysql2 hands back [rows, fields]; drizzle's execute passes that through.
 * Written once because getting it wrong yields an empty result rather than an
 * error, and an overview of all-zeroes looks exactly like a quiet marketplace.
 */
function rowsOf(result: unknown): Record<string, unknown>[] {
  const first = Array.isArray(result) ? result[0] : result;
  return Array.isArray(first) ? first as Record<string, unknown>[] : [];
}

/**
 * ── THE DETAIL ────────────────────────────────────────────────────────────
 *
 * One enquiry, assembled from the same evidence as the list plus the context an
 * administrator needs to act: what the RFQ is, who the vendor is, what their
 * entitlement looks like, and when each event happened.
 *
 * WHAT IS DELIBERATELY NOT HERE, AND WHY IT IS NOT AN OVERSIGHT.
 *
 * The quotation's CONTENTS - price, terms, timeline, attachments - are absent.
 * That is not caution invented for this screen; it is the decision the platform
 * already made. `admin.rfqInvestigation` is a superAdminProcedure precisely
 * because it "crosses every ownership boundary in the product at once: two
 * parties' messages, every competing bid's price, the whole audit trail", and
 * widening that to a sub-admin role is recorded there as an owner's decision
 * rather than a default.
 *
 * This endpoint is marketplace.manage. Putting a bid in it would hand every
 * marketplace administrator the reach the platform reserved for a Super Admin,
 * through a different door. The detail therefore reports WHETHER the vendor
 * answered and WHEN - which is the enquiry's state, and all an operator needs
 * to work it - and a Super Admin who genuinely needs the bid uses the
 * investigation surface that already exists for that.
 *
 * The RFQ's budget is absent for the same reason at a smaller scale: it is the
 * customer's commercial position, and no enquiry operation depends on it.
 */

export type EnquiryDetail = {
  enquiry: EnquiryListRow;
  rfq: {
    id: number;
    title: string | null;
    category: string | null;
    status: string | null;
    createdAt: Date | null;
    deadline: Date | null;
    requesterId: number | null;
    requesterName: string | null;
  };
  vendor: {
    id: number;
    name: string | null;
    company: string | null;
    accountStatus: string | null;
  };
  /** What happened, oldest first. Every entry is a stored fact with a time. */
  timeline: { at: Date; event: string; detail: string | null }[];
  /**
   * The vendor's allowance, from the CENTRALIZED engine.
   *
   * Not recomputed here. A second implementation of "how many are left" is how
   * the Admin screen and the vendor's own usage screen end up disagreeing about
   * the same month, and the vendor is the one who notices.
   */
  entitlement: {
    used: number;
    allowance: number | null;
    remaining: number | null;
    periodKey: string;
    resetsAt: Date;
  } | null;
};

/**
 * Assemble one enquiry.
 *
 * Returns null rather than throwing when the pair has no history: "this vendor
 * was never involved with this RFQ" is a real answer to a pasted reference, and
 * an error page cannot say it.
 */
export async function enquiryDetail(
  db: unknown,
  pair: { rfqId: number; vendorId: number },
  usageFor?: (vendorId: number) => Promise<EnquiryDetail['entitlement']>,
): Promise<EnquiryDetail | null> {
  const { rows } = await enquiryList(db, { rfqId: pair.rfqId, vendorId: pair.vendorId, limit: 1 });
  const enquiry = rows[0];
  if (!enquiry) return null;

  const execute = (db as { execute: (q: unknown) => Promise<unknown> }).execute.bind(db);
  const [context] = rowsOf(await execute(sql`
    SELECT r.id AS rfqId, r.title, r.category, r.status, r.createdAt, r.deadline,
           r.requesterId, req.name AS requesterName,
           v.name AS vendorName, v.accountStatus AS vendorStatus, vp.companyName AS vendorCompany
      FROM rfqs r
      LEFT JOIN users req ON req.id = r.requesterId
      LEFT JOIN users v ON v.id = ${pair.vendorId}
      LEFT JOIN vendorProfiles vp ON vp.userId = ${pair.vendorId}
     WHERE r.id = ${pair.rfqId}
  `));

  // Only events that actually happened, each from a stored timestamp. Nothing
  // is inferred, and an absent timestamp produces no entry rather than a guess.
  const timeline: EnquiryDetail['timeline'] = [];
  const add = (at: Date | null, event: string, detail: string | null = null) => {
    if (at) timeline.push({ at, event, detail });
  };
  add(enquiry.invitedAt, 'INVITED', 'The requester invited this vendor.');
  add(enquiry.viewedAt, 'VIEWED', 'The vendor opened the invitation.');
  add(enquiry.consumedAt, 'ALLOWANCE_CONSUMED',
    'One qualified-enquiry allowance unit was consumed. No payment occurs on this path.');
  add(enquiry.respondedAt, 'RESPONDED', 'The vendor submitted a quotation.');
  add(enquiry.declinedAt, 'DECLINED', 'The vendor declined the invitation.');
  timeline.sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    enquiry,
    rfq: {
      id: pair.rfqId,
      title: (context?.title as string) ?? null,
      category: (context?.category as string) ?? null,
      status: (context?.status as string) ?? null,
      createdAt: asDate(context?.createdAt),
      deadline: asDate(context?.deadline),
      requesterId: context?.requesterId == null ? null : Number(context.requesterId),
      requesterName: (context?.requesterName as string) ?? null,
    },
    vendor: {
      id: pair.vendorId,
      name: (context?.vendorName as string) ?? enquiry.vendorName,
      company: (context?.vendorCompany as string) ?? enquiry.vendorCompany,
      accountStatus: (context?.vendorStatus as string) ?? null,
    },
    timeline,
    // Injected rather than imported so this module stays free of the billing
    // engine's own dependencies; the router passes the real one.
    entitlement: usageFor ? await usageFor(pair.vendorId) : null,
  };
}
