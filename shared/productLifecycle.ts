/**
 * ── THE PRODUCT LIFECYCLE ─────────────────────────────────────────────────
 *
 * WHAT ALREADY WORKED, so the addition is not mistaken for a rewrite: a
 * supplier could list a product, correct it, manage its photos, and publish or
 * delist it. Delisting was already reversible and already refused to delete
 * the row, because questions, quotations and order history reference it.
 *
 * WHAT WAS MISSING: `products.active` is a BOOLEAN, and a boolean can only say
 * two things. It could not distinguish
 *
 *   a product still being written        (DRAFT — never published, so "not
 *                                        visible" is not a withdrawal),
 *   a product temporarily off sale       (INACTIVE — out of stock, seasonal;
 *                                        the supplier means to bring it back),
 *   and a product retired for good       (ARCHIVED — discontinued, out of the
 *                                        supplier's working list, and out of
 *                                        the catalogue).
 *
 * All three read as `active = 0`, so a catalogue of two hundred products gave
 * the supplier one undifferentiated pile of "not live" rows and no way to tell
 * a half-written draft from a line they discontinued last year.
 *
 * ARCHIVE, NEVER DELETE. There is no delete in this vocabulary and that is the
 * point: a product id appears in questions, quotations, placements and audit
 * events, and removing the row to tidy a list would take the history with it
 * and leave those references pointing at nothing.
 */

export const PRODUCT_STATUSES = ['draft', 'active', 'inactive', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/**
 * THE ONE DEFINITION OF "A BUYER CAN SEE THIS". Draft has never been
 * published, inactive has been withdrawn, archived is retired - none of them
 * belongs in the marketplace, in search, in a placement, or on a vendor's
 * public page.
 */
export const PRODUCT_PUBLIC_STATUS: ProductStatus = 'active';

/**
 * The declared moves. Everything absent is refused, and the refusal names both
 * states rather than saying "invalid".
 *
 * ARCHIVED IS NOT TERMINAL, but coming back is deliberate: an archived product
 * returns to INACTIVE, not straight to the marketplace. Restoring a
 * discontinued line and republishing it are two decisions, and a single click
 * that did both would put a year-old price back in front of buyers.
 *
 * DRAFT IS ONE-WAY. A published product never returns to draft: it has been
 * seen, asked about and possibly quoted on, and "unpublished so I can rewrite
 * it" is what INACTIVE is for.
 */
export const PRODUCT_TRANSITIONS: Readonly<Record<ProductStatus, readonly ProductStatus[]>> = {
  draft:    ['active', 'archived'],
  active:   ['inactive', 'archived'],
  inactive: ['active', 'archived'],
  archived: ['inactive'],
};

export function canTransitionProduct(from: ProductStatus, to: ProductStatus): boolean {
  return (PRODUCT_TRANSITIONS[from] ?? []).includes(to);
}

/** Statuses a supplier may create a product in. Publishing later is a move. */
export const PRODUCT_CREATABLE_STATUSES = ['draft', 'active'] as const;

export const PRODUCT_VOCABULARY = {
  status: {
    draft:    { en: 'Draft',    ar: 'مسودة' },
    active:   { en: 'Live',     ar: 'منشور' },
    inactive: { en: 'Off sale', ar: 'موقوف مؤقتًا' },
    archived: { en: 'Archived', ar: 'مؤرشف' },
  },
  /** What the state means for a buyer, said plainly rather than implied. */
  statusHelp: {
    draft:    { en: 'Only you can see this. Publish it when it is ready.',
                ar: 'أنت وحدك من يراه. انشره عندما يصبح جاهزًا.' },
    active:   { en: 'Live in the marketplace and open to enquiries.',
                ar: 'منشور في السوق ومتاح للاستفسارات.' },
    inactive: { en: 'Withdrawn from the marketplace. Its history is kept and you can publish it again.',
                ar: 'مسحوب من السوق. سجلّه محفوظ ويمكنك نشره مرة أخرى.' },
    archived: { en: 'Retired. Kept for its history — restore it to Off sale before publishing again.',
                ar: 'متقاعد. محفوظ لسجلّه — أعِده إلى "موقوف مؤقتًا" قبل نشره من جديد.' },
  },
} as const;

export function productStatusLabel(status: string, lang: string): string {
  const entry = (PRODUCT_VOCABULARY.status as Record<string, { en: string; ar: string }>)[status];
  if (!entry) return status;
  return lang === 'ar' ? entry.ar : entry.en;
}

export function productStatusHelp(status: string, lang: string): string {
  const entry = (PRODUCT_VOCABULARY.statusHelp as Record<string, { en: string; ar: string }>)[status];
  if (!entry) return '';
  return lang === 'ar' ? entry.ar : entry.en;
}

/**
 * The bridge for the legacy boolean.
 *
 * `products.active` is kept for one migration so the 0049 backfill is
 * reversible by inspection, exactly as `disputes.projectId` was kept after the
 * subject became polymorphic. It is DERIVED - written in one place, from the
 * status, never independently - and a test holds the two in agreement. It is
 * deliberately NOT a second authoritative field, which is the shape that
 * produced four disagreeing category vocabularies elsewhere in this codebase.
 */
export const activeFromStatus = (status: ProductStatus): boolean => status === PRODUCT_PUBLIC_STATUS;
