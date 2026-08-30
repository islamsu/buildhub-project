// ── SUPER ADMIN MANUAL PLAN / MEMBERSHIP CHANGE ────────────────────────────
//
// The capability exists because every route into a paid plan started from a
// payment, and BuildHub has no payment provider. A vendor who agreed a deal by
// bank transfer could not be given the plan by anybody: `changeVendorPlan`
// requires live paid access to change FROM, `startPaidTrial` burns the
// vendor's single lifetime trial, and `activate` needs a plan already chosen.
//
// What that meant in practice is worth stating plainly, because it is the
// thing these tests defend against returning: the only remaining lever was a
// database console, where there is no reason recorded, no audit trail, no
// notification, no lock, and nothing stopping a typo from granting a plan
// nobody approved.
//
// So the tests below are organised around the four properties that make this
// different from that:
//
//   1. it goes through the ENGINE - the same locked transition path
//   2. only the roles the existing model already trusts with billing can call it
//   3. every applied change leaves three records, and a REASON
//   4. a change that did not happen tells nobody it did

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';
import { BillingDomainError, grantPaidAccess } from './billing/domain';
import { setVendorPlanManually } from './billing/lifecycle';
import { analyticsEventFor } from './billing/service';
import { ANALYTICS_EVENTS } from '../shared/analyticsEvents';
import {
  analyticsEvents, notifications, userAccountAuditEvents, fieldValueHistory, users,
  vendorSubscriptions, billingEvents,
} from '../drizzle/schema';
import { ADMIN_ROLE_PERMISSIONS, type AdminRole } from '../shared/adminRoles';
import { PLAN_IDS, resolvePrice } from '../shared/billing';

// ── Contexts ───────────────────────────────────────────────────────────────

