import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';

function makeCtx(userId: number, role: 'user' | 'admin' = 'user', userRole = 'homeowner'): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@test.com`,
      name: `User ${userId}`,
      loginMethod: 'manus',
      role,
      adminRole: role === 'admin' ? 'SUPER_ADMIN' : null,
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

describe('admin.projectDetail', () => {
  it('is gated on users.read and names a projectId input', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    expect(source).toContain("projectDetail: adminWith('users.read')");
    expect(source).toContain('projectId: z.number().int().positive()');
  });

  it('denies a non-admin caller', async () => {
    const caller = appRouter.createCaller(makeCtx(1, 'user', 'homeowner'));
    await expect(caller.admin.projectDetail({ projectId: 7 })).rejects.toThrow();
  });

  it('denies an unauthenticated caller', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.admin.projectDetail({ projectId: 7 })).rejects.toThrow();
  });
});
