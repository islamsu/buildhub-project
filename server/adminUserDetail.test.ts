import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';

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

const DETAIL_ROW = {
  id: 20,
  name: 'Hakeem Architect',
  username: 'hakeem',
  email: 'hakeem@buildhub.com',
  phone: '+966500000000',
  role: 'user',
  userRole: 'architect',
  accountStatus: 'active',
  frozenReason: null,
  verified: true,
  isDummy: false,
  accountSource: 'self_registered',
  invitationStatus: 'none',
  onboardingStatus: 'approved',
  location: 'Riyadh',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-02'),
  companyName: 'Hakeem Building Materials',
  tradingName: 'Hakeem Interiors',
  passwordHash: 'must-never-be-returned',
  invitationToken: 'must-never-be-returned',
};

describe('admin.userDetail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the management identity for one user without credential fields', async () => {
    const limitMock = vi.fn().mockResolvedValue([DETAIL_ROW]);
    const leftJoinMock = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: limitMock }) });
    const selectMock = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ leftJoin: leftJoinMock }) });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: selectMock });

    const caller = appRouter.createCaller(makeCtx(1, 'admin'));
    const result = await caller.admin.userDetail({ userId: 20 });

    expect(result).toMatchObject({ id: 20, name: 'Hakeem Architect', companyName: 'Hakeem Building Materials' });

    const columns = selectMock.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(columns)).not.toContain('passwordHash');
    expect(Object.keys(columns)).not.toContain('invitationToken');
  });

  it('denies a non-admin caller', async () => {
    const caller = appRouter.createCaller(makeCtx(9, 'user', 'homeowner'));
    await expect(caller.admin.userDetail({ userId: 20 })).rejects.toThrow();
  });

  it('denies an unauthenticated caller', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.admin.userDetail({ userId: 20 })).rejects.toThrow();
  });

  it('provides an allowlisted user-edit procedure gated on users.manage', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    expect(source).toContain("updateUser: adminWith('users.manage')");
    expect(source).toContain('Administrator roles are managed from Admin Management');
  });

  it('denies a non-admin from editing a user', async () => {
    const caller = appRouter.createCaller(makeCtx(1, 'user', 'homeowner'));
    await expect(caller.admin.updateUser({
      userId: 20,
      name: 'Changed Name',
    })).rejects.toThrow();
  });
});