function makeCtx(overrides: Record<string, unknown>): TrpcContext {
  return {
    user: {
      id: 900,
      openId: 'user-900',
      email: 'actor@test.com',
      name: 'Actor',
      loginMethod: 'dummy',
      role: 'user',
      adminRole: null,
      userRole: 'contractor',
      accountStatus: 'active',
      onboardingStatus: 'approved',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      ...overrides,
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: {} as TrpcContext['res'],
  };
}

const adminCtx = (adminRole: AdminRole) => makeCtx({ role: 'admin', adminRole });
const anonCtx = (): TrpcContext =>
  ({ user: null, req: { protocol: 'https', headers: {} } as TrpcContext['req'], res: {} as TrpcContext['res'] });

// ── A recording double ─────────────────────────────────────────────────────
//
// Records every insert BY TABLE, so a test can ask "was a notification
// written" rather than "was insert called" - the distinction that catches a
// change writing the audit row and skipping the notification, or the reverse.

type Recorded = { table: unknown; values: unknown };

function makeDb(options: {
  targetUser?: Record<string, unknown> | null;
  subscription?: Record<string, unknown> | null;
} = {}) {
  const inserts: Recorded[] = [];
  const updates: Recorded[] = [];
  const target = options.targetUser === undefined
    ? { id: 42, userRole: 'supplier' }
    : options.targetUser;
  // MUTABLE, because the procedure re-reads the row after the engine writes it
  // and words the vendor's message from what the row now says. A double that
  // silently kept returning the pre-update row made the message describe a
  // change that had not been applied - which is exactly the class of bug these
  // tests exist to catch, so the double has to model the write rather than the
  // assertions being lowered to accommodate it.
  const subscription: Record<string, unknown> | null = options.subscription === undefined
    ? { id: 7, userId: 42, plan: 'free', status: 'free', billingInterval: null, priceAmount: null, isFounderPrice: false, founderPriceUsedAt: null, founderPriceEndsAt: null, trialStartedAt: null, trialEndsAt: null, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, canceledAt: null, gracePeriodEndsAt: null }
    : options.subscription === null ? null : { ...options.subscription };

  // A COPY PER QUERY, because that is what a real driver hands back. Returning
  // the canonical object made the "before" snapshot the engine takes under the
  // lock the SAME object the update then mutated, so the audit trail read
  // "premium -> premium" for a change out of free. The row the engine compares
  // against must be a materialised read, not a live reference.
  const rowsFor = (table: unknown): unknown[] => {
    if (table === users) return target ? [{ ...target }] : [];
    if (table === vendorSubscriptions) return subscription ? [{ ...subscription }] : [];
    return [];
  };

  const chain = (table: unknown): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      where: () => c, orderBy: () => c, limit: () => c, for: () => c,
      leftJoin: () => c, innerJoin: () => c, groupBy: () => c, offset: () => c,
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(rowsFor(table)).then(resolve, reject),
    };
    return c;
  };

  const db: Record<string, unknown> = {
    select: () => ({ from: (table: unknown) => chain(table) }),
    insert: (table: unknown) => ({
      values: async (values: unknown) => { inserts.push({ table, values }); },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: async () => {
          updates.push({ table, values });
          // Apply it, the way the database would.
          if (table === vendorSubscriptions && subscription) {
            Object.assign(subscription, values as Record<string, unknown>);
          }
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };

  return {
    db,
    inserts,
    updates,
    /** Every value object inserted into one table. */
    into: (table: unknown) => inserts.filter(row => row.table === table).map(row => row.values as Record<string, unknown>),
    /** Every patch applied to the subscription row. */
    patches: () => updates.filter(row => row.table === vendorSubscriptions).map(row => row.values as Record<string, unknown>),
  };
}

const PAID_PROFESSIONAL = {
  id: 7, userId: 42, plan: 'professional', status: 'active', billingInterval: 'month',
  priceAmount: '899.00', isFounderPrice: false, founderPriceUsedAt: null, founderPriceEndsAt: null,
  trialStartedAt: new Date('2025-01-01'), trialEndsAt: null,
  currentPeriodStart: new Date('2099-01-01'), currentPeriodEnd: new Date('2099-02-01'),
  cancelAtPeriodEnd: false, canceledAt: null, gracePeriodEndsAt: null,
};

// ── 1. The domain transition the engine was missing ────────────────────────

describe('grantPaidAccess - the transition that had no route', () => {
  it('grants the plan and opens a live billing period, so entitlements actually apply', () => {
    const now = new Date('2026-03-01T00:00:00Z');
    const patch = grantPaidAccess({ targetPlan: 'premium', interval: 'month', now });
    expect(patch.plan).toBe('premium');
    expect(patch.status).toBe('active');
    expect(patch.billingInterval).toBe('month');
    expect(patch.currentPeriodStart).toEqual(now);
    expect(patch.currentPeriodEnd).toBeInstanceOf(Date);
    expect((patch.currentPeriodEnd as Date).getTime()).toBeGreaterThan(now.getTime());
  });

  it('records the price as 0.00, not the catalogue price - the vendor agreed to pay nothing for a grant', () => {
    const patch = grantPaidAccess({ targetPlan: 'premium', interval: 'month' });
    expect(patch.priceAmount).toBe('0.00');
    // The catalogue price for a real premium subscription is a positive
    // number. Stamping it here would assert an agreement that does not exist.
    expect(Number(patch.priceAmount)).toBe(0);
  });

  it('does not consume the vendor\'s one lifetime trial - trialStartedAt is not in the patch at all', () => {
    const patch = grantPaidAccess({ targetPlan: 'professional', interval: 'month' });
    expect(Object.keys(patch)).not.toContain('trialStartedAt');
  });

  it('neither awards nor burns the founder offer - no founder column is touched', () => {
    const patch = grantPaidAccess({ targetPlan: 'professional', interval: 'year' });
    for (const key of ['isFounderPrice', 'founderPriceUsedAt', 'founderPriceEndsAt']) {
      expect(Object.keys(patch)).not.toContain(key);
    }
  });

  it('clears a pending cancellation, so a grant is not handed over already scheduled to end', () => {
    const patch = grantPaidAccess({ targetPlan: 'premium', interval: 'month' });
    expect(patch.cancelAtPeriodEnd).toBe(false);
    expect(patch.canceledAt).toBeNull();
  });

  it('refuses FREE, and says WHY - that it is a downgrade, not that the price is missing', () => {
    // TWO guards would refuse FREE: this one, and the catalogue check below,
    // since FREE has no price at any interval. Asserting only "it threw" is
    // satisfied by either, so it proves neither - the message is what pins the
    // guard that actually ran, and it is also the one that tells a caller what
    // to do instead.
    expect(() => grantPaidAccess({ targetPlan: 'free' as never, interval: 'month' }))
      .toThrow(/not a grant of paid access.*downgrade path/i);
  });

  /**
   * THE CATALOGUE GUARD IS NOT REACHABLE TODAY, and this test says so rather
   * than manufacturing a case that appears to exercise it.
   *
   * Every PAID plan is sold at both intervals, so no input the router can
   * legitimately send reaches the refusal - and an input the router CANNOT
   * send (an unknown plan id) crashes inside resolvePrice before the guard is
   * consulted, so testing with one would prove something about a code path
   * production cannot enter.
   *
   * What is worth asserting, and what this does assert, is the coupling: a
   * grant succeeds for exactly the combinations the catalogue prices. The day
   * a plan stops being sold at an interval, this fails and the guard starts
   * earning its place.
   */
  it('grants exactly the plan/interval combinations the catalogue actually prices', () => {
    for (const plan of PLAN_IDS) {
      for (const interval of ['month', 'year'] as const) {
        const sellable = resolvePrice(plan, interval, false) !== null;
        if (sellable) {
          expect(grantPaidAccess({ targetPlan: plan, interval }).plan).toBe(plan);
        } else {
          // Only FREE today, which the previous test shows is refused for
          // being a downgrade rather than for being unpriced.
          expect(plan).toBe('free');
        }
      }
    }
  });
});

// ── 2. The orchestration: which branch runs, and what it writes ────────────

describe('setVendorPlanManually - routed through the engine, never around it', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GRANTS paid access to a vendor on FREE - the case no other function in the engine could serve', async () => {
    const rec = makeDb();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);

    const outcome = await setVendorPlanManually({
      userId: 42, targetPlan: 'premium', reason: 'Agreed by bank transfer', actorId: 900,
    });

    expect(outcome.outcome).toBe('applied');
    const [patch] = rec.patches();
    expect(patch.plan).toBe('premium');
    expect(patch.status).toBe('active');
  });

  it('CHANGES an already-paid vendor between paid plans without restarting the period they paid for', async () => {
    const rec = makeDb({ subscription: PAID_PROFESSIONAL });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);

    const outcome = await setVendorPlanManually({
      userId: 42, targetPlan: 'premium', reason: 'Upgrade agreed', actorId: 900,
    });

    expect(outcome.outcome).toBe('applied');
    const [patch] = rec.patches();
    expect(patch.plan).toBe('premium');
    // changePlan deliberately leaves the period alone. A manual change is not
    // a licence to hand the vendor a fresh month they did not pay for.
    expect(Object.keys(patch)).not.toContain('currentPeriodStart');
    expect(Object.keys(patch)).not.toContain('currentPeriodEnd');
  });

  it('selecting FREE while paid access is LIVE schedules the end - it never revokes the period already paid for', async () => {
    const rec = makeDb({ subscription: PAID_PROFESSIONAL });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);

    const outcome = await setVendorPlanManually({
      userId: 42, targetPlan: 'free', reason: 'Vendor is leaving', actorId: 900,
    });

    expect(outcome.outcome).toBe('applied');
    const [patch] = rec.patches();
    expect(patch.cancelAtPeriodEnd).toBe(true);
    // THE POINT OF THIS TEST: the plan is NOT set to free today.
    expect(Object.keys(patch)).not.toContain('plan');
  });

  it('selecting the plan the vendor already has and is receiving writes NOTHING', async () => {
    const rec = makeDb({ subscription: PAID_PROFESSIONAL });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);

    const outcome = await setVendorPlanManually({
      userId: 42, targetPlan: 'professional', reason: 'No change intended', actorId: 900,
    });

    expect(outcome.outcome).toBe('noop');
    expect(rec.patches()).toEqual([]);
    expect(rec.into(billingEvents)).toEqual([]);
  });

  it('selecting FREE for a vendor already on FREE writes nothing and does not re-stamp a cancellation', async () => {
    const rec = makeDb();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);

    const outcome = await setVendorPlanManually({
      userId: 42, targetPlan: 'free', reason: 'Confirming free', actorId: 900,
    });

    expect(outcome.outcome).toBe('noop');
    expect(rec.patches()).toEqual([]);
  });

  it('an empty or whitespace-only reason is REFUSED, and nothing is written', async () => {
    const rec = makeDb();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);

    const outcome = await setVendorPlanManually({
      userId: 42, targetPlan: 'premium', reason: '   ', actorId: 900,
    });

    expect(outcome.outcome).toBe('rejected');
    expect(rec.patches()).toEqual([]);
  });

  it('carries the administrator\'s reason into billing history, where a dispute can find it', async () => {
    const rec = makeDb();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);

    await setVendorPlanManually({
      userId: 42, targetPlan: 'premium', reason: 'Compensation for the March outage', actorId: 900,
    });

    const [event] = rec.into(billingEvents);
    expect(event.action).toBe('plan_changed_manually');
    expect(event.source).toBe('admin');
    expect(event.actorId).toBe(900);
    expect(String(event.note)).toContain('Compensation for the March outage');
  });

  it('reports the plan the vendor held BEFORE, read from the locked row', async () => {
    const rec = makeDb({ subscription: PAID_PROFESSIONAL });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);

    const outcome = await setVendorPlanManually({
      userId: 42, targetPlan: 'premium', reason: 'Upgrade', actorId: 900,
    });

    expect(outcome.previousPlan).toBe('professional');
  });

  it('takes a row lock before deciding - the decision is made against the row as it is, not a stale read', async () => {
    const rec = makeDb();
    let lockedForUpdate = false;
    const original = rec.db.select as () => { from: (t: unknown) => Record<string, unknown> };
    rec.db.select = (...args: unknown[]) => {
      const built = (original as (...a: unknown[]) => { from: (t: unknown) => Record<string, unknown> })(...args);
      return {
        from: (table: unknown) => {
          const c = built.from(table);
          const forFn = c.for as () => unknown;
          c.for = (...a: unknown[]) => { if (table === vendorSubscriptions) lockedForUpdate = true; return (forFn as (...x: unknown[]) => unknown)(...a); };
          return c;
        },
      };
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);

    await setVendorPlanManually({ userId: 42, targetPlan: 'premium', reason: 'Grant', actorId: 900 });
    expect(lockedForUpdate).toBe(true);
  });
});

