import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { filterRegistrationApplicants } from '../shared/registrationMetrics';

vi.mock('./db', () => ({
  getDb: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserByUsername: vi.fn(),
  normalizeEmail: (value: string | null | undefined) => value?.trim().toLowerCase() || null,
  normalizeUsername: (value: string | null | undefined) => value?.trim().toLowerCase() || null,
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb, getUserByEmail, getUserByUsername } from './db';

function makeCtx(role: 'admin' | 'user' = 'admin'): TrpcContext {
  return {
    user: {
      id: 1,
      openId: 'test-open-id',
      email: 'admin@example.com',
      name: 'Test Admin',
      loginMethod: 'test',
      role,
      userRole: role === 'admin' ? 'admin' : 'homeowner',
      accountStatus: 'active',
      isDummy: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  };
}

describe('admin account management', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an admin-created account with role, provenance, and audit event', async () => {
    (getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const valuesMock = vi.fn().mockResolvedValueOnce([{ insertId: 42 }]).mockResolvedValueOnce([]);
    const db = { insert: vi.fn().mockReturnValue({ values: valuesMock }) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const result = await appRouter.createCaller(makeCtx()).admin.createUser({
      username: 'managed.contractor',
      email: 'managed@example.com',
      name: 'Managed Contractor',
      userRole: 'contractor',
      note: 'Created for onboarding support',
    });

    expect(result).toEqual({ success: true, userId: 42 });
    expect(valuesMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ username: 'managed.contractor', email: 'managed@example.com', accountSource: 'admin_created', isDummy: false, createdBy: 1, userRole: 'contractor', onboardingStatus: 'not_started' }));
    expect(valuesMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ userId: 42, action: 'admin_created_account', source: 'admin_created' }));
  });

  it('rejects duplicate username or email before inserting an admin-created account', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 9 });
    await expect(appRouter.createCaller(makeCtx()).admin.createUser({ username: 'existing', email: 'new@example.com', name: 'Duplicate', userRole: 'homeowner' })).rejects.toThrow('Username is already in use');
    expect(getUserByEmail).not.toHaveBeenCalled();
  });

  it('creates a frozen dummy account with a test marker and audit event', async () => {
    (getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const valuesMock = vi.fn().mockResolvedValueOnce([{ insertId: 55 }]).mockResolvedValueOnce([]);
    const db = { insert: vi.fn().mockReturnValue({ values: valuesMock }) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const result = await appRouter.createCaller(makeCtx()).admin.createDummyUser({ userRole: 'supplier', note: 'QA fixture' });

    expect(result.success).toBe(true);
    expect(result.email).toMatch(/^dummy\+.*@buildhub\.test$/);
    expect(valuesMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ isDummy: true, accountSource: 'admin_created', loginMethod: 'dummy', accountStatus: 'frozen', userRole: 'supplier', createdBy: 1 }));
    expect(valuesMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ userId: 55, action: 'dummy_user_created', source: 'dummy' }));
  });

  it('allows only admins to access dummy-user creation', async () => {
    await expect(appRouter.createCaller(makeCtx('user')).admin.createDummyUser({ userRole: 'homeowner' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('activates and deactivates only records marked as dummy', async () => {
    const whereSelect = vi.fn().mockResolvedValue([{ id: 55, isDummy: true }]);
    const updateWhere = vi.fn().mockResolvedValue([]);
    const valuesMock = vi.fn().mockResolvedValue([]);
    const db = {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: whereSelect }) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: updateWhere }) }),
      insert: vi.fn().mockReturnValue({ values: valuesMock }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    await expect(appRouter.createCaller(makeCtx()).admin.setDummyUserActive({ userId: 55, active: true })).resolves.toEqual({ success: true, active: true });
    expect(updateWhere).toHaveBeenCalled();
    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'dummy_user_activated', source: 'dummy' }));
  });
});

describe('dummy account isolation and UI wiring', () => {
  it('excludes dummy registrations by default and includes them only when requested', () => {
    const applicants = [
      { id: 1, userRole: 'contractor', onboardingStatus: 'under_review', isDummy: false },
      { id: 2, userRole: 'contractor', onboardingStatus: 'under_review', isDummy: true },
    ];
    expect(filterRegistrationApplicants(applicants)).toHaveLength(1);
    expect(filterRegistrationApplicants(applicants, { includeDummy: true })).toHaveLength(2);
  });

  it('exposes source, dummy controls, and account audit wiring in the admin UI and router', () => {
    const dashboard = readFileSync(new URL('../client/src/pages/AdminDashboard.tsx', import.meta.url), 'utf8');
    const router = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    expect(dashboard).toContain('Create account');
    expect(dashboard).toContain('Dummy user');
    expect(dashboard).toContain('Test/Dummy');
    expect(dashboard).toContain('Account audit trail');
    expect(dashboard).toContain('Include test data');
    expect(router).toContain('createUser: adminProcedure');
    expect(router).toContain('createDummyUser: adminProcedure');
    expect(router).toContain("action: 'dummy_user_deleted'");
  });
});
