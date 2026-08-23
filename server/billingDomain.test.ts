import { describe, expect, it } from 'vitest';
import {
  BILLING_CURRENCY,
  BILLING_INTERVALS,
  ENTITLEMENT_ENFORCEMENT,
  FOUNDER_OFFER_MONTHS,
  GRACE_PERIOD_DAYS,
  PLANS,
  PLAN_IDS,
  SUPPORTED_CURRENCIES,
  TRIAL_DAYS,
  annualSavings,
  getEntitlements,
  isBillingInterval,
  isFounderPriceAvailable,
  isPlanId,
  isSupportedCurrency,
  resolvePrice,
  type PlanEntitlements,
} from '@shared/billing';
import {
  BillingDomainError,
  activate,
  addDays,
  cancelAtPeriodEnd,
  deriveBillingState,
  downgradeToFree,
  expireFounderPrice,
  isFounderEligible,
  markPaymentFailed,
  periodEndFor,
  recoverPayment,
  startTrial,
} from './billing/domain';
import type { VendorSubscription } from '../drizzle/schema';

const NOW = new Date('2026-08-19T12:00:00.000Z');

function sub(overrides: Partial<VendorSubscription> = {}): VendorSubscription {
  return {
    id: 1,
    userId: 10,
    plan: 'free',
    status: 'free',
    billingInterval: null,
    currency: 'EGP',
    priceAmount: null,
    isFounderPrice: false,
    founderPriceUsedAt: null,
    founderPriceEndsAt: null,
    trialEndsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    gracePeriodEndsAt: null,
    provider: null,
    providerCustomerRef: null,
    providerSubscriptionRef: null,
    providerPriceRef: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as VendorSubscription;
}

// ── Catalogue: the approved commercial values ──────────────────────────────

describe('billing catalogue - approved plans and pricing (Phase 4B.1)', () => {
  it('defines exactly the three approved plans', () => {
    expect(PLAN_IDS).toEqual(['free', 'professional', 'premium']);
  });

  it('FREE is permanent and never priced', () => {
    expect(PLANS.free.paid).toBe(false);
    expect(resolvePrice('free', 'month', false)).toBeNull();
    expect(resolvePrice('free', 'year', false)).toBeNull();
    expect(resolvePrice('free', 'month', true)).toBeNull();
  });

  it('PROFESSIONAL standard pricing is exactly EGP 499/month and 4,990/year', () => {
    expect(resolvePrice('professional', 'month', false)).toBe(499);
    expect(resolvePrice('professional', 'year', false)).toBe(4990);
  });

  it('PREMIUM standard pricing is exactly EGP 999/month and 9,990/year', () => {
    expect(resolvePrice('premium', 'month', false)).toBe(999);
    expect(resolvePrice('premium', 'year', false)).toBe(9990);
  });

  it('founder pricing is exactly EGP 299/month (Professional) and 699/month (Premium)', () => {
    expect(resolvePrice('professional', 'month', true)).toBe(299);
    expect(resolvePrice('premium', 'month', true)).toBe(699);
  });

  it('no annual founder price exists - it was never approved, so it must not be invented', () => {
    expect(resolvePrice('professional', 'year', true)).toBeNull();
    expect(resolvePrice('premium', 'year', true)).toBeNull();
    expect(isFounderPriceAvailable('professional', 'year')).toBe(false);
    expect(isFounderPriceAvailable('premium', 'year')).toBe(false);
    expect(isFounderPriceAvailable('professional', 'month')).toBe(true);
  });

  it('founder pricing never alters standard pricing', () => {
    expect(PLANS.professional.standard.month).toBe(499);
    expect(PLANS.premium.standard.month).toBe(999);
  });

  it('the annual option is genuinely discounted versus twelve monthly payments', () => {
    expect(annualSavings('professional')).toBe(499 * 12 - 4990);
    expect(annualSavings('premium')).toBe(999 * 12 - 9990);
    expect(annualSavings('professional')!).toBeGreaterThan(0);
    expect(annualSavings('premium')!).toBeGreaterThan(0);
    expect(annualSavings('free')).toBeNull();
  });

  it('approved trial, grace and founder durations are 30 days, 7 days and 6 months', () => {
    expect(TRIAL_DAYS).toBe(30);
    expect(GRACE_PERIOD_DAYS).toBe(7);
    expect(FOUNDER_OFFER_MONTHS).toBe(6);
  });

  it('launch currency is EGP only - no other currency is exposed', () => {
    expect(BILLING_CURRENCY).toBe('EGP');
    expect(SUPPORTED_CURRENCIES).toEqual(['EGP']);
    expect(isSupportedCurrency('EGP')).toBe(true);
    for (const other of ['USD', 'SAR', 'AED', 'EUR', 'egp', '']) {
      expect(isSupportedCurrency(other)).toBe(false);
    }
  });

  it('rejects invalid plan ids and billing intervals', () => {
    for (const valid of PLAN_IDS) expect(isPlanId(valid)).toBe(true);
    for (const invalid of ['enterprise', 'PRO', 'pro', '', null, undefined, 1, {}]) {
      expect(isPlanId(invalid)).toBe(false);
    }
    for (const valid of BILLING_INTERVALS) expect(isBillingInterval(valid)).toBe(true);
    for (const invalid of ['week', 'daily', 'MONTH', '', null, undefined, 12]) {
      expect(isBillingInterval(invalid)).toBe(false);
    }
  });
});

// ── Entitlements ───────────────────────────────────────────────────────────

describe('entitlement definitions (Phase 4B.1)', () => {
  it('qualified-enquiry allowances are exactly 5 / 30 / unlimited', () => {
    expect(getEntitlements('free').qualifiedEnquiriesPerMonth).toBe(5);
    expect(getEntitlements('professional').qualifiedEnquiriesPerMonth).toBe(30);
    expect(getEntitlements('premium').qualifiedEnquiriesPerMonth).toBeNull();
  });

  it('visibility rises across the three tiers and never blends into verification or reputation', () => {
    expect(getEntitlements('free').visibilityLevel).toBe('standard');
    expect(getEntitlements('professional').visibilityLevel).toBe('boosted');
    expect(getEntitlements('premium').visibilityLevel).toBe('top');
    // A paid plan must never carry a verification/reputation entitlement -
    // paying can never buy trust (Phase 4B business requirement §10/§5).
    for (const id of PLAN_IDS) {
      const keys = Object.keys(getEntitlements(id));
      expect(keys).not.toContain('verified');
      expect(keys).not.toContain('rating');
      expect(keys).not.toContain('reviewCount');
      expect(keys).not.toContain('trustScore');
    }
  });

  it('only PREMIUM is eligible for featured placement', () => {
    expect(getEntitlements('free').featuredPlacementEligible).toBe(false);
    expect(getEntitlements('professional').featuredPlacementEligible).toBe(false);
    expect(getEntitlements('premium').featuredPlacementEligible).toBe(true);
  });

  it('every entitlement declares an honest enforcement status, so nothing claims to work when it does not', () => {
    const entitlementKeys = Object.keys(getEntitlements('free')) as (keyof PlanEntitlements)[];
    for (const key of entitlementKeys) {
      expect(ENTITLEMENT_ENFORCEMENT[key], `entitlement "${key}" must declare where it is enforced`).toBeTruthy();
    }
    expect(Object.keys(ENTITLEMENT_ENFORCEMENT).sort()).toEqual(entitlementKeys.sort());
  });

  it('capabilities with no implementation anywhere are marked not-implemented, not silently promised', () => {
    // Portfolio, promotional campaigns, multi-branch and multi-team do not
    // exist in BuildHub at all yet (verified in Phase 4B readiness review).
    expect(ENTITLEMENT_ENFORCEMENT.portfolioLevel).toBe('not-implemented');
    expect(ENTITLEMENT_ENFORCEMENT.promotionalCapability).toBe('not-implemented');
    expect(ENTITLEMENT_ENFORCEMENT.branchLimit).toBe('not-implemented');
    expect(ENTITLEMENT_ENFORCEMENT.teamMemberLimit).toBe('not-implemented');
  });
});

// ── Trial lifecycle ────────────────────────────────────────────────────────

describe('trial lifecycle (Phase 4B.1)', () => {
  it('starts a 30-day trial at the standard price', () => {
    const patch = startTrial({ planId: 'professional', interval: 'month', founder: false, now: NOW });
    expect(patch.status).toBe('trialing');
    expect(patch.plan).toBe('professional');
    expect(patch.priceAmount).toBe('499.00');
    expect(patch.currency).toBe('EGP');
    expect(patch.isFounderPrice).toBe(false);
    expect(patch.trialEndsAt).toEqual(addDays(NOW, 30));
  });

  it('a trial in progress grants the paid plan entitlements', () => {
    const state = deriveBillingState(
      sub({ plan: 'premium', status: 'trialing', trialEndsAt: addDays(NOW, 5) }),
      NOW,
    );
    expect(state.effectivePlan).toBe('premium');
    expect(state.inTrial).toBe(true);
    expect(state.isPaid).toBe(true);
    expect(state.entitlements.qualifiedEnquiriesPerMonth).toBeNull();
  });

  it('a LAPSED trial grants nothing, even before any scheduled job has recorded it', () => {
    // Critical: entitlements are derived from time, not from stored status, so
    // a late or failed sweep can never over-grant paid access.
    const state = deriveBillingState(
      sub({ plan: 'premium', status: 'trialing', trialEndsAt: addDays(NOW, -1) }),
      NOW,
    );
    expect(state.effectivePlan).toBe('free');
    expect(state.isPaid).toBe(false);
    expect(state.inTrial).toBe(false);
    expect(state.entitlements.qualifiedEnquiriesPerMonth).toBe(5);
  });

  it('a trial that ends exactly now is already lapsed (boundary is inclusive)', () => {
    const state = deriveBillingState(sub({ plan: 'premium', status: 'trialing', trialEndsAt: NOW }), NOW);
    expect(state.effectivePlan).toBe('free');
  });
});

// ── Founder offer ──────────────────────────────────────────────────────────

describe('founder offer (Phase 4B.1)', () => {
  const openOffer = new Date('2026-12-31T00:00:00.000Z');

  it('starts a founder-priced subscription at EGP 299 and stamps a 6-month window', () => {
    const patch = startTrial({ planId: 'professional', interval: 'month', founder: true, now: NOW });
    expect(patch.priceAmount).toBe('299.00');
    expect(patch.isFounderPrice).toBe(true);
    expect(patch.founderPriceUsedAt).toEqual(NOW);
    expect(patch.founderPriceEndsAt!.getUTCMonth()).toBe(new Date('2027-02-19T12:00:00.000Z').getUTCMonth());
  });

  it('refuses to sell a founder price that was never approved (annual), instead of silently falling back', () => {
    expect(() => startTrial({ planId: 'professional', interval: 'year', founder: true, now: NOW }))
      .toThrow(BillingDomainError);
    expect(() => startTrial({ planId: 'premium', interval: 'year', founder: true, now: NOW }))
      .toThrow(/No approved founder price/);
  });

  it('a vendor is eligible only while the offer window is open', () => {
    expect(isFounderEligible(null, openOffer, NOW)).toBe(true);
    expect(isFounderEligible(null, new Date('2026-08-01T00:00:00.000Z'), NOW)).toBe(false);
    expect(isFounderEligible(null, null, NOW)).toBe(false);
  });

  it('ONE-TIME USE: a vendor who already used the offer can never be granted it again', () => {
    const used = sub({ founderPriceUsedAt: new Date('2026-07-01T00:00:00.000Z') });
    expect(isFounderEligible(used, openOffer, NOW)).toBe(false);
  });

  it('a cancel-and-resubscribe cycle cannot re-award founder pricing', () => {
    // downgradeToFree deliberately does NOT clear founderPriceUsedAt.
    const patch = downgradeToFree('canceled');
    expect(patch).not.toHaveProperty('founderPriceUsedAt');
    const afterCancel = sub({ ...patch, founderPriceUsedAt: new Date('2026-07-01T00:00:00.000Z') } as Partial<VendorSubscription>);
    expect(isFounderEligible(afterCancel, openOffer, NOW)).toBe(false);
  });

  it('founder pricing is active during the window and inactive after it', () => {
    const active = deriveBillingState(
      sub({ plan: 'professional', status: 'active', isFounderPrice: true, founderPriceEndsAt: addDays(NOW, 30), currentPeriodEnd: addDays(NOW, 10) }),
      NOW,
    );
    expect(active.founderPriceActive).toBe(true);

    const expired = deriveBillingState(
      sub({ plan: 'professional', status: 'active', isFounderPrice: true, founderPriceEndsAt: addDays(NOW, -1), currentPeriodEnd: addDays(NOW, 10) }),
      NOW,
    );
    expect(expired.founderPriceActive).toBe(false);
    // Access is unaffected - only the price changes.
    expect(expired.effectivePlan).toBe('professional');
    expect(expired.isPaid).toBe(true);
  });

  it('expiring the founder price moves the SAME subscription to standard pricing', () => {
    const patch = expireFounderPrice(sub({ plan: 'professional', billingInterval: 'month', isFounderPrice: true }));
    expect(patch.isFounderPrice).toBe(false);
    expect(patch.priceAmount).toBe('499.00');
    expect(patch.founderPriceEndsAt).toBeNull();
    // Not a new subscription and not a second pricing model: plan and status untouched.
    expect(patch).not.toHaveProperty('plan');
    expect(patch).not.toHaveProperty('status');
  });

  it('premium founder pricing expires to EGP 999', () => {
    const patch = expireFounderPrice(sub({ plan: 'premium', billingInterval: 'month', isFounderPrice: true }));
    expect(patch.priceAmount).toBe('999.00');
  });
});

// ── Active / renewal / cancellation ────────────────────────────────────────

describe('active subscription, renewal and cancellation (Phase 4B.1)', () => {
  it('activation sets a one-month period for monthly billing', () => {
    const patch = activate({ interval: 'month', periodStart: NOW });
    expect(patch.status).toBe('active');
    expect(patch.currentPeriodEnd).toEqual(periodEndFor(NOW, 'month'));
    expect(patch.trialEndsAt).toBeNull();
    expect(patch.gracePeriodEndsAt).toBeNull();
  });

  it('activation sets a twelve-month period for annual billing', () => {
    const patch = activate({ interval: 'year', periodStart: NOW });
    expect(patch.currentPeriodEnd!.getUTCFullYear()).toBe(NOW.getUTCFullYear() + 1);
  });

  it('cancellation keeps paid access until the end of the already-paid period', () => {
    const patch = cancelAtPeriodEnd(NOW);
    expect(patch.cancelAtPeriodEnd).toBe(true);
    expect(patch.canceledAt).toEqual(NOW);
    // Nothing about the plan, status, or price changes yet.
    expect(patch).not.toHaveProperty('plan');
    expect(patch).not.toHaveProperty('status');

    const stillEntitled = deriveBillingState(
      sub({ plan: 'premium', status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: addDays(NOW, 10) }),
      NOW,
    );
    expect(stillEntitled.effectivePlan).toBe('premium');
    expect(stillEntitled.isPaid).toBe(true);
    expect(stillEntitled.cancelAtPeriodEnd).toBe(true);
  });

  it('a cancelled subscription downgrades once the paid period actually ends', () => {
    const state = deriveBillingState(
      sub({ plan: 'premium', status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: addDays(NOW, -1) }),
      NOW,
    );
    expect(state.effectivePlan).toBe('free');
    expect(state.isPaid).toBe(false);
  });

  it('an active period that elapsed WITHOUT a cancellation keeps access and flags a provider sync gap', () => {
    // A renewal we have not heard about yet must not punish a paying vendor,
    // and no downgrade deadline is invented here - reconciliation is Phase 4B.5.
    const state = deriveBillingState(
      sub({ plan: 'professional', status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: addDays(NOW, -1) }),
      NOW,
    );
    expect(state.effectivePlan).toBe('professional');
    expect(state.isPaid).toBe(true);
    expect(state.awaitingRenewalSync).toBe(true);
  });
});

// ── Failed payment / grace ─────────────────────────────────────────────────

describe('failed payment and the approved 7-day grace period (Phase 4B.1)', () => {
  it('a failed payment enters past_due with a grace window exactly 7 days out', () => {
    const patch = markPaymentFailed(NOW);
    expect(patch.status).toBe('past_due');
    expect(patch.gracePeriodEndsAt).toEqual(addDays(NOW, 7));
  });

  it('paid entitlements are RETAINED throughout the grace window', () => {
    const state = deriveBillingState(
      sub({ plan: 'premium', status: 'past_due', gracePeriodEndsAt: addDays(NOW, 3) }),
      NOW,
    );
    expect(state.effectivePlan).toBe('premium');
    expect(state.isPaid).toBe(true);
    expect(state.inGracePeriod).toBe(true);
  });

  it('once the grace window elapses the vendor is downgraded to FREE', () => {
    const state = deriveBillingState(
      sub({ plan: 'premium', status: 'past_due', gracePeriodEndsAt: addDays(NOW, -1) }),
      NOW,
    );
    expect(state.effectivePlan).toBe('free');
    expect(state.isPaid).toBe(false);
    expect(state.entitlements.qualifiedEnquiriesPerMonth).toBe(5);
  });

  it('recovering payment inside the window restores an active subscription and clears grace', () => {
    const patch = recoverPayment({ interval: 'month', periodStart: NOW });
    expect(patch.status).toBe('active');
    expect(patch.gracePeriodEndsAt).toBeNull();
  });
});

// ── Downgrade ──────────────────────────────────────────────────────────────

describe('downgrade to FREE (Phase 4B.1)', () => {
  it('clears commercial state only - and never touches vendor business data', () => {
    for (const reason of ['trial_expired', 'canceled', 'grace_expired'] as const) {
      const patch = downgradeToFree(reason);
      expect(patch.plan).toBe('free');
      expect(patch.priceAmount).toBeNull();
      expect(patch.billingInterval).toBeNull();
      expect(patch.isFounderPrice).toBe(false);
      // The patch may only ever address subscription columns. Any key naming
      // vendor business data would mean the billing domain is reaching outside
      // its own table, which it must never do.
      for (const forbidden of ['name', 'bio', 'avatar', 'reviews', 'rating', 'reviewCount', 'verified', 'quotations', 'rfqs', 'products']) {
        expect(Object.keys(patch)).not.toContain(forbidden);
      }
    }
  });

  it('records a terminal status appropriate to the reason', () => {
    expect(downgradeToFree('canceled').status).toBe('canceled');
    expect(downgradeToFree('trial_expired').status).toBe('expired');
    expect(downgradeToFree('grace_expired').status).toBe('expired');
  });

  it('every terminal state resolves to FREE entitlements', () => {
    for (const status of ['free', 'canceled', 'expired'] as const) {
      const state = deriveBillingState(sub({ plan: 'premium', status }), NOW);
      expect(state.effectivePlan).toBe('free');
      expect(state.isPaid).toBe(false);
    }
  });
});

// ── State derivation defaults ──────────────────────────────────────────────

describe('billing state derivation defaults (Phase 4B.1)', () => {
  it('a vendor with no subscription row at all is FREE, not an error', () => {
    for (const missing of [null, undefined]) {
      const state = deriveBillingState(missing, NOW);
      expect(state.effectivePlan).toBe('free');
      expect(state.status).toBe('free');
      expect(state.isPaid).toBe(false);
      expect(state.entitlements).toEqual(getEntitlements('free'));
    }
  });

  it('FREE entitlements are always fully populated - never undefined holes', () => {
    const state = deriveBillingState(null, NOW);
    for (const value of Object.values(state.entitlements)) {
      expect(value).not.toBeUndefined();
    }
  });
});