// ── 3. Who may call it ─────────────────────────────────────────────────────
//
// The permission is `billing.manage`. That is a reading of the EXISTING admin
// role model rather than a new rule - granting a plan is a billing operation,
// and the role whose whole purpose is billing already holds the permission to
// perform one. Everything below is derived from ADMIN_ROLE_PERMISSIONS, so if
// that table is ever rewritten these tests move with it rather than silently
// asserting a stale answer.

describe('admin.setVendorPlanManually - the permission boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  const input = { userId: 42, plan: 'premium' as const, reason: 'Agreed off-platform' };

  it.each([
    ['SUPER_ADMIN' as const],
    ['BILLING_ADMIN' as const],
  ])('%s holds billing.manage and is ALLOWED', async adminRole => {
    const rec = makeDb();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);
    const caller = appRouter.createCaller(adminCtx(adminRole));
    await expect(caller.admin.setVendorPlanManually(input)).resolves.toBeDefined();
  });

  it.each([
    ['USER_ADMIN' as const],
    ['MARKETPLACE_ADMIN' as const],
    ['SUPPORT_ADMIN' as const],
  ])('%s does NOT hold billing.manage and is REFUSED - and the refusal is the server\'s, not a hidden button', async adminRole => {
    const rec = makeDb();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);
    const caller = appRouter.createCaller(adminCtx(adminRole));
    await expect(caller.admin.setVendorPlanManually(input)).rejects.toThrow();
    // Refused BEFORE anything was written. A refusal that still changed the
    // subscription would be a refusal in name only.
    expect(rec.patches()).toEqual([]);
    expect(rec.into(notifications)).toEqual([]);
  });

  it('an ordinary vendor calling the API directly is REFUSED - a vendor cannot grant themselves a plan', async () => {
    const rec = makeDb();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);
    const caller = appRouter.createCaller(makeCtx({ id: 42, userRole: 'supplier' }));
    await expect(caller.admin.setVendorPlanManually(input)).rejects.toThrow();
    expect(rec.patches()).toEqual([]);
  });

  it('an anonymous caller is REFUSED', async () => {
    const rec = makeDb();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);
    const caller = appRouter.createCaller(anonCtx());
    await expect(caller.admin.setVendorPlanManually(input)).rejects.toThrow();
    expect(rec.patches()).toEqual([]);
  });

  it('a homeowner target is REFUSED - a plan they can never consume is not created for them', async () => {
    const rec = makeDb({ targetUser: { id: 42, userRole: 'homeowner' } });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);
    const caller = appRouter.createCaller(adminCtx('SUPER_ADMIN'));
    await expect(caller.admin.setVendorPlanManually(input))
      .rejects.toThrow(/provider accounts only/i);
    expect(rec.patches()).toEqual([]);
  });

  it('a target that does not exist is NOT FOUND, and nothing is written', async () => {
    const rec = makeDb({ targetUser: null });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);
    const caller = appRouter.createCaller(adminCtx('SUPER_ADMIN'));
    await expect(caller.admin.setVendorPlanManually(input)).rejects.toThrow();
    expect(rec.patches()).toEqual([]);
  });

  it('an empty reason is refused by the INPUT SCHEMA - the procedure body never runs, so the database is never even opened', async () => {
    const rec = makeDb();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);
    const caller = appRouter.createCaller(adminCtx('SUPER_ADMIN'));

    await expect(caller.admin.setVendorPlanManually({ ...input, reason: '   ' })).rejects.toThrow();

    // THIS IS THE ASSERTION THAT DISTINGUISHES THE TWO LAYERS. The engine
    // refuses an empty reason too, so "it threw" alone is satisfied by either
    // guard and proves neither. Zod refusing means the body never executed -
    // and the body's very first act is getDb(). Deleting the schema rule makes
    // this call happen, and this line is what notices.
    expect(getDb).not.toHaveBeenCalled();
    expect(rec.patches()).toEqual([]);
  });

  /**
   * THE `billing.read` / `billing.manage` DISTINCTION IS NOT OBSERVABLE TODAY,
   * and saying so is more useful than a test that pretends otherwise.
   *
   * Widening the procedure from `billing.manage` to `billing.read` changes the
   * answer for NO existing administrator: BILLING_ADMIN holds both, and no
   * other role holds either. A mutation test that flips the permission
   * therefore survives - correctly, because the two are equivalent under the
   * current role table, not because the boundary is untested.
   *
   * What this test does is arm the trap for the moment that stops being true.
   * The instant any role is given read-only billing access, this fails and
   * points at the procedure that would silently have widened with it.
   */
  it('no admin role holds billing.read WITHOUT billing.manage - the day one does, the manual plan change must be re-checked', () => {
    const readOnlyBilling = (Object.entries(ADMIN_ROLE_PERMISSIONS) as [AdminRole, readonly string[]][])
      .filter(([, permissions]) => permissions.includes('billing.read') && !permissions.includes('billing.manage'))
      .map(([role]) => role);

    expect(readOnlyBilling).toEqual([]);
  });

  it('the roles allowed here are exactly the roles holding billing.manage - derived from the table, never restated', () => {
    const allowed = (Object.entries(ADMIN_ROLE_PERMISSIONS) as [AdminRole, readonly string[]][])
      .filter(([, permissions]) => permissions.includes('billing.manage'))
      .map(([role]) => role)
      .sort();

    expect(allowed).toEqual(['BILLING_ADMIN', 'SUPER_ADMIN']);
  });
});

