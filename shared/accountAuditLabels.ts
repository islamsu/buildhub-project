/**
 * ── WHAT AN AUDIT EVENT IS CALLED, IN BOTH LANGUAGES ────────────────────
 *
 * The audit trail rendered `row.action` RAW - `admin_password_reset_requested`
 * in a badge, and the filter dropdown offered the same snake_case as its
 * option labels. §55 and §72 both forbid it: no raw enums, no snake_case, no
 * database terminology in user-facing text. §67 adds the second half - an
 * Arabic-reading administrator got English identifiers either way.
 *
 * Found by the visual-QA sweep on `/admin/analytics`, which reported
 * `signed_in` as a raw token in visible text.
 *
 * ── WHY A TABLE AND NOT A HUMANIZER ────────────────────────────────────
 *
 * Turning `admin_signed_in` into "Admin signed in" mechanically is easy in
 * English and IMPOSSIBLE in Arabic - word order, agreement and the passive
 * all differ - so a humanizer would have produced English on an Arabic
 * screen for all 77 events, which is the defect wearing a nicer hat. Every
 * event is written out.
 *
 * The list is EXHAUSTIVE against `ACCOUNT_AUDIT_ACTIONS`, and
 * `accountAuditLabels.test.ts` fails if an action is added without a label -
 * so a new event cannot quietly reintroduce a raw enum.
 */

