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

export function marketFor(code: string | null | undefined): Market {
  const found = MARKETS.find(market => market.code === code);
  // AN UNKNOWN MARKET IS NOT A CRASH AND NOT A GUESS. A row written before
  // markets existed, or one carrying a code a later deployment removed, is
  // read as Egypt - which is what it meant when it was written. Nothing
  // fabricates a market that was never chosen.
  return found ?? MARKETS[0];
}

/** The sourcing currency a project or RFQ in this market defaults to. */
export function currencyForMarket(code: string | null | undefined): string {
  return marketFor(code).currency;
}

export function marketName(code: string | null | undefined, lang: 'en' | 'ar'): string {
  const market = marketFor(code);
  return lang === 'ar' ? market.nameAr : market.nameEn;
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
