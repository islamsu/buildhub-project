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
export type MoneyFormatOptions = {
  /**
   * COMPACT NOTATION, for a KPI tile - "EGP 1.2M" rather than "EGP 1,248,300".
   *
   * It exists here because the alternative was a second spelling. A dashboard
   * needed a short number, so it wrote `${t('common.egp')} ${compact(total)}`
   * and thereby left the one place that knows about currencies - which is how
   * a Saudi project's budget ended up labelled in Egyptian pounds. Shortening
   * a number is a formatting choice; naming its currency is not.
   *
   * Never for a price, a quotation or any figure somebody transacts on: "EGP
   * 1.2M" is not a number you can accept a bid at.
   */
  compact?: boolean;
};

export function formatMoney(
  amount: number | string | null | undefined,
  currency: string | null | undefined,
  lang: 'en' | 'ar' = 'en',
  options: MoneyFormatOptions = {},
): string | null {
  if (amount === null || amount === undefined || amount === '') return null;
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return null;

  const code = (currency ?? '').trim().toUpperCase();
  // NO CURRENCY MEANS NO CURRENCY. A record that does not say what its number
  // is denominated in gets a bare number rather than a guessed one; the fixes
  // in this pass are what stop that happening for new records.
  if (code.length !== 3) {
    return value.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US',
      options.compact ? { notation: 'compact', maximumFractionDigits: 1 } : {});
  }

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
      // Compact notation and an explicit fraction scale are mutually
      // exclusive in practice: "EGP 1.2M" carries one decimal by design, and
      // asking for three would produce "EGP 1.248M" in a tile meant to be
      // read at a glance.
      ...(options.compact
        ? { notation: 'compact' as const, maximumFractionDigits: 1 }
        : (digits === null ? {} : { maximumFractionDigits: digits })),
    }).format(value);
  } catch {
    // An unknown ISO code reaches Intl as a RangeError. Showing the number
    // beside the code it was stored with is more honest than showing neither.
    return `${code} ${value.toLocaleString(locale,
      options.compact ? { notation: 'compact', maximumFractionDigits: 1 } : {})}`;
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

/**
 * ── YOU CANNOT ADD EGP TO SAR ───────────────────────────────────────────
 *
 * A dashboard KPI read `EGP ${projects.reduce((sum, p) => sum + p.budget)}`.
 * One label, one number, every project's budget added together - and the
 * moment a buyer runs one project in Egypt and one in Saudi Arabia, that
 * number is not a total of anything. It is two currencies summed as if they
 * were one unit and then labelled with whichever the view happened to name.
 *
 * Nothing in a formatter can fix that, because the mistake is the addition.
 * So amounts are grouped by the currency they are denominated in first, and
 * what comes out is one total per currency - which is the true answer, and is
 * usually one entry because most accounts work in one market.
 *
 * Ordered by size, so the largest total leads when a view shows only some.
 */
export function sumByCurrency(
  rows: readonly { amount: number | string | null | undefined; currency: string | null | undefined }[],
): { currency: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.amount === null || row.amount === undefined || row.amount === '') continue;
    const value = typeof row.amount === 'string' ? Number(row.amount) : row.amount;
    if (!Number.isFinite(value)) continue;
    // An unstated currency is its own bucket, NOT folded into a real one. It
    // is the one case where guessing would put a number under a wrong label.
    const code = (row.currency ?? '').trim().toUpperCase();
    const key = code.length === 3 ? code : '';
    totals.set(key, (totals.get(key) ?? 0) + value);
  }
  // Array.from rather than a spread: this file is compiled for a target that
  // does not down-level a Map iterator.
  return Array.from(totals, ([currency, total]) => ({ currency, total }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

/**
 * Render what `sumByCurrency` produced, for a KPI tile.
 *
 * `null` for nothing at all - a fresh account with no projects has no budget,
 * and a KPI that says "EGP 0" has invented a fact about a currency the account
 * has never used. The caller writes the dash.
 *
 * Beyond `max` currencies the remainder is COUNTED rather than dropped: "+2
 * more" is a true statement about a total that does not fit, and silently
 * showing the largest two as though they were everything is not.
 */
export function formatMoneyTotals(
  totals: readonly { currency: string; total: number }[],
  lang: 'en' | 'ar' = 'en',
  max = 2,
  options: MoneyFormatOptions = {},
): string | null {
  if (totals.length === 0) return null;
  const shown = totals.slice(0, Math.max(1, max));
  const parts = shown.map(entry => formatMoney(entry.total, entry.currency, lang, options) ?? String(entry.total));
  const hidden = totals.length - shown.length;
  if (hidden > 0) {
    parts.push(lang === 'ar' ? `+${hidden} عملة أخرى` : `+${hidden} more`);
  }
  return parts.join(' · ');
}
