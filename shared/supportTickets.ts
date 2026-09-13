/**
 * ── THE SUPPORT TICKET VOCABULARY ─────────────────────────────────────────
 *
 * WHAT A SUPPORT TICKET IS, AND WHY IT IS NOT A DISPUTE.
 *
 * BuildHub already has a dispute lifecycle, and the temptation was to widen it
 * rather than build a second thing. That would have been wrong, and the reason
 * is structural rather than stylistic:
 *
 *   A DISPUTE is between TWO USERS about a COMMERCIAL SUBJECT. It has a
 *   respondent, and eligibility is derived from a real relationship to a
 *   project, an RFQ or a quotation. BuildHub adjudicates between the parties.
 *
 *   A SUPPORT TICKET is between ONE USER and BUILDHUB. There is no respondent
 *   and no subject eligibility to derive - any signed-in account may ask for
 *   help. BuildHub is the counterparty, not the referee.
 *
 * Merging them would have forced a nullable respondent, a nullable subject and
 * an eligibility check that is a no-op half the time - which is how one table
 * comes to mean two things and neither rule can be stated cleanly. What IS
 * shared is the machinery around them: notifications, the account audit
 * writer, the admin pager, the storage proxy, `containsTerm`. Those are reused
 * rather than reimplemented.
 *
 * Every closed set lives here once. The schema's mysqlEnums still declare
 * their own values because a Drizzle column has to; a test holds the two in
 * agreement, exactly as it does for disputes.
 */

/**
 * WHAT THE TICKET IS ABOUT. Deliberately about BUILDHUB SURFACES rather than
 * about feelings ("problem", "question"), because the category's job is to
 * route the ticket to whoever knows that surface.
 *
 * `billing` is here even though payment is owner-deferred: a vendor asking why
 * their plan says what it says is a real question today, and the answer is
 * about entitlements rather than about money.
 */
