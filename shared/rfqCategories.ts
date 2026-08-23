// ── RFQ / Vendor Service Taxonomy ──────────────────────────────────────────
// Phase 4B.3. THE single source of truth for the category vocabulary shared by
// both sides of the marketplace:
//
//   • a customer classifies an RFQ with one of these values
//   • a vendor declares which of these values describe the work they do
//   • RFQ → vendor eligibility is an exact match between the two
//
// These are the exact nine values already in production use in BuildHub's
// RFQ-creation form (client/src/pages/RFQPage.tsx before this phase). Nothing
// was invented, renamed, or added - the list was promoted from a client-only
// constant to a shared module so the two sides of the match can never drift
// apart by one file being edited without the other.
//
// The English string is the canonical value persisted in the database
// (rfqs.category, vendorCategories.category). The Arabic label is display-only
// and never stored, so switching language can never change what a row means.

export const RFQ_CATEGORIES = [
  'Materials',
  'Labor',
  'Complete Project',
  'Engineering',
  'Design',
  'Furniture',
  'Maintenance',
  'Renovation',
  'Custom Services',
] as const;

export type RfqCategory = (typeof RFQ_CATEGORIES)[number];

/** Display-only Arabic labels. Never persisted; the English value is canonical. */
export const RFQ_CATEGORY_LABELS_AR: Readonly<Record<RfqCategory, string>> = {
  'Materials': 'مواد بناء',
  'Labor': 'عمالة',
  'Complete Project': 'مشروع متكامل',
  'Engineering': 'أعمال هندسية',
  'Design': 'تصميم',
  'Furniture': 'أثاث',
  'Maintenance': 'صيانة',
  'Renovation': 'تشطيب وترميم',
  'Custom Services': 'خدمات خاصة',
} as const;

export function isRfqCategory(value: unknown): value is RfqCategory {
  return typeof value === 'string' && (RFQ_CATEGORIES as readonly string[]).includes(value);
}

export function rfqCategoryLabel(category: string, lang: string): string {
  if (lang === 'ar' && isRfqCategory(category)) return RFQ_CATEGORY_LABELS_AR[category];
  return category;
}

/**
 * An RFQ is *classifiable* only when its category is one of the nine known
 * values. A null, empty, or unrecognised category means BuildHub cannot say
 * which vendors the opportunity is genuinely relevant to.
 *
 * CONSERVATIVE FALLBACK (Phase 4B.3 §5): such an RFQ is eligible for NOBODY
 * through targeting. It is deliberately not treated as "relevant to everyone" -
 * that would expose every RFQ to every vendor and would charge vendors a
 * qualified-enquiry credit for an opportunity nothing has established is
 * qualified for them. It remains fully visible in the ordinary public RFQ
 * listing, so it is not hidden from the platform; it simply never becomes a
 * *targeted* qualified enquiry. Nothing is silently classified.
 */
export function isClassifiableRfqCategory(category: string | null | undefined): category is RfqCategory {
  return isRfqCategory(category);
}
