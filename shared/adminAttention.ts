/**
 * ── WHAT AN ADMIN ATTENTION BADGE MEANS, IN BOTH LANGUAGES ──────────────
 *
 * `server/adminAttention.ts` counts the queues and ships a `meaning` string
 * so a badge is never a bare number to be guessed at. That was right, and
 * the wording was ENGLISH ONLY - rendered as the `title` tooltip on every
 * Admin attention badge, so on an Arabic Admin page the one explanation of
 * what a number means was in a language the reader may not have (§67).
 *
 * It is invisible to a sighted English reader and invisible to any test that
 * looks at visible text, which is why the visual-QA sweep found it and four
 * years of reading the file would not have.
 *
 * THE WORDING LIVES HERE, in shared/, for the reason §11 gives: the server
 * needs it for its own contract tests and the client needs it to render, and
 * two copies of the same sentence drift. The server keeps shipping `meaning`
 * as the canonical English text; the CLIENT renders from this function, so
 * an Arabic reader gets Arabic and nobody has to remember to translate a
 * string that is generated on the other side of the wire.
 */
import { ATTENTION_QUEUES, type AttentionQueue } from './adminAttentionQueues';

export { ATTENTION_QUEUES };
export type { AttentionQueue };

const MEANINGS: Readonly<Record<AttentionQueue, { en: string; ar: string }>> = {
  enquiries: {
    en: 'unassigned, on a request that is still open',
    ar: 'غير مُسندة، على طلب ما زال مفتوحاً',
  },
  registrations: {
    en: 'professional registrations awaiting a decision',
    ar: 'تسجيلات مهنية بانتظار القرار',
  },
  disputes: {
    en: 'disputes still being worked on',
    ar: 'نزاعات ما زال العمل جارياً عليها',
  },
  support: {
    en: 'tickets waiting on us, not on the requester',
    ar: 'تذاكر تنتظر ردّنا، لا ردّ صاحب الطلب',
  },
  reviews: {
    en: 'reported reviews not yet resolved',
    ar: 'تقييمات مُبلَّغ عنها لم تُحل بعد',
  },
  nameChanges: {
    en: 'name change requests still open',
    ar: 'طلبات تغيير الاسم ما زالت مفتوحة',
  },
  productQuestions: {
    en: 'reported product questions and answers not yet resolved',
    ar: 'أسئلة وأجوبة منتجات مُبلَّغ عنها لم تُحل بعد',
  },
};

/**
 * What this queue's count means, in the reader's language.
 *
 * Falls back to the queue key only if a NEW queue is added without a
 * meaning - and `adminAttention.test.ts` fails in that case, so the fallback
 * is a safety net rather than a permitted state.
 */
export function attentionMeaning(queue: string, lang: 'en' | 'ar'): string {
  const entry = (MEANINGS as Record<string, { en: string; ar: string }>)[queue];
  if (!entry) return queue;
  return lang === 'ar' ? entry.ar : entry.en;
}

/** The canonical English wording, which the server ships as `meaning`. */
export function attentionMeaningEn(queue: AttentionQueue): string {
  return MEANINGS[queue].en;
}
