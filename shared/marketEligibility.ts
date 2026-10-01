/**
 * ── THE ONE PLACE A MARKET ELIGIBILITY QUESTION IS ANSWERED ─────────────
 *
 * Owner directive Phase 3. Discovery, matching and quotation eligibility
 * converge here rather than each assembling the conditions themselves - because
 * four conditions assembled in five places is how one of them goes missing in
 * one of them, and the one that goes missing is the one nobody tests.
 *
 *   market ENABLED                 the registry decides, not a row's existence
 *   provider APPROVED there        Egypt approval is not Oman approval
 *   an authoritative OFFER there   approved to work somewhere is not the same
 *                                  as offering this service there
 *   existing rules pass            category, visibility, project, business
 *
 * ── A DATABASE ROW IS NOT AN ENABLED MARKET ─────────────────────────────
 *
 * The most important thing this module refuses. During Phases 1-3 the schema
 * gained `providerMarkets` rows and `serviceOfferingMarkets` offers for markets
 * that are `enabled: false`, because the architecture has to be testable before
 * activation. None of that may make a disabled market discoverable, matchable
 * or quotable. So `enabled` is checked FIRST and independently: no combination
 * of rows can substitute for it, and activation remains a registry decision
 * the owner makes, not an emergent property of data.
 *
 * ── WHAT IS DELIBERATELY NOT AN INPUT ───────────────────────────────────
 *
 * Legal country, free-text country, IP, browser locale, the active-market
 * browsing preference, the provider's subscription billing currency. None of
 * them appears in the type below, so no caller can pass one in place of an
 * approval. That is stronger than documenting that they must not.
 *
 * Pre-launch market INTEREST is likewise absent: interest is informational, and
 * a provider who expressed interest in Oman has exactly the eligibility of one
 * who did not.
 */

import { isEnabledMarket, MARKET_CODES, type MarketCode } from './markets';
import { isApprovedInMarket, type ProviderMarketRow } from './providerMarkets';

/** Every code the registry defines, enabled or not. Derived, never a second list. */
const KNOWN_CODES = new Set<string>(MARKET_CODES);

/** An authoritative per-market offer, reduced to what eligibility needs. */
export type MarketOfferRow = {
  marketCode: string;
  /** `serviceOfferingMarkets.status`. Only `active` is commercially live. */
  status: string;
};

export type MarketEligibilityRequest = {
  /** The market the work is in - a project's or a standalone RFQ's. */
  marketCode: string | null | undefined;
  /** The provider's `providerMarkets` rows. */
  providerMarkets: readonly ProviderMarketRow[];
  /**
   * The provider's offers for the SERVICE in question. Pass an empty array to
   * ask the market/approval question alone (`requireOffer: false`), which is
   * what a provider-level directory listing needs.
   */
  offers: readonly MarketOfferRow[];
  /**
   * Whether an active offer in this market is required.
   *
   * False for a provider-level question ("may this business appear in this
   * market's directory"), true for a service-level one ("may this service be
   * discovered or quoted here"). Explicit rather than inferred from an empty
   * offer list, because "no offers" and "offers not relevant" are different
   * questions and inferring one from the other is how a provider with no
   * priced service becomes discoverable for it.
   */
  requireOffer: boolean;
  /**
   * The verdict of the EXISTING rules - category scope, directory visibility,
   * project membership, account status. Composed rather than reimplemented:
   * those predicates are canonical and live where they already are, and this
   * module adds the market dimension without taking ownership of them.
   */
  existingRulesPass: boolean;
};

export type MarketEligibilityDecision =
  | { eligible: true; marketCode: MarketCode }
  | {
      eligible: false;
      reason: 'unknown_market' | 'market_disabled' | 'provider_not_approved'
        | 'no_active_offer' | 'existing_rules';
    };

export function marketEligibility(
  request: MarketEligibilityRequest,
): MarketEligibilityDecision {
  if (request.marketCode === null || request.marketCode === undefined || request.marketCode === '') {
    return { eligible: false, reason: 'unknown_market' };
  }
  /*
   * ENABLED FIRST. Before approval, before offers, before anything a row could
   * say. A disabled market is not a market a question can be asked about.
   */
  if (!isEnabledMarket(request.marketCode)) {
    // `isEnabledMarket` is false both for a code BuildHub does not know and for
    // one it knows but does not operate in. They are reported separately
    // because the first is a fault and the second is a decision.
    return {
      eligible: false,
      reason: isKnownButDisabled(request.marketCode) ? 'market_disabled' : 'unknown_market',
    };
  }
  if (!isApprovedInMarket(request.providerMarkets, request.marketCode)) {
    return { eligible: false, reason: 'provider_not_approved' };
  }
  if (request.requireOffer
    && !request.offers.some(offer =>
      offer.marketCode === request.marketCode && offer.status === 'active')) {
    return { eligible: false, reason: 'no_active_offer' };
  }
  if (!request.existingRulesPass) {
    return { eligible: false, reason: 'existing_rules' };
  }
  return { eligible: true, marketCode: request.marketCode as MarketCode };
}

/**
 * Whether BuildHub knows this code but does not operate in it.
 *
 * Kept local and derived from the registry rather than a second list, so a
 * market added to `MARKETS` is covered without touching this file.
 */
function isKnownButDisabled(code: string): boolean {
  return !isEnabledMarket(code) && KNOWN_CODES.has(code);
}
