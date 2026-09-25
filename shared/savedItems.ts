/**
 * ── THE BUYER'S SHORTLIST ───────────────────────────────────────────────
 *
 * PRODUCT_NORTH_STAR.md, CURRENT GLOBAL RELEASE item 9; CLAUDE.md §22, which
 * names the actions a buyer takes from discovery: save, compare, contact,
 * Add to RFQ, invite provider. Save was the one that did not exist.
 *
 * Sourcing a construction package is not a single sitting. A buyer comparing
 * eleven suppliers of porcelain tile across two days had nowhere to put the
 * four worth a second look - so the work of finding them was thrown away
 * every time they closed the tab, and the RFQ basket, which is a commitment
 * to ask for prices, was the only thing resembling a list.
 *
 * ONE TABLE FOR BOTH KINDS. A product and a provider are different records
 * and the same gesture, and the shortlist is read as one list far more often
 * than as two. Two tables would mean two readers, two counts and two chances
 * for them to disagree - the defect §11 exists to prevent.
 *
 * SAVING IS PRIVATE. A supplier must never learn who shortlisted them and
 * did not go on to ask for a price: that is a commercial signal the buyer did
 * not choose to send, and turning it into a lead would make the feature
 * something a buyer has to think twice about using.
 */

export const SAVED_ITEM_KINDS = ['product', 'provider'] as const;
export type SavedItemKind = (typeof SAVED_ITEM_KINDS)[number];

export function isSavedItemKind(value: unknown): value is SavedItemKind {
  return typeof value === 'string' && (SAVED_ITEM_KINDS as readonly string[]).includes(value);
}

/**
 * HOW MANY THINGS ONE BUYER MAY SHORTLIST.
 *
 * A bound rather than a business rule: a shortlist is for the handful worth
 * a second look, and an unbounded list is an unbounded read on every page
 * that renders the badge. Generous enough that no real sourcing exercise
 * meets it, small enough that nothing has to be paginated to be honest.
 */
export const MAX_SAVED_ITEMS = 200;

/** A note a buyer writes to themselves. Never shown to the saved party. */
export const MAX_SAVED_NOTE = 500;

export function savedItemsLabel(count: number, lang: 'en' | 'ar'): string {
  if (lang !== 'ar') return count === 1 ? '1 saved' : `${count} saved`;
  // Arabic counts a noun four ways; the shortlist badge is read constantly
  // and "2 محفوظ" is wrong in the language the product claims to speak.
  if (count === 1) return 'عنصر محفوظ';
  if (count === 2) return 'عنصران محفوظان';
  if (count % 100 >= 3 && count % 100 <= 10) return `${count} عناصر محفوظة`;
  return `${count} عنصرًا محفوظًا`;
}
