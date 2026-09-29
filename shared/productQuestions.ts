/**
 * ── PRODUCT Q&A: THE MODERATION HALF THAT DID NOT EXIST ──────────────────
 *
 * `productQuestions` had exactly three surfaces - list, ask, answer - and no
 * remedy of any kind. A question carrying abuse, a third party's phone number
 * or a competitor's contact details was published on a product page and
 * NOBODY could remove it: not the supplier whose product it sat on, not an
 * administrator. Reviews had a full report-and-resolve queue. Questions had
 * nothing.
 *
 * The lifecycle is the shared one (see shared/contentModeration.ts). What is
 * genuinely specific to a product question is defined here.
 *
 * WHY THE REASONS DIFFER FROM A REVIEW'S. A review reports an account of work
 * that was done, so "the reviewer was never a customer" is its central abuse.
 * A product question is a public message on a supplier's listing, and its
 * characteristic abuses are different: somebody advertising a rival, somebody
 * posting a phone number so the conversation leaves BuildHub, or a "question"
 * that is really a complaint about an unrelated order. A reason list that does
 * not fit what is being reported produces reports nobody can triage.
 *
 * NOTHING HERE IS "I DISLIKE THIS QUESTION". A supplier reporting an awkward
 * but legitimate question is the system being abused to hide it, so every
 * reason below describes content that should not have been publishable at all.
 */
import type { ContentReportStatus } from './contentModeration';

export const PRODUCT_QUESTION_REPORT_REASONS = [
  'abusive',       // insults, harassment, threats
  'personal_data', // a phone number, address or third party's details
  'off_platform',  // an attempt to move the conversation off BuildHub
  'competitor',    // advertising a rival product or supplier
  'not_a_question',// a complaint or a statement with nothing to answer
  'spam',          // repetition or unrelated advertising
  'other',
] as const;
export type ProductQuestionReportReason = (typeof PRODUCT_QUESTION_REPORT_REASONS)[number];

/**
 * WHICH HALF OF THE EXCHANGE IS BEING REPORTED.
 *
 * A question and its answer are written by different people and can go wrong
 * independently: a reasonable question can get an abusive reply, and an
 * abusive question can get a patient one. Reporting "the exchange" would force
 * a moderator to hide both to act on either, which punishes the innocent half.
 */
export const PRODUCT_QUESTION_REPORT_TARGETS = ['question', 'answer'] as const;
export type ProductQuestionReportTarget = (typeof PRODUCT_QUESTION_REPORT_TARGETS)[number];

/**
 * An answer may be corrected, and the previous text is KEPT.
 *
 * The old rule was write-once: a supplier who mistyped a dimension or quoted
 * the wrong warranty could never fix it, and the wrong answer stayed on a
 * public page forever. That is a worse outcome than a visible correction.
 *
 * But an editable public answer is also a way to rewrite history - to answer
 * "does it ship to Alexandria?" with "yes", take the order, and quietly change
 * it to "no" afterwards. So every previous version is preserved, the page
 * carries an "Edited" marker, and the buyer who asked can see that it changed.
 * Editing is a correction, never an erasure.
 */
export const PRODUCT_ANSWER_MAX_LENGTH = 2000;
export const PRODUCT_QUESTION_MAX_LENGTH = 1000;

export const PRODUCT_QUESTION_VOCABULARY = {
  reportReason: {
    abusive:        { en: 'Abusive or harassing', ar: 'مسيء أو يتضمن تحرشًا' },
    personal_data:  { en: 'Contains personal contact details', ar: 'يحتوي على بيانات اتصال شخصية' },
    off_platform:   { en: 'Trying to move the deal off BuildHub', ar: 'محاولة لنقل التعامل خارج بيلدهَب' },
    competitor:     { en: 'Advertising a competitor', ar: 'إعلان لمنافس' },
    not_a_question: { en: 'Not a question about this product', ar: 'ليس سؤالًا عن هذا المنتج' },
    spam:           { en: 'Spam or repetition', ar: 'رسائل مزعجة أو تكرار' },
    other:          { en: 'Something else', ar: 'سبب آخر' },
  },
  reportTarget: {
    question: { en: 'The question', ar: 'السؤال' },
    answer:   { en: 'The answer', ar: 'الإجابة' },
  },
} as const;

export function productQuestionLabel(
  group: keyof typeof PRODUCT_QUESTION_VOCABULARY, key: string, lang: string,
): string {
  const entry = (PRODUCT_QUESTION_VOCABULARY[group] as Record<string, { en: string; ar: string }>)[key];
  // Shown AS STORED when the vocabulary has not caught up - a value nobody has
  // a word for is a fact about the data, and a dash hides it.
  if (!entry) return key;
  return lang === 'ar' ? entry.ar : entry.en;
}

/** Re-exported so a caller needs one import for a Q&A moderation screen. */
export type { ContentReportStatus };
