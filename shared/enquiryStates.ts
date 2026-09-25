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
  'opened',
  'quoted',
  'won',
  'lost',
  'closed',
  'declined',
] as const;

export type EnquiryResponseState = (typeof ENQUIRY_RESPONSE_STATES)[number];

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
    case 'opened': return ar ? 'مفتوح' : 'Opened';
    case 'quoted': return ar ? 'قدّمت عرضاً' : 'Quoted';
    case 'won': return ar ? 'فزت بها' : 'Won';
    case 'lost': return ar ? 'ذهبت لغيرك' : 'Not selected';
    case 'closed': return ar ? 'أُغلق الطلب' : 'Request withdrawn';
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
  if (state === 'lost' || state === 'closed' || state === 'declined') return 'muted';
  return 'neutral';
}
