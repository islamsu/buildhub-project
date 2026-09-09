import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

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

  /**
   * The original form of this test asserted the literal `reviews.verified, true`
   * inside statsForUser. That was the right claim expressed the wrong way: what
   * it was defending is that there is exactly ONE definition of "a review the
   * public may see", not that a particular reader spells it out inline. Once
   * moderation shipped, "public" became `verified AND NOT hidden`, and an
   * inline literal is precisely the thing that lets a reader drift.
   *
   * So the assertion is now a census over EVERY read of the reviews table,
   * which is strictly stronger: it caught a real defect the literal form could
   * not have caught - `rfq.quotationsForComparison` was aggregating ratings
   * with its own inline `eq(reviews.verified, true)` and would have kept
   * counting reviews a moderator had hidden.
   */
  /**
   * Exemptions are keyed by the ENCLOSING UNIT (tRPC procedure, or exported
   * function in reviewModeration.ts) and by an exact count, not by the shape
   * of the select. A shape-keyed exemption absolves any future reader that
   * happens to look similar - mutation M3 (a brand-new unfiltered
   * `db.select({ id: reviews.id })` inside statsForUser) survived the first
   * version of this guard for exactly that reason. The census covers BOTH
   * files that read the table, because M5 (visibleReviewsFor quietly inlining
   * its own predicate) survived a routers.ts-only census.
   */
  const NOT_PUBLIC_READERS: Readonly<Record<string, { readonly reads: number; readonly why: string }>> = {
    eligibleReviewees: {
      reads: 1,
      why: '"have I already reviewed this provider?" A hidden review still blocks a second one - '
         + 'filtering it out would hand the reviewer a fresh attempt every time moderation hid '
         + 'their last one.',
    },
    submit: {
      reads: 1,
      why: 'the duplicate guard on reviews.submit - same reasoning, and it must see hidden rows or '
         + 'the business rule (one review per reviewer per reviewee per project) is bypassable by '
         + 'getting your first review hidden.',
    },
    moderateReview: {
      reads: 2,
      why: 'the admin procedure loads the row it is about to hide or restore, and the service '
         + 'function behind it re-reads under the same rule - by definition both must be able to '
         + 'load rows that are already hidden.',
    },
    resolveReviewReport: {
      reads: 1,
      why: 'admin loads the reported review, which is very often already hidden.',
    },
    respondToReview: {
      reads: 1,
      why: 'a provider replying to a review addressed to them - the reply path is keyed by review '
         + 'id and enforces its own eligibility (reviewee only, one reply).',
    },
    reportReview: {
      reads: 1,
      why: 'reporting a review is by id; a report on an already-hidden review is still a valid '
         + 'signal for the moderation queue.',
    },
    listReviewReports: {
      reads: 1,
      why: 'the admin moderation queue joins reviews deliberately - a queue that hid hidden '
         + 'reviews would hide exactly the rows a moderator needs to review.',
    },
  };

  it('has exactly one definition of a publicly visible review: every public reader of the reviews table goes through visibleReviewFilter()', () => {
    // Two different shapes of "enclosing unit", one per file.
    const files: { source: string; unit: RegExp }[] = [
      {
        source: readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8')),
        unit: /(\w+):\s*(?:publicProcedure|protectedProcedure|adminProcedure|adminWith\()/g,
      },
      {
        source: readSourceForAssertions(readFileSync(new URL('./reviewModeration.ts', import.meta.url), 'utf8')),
        unit: /export (?:async )?function (\w+)/g,
      },
    ];

    // Selecting from the table and joining to it are both reads.
    const READ_TOKENS = ['.from(reviews)', 'innerJoin(reviews', 'leftJoin(reviews'];

    const reads: { unit: string; statement: string }[] = [];
    for (const file of files) {
      for (const token of READ_TOKENS) {
        for (let cursor = 0; ; ) {
          const at = file.source.indexOf(token, cursor);
          if (at === -1) break;
          cursor = at + 1;

          const end = file.source.indexOf(';', at);
          const start = Math.max(0, file.source.lastIndexOf('db.select', at));
          const statement = file.source.slice(start, end === -1 ? file.source.length : end);
          // A join and its own .from() belong to one statement, counted once.
          if (reads.some(read => read.statement === statement)) continue;

          file.unit.lastIndex = 0;
          let unit = '(top level)';
          for (let m = file.unit.exec(file.source); m !== null && m.index < at; m = file.unit.exec(file.source)) {
            unit = m[1];
          }
          reads.push({ unit, statement });
        }
      }
    }

    // If this drops the census has stopped measuring anything.
    expect(reads.length).toBeGreaterThanOrEqual(10);

    const unfiltered = reads.filter(read => !read.statement.includes('visibleReviewFilter()'));

    // Every unfiltered read must be a declared one, and each declaring unit
    // must have exactly as many as it declared - so a new unfiltered read
    // added inside an already-exempt unit fails too.
    const countByUnit: Record<string, number> = {};
    for (const read of unfiltered) {
      countByUnit[read.unit] = (countByUnit[read.unit] ?? 0) + 1;
    }
    expect(countByUnit).toEqual(
      Object.fromEntries(Object.entries(NOT_PUBLIC_READERS).map(([name, spec]) => [name, spec.reads])));
  });

  it('never inlines the visibility predicate: reviews.verified / reviews.hiddenAt appear in no read filter outside reviewModeration.ts', () => {
    const routers = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));

    // reviews.create writes `verified: true` on insert, which is a write, not a
    // filter. Any *comparison* against the column is a competing definition.
    expect(routers).not.toMatch(/eq\(\s*reviews\.verified/);
    expect(routers).not.toMatch(/reviews\.hiddenAt/);
  });

  it('the one shared definition covers both halves of "public": verified AND not hidden', () => {
    const moderation = readSourceForAssertions(
      readFileSync(new URL('./reviewModeration.ts', import.meta.url), 'utf8'));
    const body = moderation.slice(
      moderation.indexOf('export function visibleReviewFilter'),
      moderation.indexOf('export', moderation.indexOf('export function visibleReviewFilter') + 10));

    expect(body).toContain('eq(reviews.verified, true)');
    expect(body).toContain('isNull(reviews.hiddenAt)');
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
  it('VendorReputation is a single reusable component, used by both VendorProfile and RolePlatform (no duplicate implementation)', () => {
    // Phase 4A.6.4: the real, reachable vendor dashboard is RolePlatform.tsx
    // (/platform/:role) - ProviderDashboard.tsx is now a legacy redirect-only
    // shim with no UI of its own. See BUILDHUB_PHASE4A64_DASHBOARD_INTEGRATION.md.
    const component = readFileSync(new URL('../client/src/components/VendorReputation.tsx', import.meta.url), 'utf8');
    const vendorProfile = readFileSync(new URL('../client/src/pages/VendorProfile.tsx', import.meta.url), 'utf8');
    const rolePlatform = readFileSync(new URL('../client/src/pages/RolePlatform.tsx', import.meta.url), 'utf8');
    const providerDashboard = readFileSync(new URL('../client/src/pages/ProviderDashboard.tsx', import.meta.url), 'utf8');
    expect(component).toContain('reviews.statsForUser');
    expect(component).toContain('reviews.forUser');
    expect(vendorProfile).toContain('VendorReputation');
    expect(rolePlatform).toContain('VendorReputation');
    expect(providerDashboard).not.toContain('VendorReputation');
    // Only one component file defines this rating/count computation.
    expect(vendorProfile).not.toMatch(/reviews\.statsForUser\.useQuery/);
    expect(rolePlatform).not.toMatch(/reviews\.statsForUser\.useQuery/);
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
