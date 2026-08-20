import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';
import { ENTITLEMENT_ENFORCEMENT, PLANS } from '@shared/billing';

// Phase 4B Slice 2. The billing engine built across 4B.1-4B.4 was complete and
// unreachable: one trpc.billing.* call site existed in the entire client, and it
// was a cache invalidation. These tests pin the surface that now connects it,
// and - more importantly - pin the honesty properties, since this is the first
// code that shows commercial claims to a paying vendor.

const client = (p: string) => readFileSync(new URL(`../client/src/${p}`, import.meta.url), 'utf8');
/** Executable lines only - these files' comments legitimately quote prices and
 *  forbidden patterns in prose to explain the rules they follow. */
const codeOf = (source: string) => source
  .split('\n')
  .filter(line => { const t = line.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
  .join('\n');

const PRICING = client('pages/Pricing.tsx');
const PRICING_CODE = codeOf(PRICING);
const VENDOR = client('components/VendorBilling.tsx');
const ADMIN = client('components/AdminVendorBilling.tsx');

function makeCtx(userId: number, role: 'user' | 'admin' = 'user', userRole = 'contractor'): TrpcContext {
  return {
    user: {
      id: userId, openId: `u-${userId}`, email: `u${userId}@t.com`, name: `U${userId}`,
      loginMethod: 'dummy', role, userRole, accountStatus: 'active', onboardingStatus: 'approved',
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: {} as TrpcContext['res'],
  };
}
const anonCtx = (): TrpcContext =>
  ({ user: null, req: { protocol: 'https', headers: {} } as TrpcContext['req'], res: {} as TrpcContext['res'] });

beforeEach(() => vi.clearAllMocks());

// ── The catalogue endpoint ─────────────────────────────────────────────────

describe('billing.plans now reports what is actually enforced (Slice 2)', () => {
  it('is still public and still returns the approved commercial values', async () => {
    const result = await appRouter.createCaller(anonCtx()).billing.plans();
    expect(result.currency).toBe('EGP');
    expect(result.trialDays).toBe(30);
    expect(result.gracePeriodDays).toBe(7);
    expect(result.plans.find(p => p.id === 'professional')!.standard).toEqual({ month: 499, year: 4990 });
    expect(result.plans.find(p => p.id === 'premium')!.standard).toEqual({ month: 999, year: 9990 });
  });

  it('reports availability for every entitlement, derived from the enforcement ledger', async () => {
    const { entitlementAvailability } = await appRouter.createCaller(anonCtx()).billing.plans();
    // Every entitlement the plan table defines must have an answer - a missing
    // key would render as "available" and quietly advertise a dead feature.
    for (const key of Object.keys(PLANS.free.entitlements)) {
      expect(entitlementAvailability, key).toHaveProperty(key);
      expect(typeof entitlementAvailability[key as keyof typeof entitlementAvailability]).toBe('boolean');
    }
  });

  it('marks exactly the three enforced entitlements as available today', async () => {
    const { entitlementAvailability } = await appRouter.createCaller(anonCtx()).billing.plans();
    expect(entitlementAvailability.qualifiedEnquiriesPerMonth).toBe(true);
    expect(entitlementAvailability.serviceCategoryLimit).toBe(true);
    expect(entitlementAvailability.analyticsLevel).toBe(true);
  });

  it('marks unbuilt and deferred entitlements as NOT available', async () => {
    const { entitlementAvailability } = await appRouter.createCaller(anonCtx()).billing.plans();
    for (const key of ['portfolioLevel', 'promotionalCapability', 'branchLimit', 'teamMemberLimit'] as const) {
      expect(entitlementAvailability[key], `${key} is not-implemented`).toBe(false);
    }
    for (const key of ['visibilityLevel', 'featuredPlacementEligible'] as const) {
      expect(entitlementAvailability[key], `${key} is deferred to 4B.6`).toBe(false);
    }
  });

  it('availability tracks the ledger automatically - building a feature flips it', () => {
    // Guards against the map drifting into a hand-maintained second list.
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('entitlementAvailability:'), source.indexOf('entitlementAvailability:') + 500);
    expect(block).toContain('ENTITLEMENT_ENFORCEMENT');
    expect(Object.keys(ENTITLEMENT_ENFORCEMENT).length).toBe(Object.keys(PLANS.free.entitlements).length);
  });
});

// ── Pricing page honesty ───────────────────────────────────────────────────

describe('the pricing page tells the truth (Slice 2)', () => {
  it('reads every commercial value from the server, hardcoding no price', () => {
    expect(PRICING).toContain('trpc.billing.plans.useQuery');
    // No EGP amount may be literal in the rendered page.
    for (const amount of ['499', '4990', '999', '9990', '299', '699']) {
      expect(PRICING_CODE, `hardcoded ${amount}`).not.toMatch(new RegExp(`\\b${amount}\\b`));
    }
  });

  it('badges anything not enforced as "coming soon"', () => {
    expect(PRICING).toContain('entitlementAvailability');
    expect(PRICING).toContain('pricing.comingSoon');
  });

  it('never renders a purchase control while checkout is unavailable', () => {
    // checkoutAvailable is false until a provider is connected in Phase 4B.5.
    expect(PRICING).toContain('checkoutAvailable');
    expect(PRICING).toContain('pricing.checkoutUnavailable');
  });

  it('does not imply an annual founder price, which is not an approved product', () => {
    expect(PRICING).toContain('pricing.founderMonthlyOnly');
    expect(PRICING).toContain('plan.founder.month');
    expect(PRICING).not.toContain('founder.year');
  });

  it('routes all copy through t() rather than inline language ternaries', () => {
    // Locale selection for number/date formatting is legitimate and stays; what
    // must not appear is user-facing COPY chosen by a language ternary.
    const copyTernaries = (PRICING_CODE.match(/ar \? '[^']*' : '[^']*'/g) ?? [])
      .filter(match => !/'(ar-EG|en-US|rtl|ltr)'/.test(match));
    expect(copyTernaries).toEqual([]);
  });
});

// ── Vendor panel: self-scoped, server-authoritative ────────────────────────

describe('the vendor billing panel is server-authoritative (Slice 2)', () => {
  it('reads only self-scoped procedures that take no input', () => {
    expect(VENDOR).toContain('trpc.billing.myLifecycle.useQuery()');
    expect(VENDOR).toContain('trpc.billing.myEnquiryUsage.useQuery()');
    // Nothing may name another vendor.
    expect(VENDOR).not.toContain('userId');
    expect(VENDOR).not.toContain('vendorId');
  });

  it('calls the existing mutations and never computes plan state itself', () => {
    expect(VENDOR).toContain('trpc.billing.cancelSubscription.useMutation');
    expect(VENDOR).toContain('trpc.billing.resumeSubscription.useMutation');
    for (const forbidden of ['deriveBillingState', 'qualifiedEnquiriesPerMonth:', 'TRIAL_DAYS', 'GRACE_PERIOD_DAYS']) {
      expect(VENDOR, forbidden).not.toContain(forbidden);
    }
  });

  it('surfaces the SERVER refusal message rather than inventing one', () => {
    expect(VENDOR).toContain('onError: error => toast.error(error.message)');
  });

  it('treats an idempotent noop as success, not failure', () => {
    // Repeating a completed transition is correct behaviour, not an error.
    expect(VENDOR).toContain("result.outcome === 'noop'");
    expect(VENDOR).toContain('billing.noChange');
  });

  it('confirms cancellation, and states plainly that no data is deleted', () => {
    expect(VENDOR).toContain('confirmCancel');
    const body = readFileSync(new URL('../client/src/contexts/LanguageContext.tsx', import.meta.url), 'utf8');
    const en = body.slice(body.indexOf("'billing.cancelBody':"), body.indexOf("'billing.cancelBody':") + 260);
    expect(en).toMatch(/Nothing is deleted/);
    expect(en).toMatch(/profile, reviews, portfolio and history/);
  });

  it('tells a cancelling vendor they keep access until the period ends', () => {
    expect(VENDOR).toContain('billing.canceledNotice');
    expect(VENDOR).toContain('CANCELLATION_SCHEDULED');
  });

  it('renders every lifecycle state the server can return', () => {
    const dict = readFileSync(new URL('../client/src/contexts/LanguageContext.tsx', import.meta.url), 'utf8');
    for (const state of [
      'FREE', 'TRIALING', 'ACTIVE', 'CANCELLATION_SCHEDULED', 'PAST_DUE',
      'GRACE_PERIOD', 'AWAITING_RENEWAL_SYNC', 'RECONCILIATION_REQUIRED', 'EXPIRED',
    ]) {
      expect(dict, `billing.state.${state}`).toContain(`'billing.state.${state}'`);
    }
  });
});

// ── Reachability: the point of the whole slice ─────────────────────────────

describe('the billing system is actually reachable now (Slice 2)', () => {
  it('a /pricing route exists', () => {
    const app = client('App.tsx');
    expect(app).toContain('path={"/pricing"}');
    expect(app).toContain('component={Pricing}');
  });

  it('the vendor workspace mounts the billing panel', () => {
    const platform = client('pages/RolePlatform.tsx');
    expect(platform).toContain('<VendorBilling />');
    expect(platform).toContain('id="role-billing"');
  });

  it('the admin dashboard has a billing section that is actually routable', () => {
    const admin = client('pages/AdminDashboard.tsx');
    expect(admin).toContain("'billing'");
    expect(admin).toContain('<AdminVendorBilling />');
    // The URL allowlist must include it, or /admin/billing silently falls back.
    const allowlist = admin.slice(admin.indexOf('const adminSection'), admin.indexOf('const handleAdminSectionChange'));
    expect(allowlist).toContain("'billing'");
  });

  it('REGRESSION: billing procedures are no longer orphaned in the client', () => {
    const all = [PRICING, VENDOR, ADMIN].join('\n');
    for (const procedure of ['billing.plans', 'billing.myLifecycle', 'billing.myEnquiryUsage',
      'billing.cancelSubscription', 'billing.resumeSubscription',
      'admin.vendorLifecycle', 'admin.vendorBilling']) {
      expect(all, procedure).toContain(procedure);
    }
  });
});

// ── Admin surface: read-only, no credentials ───────────────────────────────

describe('the admin billing view (Slice 2)', () => {
  it('is read-only - no lifecycle mutation is wired to a button', () => {
    // These exist on the server and are deliberately not exposed as UI: manual
    // plan-granting is exactly what the audited lifecycle exists to prevent.
    for (const mutation of ['startVendorTrial', 'changeVendorPlan', 'recordVendorPayment', 'reconcileVendorBilling', 'reconcileDueBilling']) {
      expect(ADMIN, mutation).not.toContain(mutation);
    }
  });

  it('surfaces the states support would otherwise have no explanation for', () => {
    expect(ADMIN).toContain('dataIntegrityIssue');
    expect(ADMIN).toContain('reconciliationRequired');
  });

  it('exposes no provider handle or credential', () => {
    for (const forbidden of ['providerCustomerRef', 'providerSubscriptionRef', 'providerPriceRef', 'passwordHash', 'apiKey']) {
      expect(ADMIN, forbidden).not.toContain(forbidden);
    }
  });

  it('reuses the existing billingEvents trail rather than a new one', () => {
    expect(ADMIN).toContain('billing.events');
    expect(ADMIN).toContain('adminBilling.history');
  });
});

// ── Authorization ──────────────────────────────────────────────────────────

describe('authorization on the newly-reachable surface (Slice 2)', () => {
  beforeEach(() => vi.mocked(getDb).mockResolvedValue(null as never));

  it('the catalogue stays public - a signed-out visitor can price the product', async () => {
    await expect(appRouter.createCaller(anonCtx()).billing.plans()).resolves.toBeTruthy();
  });

  it('anonymous callers cannot read any vendor billing state', async () => {
    const caller = appRouter.createCaller(anonCtx());
    await expect(caller.billing.myLifecycle()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(caller.billing.myEnquiryUsage()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(caller.admin.vendorLifecycle({ userId: 1 })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('a non-admin cannot reach the admin billing lookup', async () => {
    const caller = appRouter.createCaller(makeCtx(10));
    await expect(caller.admin.vendorLifecycle({ userId: 11 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.admin.vendorBilling({ userId: 11 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a homeowner cannot cancel or resume a vendor subscription', async () => {
    const caller = appRouter.createCaller(makeCtx(2, 'user', 'homeowner'));
    await expect(caller.billing.cancelSubscription()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.billing.resumeSubscription()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
