/**
 * ── THE PROVIDER'S WORK QUEUE ─────────────────────────────────────────────
 *
 * Three defects this file exists to keep fixed, each proven against the running
 * product before the queue was written:
 *
 *   A PAID LEAD MUST NOT DISAPPEAR. The old board read `where status = 'open'`,
 *   so a request the provider had spent a credit on vanished the moment the
 *   customer closed it - while the credit stayed spent and the meter still
 *   counted it. Nothing else in the product listed it: every other
 *   provider-scoped read of `qualifiedEnquiries` is a single-row existence
 *   check or a monthly count.
 *
 *   THE COUNT AND THE ROWS ARE FILTERED IDENTICALLY, by construction, because
 *   both go through `adminPage` with one `where`. A total taken over different
 *   conditions than the page is a worse lie than no total.
 *
 *   AND NO RULE IS WRITTEN TWICE. `source` and `responseState` are SQL
 *   expressions that the list returns AND the filters compare against, so a
 *   row cannot be labelled one thing and filtered as another.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  ENQUIRY_PAGE_SIZE_DEFAULT, ENQUIRY_RESPONSE_STATES, ENQUIRY_RFQ_STATUSES, ENQUIRY_SOURCES,
  enquiryQueueSummary, listEnquiryQueue, reachableFilter,
} from './enquiryQueue';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const QUEUE = readSourceForAssertions(read('./enquiryQueue.ts'));
const ROUTERS = readSourceForAssertions(read('./routers.ts'));
const COMPONENT = readSourceForAssertions(read('../client/src/components/EnquiryQueue.tsx'));
const ENQUIRIES = readSourceForAssertions(read('./billing/enquiries.ts'));

/**
 * THE SQL THAT IS ACTUALLY PRODUCED, not the source that produces it.
 *
 * A source-text assertion about a WHERE clause passes over code that builds
 * the clause and then drops it. Rendering through the real dialect asks the
 * only question worth asking: what does the database receive.
 */
const dialect = new MySqlDialect();
const toSql = (clause: unknown) => dialect.sqlToQuery(clause as any).sql;

/**
 * A SLICE WHOSE BOUNDARIES ARE PROVEN, because an unproven one passes
 * everything.
 *
 * `indexOf` returns -1 for a marker that has moved, and `slice(start, -1)`
 * quietly returns almost the whole file while `slice(-1)` returns one
 * character. A mutation that renamed a boundary marker survived this file
 * twice over for exactly that reason: the client-side-filtering assertion was
 * running against a single character, and passed. Both markers are asserted
 * before either is used.
 */
function between(text: string, startMarker: string, endMarker?: string): string {
  const start = text.indexOf(startMarker);
  expect(start, `start marker is gone: ${startMarker}`).toBeGreaterThan(-1);
  if (endMarker === undefined) return text.slice(start);
  const end = text.indexOf(endMarker, start);
  expect(end, `end marker is gone or moved above the start: ${endMarker}`).toBeGreaterThan(start);
  return text.slice(start, end);
}

/**
 * A db double that records the query it was asked to build.
 *
 * Every chained call is captured, so a test can assert what was joined, what
 * was filtered on, and - the part that matters most here - that the count and
 * the rows got the SAME where clause rather than two that merely look alike.
 */
function fakeDb(rows: any[], total = rows.length) {
  const calls: { kind: string; args: any[] }[] = [];
  const wheres: unknown[] = [];
  let selection = 0;
  const chain = (isCount: boolean): any => {
    const self: any = {
      leftJoin: (...args: any[]) => { calls.push({ kind: 'leftJoin', args }); return self; },
      where: (clause: unknown) => { wheres.push(clause); return self; },
      groupBy: (...args: any[]) => { calls.push({ kind: 'groupBy', args }); return self; },
      orderBy: (...args: any[]) => { calls.push({ kind: 'orderBy', args }); return self; },
      limit: (value: number) => { calls.push({ kind: 'limit', args: [value] }); return self; },
      offset: (value: number) => { calls.push({ kind: 'offset', args: [value] }); return Promise.resolve(rows); },
      then: (ok: any, err: any) =>
        Promise.resolve(isCount ? [{ count: total }] : rows).then(ok, err),
    };
    return self;
  };
  return {
    calls, wheres,
    select: (projection: any) => {
      const isCount = !!projection && Object.keys(projection).length === 1 && 'count' in projection;
      selection++;
      return { from: () => chain(isCount) };
    },
    selectDistinct: () => ({ from: () => chain(false) }),
    get selections() { return selection; },
  } as any;
}

