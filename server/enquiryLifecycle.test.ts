/**
 * ── A TERMINAL REQUEST IS NOT AN ACTIONABLE LEAD ────────────────────────
 *
 * THE DEFECT. Every arm of the state expression that consulted `rfqs.status`
 * ALSO required a quotation:
 *
 *   when quotations.id is not null and rfqs.status = 'awarded' then 'lost'
 *   when quotations.id is not null and rfqs.status = 'closed'  then 'closed'
 *
 * So a supplier who OPENED a lead - spending a credit on it - and never bid
 * fell straight through both to `opened`, and stayed there for good. The
 * customer withdrew the request three weeks ago, or awarded it to somebody
 * else, and the supplier's pipeline still showed a lead waiting for them to
 * act on. Worse for an INVITATION never touched: it sat in the Opportunity
 * Centre being offered as takeable, with an "Open enquiry" button that could
 * only ever fail.
 *
 * THE FIX IS ARM ORDER, which is why this file asserts order rather than
 * merely asserting that the states exist. Two arms, placed after every
 * quotation arm and before `opened`/`invited`:
 *
 *   closed     the customer WITHDREW it. True whether or not this supplier
 *              quoted - the fact reported is what the customer did.
 *   unquoted   AWARDED, and this supplier has no quotation on it.
 *
 * `unquoted` IS NOT `lost`. "Not selected" is a statement about a
 * competition, and a supplier who never bid did not enter one. Telling them
 * they were beaten would be a fabricated outcome (§68) - and it is the kind
 * a supplier acts on, by writing off a customer who never rejected them.
 *
 * `declined` still outranks both: it is the supplier's own recorded decision
 * and a later award does not rewrite it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ENQUIRY_LEAD_STATES, ENQUIRY_OPPORTUNITY_STATES, ENQUIRY_RESPONSE_STATES,
  enquiryStateLabel, enquiryStateTone, statesForScope,
} from '../shared/enquiryStates';
import { readSourceForAssertions } from './_testing/sourceText';

const QUEUE = readSourceForAssertions(
  readFileSync(new URL('./enquiryQueue.ts', import.meta.url), 'utf8'),
);

/** The CASE expression, as arms, in the order the database evaluates them. */
const ARMS = (() => {
  const start = QUEUE.indexOf('const responseStateExpression');
  const end = QUEUE.indexOf("else 'available' end", start);
  expect(start, 'the state expression moved').toBeGreaterThan(-1);
  expect(end, 'the state expression moved').toBeGreaterThan(start);
  return QUEUE.slice(start, end)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('when '));
})();

/** Index of the first arm that RESOLVES TO this state. -1 when absent. */
const armFor = (state: string) => ARMS.findIndex(arm => arm.endsWith(`then '${state}'`));
/** Index of the first arm matching a fragment of its CONDITION. */
const armWhere = (fragment: string) => ARMS.findIndex(arm => arm.includes(fragment));

describe('the arms exist and are ordered so a terminal outcome wins', () => {
  it('the expression still has the shape this file reasons about', () => {
    // A slice that silently became empty would make every ordering assertion
    // below a statement about nothing.
    expect(ARMS.length).toBeGreaterThanOrEqual(8);
    expect(armFor('declined')).toBeGreaterThan(-1);
    expect(armFor('won')).toBeGreaterThan(-1);
    expect(armFor('lost')).toBeGreaterThan(-1);
    expect(armFor('quoted')).toBeGreaterThan(-1);
    expect(armFor('opened')).toBeGreaterThan(-1);
    expect(armFor('invited')).toBeGreaterThan(-1);
  });

  it('THERE IS AN ARM FOR A WITHDRAWN REQUEST THAT DOES NOT REQUIRE A QUOTATION', () => {
    // The defect in one assertion: before this, EVERY arm mentioning
    // rfqs.status also mentioned quotations.
    const quotationFree = ARMS.filter(arm =>
      arm.includes('status} = \'closed\'') && !arm.includes('quotations'));
    expect(quotationFree.length,
      'a withdrawn request is only recognised when the supplier quoted').toBeGreaterThan(0);
    expect(quotationFree[0]).toMatch(/then 'closed'$/);
  });

  it('AND ONE FOR AN AWARDED REQUEST THIS SUPPLIER NEVER BID ON', () => {
    const quotationFree = ARMS.filter(arm =>
      arm.includes('status} = \'awarded\'') && !arm.includes('quotations'));
    expect(quotationFree.length).toBeGreaterThan(0);
    expect(quotationFree[0]).toMatch(/then 'unquoted'$/);
  });

  it('both are evaluated BEFORE opened and invited, which is the whole fix', () => {
    // Placed after, they would never be reached: `opened` matches first and
    // the row keeps an actionable state over a request that has concluded.
    const terminalClosed = armFor('closed');
    const terminalUnquoted = armFor('unquoted');
    const opened = armFor('opened');
    const invited = armFor('invited');
    expect(terminalUnquoted, 'unquoted is unreachable behind opened').toBeLessThan(opened);
    expect(terminalUnquoted, 'unquoted is unreachable behind invited').toBeLessThan(invited);
    // `closed` first appears on the quoted arm, so the quotation-free one is
    // what has to sit ahead of `opened`.
    const quotationFreeClosed = ARMS.findIndex(arm =>
      arm.includes("status} = 'closed'") && !arm.includes('quotations'));
    expect(quotationFreeClosed).toBeLessThan(opened);
    expect(quotationFreeClosed).toBeLessThan(invited);
    expect(terminalClosed).toBeGreaterThan(-1);
  });

  it('and AFTER every quotation arm, so Won and Not selected still win', () => {
    // A supplier who quoted and WON must not be told the request was simply
    // awarded; a supplier who quoted and lost must not be told they never bid.
    const quotationArms = ARMS
      .map((arm, index) => ({ arm, index }))
      .filter(entry => entry.arm.includes('quotations'));
    expect(quotationArms.length).toBeGreaterThanOrEqual(4);
    const lastQuotationArm = Math.max(...quotationArms.map(entry => entry.index));
    expect(armFor('unquoted')).toBeGreaterThan(lastQuotationArm);
    expect(armFor('won')).toBeLessThan(armFor('unquoted'));
    expect(armFor('lost')).toBeLessThan(armFor('unquoted'));
    expect(armFor('quoted')).toBeLessThan(armFor('unquoted'));
  });

  it("and AFTER declined, because a later award does not rewrite the supplier's own decision", () => {
    expect(armFor('declined')).toBe(0);
    expect(armFor('declined')).toBeLessThan(armFor('unquoted'));
  });

  it('the terminal arms read rfqs.status, not a stored column copied at write time', () => {
    // The status is derived from the request itself on every read, so a
    // customer withdrawing a request changes the supplier's pipeline without
    // anything having to run.
    expect(armWhere("${rfqs.status} = 'closed'")).toBeGreaterThan(-1);
    expect(armWhere("${rfqs.status} = 'awarded'")).toBeGreaterThan(-1);
  });
});

