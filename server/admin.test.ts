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
      adminRole: 'SUPER_ADMIN', // migration 0020: an admin row must now say WHICH administrator it is
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

  /**
   * setUserFrozen now READS ITS TARGET before writing.
   *
   * It has to: the target decides which authority the action needs. Freezing an
   * ordinary user is what `users.manage` is for; freezing an ADMINISTRATOR is
   * an Admin Management act needing `admins.manage`, and freezing the last
   * usable Super Admin is refused outright. The fake therefore has to answer a
   * select - which is not test scaffolding for its own sake, it is the shape of
   * the endpoint changing.
   */
  const freezeDb = (target: Record<string, unknown>, superAdminsRemaining = 3) => {
    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    const insertMock = vi.fn().mockResolvedValue([]);
    let call = 0;
    const db = {
      // First select is the target lookup; any later one is the Super Admin
      // survival count.
      select: vi.fn().mockImplementation(() => ({
        from: () => ({
          where: () => {
            call += 1;
            return Promise.resolve(call === 1 ? [target] : [{ total: superAdminsRemaining }]);
          },
        }),
      })),
      update: vi.fn().mockReturnValue({ set: setMock }),
      insert: vi.fn().mockReturnValue({ values: insertMock }),
    };
    return { db, setMock };
  };

  it('freezes and unfreezes another user with a persistent status', async () => {
    const ordinary = { id: 7, role: 'user', adminRole: null };
    const first = freezeDb(ordinary);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(first.db);
    const caller = appRouter.createCaller(makeAdminCtx());

    await expect(caller.admin.setUserFrozen({ userId: 7, frozen: true, reason: 'Policy review' })).resolves.toEqual({ success: true, status: 'frozen' });
    expect(first.setMock).toHaveBeenCalledWith(expect.objectContaining({ accountStatus: 'frozen', frozenReason: 'Policy review', frozenAt: expect.any(Date) }));

    const second = freezeDb(ordinary);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(second.db);
    await expect(caller.admin.setUserFrozen({ userId: 7, frozen: false })).resolves.toEqual({ success: true, status: 'active' });
    expect(second.setMock).toHaveBeenLastCalledWith({ accountStatus: 'active', frozenAt: null, frozenReason: null });
  });

  it('prevents an administrator from freezing their own account', async () => {
    const caller = appRouter.createCaller(makeAdminCtx(9));
    await expect(caller.admin.setUserFrozen({ userId: 9, frozen: true })).rejects.toThrow('cannot freeze their own account');
  });

  it('REFUSES to freeze a user that no longer exists, rather than writing anyway', async () => {
    const { db, setMock } = freezeDb(undefined as unknown as Record<string, unknown>);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.setUserFrozen({ userId: 999, frozen: true })).rejects.toThrow('No such user');
    expect(setMock).not.toHaveBeenCalled();
  });

  it('REFUSES to freeze the last usable Super Admin, even for a Super Admin caller', async () => {
    const { db, setMock } = freezeDb({ id: 7, role: 'admin', adminRole: 'SUPER_ADMIN' }, 0);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.setUserFrozen({ userId: 7, frozen: true }))
      .rejects.toThrow('At least one active Super Admin is required');
    expect(setMock, 'nothing may be written when the guard refuses').not.toHaveBeenCalled();
  });
});

