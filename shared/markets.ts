/**
 * ── THE MARKETS BUILDHUB CAN OPERATE IN ─────────────────────────────────
 *
 * Egypt-first, not Egypt-locked (CLAUDE.md §86, GCC_SCALE_READINESS.md §32-52).
 *
 * BuildHub had no concept of a market at all. It had `'EGP'` written into
 * eleven places, a free-text `location` on every RFQ, and - the one the owner
 * named directly - a quotation currency taken from the SUPPLIER'S SUBSCRIPTION
 * plan. Those are not a missing feature; they are a set of assumptions that
 * would each have to be found and unpicked separately the day a second country
 * mattered.
 *
 * THE FIVE FACTS THIS MODULE KEEPS APART, because the owner's policy is that
 * they must never be confused:
 *
 *   authentication   WHO you are.                 One account, globally.
 *   active market    WHICH marketplace you browse. A preference.
 *   project/RFQ      WHERE the requirement is.     The commercial truth.
 *   RFQ currency     WHAT quotations must be in.   Inherited, never chosen.
 *   subscription     WHAT the supplier pays US.    A separate relationship.
 *
 * A market's presence in this table is NOT a launch. `enabled` is the only
 * thing that decides whether a market can be selected, and every market but
 * Egypt is deliberately false: "a country appearing in a dropdown is never
 * sufficient to call that market launched" (§86). The GCC rows exist so that
 * the code which will need them is written against real data now rather than
 * against a shape somebody guesses at later.
 *
 * IP IS NEVER BUSINESS TRUTH. Nothing here reads a request's geography.
 * Geolocation may suggest a market to a signed-out visitor and may never
 * silently commit one - see `suggestMarket` at the bottom, which returns a
 * SUGGESTION and says so in its name.
 */

export type MarketCode = 'EG' | 'SA' | 'AE' | 'QA' | 'KW' | 'BH' | 'OM';

/**
 * ── HOW MANY MINOR UNITS A CURRENCY HAS ─────────────────────────────────
 *
 * CURRENCY METADATA, NOT A UI PREFERENCE. The first version of the money
 * layer capped every currency at two fractional digits, which is right for
 * EGP, SAR, AED and QAR and WRONG for three of the six GCC currencies:
 * the Kuwaiti dinar, the Bahraini dinar and the Omani rial are divided into
 * 1,000 fils/baisa, not 100.
 *
 * A KWD figure rounded to two digits is not a display nit. It is a different
 * amount: 1,234.567 KWD shown and stored as 1,234.57 is nearly a fil out on
 * every line, and on a quotation that is a wrong number in a commercial
 * document.
 *
 * Declared here rather than read from `Intl` at the call site because it is
 * also what the DATABASE has to be able to hold, and a schema cannot ask the
 * browser. See GCC_MONEY_SCALE.md for the migration that must precede
 * enabling any three-digit market.
 */
export const CURRENCY_FRACTION_DIGITS: Readonly<Record<string, number>> = {
  EGP: 2,
  SAR: 2,
  AED: 2,
  QAR: 2,
  // ── THREE MINOR DIGITS. 1 dinar = 1,000 fils; 1 rial = 1,000 baisa.
  KWD: 3,
  BHD: 3,
  OMR: 3,
};

/**
 * The scale for a currency, or null when BuildHub does not know it.
 *
 * NULL RATHER THAN A GUESS. Defaulting an unknown code to 2 is how KWD would
 * have been silently rounded in the first place; a caller that does not know
 * the scale must not pretend it does.
 */
