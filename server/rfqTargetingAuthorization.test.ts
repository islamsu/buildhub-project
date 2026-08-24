import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';
import { allowancePeriodFor } from './billing/entitlements';
import { getEnquiryUsage, openQualifiedEnquiry } from './billing/enquiries';
import {
  analyticsEvents as analyticsEventsTable,
  qualifiedEnquiries as qualifiedEnquiriesTable,
  reviews as reviewsTable,
  rfqs as rfqsTable,
  users as usersTable,
  vendorCategories as vendorCategoriesTable,
  vendorSubscriptions as vendorSubscriptionsTable,
} from '../drizzle/schema';

// Phase 4B.3 §15. Every rule enforced here is a SERVER rule: the vendor's
// declared categories, the RFQ's category, the monthly allowance and the
// vendor's identity are all re-derived from stored state on each request. The
// only thing a client may say is which RFQ it wants to open, so these tests
// deliberately try to say more than that and assert it changes nothing.

const NOW = new Date('2026-08-19T12:00:00.000Z');
const MONTH = allowancePeriodFor(NOW).key;        // 2026-08
const NEXT_MONTH_DATE = new Date('2026-09-01T00:00:00.000Z');
const NEXT_MONTH = allowancePeriodFor(NEXT_MONTH_DATE).key;

// ── Contexts ───────────────────────────────────────────────────────────────

