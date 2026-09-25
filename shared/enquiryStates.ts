/**
 * ── WHERE A LEAD IS, IN ONE VOCABULARY ──────────────────────────────────
 *
 * §23 names the states a supplier's opportunity passes through; §11 says one
 * canonical domain, not two.
 *
 * The client kept its own four-item copy of this list while the server's
 * lived in server/enquiryQueue.ts, and the moment the server learned about
 * Won the two disagreed: the filter chips would have offered four states
 * over a queue that could return seven, so a supplier filtering for anything
 * could never have found a lead they had won.
 *
 * Ordered as a FUNNEL rather than alphabetically - what could be taken, what
 * was taken, what was answered, and the three ways an answer ends - because
 * the chips render in this order and a pipeline read out of sequence is
 * harder to scan than an unordered one.
 */
export const ENQUIRY_RESPONSE_STATES = [
  'available',
  'invited',
  'opened',
  'quoted',
  'won',
  'lost',
  'closed',
  'unquoted',
  'declined',
] as const;

export type EnquiryResponseState = (typeof ENQUIRY_RESPONSE_STATES)[number];

/**
 * ── THE ONE PLACE THAT SPLITS A QUEUE INTO TWO SCREENS ──────────────────
 *
 * `/enquiries` used to render two cards over the same rows: a "Qualified
 * enquiries" list of open requests above a "Work queue" of everything, so
 * the same six requests appeared twice on one screen. Two lists of the same
 * thing is not two features; it is one feature the reader has to reconcile.
 *
 * The fix is not a second query. It is this partition, applied by the server
 * to the ONE queue, which is why the two sets are defined here together
 * rather than as two literals in two components that can drift apart:
 *
 *   OPPORTUNITY  what can STILL BE TAKEN, which is a claim about the
 *                request as well as about the supplier: an OPEN request
 *                matching a declared category, or an invitation to an OPEN
 *                request that has not been opened yet. This is where a
 *                credit gets spent, so this is where the allowance meter
 *                belongs.
 *   LEAD         THE RECORD: everything that is no longer an open offer -
 *                what the supplier took and how it ended, and also what
 *                ended without them. It outlives the request, because a lead
 *                stays here after the customer closes the file and the
 *                credit stayed spent.
 *
 * A TERMINAL RFQ OUTCOME MOVES A ROW ACROSS THIS LINE. An invitation the
 * supplier never touched, on a request the customer has since withdrawn, is
 * not an opportunity - offering it as takeable is a control that cannot
 * succeed. `closed` and `unquoted` are therefore LEAD states even though the
 * supplier may have done nothing at all, because the question this split
 * answers is "can this still be taken", not "did you touch it".
 *
 * THEY MUST PARTITION `ENQUIRY_RESPONSE_STATES`: every state in exactly one
 * set, no state in both. A gap would hide a request from a supplier
 * completely; an overlap would put it back on the screen twice, which is the
 * defect this exists to end. `enquiryStates.test.ts` asserts both halves,
 * so adding a ninth state without placing it fails the suite rather than
 * quietly losing it.
 *
 * `invited` exists FOR this split. Without it an untouched invitation read
 * as `opened` - a lead the supplier had supposedly taken, sitting in their
 * record, that they had in fact never seen. §23 names Invited as a canonical
 * opportunity state; this is it.
 */
export const ENQUIRY_OPPORTUNITY_STATES = ['available', 'invited'] as const;

export const ENQUIRY_LEAD_STATES = [
  'opened', 'quoted', 'won', 'lost', 'closed', 'unquoted', 'declined',
] as const;

export const ENQUIRY_SCOPES = ['opportunities', 'leads', 'all'] as const;
export type EnquiryScope = (typeof ENQUIRY_SCOPES)[number];

/** The states a scope covers. `all` returns every state, not an empty filter. */
export function statesForScope(scope: EnquiryScope): readonly EnquiryResponseState[] {
  switch (scope) {
    case 'opportunities': return ENQUIRY_OPPORTUNITY_STATES;
    case 'leads': return ENQUIRY_LEAD_STATES;
    case 'all': return ENQUIRY_RESPONSE_STATES;
  }
}

export function isEnquiryResponseState(value: unknown): value is EnquiryResponseState {
  return typeof value === 'string'
    && (ENQUIRY_RESPONSE_STATES as readonly string[]).includes(value);
}

/**
 * How each state is SAID, in both languages.
 *
 * "Not selected" rather than "Lost": it is a statement about one request,
 * and a supplier reading their pipeline does not need the product to editorialise.
 * "Request withdrawn" rather than "Closed" for the same reason - it says what
 * the customer did rather than implying the supplier was beaten.
 */
export function enquiryStateLabel(state: string, lang: 'en' | 'ar'): string {
  const ar = lang === 'ar';
  switch (state) {
    case 'available': return ar ? 'متاح للفتح' : 'Available';
    case 'invited': return ar ? 'دعوة لم تُفتح' : 'Invited';
    case 'opened': return ar ? 'مفتوح' : 'Opened';
    case 'quoted': return ar ? 'قدّمت عرضاً' : 'Quoted';
    case 'won': return ar ? 'فزت بها' : 'Won';
    case 'lost': return ar ? 'ذهبت لغيرك' : 'Not selected';
    case 'closed': return ar ? 'أُغلق الطلب' : 'Request withdrawn';
    /*
     * "Did not quote", NOT "Not selected".
     *
     * The request was awarded and this supplier has no quotation on it. They
     * were not beaten; they did not bid. Saying "Not selected" here would
     * report the outcome of a competition they never entered, which is a
     * fabricated outcome (§68) - and it is the kind a supplier would act on,
     * by chasing a customer who never rejected them.
     */
    case 'unquoted': return ar ? 'لم تقدّم عرضاً' : 'Did not quote';
    case 'declined': return ar ? 'اعتذرت' : 'Declined';
    default: return state;
  }
}

/**
 * The visual weight a state carries.
 *
 * NEVER COLOUR ALONE (§56): every state already carries its own word, and
 * this only decides emphasis on top of that. Won is the outcome a supplier
 * scans a pipeline for, so it is the one that is allowed to stand out.
 */
export function enquiryStateTone(state: string): 'positive' | 'muted' | 'neutral' {
  if (state === 'won') return 'positive';
  if (state === 'lost' || state === 'closed' || state === 'unquoted' || state === 'declined') return 'muted';
  return 'neutral';
}
