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
function mockDbWithSubscription(row: Record<string, unknown> | null) {
  const select = vi.fn().mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(row ? [row] : []),
        orderBy: () => ({ limit: () => Promise.resolve([]) }),
      }),
    }),
  }));
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
  it('the billing router exposes NO mutation at all - plan changes are provider-driven only', () => {
    expect(billingRouterBlock).not.toContain('.mutation(');
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
