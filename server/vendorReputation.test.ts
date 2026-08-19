import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';

function makeCtx(userId: number, userRole = 'homeowner'): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@test.com`,
      name: `User ${userId}`,
      loginMethod: 'manus',
      role: 'user',
      userRole,
      accountStatus: 'active',
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

// Authorization items 1-7 (eligible customer / unrelated customer / vendor-as-customer /
// self-review / wrong project / wrong vendor / duplicate) are already covered exhaustively
// in server/reviewsAuthorization.test.ts against the pre-existing reviews.submit backend,
// which this phase deliberately did not modify - re-run there, not duplicated here.

describe('reviews.statsForUser (dynamic/computed rating - Phase 4A.4 decision)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null average and 0 count when a vendor has zero reviews', async () => {
    const whereMock = vi.fn().mockResolvedValue([{ avg: null, count: 0 }]);
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: whereMock }) }) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(1));

    await expect(caller.reviews.statsForUser({ userId: 20 })).resolves.toEqual({ averageRating: null, reviewCount: 0 });
  });

  it('computes the average live from AVG(rating)/COUNT(*), rounded to 1 decimal', async () => {
    const whereMock = vi.fn().mockResolvedValue([{ avg: '4.3333', count: 3 }]);
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: whereMock }) }) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(1));

    await expect(caller.reviews.statsForUser({ userId: 20 })).resolves.toEqual({ averageRating: 4.3, reviewCount: 3 });
  });

  it('never returns NaN/Infinity for a malformed/missing aggregate row', async () => {
    const whereMock = vi.fn().mockResolvedValue([]);
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: whereMock }) }) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(1));

    const result = await caller.reviews.statsForUser({ userId: 20 });
    expect(result.averageRating).toBeNull();
    expect(Number.isFinite(result.reviewCount)).toBe(true);
  });

  it('is a live query over the reviews table every call - no stored/cached aggregate column is ever read', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('statsForUser:'), source.indexOf('eligibleReviewees:'));
    expect(block).toContain('avg(');
    expect(block).toContain('count(*)');
    expect(block).not.toMatch(/users\.rating|users\.reviewCount/);
  });

  it('filters to verified reviews only, matching reviews.forUser\'s existing public contract exactly (no competing definition of "public review")', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('statsForUser:'), source.indexOf('eligibleReviewees:'));
    expect(block).toContain("reviews.verified, true");
  });
});

describe('reviews.eligibleReviewees', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists awarded providers on a completed, owned project, flagging which are already reviewed', async () => {
    let call = 0;
    const responses = [
      [{ id: 1, ownerId: 1, status: 'completed' }], // project lookup
      [{ providerId: 20, name: 'Nile Construction' }, { providerId: 21, name: 'Delta Electric' }], // awarded providers (join)
      [{ revieweeId: 20 }], // existing reviews by this reviewer on this project
    ];
    const db = {
      select: vi.fn(() => ({
        from: () => ({
          where: () => Promise.resolve(responses[call++] ?? []),
          innerJoin: () => ({ innerJoin: () => ({ where: () => Promise.resolve(responses[call++] ?? []) }) }),
        }),
      })),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(1));

    const result = await caller.reviews.eligibleReviewees({ projectId: 1 });
    expect(result).toEqual([
      { providerId: 20, name: 'Nile Construction', alreadyReviewed: true },
      { providerId: 21, name: 'Delta Electric', alreadyReviewed: false },
    ]);
  });

  it('returns an empty list for a project the caller does not own (no enumeration of another owner\'s providers)', async () => {
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(999));

    await expect(caller.reviews.eligibleReviewees({ projectId: 1 })).resolves.toEqual([]);
  });

  it('returns an empty list for a project that is not completed', async () => {
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(1));

    await expect(caller.reviews.eligibleReviewees({ projectId: 1 })).resolves.toEqual([]);
  });

  it('rejects an unauthenticated caller', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.reviews.eligibleReviewees({ projectId: 1 })).rejects.toThrow();
  });

  it('reuses the exact same verified-participant definition as reviews.submit, not a second competing one', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('eligibleReviewees:'), source.indexOf('const providerRoles', source.indexOf('eligibleReviewees:')) === -1 ? source.indexOf('});', source.indexOf('eligibleReviewees:')) : source.length);
    expect(block).toContain("eq(rfqs.projectId, input.projectId)");
    expect(block).toContain("eq(quotations.status, 'accepted')");
  });
});

describe('reviews.submit - rating/comment data correctness', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores the exact rating and comment submitted', async () => {
    let call = 0;
    const responses = [
      [{ id: 1, ownerId: 1, status: 'completed' }],
      [{ providerId: 20 }],
      [],
    ];
    const insertValues = vi.fn().mockResolvedValue([{ insertId: 1 }]);
    const db = {
      select: vi.fn(() => ({
        from: () => ({
          where: () => Promise.resolve(responses[call++] ?? []),
          innerJoin: () => ({ where: () => Promise.resolve(responses[call++] ?? []) }),
        }),
      })),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(1));

    await caller.reviews.submit({ projectId: 1, revieweeId: 20, rating: 4, comment: 'Great work, on time and on budget.' });
    expect(insertValues).toHaveBeenNthCalledWith(1, expect.objectContaining({ rating: 4, comment: 'Great work, on time and on budget.', reviewerId: 1, revieweeId: 20, projectId: 1, verified: true }));
  });

  it('rejects a rating below 1', async () => {
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 20, rating: 0 })).rejects.toThrow();
  });

  it('rejects a rating above 5', async () => {
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 20, rating: 6 })).rejects.toThrow();
  });
});

describe('vendor reputation localization', () => {
  it('every new reputation.*/review.* key exists in both the English and Arabic translation maps', () => {
    const source = readFileSync(new URL('../client/src/contexts/LanguageContext.tsx', import.meta.url), 'utf8');
    const keys = Array.from(new Set(Array.from(source.matchAll(/'((?:reputation|review)\.[a-z_]+)':/g)).map(m => m[1])));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const occurrences = (source.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'g')) ?? []).length;
      expect(occurrences, `expected '${key}' to appear exactly twice (English + Arabic maps)`).toBe(2);
    }
  });
});

describe('vendor reputation UI wiring and responsive conventions', () => {
  it('VendorReputation is a single reusable component, used by both VendorProfile and ProviderDashboard (no duplicate implementation)', () => {
    const component = readFileSync(new URL('../client/src/components/VendorReputation.tsx', import.meta.url), 'utf8');
    const vendorProfile = readFileSync(new URL('../client/src/pages/VendorProfile.tsx', import.meta.url), 'utf8');
    const providerDashboard = readFileSync(new URL('../client/src/pages/ProviderDashboard.tsx', import.meta.url), 'utf8');
    expect(component).toContain('reviews.statsForUser');
    expect(component).toContain('reviews.forUser');
    expect(vendorProfile).toContain('VendorReputation');
    expect(providerDashboard).toContain('VendorReputation');
    // Only one component file defines this rating/count computation.
    expect(vendorProfile).not.toMatch(/reviews\.statsForUser\.useQuery/);
    expect(providerDashboard).not.toMatch(/reviews\.statsForUser\.useQuery/);
  });

  it('ReviewSubmissionPanel is wired into ProjectDetail behind a completed-project check', () => {
    const projectDetail = readFileSync(new URL('../client/src/pages/ProjectDetail.tsx', import.meta.url), 'utf8');
    expect(projectDetail).toContain('ReviewSubmissionPanel');
    expect(projectDetail).toContain("isCompleted={project?.status === 'completed'}");
  });

  it('the review submission panel never assumes eligibility client-side - it renders from the server query result only', () => {
    const panel = readFileSync(new URL('../client/src/components/ReviewSubmissionPanel.tsx', import.meta.url), 'utf8');
    expect(panel).toContain('reviews.eligibleReviewees.useQuery');
    expect(panel).toContain('reviews.submit.useMutation');
  });

  it('avoids fixed pixel widths and uses responsive utility classes', () => {
    const component = readFileSync(new URL('../client/src/components/VendorReputation.tsx', import.meta.url), 'utf8');
    const panel = readFileSync(new URL('../client/src/components/ReviewSubmissionPanel.tsx', import.meta.url), 'utf8');
    expect(component).not.toMatch(/width:\s*\d+px/);
    expect(panel).not.toMatch(/width:\s*\d+px/);
    expect(panel).toContain('flex-wrap');
  });
});
