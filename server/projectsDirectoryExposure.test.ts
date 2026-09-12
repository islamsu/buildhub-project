import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';

function makeCtx(userId: number, userRole: string, onboardingStatus = 'approved'): TrpcContext {
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
    },
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  } as TrpcContext;
}

describe('projects.directory (live production route)', () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * The db fake, over the WHOLE paged chain.
   *
   * `projects.directory` gained pagination - it returned the fifty most
   * recently updated projects and stopped, with nothing to say there were more.
   * The fake answered `from -> orderBy -> limit` only; a count query and an
   * `offset` now exist as well, and a fake that cannot answer them reports a
   * working route as a 500. Every column the route selects is still recorded,
   * which is the thing these tests are actually about.
   */
  function directoryDb(rows: unknown[], columns: Record<string, unknown>) {
    const select = vi.fn((cols?: Record<string, unknown>) => {
      // The count query projects `{ count }`; only the ROW projection is the
      // column allowlist under test, so the count's own key is not recorded.
      const counting = cols !== undefined && Object.keys(cols).length === 1 && 'count' in cols;
      if (cols && !counting) Object.assign(columns, cols);
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        offset: () => Promise.resolve(rows),
        then: (resolve: any, reject: any) =>
          Promise.resolve(counting ? [{ count: rows.length }] : rows).then(resolve, reject),
      };
      return chain;
    });
    return { select };
  }

  it('an approved provider receives the fields the directory workflow actually needs', async () => {
    const row = { id: 1, title: 'Villa Renovation', type: 'residential', status: 'active', location: 'Cairo', progress: 40, updatedAt: new Date() };
    const columns: Record<string, unknown> = {};
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(directoryDb([row], columns));

    const caller = appRouter.createCaller(makeCtx(1, 'contractor'));
    const result = await caller.projects.directory({ page: 0, pageSize: 25 });

    // The rows are the same rows, now inside a page that also states the total.
    expect(result.rows).toEqual([row]);
    expect(result).toMatchObject({ total: 1, page: 0, pageSize: 25 });
    // Explicit field selection, not db.select().from(projects) (which would select *).
    expect(Object.keys(columns).sort()).toEqual(['id', 'location', 'progress', 'status', 'title', 'type', 'updatedAt'].sort());
  });

  it('never selects budget or spent (private homeowner financial fields)', async () => {
    const columns: Record<string, unknown> = {};
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(directoryDb([], columns));

    const caller = appRouter.createCaller(makeCtx(1, 'contractor'));
    await caller.projects.directory({ page: 0, pageSize: 25 });

    expect(columns).not.toHaveProperty('budget');
    expect(columns).not.toHaveProperty('spent');
    expect(columns).not.toHaveProperty('ownerId');
  });

  it('still requires an approved provider role (existing gate unaffected)', async () => {
    const select = vi.fn();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select });
    const caller = appRouter.createCaller(makeCtx(1, 'homeowner'));
    await expect(caller.projects.directory({ page: 0, pageSize: 25 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(select).not.toHaveBeenCalled();
  });
});
