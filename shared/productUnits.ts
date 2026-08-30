/**
 * THE UNIT A PRODUCT IS SOLD IN.
 *
 * `unit` was a free-text input in both the create form and the catalogue
 * editor, and the catalogue shows what that produces: sixteen products priced
 * per "tonne" and three per "ton". Same unit, two spellings, and a buyer
 * comparing two cement suppliers cannot tell whether the second is a third of
 * the price or the same price in a different word.
 *
 * A controlled list fixes the comparison at the point of entry, which is the
 * only place it can be fixed - nothing downstream can tell whether "ton" meant
 * a metric tonne or a short ton.
 *
 * WHY THIS IS A LIST AND NOT A DATABASE ENUM. The column is `varchar(50)` and
 * already holds free text on real rows. Migrating it to an enum would have to
 * decide, for every existing product, what its author meant - and that decision
 * belongs to the supplier who wrote it, not to a migration. So the column stays
 * as it is, the UI offers the list, and `normaliseUnit` below lets an existing
 * value through unchanged.
 *
 * THE RULE, and the reason it is not simply "reject anything unknown":
 *
 *   A NEW unit must come from this list.
 *   An EXISTING unit is preserved even if it is not in the list.
 *
 * Rejecting unknown units outright would mean a supplier who opens one of those
 * sixteen "tonne" products, changes the price, and saves, gets their save
 * refused because of a unit they did not touch and cannot fix from that form.
 * Tightening a rule must not lock people out of their own records.
 */

export const PRODUCT_UNITS = [
  // Count
  'piece', 'unit', 'set', 'pair', 'dozen', 'pack', 'box', 'pallet',
  // Mass
  'kg', 'tonne', 'bag',
  // Length, area, volume
  'm', 'm2', 'm3', 'linear metre', 'roll', 'sheet',
  // Liquid
  'litre', 'drum', 'bucket',
  // Trade
  'bundle', 'container', 'truckload',
] as const;

export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export function isProductUnit(value: unknown): value is ProductUnit {
  return typeof value === 'string' && (PRODUCT_UNITS as readonly string[]).includes(value);
}

/**
 * What to store for a submitted unit, given what the record already holds.
 *
 * Returns the value to persist, or `null` to mean "refuse this write".
 *
 *   - nothing submitted            -> keep whatever is there (no change)
 *   - a unit from the list         -> accept it
 *   - the value already stored     -> accept it, unchanged, however it is spelt
 *   - anything else                -> refuse
 *
 * The third case is the one that matters: it is what stops this rule from
 * turning every legacy row into a record its owner can no longer save.
 */
export function normaliseUnit(
  submitted: string | null | undefined,
  existing: string | null | undefined,
): { ok: true; value: string | null | undefined } | { ok: false } {
  if (submitted === undefined) return { ok: true, value: undefined };
  if (submitted === null || submitted === '') return { ok: true, value: null };
  if (isProductUnit(submitted)) return { ok: true, value: submitted };
  // Unchanged legacy value, let through deliberately.
  if (existing != null && existing !== '' && submitted === existing) {
    return { ok: true, value: submitted };
  }
  return { ok: false };
}
