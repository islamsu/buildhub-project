/**
 * ── A CONTROL THAT IS CERTAIN TO FAIL IS WORSE THAN AN ABSENT ONE ─────────
 *
 * Reported from real use on staging. A provider opened a request, was shown an
 * enabled "Open qualified enquiry" button, clicked it, and was told the request
 * does not match any of their declared service categories.
 *
 * THE REFUSAL WAS CORRECT. OFFERING THE ACTION WAS NOT. It cost a click, taught
 * distrust of the button, and said nothing about what to do instead.
 *
 * The cause: `getRfqResponseAccess` answers "do you ALREADY have access" - by
 * invitation, a previously opened enquiry, or an existing quotation. Nothing
 * could answer "would opening be GRANTED", because that decision lived only
 * inside `openQualifiedEnquiry`, which spends a credit and so cannot be called
 * to find out.
 *
 * Three rules pinned here:
 *
 *   THE PREVIEW AND THE ACT SHARE THEIR HELPERS AND THEIR ORDER. A second copy
 *   of an eligibility rule is how a preview starts promising what the act
 *   refuses. Invitation first, then category, then allowance - in both.
 *
 *   THE PREVIEW WRITES NOTHING. It is called on render; if it marked an
 *   invitation viewed or spent a credit, looking at a page would cost money.
 *
 *   AND THE REASON REACHES THE SCREEN AS A KEY, not a sentence. BuildHub is
 *   bilingual and the copy belongs with every other string.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const ENQUIRIES = readSourceForAssertions(read('./billing/enquiries.ts'));
const ROUTERS = readSourceForAssertions(read('./routers.ts'));
const RESPOND = readSourceForAssertions(read('../client/src/pages/RFQRespondPage.tsx'));
const DETAIL = readSourceForAssertions(read('../client/src/pages/RFQDetail.tsx'));

/**
 * The procedure body, sliced from its OWN position forward. The first version
 * cut at `ROUTERS.indexOf('  get: protectedProcedure')` from zero - and an
 * earlier router has a `get:` too, so the end landed before the start and every
 * assertion ran against an empty string. An empty slice passes every
 * `not.toContain` in the file.
 */
function responseAccessBody(): string {
  const start = ROUTERS.indexOf('responseAccess: approvedProviderProcedure');
  expect(start, 'responseAccess is gone').toBeGreaterThan(-1);
  const end = ROUTERS.indexOf('  get: protectedProcedure', start);
  expect(end, 'the end marker is not after the start').toBeGreaterThan(start);
  return ROUTERS.slice(start, end);
}

const preview = () => ENQUIRIES.slice(
  ENQUIRIES.indexOf('export async function previewQualifiedEnquiry'),
  ENQUIRIES.indexOf('export async function openQualifiedEnquiry'),
);
const act = () => ENQUIRIES.slice(ENQUIRIES.indexOf('export async function openQualifiedEnquiry'));

describe('the preview shares the act’s helpers, and does not restate the rule', () => {
  it('both use the SAME four eligibility helpers', () => {
    for (const helper of [
      'hasOpenInvitation', 'isClassifiableRfqCategory',
      'getVendorCategories', 'isVendorEligibleForCategory',
    ]) {
      expect(preview(), `the preview does not use ${helper}`).toContain(helper);
      expect(act(), `the act does not use ${helper}`).toContain(helper);
    }
  });

  it('AND IN THE SAME ORDER — invitation, then category, then allowance', () => {
    // The order is load-bearing, not incidental: an invitation outranks the
    // category gate AND the allowance, so checking category first would refuse
    // a supplier the customer explicitly asked for. If the two disagree about
    // the order, the preview promises what the act refuses, or hides what it
    // would have granted.
    const sequence = (body: string) => [
      body.indexOf('hasOpenInvitation'),
      body.indexOf('isClassifiableRfqCategory'),
      body.indexOf('isVendorEligibleForCategory'),
    ];
    for (const [name, body] of [['preview', preview()], ['act', act()]] as const) {
      const [invite, classify, category] = sequence(body);
      expect(invite, `${name}: invitation is not checked first`).toBeLessThan(classify);
      expect(classify, `${name}: category order`).toBeLessThan(category);
    }
  });

  it('the preview refuses with the SAME vocabulary the act refuses with', () => {
    for (const reason of ['unclassified_rfq', 'category_mismatch']) {
      expect(preview(), reason).toContain(reason);
      expect(act(), reason).toContain(reason);
    }
  });
});

