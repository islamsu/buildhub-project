/**
 * THE LIST'S THREE WAYS TO GO WRONG.
 *
 *   1. A sort parameter reaching ORDER BY as text. It is the one place user
 *      input CANNOT be a bound parameter, so it has to be an allowlist.
 *   2. A search term reaching the SQL as text rather than as a parameter.
 *   3. A price reaching the response. Whether a vendor answered is the state;
 *      what they bid is not an administrator's to browse in bulk.
 *
 * The paging, filtering and cost are proved against a real server and a real
 * MariaDB in evidence/zg-enquirylist.mjs - including the query count, measured
 * with MariaDB's own general log rather than asserted from the source.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ENQUIRY_LIST_MAX_LIMIT, ENQUIRY_SORTS, enquiryList } from './vendorEnquiryQuery';

const SOURCE = readFileSync(new URL('./vendorEnquiryQuery.ts', import.meta.url), 'utf8');

/**
 * A driver that keeps the SQL objects it was handed, so a test can ask whether
 * a value arrived as TEXT or as a PARAMETER - the distinction the whole
 * injection question turns on.
 *
 * THE SHAPE BELOW WAS READ OFF A REAL DRIZZLE SQL OBJECT, not assumed. The
 * first version guessed that literals are StringChunks with a string `value`
 * and that bound values are Param objects; both are wrong, and the test failed
 * on its own instrument rather than on the code. What is actually there:
 *
 *   - a StringChunk's `value` is an ARRAY of strings, not a string;
 *   - a bound value sits in queryChunks as a RAW PRIMITIVE (4242, "%term%") and
 *     only becomes a parameter when the dialect compiles the statement;
 *   - queryChunks nest: an SQL object's chunks can be further SQL objects.
 *
 * So "text" means every StringChunk, recursively, and "parameter" means every
 * primitive that is not one.
 */
function recordingDb(pageRows: Record<string, unknown>[] = [], total = 0) {
  const seen: unknown[] = [];
  let call = 0;

  const isSql = (node: any) => Array.isArray(node?.queryChunks);
  const isStringChunk = (node: any) => Array.isArray(node?.value)
    && node.value.every((v: unknown) => typeof v === 'string');

  const collect = (node: any, text: string[], params: unknown[]): void => {
    if (!isSql(node)) return;
    for (const chunk of node.queryChunks) {
      if (isSql(chunk)) collect(chunk, text, params);
      else if (isStringChunk(chunk)) text.push(chunk.value.join(''));
      else params.push(chunk);
    }
  };

  const both = () => {
    const text: string[] = [];
    const params: unknown[] = [];
    for (const query of seen) collect(query, text, params);
    return { text: text.join(' '), params };
  };

  return {
    db: {
      execute: async (query: unknown) => {
        seen.push(query);
        return call++ === 0 ? [pageRows] : [[{ total }]];
      },
    },
    rawText: () => both().text,
    params: () => both().params,
    count: () => seen.length,
  };
}

describe('user input never becomes SQL text', () => {
  it('a search term is BOUND, not interpolated', async () => {
    const hostile = "'; DROP TABLE rfqs; --";
    const rec = recordingDb();
    await enquiryList(rec.db, { search: hostile });
    expect(rec.rawText(), 'the term must not appear as SQL text').not.toContain('DROP TABLE');
    expect(rec.params().some(v => typeof v === 'string' && v.includes('DROP TABLE')),
      'the term must appear as a bound parameter').toBe(true);
  });

  it('an id filter is bound too', async () => {
    const rec = recordingDb();
    await enquiryList(rec.db, { vendorId: 4242 });
    expect(rec.params()).toContain(4242);
  });

  it('THE SORT IS AN ALLOWLIST, because it cannot be a parameter', () => {
    // ORDER BY takes an expression, not a value, so this is the one input that
    // reaches the statement as text - and therefore the one that must never
    // come from the caller unchecked.
    expect(Object.keys(ENQUIRY_SORTS).sort())
      .toEqual(['activity', 'assignee', 'rfq', 'state', 'vendor']);
    for (const expression of Object.values(ENQUIRY_SORTS)) {
      expect(expression).toMatch(/^[A-Za-z0-9_.,()\s]+$/);
    }
  });

  it('the direction is a choice of two, never passed through', async () => {
    const rec = recordingDb();
    await enquiryList(rec.db, { direction: 'asc' });
    expect(rec.rawText()).toContain('ASC');
    const rec2 = recordingDb();
    await enquiryList(rec2.db, {});
    expect(rec2.rawText()).toContain('DESC');
  });
});

describe('the page is bounded whatever the caller asks for', () => {
  it('clamps an oversized limit', async () => {
    const rec = recordingDb();
    const result = await enquiryList(rec.db, { limit: 100000 });
    expect(result.limit).toBe(ENQUIRY_LIST_MAX_LIMIT);
  });

  it('refuses a negative offset rather than producing a SQL error', async () => {
    const rec = recordingDb();
    const result = await enquiryList(rec.db, { offset: -50 });
    expect(result.offset).toBe(0);
  });

  it('costs TWO queries - the page and its count - regardless of rows', async () => {
    const rows = Array.from({ length: 60 }, (_unused, i) => ({
      rfqId: i + 1, vendorId: 9, rfqStatus: 'open', invitationStatus: 'invited',
      creditSpent: 0, hasQuotation: 0, rfqTitle: 't', vendorName: 'v', state: 'INVITED',
    }));
    const rec = recordingDb(rows, 60);
    await enquiryList(rec.db, { limit: 100 });
    expect(rec.count()).toBe(2);
  });
});

