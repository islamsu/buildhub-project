import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({
  getDb: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserByUsername: vi.fn(),
  normalizeEmail: vi.fn((v: string) => v),
  normalizeUsername: vi.fn((v: string) => v),
  revokeSession: vi.fn(),
  isSessionRevoked: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import * as db from './db';

const FULL_ROW = {
  id: 10,
  openId: 'user-10',
  username: 'testuser',
  name: 'Test User',
  email: 'test@example.com',
  phone: '0100000000',
  loginMethod: 'manus',
  role: 'user' as const,
  accountSource: 'self_registered' as const,
  isDummy: false,
  createdBy: null,
  creationNote: null,
  deactivatedAt: null,
  accountStatus: 'active' as const,
  frozenAt: null,
  frozenReason: null,
  userRole: 'contractor' as const,
  avatar: null,
  bio: 'Some bio',
  location: 'Cairo',
  verified: true,
  onboardingStatus: 'approved' as const,
  onboardingReviewNotes: 'internal note',
  onboardingReviewedAt: null,
  onboardingReviewedBy: null,
  invitationStatus: 'password_set' as const,
  invitationToken: 'super-secret-invite-token-abc123',
  invitationExpiresAt: null,
  invitationSentAt: null,
  passwordSetAt: null,
  passwordHash: 'scrypt$deadbeef$0123456789abcdef',
  rating: '4.50',
  reviewCount: 3,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  lastSignedIn: new Date('2025-01-01'),
};

function makeCtx(overrides: Record<string, unknown> = {}): TrpcContext {
  return {
    user: { ...FULL_ROW, ...overrides } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  };
}

function makeAnonCtx(): TrpcContext {
  return { user: null, req: { protocol: 'https', headers: {} } as TrpcContext['req'], res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'] };
}

describe('auth.me - response shape (Phase 4A.6.6)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('an authenticated user receives only the approved allowlist of fields', async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.auth.me();
    expect(result).toEqual({
      id: 10,
      name: 'Test User',
      email: 'test@example.com',
      role: 'user',
      userRole: 'contractor',
      onboardingStatus: 'approved',
    });
  });

  it('passwordHash is never present in the response', async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.auth.me();
    expect(result).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(result)).not.toContain('scrypt$');
  });

  it('invitationToken is never present in the response', async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.auth.me();
    expect(result).not.toHaveProperty('invitationToken');
    expect(JSON.stringify(result)).not.toContain('super-secret-invite-token');
  });

  it('other sensitive/internal fields (frozenReason, onboardingReviewNotes, invitationStatus, phone, bio, location, openId, username) are absent', async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.auth.me();
    for (const forbidden of ['frozenReason', 'onboardingReviewNotes', 'invitationStatus', 'invitationExpiresAt', 'invitationSentAt', 'passwordSetAt', 'phone', 'bio', 'location', 'openId', 'username', 'creationNote', 'accountStatus', 'accountSource', 'createdBy', 'deactivatedAt', 'frozenAt', 'onboardingReviewedAt', 'onboardingReviewedBy', 'isDummy', 'avatar', 'rating', 'reviewCount']) {
      expect(Object.keys(result as object)).not.toContain(forbidden);
    }
  });

  it('role, userRole, and onboardingStatus remain available - required by existing role-routing logic', async () => {
    const caller = appRouter.createCaller(makeCtx({ role: 'admin', adminRole: 'SUPER_ADMIN', userRole: 'homeowner', onboardingStatus: 'under_review' }));
    const result = await caller.auth.me();
    expect(result).toMatchObject({ role: 'admin', userRole: 'homeowner', onboardingStatus: 'under_review' });
  });

  it('unauthenticated auth.me remains null, unchanged from before this phase', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.auth.me()).resolves.toBeNull();
  });

  it('does not use select().from(users) to build the response - it is a pure pick from the already-authenticated ctx.user, not a second query', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('function toPublicSessionUser'), source.indexOf('const authRouter = router({') + 'const authRouter = router({'.length + 200);
    expect(block).toContain('toPublicSessionUser');
    expect(block).not.toMatch(/select\(\)\.from\(users\)/);
  });
});

