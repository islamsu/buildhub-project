/**
 * ── THE REVIEW VOCABULARY ─────────────────────────────────────────────────
 *
 * WHAT ALREADY WORKED, so the additions are not mistaken for a rewrite:
 * eligibility is a real BuildHub relationship (the project owner reviewing a
 * provider whose quotation was accepted on an RFQ under that project),
 * self-review is refused, a duplicate is refused, and the rating shown is
 * DERIVED live from the rows rather than stored - so it cannot drift the way
 * `users.rating` already had.
 *
 * WHAT WAS MISSING, and what this vocabulary is for: a reviewed provider had
 * no right of reply, nobody could report an abusive review, and no
 * administrator could act on one if they did. A reputation system where the
 * subject cannot answer and the platform cannot moderate is not a reputation
 * system - it is a publishing channel pointed at one party.
 */

/**
 * WHY SOMEBODY REPORTS A REVIEW. A closed set, because free-text reasons
 * cannot be triaged and every moderation queue that accepts them drowns.
 *
 * NOTHING HERE IS "I DISAGREE". A negative review that is accurate is the
 * system working, and offering a reason that means "unflattering" would invite
 * providers to report every three-star rating. Each reason below describes a
 * review that should not have been publishable at all.
 */
export const REVIEW_REPORT_REASONS = [
  'abusive',        // insults, harassment, threats
  'off_topic',      // not about the work that was done
  'personal_data',  // names, phone numbers, addresses of third parties
  'not_a_customer', // the reviewer was never in this relationship
  'spam',           // advertising or repetition
  'other',
] as const;
export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number];

/** Where a report is in the moderation queue. */
export const REVIEW_REPORT_STATUSES = ['open', 'upheld', 'rejected'] as const;
export type ReviewReportStatus = (typeof REVIEW_REPORT_STATUSES)[number];

/**
 * ── HIDDEN, NEVER DELETED ─────────────────────────────────────────────────
 *
 * Moderation hides a review; it does not remove the row. Three reasons, and
 * the third is the one that matters most:
 *
 *   the reviewer wrote something real and is entitled to a record of it;
 *   an administrator's decision has to be reviewable afterwards;
 *   and a deleted review is a rating that silently changes with no
 *   explanation, which is exactly the drift this system already refuses to
 *   allow for stored aggregates.
 *
 * A hidden review is excluded from the public list AND from the average, so
 * hiding is a real remedy rather than a cosmetic one.
 */
export const REVIEW_MODERATION_ACTIONS = ['hide', 'restore'] as const;
export type ReviewModerationAction = (typeof REVIEW_MODERATION_ACTIONS)[number];

/**
 * THE RIGHT OF REPLY, and its limits.
 *
 * ONE response per review, by the REVIEWEE only. Not a thread: a review page
 * that becomes an argument helps nobody reading it, and the reviewer already
 * had their say. The response is public, sits under the review it answers, and
 * can be edited by its author while the review stands.
 */
export const REVIEW_RESPONSE_MAX_LENGTH = 2000;

export const REVIEW_VOCABULARY = {
  reportReason: {
    abusive:        { en: 'Abusive or harassing', ar: 'مسيء أو يتضمن تحرشًا' },
    off_topic:      { en: 'Not about the work', ar: 'لا يتعلق بالعمل المنجز' },
    personal_data:  { en: 'Contains personal data', ar: 'يحتوي على بيانات شخصية' },
    not_a_customer: { en: 'Reviewer was never a customer', ar: 'صاحب التقييم لم يكن عميلًا' },
    spam:           { en: 'Spam or advertising', ar: 'رسائل مزعجة أو إعلانات' },
    other:          { en: 'Something else', ar: 'سبب آخر' },
  },
  reportStatus: {
    open:     { en: 'Awaiting review', ar: 'قيد المراجعة' },
    upheld:   { en: 'Upheld', ar: 'تم قبول البلاغ' },
    rejected: { en: 'Rejected', ar: 'تم رفض البلاغ' },
  },
} as const;

export function reviewLabel(
  group: keyof typeof REVIEW_VOCABULARY, key: string, lang: string,
): string {
  const entry = (REVIEW_VOCABULARY[group] as Record<string, { en: string; ar: string }>)[key];
  if (!entry) return key;
  return lang === 'ar' ? entry.ar : entry.en;
}