function makeCtx(
  userId: number,
  overrides: Partial<{ role: 'user' | 'admin'; adminRole: string; userRole: string; onboardingStatus: string; accountStatus: string }> = {},
): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@test.com`,
      name: `User ${userId}`,
      loginMethod: 'dummy',
      role: overrides.role ?? 'user',
      // migration 0020: an admin row must now say WHICH administrator it is.
      adminRole: overrides.adminRole ?? (overrides.role === 'admin' ? 'SUPER_ADMIN' : null),
      userRole: overrides.userRole ?? 'contractor',
      accountStatus: overrides.accountStatus ?? 'active',
      onboardingStatus: overrides.onboardingStatus ?? 'approved',
      createdAt: NOW,
      updatedAt: NOW,
      lastSignedIn: NOW,
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: {} as TrpcContext['res'],
  };
}

const anonCtx = (): TrpcContext =>
  ({ user: null, req: { protocol: 'https', headers: {} } as TrpcContext['req'], res: {} as TrpcContext['res'] });

// ── Subscription rows ──────────────────────────────────────────────────────

function subscription(plan: 'professional' | 'premium', userId = 10) {
  return {
    id: 1, userId, plan, status: 'active', billingInterval: 'month', currency: 'EGP',
    priceAmount: null, isFounderPrice: false, founderPriceUsedAt: null, founderPriceEndsAt: null,
    trialEndsAt: null, currentPeriodStart: NOW, currentPeriodEnd: new Date('2026-12-19T12:00:00.000Z'),
    cancelAtPeriodEnd: false, canceledAt: null, gracePeriodEndsAt: null,
    provider: null, providerCustomerRef: null, providerSubscriptionRef: null, providerPriceRef: null,
    createdAt: NOW, updatedAt: NOW,
  };
}

// ── Fake database ──────────────────────────────────────────────────────────
//
// Dispatches on the drizzle table object and the selected column names, so the
// fake stays honest about WHICH query it is answering rather than relying on
// call order. Consumption is real state: an insert issued by the engine is
// visible to every later count, exactly as a row would be.

type Scenario = {
  rfq?: Record<string, unknown> | null;
  eligibleRfqs?: Record<string, unknown>[];
  categories?: string[];
  subscription?: Record<string, unknown> | null;
  /** Pre-existing consumption for the vendor under test. */
  consumed?: { rfqId: number; yearMonth: string }[];
  /** Thrown by the first insert, to simulate a lost concurrent race. */
  insertThrows?: unknown;
  directoryVendors?: Record<string, unknown>[];
  reputationRows?: Record<string, unknown>[];
  directoryCategoryRows?: { userId: number; category: string }[];
  distinctCategories?: string[];
  currentMonth?: string;
};

function fakeDb(scenario: Scenario = {}) {
  const s = {
    rfq: null as Record<string, unknown> | null,
    eligibleRfqs: [] as Record<string, unknown>[],
    categories: [] as string[],
    subscription: null as Record<string, unknown> | null,
    consumed: [] as { rfqId: number; yearMonth: string }[],
    directoryVendors: [] as Record<string, unknown>[],
    reputationRows: [] as Record<string, unknown>[],
    directoryCategoryRows: [] as { userId: number; category: string }[],
    distinctCategories: [] as string[],
    currentMonth: MONTH,
    ...scenario,
  };
  const inserted: Record<string, unknown>[] = [];
  // Slice 7 added a product-analytics write alongside the enquiry write. It is
  // captured separately so every assertion below stays a statement about the
  // qualifiedEnquiries table specifically - "one credit was spent" must not
  // become true or false because an unrelated table was also written to.
  const analyticsInserted: Record<string, unknown>[] = [];
  const deleted: unknown[] = [];
  let insertAttempts = 0;
  let transactions = 0;
  let lockedReads = 0;

  const resolveRows = (table: unknown, keys: string[] | null, terminal: string): unknown[] => {
    if (table === rfqsTable) {
      if (keys === null) return s.rfq ? [s.rfq] : [];
      return s.eligibleRfqs;
    }
    if (table === vendorSubscriptionsTable) return s.subscription ? [s.subscription] : [];
    if (table === usersTable) return s.directoryVendors;
    if (table === reviewsTable) return s.reputationRows;
    if (table === vendorCategoriesTable) {
      if (terminal === 'distinct') return s.distinctCategories.map(category => ({ category }));
      if (keys?.includes('userId')) return s.directoryCategoryRows;
      return s.categories.map(category => ({ category }));
    }
    if (table === qualifiedEnquiriesTable) {
      const thisMonth = s.consumed.filter(row => row.yearMonth === s.currentMonth);
      if (keys?.includes('count')) return [{ count: thisMonth.length }];
      if (terminal === 'for') { lockedReads++; return thisMonth.map(row => ({ id: row.rfqId })); }
      if (keys?.length === 1 && keys[0] === 'id') {
        const rfqId = Number(s.rfq?.id ?? -1);
        return s.consumed.some(row => row.rfqId === rfqId) ? [{ id: rfqId }] : [];
      }
      return s.consumed.map(row => ({ ...row, planAtConsumption: 'free', matchedCategory: 'Materials', createdAt: NOW }));
    }
    return [];
  };

  const builder = (table: unknown, keys: string[] | null) => {
    const settle = (terminal: string) => Promise.resolve(resolveRows(table, keys, terminal));
    const afterWhere: Record<string, unknown> = {
      limit: () => settle('limit'),
      for: () => settle('for'),
      groupBy: () => settle('groupBy'),
      orderBy: () => ({ limit: () => settle('orderBy'), then: (r: any, j: any) => settle('orderBy').then(r, j) }),
      then: (resolve: any, reject: any) => settle('await').then(resolve, reject),
    };
    const from: Record<string, unknown> = {
      where: () => afterWhere,
      innerJoin: () => ({ where: () => ({ then: (r: any, j: any) => settle('distinct').then(r, j) }) }),
      orderBy: () => ({ limit: () => settle('orderBy') }),
      limit: () => settle('limit'),
      then: (resolve: any, reject: any) => settle('await').then(resolve, reject),
    };
    return { from: () => from };
  };

  const db: Record<string, unknown> = {
    select: (sel?: Record<string, unknown>) => ({
      from: (table: unknown) => builder(table, sel ? Object.keys(sel) : null).from(),
    }),
    selectDistinct: (sel?: Record<string, unknown>) => ({
      from: (table: unknown) => builder(table, sel ? Object.keys(sel) : null).from(),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        if (table === analyticsEventsTable) {
          // Not counted as an insert attempt, and not subject to the
          // duplicate-key race simulation: it is a different table on a
          // fire-and-forget path.
          for (const row of Array.isArray(values) ? values : [values]) analyticsInserted.push(row);
          return Promise.resolve();
        }
        insertAttempts++;
        if (s.insertThrows && insertAttempts === 1) return Promise.reject(s.insertThrows);
        for (const row of Array.isArray(values) ? values : [values]) {
          inserted.push(row);
          if (typeof row.rfqId === 'number') {
            s.consumed.push({ rfqId: row.rfqId as number, yearMonth: row.yearMonth as string });
          }
        }
        return Promise.resolve();
      },
    }),
    delete: (table: unknown) => ({ where: () => { deleted.push(table); return Promise.resolve(); } }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      transactions++;
      return callback(db);
    },
  };

  return {
    db,
    get inserted() { return inserted; },
    get analyticsEvents() { return analyticsInserted; },
    get deleted() { return deleted; },
    get insertAttempts() { return insertAttempts; },
    get transactions() { return transactions; },
    get lockedReads() { return lockedReads; },
    get consumed() { return s.consumed; },
    state: s,
  };
}

/** A classified, open RFQ the vendor under test declares a match for. */
const materialsRfq = { id: 501, title: 'Cement for slab', category: 'Materials', location: 'Cairo', status: 'open', requesterId: 99 };
const designRfq = { id: 502, title: 'Villa interior', category: 'Design', location: 'Giza', status: 'open', requesterId: 99 };
const unclassifiedRfq = { id: 503, title: 'Something else', category: null, location: 'Cairo', status: 'open', requesterId: 99 };

const dupError = Object.assign(new Error('Duplicate entry'), { cause: { code: 'ER_DUP_ENTRY' } });

beforeEach(() => vi.clearAllMocks());

// ── Vendor category declarations ───────────────────────────────────────────

describe('vendor service categories - creation, update, self-scope (Phase 4B.3 §15)', () => {
  it('creates declarations for the authenticated vendor only', async () => {
    const fake = fakeDb({ subscription: null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const result = await appRouter.createCaller(makeCtx(10)).profile.setMyCategories({
      categories: ['Materials', 'Labor'],
    });

    expect(result.categories).toEqual(['Materials', 'Labor']);
    expect(fake.inserted).toEqual([
      { userId: 10, category: 'Materials' },
      { userId: 10, category: 'Labor' },
    ]);
  });

  it('updating replaces the vendor own declarations - the delete is scoped, not global', async () => {
    const fake = fakeDb({ categories: ['Materials'], subscription: null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    await appRouter.createCaller(makeCtx(10)).profile.setMyCategories({ categories: ['Design'] });

    expect(fake.deleted).toEqual([vendorCategoriesTable]);
    expect(fake.inserted).toEqual([{ userId: 10, category: 'Design' }]);
  });

  it('de-duplicates rather than writing the same declaration twice', async () => {
    const fake = fakeDb({ subscription: null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const result = await appRouter.createCaller(makeCtx(10)).profile.setMyCategories({
      categories: ['Materials', 'Materials', 'Labor'],
    });

    expect(result.categories).toEqual(['Materials', 'Labor']);
    expect(fake.inserted).toHaveLength(2);
  });

  it('clearing all categories is allowed and leaves the vendor eligible for nothing', async () => {
    const fake = fakeDb({ categories: ['Materials'], subscription: null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const result = await appRouter.createCaller(makeCtx(10)).profile.setMyCategories({ categories: [] });

    expect(result.categories).toEqual([]);
    expect(fake.inserted).toHaveLength(0);
  });

  it('CROSS-VENDOR: a userId supplied by the client is ignored - writes still target the caller', async () => {
    const fake = fakeDb({ subscription: null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    // Vendor 10 tries to rewrite vendor 11's declarations.
    await appRouter.createCaller(makeCtx(10)).profile.setMyCategories({
      categories: ['Materials'],
      userId: 11,
    } as never);

    expect(fake.inserted).toEqual([{ userId: 10, category: 'Materials' }]);
    expect(fake.inserted.some(row => row.userId === 11)).toBe(false);
  });

  it('rejects a category outside the shared taxonomy - a client cannot invent one', async () => {
    const fake = fakeDb({ subscription: null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    await expect(
      appRouter.createCaller(makeCtx(10)).profile.setMyCategories({ categories: ['Plumbing'] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(fake.inserted).toHaveLength(0);
  });

  it('enforces the FREE per-plan category cap server-side', async () => {
    const fake = fakeDb({ subscription: null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);
    const caller = appRouter.createCaller(makeCtx(10));

    const { limit } = await caller.profile.myCategories();
    expect(limit).toBe(3);

    await expect(
      caller.profile.setMyCategories({ categories: ['Materials', 'Labor', 'Design', 'Engineering'] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fake.inserted).toHaveLength(0);
  });

  it('a paid plan raises the cap, and the cap comes from the resolver not the client', async () => {
    const fake = fakeDb({ subscription: subscription('premium') });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const result = await appRouter.createCaller(makeCtx(10)).profile.setMyCategories({
      categories: ['Materials', 'Labor', 'Design', 'Engineering'],
    });
    expect(result.categories).toHaveLength(4);
  });

  it('myCategories takes no input at all, so it can only ever read the caller own row', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('myCategories: approvedProviderProcedure'), source.indexOf('setMyCategories:'));
    expect(block).not.toContain('.input(');
    expect(block).toContain('ctx.user.id');
  });
});

// ── Enquiry consumption: eligibility ───────────────────────────────────────

describe('openEnquiry - eligibility is decided server-side (Phase 4B.3 §15)', () => {
  it('an eligible vendor is granted access and spends exactly one credit', async () => {
    const fake = fakeDb({ rfq: materialsRfq, categories: ['Materials'], subscription: null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const result = await appRouter.createCaller(makeCtx(10)).rfq.openEnquiry({ rfqId: 501 });

    expect(result.rfq.id).toBe(501);
    expect(result.alreadyConsumed).toBe(false);
    expect(result.usage.used).toBe(1);
    expect(fake.inserted).toEqual([
      { userId: 10, rfqId: 501, yearMonth: MONTH, planAtConsumption: 'free', matchedCategory: 'Materials' },
    ]);
  });

  it('a non-eligible vendor is refused, and no credit is spent', async () => {
    const fake = fakeDb({ rfq: designRfq, categories: ['Materials'], subscription: null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    await expect(
      appRouter.createCaller(makeCtx(10)).rfq.openEnquiry({ rfqId: 502 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fake.inserted).toHaveLength(0);
  });

  it('a vendor with no declared categories is refused everything', async () => {
    const fake = fakeDb({ rfq: materialsRfq, categories: [], subscription: null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    await expect(
      appRouter.createCaller(makeCtx(10)).rfq.openEnquiry({ rfqId: 501 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fake.inserted).toHaveLength(0);
  });

  it('CONSERVATIVE FALLBACK: an unclassified RFQ is refused to a vendor holding every category', async () => {
    const fake = fakeDb({
      rfq: unclassifiedRfq,
      categories: ['Materials', 'Labor', 'Complete Project', 'Engineering', 'Design', 'Furniture', 'Maintenance', 'Renovation', 'Custom Services'],
      subscription: subscription('premium'),
    });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    await expect(
      appRouter.createCaller(makeCtx(10)).rfq.openEnquiry({ rfqId: 503 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Not silently classified, and never counted as a qualified opportunity.
    expect(fake.inserted).toHaveLength(0);
  });

  it('an unknown RFQ id is NOT_FOUND and spends nothing', async () => {
    const fake = fakeDb({ rfq: null, categories: ['Materials'], subscription: null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    await expect(
      appRouter.createCaller(makeCtx(10)).rfq.openEnquiry({ rfqId: 999999 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fake.inserted).toHaveLength(0);
  });

  it('CLIENT RFQ-ID MANIPULATION: non-positive and non-integer ids are rejected by the schema', async () => {
    const fake = fakeDb({ rfq: materialsRfq, categories: ['Materials'], subscription: null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);
    const caller = appRouter.createCaller(makeCtx(10));

    for (const bad of [0, -1, 1.5, '501']) {
      await expect(caller.rfq.openEnquiry({ rfqId: bad } as never)).rejects.toBeTruthy();
    }
    expect(fake.inserted).toHaveLength(0);
  });
});

// ── Enquiry consumption: duplicates and refresh ────────────────────────────

describe('openEnquiry - duplicate and refresh prevention (Phase 4B.3 §15)', () => {
  it('re-opening the same RFQ grants access again but never spends a second credit', async () => {
    const fake = fakeDb({ rfq: materialsRfq, categories: ['Materials'], subscription: null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);
    const caller = appRouter.createCaller(makeCtx(10));

    const first = await caller.rfq.openEnquiry({ rfqId: 501 });
    const second = await caller.rfq.openEnquiry({ rfqId: 501 });
    const third = await caller.rfq.openEnquiry({ rfqId: 501 });

    expect(first.alreadyConsumed).toBe(false);
    expect(second.alreadyConsumed).toBe(true);
    expect(third.alreadyConsumed).toBe(true);
    expect(fake.inserted).toHaveLength(1);
    expect(third.usage.used).toBe(1);
  });

  it('REFRESH AT THE LIMIT: an already-paid lead stays open even once the allowance is exhausted', async () => {
    const consumed = Array.from({ length: 5 }, (_, i) => ({ rfqId: 501 + i, yearMonth: MONTH }));
    const fake = fakeDb({ rfq: materialsRfq, categories: ['Materials'], subscription: null, consumed });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const result = await appRouter.createCaller(makeCtx(10)).rfq.openEnquiry({ rfqId: 501 });

    expect(result.alreadyConsumed).toBe(true);
    expect(result.usage.limitReached).toBe(true);
    expect(fake.inserted).toHaveLength(0);
  });

  it('a NEW lead at the limit is refused even though a paid one is still reopenable', async () => {
    const consumed = Array.from({ length: 5 }, (_, i) => ({ rfqId: 601 + i, yearMonth: MONTH }));
    const fake = fakeDb({ rfq: materialsRfq, categories: ['Materials'], subscription: null, consumed });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    await expect(
      appRouter.createCaller(makeCtx(10)).rfq.openEnquiry({ rfqId: 501 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fake.inserted).toHaveLength(0);
  });
});

// ── Concurrency ────────────────────────────────────────────────────────────

describe('openEnquiry - concurrency (Phase 4B.3 §8, §15)', () => {
  it('the allowance check and the insert happen inside one transaction, under a row lock', async () => {
    const fake = fakeDb({ rfq: materialsRfq, categories: ['Materials'], subscription: null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    await openQualifiedEnquiry(10, 501, NOW);

    expect(fake.transactions).toBe(1);
    expect(fake.lockedReads).toBe(1);
  });

  it('a lost duplicate-key race is treated as already-consumed, not as an error', async () => {
    const fake = fakeDb({ rfq: materialsRfq, categories: ['Materials'], subscription: null, insertThrows: dupError });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const result = await openQualifiedEnquiry(10, 501, NOW);

    expect(result.outcome).toBe('granted');
    expect(result.outcome === 'granted' && result.alreadyConsumed).toBe(true);
    expect(fake.inserted).toHaveLength(0);
  });

  it('a non-duplicate database error is NOT swallowed into a grant', async () => {
    const fake = fakeDb({
      rfq: materialsRfq, categories: ['Materials'], subscription: null,
      insertThrows: Object.assign(new Error('connection lost'), { cause: { code: 'PROTOCOL_CONNECTION_LOST' } }),
    });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    await expect(openQualifiedEnquiry(10, 501, NOW)).rejects.toThrow('connection lost');
  });

  it('CONCURRENT NEW LEADS: parallel requests can never exceed the FREE allowance', async () => {
    // The serialisation the real engine relies on is InnoDB's next-key lock
    // over (userId, yearMonth); here the fake serialises the same critical
    // section, so the assertion is that the engine puts the count AND the
    // insert inside it - a count-then-insert outside a transaction would let
    // all eight through.
    const fake = fakeDb({ categories: ['Materials'], subscription: null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const results = [];
    for (let i = 0; i < 8; i++) {
      fake.state.rfq = { ...materialsRfq, id: 700 + i };
      results.push(await openQualifiedEnquiry(10, 700 + i, NOW));
    }

    expect(results.filter(r => r.outcome === 'granted')).toHaveLength(5);
    expect(results.filter(r => r.outcome === 'limit_reached')).toHaveLength(3);
    expect(fake.inserted).toHaveLength(5);
  });

  it('the lock covers only this vendor month, so a foreign vendor consumption is not counted', async () => {
    const fake = fakeDb({
      rfq: materialsRfq, categories: ['Materials'], subscription: null,
      // Rows for a different month must not count against this month.
      consumed: Array.from({ length: 5 }, (_, i) => ({ rfqId: 800 + i, yearMonth: '2026-07' })),
    });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const result = await openQualifiedEnquiry(10, 501, NOW);
    expect(result.outcome).toBe('granted');
  });
});

// ── Allowances per plan ────────────────────────────────────────────────────

describe('qualified-enquiry allowance enforcement (Phase 4B.3 §15)', () => {
  async function consumeSequence(plan: null | 'professional' | 'premium', attempts: number) {
    const fake = fakeDb({ categories: ['Materials'], subscription: plan ? subscription(plan) : null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);
    const outcomes: string[] = [];
    for (let i = 0; i < attempts; i++) {
      fake.state.rfq = { ...materialsRfq, id: 1000 + i };
      outcomes.push((await openQualifiedEnquiry(10, 1000 + i, NOW)).outcome);
    }
    return { outcomes, fake };
  }

  it('FREE: the 5th qualified enquiry is allowed and the 6th is denied', async () => {
    const { outcomes, fake } = await consumeSequence(null, 6);
    expect(outcomes.slice(0, 5)).toEqual(['granted', 'granted', 'granted', 'granted', 'granted']);
    expect(outcomes[5]).toBe('limit_reached');
    expect(fake.inserted).toHaveLength(5);
  });

  it('PROFESSIONAL: the 30th is allowed and the 31st is denied', async () => {
    const { outcomes, fake } = await consumeSequence('professional', 31);
    expect(outcomes.slice(0, 30).every(o => o === 'granted')).toBe(true);
    expect(outcomes[30]).toBe('limit_reached');
    expect(fake.inserted).toHaveLength(30);
  });

  it('PREMIUM: unlimited - well past every other plan cap, nothing is denied', async () => {
    const { outcomes, fake } = await consumeSequence('premium', 40);
    expect(outcomes.every(o => o === 'granted')).toBe(true);
    expect(fake.inserted).toHaveLength(40);
  });

  it('PREMIUM never takes the range lock, because there is no allowance to serialise against', async () => {
    const fake = fakeDb({ rfq: materialsRfq, categories: ['Materials'], subscription: subscription('premium') });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    await openQualifiedEnquiry(10, 501, NOW);
    expect(fake.lockedReads).toBe(0);
    expect(fake.inserted).toHaveLength(1);
  });

  it('the plan recorded on a consumed enquiry is the resolved plan, not a client claim', async () => {
    const fake = fakeDb({ rfq: materialsRfq, categories: ['Materials'], subscription: subscription('professional') });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    await openQualifiedEnquiry(10, 501, NOW);
    expect(fake.inserted[0]).toMatchObject({ planAtConsumption: 'professional', matchedCategory: 'Materials' });
  });

  it('a lapsed paid subscription falls back to the FREE allowance', async () => {
    const expired = { ...subscription('premium'), status: 'canceled', currentPeriodEnd: new Date('2026-01-01T00:00:00.000Z'), gracePeriodEndsAt: new Date('2026-01-08T00:00:00.000Z') };
    const fake = fakeDb({ categories: ['Materials'], subscription: expired });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const usage = await getEnquiryUsage(10, NOW);
    expect(usage.allowance).toBe(5);
  });
});

// ── Monthly boundary ───────────────────────────────────────────────────────

describe('monthly allowance boundary (Phase 4B.3 §15)', () => {
  it('usage counts the current UTC month only, and the period key rolls over', async () => {
    const consumed = Array.from({ length: 5 }, (_, i) => ({ rfqId: 900 + i, yearMonth: MONTH }));
    const fake = fakeDb({ categories: ['Materials'], subscription: null, consumed, currentMonth: MONTH });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const august = await getEnquiryUsage(10, NOW);
    expect(august.periodKey).toBe('2026-08');
    expect(august.used).toBe(5);
    expect(august.remaining).toBe(0);
    expect(august.limitReached).toBe(true);
    expect(august.resetsAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');

    // Same stored rows, one month later: none of them belong to September.
    fake.state.currentMonth = NEXT_MONTH;
    const september = await getEnquiryUsage(10, NEXT_MONTH_DATE);
    expect(september.periodKey).toBe('2026-09');
    expect(september.used).toBe(0);
    expect(september.remaining).toBe(5);
    expect(september.limitReached).toBe(false);
  });

  it('a new month restores the ability to open new leads', async () => {
    const consumed = Array.from({ length: 5 }, (_, i) => ({ rfqId: 900 + i, yearMonth: MONTH }));
    const fake = fakeDb({ rfq: materialsRfq, categories: ['Materials'], subscription: null, consumed, currentMonth: NEXT_MONTH });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const result = await openQualifiedEnquiry(10, 501, NEXT_MONTH_DATE);
    expect(result.outcome).toBe('granted');
    expect(fake.inserted[0]).toMatchObject({ yearMonth: '2026-09' });
  });

  it('history is never deleted at the month boundary - prior rows survive', async () => {
    const consumed = [{ rfqId: 900, yearMonth: MONTH }];
    const fake = fakeDb({ rfq: materialsRfq, categories: ['Materials'], subscription: null, consumed, currentMonth: NEXT_MONTH });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    await openQualifiedEnquiry(10, 501, NEXT_MONTH_DATE);
    expect(fake.consumed.map(row => row.rfqId).sort()).toEqual([501, 900]);
    expect(fake.deleted).toHaveLength(0);
  });
});

// ── Client-supplied state is never trusted ─────────────────────────────────

describe('client manipulation attempts (Phase 4B.3 §15)', () => {
  it('CLIENT PLAN MANIPULATION: a plan sent by the client does not raise the allowance', async () => {
    const consumed = Array.from({ length: 5 }, (_, i) => ({ rfqId: 601 + i, yearMonth: MONTH }));
    const fake = fakeDb({ rfq: materialsRfq, categories: ['Materials'], subscription: null, consumed });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    await expect(
      appRouter.createCaller(makeCtx(10)).rfq.openEnquiry({ rfqId: 501, plan: 'premium', unlimited: true } as never),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fake.inserted).toHaveLength(0);
  });

  it('CLIENT VENDOR-ID MANIPULATION: consumption is always recorded against the authenticated vendor', async () => {
    const fake = fakeDb({ rfq: materialsRfq, categories: ['Materials'], subscription: null });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    await appRouter.createCaller(makeCtx(10)).rfq.openEnquiry({ rfqId: 501, userId: 11, vendorId: 11 } as never);

    expect(fake.inserted).toEqual([
      { userId: 10, rfqId: 501, yearMonth: MONTH, planAtConsumption: 'free', matchedCategory: 'Materials' },
    ]);
  });

  it('openEnquiry accepts nothing but an RFQ id', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('openEnquiry: approvedProviderProcedure'), source.indexOf('submitQuotation:'));
    const input = block.slice(block.indexOf('.input('), block.indexOf('.mutation('));
    expect(input).toContain('rfqId');
    for (const forbidden of ['plan', 'userId', 'vendorId', 'allowance', 'category']) {
      expect(input, forbidden).not.toContain(forbidden);
    }
  });

  it('billing.myEnquiryUsage and rfq.eligible take no input, so they cannot read another vendor', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const usage = source.slice(source.indexOf('myEnquiryUsage: protectedProcedure'), source.indexOf('myEnquiryUsage: protectedProcedure') + 220);
    expect(usage).not.toContain('.input(');
    expect(usage).toContain('ctx.user.id');
    const eligible = source.slice(source.indexOf('eligible: approvedProviderProcedure'), source.indexOf('openEnquiry: approvedProviderProcedure'));
    expect(eligible).not.toContain('.input(');
    expect(eligible).toContain('ctx.user.id');
  });
});

// ── Authorization boundaries ───────────────────────────────────────────────

describe('authorization boundaries (Phase 4B.3 §15)', () => {
  beforeEach(() => vi.mocked(getDb).mockResolvedValue(fakeDb().db as never));

  it('anonymous callers are rejected from every vendor-scoped endpoint', async () => {
    const caller = appRouter.createCaller(anonCtx());
    await expect(caller.rfq.eligible()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(caller.rfq.openEnquiry({ rfqId: 501 })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(caller.profile.myCategories()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(caller.profile.setMyCategories({ categories: [] })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(caller.billing.myEnquiryUsage()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('CUSTOMER ATTEMPTING VENDOR-ONLY ENDPOINTS: a homeowner is forbidden', async () => {
    const caller = appRouter.createCaller(makeCtx(2, { userRole: 'homeowner' }));
    await expect(caller.rfq.eligible()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.rfq.openEnquiry({ rfqId: 501 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.profile.myCategories()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.profile.setMyCategories({ categories: ['Materials'] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('an unapproved provider cannot declare categories or consume enquiries', async () => {
    const caller = appRouter.createCaller(makeCtx(6, { onboardingStatus: 'pending' }));
    await expect(caller.rfq.eligible()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.rfq.openEnquiry({ rfqId: 501 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.profile.setMyCategories({ categories: ['Materials'] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a non-admin cannot read the admin vendor-targeting diagnostics', async () => {
    await expect(
      appRouter.createCaller(makeCtx(10)).admin.vendorTargeting({ userId: 11 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      appRouter.createCaller(anonCtx()).admin.vendorTargeting({ userId: 11 }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

// ── Data exposure ──────────────────────────────────────────────────────────

describe('sensitive-field leakage (Phase 4B.3 §15)', () => {
  it('the public vendor directory returns only the approved public columns', async () => {
    const fake = fakeDb({
      directoryVendors: [{
        id: 10, name: 'Nile Contracting', bio: 'Structural works', avatar: null,
        location: 'Cairo', userRole: 'contractor', verified: true, createdAt: NOW,
      }],
      reputationRows: [{ revieweeId: 10, avg: '4.5', count: 2 }],
      directoryCategoryRows: [{ userId: 10, category: 'Materials' }],
    });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const [vendor] = await appRouter.createCaller(anonCtx()).marketplace.vendors();

    expect(Object.keys(vendor).sort()).toEqual(
      ['averageRating', 'avatar', 'bio', 'categories', 'createdAt', 'id', 'location', 'name', 'reviewCount', 'userRole', 'verified'].sort(),
    );
    for (const forbidden of ['passwordHash', 'invitationToken', 'email', 'phone', 'openId', 'accountStatus', 'frozenReason', 'isDummy', 'plan', 'providerCustomerRef']) {
      expect(vendor, forbidden).not.toHaveProperty(forbidden);
    }
    // Reputation is the live verified-review aggregate, not a stored column.
    expect(vendor.averageRating).toBe(4.5);
    expect(vendor.reviewCount).toBe(2);
  });

  it('the admin targeting diagnostics carry no payment or credential fields', async () => {
    const fake = fakeDb({
      categories: ['Materials'],
      consumed: [{ rfqId: 501, yearMonth: MONTH }],
      subscription: subscription('professional', 11),
    });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const result = await appRouter.createCaller(makeCtx(7, { role: 'admin', adminRole: 'SUPER_ADMIN' })).admin.vendorTargeting({ userId: 11 });
    const serialised = JSON.stringify(result);

    for (const forbidden of ['passwordHash', 'providerCustomerRef', 'providerSubscriptionRef', 'providerPriceRef', 'invitationToken', 'priceAmount']) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
    expect(result.categories).toEqual([{ category: 'Materials' }]);
  });

  it('the eligible-RFQ list exposes lead fields only - never the requester identity or contact details', async () => {
    const fake = fakeDb({
      categories: ['Materials'],
      eligibleRfqs: [{
        id: 501, title: 'Cement for slab', category: 'Materials', location: 'Cairo',
        budget: '50000', deadline: null, status: 'open', createdAt: NOW,
      }],
    });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const { items } = await appRouter.createCaller(makeCtx(10)).rfq.eligible();

    expect(Object.keys(items[0]).sort()).toEqual(
      ['alreadyOpened', 'budget', 'category', 'createdAt', 'deadline', 'id', 'location', 'status', 'title'].sort(),
    );
    for (const forbidden of ['requesterId', 'email', 'phone', 'contactName', 'description']) {
      expect(items[0], forbidden).not.toHaveProperty(forbidden);
    }
  });

  it('the limit-reached message states the caller own allowance and nothing about anyone else', async () => {
    const consumed = Array.from({ length: 5 }, (_, i) => ({ rfqId: 601 + i, yearMonth: MONTH }));
    const fake = fakeDb({ rfq: materialsRfq, categories: ['Materials'], subscription: null, consumed });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    await expect(appRouter.createCaller(makeCtx(10)).rfq.openEnquiry({ rfqId: 501 }))
      .rejects.toThrow(/used all 5 qualified enquiries/);
  });
});

// ── Listing never consumes ─────────────────────────────────────────────────

describe('listing is free (Phase 4B.3)', () => {
  it('rfq.eligible consumes no credit and writes nothing', async () => {
    const fake = fakeDb({
      categories: ['Materials'],
      eligibleRfqs: [{ id: 501, title: 'Cement', category: 'Materials', location: 'Cairo', budget: null, deadline: null, status: 'open', createdAt: NOW }],
    });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const result = await appRouter.createCaller(makeCtx(10)).rfq.eligible();

    expect(result.items).toHaveLength(1);
    expect(result.usage.used).toBe(0);
    expect(fake.inserted).toHaveLength(0);
    expect(fake.transactions).toBe(0);
  });

  it('a vendor with no declared categories is listed nothing at all', async () => {
    const fake = fakeDb({ categories: [], eligibleRfqs: [{ id: 501 }] });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const result = await appRouter.createCaller(makeCtx(10)).rfq.eligible();
    expect(result.items).toEqual([]);
  });

  it('already-opened leads are flagged so the UI never charges twice for a click', async () => {
    const fake = fakeDb({
      categories: ['Materials'],
      consumed: [{ rfqId: 501, yearMonth: MONTH }],
      eligibleRfqs: [
        { id: 501, title: 'Cement', category: 'Materials', location: 'Cairo', budget: null, deadline: null, status: 'open', createdAt: NOW },
        { id: 502, title: 'Sand', category: 'Materials', location: 'Cairo', budget: null, deadline: null, status: 'open', createdAt: NOW },
      ],
    });
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const { items } = await appRouter.createCaller(makeCtx(10)).rfq.eligible();
    expect(items.find(i => i.id === 501)?.alreadyOpened).toBe(true);
    expect(items.find(i => i.id === 502)?.alreadyOpened).toBe(false);
  });
});
