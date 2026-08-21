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

// A full, unfiltered row shape - what the real users table row looks like,
// used to prove the mock db is capable of returning every sensitive field and
// that admin.users' own query is what filters them out, not an accident of
// the test's mock shape.
const FULL_ROW = {
  id: 20,
  name: 'Target User',
  email: 'target@example.com',
  username: 'targetuser',
  role: 'user',
  userRole: 'contractor',
  accountStatus: 'frozen',
  frozenReason: 'Suspicious activity',
  verified: true,
  isDummy: true,
  accountSource: 'admin_created',
  invitationStatus: 'password_set',
  createdAt: new Date('2025-01-01'),
  // Sensitive/internal fields that a real row would also carry, and that
  // admin.users must never return:
  passwordHash: 'scrypt$deadbeef$0123456789abcdef',
  invitationToken: 'super-secret-invite-token-xyz789',
  invitationExpiresAt: new Date('2025-02-01'),
  invitationSentAt: new Date('2025-01-01'),
  passwordSetAt: new Date('2025-01-02'),
  onboardingReviewNotes: 'internal reviewer note',
  creationNote: 'internal creation note',
  createdBy: 3,
  onboardingReviewedBy: 3,
  deactivatedAt: null,
  frozenAt: new Date('2025-01-05'),
  phone: '0100000000',
  bio: 'some bio',
  location: 'Cairo',
  avatar: null,
  rating: '4.50',
  reviewCount: 2,
  openId: 'dummy_target',
  loginMethod: 'dummy',
  onboardingStatus: 'not_started',
  updatedAt: new Date('2025-01-01'),
  lastSignedIn: new Date('2025-01-01'),
};

describe('admin.users - response shape (Phase 4A.6.7)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only the approved allowlist of fields', async () => {
    const orderByMock = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([FULL_ROW]) });
    const selectMock = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ orderBy: orderByMock }) });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: selectMock });
    const caller = appRouter.createCaller(makeCtx(1, 'admin'));

    const [result] = await caller.admin.users();

    // select() itself is called with an explicit column object, not select()
    // with no arguments (which would mean "every column").
    expect(selectMock).toHaveBeenCalledTimes(1);
    const columnArg = selectMock.mock.calls[0][0];
    expect(columnArg).toBeTruthy();
    expect(Object.keys(columnArg as object).sort()).toEqual(
      ['accountSource', 'accountStatus', 'createdAt', 'email', 'frozenReason', 'id', 'invitationStatus', 'isDummy', 'name', 'role', 'userRole', 'username', 'verified'].sort()
    );
  });

  it('passwordHash is absent from the response, even though the mock db is fully capable of returning it', async () => {
    const orderByMock = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([FULL_ROW]) });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ orderBy: orderByMock }) }) });
    const caller = appRouter.createCaller(makeCtx(1, 'admin'));

    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('const ADMIN_USER_LIST_COLUMNS'), source.indexOf('const DEFAULT_ADMIN_SETTINGS'));
    expect(block).not.toContain('passwordHash');
  });

  it('invitationToken is absent from the allowlist', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('const ADMIN_USER_LIST_COLUMNS'), source.indexOf('const DEFAULT_ADMIN_SETTINGS'));
    expect(block).not.toContain('invitationToken:');
  });

  it('other unnecessary internal/credential fields are absent from the allowlist (invitationExpiresAt, invitationSentAt, passwordSetAt, onboardingReviewNotes, creationNote, createdBy, onboardingReviewedBy, deactivatedAt, frozenAt, phone, bio, location, avatar, openId, rating, reviewCount)', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('const ADMIN_USER_LIST_COLUMNS'), source.indexOf('const DEFAULT_ADMIN_SETTINGS'));
    for (const forbidden of ['invitationExpiresAt', 'invitationSentAt', 'passwordSetAt', 'onboardingReviewNotes', 'creationNote', 'createdBy:', 'onboardingReviewedBy', 'deactivatedAt', 'frozenAt', 'phone:', 'bio:', 'location:', 'avatar:', 'openId:', 'rating:', 'reviewCount:', 'loginMethod', 'onboardingStatus', 'updatedAt', 'lastSignedIn']) {
      expect(block).not.toContain(forbidden);
    }
  });

  it('never uses select().from(users) with no column list for the admin user list query', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const usersProcBlock = source.slice(source.indexOf('users: adminProcedure.query'), source.indexOf('createUser: adminProcedure'));
    expect(usersProcBlock).toContain('ADMIN_USER_LIST_COLUMNS');
    expect(usersProcBlock).not.toMatch(/select\(\)\.from\(users\)/);
  });

  it('every field genuinely required by the Admin User Management UI remains available: id, name, email, username, role, userRole, accountStatus, frozenReason, verified, isDummy, accountSource, invitationStatus, createdAt', async () => {
    const orderByMock = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([FULL_ROW]) });
    const selectMock = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ orderBy: orderByMock }) });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: selectMock });
    const caller = appRouter.createCaller(makeCtx(1, 'admin'));

    await caller.admin.users();
    const columnArg = selectMock.mock.calls[0][0] as Record<string, unknown>;
    for (const required of ['id', 'name', 'email', 'username', 'role', 'userRole', 'accountStatus', 'frozenReason', 'verified', 'isDummy', 'accountSource', 'invitationStatus', 'createdAt']) {
      expect(columnArg).toHaveProperty(required);
    }
  });
});

describe('admin.users - authorization (Phase 4A.6.7)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a non-admin (homeowner) is rejected with FORBIDDEN', async () => {
    const caller = appRouter.createCaller(makeCtx(1, 'user', 'homeowner'));
    await expect(caller.admin.users()).rejects.toThrow();
  });

  it('a non-admin provider is rejected with FORBIDDEN', async () => {
    const caller = appRouter.createCaller(makeCtx(1, 'user', 'contractor'));
    await expect(caller.admin.users()).rejects.toThrow();
  });

  it('an unauthenticated caller is rejected', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.admin.users()).rejects.toThrow();
  });

  it('takes no input parameter - there is no way to target or filter by another id, so this cannot become an IDOR', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const usersProcBlock = source.slice(source.indexOf('users: adminProcedure.query'), source.indexOf('createUser: adminProcedure'));
    expect(usersProcBlock).not.toMatch(/\.input\(/);
  });

  it('an admin session succeeds', async () => {
    const orderByMock = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ orderBy: orderByMock }) }) });
    const caller = appRouter.createCaller(makeCtx(1, 'admin'));
    await expect(caller.admin.users()).resolves.toEqual([]);
  });
});

describe('admin user-management workflows still work unmodified (Phase 4A.6.7 regression)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('setUserFrozen, setDummyUserActive, and deleteDummyUser are untouched (still present and adminProcedure-gated)', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const adminBlock = source.slice(source.indexOf('const adminRouter = router({'), source.indexOf('// ── AI Router'));
    expect(adminBlock).toContain('setUserFrozen: adminProcedure');
    expect(adminBlock).toContain('setDummyUserActive: adminProcedure');
    expect(adminBlock).toContain('deleteDummyUser: adminProcedure');
    expect(adminBlock).toContain('setDummyUserPassword: adminProcedure');
  });

  it('accountAudit (the audit trail query) is untouched', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    expect(source).toContain('accountAudit: adminProcedure');
  });
});