const LABELS: Readonly<Record<string, { en: string; ar: string }>> = {
  // Account lifecycle
  account_created: { en: 'Account created', ar: 'أُنشئ الحساب' },
  oauth_identity_linked: { en: 'Sign-in identity linked', ar: 'رُبطت هوية تسجيل الدخول' },
  password_account_created: { en: 'Account created with a password', ar: 'أُنشئ الحساب بكلمة مرور' },
  profile_role_completed: { en: 'Profile role completed', ar: 'استُكمل دور الملف الشخصي' },

  // Authentication
  admin_signed_in: { en: 'Administrator signed in', ar: 'سجّل مشرف الدخول' },
  password_signed_in: { en: 'Signed in with a password', ar: 'تسجيل دخول بكلمة مرور' },
  dummy_user_signed_in: { en: 'Test account signed in', ar: 'سجّل حساب اختباري الدخول' },
  password_reset_requested: { en: 'Password reset requested', ar: 'طُلبت إعادة تعيين كلمة المرور' },
  password_reset_completed: { en: 'Password reset completed', ar: 'اكتملت إعادة تعيين كلمة المرور' },
  password_set_via_invitation: { en: 'Password set from an invitation', ar: 'عُيّنت كلمة المرور عبر دعوة' },

  // Administrator authority
  super_admin_bootstrapped: { en: 'First super administrator created', ar: 'أُنشئ أول مشرف عام' },
  admin_created: { en: 'Administrator created', ar: 'أُنشئ مشرف' },
  admin_role_changed: { en: 'Administrator role changed', ar: 'تغيّر دور المشرف' },
  admin_activated: { en: 'Administrator activated', ar: 'نُشّط المشرف' },
  admin_reactivated: { en: 'Administrator reactivated', ar: 'أُعيد تنشيط المشرف' },
  admin_deactivated: { en: 'Administrator deactivated', ar: 'أُوقف المشرف' },
  admin_sessions_revoked: { en: 'Administrator sessions revoked', ar: 'أُلغيت جلسات المشرف' },
  admin_password_changed: { en: 'Administrator password changed', ar: 'تغيّرت كلمة مرور المشرف' },
  admin_password_reset_requested: { en: 'Administrator password reset requested', ar: 'طُلبت إعادة تعيين كلمة مرور المشرف' },
  admin_invitation_redeemed: { en: 'Administrator invitation redeemed', ar: 'استُخدمت دعوة المشرف' },
  admin_invitation_revoked: { en: 'Administrator invitation revoked', ar: 'أُلغيت دعوة المشرف' },

  // An administrator acting on a user account
  admin_created_account: { en: 'Account created by an administrator', ar: 'أنشأ مشرف الحساب' },
  admin_created_account_with_invite: { en: 'Account created by an administrator with an invitation', ar: 'أنشأ مشرف الحساب مع دعوة' },
  admin_user_updated: { en: 'Account updated by an administrator', ar: 'حدّث مشرف الحساب' },
  invitation_resent: { en: 'Invitation resent', ar: 'أُعيد إرسال الدعوة' },
  account_frozen: { en: 'Account frozen', ar: 'جُمّد الحساب' },
  account_unfrozen: { en: 'Account unfrozen', ar: 'أُلغي تجميد الحساب' },
  account_verified: { en: 'Account verified', ar: 'تم توثيق الحساب' },
  account_unverified: { en: 'Account verification removed', ar: 'أُزيل توثيق الحساب' },

  // QA personas
  dummy_user_created: { en: 'Test account created', ar: 'أُنشئ حساب اختباري' },
  dummy_user_deleted: { en: 'Test account deleted', ar: 'حُذف حساب اختباري' },
  dummy_user_activated: { en: 'Test account activated', ar: 'نُشّط حساب اختباري' },
  dummy_user_deactivated: { en: 'Test account deactivated', ar: 'أُوقف حساب اختباري' },
  dummy_user_password_changed: { en: 'Test account password changed', ar: 'تغيّرت كلمة مرور حساب اختباري' },
  test_login_link_issued: { en: 'Test sign-in link issued', ar: 'صُدر رابط دخول اختباري' },
  test_login_link_redeemed: { en: 'Test sign-in link used', ar: 'استُخدم رابط دخول اختباري' },
  test_login_link_revoked: { en: 'Test sign-in link revoked', ar: 'أُلغي رابط دخول اختباري' },

  // Entitlements and commercial placement
  plan_changed_manually: { en: 'Plan changed manually', ar: 'تغيّرت الخطة يدوياً' },
  enquiry_allowance_changed: { en: 'Enquiry allowance changed', ar: 'تغيّر رصيد الطلبات' },
  enquiries_exported: { en: 'Enquiries exported', ar: 'صُدّرت الطلبات' },
  placement_booked: { en: 'Placement booked', ar: 'حُجزت مساحة عرض' },
  featured_granted: { en: 'Featured placement granted', ar: 'مُنح ترشيح مميّز' },
  featured_removed: { en: 'Featured placement removed', ar: 'أُزيل الترشيح المميّز' },
  sponsorship_granted: { en: 'Sponsorship granted', ar: 'مُنحت رعاية' },
  sponsorship_revoked: { en: 'Sponsorship revoked', ar: 'أُلغيت الرعاية' },

  // Referral
  referral_campaign_created: { en: 'Referral campaign created', ar: 'أُنشئت حملة إحالة' },
  referral_campaign_updated: { en: 'Referral campaign updated', ar: 'حُدّثت حملة إحالة' },
  referral_qualified: { en: 'Referral qualified', ar: 'تأهّلت إحالة' },
  referral_reward_granted: { en: 'Referral reward granted', ar: 'مُنحت مكافأة إحالة' },
  referral_reward_reversed: { en: 'Referral reward reversed', ar: 'عُكست مكافأة إحالة' },
  referral_code_unusable: { en: 'Referral code became unusable', ar: 'أصبح رمز الإحالة غير قابل للاستخدام' },

  // Disputes
  dispute_opened: { en: 'Dispute opened', ar: 'فُتح نزاع' },
  dispute_status_changed: { en: 'Dispute status changed', ar: 'تغيّرت حالة النزاع' },
  dispute_withdrawn: { en: 'Dispute withdrawn', ar: 'سُحب النزاع' },
  dispute_reopened: { en: 'Dispute reopened', ar: 'أُعيد فتح النزاع' },
  dispute_assigned: { en: 'Dispute assigned', ar: 'أُسند النزاع' },
  dispute_resolved: { en: 'Dispute resolved', ar: 'حُلّ النزاع' },
  dispute_evidence_added: { en: 'Dispute evidence added', ar: 'أُضيف دليل إلى النزاع' },
  dispute_evidence_removed: { en: 'Dispute evidence removed', ar: 'أُزيل دليل من النزاع' },

  // Vendor name changes
  vendor_name_change_requested: { en: 'Name change requested', ar: 'طُلب تغيير الاسم' },
  vendor_name_change_under_review: { en: 'Name change under review', ar: 'تغيير الاسم قيد المراجعة' },
  vendor_name_change_needs_information: { en: 'Name change needs more information', ar: 'تغيير الاسم يحتاج معلومات إضافية' },
  vendor_name_change_approved: { en: 'Name change approved', ar: 'تم اعتماد تغيير الاسم' },
  vendor_name_change_rejected: { en: 'Name change rejected', ar: 'رُفض تغيير الاسم' },
  vendor_name_direct_correction: { en: 'Name corrected directly by an administrator', ar: 'صحّح مشرف الاسم مباشرةً' },

  // Support
  support_ticket_opened: { en: 'Support ticket opened', ar: 'فُتحت تذكرة دعم' },
  support_ticket_assigned: { en: 'Support ticket assigned', ar: 'أُسندت تذكرة دعم' },
  support_ticket_status_changed: { en: 'Support ticket status changed', ar: 'تغيّرت حالة تذكرة الدعم' },
  support_ticket_resolved: { en: 'Support ticket resolved', ar: 'حُلّت تذكرة الدعم' },
  support_ticket_closed: { en: 'Support ticket closed', ar: 'أُغلقت تذكرة الدعم' },
  support_ticket_priority_changed: { en: 'Support ticket priority changed', ar: 'تغيّرت أولوية تذكرة الدعم' },

  // Moderation
  review_reported: { en: 'Review reported', ar: 'أُبلغ عن تقييم' },
  review_hidden: { en: 'Review hidden', ar: 'أُخفي تقييم' },
  review_restored: { en: 'Review restored', ar: 'أُعيد إظهار تقييم' },
  review_report_resolved: { en: 'Review report resolved', ar: 'حُلّ تقرير عن تقييم' },
  product_question_report_resolved: { en: 'Product question report resolved', ar: 'حُلّ تقرير عن سؤال منتج' },

  // Platform
  platform_setting_changed: { en: 'Platform setting changed', ar: 'تغيّر إعداد في المنصة' },
};

/**
 * What this audit action is called, in the reader's language.
 *
 * An UNKNOWN action returns null rather than the raw identifier: a caller
 * that renders `?? action` at least does so deliberately, where a silent
 * fallback would put snake_case back on the screen and nothing would fail.
 */
export function accountAuditActionLabel(action: string, lang: 'en' | 'ar'): string | null {
  const entry = LABELS[action];
  if (!entry) return null;
  return lang === 'ar' ? entry.ar : entry.en;
}

/** Every action this module can name, for the exhaustiveness test. */
export function labelledAuditActions(): string[] {
  return Object.keys(LABELS);
}
