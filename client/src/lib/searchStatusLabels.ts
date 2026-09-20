/**
 * ── THE STATUS ON A SEARCH RESULT, IN WORDS ───────────────────────────────
 *
 * Admin global search rendered `{hit.status}` straight onto the card, so every
 * one of its segments showed the stored enum: `in_progress`, `awaiting_user`,
 * `update_required`, `on_hold`. An administrator reading Arabic got the same.
 *
 * WHY THIS DISPATCHES INSTEAD OF TRANSLATING.
 *
 * The eight segments carry eight different status vocabularies, and several of
 * them already have a canonical owner - disputes, support tickets, products and
 * compliance each have a label function written where that domain lives.
 * Translating a few of them inside the search card would have created a NINTH
 * vocabulary that drifts from the eight, which is why the search pass
 * deliberately left this alone rather than half-fixing it.
 *
 * So this resolves nothing itself where an owner exists. It asks the segment's
 * own vocabulary and returns what it says. The only entries defined here are
 * the ones with no owner anywhere - accounts, RFQs, quotations and projects -
 * and those go through the SHARED translation table via t(), so they are the
 * same words the rest of the product already uses for the same states.
 *
 * AN UNKNOWN VALUE RENDERS AS ITSELF. A blank where a status should be reads
 * as "no status", which none of these records has; the raw value is ugly and
 * true, and it is the string somebody can search for.
 */
import { disputeLabels } from '@/lib/disputeCopy';
import { getComplianceStatusLabel, type ComplianceStatus } from '@shared/compliance';
import { productStatusLabel } from '@shared/productLifecycle';
import { supportLabel } from '@shared/supportTickets';

/** The segment keys admin search returns, as the card receives them. */
export type SearchSegment =
  | 'users' | 'rfqs' | 'quotations' | 'products'
  | 'projects' | 'disputes' | 'tickets' | 'enquiries';

/**
 * States with no canonical owner module, resolved through the shared
 * translation table so they read the same here as everywhere else.
 */
const SHARED_KEYS: Record<string, string> = {
  // Accounts
  active: 'common.status.active',
  frozen: 'common.status.frozen',
  // RFQs
  open: 'common.status.open',
  closed: 'common.status.closed',
  awarded: 'common.status.awarded',
  // Quotations
  pending: 'common.pending',
  accepted: 'common.accepted',
  rejected: 'common.rejected',
  withdrawn: 'common.withdrawn',
  // Projects
  planning: 'common.status.planning',
  on_hold: 'common.status.on_hold',
  completed: 'common.status.completed',
  cancelled: 'common.status.cancelled',
};

function sharedLabel(status: string, t: (key: string) => string): string {
  const key = SHARED_KEYS[status];
  if (!key) return status;
  const resolved = t(key);
  // t() echoes the key when the table has no entry for it, and a raw key on
  // screen is worse than the raw status it replaced.
  return resolved === key ? status : resolved;
}

export function searchStatusLabel(
  segment: SearchSegment,
  status: string | null | undefined,
  lang: 'en' | 'ar',
  t: (key: string) => string,
): string | null {
  if (!status) return null;
  const ar = lang === 'ar';
  switch (segment) {
    case 'disputes':
      return disputeLabels(ar).status(status);
    case 'tickets':
      return supportLabel('status', status, lang);
    case 'products':
      return productStatusLabel(status, lang);
    case 'enquiries':
      /*
       * An enquiry's status on a search card is the COMPLIANCE-shaped
       * vocabulary the registration queue uses. When it is not one of those,
       * it falls through to the shared table rather than to a second
       * enquiry-specific dictionary.
       */
      return ['not_started', 'submitted', 'under_review', 'update_required', 'approved', 'rejected']
        .includes(status)
        ? getComplianceStatusLabel(status as ComplianceStatus, ar)
        : sharedLabel(status, t);
    case 'users':
    case 'rfqs':
    case 'quotations':
    case 'projects':
    default:
      return sharedLabel(status, t);
  }
}
