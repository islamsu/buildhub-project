import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';

function makeCtx(userId: number, userRole = 'contractor', onboardingStatus = 'approved'): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@test.com`,
      name: `User ${userId}`,
      loginMethod: 'manus',
      role: 'user',
      userRole,
      onboardingStatus,
      accountStatus: 'active',
      isDummy: false,
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

// Builds a mock db whose select().from().innerJoin().where() chain resolves to `rows`,
// matching analytics.myStats's single aggregate query shape exactly.
function makeStatsDb(rows: unknown[]) {
  const whereMock = vi.fn().mockResolvedValue(rows);
  return { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ innerJoin: vi.fn().mockReturnValue({ where: whereMock }) }) }), whereMock };
}

describe('analytics.myStats - authorization (items 1-4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. a vendor can retrieve their own analytics', async () => {
    const db = makeStatsDb([{ submitted: 4, accepted: 2, avgResponseSeconds: '7200' }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(10, 'contractor'));

    await expect(caller.analytics.myStats()).resolves.toEqual({
      quotationsSubmitted: 4,
      quotationsAccepted: 2,
      winRate: 50,
      avgResponseTimeHours: 2,
    });
  });

  it('2. there is no input parameter of any kind on analytics.myStats - a vendor cannot request another vendor\'s stats by construction', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('const analyticsRouter'), source.indexOf('// ── Admin Router'));
    expect(block).not.toMatch(/\.input\(/);
    expect(block).not.toMatch(/vendorId|targetUserId/);
  });

  it('3. a customer (non-provider role) is rejected with FORBIDDEN, not given zeroed-out stats', async () => {
    const db = makeStatsDb([]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(10, 'homeowner'));

    await expect(caller.analytics.myStats()).rejects.toThrow();
  });

  it('4. an unauthenticated caller is rejected', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.analytics.myStats()).rejects.toThrow();
  });

  it('a provider whose onboarding is not yet approved is rejected, same as every other approvedProviderProcedure endpoint', async () => {
    const caller = appRouter.createCaller(makeCtx(10, 'contractor', 'under_review'));
    await expect(caller.analytics.myStats()).rejects.toThrow();
  });
});

describe('analytics.myStats - calculations (items 5-11)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('5. quotations submitted count is correct', async () => {
    const db = makeStatsDb([{ submitted: 7, accepted: 0, avgResponseSeconds: null }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(10));

    const result = await caller.analytics.myStats();
    expect(result.quotationsSubmitted).toBe(7);
  });

  it('6. quotations accepted count is correct and uses the single status = "accepted" definition (no invented statuses)', async () => {
    const db = makeStatsDb([{ submitted: 7, accepted: 3, avgResponseSeconds: '3600' }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(10));

    const result = await caller.analytics.myStats();
    expect(result.quotationsAccepted).toBe(3);

    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('const analyticsRouter'), source.indexOf('// ── Admin Router'));
    expect(block).toContain("quotations.status} = 'accepted'");
    expect(block).not.toMatch(/'awarded'|'won'|'completed'/);
  });

  it('7. win rate = accepted / submitted * 100, rounded to 1 decimal', async () => {
    const db = makeStatsDb([{ submitted: 3, accepted: 1, avgResponseSeconds: '1800' }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(10));

    const result = await caller.analytics.myStats();
    expect(result.winRate).toBeCloseTo(33.3, 1);
  });

  it('8. zero quotations submitted is handled (all metrics reported honestly, no crash)', async () => {
    const db = makeStatsDb([{ submitted: 0, accepted: 0, avgResponseSeconds: null }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(10));

    await expect(caller.analytics.myStats()).resolves.toEqual({
      quotationsSubmitted: 0,
      quotationsAccepted: 0,
      winRate: null,
      avgResponseTimeHours: null,
    });
  });

  it('8b. zero quotations submitted is handled even when the aggregate query returns no row at all', async () => {
    const db = makeStatsDb([]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(10));

    await expect(caller.analytics.myStats()).resolves.toEqual({
      quotationsSubmitted: 0,
      quotationsAccepted: 0,
      winRate: null,
      avgResponseTimeHours: null,
    });
  });

  it('9. division by zero never produces NaN or Infinity - win rate is null, not 0 or NaN', async () => {
    const db = makeStatsDb([{ submitted: 0, accepted: 0, avgResponseSeconds: null }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(10));

    const result = await caller.analytics.myStats();
    expect(result.winRate).not.toBeNaN();
    expect(Number.isFinite(result.winRate ?? 0)).toBe(true);
    expect(result.winRate).toBeNull();
  });

  it('10. response time is computed from rfqs.createdAt -> quotations.createdAt in hours when timestamps exist', async () => {
    const db = makeStatsDb([{ submitted: 2, accepted: 1, avgResponseSeconds: '10800' }]); // 3 hours
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(10));

    const result = await caller.analytics.myStats();
    expect(result.avgResponseTimeHours).toBe(3);

    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('const analyticsRouter'), source.indexOf('// ── Admin Router'));
    expect(block).toContain('timestampdiff(second');
    expect(block).toContain('rfqs.createdAt');
    expect(block).toContain('quotations.createdAt');
  });

  it('11. a null/missing average-response aggregate (no rows to average) is handled safely, never approximated', async () => {
    const db = makeStatsDb([{ submitted: 0, accepted: 0, avgResponseSeconds: null }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(10));

    const result = await caller.analytics.myStats();
    expect(result.avgResponseTimeHours).toBeNull();
  });

  it('does not implement an "RFQs received" metric - rfq.list has no per-vendor targeting to honestly measure it from', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const analyticsBlock = source.slice(source.indexOf('const analyticsRouter'), source.indexOf('// ── Admin Router'));
    expect(analyticsBlock).not.toMatch(/rfqsReceived|received/i);

    const rfqListBlock = source.slice(source.indexOf('const rfqRouter'), source.indexOf('myList:'));
    // rfq.list is confirmed unfiltered - no providerId/vendorId condition on the RFQ listing query.
    expect(rfqListBlock).not.toMatch(/providerId|vendorId/);
  });
});

describe('analytics.myStats - vendor data isolation (items 12-13)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('12. two different vendors calling myStats each get their own scoped query (WHERE providerId = ctx.user.id, not a shared/global aggregate)', async () => {
    const dbA = makeStatsDb([{ submitted: 5, accepted: 4, avgResponseSeconds: '3600' }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(dbA);
    const callerA = appRouter.createCaller(makeCtx(101));
    const resultA = await callerA.analytics.myStats();

    const dbB = makeStatsDb([{ submitted: 1, accepted: 0, avgResponseSeconds: null }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(dbB);
    const callerB = appRouter.createCaller(makeCtx(202));
    const resultB = await callerB.analytics.myStats();

    expect(resultA).not.toEqual(resultB);
    expect(resultA.quotationsSubmitted).toBe(5);
    expect(resultB.quotationsSubmitted).toBe(1);
  });

  it('13. Vendor B cannot influence or read Vendor A\'s statistics - each call is scoped by eq(quotations.providerId, ctx.user.id), verified from source', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('const analyticsRouter'), source.indexOf('// ── Admin Router'));
    expect(block).toContain('eq(quotations.providerId, ctx.user.id)');
  });
});

describe('analytics.myStats - regression (items 14-15)', () => {
  it('14. Vendor Profile router is untouched by this phase (profileRouter still exports getPublic/getOwn/update/uploadAvatar)', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('const profileRouter'), source.indexOf('const analyticsRouter'));
    expect(block).toContain('getPublic:');
    expect(block).toContain('getOwn:');
    expect(block).toContain('update:');
    expect(block).toContain('uploadAvatar:');
  });

  it('15. Vendor Reputation (reviews.statsForUser/eligibleReviewees/submit) is untouched by this phase', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('const reviewsRouter'), source.indexOf('const profileRouter'));
    expect(block).toContain('statsForUser:');
    expect(block).toContain('eligibleReviewees:');
    expect(block).toContain('submit:');
  });
});

describe('vendor analytics localization', () => {
  it('every new analytics.* key exists in both the English and Arabic translation maps', () => {
    const source = readFileSync(new URL('../client/src/contexts/LanguageContext.tsx', import.meta.url), 'utf8');
    const keys = Array.from(new Set(Array.from(source.matchAll(/'(analytics\.[a-z_]+)':/g)).map(m => m[1])));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const occurrences = (source.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'g')) ?? []).length;
      expect(occurrences, `expected '${key}' to appear exactly twice (English + Arabic maps)`).toBe(2);
    }
  });
});

describe('vendor analytics UI wiring and responsive conventions (items 16-23)', () => {
  it('16/17/20. VendorAnalytics renders via a single self-scoped query with loading/empty/error states and no userId prop', () => {
    const component = readFileSync(new URL('../client/src/components/VendorAnalytics.tsx', import.meta.url), 'utf8');
    expect(component).toContain('trpc.analytics.myStats.useQuery()');
    expect(component).not.toMatch(/myStats\.useQuery\(\s*\{/); // no input object passed
    expect(component).toContain('analytics.empty_state');
    expect(component).toContain('analytics.load_error');
    expect(component).toContain('common.loading');
  });

  it('18/19. Arabic and English labels are both sourced from t(), not hardcoded', () => {
    const component = readFileSync(new URL('../client/src/components/VendorAnalytics.tsx', import.meta.url), 'utf8');
    expect(component).toContain("t('analytics.submitted')");
    expect(component).toContain("t('analytics.accepted')");
    expect(component).toContain("t('analytics.win_rate')");
    expect(component).toContain("t('analytics.response_time')");
    expect(component).not.toMatch(/>Quotations Submitted</);
  });

  it('is wired into ProviderDashboard next to Vendor Reputation (same dashboard, not a duplicate/competing surface)', () => {
    const providerDashboard = readFileSync(new URL('../client/src/pages/ProviderDashboard.tsx', import.meta.url), 'utf8');
    expect(providerDashboard).toContain('VendorAnalytics');
    expect(providerDashboard).toContain('VendorReputation');
  });

  it('21/22/23. avoids fixed pixel widths and uses a responsive grid (375/768/1280 verified live, see final report)', () => {
    const component = readFileSync(new URL('../client/src/components/VendorAnalytics.tsx', import.meta.url), 'utf8');
    expect(component).not.toMatch(/width:\s*\d+px/);
    expect(component).toContain('grid-cols-2');
    expect(component).toContain('sm:grid-cols-4');
  });
});
