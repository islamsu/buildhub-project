// ── BuildHub Billing Catalogue ─────────────────────────────────────────────
// Phase 4B.1. THE single source of truth for every commercial value in the
// product. No price, interval, allowance, or plan capability may be written
// anywhere else in the codebase - server, client, tests, or seed data. If a
// number below needs to change, it changes here and nowhere else.
//
// This file is deliberately provider-agnostic: it contains no Paymob/Stripe
// concept whatsoever. A payment provider (Phase 4B.5) reads these values to
// create its own product/price objects; it never defines them.
//
// Deliberately NOT in the database: these are fixed product definitions, not
// per-vendor state. Splitting them across a `plans` table and code (where the
// behavioural entitlements would have to live regardless) would create exactly
// the duplication this file exists to prevent, plus a drift risk between the
// two. Per-vendor state lives in `vendorSubscriptions`; the one commercial
// value that genuinely needs runtime adjustment without a deploy - the founder
// offer's cut-off date - lives in the existing `adminSettings` key/value store
// (see FOUNDER_OFFER_ENDS_AT_SETTING_KEY below).

export const PLAN_IDS = ['free', 'professional', 'premium'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** Launch currency. EGP-only for the Egypt launch; never hard-code "EGP" in logic - read this. */
export const BILLING_CURRENCY = 'EGP' as const;
export const SUPPORTED_CURRENCIES = ['EGP'] as const;
export type BillingCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/** Approved trial length for paid plans. FREE is permanent and never trials. */
export const TRIAL_DAYS = 30;

/** Approved grace window after a failed renewal before downgrade to FREE. */
export const GRACE_PERIOD_DAYS = 7;

/** Approved founder-offer duration: discounted price applies for this many months. */
export const FOUNDER_OFFER_MONTHS = 6;

/**
 * adminSettings key holding the founder-offer cut-off (an ISO date string).
 * A vendor is founder-eligible only if their first paid subscription starts
 * before this instant. Runtime-configurable by an administrator, so the offer
 * can be closed without a deploy. Absent/unset = offer closed.
 */
export const FOUNDER_OFFER_ENDS_AT_SETTING_KEY = 'founderOfferEndsAt';

export type VisibilityLevel = 'standard' | 'boosted' | 'top';
export type AnalyticsLevel = 'basic' | 'advanced';
export type PortfolioLevel = 'basic' | 'full' | 'expanded';

export type PlanEntitlements = {
  /** Qualified enquiries per calendar month. null = unlimited (subject to anti-abuse controls). */
  qualifiedEnquiriesPerMonth: number | null;
  visibilityLevel: VisibilityLevel;
  analyticsLevel: AnalyticsLevel;
  portfolioLevel: PortfolioLevel;
  /** Service/product categories a vendor may declare. null = no limit. */
  serviceCategoryLimit: number | null;
  promotionalCapability: boolean;
  featuredPlacementEligible: boolean;
  /** null = no limit. See ENTITLEMENT_ENFORCEMENT - the underlying feature does not exist yet. */
  branchLimit: number | null;
  /** null = no limit. See ENTITLEMENT_ENFORCEMENT - the underlying feature does not exist yet. */
  teamMemberLimit: number | null;
};

/** Price in the launch currency, or null where a plan/interval combination is not sold. */
export type PlanPricing = {
  readonly month: number | null;
  readonly year: number | null;
};

export type PlanDefinition = {
  readonly id: PlanId;
  readonly paid: boolean;
  readonly standard: PlanPricing;
  /**
   * Founder-offer pricing, applied for FOUNDER_OFFER_MONTHS to eligible vendors.
   * Annual founder pricing has NOT been approved by the business - `year` is
   * therefore null on every plan, and a founder-priced annual subscription is
   * rejected rather than guessed at. Do not populate `year` here without an
   * explicit approved value.
   */
  readonly founder: PlanPricing;
  readonly entitlements: PlanEntitlements;
};

export const PLANS: Readonly<Record<PlanId, PlanDefinition>> = {
  free: {
    id: 'free',
    paid: false,
    standard: { month: null, year: null },
    founder: { month: null, year: null },
    entitlements: {
      qualifiedEnquiriesPerMonth: 5,
      visibilityLevel: 'standard',
      analyticsLevel: 'basic',
      portfolioLevel: 'basic',
      serviceCategoryLimit: 3,
      promotionalCapability: false,
      featuredPlacementEligible: false,
      branchLimit: 1,
      teamMemberLimit: 1,
    },
  },
  professional: {
    id: 'professional',
    paid: true,
    standard: { month: 499, year: 4990 },
    founder: { month: 299, year: null },
    entitlements: {
      qualifiedEnquiriesPerMonth: 30,
      visibilityLevel: 'boosted',
      analyticsLevel: 'advanced',
      portfolioLevel: 'full',
      serviceCategoryLimit: null,
      promotionalCapability: true,
      featuredPlacementEligible: false,
      branchLimit: 1,
      teamMemberLimit: 1,
    },
  },
  premium: {
    id: 'premium',
    paid: true,
    standard: { month: 999, year: 9990 },
    founder: { month: 699, year: null },
    entitlements: {
      qualifiedEnquiriesPerMonth: null,
      visibilityLevel: 'top',
      analyticsLevel: 'advanced',
      portfolioLevel: 'expanded',
      serviceCategoryLimit: null,
      promotionalCapability: true,
      featuredPlacementEligible: true,
      branchLimit: null,
      teamMemberLimit: null,
    },
  },
} as const;

/**
 * HONESTY LEDGER. An entitlement being *defined* above does not mean the
 * capability is *enforced* anywhere yet - Phase 4B.1 builds the billing domain
 * only. This record states, per entitlement, which phase actually implements
 * enforcement, so no report, UI, or plan-comparison page can claim a
 * capability works when nothing enforces it. `'not-implemented'` means the
 * underlying product feature does not exist in BuildHub at all yet.
 *
 * Keep this in lockstep with PlanEntitlements - a test asserts every
 * entitlement key appears here.
 */
export const ENTITLEMENT_ENFORCEMENT: Readonly<Record<keyof PlanEntitlements, string>> = {
  // Enforced as of Phase 4B.3: server/billing/enquiries.ts caps monthly
  // qualified-enquiry consumption, transactionally.
  qualifiedEnquiriesPerMonth: 'phase-4b.3',
  // NOT enforced. The real vendor directory built in Phase 4B.3 ranks
  // organically only - a paid plan must never buy a higher position there
  // (Phase 4B.3 brief §13). Paid visibility is a separate, clearly-labelled
  // concept that belongs with featured placement in Phase 4B.6.
  visibilityLevel: 'phase-4b.6',
  analyticsLevel: 'phase-4b.2',
  portfolioLevel: 'not-implemented',
  // Enforced as of Phase 4B.3: profile.setMyCategories caps how many service
  // categories a vendor may declare.
  serviceCategoryLimit: 'phase-4b.3',
  promotionalCapability: 'not-implemented',
  featuredPlacementEligible: 'phase-4b.6',
  branchLimit: 'not-implemented',
  teamMemberLimit: 'not-implemented',
} as const;

export const DEFAULT_PLAN_ID: PlanId = 'free';

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === 'string' && (BILLING_INTERVALS as readonly string[]).includes(value);
}

export function isSupportedCurrency(value: unknown): value is BillingCurrency {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export function getEntitlements(planId: PlanId): PlanEntitlements {
  return PLANS[planId].entitlements;
}

/**
 * The price a vendor pays, in BILLING_CURRENCY, for a plan/interval - founder
 * or standard. Returns null when that combination is not sold (FREE at any
 * interval; any founder annual price, which is not an approved product).
 * This is the ONLY function anywhere that may resolve a price.
 */
export function resolvePrice(
  planId: PlanId,
  interval: BillingInterval,
  founder: boolean,
): number | null {
  const plan = PLANS[planId];
  if (!plan.paid) return null;
  return (founder ? plan.founder : plan.standard)[interval];
}

/** True when a founder-priced subscription may be sold for this plan/interval. */
export function isFounderPriceAvailable(planId: PlanId, interval: BillingInterval): boolean {
  return resolvePrice(planId, interval, true) !== null;
}

/** Annual saving versus paying monthly for a year, for the "discounted annual option" display. */
export function annualSavings(planId: PlanId): number | null {
  const { month, year } = PLANS[planId].standard;
  if (month === null || year === null) return null;
  return month * 12 - year;
}
