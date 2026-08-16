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
    const insertMock = vi.fn().mockResolvedValue([]);
    const db = { update: vi.fn().mockReturnValue({ set: setMock }), insert: vi.fn().mockReturnValue({ values: insertMock }) };
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

describe('bulk registration decisions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates pending applicants in bulk and records the rejection reason', async () => {
    const applicants = [
      { id: 21, userRole: 'contractor', onboardingStatus: 'under_review' },
      { id: 22, userRole: 'supplier', onboardingStatus: 'update_required' },
    ];
    const whereMock = vi.fn().mockResolvedValue(applicants);
    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    const valuesMock = vi.fn().mockResolvedValue([]);
    const db = {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: whereMock }) }),
      update: vi.fn().mockReturnValue({ set: setMock }),
      insert: vi.fn().mockReturnValue({ values: valuesMock }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeAdminCtx());

    await expect(caller.admin.bulkUpdateApplicantStatus({ userIds: [21, 22], status: 'rejected', note: 'Please provide a valid license.' })).resolves.toEqual({ success: true, updatedCount: 2, onboardingStatus: 'rejected' });
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ onboardingStatus: 'rejected', onboardingReviewNotes: 'Please provide a valid license.', verified: false }));
    expect(valuesMock).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ userId: 21, action: 'bulk_applicant_status_updated', status: 'rejected', note: 'Please provide a valid license.' })]));
    expect(valuesMock).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ userId: 22, type: 'compliance', link: '/compliance' })]));
  });

  it('rejects bulk decisions that include an already approved or rejected non-pending applicant', async () => {
    const whereMock = vi.fn().mockResolvedValue([{ id: 31, userRole: 'engineer', onboardingStatus: 'rejected' }]);
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: whereMock }) }), update: vi.fn(), insert: vi.fn() };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeAdminCtx());

    await expect(caller.admin.bulkUpdateApplicantStatus({ userIds: [31], status: 'approved' })).rejects.toThrow('pending applicants');
    expect(db.update).not.toHaveBeenCalled();
  });
});

it('keeps AdminDashboard hooks unconditional before loading and access returns', async () => {
  const { readFileSync } = await import('node:fs');
  const dashboard = readFileSync(new URL('../client/src/pages/AdminDashboard.tsx', import.meta.url), 'utf8');
  const utilsHookIndex = dashboard.indexOf('const utilsTrpc = trpc.useUtils();');
  const loadingReturnIndex = dashboard.indexOf('if (loading) return null;');
  const deniedReturnIndex = dashboard.indexOf('if (!isAdmin) {');
  expect(utilsHookIndex).toBeGreaterThan(-1);
  expect(utilsHookIndex).toBeLessThan(loadingReturnIndex);
  expect(utilsHookIndex).toBeLessThan(deniedReturnIndex);
});

it('wires admin sidebar items to distinct dashboard sections', async () => {
  const { readFileSync } = await import('node:fs');
  const layout = readFileSync(new URL('../client/src/components/DashboardLayout.tsx', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../client/src/pages/AdminDashboard.tsx', import.meta.url), 'utf8');
  expect(layout).toContain("path: '/admin/users'");
  expect(layout).toContain("path: '/admin/compliance'");
  expect(layout).toContain("path: '/admin/disputes'");
  expect(layout).toContain("path: '/admin/analytics'");
  expect(layout).toContain("path: '/admin/settings'");
  expect(dashboard).toContain('<Tabs value={adminSection} onValueChange={handleAdminSectionChange}>');
});

it('provides a required bilingual freeze-reason dropdown in the admin UI', async () => {
  const { readFileSync } = await import('node:fs');
  const dashboard = readFileSync(new URL('../client/src/pages/AdminDashboard.tsx', import.meta.url), 'utf8');
  expect(dashboard).toContain('FREEZE_REASONS');
  expect(dashboard).toContain('Freeze reason');
  expect(dashboard).toContain('سبب التجميد');
  expect(dashboard).toContain("value={freezeReason}");
  expect(dashboard).toContain("freezeReason === 'other'");
  expect(dashboard).toContain('!freezeReason');
});
