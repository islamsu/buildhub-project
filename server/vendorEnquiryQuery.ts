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
import { sql } from 'drizzle-orm';
import {
  DEFAULT_ENQUIRY_STATE,
  ENQUIRY_STATE_RULES,
  ENQUIRY_STATES,
  type EnquiryState,
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
 * mysql2 hands back [rows, fields]; drizzle's execute passes that through.
 * Written once because getting it wrong yields an empty result rather than an
 * error, and an overview of all-zeroes looks exactly like a quiet marketplace.
 */
function rowsOf(result: unknown): Record<string, unknown>[] {
  const first = Array.isArray(result) ? result[0] : result;
  return Array.isArray(first) ? first as Record<string, unknown>[] : [];
}
