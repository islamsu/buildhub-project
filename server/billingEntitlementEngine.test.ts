import { describe, expect, it } from 'vitest';
import { getEntitlements, type PlanId } from '@shared/billing';
import { deriveBillingState } from './billing/domain';
import {
  CAPABILITIES,
  allowancePeriodFor,
  buildResolution,
  can,
  isGranted,
  toVendorEntitlementResponse,
  type Capability,
} from './billing/entitlements';
import type { VendorSubscription } from '../drizzle/schema';

// Deterministic clock throughout - no sleeps, no wall-clock dependence.
const NOW = new Date('2026-08-19T12:00:00.000Z');
const MS = 1;

function sub(overrides: Partial<VendorSubscription> = {}): VendorSubscription {
  return {
    id: 1,
    userId: 42,
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

/** Resolve straight from a row, bypassing the DB - the engine's pure path. */
function resolve(row: VendorSubscription | null, now: Date = NOW) {
  return buildResolution(42, deriveBillingState(row, now), now);
}

// ── Effective plan resolution ──────────────────────────────────────────────

describe('effective plan resolution (Phase 4B.2)', () => {
  it('FREE: a vendor with no billing record resolves to FREE with the 5-enquiry allowance', () => {
    const r = resolve(null);
    expect(r.effectivePlan).toBe('free');
    expect(r.isPaid).toBe(false);
    expect(r.qualifiedEnquiryAllowance).toBe(5);
    expect(r.entitlements).toEqual(getEntitlements('free'));
  });

  it('PROFESSIONAL active: resolves to professional with the 30-enquiry allowance', () => {
    const r = resolve(sub({ plan: 'professional', status: 'active', billingInterval: 'month', currentPeriodEnd: new Date('2026-09-19T12:00:00.000Z') }));
    expect(r.effectivePlan).toBe('professional');
    expect(r.isPaid).toBe(true);
    expect(r.qualifiedEnquiryAllowance).toBe(30);
    expect(r.billingInterval).toBe('month');
  });

  it('PREMIUM active: resolves to premium with an unlimited allowance', () => {
    const r = resolve(sub({ plan: 'premium', status: 'active', billingInterval: 'year', currentPeriodEnd: new Date('2027-08-19T12:00:00.000Z') }));
    expect(r.effectivePlan).toBe('premium');
    expect(r.qualifiedEnquiryAllowance).toBeNull();
    expect(can(r, 'unlimited_enquiries')).toBe(true);
  });

  it('the resolution always reports both the stored and the effective plan', () => {
    const lapsed = resolve(sub({ plan: 'premium', status: 'trialing', trialEndsAt: new Date(NOW.getTime() - MS) }));
    expect(lapsed.storedPlan).toBe('premium');
    expect(lapsed.effectivePlan).toBe('free');
  });
});

// ── Trial ──────────────────────────────────────────────────────────────────

describe('trial behaviour (Phase 4B.2)', () => {
  it('a valid trial grants the full paid-plan entitlements', () => {
    const r = resolve(sub({ plan: 'premium', status: 'trialing', trialEndsAt: new Date(NOW.getTime() + 86_400_000) }));
    expect(r.effectivePlan).toBe('premium');
    expect(r.inTrial).toBe(true);
    expect(r.isPaid).toBe(true);
  });

  it('an expired trial resolves to FREE without any background job having run', () => {
    const r = resolve(sub({ plan: 'premium', status: 'trialing', trialEndsAt: new Date(NOW.getTime() - MS) }));
    expect(r.effectivePlan).toBe('free');
    expect(r.inTrial).toBe(false);
    expect(r.status).toBe('trialing'); // stored state is deliberately still stale
  });
});

// ── Time boundaries (§13) ──────────────────────────────────────────────────

describe('exact time boundaries (Phase 4B.2)', () => {
  const at = (t: Date) => resolve(sub({ plan: 'professional', status: 'trialing', trialEndsAt: t }), NOW);

  it('trial: 1ms before expiry still grants, exactly at expiry does not, 1ms after does not', () => {
    expect(at(new Date(NOW.getTime() + MS)).effectivePlan).toBe('professional');
    expect(at(NOW).effectivePlan).toBe('free');
    expect(at(new Date(NOW.getTime() - MS)).effectivePlan).toBe('free');
  });

  it('billing period: access ends at the exact instant the paid period ends (with cancellation)', () => {
    const rowAt = (end: Date) => resolve(sub({ plan: 'premium', status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: end }), NOW);
    expect(rowAt(new Date(NOW.getTime() + MS)).effectivePlan).toBe('premium');
    expect(rowAt(NOW).effectivePlan).toBe('free');
    expect(rowAt(new Date(NOW.getTime() - MS)).effectivePlan).toBe('free');
  });

  it('grace: entitlements persist to the last millisecond, then stop exactly at expiry', () => {
    const rowAt = (end: Date) => resolve(sub({ plan: 'premium', status: 'past_due', gracePeriodEndsAt: end }), NOW);
    expect(rowAt(new Date(NOW.getTime() + MS)).effectivePlan).toBe('premium');
    expect(rowAt(new Date(NOW.getTime() + MS)).inGracePeriod).toBe(true);
    expect(rowAt(NOW).effectivePlan).toBe('free');
    expect(rowAt(new Date(NOW.getTime() - MS)).effectivePlan).toBe('free');
  });

  it('founder six-month expiry: discount applies to the last millisecond, then the plan continues at standard price', () => {
    const rowAt = (end: Date) => resolve(sub({
      plan: 'professional', status: 'active', isFounderPrice: true,
      founderPriceEndsAt: end, currentPeriodEnd: new Date(NOW.getTime() + 86_400_000),
    }), NOW);
    expect(rowAt(new Date(NOW.getTime() + MS)).founderPriceActive).toBe(true);
    expect(rowAt(NOW).founderPriceActive).toBe(false);
    // Crucially, access is unaffected by the price change.
    expect(rowAt(NOW).effectivePlan).toBe('professional');
    expect(rowAt(NOW).isPaid).toBe(true);
  });
});

// ── Monthly allowance period (§9, §13) ─────────────────────────────────────

describe('monthly allowance period boundaries (Phase 4B.2)', () => {
  it('produces a UTC month key, start and reset instant', () => {
    const p = allowancePeriodFor(NOW);
    expect(p.key).toBe('2026-08');
    expect(p.startsAt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(p.resetsAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('the final millisecond of a month still belongs to that month', () => {
    expect(allowancePeriodFor(new Date('2026-08-31T23:59:59.999Z')).key).toBe('2026-08');
  });

  it('the first instant of the next month starts a new period', () => {
    expect(allowancePeriodFor(new Date('2026-09-01T00:00:00.000Z')).key).toBe('2026-09');
  });

  it('rolls the year correctly across a December/January boundary', () => {
    expect(allowancePeriodFor(new Date('2026-12-31T23:59:59.999Z')).key).toBe('2026-12');
    const jan = allowancePeriodFor(new Date('2027-01-01T00:00:00.000Z'));
    expect(jan.key).toBe('2027-01');
    expect(jan.resetsAt.toISOString()).toBe('2027-02-01T00:00:00.000Z');
  });

  it('handles a February leap-year boundary', () => {
    const feb = allowancePeriodFor(new Date('2028-02-29T23:59:59.999Z'));
    expect(feb.key).toBe('2028-02');
    expect(feb.resetsAt.toISOString()).toBe('2028-03-01T00:00:00.000Z');
  });

  it('is computed in UTC, so a late-evening local time cannot land in the wrong month', () => {
    // 2026-08-31T23:30Z is still August in UTC regardless of server locale.
    expect(allowancePeriodFor(new Date('2026-08-31T23:30:00.000Z')).key).toBe('2026-08');
  });
});

// ── Cancellation & grace ───────────────────────────────────────────────────

describe('cancellation and grace resolution (Phase 4B.2)', () => {
  it('cancellation scheduled: paid entitlements remain until the period ends', () => {
    const r = resolve(sub({ plan: 'premium', status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: new Date(NOW.getTime() + 86_400_000) }));
    expect(r.effectivePlan).toBe('premium');
    expect(r.cancelAtPeriodEnd).toBe(true);
  });

  it('an elapsed paid period WITHOUT cancellation keeps access and flags the provider sync gap honestly', () => {
    const r = resolve(sub({ plan: 'professional', status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: new Date(NOW.getTime() - 86_400_000) }));
    expect(r.effectivePlan).toBe('professional');
    expect(r.awaitingRenewalSync).toBe(true);
  });

  it('within grace the vendor keeps paid entitlements; after grace they do not', () => {
    const inGrace = resolve(sub({ plan: 'professional', status: 'past_due', gracePeriodEndsAt: new Date(NOW.getTime() + 86_400_000) }));
    expect(inGrace.effectivePlan).toBe('professional');
    expect(inGrace.inGracePeriod).toBe(true);

    const after = resolve(sub({ plan: 'professional', status: 'past_due', gracePeriodEndsAt: new Date(NOW.getTime() - MS) }));
    expect(after.effectivePlan).toBe('free');
    expect(after.inGracePeriod).toBe(false);
  });

  it('every terminal state resolves to FREE', () => {
    for (const status of ['free', 'canceled', 'expired'] as const) {
      expect(resolve(sub({ plan: 'premium', status })).effectivePlan).toBe('free');
    }
  });
});

// ── Stale / malformed state (§12) ──────────────────────────────────────────

describe('stale and malformed billing state fails CLOSED (Phase 4B.2 hardening)', () => {
  it('a trialing row with no trialEndsAt cannot grant unbounded paid access', () => {
    const r = resolve(sub({ plan: 'premium', status: 'trialing', trialEndsAt: null }));
    expect(r.effectivePlan).toBe('free');
    expect(r.isPaid).toBe(false);
    expect(r.dataIntegrityIssue).toMatch(/trialEndsAt/);
  });

  it('a past_due row with no gracePeriodEndsAt cannot grant unbounded paid access', () => {
    const r = resolve(sub({ plan: 'premium', status: 'past_due', gracePeriodEndsAt: null }));
    expect(r.effectivePlan).toBe('free');
    expect(r.dataIntegrityIssue).toMatch(/gracePeriodEndsAt/);
  });

  it('an active row with no currentPeriodEnd cannot grant unbounded paid access', () => {
    const r = resolve(sub({ plan: 'premium', status: 'active', currentPeriodEnd: null }));
    expect(r.effectivePlan).toBe('free');
    expect(r.dataIntegrityIssue).toMatch(/currentPeriodEnd/);
  });

  it('an unrecognised status resolves to FREE and reports the problem', () => {
    const r = resolve(sub({ plan: 'premium', status: 'bogus' as VendorSubscription['status'] }));
    expect(r.effectivePlan).toBe('free');
    expect(r.dataIntegrityIssue).toMatch(/unrecognised/);
  });

  it('a healthy row reports no integrity issue', () => {
    const r = resolve(sub({ plan: 'premium', status: 'active', currentPeriodEnd: new Date(NOW.getTime() + 86_400_000) }));
    expect(r.dataIntegrityIssue).toBeNull();
  });
});

// ── Capabilities (§10) ─────────────────────────────────────────────────────

describe('capability resolution (Phase 4B.2)', () => {
  const premium = () => resolve(sub({ plan: 'premium', status: 'active', currentPeriodEnd: new Date(NOW.getTime() + 86_400_000) }));

  it('exposes a status for every declared capability', () => {
    const r = premium();
    for (const capability of CAPABILITIES) {
      expect(r.capabilities[capability]).toBeDefined();
      expect(typeof r.capabilities[capability].granted).toBe('boolean');
      expect(typeof r.capabilities[capability].available).toBe('boolean');
      expect(typeof r.capabilities[capability].usable).toBe('boolean');
    }
  });

  it('FREE grants none of the paid capabilities', () => {
    const r = resolve(null);
    for (const capability of ['advanced_analytics', 'featured_placement', 'unlimited_enquiries', 'boosted_visibility'] as Capability[]) {
      expect(isGranted(r, capability), capability).toBe(false);
    }
  });

  it('PROFESSIONAL grants boosted visibility and advanced analytics but not featured placement', () => {
    const r = resolve(sub({ plan: 'professional', status: 'active', currentPeriodEnd: new Date(NOW.getTime() + 86_400_000) }));
    expect(isGranted(r, 'boosted_visibility')).toBe(true);
    expect(isGranted(r, 'advanced_analytics')).toBe(true);
    expect(isGranted(r, 'featured_placement')).toBe(false);
    expect(isGranted(r, 'unlimited_enquiries')).toBe(false);
  });

  it('PREMIUM grants featured placement and unlimited enquiries', () => {
    const r = premium();
    expect(isGranted(r, 'featured_placement')).toBe(true);
    expect(isGranted(r, 'unlimited_enquiries')).toBe(true);
  });

  it('HONESTY: a capability with no product surface is granted but NOT usable', () => {
    const r = premium();
    // Portfolio, promotions, multi-branch and multi-team do not exist in
    // BuildHub yet - a Premium vendor is entitled to them on paper, but they
    // must never be presented as working features.
    for (const capability of ['full_portfolio', 'promotional_campaigns', 'multi_branch', 'multi_team'] as Capability[]) {
      expect(isGranted(r, capability), `${capability} granted`).toBe(true);
      expect(r.capabilities[capability].available, `${capability} available`).toBe(false);
      expect(can(r, capability), `${capability} usable`).toBe(false);
    }
  });

  it('a lapsed paid vendor loses every paid capability', () => {
    const r = resolve(sub({ plan: 'premium', status: 'trialing', trialEndsAt: new Date(NOW.getTime() - MS) }));
    for (const capability of CAPABILITIES) {
      expect(can(r, capability), capability).toBe(false);
    }
  });
});

// ── Vendor response allowlist (§8, §11) ────────────────────────────────────

describe('vendor entitlement response allowlist (Phase 4B.2)', () => {
  const response = () => toVendorEntitlementResponse(
    resolve(sub({ plan: 'premium', status: 'active', currentPeriodEnd: new Date(NOW.getTime() + 86_400_000), provider: 'someprovider', providerCustomerRef: 'CUST_X', providerSubscriptionRef: 'SUB_X', providerPriceRef: 'PRICE_X' })),
  );

  it('never exposes a provider reference or identifier', () => {
    const json = JSON.stringify(response());
    for (const forbidden of ['CUST_X', 'SUB_X', 'PRICE_X', 'someprovider', 'providerCustomerRef', 'providerSubscriptionRef', 'providerPriceRef']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('never exposes internal resolution details a vendor has no use for', () => {
    const keys = Object.keys(response());
    for (const internal of ['userId', 'storedPlan', 'resolvedAt', 'awaitingRenewalSync', 'dataIntegrityIssue']) {
      expect(keys).not.toContain(internal);
    }
  });

  it('surfaces only USABLE capabilities to the vendor, never merely-granted ones', () => {
    const r = response();
    expect(r.capabilities.full_portfolio).toBe(false);
    expect(r.capabilities.multi_branch).toBe(false);
    expect(r.capabilities.featured_placement).toBe(true);
    for (const value of Object.values(r.capabilities)) {
      expect(typeof value).toBe('boolean');
    }
  });

  it('includes the allowance and its reset boundary for Phase 4B.3 to enforce against', () => {
    const r = response();
    expect(r.qualifiedEnquiryAllowance).toBeNull(); // premium = unlimited
    expect(r.allowancePeriod.key).toBe('2026-08');
    expect(r.allowancePeriod.resetsAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('the allowance matches the approved rules on every plan', () => {
    const allowanceFor = (plan: PlanId, row: Partial<VendorSubscription>) =>
      toVendorEntitlementResponse(resolve(sub({ plan, ...row }))).qualifiedEnquiryAllowance;
    expect(allowanceFor('free', { status: 'free' })).toBe(5);
    expect(allowanceFor('professional', { status: 'active', currentPeriodEnd: new Date(NOW.getTime() + 1000) })).toBe(30);
    expect(allowanceFor('premium', { status: 'active', currentPeriodEnd: new Date(NOW.getTime() + 1000) })).toBeNull();
  });
});
