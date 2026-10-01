/**
 * ── A PROVIDER'S MARKET IDENTITY ────────────────────────────────────────
 *
 * Four separate facts, which BuildHub previously collapsed into two:
 *
 *   legal / home country       where the business is registered
 *   primary operating market   where it mainly works
 *   additional served markets  where else it is willing to work
 *   per-market approval        whether BuildHub approved it THERE
 *
 * The collapse mattered. Geography was one free-text `vendorProfiles.country`
 * used for display, and approval was one global `users.onboardingStatus`
 * granted against the only configured compliance requirement set - Egypt's. So
 * an approved provider was approvable everywhere the moment a second market
 * opened, and a provider operating from Oman carried an Egyptian approval
 * nobody had assessed them for.
 *
 * The owner's rule, in both directions: approval in Egypt does NOT imply
 * approval in Saudi Arabia, UAE, Qatar, Kuwait, Bahrain or Oman, and approval
 * in a GCC market does not imply approval in Egypt.
 *
 * ── WHAT THIS MODULE IS NOT ─────────────────────────────────────────────
 *
 * It is not the eligibility predicate. Eligibility is market enabled AND
 * provider approved there AND the service offered there AND the existing
 * visibility/category/project rules - and it converges in ONE place in Phase 3
 * rather than being assembled differently by each caller. This module owns only
 * the approval half, so that when Phase 3 composes the predicate it is reading
 * a decision rather than re-deriving one.
 */

import { isMarketCode, type MarketCode } from './markets';

/**
 * THE SAME FIVE STATES AS `users.onboardingStatus`, deliberately.
 *
 * A per-market approval is the same kind of decision as the global one, made
 * by the same reviewers through the same queue. A second vocabulary would only
 * create a mapping between them that nobody maintains, and mappings between
 * two status enums are where "rejected" quietly becomes "pending".
 */
export const PROVIDER_MARKET_STATUSES = [
  'not_started', 'under_review', 'update_required', 'approved', 'rejected',
] as const;

export type ProviderMarketStatus = (typeof PROVIDER_MARKET_STATUSES)[number];

/** The only status that permits commercial participation in a market. */
export const APPROVED: ProviderMarketStatus = 'approved';

export function isProviderMarketStatus(value: unknown): value is ProviderMarketStatus {
  return typeof value === 'string'
    && (PROVIDER_MARKET_STATUSES as readonly string[]).includes(value);
}

/** One row of `providerMarkets`, reduced to what a decision needs. */
export type ProviderMarketRow = {
  marketCode: string;
  status: ProviderMarketStatus;
};

/**
 * Whether this provider is approved to operate in this market.
 *
 * ── WHY THIS TAKES NO GLOBAL STATUS ─────────────────────────────────────
 *
 * It would be easy, and wrong, to accept `users.onboardingStatus` here and let
 * it stand in when no row exists. That is the behaviour being removed: it is
 * precisely how an Egyptian approval would come to authorise Omani work. A
 * market with no row is NOT approved, and the absence is the answer rather
 * than a gap to be filled from elsewhere.
 */
export function isApprovedInMarket(
  rows: readonly ProviderMarketRow[],
  marketCode: string | null | undefined,
): boolean {
  if (!isMarketCode(marketCode)) return false;
  return rows.some(row => row.marketCode === marketCode && row.status === APPROVED);
}

/** Every market this provider is approved in. Order follows the rows given. */
export function approvedMarkets(rows: readonly ProviderMarketRow[]): MarketCode[] {
  return rows
    .filter(row => row.status === APPROVED && isMarketCode(row.marketCode))
    .map(row => row.marketCode as MarketCode);
}

/**
 * ── THE INVARIANT THE SCHEMA CANNOT HOLD ────────────────────────────────
 *
 * `vendorProfiles.primaryMarketCode` is a single column, so a provider cannot
 * have two primary markets - that much is structural. What the schema cannot
 * express is that the primary market must also be one they operate in, because
 * MySQL has no constraint spanning a column and a child table's rows.
 *
 * So it is checked here and asserted in tests, which is a weaker guarantee -
 * and it is applied to a weaker claim. A primary market with no row is an
 * inconsistent profile, not a security boundary: the approval decision is
 * still read from the rows, so an unserved primary grants nothing. It would
 * show up as a provider whose profile names a main market they are not
 * recorded as operating in, which is a data fault worth refusing at the write
 * rather than a hole to defend at every read.
 */
export function primaryMarketIsServed(
  primaryMarketCode: string | null | undefined,
  rows: readonly ProviderMarketRow[],
): boolean {
  // NOT SET IS CONSISTENT. A provider who has not named a primary market has
  // not contradicted anything; the column is nullable on purpose and is never
  // backfilled from an approval, because an approval for a market is not
  // evidence that it is their main one.
  if (primaryMarketCode === null || primaryMarketCode === undefined || primaryMarketCode === '') {
    return true;
  }
  return rows.some(row => row.marketCode === primaryMarketCode);
}

/**
 * Whether a legal country code is well formed.
 *
 * ISO 3166-1 alpha-2, and deliberately NOT validated against `MarketCode`: a
 * business may be registered in a country BuildHub does not operate in and
 * still serve a market it does. Validating against the market registry here
 * would reject a legitimate Jordanian contractor serving Saudi Arabia.
 *
 * Shape only. BuildHub does not hold an authoritative country list, and
 * inventing one is the kind of fabrication this codebase refuses elsewhere -
 * country NAMES for display come from the platform's own CLDR data at render
 * time, not from a hand-written table.
 */
export function isLegalCountryCode(value: unknown): boolean {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value);
}