export function fractionDigitsFor(currency: string | null | undefined): number | null {
  const code = (currency ?? '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CURRENCY_FRACTION_DIGITS, code)
    ? CURRENCY_FRACTION_DIGITS[code]
    : null;
}

/** The largest scale any currency in the table uses. What the DB must hold. */
export const MAX_CURRENCY_FRACTION_DIGITS =
  Math.max(...Object.values(CURRENCY_FRACTION_DIGITS));

export type Market = {
  code: MarketCode;
  /** ISO 4217. The sourcing currency for projects and RFQs in this market. */
  currency: string;
  nameEn: string;
  nameAr: string;
  /**
   * The IANA zone the market's business day runs on. Stored rather than
   * derived, because a deadline is a moment in a place, not an offset.
   */
  timezone: string;
  /**
   * WHETHER BUILDHUB OPERATES HERE TODAY.
   *
   * The multi-market readiness gate in GCC_SCALE_READINESS.md decides this,
   * not the presence of a row. Flipping one of these to true without that
   * gate would put a market in a dropdown that the compliance, geography and
   * billing layers cannot yet serve.
   */
  enabled: boolean;
};

export const MARKETS: readonly Market[] = [
  { code: 'EG', currency: 'EGP', nameEn: 'Egypt', nameAr: 'مصر', timezone: 'Africa/Cairo', enabled: true },
  // ── NOT LAUNCHED. Defined so the architecture is written against real
  //    values; enabling any of them is an owner decision behind the gate.
  { code: 'SA', currency: 'SAR', nameEn: 'Saudi Arabia', nameAr: 'السعودية', timezone: 'Asia/Riyadh', enabled: false },
  { code: 'AE', currency: 'AED', nameEn: 'United Arab Emirates', nameAr: 'الإمارات', timezone: 'Asia/Dubai', enabled: false },
  { code: 'QA', currency: 'QAR', nameEn: 'Qatar', nameAr: 'قطر', timezone: 'Asia/Qatar', enabled: false },
  { code: 'KW', currency: 'KWD', nameEn: 'Kuwait', nameAr: 'الكويت', timezone: 'Asia/Kuwait', enabled: false },
  { code: 'BH', currency: 'BHD', nameEn: 'Bahrain', nameAr: 'البحرين', timezone: 'Asia/Bahrain', enabled: false },
  { code: 'OM', currency: 'OMR', nameEn: 'Oman', nameAr: 'عُمان', timezone: 'Asia/Muscat', enabled: false },
] as const;

/**
 * THE ONE MARKET BUILDHUB OPERATES IN TODAY.
 *
 * Used as the default for a record that does not state its own market, and as
 * the backfill value for every row written before markets existed - which is
 * exactly what those rows already meant. It is a DEFAULT, not a rule: code
 * that needs a record's market reads the record.
 */
export const DEFAULT_MARKET: MarketCode = 'EG';

export const MARKET_CODES: readonly MarketCode[] = MARKETS.map(market => market.code);

/** The markets a user may actually select. Everything else is architecture. */
export function enabledMarkets(): readonly Market[] {
  return MARKETS.filter(market => market.enabled);
}

export function isMarketCode(value: unknown): value is MarketCode {
  return typeof value === 'string' && MARKET_CODES.includes(value as MarketCode);
}

export function isEnabledMarket(value: unknown): value is MarketCode {
  return isMarketCode(value) && MARKETS.some(market => market.code === value && market.enabled);
}

/**
 * ── ABSENT IS NOT THE SAME AS WRONG ─────────────────────────────────────
 *
 * The first version of this function returned Egypt for ANYTHING it did not
 * recognise, and that conflated two completely different situations:
 *
 *   a row written before markets existed has NO market, and Egypt is what it
 *     meant - BuildHub operated in one market when it was written, and 0058
 *     backfilled exactly that
 *   a row carrying 'ZZ' is CORRUPT, and calling it Egyptian turns a data
 *     fault into an Egyptian RFQ, an Egyptian currency and an Egyptian
 *     compliance decision that nobody ever made
 *
 * The second is the dangerous one precisely because it looks like the first.
 * So absence resolves through the documented launch default and an explicit
 * unknown code resolves to NULL, which every caller must then handle.
 */
export function marketFor(code: string | null | undefined): Market | null {
  // LEGACY ABSENCE. Null, undefined and empty are the shapes a pre-0058 row
  // or an un-set column takes, and the backfill path is documented.
  const trimmed = typeof code === 'string' ? code.trim() : code;
  if (trimmed === null || trimmed === undefined || trimmed === '') {
    return MARKETS.find(market => market.code === DEFAULT_MARKET) ?? null;
  }
  // AN EXPLICIT CODE MUST BE ONE BUILDHUB KNOWS. Unknown returns null rather
  // than the launch default, so the fault surfaces where it is read.
  return MARKETS.find(market => market.code === trimmed) ?? null;
}

/**
 * The sourcing currency for a market, or NULL for an unrecognised code.
 *
 * A caller that receives null has a corrupt record in its hands and must say
 * so. Substituting EGP here would put an Egyptian currency on a foreign or
 * broken row, which is the exact failure this pass exists to prevent.
 */
export function currencyForMarket(code: string | null | undefined): string | null {
  return marketFor(code)?.currency ?? null;
}

/** The market's name, or null when the code is not one BuildHub knows. */
export function marketName(code: string | null | undefined, lang: 'en' | 'ar'): string | null {
  const market = marketFor(code);
  if (!market) return null;
  return lang === 'ar' ? market.nameAr : market.nameEn;
}

/**
 * A corrupt market code, named for what it is.
 *
 * Thrown by server paths that cannot continue without a market - writing a
 * quotation, say, where guessing the currency is worse than refusing.
 */
export class UnknownMarketError extends Error {
  constructor(public readonly code: string) {
    super(`Unrecognised market code "${code}" on a stored record. This is a data-integrity fault, not a missing value.`);
    this.name = 'UnknownMarketError';
  }
}

/**
 * The currency for a market, REFUSING rather than guessing.
 *
 * For the server paths where a wrong currency would be written into a
 * commercial record. Legacy absence still resolves to the launch default,
 * because that is what such a row means; an explicit unknown throws.
 */
export function requireCurrencyForMarket(code: string | null | undefined): string {
  const currency = currencyForMarket(code);
  if (currency === null) throw new UnknownMarketError(String(code));
  return currency;
}

/**
 * A SUGGESTION, AND NOTHING MORE.
 *
 * Named for what it is so that no caller can mistake it for the authoritative
 * market. §32: geolocation may preselect a chooser for a signed-out visitor
 * and must never silently determine legal country, project country, RFQ
 * market, quotation currency, tax treatment, compliance eligibility,
 * serviceability or billing country.
 *
 * Returns null rather than a fallback when the hint names nothing BuildHub
 * operates in: offering a market that is not enabled would be worse than
 * offering none.
 */
export function suggestMarket(hint: string | null | undefined): MarketCode | null {
  const code = (hint ?? '').trim().toUpperCase();
  return isEnabledMarket(code) ? code : null;
}
