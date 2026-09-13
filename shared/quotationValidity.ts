/**
 * ── HOW LONG A PRICE HOLDS ────────────────────────────────────────────────
 *
 * `validUntil` is required on every quotation, stored, rendered on the
 * comparison screen and pinned in the field history. It was enforced NOWHERE.
 *
 * Proven against the running product: a quotation whose validity ended on 1
 * January was accepted on 12 September, its status moved to `accepted`, the
 * losing bids were auto-rejected, and nothing anywhere had told the customer
 * the price was months stale. A supplier who writes "this holds until 1
 * October" means it; binding them to it in December is not a UI nicety, it is
 * the platform enforcing a commitment that was never made.
 *
 * ── THE DAY IS INCLUSIVE ──────────────────────────────────────────────────
 *
 * "Valid until 1 October" means through the whole of 1 October, not until
 * midnight as it begins. The submission rule already reads it that way - it
 * accepts a validity of TODAY, comparing against `setHours(0, 0, 0, 0)` - and
 * a reader that expired it at 00:00 would refuse on the morning of a date the
 * writer had just been allowed to enter. One rule, both ends.
 */

/** The last instant a validity date still covers: the end of that day, locally. */
export function validityEndsAt(validUntil: Date | string | null | undefined): Date | null {
  if (validUntil === null || validUntil === undefined) return null;
  const date = validUntil instanceof Date ? new Date(validUntil.getTime()) : new Date(validUntil);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(23, 59, 59, 999);
  return date;
}

/**
 * Has this price stopped holding?
 *
 * A quotation with NO validity date is not expired. Nothing can write one
 * today - the field is required - but historical rows predate that rule, and
 * treating a missing date as "expired" would retire bids nobody withdrew.
 */
export function isQuotationExpired(
  validUntil: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  const ends = validityEndsAt(validUntil);
  if (ends === null) return false;
  return now.getTime() > ends.getTime();
}

/**
 * Can this quotation still be ACCEPTED?
 *
 * Status and validity, together, because the screen asks one question - "may I
 * click accept" - and answering it from two places is how the button and the
 * server start disagreeing.
 */
export function canAcceptQuotation(
  quotation: { status?: string | null; validUntil?: Date | string | null },
  now: Date = new Date(),
): boolean {
  if ((quotation.status ?? 'pending') !== 'pending') return false;
  return !isQuotationExpired(quotation.validUntil, now);
}

/** The refusal, in the vocabulary the screen translates rather than a sentence. */
export const QUOTATION_EXPIRED_MESSAGE =
  'This quotation\'s validity has passed. Ask the supplier to re-confirm their price before accepting it.';