describe('internal authorization still uses the full ctx.user (unaffected by the auth.me response allowlist)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('admin functionality (adminProcedure) still works - gated on the real ctx.user.role, not the trimmed DTO', async () => {
    /*
     * A REACHABLE database, not a null one.
     *
     * This used `getDb -> null` to make admin.settings a no-op and asserted
     * only that it resolved. That stopped working when admin.settings began
     * FAILING on an unreachable database instead of serving DEFAULT_ADMIN_SETTINGS
     * as though they were the stored ones - which an administrator could then
     * have saved over the real settings.
     *
     * The subject is unchanged and the positive control is now stronger: the
     * admin caller reaches a body that runs, the non-admin is still refused by
     * the tier before any of it.
     */
    (db.getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
      select: () => ({ from: () => Promise.resolve([]) }),
    });
    const adminCaller = appRouter.createCaller(makeCtx({ role: 'admin', adminRole: 'SUPER_ADMIN' }));
    await expect(adminCaller.admin.settings()).resolves.toBeDefined();

    const nonAdminCaller = appRouter.createCaller(makeCtx({ role: 'user' }));
    await expect(nonAdminCaller.admin.settings()).rejects.toThrow();
  });

  it('provider functionality (approvedProviderProcedure) still works - gated on the real ctx.user.userRole/onboardingStatus', async () => {
    (db.getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]), orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }),
    });
    const approvedProvider = appRouter.createCaller(makeCtx({ userRole: 'contractor', onboardingStatus: 'approved' }));
    await expect(approvedProvider.projects.directory()).resolves.toBeDefined();

    const unapprovedProvider = appRouter.createCaller(makeCtx({ userRole: 'contractor', onboardingStatus: 'under_review' }));
    await expect(unapprovedProvider.projects.directory()).rejects.toThrow();
  });

  it('homeowner functionality (protectedProcedure) still works - a homeowner reaches their own projects list', async () => {
    // A real Drizzle builder is BOTH awaitable and chainable. This mock only
    // offered `.orderBy()`, so the scope helper - which awaits `.where()`
    // directly to collect the caller's project ids - got a plain object back
    // and failed on "owned is not iterable". Modelling both shapes is what the
    // driver actually does; narrowing the production code to suit the fake
    // would have been the wrong repair.
    const rows: unknown[] = [];
    const chain: any = {
      orderBy: vi.fn().mockResolvedValue(rows),
      limit: vi.fn(() => chain),
      then: (resolve: any, reject?: any) => Promise.resolve(rows).then(resolve, reject),
    };
    (db.getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn(() => chain) }) }),
    });
    const homeowner = appRouter.createCaller(makeCtx({ userRole: 'homeowner' }));
    await expect(homeowner.projects.list()).resolves.toEqual([]);
  });
});

describe('auth.logout - server-side session revocation (Phase 4A.6.6)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revokes the current session when the context carries a sessionJti', async () => {
    const expiresAt = new Date('2027-01-01');
    const caller = appRouter.createCaller(makeCtx({ sessionJti: 'jti-abc-123', sessionExpiresAt: expiresAt }));

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(db.revokeSession).toHaveBeenCalledTimes(1);
    expect(db.revokeSession).toHaveBeenCalledWith('jti-abc-123', 10, expiresAt);
  });

  it('does not attempt revocation when no sessionJti is present (legacy/pre-migration token, or already-anonymous request) - preserves the pre-existing auth.logout.test.ts contract exactly', async () => {
    const caller = appRouter.createCaller(makeCtx()); // no sessionJti override - FULL_ROW has none

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(db.revokeSession).not.toHaveBeenCalled();
  });

  it('logging out one session does not touch any other session for the same user - revokeSession is called with only the caller\'s own jti, never a list of all the user\'s sessions', async () => {
    const caller = appRouter.createCaller(makeCtx({ sessionJti: 'jti-device-A', sessionExpiresAt: new Date('2027-01-01') }));
    await caller.auth.logout();
    expect(db.revokeSession).toHaveBeenCalledWith('jti-device-A', 10, expect.any(Date));
    expect(db.revokeSession).not.toHaveBeenCalledWith(expect.stringContaining('device-B'), expect.anything(), expect.anything());
  });
});

describe('sdk.ts wiring - session issuance and revocation check (source verification)', () => {
  it('signSession assigns a unique jti to every issued token', () => {
    const source = readFileSync(new URL('./_core/sdk.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('async signSession'), source.indexOf('async verifySession'));
    expect(block).toContain('.setJti(randomUUID())');
  });

  it('verifySession extracts jti from the token payload and returns it (not silently dropped)', () => {
    const source = readFileSync(new URL('./_core/sdk.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('async verifySession'), source.indexOf('async getUserInfoWithJwt'));
    expect(block).toContain('jti');
    expect(block).toContain('jti: isNonEmptyString(jti) ? jti : null');
  });

  it('authenticateRequest rejects a session whose jti is revoked, before ever reaching the DB user lookup for that request', () => {
    const source = readFileSync(new URL('./_core/sdk.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('async authenticateRequest'), source.indexOf('const sessionUserId = session.openId'));
    expect(block).toContain('db.isSessionRevoked(session.jti)');
    expect(block).toContain('ForbiddenError("Session has been signed out")');
  });

  it('a token with no jti (issued before this phase) is never treated as revoked - isSessionRevoked is only called when session.jti is truthy', () => {
    const source = readFileSync(new URL('./_core/sdk.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('async authenticateRequest'), source.indexOf('const sessionUserId = session.openId'));
    expect(block).toMatch(/if \(session\.jti && \(await db\.isSessionRevoked\(session\.jti\)\)\)/);
  });

  it('the OAuth (real-user) login path signs sessions through the same signSession/createSessionToken used by dummy sign-in - no separate, unrevoked code path exists', () => {
    const oauthSource = readFileSync(new URL('./_core/oauth.ts', import.meta.url), 'utf8');
    expect(oauthSource).toContain('sdk.createSessionToken');
  });
});
