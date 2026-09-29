/**
 * ── THE REFERRAL VOCABULARY, IN ONE PLACE ─────────────────────────────────
 *
 * The invite screen printed the stored enum straight onto the page:
 *
 *   EXTRA_QUALIFIED_ENQUIRIES: 5
 *
 * That is a database column shown to a customer as though it were the
 * product's own language, and it cannot be translated - an Arabic reader got
 * the same SCREAMING_SNAKE_CASE. It also asks the reader to work out what they
 * were given, which is the one thing a rewards screen exists to answer.
 *
 * Every referral enum a person can see is named here, in both languages, with
 * the VALUE folded into the sentence where the number only means something
 * alongside its unit - "5 extra qualified enquiries" rather than "5".
 *
 * THE STORED VALUES ARE UNCHANGED. This is a vocabulary for reading.
 */
type Lang = 'en' | 'ar';

/** What the reward IS, as a sentence including its amount. */
export function rewardSentence(type: string, value: number | string | null, lang: Lang): string {
  const amount = value === null || value === undefined || value === '' ? null : Number(value);
  const n = amount === null || Number.isNaN(amount) ? null : amount;
  const ar = lang === 'ar';
  switch (type) {
    case 'EXTRA_QUALIFIED_ENQUIRIES':
      return n === null
        ? (ar ? 'طلبات مؤهَّلة إضافية' : 'Extra qualified enquiries')
        : (ar ? `${n} طلب مؤهَّل إضافي هذا الشهر` : `${n} extra qualified ${n === 1 ? 'enquiry' : 'enquiries'} this month`);
    case 'TEMPORARY_FEATURED':
      return n === null
        ? (ar ? 'ظهور مميّز مؤقت' : 'A temporary featured placement')
        : (ar ? `ظهور مميّز لمدة ${n} يومًا` : `A featured placement for ${n} ${n === 1 ? 'day' : 'days'}`);
    case 'SUBSCRIPTION_EXTENSION':
      return n === null
        ? (ar ? 'تمديد الاشتراك' : 'Extra time on your subscription')
        : (ar ? `${n} يومًا إضافيًا على اشتراكك الحالي` : `${n} extra ${n === 1 ? 'day' : 'days'} on your current subscription`);
    default:
      /*
       * An unknown type is shown AS STORED rather than hidden behind a dash.
       * A reward this table has not learned about is a gap in the table, and a
       * person who can see the raw token can at least ask about it; a dash
       * would say the same thing as "no reward", which is certainly wrong.
       */
      return n === null ? type : `${type}: ${n}`;
  }
}

/** Where a referral has got to, for the person who sent the invitation. */
export function referralStateLabel(status: string, lang: Lang): string {
  const ar = lang === 'ar';
  const labels: Record<string, [string, string]> = {
    registered: ['Signed up', 'سجّل'],
    qualified: ['Qualified', 'استوفى الشروط'],
    rewarded: ['Rewarded', 'تمت المكافأة'],
    expired: ['Expired', 'انتهت'],
    revoked: ['Withdrawn', 'أُلغيت'],
  };
  return labels[status]?.[ar ? 1 : 0] ?? status;
}

/** What the person had to DO for the referral to count. */
export function qualificationLabel(type: string | null, lang: Lang): string | null {
  if (!type) return null;
  const ar = lang === 'ar';
  const labels: Record<string, [string, string]> = {
    ACCOUNT_VERIFIED: ['their account was verified', 'تم التحقق من حسابه'],
    PROVIDER_APPROVED: ['their registration was approved', 'تمت الموافقة على تسجيله'],
    PROFILE_COMPLETED: ['they completed their profile', 'أكمل ملفه'],
    FIRST_VALID_RFQ: ['they posted their first request', 'نشر أول طلب عرض سعر'],
    FIRST_VALID_QUOTATION_RESPONSE: ['they sent their first quotation', 'قدّم أول عرض سعر'],
  };
  return labels[type]?.[ar ? 1 : 0] ?? type;
}

/** The reward's current standing, in the reader's language. */
export function rewardStatusLabel(status: string, lang: Lang): string {
  const ar = lang === 'ar';
  const labels: Record<string, [string, string]> = {
    PENDING: ['Pending', 'قيد التنفيذ'],
    GRANTED: ['Active', 'فعّالة'],
    EXPIRED: ['Ended', 'منتهية'],
    REVERSED: ['Withdrawn', 'مسحوبة'],
    REJECTED: ['Not granted', 'لم تُمنح'],
  };
  return labels[status]?.[ar ? 1 : 0] ?? status;
}