describe('the preview writes nothing — it is called on render', () => {
  it('no insert, no update, no transaction', () => {
    const body = preview();
    for (const write of ['insert(', 'update(', 'transaction(', 'markInvitationViewed']) {
      expect(body, `the preview performs a write: ${write}`).not.toContain(write);
    }
  });

  it('and the act is the only thing that spends a credit', () => {
    expect(act()).toContain('insert(qualifiedEnquiries)');
    expect(preview()).not.toContain('insert(qualifiedEnquiries)');
  });
});

describe('what the preview decides', () => {
  it('an invitation is free, and outranks both gates', () => {
    const body = preview();
    const invite = body.slice(body.indexOf('hasOpenInvitation'));
    expect(invite.slice(0, 160)).toContain("canOpen: true");
    expect(invite.slice(0, 160)).toContain('free: true');
  });

  it('a lead already paid for re-opens for nothing', () => {
    expect(preview()).toContain("reason: 'already_open', free: true");
  });

  it('A CLOSED REQUEST IS NOT OFFERED, which the act does not check', () => {
    // The act would GRANT on a closed request and the supplier would spend a
    // lead on something nobody can answer. Its own reason rather than folded
    // into eligibility: "you cannot quote on this" and "this is not your
    // trade" are different things to tell somebody.
    expect(preview()).toContain("reason: 'rfq_closed'");
  });

  it('a spent allowance blocks the offer rather than the click', () => {
    expect(preview()).toContain("reason: 'limit_reached'");
    expect(preview()).toContain('usage.limitReached');
  });
});

