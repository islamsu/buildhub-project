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

  it('an approved provider receives the fields the directory workflow actually needs', async () => {
    const row = { id: 1, title: 'Villa Renovation', type: 'residential', status: 'active', location: 'Cairo', progress: 40, updatedAt: new Date() };
    const columns: Record<string, unknown> = {};
    const select = vi.fn((cols: Record<string, unknown>) => {
      Object.assign(columns, cols);
      return {
        from: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve([row]),
          }),
        }),
      };
    });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select });

    const caller = appRouter.createCaller(makeCtx(1, 'contractor'));
    const result = await caller.projects.directory();

    expect(result).toEqual([row]);
    // Explicit field selection, not db.select().from(projects) (which would select *).
    expect(Object.keys(columns).sort()).toEqual(['id', 'location', 'progress', 'status', 'title', 'type', 'updatedAt'].sort());
  });

  it('never selects budget or spent (private homeowner financial fields)', async () => {
    const columns: Record<string, unknown> = {};
    const select = vi.fn((cols: Record<string, unknown>) => {
      Object.assign(columns, cols);
      return { from: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) };
    });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select });

    const caller = appRouter.createCaller(makeCtx(1, 'contractor'));
    await caller.projects.directory();

    expect(columns).not.toHaveProperty('budget');
    expect(columns).not.toHaveProperty('spent');
    expect(columns).not.toHaveProperty('ownerId');
  });

  it('still requires an approved provider role (existing gate unaffected)', async () => {
    const select = vi.fn();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select });
    const caller = appRouter.createCaller(makeCtx(1, 'homeowner'));
    await expect(caller.projects.directory()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(select).not.toHaveBeenCalled();
  });
});