describe('what reaches a provider, and what never falls out of it', () => {
  it('THE PAID LEAD AND THE INVITATION ARE NOT LIMITED TO OPEN REQUESTS', () => {
    // The defect in one sentence: the only arm that may require `status =
    // 'open'` is the category board, because it is the only one that is an
    // offer rather than a record. Read off the SQL, where a status check
    // attached to the wrong arm would be plain to see.
    const sql = toSql(reachableFilter(['Renovation']));
    expect(sql).toBe(
      '(`qualifiedEnquiries`.`id` is not null or `rfqSuppliers`.`id` is not null'
      + ' or (`rfqs`.`status` = ? and `rfqs`.`category` in (?)))',
    );
  });

  it('and a provider with no categories still sees what was sent to them', () => {
    // An empty category list must not collapse the filter to nothing: a
    // brand-new supplier invited before declaring anything would then open an
    // empty queue containing an invitation addressed to them by name.
    expect(toSql(reachableFilter([]))).toBe(
      '(`qualifiedEnquiries`.`id` is not null or `rfqSuppliers`.`id` is not null)',
    );
  });

  it('and one placeholder per declared category, not one for the list', () => {
    // `in (?)` over an array is how a multi-category provider ends up matching
    // nothing, or matching on a string that happens to look like a list.
    expect(toSql(reachableFilter(['Renovation', 'Design', 'Finishing'])))
      .toContain('`rfqs`.`category` in (?, ?, ?)');
  });
});

describe('the count and the rows cannot disagree', () => {
  it('one where clause reaches both queries', async () => {
    const db = fakeDb([], 0);
    await listEnquiryQueue(db, { userId: 7, declaredCategories: ['Renovation'] });
    // adminPage applies the where to countQuery and rowsQuery in turn.
    expect(db.wheres.length, 'the filter was applied to only one of them').toBe(2);
    expect(db.wheres[0]).toEqual(db.wheres[1]);
  });

  it('and the pager is a real page, not a truncation', async () => {
    const db = fakeDb([], 0);
    await listEnquiryQueue(db, { userId: 7, declaredCategories: [], page: 2, pageSize: 10 });
    const limit = db.calls.find((call: any) => call.kind === 'limit');
    const offset = db.calls.find((call: any) => call.kind === 'offset');
    expect(limit?.args[0]).toBe(10);
    expect(offset?.args[0]).toBe(20);
  });

  it('a page size beyond the cap is clamped rather than honoured', async () => {
    const db = fakeDb([], 0);
    await listEnquiryQueue(db, { userId: 7, declaredCategories: [], pageSize: 10_000 });
    const limit = db.calls.find((call: any) => call.kind === 'limit');
    expect(limit?.args[0]).toBe(100);
  });

  it('the default page is a queue to work, not a feed to scroll', () => {
    expect(ENQUIRY_PAGE_SIZE_DEFAULT).toBe(20);
    expect(ENQUIRY_PAGE_SIZE_DEFAULT).toBeLessThanOrEqual(100);
  });
});

