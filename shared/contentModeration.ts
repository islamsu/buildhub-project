/**
 * ── ONE MODERATION LIFECYCLE, FOR EVERY KIND OF PUBLIC CONTENT ───────────
 *
 * Reviews got a report-and-resolve queue. Product questions got nothing - and
 * a question carrying abuse, a phone number or a competitor's contact details
 * sat on a product page with no remedy available to anybody: not the supplier,
 * not an administrator.
 *
 * The obvious fix is to copy the review machinery. That is how a product ends
 * up with two moderation systems that drift: one where "upheld" hides the
 * content and one where it does not, two admin queues that behave differently,
 * two sets of words for the same decision. So the LIFECYCLE lives here, once,
 * and each kind of content contributes only the part that is genuinely its
 * own - its reasons.
 *
 * WHAT IS SHARED, because it is the same decision whatever is being moderated:
 *
 *   the report states               open -> upheld | rejected
 *   the moderation actions          hide | restore
 *   the rule that hiding and upholding are SEPARATE decisions
 *   the rule that nothing is deleted
 *
 * WHAT IS NOT SHARED: the reasons. "The reviewer was never a customer" is
 * meaningless for a product question, and a reason list that does not fit the
 * thing being reported produces reports nobody can triage.
 *
 * ── UPHOLDING A REPORT DOES NOT HIDE THE CONTENT ─────────────────────────
 *
 * Two decisions, deliberately kept apart. A report can be well-founded and the
 * content still stand - one rude word in an otherwise accurate account - and
 * content can be hidden with no report at all. Coupling them would remove the
 * moderator's judgement from the one place it belongs.
 *
 * ── HIDDEN, NEVER DELETED ────────────────────────────────────────────────
 *
 * Moderation hides; it does not remove the row. The author wrote something
 * real and is entitled to a record of it, an administrator's decision has to
 * be reviewable afterwards, and evidence that is destroyed cannot be weighed
 * if the decision is challenged. Hidden content stops rendering publicly and
 * stays fully auditable.
 */

/** Where a report is in the queue. One set of states for every content type. */
export const CONTENT_REPORT_STATUSES = ['open', 'upheld', 'rejected'] as const;
export type ContentReportStatus = (typeof CONTENT_REPORT_STATUSES)[number];

/** What a moderator can do to the content itself, separately from the report. */
export const CONTENT_MODERATION_ACTIONS = ['hide', 'restore'] as const;
export type ContentModerationAction = (typeof CONTENT_MODERATION_ACTIONS)[number];

/** The states that still need somebody. Drives the admin attention count. */
export const CONTENT_REPORT_OPEN_STATUSES = ['open'] as const;

export const CONTENT_REPORT_STATUS_LABELS: Readonly<
  Record<ContentReportStatus, { en: string; ar: string }>
> = {
  open:     { en: 'Awaiting review', ar: 'قيد المراجعة' },
  upheld:   { en: 'Upheld', ar: 'تم قبول البلاغ' },
  rejected: { en: 'Rejected', ar: 'تم رفض البلاغ' },
};

export function contentReportStatusLabel(status: string, lang: string): string {
  const entry = CONTENT_REPORT_STATUS_LABELS[status as ContentReportStatus];
  // An unknown status is shown AS STORED rather than as a dash: a value the
  // vocabulary has not caught up with is a fact about the data, and hiding it
  // behind a placeholder is how it goes unnoticed.
  if (!entry) return status;
  return lang === 'ar' ? entry.ar : entry.en;
}