describe('the answer reaches the screen', () => {
  it('responseAccess carries canOpen and the reason', () => {
    const procedure = responseAccessBody();
    expect(procedure).toContain('previewQualifiedEnquiry');
    expect(procedure).toContain('canOpen:');
    expect(procedure).toContain('openBlockedReason:');
  });

  it('AS A KEY, NOT A SENTENCE — the screen is bilingual', () => {
    const procedure = responseAccessBody();
    // THE WHOLE EXPRESSION, not just what follows the colon. The first version
    // required a quote IMMEDIATELY after `openBlockedReason:` and so never
    // saw a sentence introduced through a ternary - which is exactly how one
    // would actually be written.
    const assignment = procedure.slice(
      procedure.indexOf('openBlockedReason:'),
      procedure.indexOf('openIsFree:'),
    );
    expect(assignment, 'the reason is gone').not.toBe('');
    expect(assignment, 'a human sentence is being built on the server')
      .not.toMatch(/['"`][A-Z][a-z]+ [a-z]/);
    expect(assignment).toContain('preview.reason');
  });

  it('AND IT IS COMPUTED EVEN FOR SOMEBODY WHO CAN ALREADY RESPOND', () => {
    // It used to be skipped when `canRespond` was true, which reads like a
    // harmless saving - there is nothing left to offer, so why spend four
    // queries. A live probe proved the saving was a lie in the payload. An
    // open INVITATION is itself `canRespond`, so the preview's invitation
    // branch could never run from here, and the procedure answered
    // `canOpen: false` to a provider whose `openEnquiry` call returns 200.
    // The preview contradicting the act is the one thing this module exists
    // to prevent, so the preview is now unconditional.
    const procedure = responseAccessBody();
    const start = procedure.indexOf('const preview');
    const end = procedure.indexOf('let projectTitle');
    expect(start, 'the preview assignment is gone').toBeGreaterThan(-1);
    expect(end, 'the slice boundary moved - an empty string passes every not.toContain')
      .toBeGreaterThan(start);
    const assignment = procedure.slice(start, end);
    expect(assignment).toContain('previewQualifiedEnquiry(db, ctx.user.id, input.rfqId)');
    expect(assignment, 'the preview is gated on existing access again')
      .not.toMatch(/canRespond/);

    // And the fields it feeds are unconditional too. `preview` can no longer
    // be null, so an optional access or a `?? false` default would be a
    // second, silent way of answering `canOpen: false` without asking.
    const payloadStart = procedure.indexOf('canOpen:');
    expect(payloadStart, 'canOpen is no longer returned').toBeGreaterThan(end);
    const payload = procedure.slice(payloadStart);
    expect(payload).not.toContain('preview?.');
    expect(payload).not.toContain('?? false');
    expect(payload).toContain('canOpen: preview.canOpen');
    expect(payload).toContain('openIsFree: preview.free');
  });
});

describe('the respond page explains before the click', () => {
  it('the OFFER is withheld when the server would refuse it', () => {
    expect(RESPOND).toContain('!access.data.canRespond && !access.data.canOpen');
    expect(RESPOND).toContain('data-testid="respond-enquiry-blocked"');
  });

  it('and the gate card does not branch on a condition that cannot hold in it', () => {
    // The two free cases - an invitation, and a lead already paid for - are
    // BOTH `canRespond`, and this card renders only when `canRespond` is
    // false. An `openIsFree` ternary inside it would read as though it covered
    // the invited provider while the arm was unreachable, which is the same
    // dishonesty as a button that cannot work: something rendered that says a
    // case is handled here when it is handled somewhere else entirely.
    const start = RESPOND.indexOf('data-testid="respond-enquiry-gate"');
    const end = RESPOND.indexOf('data-testid="respond-open-enquiry"');
    expect(start, 'the gate card is gone').toBeGreaterThan(-1);
    expect(end, 'the slice boundary moved - an empty string passes not.toContain')
      .toBeGreaterThan(start);
    expect(RESPOND.slice(start, end)).not.toContain('openIsFree');
  });

  it('and “free” is rendered where it IS true', () => {
    // `openIsFree` is a fact the provider is watching - the allowance is the
    // scarce thing - so it is stated on the screen of somebody it is true for,
    // rather than returned by the server and rendered nowhere.
    const start = RESPOND.indexOf('data-testid="respond-free-lead"');
    // THE NOTE'S OWN CLOSING TAG, not the next card. Ending this slice at
    // `data-testid="respond-decline"` let it run past the note into the
    // decline card, whose render condition also reads `byInvitation` - so
    // deleting the distinction from the note left the assertion passing on
    // the neighbour's text. Caught by mutation, not by reading.
    const end = RESPOND.indexOf('</p>', start);
    expect(start, 'the free-lead note is gone').toBeGreaterThan(-1);
    expect(end, 'the note is not a closed <p> any more').toBeGreaterThan(start);
    expect(RESPOND).toContain('access.data.canRespond && access.data.openIsFree');
    const block = RESPOND.slice(start, end);
    // The two free reasons are told apart: being invited and having already
    // paid are different facts, and one wording for both would be wrong for
    // whichever provider it was not written about.
    expect(block).toContain('access.data.byInvitation');
    expect(block, 'the Arabic wording is missing').toMatch(/[\u0600-\u06FF]/);
    expect(block, 'the English wording is missing').toMatch(/does not use your/);
  });

  it('and the button is still there when opening WOULD succeed', () => {
    // The fix must not remove the capability from the people who have it.
    expect(RESPOND).toContain('data-testid="respond-open-enquiry"');
    expect(RESPOND).toContain('openEnquiry.mutate({ rfqId })');
  });

  it('every blocked reason has copy in BOTH languages', () => {
    const block = RESPOND.slice(
      RESPOND.indexOf('data-testid="respond-blocked-reason"'),
      RESPOND.indexOf('data-testid="respond-enquiry-gate"'),
    );
    for (const reason of ['category_mismatch', 'limit_reached', 'unclassified_rfq', 'rfq_closed']) {
      expect(block, `${reason} has no copy`).toContain(reason);
    }
    // Arabic present, not just an English string with a ternary around it.
    expect(block).toMatch(/[؀-ۿ]/);
  });

  it('THE ONE REASON A PROVIDER CAN FIX carries the way to fix it', () => {
    // A button on "your allowance is spent" or "this request has no category"
    // would be the same dead control again, in a new place.
    expect(RESPOND).toContain('data-testid="respond-declare-categories"');
    expect(RESPOND).toContain('/settings#settings-categories');
  });

  it('and the offer now says what opening COSTS', () => {
    expect(RESPOND).toContain('access.data.openIsFree');
  });
});

describe('the upstream link asks the same rule', () => {
  it('RFQDetail queries responseAccess rather than judging for itself', () => {
    // A second copy of the eligibility rule in the client is how the button
    // and the server start disagreeing.
    expect(DETAIL).toContain('trpc.rfq.responseAccess.useQuery');
    expect(DETAIL).toContain('canRespond || responseAccess.data.canOpen');
  });

  it('it shows the reason instead of a button that leads to one', () => {
    expect(DETAIL).toContain('data-testid="rfq-detail-not-eligible"');
    expect(DETAIL).toContain('data-testid="rfq-detail-respond"');
  });

  it('AND "NOT YET KNOWN" IS NOT TREATED AS "REFUSED"', () => {
    // While the query is in flight the answer is null; `!mayProceed` would
    // flash a refusal at every eligible provider before it returned.
    expect(DETAIL).toContain('mayProceed === false');
    expect(DETAIL).not.toMatch(/isOpen && !mayProceed \?/);
  });
});