describe('every join is scoped to the caller in the ON clause', () => {
  it('all three are LEFT joins', async () => {
    const db = fakeDb([]);
    await listEnquiryQueue(db, { userId: 7, declaredCategories: ['Renovation'] });
    const joins = db.calls.filter((call: any) => call.kind === 'leftJoin');
    // Three per query, and adminPage runs two queries.
    expect(joins.length).toBe(6);
  });

  it('and the caller constraint is in the join, never in the where', () => {
    // Moving `userId = caller` to the WHERE turns a left join into an inner one
    // and drops every row the provider has NOT opened - which is most of the
    // board, and exactly the rows a work queue exists to show.
    const body = between(QUEUE, 'function joinsFor', 'export function reachableFilter');
    expect(body).toContain('eq(qualifiedEnquiries.userId, userId)');
    expect(body).toContain('eq(rfqSuppliers.supplierId, userId)');
    expect(body).toContain('eq(quotations.providerId, userId)');
    expect(body, 'a revision of a bid is counted as a second quotation')
      .toContain('isNull(quotations.supersededAt)');
  });

  it('another provider cannot appear in the joined row', () => {
    // There is no path by which a second userId reaches these joins: the
    // function takes ONE, and every join uses it.
    const body = between(QUEUE, 'function joinsFor', 'export function reachableFilter');
    expect((body.match(/userId/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(body).not.toMatch(/ctx\.|input\./);
  });
});

describe('the labels and the filters are the same rule', () => {
  it('a filter compares against the expression, not a second copy of it', () => {
    const body = between(QUEUE, 'function filterClause', 'export async function listEnquiryQueue');
    expect(body).toContain('${sourceExpression} =');
    expect(body).toContain('${responseStateExpression} =');
    // The giveaway of a copy: the filter re-deriving the rule by hand.
    expect(body, 'the source rule was restated inside the filter')
      .not.toContain('rfqSuppliers.id is not null');
  });

  it('and the summary counts the same expression the list labels rows with', () => {
    const body = between(QUEUE, 'export async function enquiryQueueSummary');
    expect(body).toContain('responseStateExpression');
    expect(body).toContain('reachableFilter(params.declaredCategories)');
  });

  it('declined is terminal, and outranks having quoted', () => {
    const expression = between(QUEUE, 'const responseStateExpression', 'function filterClause');
    const declined = expression.indexOf("'declined'");
    const quoted = expression.indexOf("'quoted'");
    expect(declined).toBeGreaterThan(-1);
    expect(quoted).toBeGreaterThan(declined);
  });

  it('an invitation outranks a category match as the source', () => {
    const expression = between(QUEUE, 'const sourceExpression', 'const responseStateExpression');
    expect(expression).toMatch(/rfqSuppliers\.id\}? is not null then 'invitation'/);
  });

  it('the vocabularies are closed, and the router uses THEM', () => {
    expect(ENQUIRY_SOURCES).toEqual(['invitation', 'category']);
    /*
     * IN PIPELINE ORDER, and it grew.
     *
     * The queue could say a supplier had QUOTED and never whether they WON -
     * the one outcome a supplier reads a pipeline for. `won`, `lost` and
     * `closed` are the three ways an answer ends, and they are kept apart on
     * purpose: a request AWARDED to somebody else is one this supplier did
     * not win, and a request the customer WITHDREW is not a competition
     * anybody lost. Saying the second as though it were the first would be a
     * fabricated outcome (§68).
     */
    expect(ENQUIRY_RESPONSE_STATES).toEqual([
      'available', 'invited', 'opened', 'quoted', 'won', 'lost', 'closed', 'unquoted', 'declined',
    ]);
    /*
     * `unquoted` IS THE NINTH, and it exists because the four decision arms
     * all require a quotation. A supplier who OPENED a lead and never bid on
     * it fell through all of them to `opened` - and stayed there after the
     * customer awarded the request to somebody else. It is NOT `lost`:
     * "Not selected" is a statement about a competition, and this supplier
     * never entered one.
     */
    expect(ENQUIRY_RESPONSE_STATES).toContain('unquoted');
    /*
     * `invited` IS THE EIGHTH, and it was added for a reason, not for
     * completeness: an invitation the supplier had never touched came back
     * as `opened`. That told them a lead was in their record that they had
     * in fact never seen, and it put an untaken offer on the same list as
     * the work they had already paid for. §23 names Invited as a canonical
     * opportunity state.
     */
    expect(ENQUIRY_RESPONSE_STATES).toContain('invited');
    // THE CLIENT READS THIS LIST, it does not keep its own. It had four
    // items while the server had seven; filtering for a won lead would have
    // been impossible from a chip row that never offered the state.
    const queueComponent = readFileSync(
      new URL('../client/src/components/EnquiryQueue.tsx', import.meta.url), 'utf8');
    expect(queueComponent).toContain("from '@shared/enquiryStates'");
    expect(queueComponent, 'the client keeps a second copy of the vocabulary')
      .not.toMatch(/const RESPONSE_STATES = \[['"]available/);
    expect(ENQUIRY_RFQ_STATUSES).toEqual(['open', 'closed', 'awarded']);
    expect(ROUTERS).toContain('z.enum(ENQUIRY_RESPONSE_STATES)');
    expect(ROUTERS).toContain('z.enum(ENQUIRY_SOURCES)');
    expect(ROUTERS).toContain('z.enum(ENQUIRY_RFQ_STATUSES)');
  });
});

describe('what a row says about money', () => {
  it('free is read from the joined row, not guessed from a plan', async () => {
    const db = fakeDb([
      { rfqId: 1, rfqStatus: 'closed', source: 'category', responseState: 'opened', openedAt: new Date(), invitedAt: null },
      { rfqId: 2, rfqStatus: 'open', source: 'invitation', responseState: 'opened', openedAt: null, invitedAt: new Date() },
      { rfqId: 3, rfqStatus: 'open', source: 'category', responseState: 'available', openedAt: null, invitedAt: null },
    ], 3);
    const page = await listEnquiryQueue(db, { userId: 7, declaredCategories: ['Renovation'] });
    expect(page.rows.map(row => row.free), 'a paid lead or an invitation is not free')
      .toEqual([true, true, false]);
  });

  it('and a closed request that was paid for is still in the page', async () => {
    const db = fakeDb([
      { rfqId: 1, rfqStatus: 'closed', source: 'category', responseState: 'opened', openedAt: new Date(), invitedAt: null },
    ], 1);
    const page = await listEnquiryQueue(db, { userId: 7, declaredCategories: [] });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].rfqStatus).toBe('closed');
    expect(page.rows[0].openedAt).not.toBeNull();
  });

  it('the summary totals what it counted, rather than a separate number', async () => {
    const db = fakeDb([
      { state: 'available', count: 4 },
      { state: 'opened', count: 2 },
      { state: 'quoted', count: 1 },
    ]);
    const summary = await enquiryQueueSummary(db, { userId: 7, declaredCategories: ['Renovation'] });
    expect(summary.total).toBe(7);
    expect(summary.available).toBe(4);
    expect(summary.declined).toBe(0);
  });
});

describe('the search a provider actually performs', () => {
  it('a reference matches the request id, not the digits inside a title', () => {
    const body = between(QUEUE, 'function filterClause', 'export async function listEnquiryQueue');
    expect(body).toMatch(/\/\^#\?\\d\+\$\//);
    expect(body).toContain('eq(rfqs.id, numeric)');
  });

  it('and the one canonical LIKE escaper is used', () => {
    // `containsTerm` is the single place `%` and `_` are escaped. A second
    // escaper is how one of them stops escaping.
    expect(QUEUE).toContain("from './_core/searchTerms'");
    expect(QUEUE).toContain('containsTerm(term)');
    expect(QUEUE).toContain('MAX_SEARCH_LENGTH');
    expect(QUEUE, 'a second LIKE pattern was built by hand').not.toMatch(/`%\$\{/);
  });
});

describe('the truncating helper it replaced is gone, not merely unused', () => {
  it('listEligibleRfqs no longer exists', () => {
    // It returned a bare array capped at 50 with no total. Leaving it in place
    // for "compatibility" leaves the defect one import away.
    expect(ENQUIRIES).not.toContain('listEligibleRfqs');
    expect(ROUTERS).not.toContain('listEligibleRfqs');
  });

  it('and the dashboard card is served by the queue, with a real total', () => {
    const eligible = between(ROUTERS, 'eligible: approvedProviderProcedure', 'queue: approvedProviderProcedure');
    expect(eligible.length, 'the slice boundaries moved').toBeGreaterThan(100);
    expect(eligible).toContain('listEnquiryQueue');
    /*
     * SCOPED TO WHAT CAN STILL BE TAKEN, which is what the procedure claims.
     *
     * It read `rfqStatus: 'open'`, and that is NOT the same question: an open
     * request this provider had already opened, quoted and WON came back in a
     * list titled "the open requests this provider can act on now". On
     * `/enquiries` that list sat directly above the full queue, so the same
     * requests rendered twice on one screen in two different vocabularies.
     */
    expect(eligible).toContain("scope: 'opportunities'");
    expect(eligible, 'the eligible list is back to filtering on RFQ status')
      .not.toContain("rfqStatus: 'open'");
    expect(eligible).toContain('total: page.total');
  });
});

describe('the screen does not reintroduce what the server just fixed', () => {
  it('every filter is sent to the server', () => {
    const input = between(COMPONENT, 'trpc.rfq.queue.useQuery', '});');
    expect(input.length, 'the slice boundaries moved - an empty string matches nothing')
      .toBeGreaterThan(80);
    for (const field of ['page', 'responseState', 'rfqStatus', 'source', 'category', 'search']) {
      // `page,` is shorthand for `page: page`; both are the field being sent.
      expect(input, `${field} is not sent to the server`)
        .toMatch(new RegExp(`\\b${field}\\s*[,:]`));
    }
    // `search` carries the DEBOUNCED value - one request per pause, not one per
    // keystroke - so it is named here rather than assumed to equal its field.
    expect(input).toContain('search: debounced || undefined');
  });

  it('and nothing is filtered in the browser over one page', () => {
    // Asserted over the WHOLE component, not a slice: a slice anchored on the
    // very line a mutation rewrites is a slice that disappears with it.
    expect(COMPONENT, 'a page of rows is being filtered client-side')
      .not.toMatch(/rows[^\n]*\.filter\(/);
    expect(between(COMPONENT, 'const rows = queue.data', 'const total'))
      .toContain('queue.data?.rows ?? []');
  });

  it('the real total is rendered, and the pager is driven by it', () => {
    expect(COMPONENT).toContain('data-testid="enquiry-queue-total"');
    expect(COMPONENT).toContain('Math.ceil(total / pageSize)');
  });

  it('"no match" and "nothing has reached you" are different sentences', () => {
    const empty = between(COMPONENT, 'data-testid="enquiry-queue-empty"', 'enquiry-queue-rows');
    expect(empty).toContain('filtering');
    expect(empty).toMatch(/No request matches this filter/);
    // The unfiltered sentence is now per scope - "no opportunities" and "you
    // have taken nothing yet" are also different facts, and a provider shown
    // the wrong one reads a full pipeline as an empty marketplace.
    expect(empty).toContain('copy.empty');
    expect(COMPONENT).toMatch(/No open opportunities right now/);
    expect(COMPONENT).toMatch(/You have not taken a request yet/);
  });

  it('and each half offers only the chips that can return a row', () => {
    // A "Available" chip over My Leads can never match: available is an
    // opportunity state. A filter that cannot succeed is a dead control (§13).
    expect(COMPONENT).toContain('ENQUIRY_OPPORTUNITY_STATES');
    expect(COMPONENT).toContain('ENQUIRY_LEAD_STATES');
    expect(COMPONENT, 'the chip row renders the whole vocabulary again')
      .not.toMatch(/ENQUIRY_RESPONSE_STATES\.map/);
  });

  it('and a closed request is not offered a respond button', () => {
    // The dead control ELIG removed from the page this one points at.
    expect(COMPONENT).toContain("row.rfqStatus === 'open' && row.responseState !== 'declined'");
  });

  it('the deep link preselects the search instead of hoping for page one', () => {
    // The old card scrolled to the row if it happened to be among the 50 it had
    // loaded, and did nothing at all if it was not.
    expect(COMPONENT).toContain('highlightRfqId ? `#${highlightRfqId}` : ');
  });
});