describe('what a row may and may not carry', () => {
  it('THE SELECT LISTS NO PRICE, TOTAL OR CURRENCY', () => {
    const select = SOURCE.slice(SOURCE.indexOf('const LIST_SELECT'), SOURCE.indexOf('const LIST_FROM'));
    for (const forbidden of ['price', 'total', 'currency', 'paymentTerms', 'commercialTerms']) {
      expect(select.toLowerCase(), `a list row must not carry ${forbidden}`)
        .not.toContain(forbidden.toLowerCase());
    }
  });

  it('carries the human reference and the derived state', async () => {
    const rec = recordingDb([{
      rfqId: 501, vendorId: 10, rfqStatus: 'open', invitationStatus: 'invited',
      creditSpent: 0, hasQuotation: 0, rfqTitle: 'Rebar', vendorName: 'Alpha', state: 'INVITED',
    }], 1);
    const { rows } = await enquiryList(rec.db, {});
    expect(rows[0].reference).toBe('ENQ-501-10');
    expect(rows[0].state).toBe('INVITED');
    expect(rows[0].usageReason).toBe('INVITATION_EXEMPT');
    expect(rows[0]).not.toHaveProperty('price');
  });

  it('REFUSES A ROW WHOSE SQL STATE CONTRADICTS THE DERIVATION', async () => {
    // The silent failure this prevents: a row returned BY a state filter and
    // then rendered with a different badge. Better to fail than to show it.
    const rec = recordingDb([{
      rfqId: 1, vendorId: 2, rfqStatus: 'open', invitationStatus: 'invited',
      creditSpent: 0, hasQuotation: 0, state: 'RESPONDED',
    }], 1);
    await expect(enquiryList(rec.db, {})).rejects.toThrow(/state disagreement/);
  });
});

describe('the detail assembles context without widening the permission', () => {
  const detailDb = (enquiryRow: Record<string, unknown> | null, context: Record<string, unknown> = {}) => {
    let call = 0;
    return {
      execute: async () => {
        call += 1;
        if (call === 1) return [enquiryRow ? [enquiryRow] : []];   // the page
        if (call === 2) return [[{ total: enquiryRow ? 1 : 0 }]];  // its count
        return [[context]];                                       // the context row
      },
    };
  };

  const row = (over: Record<string, unknown> = {}) => ({
    rfqId: 7, vendorId: 3, rfqStatus: 'open', invitationStatus: 'invited',
    creditSpent: 0, hasQuotation: 0, state: 'INVITED',
    rfqTitle: 'Rebar', vendorName: 'Alpha', ...over,
  });

  it('returns null for a pair nothing ever happened to', async () => {
    const { enquiryDetail } = await import('./vendorEnquiryQuery');
    expect(await enquiryDetail(detailDb(null), { rfqId: 7, vendorId: 3 })).toBeNull();
  });

  it('THE TIMELINE ONLY CARRIES EVENTS THAT HAVE A REAL TIMESTAMP', async () => {
    // The failure this prevents is a fabricated history: an enquiry that was
    // never viewed showing a "viewed" entry because the screen assumed one.
    const { enquiryDetail } = await import('./vendorEnquiryQuery');
    const invitedAt = new Date('2026-01-02T10:00:00Z');
    const detail = await enquiryDetail(detailDb(row({ invitedAt })), { rfqId: 7, vendorId: 3 });
    expect(detail?.timeline.map(e => e.event)).toEqual(['INVITED']);
  });

  it('orders the timeline oldest first', async () => {
    const { enquiryDetail } = await import('./vendorEnquiryQuery');
    const detail = await enquiryDetail(detailDb(row({
      invitedAt: new Date('2026-01-03T10:00:00Z'),
      viewedAt: new Date('2026-01-01T10:00:00Z'),
    })), { rfqId: 7, vendorId: 3 });
    expect(detail?.timeline.map(e => e.event)).toEqual(['VIEWED', 'INVITED']);
  });

  it('takes the entitlement from the engine it is given, never recomputing one', async () => {
    const { enquiryDetail } = await import('./vendorEnquiryQuery');
    const usage = {
      used: 4, allowance: 5, remaining: 1,
      periodKey: '2026-01', resetsAt: new Date('2026-02-01T00:00:00Z'),
    };
    const detail = await enquiryDetail(detailDb(row()), { rfqId: 7, vendorId: 3 }, async () => usage);
    expect(detail?.entitlement).toEqual(usage);
  });

  it('reports no entitlement rather than a zero when none was supplied', async () => {
    // A zero would read as "this vendor has used nothing", which is a claim.
    const { enquiryDetail } = await import('./vendorEnquiryQuery');
    const detail = await enquiryDetail(detailDb(row()), { rfqId: 7, vendorId: 3 });
    expect(detail?.entitlement).toBeNull();
  });

  it('THE CONTEXT QUERY SELECTS NO BID CONTENT AND NO BUDGET', () => {
    const block = SOURCE.slice(SOURCE.indexOf('export async function enquiryDetail'));
    for (const forbidden of ['price', 'budget', 'paymentTerms', 'commercialTerms', 'warranty']) {
      expect(block.toLowerCase(), `the detail must not select ${forbidden}`)
        .not.toContain(forbidden.toLowerCase());
    }
  });
});
