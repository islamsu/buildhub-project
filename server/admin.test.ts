import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { getDb } from './db';

function makeAdminCtx(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `admin-${userId}`,
      email: `admin${userId}@test.com`,
      name: 'BuildHub Admin',
      loginMethod: 'manus',
      role: 'admin',
      userRole: 'admin',
      accountStatus: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  };
}

describe('admin user controls', () => {
  beforeEach(() => vi.clearAllMocks());

  it('freezes and unfreezes another user with a persistent status', async () => {
    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    const db = { update: vi.fn().mockReturnValue({ set: setMock }) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeAdminCtx());

    await expect(caller.admin.setUserFrozen({ userId: 7, frozen: true, reason: 'Policy review' })).resolves.toEqual({ success: true, status: 'frozen' });
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ accountStatus: 'frozen', frozenReason: 'Policy review', frozenAt: expect.any(Date) }));

    await expect(caller.admin.setUserFrozen({ userId: 7, frozen: false })).resolves.toEqual({ success: true, status: 'active' });
    expect(setMock).toHaveBeenLastCalledWith({ accountStatus: 'active', frozenAt: null, frozenReason: null });
  });

  it('prevents an administrator from freezing their own account', async () => {
    const caller = appRouter.createCaller(makeAdminCtx(9));
    await expect(caller.admin.setUserFrozen({ userId: 9, frozen: true })).rejects.toThrow('cannot freeze their own account');
  });
});

describe('admin disputes and settings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns disputes with reporter and respondent names', async () => {
    let selectCount = 0;
    const db = {
      select: vi.fn(() => {
        selectCount += 1;
        if (selectCount === 1) {
          return { from: () => ({ orderBy: () => Promise.resolve([{ id: 3, reporterId: 10, respondentId: 11, title: 'Payment issue', description: 'Late payment', type: 'payment', priority: 'high', status: 'open', resolutionNotes: null, createdAt: new Date(), updatedAt: new Date() }]) }) };
        }
        return { from: () => Promise.resolve([{ id: 10, name: 'Homeowner' }, { id: 11, name: 'Contractor' }]) };
      }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.disputes()).resolves.toEqual([expect.objectContaining({ reporterName: 'Homeowner', respondentName: 'Contractor', status: 'open' })]);
  });

  it('updates a dispute status and resolution notes', async () => {
    const whereMock = vi.fn().mockResolvedValue([]);
    const db = { update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: whereMock }) }) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.updateDispute({ disputeId: 4, status: 'resolved', resolutionNotes: 'Refund confirmed.' })).resolves.toEqual({ success: true });
    expect(db.update().set).toHaveBeenCalledWith({ status: 'resolved', resolutionNotes: 'Refund confirmed.' });
  });

  it('persists a known admin setting and rejects unknown keys', async () => {
    const whereMock = vi.fn().mockResolvedValue([{ id: 2 }]);
    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    const db = {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: whereMock }) }),
      update: vi.fn().mockReturnValue({ set: setMock }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.updateSetting({ key: 'maintenanceMode', value: 'true' })).resolves.toEqual({ success: true });
    expect(setMock).toHaveBeenCalledWith({ value: 'true', updatedBy: 1 });
    await expect(caller.admin.updateSetting({ key: 'notAllowed', value: 'true' })).rejects.toThrow('Unknown setting key');
  });
});