describe('deleteDummyUser (Phase 3C: FK-constraint aware deletion)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes a dummy user with no related records', async () => {
    const selectWhereMock = vi.fn().mockResolvedValue([{ id: 6, isDummy: true, creationNote: 'test account' }]);
    const insertValuesMock = vi.fn().mockResolvedValue([]);
    const deleteWhereMock = vi.fn().mockResolvedValue([]);
    const db = {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: selectWhereMock }) }),
      insert: vi.fn().mockReturnValue({ values: insertValuesMock }),
      delete: vi.fn().mockReturnValue({ where: deleteWhereMock }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeAdminCtx());

    await expect(caller.admin.deleteDummyUser({ userId: 6 })).resolves.toEqual({ success: true });
    expect(db.delete).toHaveBeenCalled();
  });

  it('rejects deleting a non-dummy user', async () => {
    const selectWhereMock = vi.fn().mockResolvedValue([{ id: 6, isDummy: false }]);
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: selectWhereMock }) }) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeAdminCtx());

    await expect(caller.admin.deleteDummyUser({ userId: 6 })).rejects.toThrow('Only dummy users can be deleted');
  });

  it('converts a foreign-key-restrict database error into a clear CONFLICT instead of leaking the raw driver error', async () => {
    const selectWhereMock = vi.fn().mockResolvedValue([{ id: 6, isDummy: true, creationNote: 'test account' }]);
    const insertValuesMock = vi.fn().mockResolvedValue([]);
    const fkError = Object.assign(new Error('Failed query'), {
      cause: { code: 'ER_ROW_IS_REFERENCED_2', message: 'Cannot delete or update a parent row: a foreign key constraint fails' },
    });
    const deleteWhereMock = vi.fn().mockRejectedValue(fkError);
    const db = {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: selectWhereMock }) }),
      insert: vi.fn().mockReturnValue({ values: insertValuesMock }),
      delete: vi.fn().mockReturnValue({ where: deleteWhereMock }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeAdminCtx());

    await expect(caller.admin.deleteDummyUser({ userId: 6 })).rejects.toThrow('still has related records');
  });
});

