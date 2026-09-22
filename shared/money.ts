/**
 * ── ONE PLACE THAT TURNS AN AMOUNT INTO A STRING ────────────────────────
 *
 * CLAUDE.md §86: establish one canonical money/currency formatting layer.
 *
 * There were at least six spellings of the same idea in the client, and they
 * did not agree:
 *
 *   `${price} EGP`                      product cards
 *   `EGP ${amount.toLocaleString()}`    project expenses
 *   `${n.toLocaleString()} ج.م`         the Arabic service catalogue
 *   `${n} ${currency ?? 'EGP'}`         quotation comparison
 *   `Price (EGP)`                       a form label with the unit baked in
 *
 * Three of them put the currency after the number and two before it; two
 * localised the digits and three did not; and the ones that fell back to
 * 'EGP' would have quietly labelled a Saudi quotation in Egyptian pounds the
 * day a second market existed. That last one is not a formatting nit - it is
 * a wrong number shown to somebody deciding whether to accept a bid.
 *
 * THE RULES THIS MODULE ENFORCES:
 *
 *   the currency comes from the RECORD, never from a default in the view
 *   an absent amount renders as absent, never as zero
 *   the locale decides digit grouping and currency placement, not the caller
 *   the currency CODE is shown, not a symbol - "ج.م" and "﷼" are ambiguous
 *     across markets in a way "EGP" and "SAR" are not, and a procurement
 *     screen is the wrong place to be charming
 */

import { fractionDigitsFor } from './markets';

/**
 * Format an amount in its own currency.
 *
 * `amount` may be a string because every money column in this schema is
 * DECIMAL, and DECIMAL arrives from mysql2 as a string - parsing it to a
 * float at the edge of the view is how a rounding difference gets into a
 * price. It is parsed once, here.
 *
 * Returns null when there is no amount. A caller that wants a dash writes the
 * dash; this module does not decide how absence looks, only that it is not 0.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  currency: string | null | undefined,
  lang: 'en' | 'ar' = 'en',
): string | null {
  if (amount === null || amount === undefined || amount === '') return null;
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return null;

  const code = (currency ?? '').trim().toUpperCase();
  // NO CURRENCY MEANS NO CURRENCY. A record that does not say what its number
  // is denominated in gets a bare number rather than a guessed one; the fixes
  // in this pass are what stop that happening for new records.
  if (code.length !== 3) return value.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US');

  const locale = lang === 'ar' ? 'ar-EG' : 'en-US';

  /**
   * THE CURRENCY'S OWN SCALE, NOT A PLATFORM-WIDE TWO.
   *
   * This read `maximumFractionDigits: 2`, which is right for EGP, SAR, AED
   * and QAR and WRONG for half the GCC: the Kuwaiti and Bahraini dinars and
   * the Omani rial are divided into 1,000, not 100. Capping them at two
   * digits does not shorten a number, it CHANGES it - 1,234.567 KWD becomes
   * 1,234.57, nearly a fil out, on a quotation that is a commercial document.
   *
   * `fractionDigitsFor` returns null for a currency BuildHub has no scale
   * for, and the fallback then lets Intl use the ISO default rather than
   * imposing Egypt's. Minimum stays 0 so a whole-unit price does not carry a
   * trailing ".00" or ".000" through a dense table.
   */
  const digits = fractionDigitsFor(code);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'code',
      minimumFractionDigits: 0,
      ...(digits === null ? {} : { maximumFractionDigits: digits }),
    }).format(value);
  } catch {
    // An unknown ISO code reaches Intl as a RangeError. Showing the number
    // beside the code it was stored with is more honest than showing neither.
    return `${code} ${value.toLocaleString(locale)}`;
  }
}

/**
 * A money RANGE - "EGP 120 – 260" - for indicative service pricing.
 *
 * Both ends share one currency because a range across two currencies is not a
 * range. An open end renders as an open end.
 */
export function formatMoneyRange(
  min: number | string | null | undefined,
  max: number | string | null | undefined,
  currency: string | null | undefined,
  lang: 'en' | 'ar' = 'en',
  copy: { from: string; upTo: string } = { from: 'from', upTo: 'up to' },
): string | null {
  const low = formatMoney(min, currency, lang);
  const high = formatMoney(max, currency, lang);
  if (low && high) return `${low} – ${high}`;
  if (low) return `${copy.from} ${low}`;
  if (high) return `${copy.upTo} ${high}`;
  return null;
}
