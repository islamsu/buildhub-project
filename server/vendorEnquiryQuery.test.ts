/**
 * ONE LADDER, TWO RENDERINGS.
 *
 * The overview counts states in SQL and every other surface derives them in
 * TypeScript. That is only safe while both come from ENQUIRY_STATE_RULES, so
 * these tests assert the GENERATION rather than the output: that every rule
 * reaches the CASE, in order, and that the CASE cannot be edited independently
 * of the list.
 *
 * The two ladders are additionally compared against each other over all 80
 * evidence combinations, against a real MariaDB, by
 * evidence/zg-enquiryderivation.mjs - because "the same array produced both"
 * still does not prove MySQL and JavaScript agree about NULL and collation.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_ENQUIRY_STATE,
  ENQUIRY_STATE_RULES,
  ENQUIRY_STATES,
} from './vendorEnquiry';
import { UNIVERSE_COLUMNS, enquiryStateSql, enquiryOverview } from './vendorEnquiryQuery';

describe('the SQL ladder is generated from the rule list, never written twice', () => {
  it('emits one WHEN per rule, in the list order', () => {
    const emitted = [...enquiryStateSql().matchAll(/WHEN .+? THEN '(\w+)'/g)].map(m => m[1]);
    expect(emitted).toEqual(ENQUIRY_STATE_RULES.map(r => r.state));
  });

  it('falls through to the same default the function does', () => {
    expect(enquiryStateSql()).toContain(`ELSE '${DEFAULT_ENQUIRY_STATE}' END`);
  });

  it('every state it can emit is a declared state', () => {
    const emitted = [...enquiryStateSql().matchAll(/'(\w+)'/g)].map(m => m[1]);
    for (const value of emitted) {
      // The rule expressions also quote column values like 'declined'; only the
      // uppercase ones are states.
      if (value === value.toUpperCase()) {
        expect(ENQUIRY_STATES as readonly string[], `${value} is emitted but not declared`)
          .toContain(value);
      }
    }
  });

  it('reads the evidence through the aliases the universe query actually defines', () => {
    const sql = enquiryStateSql();
    for (const column of Object.values(UNIVERSE_COLUMNS)) {
      expect(sql, `${column} must be the name both sides use`).toContain(column);
    }
  });

  it('THE CASE IS NOT HAND-WRITTEN ANYWHERE - that would be the second ladder', () => {
    const source = readFileSync(new URL('./vendorEnquiryQuery.ts', import.meta.url), 'utf8');
    // A literal WHEN ... THEN 'STATE' in the source means somebody typed a rung
    // instead of adding it to ENQUIRY_STATE_RULES.
    const handWritten = source.match(/WHEN\s+[^\n]*THEN\s+'[A-Z_]+'/g) ?? [];
    expect(handWritten).toEqual([]);
  });
});

describe('the overview reports real counts and refuses to fudge', () => {
  const fakeDb = (stateRows: unknown[], reach = [{ vendors: 3, rfqs: 2 }], consumed = [{ total: 7 }]) => {
    const responses = [[stateRows], [reach], [consumed]];
    let call = 0;
    return { execute: async () => responses[call++] };
  };

  it('fills every declared state with a zero rather than omitting it', async () => {
    const result = await enquiryOverview(fakeDb([{ state: 'INVITED', total: 4 }]));
    expect(Object.keys(result.byState).sort()).toEqual([...ENQUIRY_STATES].sort());
    expect(result.byState.INVITED).toBe(4);
    expect(result.byState.CLOSED).toBe(0);
  });

  it('the total is the sum of the states, not a separately counted number', async () => {
    const result = await enquiryOverview(fakeDb([
      { state: 'INVITED', total: 4 }, { state: 'CLOSED', total: 6 },
    ]));
    expect(result.total).toBe(10);
  });

  it('REFUSES a state it does not recognise instead of silently dropping it', async () => {
    // Dropping it would make byState and total disagree by exactly the number of
    // enquiries nobody can see - the most misleading possible failure.
    await expect(enquiryOverview(fakeDb([{ state: 'ARCHIVED', total: 3 }])))
      .rejects.toThrow(/unknown derived enquiry state: ARCHIVED/);
  });

  it('reports allowance consumption as a count of real rows', async () => {
    const result = await enquiryOverview(fakeDb([], [{ vendors: 3, rfqs: 2 }], [{ total: 7 }]));
    expect(result.consumedAllowanceUnits).toBe(7);
    expect(result.vendors).toBe(3);
    expect(result.rfqs).toBe(2);
  });

  it('an empty platform is zeroes, not nulls or absent fields', async () => {
    const result = await enquiryOverview(fakeDb([], [{ vendors: 0, rfqs: 0 }], [{ total: 0 }]));
    expect(result.total).toBe(0);
    expect(Object.values(result.byState).every(v => v === 0)).toBe(true);
  });
});

describe('the universe is the union of what actually happened', () => {
  const source = readFileSync(new URL('./vendorEnquiryQuery.ts', import.meta.url), 'utf8');

  it('draws from all three tables that record an enquiry event', () => {
    for (const table of ['rfqSuppliers', 'qualifiedEnquiries', 'quotations']) {
      expect(source).toContain(`FROM ${table}`);
    }
  });

  it('uses EXISTS for the many-row tables, so one pair stays one row', () => {
    // A vendor may hold two quotations on one RFQ; joining would count the pair
    // twice. Proven against a real second quotation in
    // evidence/zg-enquiryoverview.mjs.
    expect(source).toMatch(/EXISTS \(SELECT 1 FROM qualifiedEnquiries/);
    expect(source).toMatch(/EXISTS \(SELECT 1 FROM quotations/);
  });
});