describe('admin disputes and settings', () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * RESTATED, NOT WEAKENED.
   *
   * This asserted that `admin.disputes` returned a bare ARRAY whose rows
   * carried resolved names - which was satisfied by the implementation's two
   * defects: no pagination, and every user on the platform read into memory to
   * map two names per row. A test that asserts an array cannot see that the
   * array is unbounded.
   *
   * It now asserts the same thing it always meant - the names are resolved and
   * the row is real - over the paged envelope, PLUS the total and the page
   * bounds it could not see before. Strictly stronger: it fails if the queue
   * stops paging, and server/disputeAdminView.test.ts fails if it goes back to
   * scanning the user table.
   */
  it('returns a page of disputes, with a real total and resolved names', async () => {
    const row = {
      id: 3, reference: 'DSP-2026-000003', reporterId: 10, respondentId: 11,
      title: 'Late delivery', description: 'Arrived short', status: 'open', priority: 'high',
      reporterName: 'Homeowner', respondentName: 'Contractor', createdAt: new Date(),
    };
    const db = {
      select: vi.fn((projection?: Record<string, unknown>) => {
        const keys = Object.keys(projection ?? {});
        const data = keys.includes('count') && keys.includes('status') ? [{ status: 'open', count: 1 }]
          : keys.includes('count') ? [{ count: 1 }]
            : [row];
        const chain: any = new Proxy({}, {
          get: (_target, key) => (key === 'then'
            ? (resolve: any, reject: any) => Promise.resolve(data).then(resolve, reject)
            : () => chain),
        });
        return chain;
      }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeAdminCtx());
    const page = await caller.admin.disputes({ page: 0, pageSize: 25 });
    expect(page.rows).toEqual([expect.objectContaining({
      reporterName: 'Homeowner', respondentName: 'Contractor', status: 'open',
    })]);
    expect(page).toMatchObject({ total: 1, page: 0, pageSize: 25 });
    expect(page.counts.open).toBe(1);
  });

  /**
   * THIS TEST PINNED THE DEFECT.
   *
   * It asserted that `updateDispute` called `set({ status, resolutionNotes })`
   * and returned success - which is exactly what was wrong with it: any status
   * from any state, no check that the dispute existed, no record of who moved
   * it or from what, and nothing told to the parties. A test that asserts a
   * blind write is satisfied by a blind write.
   *
   * Restated against the behaviour that replaced it. Strictly stronger: it now
   * fails if the transition is not checked, if the history is not written, or
   * if a resolution is accepted without saying how it was resolved.
   */
  function disputeDb(dispute: Record<string, unknown> | null) {
    const updates: Array<Record<string, unknown>> = [];
    const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const tx: any = {
      select: () => ({ from: () => ({ where: () => ({ for: async () => (dispute ? [dispute] : []) }) }) }),
      update: () => ({ set: (values: Record<string, unknown>) => ({ where: async () => { updates.push(values); } }) }),
      insert: (table: unknown) => ({ values: async (values: Record<string, unknown>) => { inserts.push({ table, values }); } }),
    };
    const db: any = {
      transaction: (run: (tx: unknown) => Promise<unknown>) => run(tx),
      // notifyDisputeParties and recordAccountEvent write through the outer db.
      insert: (table: unknown) => ({ values: async (values: Record<string, unknown>) => { inserts.push({ table, values }); } }),
    };
    return { db, updates, inserts };
  }

  const OPEN_DISPUTE = {
    id: 4, status: 'open', reporterId: 10, respondentId: 11,
    reference: 'DSP-2026-000004', title: 'Late delivery',
  };

  it('resolves a dispute, recording HOW it was resolved and who did it', async () => {
    const { db, updates, inserts } = disputeDb(OPEN_DISPUTE);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeAdminCtx());

    await expect(caller.admin.updateDispute({
      disputeId: 4, status: 'resolved',
      resolutionType: 'resolved_by_agreement',
      resolutionNotes: 'The parties agreed a revised delivery date.',
    })).resolves.toEqual({ success: true, from: 'open', to: 'resolved' });

    // Never a bare status flip: the outcome TYPE, the summary, and the actor.
    expect(updates[0]).toMatchObject({
      status: 'resolved',
      resolutionType: 'resolved_by_agreement',
      resolutionNotes: 'The parties agreed a revised delivery date.',
      resolvedBy: 1,
    });
    expect(updates[0].resolvedAt).toBeInstanceOf(Date);

    // And the history says where it came from, which nothing recorded before.
    const history = inserts.map(entry => entry.values).find(values => values.toStatus === 'resolved');
    expect(history, 'no status-history row was written').toBeTruthy();
    expect(history).toMatchObject({ disputeId: 4, fromStatus: 'open', toStatus: 'resolved', actorId: 1 });
  });

  it('refuses to resolve without saying how it was resolved', async () => {
    // "How did this end" must be answerable across many disputes without
    // reading prose, and the party on the losing side is entitled to grounds.
    const { db, updates } = disputeDb(OPEN_DISPUTE);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.updateDispute({ disputeId: 4, status: 'resolved', resolutionNotes: 'Sorted.' }))
      .rejects.toThrow(/requires a resolution type/i);
    expect(updates, 'a refused transition must write nothing').toEqual([]);
  });

  it('refuses an illegal transition instead of writing it', async () => {
    const { db, updates } = disputeDb({ ...OPEN_DISPUTE, status: 'withdrawn' });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.updateDispute({ disputeId: 4, status: 'investigating' }))
      .rejects.toThrow(/withdrawn/i);
    expect(updates).toEqual([]);
  });

  it('refuses a dispute that does not exist, rather than reporting success', async () => {
    // The previous version ran an UPDATE matching no rows and returned
    // { success: true }.
    const { db } = disputeDb(null);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.updateDispute({ disputeId: 999, status: 'investigating' }))
      .rejects.toThrow(/not found/i);
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
  const dashboard = readFileSync(new URL('../client/src/pages/AdminDashboard.tsx', import.meta.url), 'utf8');
  // The destinations moved out of DashboardLayout.tsx into a plain data module
  // so they could be asserted rather than grepped. This check follows them
  // instead of being deleted, and gets STRONGER in the move: reading the real
  // list catches a wrong path, where `layout.toContain("path: '/admin/users'")`
  // only ever caught the string's absence and would have passed on a menu
  // entry pointing at a route that does not exist.
  const { ADMIN_NAV } = await import('../client/src/lib/adminNavigation');
  const paths = ADMIN_NAV.map(entry => entry.path);
  for (const section of ['/admin/users', '/admin/compliance', '/admin/disputes', '/admin/analytics', '/admin/settings']) {
    expect(paths).toContain(section);
  }
  // Distinct, which is what "distinct dashboard sections" claims: two entries
  // sharing a path render as active together and one of them is unreachable.
  expect(new Set(paths).size).toBe(paths.length);
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

it('shows a stored freeze reason next to the Frozen status badge', async () => {
  const { readFileSync } = await import('node:fs');
  const dashboard = readFileSync(new URL('../client/src/pages/AdminDashboard.tsx', import.meta.url), 'utf8');
  expect(dashboard).toContain('function formatFreezeReason');
  expect(dashboard).toContain('(userRow as any).frozenReason');
  expect(dashboard).toContain("formatStatus(status, lang)}{isFrozen ?");
});
