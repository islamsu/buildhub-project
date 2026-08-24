import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({
  getDb: vi.fn(),
  isSessionRevoked: vi.fn().mockResolvedValue(false),
  revokeSession: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';

// Phase 4A.6.8: this file does NOT add any account-state check to the
// application. Live reproduction (real curl calls against a real dev server +
// MariaDB, documented in BUILDHUB_PHASE4A68_ACCOUNT_SESSION_SECURITY.md)
// proved that server/_core/trpc.ts's `requireUser` middleware already
// re-checks `ctx.user.accountStatus` on every protectedProcedure-gated
// request - not only at sign-in. These tests exist purely to lock that
// already-correct, pre-existing behavior in place so a future edit cannot
// silently regress it back to a login-only check.
function makeCtx(overrides: Partial<TrpcContext['user']> = {}): TrpcContext {
  return {
    user: {
      id: 5,
      openId: 'dummy_5',
      email: null,
      name: 'Target User',
      loginMethod: 'dummy',
      role: 'user',
      userRole: 'contractor',
      accountStatus: 'active',
      onboardingStatus: 'approved',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      ...overrides,
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  };
}

function makeAnonCtx(): TrpcContext {
  return { user: null, req: { protocol: 'https', headers: {} } as TrpcContext['req'], res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'] };
}

describe('requireUser middleware re-checks account state on every request (Phase 4A.6.8)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a session whose account is currently frozen is rejected on a protectedProcedure endpoint, even though the session token itself is still valid', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const caller = appRouter.createCaller(makeCtx({ accountStatus: 'frozen', role: 'user' }));
    await expect(caller.notifications.unreadCount()).rejects.toThrow(/frozen/i);
  });

  it('a session whose account is active succeeds on the same endpoint', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const caller = appRouter.createCaller(makeCtx({ accountStatus: 'active', role: 'user' }));
    await expect(caller.notifications.unreadCount()).resolves.toEqual({ count: 0 });
  });

  it('a frozen non-admin session is rejected regardless of userRole (homeowner, contractor, engineer)', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    for (const userRole of ['homeowner', 'contractor', 'engineer']) {
      const caller = appRouter.createCaller(makeCtx({ accountStatus: 'frozen', role: 'user', userRole }));
      await expect(caller.notifications.unreadCount()).rejects.toThrow(/frozen/i);
    }
  });

  it('DOCUMENTS the existing, deliberate admin exemption: a frozen admin session still passes requireUser (live-verified in the Phase 4A.6.8 report; only another admin can freeze an admin account, since self-freeze is separately blocked)', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const caller = appRouter.createCaller(makeCtx({ accountStatus: 'frozen', role: 'admin' }));
    await expect(caller.notifications.unreadCount()).resolves.toEqual({ count: 0 });
  });

  it('auth.me still returns profile data for a frozen account (publicProcedure - a user must be able to see their own frozen status without hitting protectedProcedure)', async () => {
    const caller = appRouter.createCaller(makeCtx({ accountStatus: 'frozen' }));
    await expect(caller.auth.me()).resolves.toMatchObject({ id: 5 });
  });

  it('auth.logout still works for a frozen account (publicProcedure - a frozen user must still be able to sign out)', async () => {
    const caller = appRouter.createCaller(makeCtx({ accountStatus: 'frozen', sessionJti: null } as Partial<TrpcContext['user']>));
    await expect(caller.auth.logout()).resolves.toEqual({ success: true });
  });

  it('an anonymous (unauthenticated) caller is rejected the same way regardless of account state', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.notifications.unreadCount()).rejects.toThrow();
  });
});

describe('requireUser source wiring is intact (Phase 4A.6.8 regression guard)', () => {
  it('trpc.ts still contains the per-request frozen-account check inside requireUser, gating protectedProcedure', () => {
    const source = readFileSync(new URL('./_core/trpc.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('const requireUser'), source.indexOf('export const protectedProcedure'));
    expect(block).toMatch(/accountStatus\s*===\s*['"]frozen['"]/);
    expect(block).toContain("role !== 'admin'");
  });

  it('signInDummy still blocks sign-in for a frozen or deactivated dummy account at the login boundary (unchanged from Phase 4A.6.5/4A.6.6)', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    expect(source).toContain("target.accountStatus !== 'active' || target.deactivatedAt");
  });

  it('admin.setDummyUserActive and admin.setUserFrozen still exist and drive accountStatus, unmodified by this phase', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const adminBlock = source.slice(source.indexOf('const adminRouter = router({'), source.indexOf('// ── AI Router'));
    expect(adminBlock).toContain("setDummyUserActive: adminWith('qa.manage')");
    expect(adminBlock).toContain("setUserFrozen: adminWith('users.manage')");
    expect(adminBlock).toContain("input.userId === ctx.user.id");
  });
});
