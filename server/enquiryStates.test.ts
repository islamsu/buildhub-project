/**
 * ── THE PARTITION, AND WHY IT IS A TEST RATHER THAN A COMMENT ────────────
 *
 * `/enquiries` used to render two cards over the same rows: a "Qualified
 * enquiries" list above a "Work queue", both reading the same requests, so a
 * real provider's screen showed the same six requests twice in two different
 * vocabularies. Nothing was missing; everything was doubled, which is worse,
 * because the reader has to work out whether the two lists disagree before
 * they can trust either.
 *
 * The fix is one query split by a scope. That only holds if the two state
 * sets PARTITION the vocabulary:
 *
 *   A GAP hides a request from the provider completely - it is in the queue,
 *   in neither view, and nothing on the screen says so.
 *   AN OVERLAP puts it back on the screen twice, which is the defect the
 *   split exists to end.
 *
 * Neither is visible by reading the two literals; both are one assertion
 * away. So adding a ninth state without placing it in exactly one half fails
 * here rather than quietly shipping.
 */
import { describe, expect, it } from 'vitest';
import {
  ENQUIRY_LEAD_STATES, ENQUIRY_OPPORTUNITY_STATES, ENQUIRY_RESPONSE_STATES,
  ENQUIRY_SCOPES, enquiryStateLabel, enquiryStateTone, isEnquiryResponseState,
  statesForScope,
} from '../shared/enquiryStates';

describe('the two halves of /enquiries partition the vocabulary', () => {
  it('every state is in exactly one half', () => {
    const opportunity = new Set<string>(ENQUIRY_OPPORTUNITY_STATES);
    const lead = new Set<string>(ENQUIRY_LEAD_STATES);
    for (const state of ENQUIRY_RESPONSE_STATES) {
      const halves = [opportunity.has(state), lead.has(state)].filter(Boolean).length;
      expect(halves, `${state} is in ${halves} halves, not 1`).toBe(1);
    }
  });

  it('and neither half invents a state the queue cannot return', () => {
    for (const state of [...ENQUIRY_OPPORTUNITY_STATES, ...ENQUIRY_LEAD_STATES]) {
      expect(isEnquiryResponseState(state), `${state} is not a queue state`).toBe(true);
    }
  });

  it('the two halves together are the whole vocabulary', () => {
    expect([...ENQUIRY_OPPORTUNITY_STATES, ...ENQUIRY_LEAD_STATES].sort())
      .toEqual([...ENQUIRY_RESPONSE_STATES].sort());
  });

  it('`all` is every state, not an empty filter', () => {
    // An empty array here would be compiled into `in ()`, which matches
    // nothing - the whole queue would render as empty rather than as whole.
    expect(statesForScope('all')).toEqual(ENQUIRY_RESPONSE_STATES);
    expect(statesForScope('all').length).toBeGreaterThan(0);
  });

  it('every scope resolves to a non-empty set', () => {
    for (const scope of ENQUIRY_SCOPES) {
      expect(statesForScope(scope).length, `${scope} resolves to nothing`).toBeGreaterThan(0);
    }
  });
});

describe('an untaken invitation is an opportunity, not a lead', () => {
  it('`invited` sits on the opportunity side', () => {
    // It used to fall into `opened`, which told a provider a lead was in
    // their record that they had never seen - and put an offer they had not
    // taken onto the same list as work they had paid for.
    expect(ENQUIRY_OPPORTUNITY_STATES).toContain('invited');
    expect(ENQUIRY_LEAD_STATES).not.toContain('invited');
  });

  it('and opening it moves it across, because `opened` is a lead', () => {
    // `markInvitationViewed` advances rfqSuppliers.status off 'invited' the
    // moment the provider opens the request, and the CASE checks
    // qualifiedEnquiries before the invitation - so a taken invitation reads
    // `opened` and leaves the Opportunity Centre. Without that, an invitation
    // would sit in "what you can still take" forever.
    expect(ENQUIRY_LEAD_STATES).toContain('opened');
    expect(ENQUIRY_OPPORTUNITY_STATES).not.toContain('opened');
  });
});

describe('every state is said in both languages', () => {
  it('no state falls through to its own raw enum', () => {
    // §55: no raw enums in user-facing copy. The label function's default arm
    // returns the state itself, so a forgotten state renders as "won" or
    // "rfq_closed" in the middle of an Arabic screen.
    for (const state of ENQUIRY_RESPONSE_STATES) {
      for (const lang of ['en', 'ar'] as const) {
        const label = enquiryStateLabel(state, lang);
        expect(label, `${state}/${lang} has no label`).not.toBe(state);
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });

  it('and the Arabic label is actually Arabic', () => {
    for (const state of ENQUIRY_RESPONSE_STATES) {
      expect(enquiryStateLabel(state, 'ar'), `${state} is not translated`)
        .toMatch(/[؀-ۿ]/);
    }
  });

  it('no two states share a label in either language', () => {
    // Two states rendering the same word is a pipeline the provider cannot
    // read: the chip says one thing and the row says the same thing twice.
    for (const lang of ['en', 'ar'] as const) {
      const labels = ENQUIRY_RESPONSE_STATES.map(state => enquiryStateLabel(state, lang));
      expect(new Set(labels).size, `${lang} labels collide`).toBe(labels.length);
    }
  });

  it('tone never carries meaning on its own', () => {
    // §56: status is never communicated by colour alone. Every state has a
    // word; the tone is emphasis on top of it, so it is allowed to be shared.
    for (const state of ENQUIRY_RESPONSE_STATES) {
      expect(['positive', 'muted', 'neutral']).toContain(enquiryStateTone(state));
    }
    expect(enquiryStateTone('won')).toBe('positive');
  });
});
