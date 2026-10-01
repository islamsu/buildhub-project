/**
 * ── MARKET-SPECIFIC SERVICE OFFERS ──────────────────────────────────────
 *
 * A service is what a provider does. An OFFER is what they charge for it in
 * one market. Those were the same row until Phase 2, which is why the same
 * provider offering the same work in three markets was not representable.
 *
 * This module owns three things the database cannot:
 *
 *   1. the currency of an offer, DERIVED from its market rather than stored
 *   2. the legacy classification rule, so it is one rule rather than one per
 *      caller
 *   3. the authorization shape a provider must satisfy to manage an offer
 *
 * It owns no arithmetic. Money is `shared/money.ts` and
 * `shared/quotationPricing.ts`.
 */

import { currencyForMarket, isMarketCode, isEnabledMarket, type MarketCode } from './markets';
import { isApprovedInMarket, type ProviderMarketRow } from './providerMarkets';

/** How a legacy `serviceOfferings` row's Egypt meaning was classified. */
export const MARKET_MIGRATION_STATES = ['proven_eg', 'remediation_required'] as const;
export type MarketMigrationState = (typeof MARKET_MIGRATION_STATES)[number];

export const OFFER_STATUSES = ['draft', 'active', 'inactive', 'archived'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/**
 * The currency an offer in this market is denominated in.
 *
 * ── WHY THIS IS A FUNCTION AND NOT A COLUMN ─────────────────────────────
 *
 * A stored currency beside a stored market can disagree with it, and
 * `marketCode = 'OM', currency = 'EGP'` is exactly the row this whole
 * workstream exists to prevent. Validating at the write closes that for the
 * paths that use the validator and leaves it open to every migration, admin
 * script and future router that does not. Derived, the inconsistent state is
 * not representable.
 *
 * ── AND WHY IT DOES NOT DELEGATE STRAIGHT TO `currencyForMarket` ────────
 *
 * That function resolves LEGACY ABSENCE - null, undefined, empty - through the
 * Egypt launch default, which is correct for it: a row written before markets
 * existed has no market code, and Egypt is what it meant.
 *
 * None of that applies here. `serviceOfferingMarkets.marketCode` is NOT NULL
 * and the table was born after markets existed, so absence is not a legacy
 * state - it is a bug in the caller. Delegating directly returned 'EGP' for a
 * null market, which is the silent Egypt substitution this whole workstream
 * exists to remove, arriving through a function whose own documentation says it
 * refuses to do that.
 *
 * So absence and an unrecognised code both return null, and a caller holding
 * null has a fault to report rather than a currency to print.
 */
export function offerCurrency(marketCode: string | null | undefined): string | null {
  if (marketCode === null || marketCode === undefined || marketCode.trim() === '') return null;
  return currencyForMarket(marketCode);
}

/**
 * ── THE EVIDENCE A LEGACY ROW'S EGYPT MEANING NEEDS ─────────────────────
 *
 * The inputs are facts about the row and its provider, named so that the rule
 * reads as the argument it is.
 */
export type LegacyOfferEvidence = {
  /** `serviceOfferings.currency` as stored. */
  currency: string | null | undefined;
  /**
   * Whether the provider holds an APPROVED legacy registration document of an
   * Egyptian instrument - tax card, commercial registration, tax registration.
   * Legacy means `marketCode IS NULL`: the column did not exist, and Egypt is
   * the only requirement set ever configured, so an approved one was approved
   * against Egyptian requirements.
   */
  hasApprovedEgyptianRegistrationDocument: boolean;
  /** The provider's `providerMarkets` rows. */
  providerMarkets: readonly ProviderMarketRow[];
  /** `vendorProfiles.country` as stored - free text, display-only. */
  freeTextCountry: string | null | undefined;
};

/**
 * The free-text spellings that do NOT contradict Egypt.
 *
 * Used only to DISQUALIFY. A value outside this set removes a row from the
 * proven set; nothing in this list ever establishes a market on its own.
 */
const EGYPT_SPELLINGS = new Set([
  'egypt', 'eg', 'egy', 'مصر', 'arab republic of egypt', 'egypt arab republic',
]);

/**
 * Whether the free-text country contradicts Egypt.
 *
 * Empty does not contradict: a provider who never filled the field has said
 * nothing, and silence is not a different country.
 */
export function freeTextCountryContradictsEgypt(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const trimmed = value.trim();
  if (trimmed === '') return false;
  return !EGYPT_SPELLINGS.has(trimmed.toLowerCase());
}

/**
 * ── THE CLASSIFIER ──────────────────────────────────────────────────────
 *
 * `currency === 'EGP'` IS NECESSARY AND NEVER SUFFICIENT. That is the whole
 * rule, and the reason is a real external user: 0061 defaulted the column to
 * EGP reasoning that "every service offering in the database was created by a
 * provider in the one market BuildHub operates, priced in Egyptian pounds",
 * and a vendor operating in Oman had an EGP listing because the platform had
 * nothing else to write. The column records what nobody contradicted, not what
 * anybody chose, so migrating every EGP row into an authoritative Egypt offer
 * would relabel that vendor's commercial intent.
 *
 * What can prove an Egypt offer is evidence that the BUSINESS is Egyptian. For
 * an Egyptian business operating in BuildHub's only marketplace, EGP was not a
 * defaulted guess - it was the only thing the offer could have meant, and the
 * default coincided with the fact. The evidence is an Egyptian registration
 * instrument that a human reviewer approved.
 *
 * Every condition can only ever REMOVE a row from the proven set. That is the
 * property that makes the classifier safe to be wrong about: a false negative
 * sends a provider a prompt to confirm their own price, and a false positive
 * publishes a number in a currency they never chose.
 */
export function classifyLegacyOffer(evidence: LegacyOfferEvidence): MarketMigrationState {
  const proven =
    evidence.currency === 'EGP'
    && evidence.hasApprovedEgyptianRegistrationDocument
    && isApprovedInMarket(evidence.providerMarkets, 'EG')
    && !freeTextCountryContradictsEgypt(evidence.freeTextCountry);
  return proven ? 'proven_eg' : 'remediation_required';
}

/** The Egyptian registration instruments whose approval is the evidence above. */
export const EGYPTIAN_REGISTRATION_INSTRUMENTS = [
  'tax_card', 'commercial_registration', 'tax_registration',
] as const;

/**
 * ── WHETHER A PROVIDER MAY MANAGE AN OFFER IN A MARKET ──────────────────
 *
 * Four conditions, and the reason each is here rather than assumed:
 *
 *   owns the service      otherwise one provider edits another's price
 *   market is a real code otherwise a typo creates an offer in nowhere
 *   market is ENABLED     a providerMarkets row is not an enabled market, and
 *                         a disabled market must not become commercially live
 *                         because a row exists
 *   approved THERE        approval in Egypt is not approval in Oman, and
 *                         pre-launch interest is not approval at all
 *
 * Legal country is deliberately absent: where a business is registered says
 * nothing about which markets BuildHub has approved it for, and reading one as
 * the other is how an Omani company would come to publish Omani prices nobody
 * assessed them for.
 */
export type OfferManagementRequest = {
  /** The authenticated caller. */
  callerId: number;
  /** `serviceOfferings.providerId` of the service being edited. */
  serviceOwnerId: number;
  marketCode: string | null | undefined;
  providerMarkets: readonly ProviderMarketRow[];
};

export type OfferManagementDecision =
  | { allowed: true; marketCode: MarketCode; currency: string }
  | { allowed: false; reason: 'not_owner' | 'unknown_market' | 'market_disabled' | 'not_approved_in_market' };

export function mayManageOffer(request: OfferManagementRequest): OfferManagementDecision {
  // OWNERSHIP FIRST, so a caller probing other providers' services learns
  // nothing about which markets they are approved in.
  if (request.callerId !== request.serviceOwnerId) {
    return { allowed: false, reason: 'not_owner' };
  }
  if (!isMarketCode(request.marketCode)) {
    return { allowed: false, reason: 'unknown_market' };
  }
  if (!isEnabledMarket(request.marketCode)) {
    return { allowed: false, reason: 'market_disabled' };
  }
  if (!isApprovedInMarket(request.providerMarkets, request.marketCode)) {
    return { allowed: false, reason: 'not_approved_in_market' };
  }
  const currency = currencyForMarket(request.marketCode);
  // Unreachable while the market is both known and enabled, and asserted
  // rather than assumed because the alternative is writing a price with no
  // denomination.
  if (currency === null) return { allowed: false, reason: 'unknown_market' };
  return { allowed: true, marketCode: request.marketCode, currency };
}