// ── 4. What an applied change leaves behind ────────────────────────────────

describe('admin.setVendorPlanManually - the records and the message', () => {
  beforeEach(() => vi.clearAllMocks());

  async function change(over: Record<string, unknown> = {}, dbOptions = {}) {
    const rec = makeDb(dbOptions);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);
    const caller = appRouter.createCaller(adminCtx('SUPER_ADMIN'));
    const result = await caller.admin.setVendorPlanManually({
      userId: 42, plan: 'premium', reason: 'Agreed by bank transfer', ...over,
    } as never);
    return { rec, result };
  }

  it('writes the ACCOUNT audit event, naming the actor, the target, both plans and the reason', async () => {
    const { rec } = await change();
    const [event] = rec.into(userAccountAuditEvents);
    expect(event).toMatchObject({ userId: 42, actorId: 900, action: 'plan_changed_manually', source: 'admin' });
    expect(String(event.note)).toContain('free');
    expect(String(event.note)).toContain('premium');
    expect(String(event.note)).toContain('Agreed by bank transfer');
  });

  it('writes the VALUE history row - old plan, new plan, and the reason on the row itself', async () => {
    const { rec } = await change();
    const [row] = rec.into(fieldValueHistory);
    expect(row).toMatchObject({
      subjectType: 'subscription', subjectId: 42, ownerId: 42, actorId: 900,
      field: 'plan', oldValue: 'free', newValue: 'premium', reason: 'Agreed by bank transfer',
    });
  });

  it('notifies the vendor, deep-linking to Plan & Billing rather than the top of a settings page', async () => {
    const { rec, result } = await change();
    const [notification] = rec.into(notifications);
    expect(notification.userId).toBe(42);
    expect(notification.link).toBe('/settings#settings-billing');
    expect(result.notified).toBe(true);
  });

  it('WORDS THE MESSAGE FROM THE PLAN THAT WAS ACTUALLY SELECTED - no plan name is hard-coded', async () => {
    const premium = await change({ plan: 'premium' });
    const professional = await change({ plan: 'professional' });

    const premiumParams = premium.rec.into(notifications)[0].messageParams as Record<string, string>;
    const professionalParams = professional.rec.into(notifications)[0].messageParams as Record<string, string>;

    expect(premiumParams.planKey).toBe('billing.plan.premium');
    expect(professionalParams.planKey).toBe('billing.plan.professional');
    // The two messages must differ in the plan they name. If a literal
    // "Premium" had been baked into the message, these would be equal.
    expect(premiumParams.planKey).not.toBe(professionalParams.planKey);
  });

  it('an UPGRADE and a DOWNGRADE are different messages, chosen from the plans, not from a guess', async () => {
    const up = await change({ plan: 'premium' });
    const down = await change({ plan: 'professional' }, { subscription: { ...PAID_PROFESSIONAL, plan: 'premium' } });

    expect(up.rec.into(notifications)[0].messageKey).toBe('notif.billing.plan.upgraded');
    expect(down.rec.into(notifications)[0].messageKey).toBe('notif.billing.plan.downgraded');
  });

  it('selecting FREE while paid access is live says the plan will NOT RENEW - never that it changed today', async () => {
    const { rec } = await change({ plan: 'free' }, { subscription: PAID_PROFESSIONAL });
    const [notification] = rec.into(notifications);
    expect(notification.messageKey).toBe('notif.billing.plan.scheduled');
  });

  it('A NO-OP NOTIFIES NOBODY AND RECORDS NOTHING - the vendor is not told about a change that did not happen', async () => {
    const rec = makeDb({ subscription: PAID_PROFESSIONAL });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(rec.db);
    const caller = appRouter.createCaller(adminCtx('SUPER_ADMIN'));

    const result = await caller.admin.setVendorPlanManually({
      userId: 42, plan: 'professional', reason: 'Selected the plan they already have',
    });

    expect(result.outcome).toBe('noop');
    expect(result.notified).toBe(false);
    expect(rec.into(notifications)).toEqual([]);
    expect(rec.into(userAccountAuditEvents)).toEqual([]);
    expect(rec.into(fieldValueHistory)).toEqual([]);
  });

  it('NEVER touches users.userRole - a membership is a subscription, not an identity', async () => {
    const { rec } = await change();
    expect(rec.updates.filter(row => row.table === users)).toEqual([]);
  });

  it('NEVER writes a qualifiedEnquiries row - usage already consumed this period stays consumed', async () => {
    const { rec } = await change();
    const tables = rec.inserts.map(row => row.table);
    expect(tables).toEqual(expect.arrayContaining([notifications, userAccountAuditEvents]));
    // The tables a manual plan change may write, and no other. `qualifiedEnquiries`
    // is conspicuously absent: consumption already recorded this period is never
    // reset, so a vendor who used 7 of 20 and is moved to a 50-lead plan has 43
    // remaining, not 50. A change that reset usage would have to insert there,
    // and this loop is what would catch it.
    const ALLOWED = [notifications, userAccountAuditEvents, fieldValueHistory, billingEvents, analyticsEvents];
    for (const table of tables) expect(ALLOWED).toContain(table);
  });

  it('puts no credential, token or reset secret in the notification payload', async () => {
    const { rec } = await change();
    const serialised = JSON.stringify(rec.into(notifications));
    for (const forbidden of ['password', 'passwordHash', 'token', 'secret', 'scrypt$', 'apiKey']) {
      expect(serialised.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

// ── 5. The analytics stream must not describe a sale that never happened ───

describe('analyticsEventFor - a manual grant is a plan change, never a renewal', () => {
  // THIS IS WHY THE TEST EXISTS. `plan_changed_manually` was a new action, and
  // the classifier's `default` branch reads any transition out of FREE into a
  // paid status as a RENEWAL. Every plan an administrator comped would have
  // been counted in the renewal KPI as revenue nobody paid - fabricated
  // business data, arrived at by omission rather than intent, which is the way
  // it usually arrives.
  //
  // Asserted against the pure classifier rather than against the row: the
  // analytics write is deliberately fire-and-forget, and a test that races an
  // async insert proves whichever answer it happened to observe.

  it('classifies a grant out of FREE as a plan change, not a renewal', () => {
    expect(analyticsEventFor({
      userId: 42, subscriptionId: 7, action: 'plan_changed_manually',
      fromStatus: 'free', toStatus: 'active', source: 'admin', actorId: 900,
    })).toBe(ANALYTICS_EVENTS.SUBSCRIPTION_PLAN_CHANGED);
  });

  it('classifies a manual move between paid plans as a plan change too', () => {
    expect(analyticsEventFor({
      userId: 42, subscriptionId: 7, action: 'plan_changed_manually',
      fromStatus: 'active', toStatus: 'active', source: 'admin', actorId: 900,
    })).toBe(ANALYTICS_EVENTS.SUBSCRIPTION_PLAN_CHANGED);
  });

  it('is NOT the renewal event, which is what the unhandled action resolved to', () => {
    const classified = analyticsEventFor({
      userId: 42, subscriptionId: 7, action: 'plan_changed_manually',
      fromStatus: 'free', toStatus: 'active', source: 'admin', actorId: 900,
    });
    expect(classified).not.toBe(ANALYTICS_EVENTS.SUBSCRIPTION_RENEWED);
    expect(classified).not.toBe(ANALYTICS_EVENTS.SUBSCRIPTION_ACTIVATED);
  });
});