describe('the distinctions the supplier reads are preserved', () => {
  it('Won, Not selected, Request withdrawn and Did not quote are four different sentences', () => {
    const labels = ['won', 'lost', 'closed', 'unquoted'].map(state => enquiryStateLabel(state, 'en'));
    expect(new Set(labels).size, 'two outcomes share a label').toBe(4);
    expect(enquiryStateLabel('won', 'en')).toBe('Won');
    expect(enquiryStateLabel('lost', 'en')).toBe('Not selected');
    expect(enquiryStateLabel('closed', 'en')).toBe('Request withdrawn');
    expect(enquiryStateLabel('unquoted', 'en')).toBe('Did not quote');
  });

  it('and "Did not quote" never claims the supplier was beaten', () => {
    for (const lang of ['en', 'ar'] as const) {
      const label = enquiryStateLabel('unquoted', lang);
      expect(label).not.toMatch(/selected|lost|rejected|خسر|مرفوض/i);
    }
    expect(enquiryStateLabel('unquoted', 'ar')).toMatch(/[؀-ۿ]/);
  });

  it('a terminal outcome is never given the emphasis Won carries', () => {
    expect(enquiryStateTone('won')).toBe('positive');
    for (const state of ['lost', 'closed', 'unquoted', 'declined']) {
      expect(enquiryStateTone(state), state).toBe('muted');
    }
  });
});

describe('a concluded request leaves the Opportunity Centre', () => {
  it('unquoted is a LEAD state, not an opportunity', () => {
    // Offering an awarded request as takeable is a control that cannot
    // succeed - the open action would be refused by the server every time.
    expect(ENQUIRY_LEAD_STATES).toContain('unquoted');
    expect(ENQUIRY_OPPORTUNITY_STATES).not.toContain('unquoted');
  });

  it('and so is closed, even when the supplier never touched the request', () => {
    // An invitation nobody opened, on a request the customer has withdrawn,
    // is not an opportunity. The split asks "can this still be taken", not
    // "did you touch it".
    expect(ENQUIRY_LEAD_STATES).toContain('closed');
    expect(ENQUIRY_OPPORTUNITY_STATES).not.toContain('closed');
  });

  it('the Opportunity Centre holds ONLY states a live request can be in', () => {
    // available and invited are the two, and both of the terminal states are
    // excluded by construction rather than by a second filter somewhere.
    expect([...ENQUIRY_OPPORTUNITY_STATES].sort()).toEqual(['available', 'invited']);
  });

  it('and the partition still covers the new state', () => {
    const opportunity = new Set<string>(ENQUIRY_OPPORTUNITY_STATES);
    const lead = new Set<string>(ENQUIRY_LEAD_STATES);
    for (const state of ENQUIRY_RESPONSE_STATES) {
      expect([opportunity.has(state), lead.has(state)].filter(Boolean).length, state).toBe(1);
    }
    expect(statesForScope('leads')).toContain('unquoted');
  });
});
