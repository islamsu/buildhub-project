/**
 * ── WHAT AN ANALYTICS EVENT IS CALLED, IN BOTH LANGUAGES ───────────────
 *
 * `AdminCommercialAnalytics` rendered `row.eventType` raw, so the Insights
 * page showed an administrator badges reading `user.signed_in` and
 * `subscription.payment_failed` - dotted identifiers straight out of the
 * event store. §55 and §72 forbid raw enums and database terminology in
 * user-facing text, and §67 adds that an English identifier is no better on
 * an Arabic screen.
 *
 * Found by the visual-QA sweep, which reported `signed_in` as a raw token on
 * `/admin/analytics`. It is a DIFFERENT vocabulary from the account-audit
 * actions in `accountAuditLabels.ts` - one records what happened to an
 * account, the other what happened on the platform - so they get separate
 * tables rather than one merged map that would have to know which is which.
 *
 * EXHAUSTIVE against `ANALYTICS_EVENTS`, with `analyticsEventLabels.test.ts`
 * failing if an event ships without a label.
 */

const LABELS: Readonly<Record<string, { en: string; ar: string }>> = {
  'user.registered': { en: 'User registered', ar: 'تسجيل مستخدم جديد' },
  'user.signed_in': { en: 'User signed in', ar: 'تسجيل دخول مستخدم' },

  'vendor.profile_completed': { en: 'Provider profile completed', ar: 'استُكمل ملف مزوّد' },
  'vendor.submitted_for_review': { en: 'Provider submitted for review', ar: 'أُرسل مزوّد للمراجعة' },
  'vendor.verified': { en: 'Provider verified', ar: 'تم توثيق مزوّد' },
  'vendor.review_rejected': { en: 'Provider review rejected', ar: 'رُفضت مراجعة مزوّد' },
  'vendor.categories_set': { en: 'Provider categories declared', ar: 'أُعلنت فئات مزوّد' },

  'rfq.posted': { en: 'Request posted', ar: 'نُشر طلب' },
  'enquiry.opened': { en: 'Enquiry opened', ar: 'فُتح طلب مؤهل' },
  'enquiry.limit_reached': { en: 'Enquiry allowance exhausted', ar: 'نفد رصيد الطلبات' },

  'quotation.submitted': { en: 'Quotation submitted', ar: 'قُدّم عرض سعر' },
  'quotation.accepted': { en: 'Quotation accepted', ar: 'قُبل عرض سعر' },
  'quotation.withdrawn': { en: 'Quotation withdrawn', ar: 'سُحب عرض سعر' },

  'subscription.trial_started': { en: 'Trial started', ar: 'بدأت فترة تجريبية' },
  'subscription.activated': { en: 'Subscription activated', ar: 'نُشّط اشتراك' },
  'subscription.renewed': { en: 'Subscription renewed', ar: 'تجدّد اشتراك' },
  'subscription.cancellation_scheduled': { en: 'Cancellation scheduled', ar: 'جُدول إلغاء اشتراك' },
  'subscription.resumed': { en: 'Subscription resumed', ar: 'استُؤنف اشتراك' },
  'subscription.lapsed': { en: 'Subscription lapsed', ar: 'انتهى اشتراك' },
  'subscription.plan_changed': { en: 'Plan changed', ar: 'تغيّرت الخطة' },
  'subscription.payment_failed': { en: 'Payment failed', ar: 'فشل دفع' },
  'subscription.payment_recovered': { en: 'Payment recovered', ar: 'نجح الدفع بعد تعذّره' },

  'placement.impression': { en: 'Placement seen', ar: 'ظهور مساحة عرض' },
  'placement.entity_view': { en: 'Placement opened', ar: 'فتح مساحة عرض' },
  'placement.cta_click': { en: 'Placement action clicked', ar: 'نقرة إجراء على مساحة عرض' },
  'placement.qualified_enquiry': { en: 'Placement led to a qualified enquiry', ar: 'أدّت مساحة عرض إلى طلب مؤهل' },
};

/**
 * What this event is called, in the reader's language.
 *
 * NULL for an unknown event rather than the identifier: a caller that falls
 * back does so visibly, where a silent fallback would put the dotted
 * identifier back on screen with nothing failing.
 */
export function analyticsEventLabel(eventType: string, lang: 'en' | 'ar'): string | null {
  const entry = LABELS[eventType];
  if (!entry) return null;
  return lang === 'ar' ? entry.ar : entry.en;
}

/** Every event this module can name, for the exhaustiveness test. */
export function labelledAnalyticsEvents(): string[] {
  return Object.keys(LABELS);
}
