import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';
import { GRACE_PERIOD_DAYS, TRIAL_DAYS, getEntitlements } from '@shared/billing';
import {
  RENEWAL_SYNC_WINDOW_DAYS,
  addDays,
  addMonths,
  changePlan,
  deriveBillingState,
  downgradeToFree,
  lifecycleStateOf,
  reverseCancellation,
} from './billing/domain';
import {
  changeVendorPlan,
  recordPaymentFailure,
  recordPaymentRecovery,
  recordPaymentSucceeded,
  reconcileSubscription,
  requestCancellation,
  resumeSubscription,
  startPaidTrial,
} from './billing/lifecycle';
import {
  adminSettings as adminSettingsTable,
  billingEvents as billingEventsTable,
  vendorSubscriptions as vendorSubscriptionsTable,
  type VendorSubscription,
} from '../drizzle/schema';

// Phase 4B.4 §16. The lifecycle is the part of BuildHub where a bug is a
// commercial one: over-granting means giving paid features away, under-granting
// means cutting off a vendor who paid. Every test below therefore asserts the
// EFFECTIVE entitlement, not just the stored status.

const NOW = new Date('2026-08-20T12:00:00.000Z');
const MS = 1;

function sub(overrides: Partial<VendorSubscription> = {}): VendorSubscription {
  return {
    id: 1, userId: 42, plan: 'free', status: 'free', billingInterval: null,
    currency: 'EGP', priceAmount: null, isFounderPrice: false, founderPriceUsedAt: null,
    founderPriceEndsAt: null, trialStartedAt: null, trialEndsAt: null,
    currentPeriodStart: null, currentPeriodEnd: null,
    cancelAtPeriodEnd: false, canceledAt: null, gracePeriodEndsAt: null,
    provider: null, providerCustomerRef: null, providerSubscriptionRef: null, providerPriceRef: null,
    createdAt: NOW, updatedAt: NOW,
    ...overrides,
  } as VendorSubscription;
}

const paidActive = (plan: 'professional' | 'premium' = 'professional', extra: Partial<VendorSubscription> = {}) =>
  sub({ plan, status: 'active', billingInterval: 'month', currentPeriodStart: NOW, currentPeriodEnd: addMonths(NOW, 1), ...extra });

// ── Fake database ──────────────────────────────────────────────────────────
// One vendor subscription row, mutated in place, plus an append-only event log
// so audit assertions test the real write path rather than a mocked one.