export const SUPPORT_CATEGORIES = [
  'account', 'billing', 'technical', 'marketplace', 'rfq', 'project', 'compliance', 'other',
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** Set by staff, never by the requester - see SUPPORT_PRIORITY_IS_STAFF_ONLY. */
export const SUPPORT_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

/**
 * ── THE LIFECYCLE ─────────────────────────────────────────────────────────
 *
 *   open           filed, nobody has picked it up
 *   in_progress    a support administrator is working on it
 *   awaiting_user  staff asked the requester for something and cannot proceed
 *                  until they answer. This is the todo's "request-info" state,
 *                  and it is a REAL status rather than a note, because "who is
 *                  this waiting on" is the single most useful thing a support
 *                  queue can tell you.
 *   resolved       staff believe it is done. Not terminal: the requester may
 *                  reopen by replying, which is the whole reason `resolved`
 *                  and `closed` are two states rather than one.
 *   closed         terminal. Nothing further happens.
 */
export const SUPPORT_STATUSES = [
  'open', 'in_progress', 'awaiting_user', 'resolved', 'closed',
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** Statuses after which nothing may change. */
export const SUPPORT_TERMINAL_STATUSES: readonly SupportStatus[] = ['closed'];

/**
 * THE DECLARED TRANSITIONS. A ticket moves only along an edge named here.
 *
 * The generic `admin.updateDispute` this project replaced accepted any status
 * from any state, which is how a resolved record silently became open again
 * with no history. This table exists so that cannot be repeated: an undeclared
 * move is refused, and the refusal names the states.
 *
 * `resolved -> in_progress` is the reopen edge, and it is the ONLY way back
 * from resolved. `closed` has no outgoing edge at all.
 */
export const SUPPORT_TRANSITIONS: Readonly<Record<SupportStatus, readonly SupportStatus[]>> = {
  open:          ['in_progress', 'awaiting_user', 'resolved', 'closed'],
  in_progress:   ['awaiting_user', 'resolved', 'closed'],
  awaiting_user: ['in_progress', 'resolved', 'closed'],
  resolved:      ['in_progress', 'closed'],
  closed:        [],
};

export function canTransitionSupport(from: SupportStatus, to: SupportStatus): boolean {
  return (SUPPORT_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * PRIORITY IS STAFF-ONLY, and it is stated as a constant rather than left as a
 * fact about which zod schema happens to omit the field.
 *
 * A requester who can set their own priority sets `urgent`, always, and the
 * field stops carrying information. Triage is BuildHub's judgement about its
 * own queue.
 */
export const SUPPORT_PRIORITY_IS_STAFF_ONLY = true;

/**
 * Who a ticket is waiting on, derived from status rather than stored.
 *
 * Stored, it would be a second source of truth that drifts the first time a
 * status changes without it. Derived, it cannot.
 */
export function supportAwaitingParty(status: SupportStatus): 'user' | 'support' | 'nobody' {
  if (status === 'awaiting_user') return 'user';
  if (status === 'closed' || status === 'resolved') return 'nobody';
  return 'support';
}

/**
 * The human reference, e.g. `SUP-2026-000123`.
 *
 * Same shape and the same reason as the dispute reference: an id is not
 * something a person reads out on a call, and a support conversation is
 * exactly where somebody has to.
 */
export function supportReference(id: number, createdAt: Date | string | number): string {
  const year = new Date(createdAt).getUTCFullYear();
  return `SUP-${year}-${String(id).padStart(6, '0')}`;
}

/** Parse `SUP-2026-000123` (or a bare id) back to the id, or null. */
export function parseSupportReference(raw: string): number | null {
  const term = raw.trim();
  const match = /^SUP-\d{4}-(\d+)$/i.exec(term);
  if (match) {
    const id = Number(match[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }
  if (/^\d+$/.test(term)) {
    const id = Number(term);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }
  return null;
}

/** Bilingual labels, so no screen invents its own wording for a closed set. */
export const SUPPORT_VOCABULARY = {
  category: {
    account:     { en: 'Account', ar: 'الحساب' },
    billing:     { en: 'Plan and billing', ar: 'الخطة والفوترة' },
    technical:   { en: 'Technical problem', ar: 'مشكلة تقنية' },
    marketplace: { en: 'Marketplace', ar: 'السوق' },
    rfq:         { en: 'Requests for quotation', ar: 'طلبات عروض الأسعار' },
    project:     { en: 'Projects', ar: 'المشاريع' },
    compliance:  { en: 'Verification and documents', ar: 'التوثيق والمستندات' },
    other:       { en: 'Something else', ar: 'شيء آخر' },
  },
  status: {
    open:          { en: 'Open', ar: 'مفتوحة' },
    in_progress:   { en: 'In progress', ar: 'قيد المعالجة' },
    awaiting_user: { en: 'Waiting for you', ar: 'بانتظار ردك' },
    resolved:      { en: 'Resolved', ar: 'تم الحل' },
    closed:        { en: 'Closed', ar: 'مغلقة' },
  },
  priority: {
    low:    { en: 'Low', ar: 'منخفضة' },
    medium: { en: 'Medium', ar: 'متوسطة' },
    high:   { en: 'High', ar: 'مرتفعة' },
    urgent: { en: 'Urgent', ar: 'عاجلة' },
  },
} as const;

export function supportLabel(
  group: keyof typeof SUPPORT_VOCABULARY, key: string, lang: string,
): string {
  const entry = (SUPPORT_VOCABULARY[group] as Record<string, { en: string; ar: string }>)[key];
  if (!entry) return key;
  return lang === 'ar' ? entry.ar : entry.en;
}

/**
 * WHAT MAY BE ATTACHED. The same set dispute evidence allows, and for the same
 * reason: a customer making their case sends a screenshot, a photograph or a
 * PDF. Anything executable has no place in a support thread.
 *
 * DECLARED, NOT ASSUMED. The bytes are checked against this list at the
 * endpoint - a declared content type is a claim by the uploader, and this
 * codebase already learned that lesson at five other upload sites.
 */
export const SUPPORT_ATTACHMENT_CONTENT_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
] as const;
