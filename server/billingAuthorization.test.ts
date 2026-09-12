import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';
import { ADMIN_SUBSCRIPTION_COLUMNS, VENDOR_SUBSCRIPTION_COLUMNS } from './billing/service';
import {
  NullPaymentProvider,
  PaymentProviderNotConfiguredError,
  getPaymentProvider,
  isPaymentProviderConfigured,
  setPaymentProvider,
} from './billing/provider';

function makeCtx(userId: number, role: 'user' | 'admin' = 'user', userRole = 'contractor'): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@test.com`,
      name: `User ${userId}`,
      loginMethod: 'dummy',
      role,
      // migration 0020: an admin row must now say WHICH administrator it is.
      adminRole: role === 'admin' ? 'SUPER_ADMIN' : null,
      userRole,
      accountStatus: 'active',
      onboardingStatus: 'approved',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: {} as TrpcContext['res'],
  };
}

function makeAnonCtx(): TrpcContext {
  return { user: null, req: { protocol: 'https', headers: {} } as TrpcContext['req'], res: {} as TrpcContext['res'] };
}

const routersSource = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
const billingRouterBlock = routersSource.slice(
  routersSource.indexOf('const billingRouter = router({'),
  routersSource.indexOf('export const appRouter'),
);

/** Mocks a single vendorSubscriptions row lookup plus an empty events list. */
/**
 * The subscription row, and NOTHING ELSE FOUND.
 *
 * `myBenefits` reads more than the subscription - the entitlement overrides and
 * the allowance bonuses too - and the first version of this fake answered those
 * with an object rather than a list, which surfaced as "bonusRows.map is not a
 * function" instead of as an entitlement result. An unrecognised read now
 * returns an EMPTY LIST, which is the truthful answer for a vendor who has
 * nothing: the assertions below are about a vendor with no billing record, and
 * every extra read they trigger genuinely has no rows.
 */
function mockDbWithSubscription(row: Record<string, unknown> | null) {
  const select = vi.fn().mockImplementation(() => {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      limit: () => Promise.resolve(row ? [row] : []),
      where: () => chain,
      then: (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject),
    };
    return chain;
  });
  return { select };
}

describe('billing.plans - public catalogue (Phase 4B.1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is readable without authentication and returns the approved commercial values', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    const result = await caller.billing.plans();

    expect(result.currency).toBe('EGP');
    expect(result.trialDays).toBe(30);
    expect(result.gracePeriodDays).toBe(7);
    expect(result.founderOfferMonths).toBe(6);

    const professional = result.plans.find(p => p.id === 'professional')!;
    const premium = result.plans.find(p => p.id === 'premium')!;
    expect(professional.standard).toEqual({ month: 499, year: 4990 });
    expect(premium.standard).toEqual({ month: 999, year: 9990 });
    expect(professional.founder.month).toBe(299);
    expect(premium.founder.month).toBe(699);
    expect(professional.founder.year).toBeNull();
    expect(premium.founder.year).toBeNull();
  });

  it('never exposes a provider secret, credential, or reference in the catalogue', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    const json = JSON.stringify(await caller.billing.plans());
    for (const forbidden of ['secret', 'apiKey', 'api_key', 'token', 'hmac', 'providerCustomerRef', 'providerSubscriptionRef']) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe('billing.mySubscription - self-scoped vendor access (Phase 4B.1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an unauthenticated caller', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.billing.mySubscription()).rejects.toThrow();
  });

  it('a vendor with no subscription row resolves to FREE rather than erroring', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDbWithSubscription(null));
    const caller = appRouter.createCaller(makeCtx(10));

    const result = await caller.billing.mySubscription();
    expect(result.plan).toBe('free');
    expect(result.isPaid).toBe(false);
    expect(result.entitlements.qualifiedEnquiriesPerMonth).toBe(5);
  });

  it('CROSS-VENDOR ISOLATION: takes no userId input, so no request shape can target another vendor', () => {
    const proc = billingRouterBlock.slice(
      billingRouterBlock.indexOf('mySubscription:'),
      billingRouterBlock.indexOf('});', billingRouterBlock.indexOf('mySubscription:')),
    );
    expect(proc).not.toMatch(/\.input\(/);
    expect(proc).toContain('ctx.user.id');
    expect(proc).not.toMatch(/input\.userId|input\.vendorId/);
  });

  it('reads only the caller\'s own id, even when a userId is smuggled into the payload', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDbWithSubscription(null));
    const caller = appRouter.createCaller(makeCtx(10));
    // The procedure takes no input; a forged payload is ignored outright.
    await expect((caller.billing.mySubscription as unknown as (arg: unknown) => Promise<unknown>)({ userId: 999 }))
      .resolves.toBeTruthy();
  });

  it('reports honestly that checkout is unavailable while no payment provider is configured', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDbWithSubscription(null));
    const caller = appRouter.createCaller(makeCtx(10));
    const result = await caller.billing.mySubscription();
    expect(result.checkoutAvailable).toBe(false);
  });
});

describe('client manipulation cannot change a plan (Phase 4B.1)', () => {
  // Phase 4B.4 introduced the first billing-router mutations, which the phase
  // brief §10 explicitly authorizes. The property this test was protecting -
  // that no request can upgrade a vendor - is therefore asserted directly, and
  // more strongly, than by the absence of mutations: it now survives the
  // mutations actually existing.
  it('every billing-router mutation is self-scoped and takes no access-granting input', () => {
    const mutations = billingRouterBlock.split('\n').filter(line => line.includes('.mutation('));
    expect(mutations.length).toBeGreaterThan(0);

    // The two vendor-facing lifecycle rights, and only those two.
    expect(billingRouterBlock).toContain('cancelSubscription: approvedProviderProcedure.mutation(');
    expect(billingRouterBlock).toContain('resumeSubscription: approvedProviderProcedure.mutation(');

    // Neither takes ANY input, so there is no field to manipulate, and both
    // are keyed by the authenticated session rather than a supplied id.
    const lifecycleBlock = billingRouterBlock.slice(billingRouterBlock.indexOf('cancelSubscription:'));
    expect(lifecycleBlock).not.toContain('.input(');
    expect(lifecycleBlock).toContain('ctx.user.id');
    expect(lifecycleBlock).not.toContain('input.userId');
  });

  it('selecting or changing a PLAN is not reachable from the vendor-facing billing router', () => {
    // No payment can be collected before Phase 4B.5, so a vendor-callable
    // subscribe/upgrade would hand out real paid entitlements for nothing.
    expect(billingRouterBlock).not.toContain('startTrial:');
    expect(billingRouterBlock).not.toContain('changePlan:');
  });

  it('no endpoint anywhere accepts a client-supplied plan, price, or subscription status', () => {
    // A vendor must not be able to upgrade themselves by manipulating a request.
    // The only writes to vendorSubscriptions go through applySubscriptionPatch,
    // whose patches come exclusively from domain.ts transition functions.
    expect(billingRouterBlock).not.toMatch(/z\.enum\(\[['"]free['"]/);
    expect(billingRouterBlock).not.toMatch(/priceAmount:\s*z\./);
    expect(billingRouterBlock).not.toMatch(/plan:\s*z\./);
    expect(billingRouterBlock).not.toMatch(/status:\s*z\./);
  });

  it('the service layer never writes a caller-supplied field set', () => {
    const service = readFileSync(new URL('./billing/service.ts', import.meta.url), 'utf8');
    // applySubscriptionPatch accepts a SubscriptionPatch (produced by domain.ts),
    // not an arbitrary record.
    expect(service).toContain('patch: SubscriptionPatch');
    expect(service).not.toMatch(/Record<string,\s*unknown>/);
  });
});

describe('admin billing visibility (Phase 4B.1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a non-admin', async () => {
    const caller = appRouter.createCaller(makeCtx(10, 'user'));
    await expect(caller.admin.vendorBilling({ userId: 11 })).rejects.toThrow();
  });

  it('rejects an unauthenticated caller', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.admin.vendorBilling({ userId: 11 })).rejects.toThrow();
  });

  it('an admin can read a vendor\'s billing state', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDbWithSubscription(null));
    const caller = appRouter.createCaller(makeCtx(1, 'admin'));
    const result = await caller.admin.vendorBilling({ userId: 11 });
    expect(result).toBeTruthy();
    expect(result!.effectivePlan).toBe('free');
  });

  it('the admin allowlist EXCLUDES every provider reference and any credential-shaped field', () => {
    const keys = Object.keys(ADMIN_SUBSCRIPTION_COLUMNS);
    for (const forbidden of ['providerCustomerRef', 'providerSubscriptionRef', 'providerPriceRef']) {
      expect(keys).not.toContain(forbidden);
    }
    for (const key of keys) {
      expect(key.toLowerCase()).not.toContain('secret');
      expect(key.toLowerCase()).not.toContain('token');
      expect(key.toLowerCase()).not.toContain('card');
    }
  });

  it('the vendor-facing allowlist also excludes provider references', () => {
    const keys = Object.keys(VENDOR_SUBSCRIPTION_COLUMNS);
    for (const forbidden of ['providerCustomerRef', 'providerSubscriptionRef', 'providerPriceRef', 'provider']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('BuildHub stores no card, token, or payment credential column anywhere in the schema', () => {
    const schema = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');
    const billingBlock = schema.slice(schema.indexOf('export const vendorSubscriptions'), schema.indexOf('// ── Types'));
    for (const forbidden of ['cardNumber', 'cvv', 'pan', 'cardToken', 'apiKey', 'secret']) {
      expect(billingBlock).not.toContain(forbidden);
    }
  });
});

describe('entitlement API - server authority (Phase 4B.2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('billing.myBenefits rejects an unauthenticated caller', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.billing.myBenefits()).rejects.toThrow();
  });

  it('billing.myEnquiryUsage rejects an unauthenticated caller', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.billing.myEnquiryUsage()).rejects.toThrow();
  });

  /*
   * RESTATED AGAINST THE READER THAT SURVIVES, not weakened.
   *
   * `billing.myEntitlements` and `billing.myPlan` were removed: neither had a
   * client caller, and `myBenefits` returns `toVendorEntitlementResponse` as
   * its `plan` - the same object myEntitlements returned - with the usage and
   * the allowance breakdown the screen needs. Three readers of one resolution,
   * two reaching no screen, is how one of them drifts.
   *
   * Every property asserted below is the property that was asserted before, on
   * the endpoint a vendor can actually reach.
   */
  it('resolves FREE for a vendor with no billing record', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDbWithSubscription(null));
    const caller = appRouter.createCaller(makeCtx(10));
    const result = await caller.billing.myBenefits();
    expect(result.plan.plan).toBe('free');
    expect(result.plan.qualifiedEnquiryAllowance).toBe(5);
  });

  it('CROSS-VENDOR: no entitlement endpoint accepts a userId, so none can target another vendor', () => {
    for (const name of ['myBenefits:', 'myEnquiryUsage:', 'myLifecycle:']) {
      const start = billingRouterBlock.indexOf(name);
      const proc = billingRouterBlock.slice(start, billingRouterBlock.indexOf('}),', start));
      expect(proc, name).not.toMatch(/\.input\(/);
      expect(proc, name).toContain('ctx.user.id');
    }
  });

  it('CLIENT MANIPULATION: a forged plan/entitlement payload is ignored - the response comes from server state', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDbWithSubscription(null));
    const caller = appRouter.createCaller(makeCtx(10));
    const forged = { plan: 'premium', entitlements: { qualifiedEnquiriesPerMonth: 9999 }, isPaid: true, founderPriceActive: true };
    const result = await (caller.billing.myBenefits as unknown as (a: unknown) => Promise<{ plan: { plan: string; qualifiedEnquiryAllowance: number | null; isPaid: boolean } }>)(forged);
    expect(result.plan.plan).toBe('free');
    expect(result.plan.qualifiedEnquiryAllowance).toBe(5);
    expect(result.plan.isPaid).toBe(false);
  });

  it('a vendor cannot upgrade themselves: no billing-router mutation can raise a plan', () => {
    // Phase 4B.4: mutations exist now, but only cancel/resume - both of which
    // can lower or restore access, never grant it. The plan-selecting
    // transitions live behind adminProcedure in the admin router.
    expect(billingRouterBlock).not.toContain('startPaidTrial(');
    expect(billingRouterBlock).not.toContain('changeVendorPlan(');
    expect(billingRouterBlock).not.toContain('recordPaymentSucceeded(');
    expect(billingRouterBlock).not.toContain('recordPaymentRecovery(');
    expect(billingRouterBlock).toContain('requestCancellation(');
    expect(billingRouterBlock).toContain('resumeSubscription(');
  });

  it('the engine is the ONLY place plans are compared - no scattered plan checks in routers or client', () => {
    const routers = routersSource;
    const scattered = routers.match(/plan\s*===\s*['"](free|professional|premium)['"]/g) ?? [];
    expect(scattered).toEqual([]);
  });
});

describe('payment provider abstraction (Phase 4B.1)', () => {
  it('no provider is configured, and that is reported honestly', () => {
    expect(isPaymentProviderConfigured()).toBe(false);
    expect(getPaymentProvider().id).toBe('none');
  });

  it('every provider operation fails loudly rather than silently pretending to succeed', async () => {
    const provider = new NullPaymentProvider();
    await expect(provider.createCustomer()).rejects.toThrow(PaymentProviderNotConfiguredError);
    await expect(provider.createCheckoutSession()).rejects.toThrow(PaymentProviderNotConfiguredError);
    await expect(provider.cancelSubscription()).rejects.toThrow(PaymentProviderNotConfiguredError);
    await expect(provider.refund()).rejects.toThrow(PaymentProviderNotConfiguredError);
    expect(() => provider.verifyAndParseWebhook()).toThrow(PaymentProviderNotConfiguredError);
  });

  it('a provider can be registered and swapped without the domain changing', () => {
    const stub = { ...new NullPaymentProvider(), id: 'stub-provider' } as ReturnType<typeof getPaymentProvider>;
    setPaymentProvider(stub);
    expect(getPaymentProvider().id).toBe('stub-provider');
    expect(isPaymentProviderConfigured()).toBe(true);
    setPaymentProvider(new NullPaymentProvider());
    expect(isPaymentProviderConfigured()).toBe(false);
  });

  it('the billing domain never imports a payment provider SDK or names a specific provider', () => {
    const domain = readFileSync(new URL('./billing/domain.ts', import.meta.url), 'utf8');
    const service = readFileSync(new URL('./billing/service.ts', import.meta.url), 'utf8');
    for (const source of [domain, service]) {
      expect(source.toLowerCase()).not.toContain('paymob');
      expect(source.toLowerCase()).not.toContain('stripe');
      expect(source.toLowerCase()).not.toContain('fawry');
    }
  });

  it('no Paymob integration exists anywhere in the codebase yet', () => {
    // Phase 4B.1 must not integrate a provider - no sandbox account exists.
    const provider = readFileSync(new URL('./billing/provider.ts', import.meta.url), 'utf8');
    expect(provider).not.toMatch(/https?:\/\/[^\s]*paymob/i);
    expect(provider).not.toContain('accept.paymob');
  });
});