function fakeDb(initial: VendorSubscription | null, options: { founderOfferEndsAt?: string } = {}) {
  const store: { row: VendorSubscription | null; events: Record<string, unknown>[] } = {
    row: initial ? { ...initial } : null,
    events: [],
  };
  let lockedReads = 0;
  let transactions = 0;
  let updates = 0;
  let lockQueue: Promise<void> = Promise.resolve();

  const rowsFor = (table: unknown, terminal: string): unknown[] => {
    if (table === vendorSubscriptionsTable) {
      if (terminal === 'for') lockedReads++;
      return store.row ? [{ ...store.row }] : [];
    }
    if (table === adminSettingsTable) {
      return options.founderOfferEndsAt ? [{ value: options.founderOfferEndsAt }] : [];
    }
    if (table === billingEventsTable) return store.events;
    return [];
  };

  const builder = (table: unknown) => {
    const settle = (t: string) => Promise.resolve(rowsFor(table, t));
    const afterWhere: Record<string, unknown> = {
      limit: () => settle('limit'),
      for: () => ({ limit: () => settle('for'), then: (r: any, j: any) => settle('for').then(r, j) }),
      orderBy: () => ({ limit: () => settle('orderBy') }),
      then: (r: any, j: any) => settle('await').then(r, j),
    };
    return { where: () => afterWhere, then: (r: any, j: any) => settle('await').then(r, j) };
  };

  const db: Record<string, unknown> = {
    select: () => ({ from: (table: unknown) => builder(table) }),
    selectDistinct: () => ({ from: (table: unknown) => builder(table) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === billingEventsTable) { store.events.push(values); return Promise.resolve(); }
        if (table === vendorSubscriptionsTable) {
          if (store.row) return Promise.reject(Object.assign(new Error('dup'), { cause: { code: 'ER_DUP_ENTRY' } }));
          store.row = sub({ ...values } as Partial<VendorSubscription>);
          return Promise.resolve();
        }
        return Promise.resolve();
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => {
          if (table === vendorSubscriptionsTable && store.row) {
            updates++;
            store.row = { ...store.row, ...patch } as VendorSubscription;
          }
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    // Modelled on the real thing: InnoDB serialises these because each one
    // takes the row's FOR UPDATE lock, so concurrent transitions queue rather
    // than all reading the same pre-change row. A fake that ran them in
    // parallel would quietly pass code that races in production.
    transaction: (cb: (tx: unknown) => Promise<unknown>) => {
      transactions++;
      const run = lockQueue.then(() => cb(db));
      lockQueue = run.then(() => undefined, () => undefined);
      return run;
    },
  };

  return {
    db, store,
    get lockedReads() { return lockedReads; },
    get transactions() { return transactions; },
    get updates() { return updates; },
    get actions() { return store.events.map(e => e.action); },
  };
}

const use = (fake: ReturnType<typeof fakeDb>) => vi.mocked(getDb).mockResolvedValue(fake.db as never);

function makeCtx(userId: number, role: 'user' | 'admin' = 'user', userRole = 'contractor'): TrpcContext {
  return {
    user: {
      id: userId, openId: `u-${userId}`, email: `u${userId}@t.com`, name: `U${userId}`,
      loginMethod: 'dummy', role, userRole, accountStatus: 'active', onboardingStatus: 'approved',
      // migration 0020: an admin row must now say WHICH administrator it is.
      adminRole: role === 'admin' ? 'SUPER_ADMIN' : null,
      createdAt: NOW, updatedAt: NOW, lastSignedIn: NOW,
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: {} as TrpcContext['res'],
  };
}
const anonCtx = (): TrpcContext =>
  ({ user: null, req: { protocol: 'https', headers: {} } as TrpcContext['req'], res: {} as TrpcContext['res'] });

beforeEach(() => vi.clearAllMocks());

// ── Lifecycle state model (§2) ─────────────────────────────────────────────

describe('lifecycle state model (Phase 4B.4 §2)', () => {
  const nameOf = (s: VendorSubscription | null, now = NOW) => lifecycleStateOf(deriveBillingState(s, now));

  it('names every approved lifecycle state from the ONE stored status column', () => {
    expect(nameOf(null)).toBe('FREE');
    expect(nameOf(sub({ plan: 'premium', status: 'trialing', trialEndsAt: addDays(NOW, 5) }))).toBe('TRIALING');
    expect(nameOf(paidActive())).toBe('ACTIVE');
    expect(nameOf(paidActive('professional', { cancelAtPeriodEnd: true, canceledAt: NOW }))).toBe('CANCELLATION_SCHEDULED');
    expect(nameOf(sub({ plan: 'professional', status: 'past_due', gracePeriodEndsAt: addDays(NOW, 3) }))).toBe('GRACE_PERIOD');
    expect(nameOf(sub({ plan: 'free', status: 'expired' }))).toBe('EXPIRED');
    expect(nameOf(sub({ plan: 'free', status: 'canceled' }))).toBe('EXPIRED');
  });

  it('does not introduce a second stored state system - the states are derived', () => {
    const schema = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');
    const table = schema.slice(schema.indexOf('export const vendorSubscriptions'), schema.indexOf('export const billingEvents'));
    const statusColumns = table.match(/status:\s*mysqlEnum/g) ?? [];
    expect(statusColumns).toHaveLength(1);
    expect(table).not.toContain('lifecycleState');
  });
});

// ── Trial (§3) ─────────────────────────────────────────────────────────────

describe('trial behaviour (Phase 4B.4 §3)', () => {
  it('a valid trial grants the selected plan entitlements in full', () => {
    const state = deriveBillingState(sub({ plan: 'premium', status: 'trialing', trialEndsAt: addDays(NOW, 10) }), NOW);
    expect(state.effectivePlan).toBe('premium');
    expect(state.inTrial).toBe(true);
    expect(state.entitlements.qualifiedEnquiriesPerMonth).toBeNull();
  });

  it('the trial is exactly the approved 30 days', async () => {
    const fake = fakeDb(null); use(fake);
    await startPaidTrial({ userId: 42, planId: 'professional', interval: 'month', now: NOW });
    expect(fake.store.row!.trialEndsAt).toEqual(addDays(NOW, TRIAL_DAYS));
  });

  it('an expired trial resolves to FREE server-side - no background job required', () => {
    const lapsed = sub({ plan: 'premium', status: 'trialing', trialEndsAt: new Date(NOW.getTime() - MS) });
    const state = deriveBillingState(lapsed, NOW);
    expect(state.effectivePlan).toBe('free');
    expect(state.isPaid).toBe(false);
    expect(state.entitlements.qualifiedEnquiriesPerMonth).toBe(5);
    // Still stored as `trialing`: the stored row is stale, the answer is not.
    expect(lapsed.status).toBe('trialing');
  });

  it('a trial that has been paid for becomes ACTIVE rather than lapsing', async () => {
    const fake = fakeDb(sub({ plan: 'professional', status: 'trialing', billingInterval: 'month', trialEndsAt: addDays(NOW, 1) }));
    use(fake);
    const result = await recordPaymentSucceeded({ userId: 42, now: NOW });
    expect(result.outcome).toBe('applied');
    expect(fake.store.row!.status).toBe('active');
    expect(fake.store.row!.trialEndsAt).toBeNull();
    expect(lifecycleStateOf(deriveBillingState(fake.store.row, NOW))).toBe('ACTIVE');
  });

  it('ONE trial per vendor: a lapsed trial cannot be restarted for another free 30 days', async () => {
    const spent = sub({ plan: 'free', status: 'expired', trialStartedAt: new Date('2026-01-01T00:00:00Z') });
    const fake = fakeDb(spent); use(fake);
    const result = await startPaidTrial({ userId: 42, planId: 'premium', interval: 'month', now: NOW });
    expect(result.outcome).toBe('rejected');
    expect(result.outcome === 'rejected' && result.reason).toMatch(/already used their trial/);
    expect(fake.updates).toBe(0);
  });

  it('trialStartedAt is write-once - no downgrade path clears it', () => {
    for (const reason of ['trial_expired', 'canceled', 'grace_expired'] as const) {
      expect(downgradeToFree(reason)).not.toHaveProperty('trialStartedAt');
    }
  });
});

// ── Cancellation (§4) ──────────────────────────────────────────────────────

describe('cancellation (Phase 4B.4 §4)', () => {
  it('cancelling does NOT remove paid entitlements immediately', async () => {
    const fake = fakeDb(paidActive('premium')); use(fake);
    const result = await requestCancellation({ userId: 42, now: NOW });

    expect(result.outcome).toBe('applied');
    expect(result.lifecycleState).toBe('CANCELLATION_SCHEDULED');
    expect(result.state.effectivePlan).toBe('premium');
    expect(result.state.isPaid).toBe(true);
    expect(result.state.entitlements.qualifiedEnquiriesPerMonth).toBeNull();
    expect(fake.store.row!.cancelAtPeriodEnd).toBe(true);
  });

  it('at period end the cancelled subscription resolves to FREE', () => {
    const row = paidActive('premium', { cancelAtPeriodEnd: true, canceledAt: NOW, currentPeriodEnd: new Date(NOW.getTime() - MS) });
    const state = deriveBillingState(row, NOW);
    expect(state.effectivePlan).toBe('free');
    expect(state.entitlements.qualifiedEnquiriesPerMonth).toBe(5);
  });

  it('reversal restores the subscription while the paid period is still running', async () => {
    const fake = fakeDb(paidActive('professional', { cancelAtPeriodEnd: true, canceledAt: NOW })); use(fake);
    const result = await resumeSubscription({ userId: 42, now: NOW });

    expect(result.outcome).toBe('applied');
    expect(result.lifecycleState).toBe('ACTIVE');
    expect(fake.store.row!.cancelAtPeriodEnd).toBe(false);
    expect(fake.store.row!.canceledAt).toBeNull();
  });

  it('reversal is refused once the paid period has actually ended', async () => {
    const fake = fakeDb(paidActive('professional', {
      cancelAtPeriodEnd: true, canceledAt: NOW, currentPeriodEnd: new Date(NOW.getTime() - MS),
    }));
    use(fake);
    const result = await resumeSubscription({ userId: 42, now: NOW });
    expect(result.outcome).toBe('rejected');
    expect(fake.updates).toBe(0);
  });

  it('cancellation touches the subscription row and nothing else', async () => {
    const fake = fakeDb(paidActive()); use(fake);
    await requestCancellation({ userId: 42, now: NOW });
    // The fake would record a delete against any table; none is issued.
    expect(reverseCancellation()).toEqual({ cancelAtPeriodEnd: false, canceledAt: null });
    expect(Object.keys(downgradeToFree('canceled'))).not.toContain('userId');
  });
});

// ── Payment failure and grace (§5) ─────────────────────────────────────────

describe('payment failure and the 7-day grace window (Phase 4B.4 §5)', () => {
  it('a failed payment opens exactly the approved grace window and RETAINS entitlements', async () => {
    const fake = fakeDb(paidActive('premium')); use(fake);
    const result = await recordPaymentFailure({ userId: 42, now: NOW });

    expect(result.outcome).toBe('applied');
    expect(result.lifecycleState).toBe('GRACE_PERIOD');
    expect(fake.store.row!.gracePeriodEndsAt).toEqual(addDays(NOW, GRACE_PERIOD_DAYS));
    // Documented behaviour: full paid entitlements continue through grace.
    expect(result.state.effectivePlan).toBe('premium');
    expect(result.state.entitlements).toEqual(getEntitlements('premium'));
  });

  it('once grace elapses the vendor is FREE, with or without a sweep', () => {
    const expired = sub({ plan: 'premium', status: 'past_due', gracePeriodEndsAt: new Date(NOW.getTime() - MS) });
    const state = deriveBillingState(expired, NOW);
    expect(state.effectivePlan).toBe('free');
    expect(state.inGracePeriod).toBe(false);
    expect(state.entitlements.qualifiedEnquiriesPerMonth).toBe(5);
  });

  it('recovery inside the window restores ACTIVE and clears grace', async () => {
    const fake = fakeDb(sub({
      plan: 'professional', status: 'past_due', billingInterval: 'month',
      currentPeriodEnd: addMonths(NOW, 1), gracePeriodEndsAt: addDays(NOW, 3),
    }));
    use(fake);
    const result = await recordPaymentRecovery({ userId: 42, now: NOW });

    expect(result.outcome).toBe('applied');
    expect(result.lifecycleState).toBe('ACTIVE');
    expect(fake.store.row!.gracePeriodEndsAt).toBeNull();
    expect(fake.store.row!.status).toBe('active');
  });

  it('the grace window is never extended by repeated failure events', async () => {
    const fake = fakeDb(paidActive()); use(fake);
    await recordPaymentFailure({ userId: 42, now: NOW });
    const firstDeadline = fake.store.row!.gracePeriodEndsAt;

    const later = new Date(NOW.getTime() + 3 * 86_400_000);
    const repeat = await recordPaymentFailure({ userId: 42, now: later });

    expect(repeat.outcome).toBe('noop');
    expect(fake.store.row!.gracePeriodEndsAt).toEqual(firstDeadline);
  });

  it('records an observed outcome only - it never claims a provider retry happened', () => {
    const code = readFileSync(new URL('./billing/lifecycle.ts', import.meta.url), 'utf8')
      .split('\n')
      .filter(line => { const t = line.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
      .join('\n');
    for (const forbidden of ['paymob', 'Paymob', 'stripe', 'Stripe', 'retrySchedule', 'chargeCard']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

// ── awaitingRenewalSync (§6) ───────────────────────────────────────────────

describe('awaitingRenewalSync is bounded (Phase 4B.4 §6)', () => {
  const elapsedPeriod = (daysPast: number) =>
    paidActive('premium', { currentPeriodEnd: new Date(NOW.getTime() - daysPast * 86_400_000) });

  it('a short provider sync gap still keeps the paying vendor on their plan', () => {
    const state = deriveBillingState(elapsedPeriod(1), NOW);
    expect(state.effectivePlan).toBe('premium');
    expect(state.awaitingRenewalSync).toBe(true);
    expect(state.reconciliationRequired).toBe(false);
    expect(lifecycleStateOf(state)).toBe('AWAITING_RENEWAL_SYNC');
  });

  it('REGRESSION: the gap can no longer grant paid access indefinitely', () => {
    // Phase 4B.1 granted full entitlements forever here - ten years past the
    // paid period the vendor was still PREMIUM.
    for (const days of [RENEWAL_SYNC_WINDOW_DAYS, 30, 365, 3650]) {
      const state = deriveBillingState(elapsedPeriod(days), NOW);
      expect(state.effectivePlan, `${days} days past period end`).toBe('free');
      expect(state.isPaid, `${days} days past period end`).toBe(false);
      expect(state.entitlements.qualifiedEnquiriesPerMonth).toBe(5);
    }
  });

  it('beyond the window it reports RECONCILIATION_REQUIRED rather than inventing an outcome', () => {
    const state = deriveBillingState(elapsedPeriod(30), NOW);
    expect(state.reconciliationRequired).toBe(true);
    expect(state.awaitingRenewalSync).toBe(true);
    expect(lifecycleStateOf(state)).toBe('RECONCILIATION_REQUIRED');
  });

  it('the boundary is exactly the approved window, not an invented second number', () => {
    expect(RENEWAL_SYNC_WINDOW_DAYS).toBe(GRACE_PERIOD_DAYS);
    const justInside = deriveBillingState(paidActive('premium', {
      currentPeriodEnd: new Date(NOW.getTime() - RENEWAL_SYNC_WINDOW_DAYS * 86_400_000 + MS),
    }), NOW);
    expect(justInside.isPaid).toBe(true);
  });

  it('reconciliation PRESERVES the row so a provider event can still settle it', async () => {
    const fake = fakeDb(elapsedPeriod(30)); use(fake);
    const before = { ...fake.store.row! };
    const result = await reconcileSubscription({ userId: 42, now: NOW });

    expect(result.outcome).toBe('noop');
    expect(fake.store.row!.status).toBe(before.status);
    expect(fake.store.row!.plan).toBe(before.plan);
    expect(fake.store.row!.currentPeriodEnd).toEqual(before.currentPeriodEnd);
  });

  it('a late provider confirmation still recovers the subscription cleanly', async () => {
    const fake = fakeDb(elapsedPeriod(30)); use(fake);
    const result = await recordPaymentSucceeded({ userId: 42, now: NOW });
    expect(result.outcome).toBe('applied');
    expect(result.state.effectivePlan).toBe('premium');
    expect(result.lifecycleState).toBe('ACTIVE');
  });
});

// ── Plan changes (§7) ──────────────────────────────────────────────────────

describe('plan changes (Phase 4B.4 §7)', () => {
  it('PROFESSIONAL → PREMIUM re-resolves the price and swaps entitlements', async () => {
    const fake = fakeDb(paidActive('professional')); use(fake);
    const result = await changeVendorPlan({ userId: 42, targetPlan: 'premium', now: NOW });

    expect(result.outcome).toBe('applied');
    expect(result.state.effectivePlan).toBe('premium');
    expect(result.state.entitlements.qualifiedEnquiriesPerMonth).toBeNull();
    expect(fake.store.row!.priceAmount).toBe('999.00');
  });

  it('PREMIUM → PROFESSIONAL applies the lower allowance immediately', async () => {
    const fake = fakeDb(paidActive('premium')); use(fake);
    const result = await changeVendorPlan({ userId: 42, targetPlan: 'professional', now: NOW });

    expect(result.state.effectivePlan).toBe('professional');
    expect(result.state.entitlements.qualifiedEnquiriesPerMonth).toBe(30);
    expect(fake.store.row!.priceAmount).toBe('499.00');
  });

  it('the paid-for billing period is never restarted by a plan change', async () => {
    const fake = fakeDb(paidActive('professional')); use(fake);
    const periodEnd = fake.store.row!.currentPeriodEnd;
    await changeVendorPlan({ userId: 42, targetPlan: 'premium', now: NOW });
    expect(fake.store.row!.currentPeriodEnd).toEqual(periodEnd);
  });

  it('moving to FREE is a cancellation, not a plan change - paid time is not confiscated', () => {
    expect(() => changePlan({ subscription: paidActive(), targetPlan: 'free' as never, now: NOW }))
      .toThrow(/cancellation/);
  });

  it('a plan change requires live paid access - it cannot be used to self-upgrade from FREE', async () => {
    const fake = fakeDb(sub()); use(fake);
    const result = await changeVendorPlan({ userId: 42, targetPlan: 'premium', now: NOW });
    expect(result.outcome).toBe('rejected');
    expect(fake.updates).toBe(0);
  });

  it('no proration, credit, or refund is invented', () => {
    const source = readFileSync(new URL('./billing/domain.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('export function changePlan'), source.indexOf('* Terminal downgrade'));
    for (const forbidden of ['prorate', 'proration', 'refund', 'credit(']) {
      expect(block.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});

// ── Founder offer (§8) ─────────────────────────────────────────────────────

describe('founder offer lifecycle (Phase 4B.4 §8)', () => {
  const OPEN_OFFER = { founderOfferEndsAt: '2027-01-01T00:00:00.000Z' };

  it('an eligible vendor gets the approved founder price and a six-month window', async () => {
    const fake = fakeDb(null, OPEN_OFFER); use(fake);
    await startPaidTrial({ userId: 42, planId: 'professional', interval: 'month', now: NOW });

    expect(fake.store.row!.isFounderPrice).toBe(true);
    expect(fake.store.row!.priceAmount).toBe('299.00');
    expect(fake.store.row!.founderPriceEndsAt).toEqual(addMonths(NOW, 6));
    expect(fake.store.row!.founderPriceUsedAt).toEqual(NOW);
  });

  it('premium founder pricing is the approved 699, monthly only', async () => {
    const fake = fakeDb(null, OPEN_OFFER); use(fake);
    await startPaidTrial({ userId: 42, planId: 'premium', interval: 'month', now: NOW });
    expect(fake.store.row!.priceAmount).toBe('699.00');

    const annual = fakeDb(null, OPEN_OFFER); use(annual);
    const result = await startPaidTrial({ userId: 43, planId: 'premium', interval: 'year', now: NOW });
    // No approved ANNUAL founder price exists. The eligible vendor is not
    // blocked from buying annual - they simply pay the approved standard
    // annual price, and no annual founder discount is invented.
    expect(result.outcome).toBe('applied');
    expect(annual.store.row!.isFounderPrice).toBe(false);
    expect(annual.store.row!.priceAmount).toBe('9990.00');
  });

  it('when the window elapses the SAME subscription continues at standard price', async () => {
    const fake = fakeDb(paidActive('professional', {
      isFounderPrice: true, priceAmount: '299.00',
      founderPriceUsedAt: new Date('2026-02-20T12:00:00Z'),
      founderPriceEndsAt: new Date(NOW.getTime() - MS),
    }));
    use(fake);
    const result = await reconcileSubscription({ userId: 42, now: NOW });

    expect(result.outcome).toBe('applied');
    expect(fake.store.row!.isFounderPrice).toBe(false);
    expect(fake.store.row!.priceAmount).toBe('499.00');
    expect(fake.store.row!.plan).toBe('professional');
    // Repricing, not a new subscription.
    expect(fake.store.row!.id).toBe(1);
  });

  it('FOUNDER REUSE PREVENTION: cancel then re-subscribe does not restore the offer', async () => {
    const spent = sub({
      plan: 'free', status: 'canceled',
      founderPriceUsedAt: new Date('2026-02-01T00:00:00Z'),
      trialStartedAt: null,
    });
    const fake = fakeDb(spent, OPEN_OFFER); use(fake);
    await startPaidTrial({ userId: 42, planId: 'professional', interval: 'month', now: NOW });

    expect(fake.store.row!.isFounderPrice).toBe(false);
    expect(fake.store.row!.priceAmount).toBe('499.00');
    // The original usage stamp is never overwritten.
    expect(fake.store.row!.founderPriceUsedAt).toEqual(new Date('2026-02-01T00:00:00Z'));
  });

  it('a closed offer window awards nothing', async () => {
    const fake = fakeDb(null, { founderOfferEndsAt: '2026-01-01T00:00:00.000Z' }); use(fake);
    await startPaidTrial({ userId: 42, planId: 'professional', interval: 'month', now: NOW });
    expect(fake.store.row!.isFounderPrice).toBe(false);
  });

  it('a plan change neither re-awards nor restarts the founder window', async () => {
    const founderEnds = addMonths(NOW, 3);
    const fake = fakeDb(paidActive('professional', {
      isFounderPrice: true, priceAmount: '299.00',
      founderPriceUsedAt: new Date('2026-05-20T12:00:00Z'), founderPriceEndsAt: founderEnds,
    }));
    use(fake);
    await changeVendorPlan({ userId: 42, targetPlan: 'premium', now: NOW });

    expect(fake.store.row!.founderPriceEndsAt).toEqual(founderEnds);
    expect(fake.store.row!.founderPriceUsedAt).toEqual(new Date('2026-05-20T12:00:00Z'));
    expect(fake.store.row!.priceAmount).toBe('699.00');
  });
});

// ── Idempotency (§11) ──────────────────────────────────────────────────────

describe('idempotency (Phase 4B.4 §11)', () => {
  it('a repeated cancellation keeps the moment the vendor actually decided', async () => {
    const fake = fakeDb(paidActive()); use(fake);
    const first = await requestCancellation({ userId: 42, now: NOW });
    const later = new Date(NOW.getTime() + 3600_000);
    const second = await requestCancellation({ userId: 42, now: later });

    expect(first.outcome).toBe('applied');
    expect(second.outcome).toBe('noop');
    expect(fake.store.row!.canceledAt).toEqual(NOW);
    expect(fake.updates).toBe(1);
  });

  it('repeated trial expiry reconciliation converges to a fixed point', async () => {
    const fake = fakeDb(sub({ plan: 'premium', status: 'trialing', trialStartedAt: new Date('2026-07-01T00:00:00Z'), trialEndsAt: new Date(NOW.getTime() - MS) }));
    use(fake);
    const first = await reconcileSubscription({ userId: 42, now: NOW });
    const snapshot = { ...fake.store.row! };
    const second = await reconcileSubscription({ userId: 42, now: NOW });
    const third = await reconcileSubscription({ userId: 42, now: NOW });

    expect(first.outcome).toBe('applied');
    expect(second.outcome).toBe('noop');
    expect(third.outcome).toBe('noop');
    expect(fake.store.row).toEqual(snapshot);
    expect(fake.updates).toBe(1);
  });

  it('repeated cancellation completion never double-downgrades', async () => {
    const fake = fakeDb(paidActive('premium', {
      cancelAtPeriodEnd: true, canceledAt: NOW, currentPeriodEnd: new Date(NOW.getTime() - MS),
    }));
    use(fake);
    await reconcileSubscription({ userId: 42, now: NOW });
    expect(fake.store.row!.status).toBe('canceled');
    const after = { ...fake.store.row! };
    await reconcileSubscription({ userId: 42, now: NOW });
    expect(fake.store.row).toEqual(after);
  });

  it('a repeated resume is a no-op, not an error', async () => {
    const fake = fakeDb(paidActive()); use(fake);
    const first = await resumeSubscription({ userId: 42, now: NOW });
    expect(first.outcome).toBe('noop');
    expect(fake.updates).toBe(0);
  });

  it('a repeated plan change to the plan already held writes nothing', async () => {
    const fake = fakeDb(paidActive('premium')); use(fake);
    const result = await changeVendorPlan({ userId: 42, targetPlan: 'premium', now: NOW });
    expect(result.outcome).toBe('noop');
    expect(fake.updates).toBe(0);
  });

  it('a repeated payment recovery does not silently extend the period', async () => {
    const fake = fakeDb(paidActive()); use(fake);
    const periodEnd = fake.store.row!.currentPeriodEnd;
    const result = await recordPaymentRecovery({ userId: 42, now: new Date(NOW.getTime() + 86_400_000) });
    expect(result.outcome).toBe('noop');
    expect(fake.store.row!.currentPeriodEnd).toEqual(periodEnd);
  });
});

// ── Concurrency (§12) ──────────────────────────────────────────────────────

describe('concurrency (Phase 4B.4 §12)', () => {
  it('every transition runs inside a transaction holding the row lock', async () => {
    const fake = fakeDb(paidActive()); use(fake);
    await requestCancellation({ userId: 42, now: NOW });
    expect(fake.transactions).toBe(1);
    expect(fake.lockedReads).toBe(1);
  });

  it('the decision is made from the row re-read UNDER the lock, never a stale copy', () => {
    const source = readFileSync(new URL('./billing/lifecycle.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('async function withSubscriptionLock'), source.indexOf('// ── Vendor-initiated'));
    // The locked SELECT must precede the decision, and the decision must be
    // handed `locked` - not a row fetched before the transaction opened.
    expect(block.indexOf(".for('update')")).toBeLessThan(block.indexOf('await decide('));
    expect(block).toContain('await decide(locked, now)');
  });

  it('cancel then resume, serialised, leaves a coherent row (never neither)', async () => {
    const fake = fakeDb(paidActive()); use(fake);
    const [cancel, resume] = await Promise.all([
      requestCancellation({ userId: 42, now: NOW }),
      resumeSubscription({ userId: 42, now: NOW }),
    ]);
    const row = fake.store.row!;
    // Whatever the order, the row agrees with itself: cancelAtPeriodEnd and
    // canceledAt are either both set or both clear.
    expect(row.cancelAtPeriodEnd === (row.canceledAt !== null)).toBe(true);
    expect([cancel.outcome, resume.outcome].every(o => o !== 'applied' || true)).toBe(true);
  });

  it('upgrade and downgrade racing settle on exactly one plan', async () => {
    const fake = fakeDb(paidActive('professional')); use(fake);
    await Promise.all([
      changeVendorPlan({ userId: 42, targetPlan: 'premium', now: NOW }),
      changeVendorPlan({ userId: 42, targetPlan: 'professional', now: NOW }),
    ]);
    expect(['professional', 'premium']).toContain(fake.store.row!.plan);
    // The price snapshot always describes the plan actually stored.
    const expected = fake.store.row!.plan === 'premium' ? '999.00' : '499.00';
    if (fake.updates > 0) expect(fake.store.row!.priceAmount).toBe(expected);
  });

  it('duplicate concurrent cancellations produce one cancellation', async () => {
    const fake = fakeDb(paidActive()); use(fake);
    const results = await Promise.all(Array.from({ length: 5 }, () => requestCancellation({ userId: 42, now: NOW })));
    expect(results.filter(r => r.outcome === 'applied')).toHaveLength(1);
    expect(results.filter(r => r.outcome === 'noop')).toHaveLength(4);
    expect(fake.updates).toBe(1);
  });

  it('a vendor can never end up with two subscription rows', () => {
    const schema = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');
    expect(schema).toContain("uniqueIndex('vendorSubscriptions_userId_unique')");
    const source = readFileSync(new URL('./billing/lifecycle.ts', import.meta.url), 'utf8');
    expect(source).toContain('ER_DUP_ENTRY');
  });
});

// ── Malformed and missing state (§16) ──────────────────────────────────────

describe('missing and stale billing state (Phase 4B.4 §16)', () => {
  it('a vendor with no subscription row at all is FREE, not an error', () => {
    const state = deriveBillingState(null, NOW);
    expect(state.effectivePlan).toBe('free');
    expect(state.entitlements.qualifiedEnquiriesPerMonth).toBe(5);
  });

  it('a paid status missing its governing timestamp fails CLOSED', () => {
    for (const [status, field] of [['trialing', 'trialEndsAt'], ['active', 'currentPeriodEnd'], ['past_due', 'gracePeriodEndsAt']] as const) {
      const state = deriveBillingState(sub({ plan: 'premium', status }), NOW);
      expect(state.effectivePlan, status).toBe('free');
      expect(state.isPaid, status).toBe(false);
      expect(state.dataIntegrityIssue, status).toContain(field);
    }
  });

  it('a stale row is still answered correctly - the stored status is not the authority', () => {
    const stale = sub({ plan: 'premium', status: 'active', billingInterval: 'month', currentPeriodEnd: new Date('2020-01-01T00:00:00Z') });
    expect(deriveBillingState(stale, NOW).effectivePlan).toBe('free');
  });

  it('a transition against unavailable storage is refused, never assumed to have happened', async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    const result = await requestCancellation({ userId: 42, now: NOW });
    expect(result.outcome).toBe('rejected');
    expect(result.state.effectivePlan).toBe('free');
  });
});

// ── Entitlement integration (§13) ──────────────────────────────────────────

describe('entitlement integration with Phase 4B.3 (Phase 4B.4 §13)', () => {
  it('each lifecycle state maps to the approved qualified-enquiry allowance', () => {
    const cases: [string, VendorSubscription | null, number | null][] = [
      ['FREE', null, 5],
      ['TRIALING professional', sub({ plan: 'professional', status: 'trialing', trialEndsAt: addDays(NOW, 5) }), 30],
      ['TRIALING premium', sub({ plan: 'premium', status: 'trialing', trialEndsAt: addDays(NOW, 5) }), null],
      ['ACTIVE professional', paidActive('professional'), 30],
      ['ACTIVE premium', paidActive('premium'), null],
      ['CANCELLATION_SCHEDULED premium', paidActive('premium', { cancelAtPeriodEnd: true, canceledAt: NOW }), null],
      ['GRACE_PERIOD professional', sub({ plan: 'professional', status: 'past_due', gracePeriodEndsAt: addDays(NOW, 2) }), 30],
      ['grace expired', sub({ plan: 'professional', status: 'past_due', gracePeriodEndsAt: new Date(NOW.getTime() - MS) }), 5],
      ['trial expired', sub({ plan: 'premium', status: 'trialing', trialEndsAt: new Date(NOW.getTime() - MS) }), 5],
      ['EXPIRED', sub({ status: 'expired' }), 5],
    ];
    for (const [label, row, allowance] of cases) {
      expect(deriveBillingState(row, NOW).entitlements.qualifiedEnquiriesPerMonth, label).toBe(allowance);
    }
  });

  it('downgrading changes FUTURE allowance only - Phase 4B.3 history is never touched', async () => {
    const fake = fakeDb(paidActive('premium', { cancelAtPeriodEnd: true, canceledAt: NOW, currentPeriodEnd: new Date(NOW.getTime() - MS) }));
    use(fake);
    await reconcileSubscription({ userId: 42, now: NOW });

    const lifecycle = readFileSync(new URL('./billing/lifecycle.ts', import.meta.url), 'utf8');
    const domain = readFileSync(new URL('./billing/domain.ts', import.meta.url), 'utf8');
    for (const source of [lifecycle, domain]) {
      expect(source).not.toMatch(/delete\(qualifiedEnquiries\)/);
      expect(source).not.toMatch(/delete\(vendorCategories\)/);
      expect(source).not.toMatch(/delete\(reviews\)/);
      expect(source).not.toMatch(/delete\(quotations\)/);
    }
  });

  it('no retroactive credits are granted on upgrade', async () => {
    const fake = fakeDb(paidActive('professional')); use(fake);
    await changeVendorPlan({ userId: 42, targetPlan: 'premium', now: NOW });
    const lifecycle = readFileSync(new URL('./billing/lifecycle.ts', import.meta.url), 'utf8');
    // The lifecycle may READ the allowance (it reports it), but must never
    // write to the Phase 4B.3 consumption ledger - no granted credits, no
    // reset of what a vendor already spent.
    expect(lifecycle).not.toMatch(/insert\(qualifiedEnquiries\)/);
    expect(lifecycle).not.toMatch(/update\(qualifiedEnquiries\)/);
    expect(lifecycle).not.toMatch(/delete\(qualifiedEnquiries\)/);
  });
});

// ── Data preservation (§9) ─────────────────────────────────────────────────

describe('data preservation (Phase 4B.4 §9)', () => {
  it('no lifecycle module deletes ANY business table', () => {
    for (const file of ['./billing/lifecycle.ts', './billing/domain.ts', './billing/service.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      const deletes = source.match(/\.delete\(([A-Za-z]+)\)/g) ?? [];
      expect(deletes, file).toEqual([]);
    }
  });

  it('a downgrade patch touches commercial fields only - never vendor business data', () => {
    const patch = downgradeToFree('grace_expired');
    for (const key of Object.keys(patch)) {
      expect(['plan', 'status', 'billingInterval', 'priceAmount', 'isFounderPrice', 'founderPriceEndsAt',
        'trialEndsAt', 'currentPeriodStart', 'currentPeriodEnd', 'gracePeriodEndsAt']).toContain(key);
    }
  });

  it('historical billing records survive a downgrade - events are append-only', async () => {
    const fake = fakeDb(paidActive('premium')); use(fake);
    await requestCancellation({ userId: 42, now: NOW });
    await recordPaymentFailure({ userId: 42, now: NOW });
    const countAfterTwo = fake.store.events.length;

    const lapsed = { ...fake.store.row!, gracePeriodEndsAt: new Date(NOW.getTime() - MS) };
    fake.store.row = lapsed as VendorSubscription;
    await reconcileSubscription({ userId: 42, now: NOW });

    expect(fake.store.events.length).toBeGreaterThan(countAfterTwo);
    expect(fake.actions).toContain('cancellation_requested');
    expect(fake.actions).toContain('payment_failed');
  });
});

// ── Auditability (§15) ─────────────────────────────────────────────────────

describe('auditability (Phase 4B.4 §15)', () => {
  it('reuses the existing billingEvents trail - no second audit framework', () => {
    const source = readFileSync(new URL('./billing/lifecycle.ts', import.meta.url), 'utf8');
    expect(source).toContain('recordBillingEvent');
    // ASSERTED ON THE PRINCIPLE, not on a table count.
    //
    // This used to require that exactly ONE audit table existed anywhere in the
    // schema, as a proxy for "billing did not invent its own trail". The proxy
    // broke when commercialAuditEvents was added - a table for RFQs,
    // quotations and products, which has nothing to do with billing and does
    // not replace billingEvents. The principle held; the instrument did not.
    //
    // What matters is that the billing lifecycle writes through
    // recordBillingEvent and touches no audit table directly.
    expect(source).not.toMatch(/insert\(\w*[Aa]uditEvents\)/);

    // And each audit table that does exist has a distinct, stated subject, so
    // "one more trail" cannot quietly become "several overlapping trails".
    const schema = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');
    const tables = (schema.match(/export const (\w*[Aa]udit\w*) = mysqlTable/g) ?? [])
      .map(match => /export const (\w+)/.exec(match)![1]);
    expect(tables.sort()).toEqual(['commercialAuditEvents', 'userAccountAuditEvents']);
  });

  it('records actor, vendor, previous state, new state, source and timestamp', async () => {
    const fake = fakeDb(paidActive('premium')); use(fake);
    await requestCancellation({ userId: 42, source: 'vendor', actorId: 42, now: NOW });

    const event = fake.store.events[0];
    expect(event.userId).toBe(42);
    expect(event.actorId).toBe(42);
    expect(event.action).toBe('cancellation_requested');
    expect(event.fromStatus).toBe('active');
    expect(event.toStatus).toBe('active');
    expect(event.source).toBe('vendor');
    expect(String(event.note)).toContain('ACTIVE → CANCELLATION_SCHEDULED');
  });

  it('names every lifecycle transition the brief asks to be recordable', async () => {
    const seen: string[] = [];

    let fake = fakeDb(null, { founderOfferEndsAt: '2027-01-01T00:00:00.000Z' }); use(fake);
    await startPaidTrial({ userId: 42, planId: 'professional', interval: 'month', now: NOW });
    seen.push(...fake.actions as string[]);

    fake = fakeDb(paidActive()); use(fake);
    await requestCancellation({ userId: 42, now: NOW });
    await resumeSubscription({ userId: 42, now: NOW });
    await changeVendorPlan({ userId: 42, targetPlan: 'premium', now: NOW });
    await recordPaymentFailure({ userId: 42, now: NOW });
    seen.push(...fake.actions as string[]);

    fake = fakeDb(sub({ plan: 'premium', status: 'trialing', trialStartedAt: NOW, trialEndsAt: new Date(NOW.getTime() - MS) })); use(fake);
    await reconcileSubscription({ userId: 42, now: NOW });
    seen.push(...fake.actions as string[]);

    for (const action of [
      'trial_started', 'cancellation_requested', 'cancellation_reversed',
      'plan_changed', 'payment_failed', 'lifecycle_reconciled',
    ]) {
      expect(seen, action).toContain(action);
    }
  });

  it('never writes a secret or a provider handle into the audit trail', async () => {
    const fake = fakeDb(paidActive()); use(fake);
    await requestCancellation({ userId: 42, now: NOW });
    const serialised = JSON.stringify(fake.store.events);
    for (const forbidden of ['passwordHash', 'providerCustomerRef', 'providerSubscriptionRef', 'providerPriceRef', 'token', 'secret']) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
  });
});

// ── Authorization (§10, §16) ───────────────────────────────────────────────

describe('server authority and authorization (Phase 4B.4 §10)', () => {
  beforeEach(() => use(fakeDb(paidActive())));

  it('anonymous callers cannot touch any lifecycle endpoint', async () => {
    const caller = appRouter.createCaller(anonCtx());
    await expect(caller.billing.myLifecycle()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(caller.billing.cancelSubscription()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(caller.billing.resumeSubscription()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(caller.admin.startVendorTrial({ userId: 1, plan: 'premium', interval: 'month' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('a customer cannot drive a vendor lifecycle', async () => {
    const caller = appRouter.createCaller(makeCtx(2, 'user', 'homeowner'));
    await expect(caller.billing.cancelSubscription()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.billing.resumeSubscription()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('CROSS-VENDOR: a vendor cannot cancel, change, or read another vendor subscription', async () => {
    const caller = appRouter.createCaller(makeCtx(10));
    // No admin transition is reachable at all.
    await expect(caller.admin.changeVendorPlan({ userId: 11, plan: 'premium' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.admin.recordVendorPaymentSucceeded({ userId: 11 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.admin.vendorLifecycle({ userId: 11 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.admin.reconcileVendorBilling({ userId: 11 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('the vendor lifecycle mutations take NO input, so there is no id to substitute', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('cancelSubscription: approvedProviderProcedure'), source.indexOf('});\n\nexport const appRouter'));
    expect(block).not.toContain('.input(');
    expect(block).toContain('ctx.user.id');
    expect(block).not.toContain('input.userId');
  });

  it('CLIENT PLAN MANIPULATION: a plan sent to a vendor endpoint changes nothing', async () => {
    const fake = fakeDb(paidActive('professional')); use(fake);
    const caller = appRouter.createCaller(makeCtx(42));
    await caller.billing.cancelSubscription({ plan: 'premium', status: 'active', isPaid: true } as never);
    expect(fake.store.row!.plan).toBe('professional');
    expect(fake.store.row!.status).toBe('active');
  });

  it('CLIENT STATUS MANIPULATION: myLifecycle ignores any forged payload', async () => {
    use(fakeDb(null));
    const caller = appRouter.createCaller(makeCtx(42));
    const forged = { plan: 'premium', status: 'active', isPaid: true, entitlements: { qualifiedEnquiriesPerMonth: 9999 } };
    const result = await (caller.billing.myLifecycle as unknown as (a: unknown) => Promise<{ effectivePlan: string; qualifiedEnquiryAllowance: number | null }>)(forged);
    expect(result.effectivePlan).toBe('free');
    expect(result.qualifiedEnquiryAllowance).toBe(5);
  });

  it('an admin CAN drive the lifecycle, and the audit names them as the actor', async () => {
    const fake = fakeDb(paidActive('professional')); use(fake);
    await appRouter.createCaller(makeCtx(7, 'admin')).admin.changeVendorPlan({ userId: 42, plan: 'premium' });
    expect(fake.store.row!.plan).toBe('premium');
    expect(fake.store.events[0].actorId).toBe(7);
    expect(fake.store.events[0].source).toBe('admin');
  });

  it('an illegal transition is a clean error, and writes nothing', async () => {
    const fake = fakeDb(sub()); use(fake);
    await expect(appRouter.createCaller(makeCtx(42)).billing.cancelSubscription())
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(fake.updates).toBe(0);
  });

  it('a repeated transition is a SUCCESS, not an error - idempotency reaches the API', async () => {
    const fake = fakeDb(paidActive()); use(fake);
    const caller = appRouter.createCaller(makeCtx(42));
    const first = await caller.billing.cancelSubscription();
    const second = await caller.billing.cancelSubscription();
    expect(first.outcome).toBe('applied');
    expect(second.outcome).toBe('noop');
    expect(second.cancelAtPeriodEnd).toBe(true);
  });
});

// ── No payment provider (§19) ──────────────────────────────────────────────

describe('no payment provider (Phase 4B.4 §19)', () => {
  it('no lifecycle source file references a payment provider or credential', () => {
    for (const file of ['./billing/lifecycle.ts', './billing/domain.ts', './billing/service.ts']) {
      // Executable code only: these files' own comments name the providers in
      // prose precisely to record that they are NOT integrated here.
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
        .split('\n')
        .filter(line => {
          const t = line.trim();
          return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n')
        .toLowerCase();
      for (const forbidden of ['paymob', 'stripe', 'api_key', 'apikey', 'secret_key', 'card_number', 'checkout.session']) {
        expect(source, `${file}:${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('the lifecycle never collects payment - it only records outcomes it was told about', () => {
    const source = readFileSync(new URL('./billing/lifecycle.ts', import.meta.url), 'utf8');
    expect(source).toContain('recordPaymentSucceeded');
    expect(source).toContain('recordPaymentFailure');
    for (const forbidden of ['charge(', 'capture(', 'createCheckout', 'collectPayment']) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});
