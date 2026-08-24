// ── QA personas are staging-only at BOTH ends ──────────────────────────────
//
// The two SIGN-IN paths (auth.signInDummy, auth.redeemTestLoginLink) have been
// gated on TEST_LOGIN_ENABLED since Slice 3, so a QA persona minted in
// production could never actually be used. The production-readiness inventory
// found the other end open: admin.createDummyUser and admin.issueTestLoginLink
// were gated on the `qa.manage` PERMISSION but not on the ENVIRONMENT, so a
// production Super Admin could accumulate frozen test accounts and inert
// sign-in links.
//
// Not an exposure - both artefacts were unusable - but production should not
// collect them, and an administrator should be told the machinery is off rather
// than handed something that silently does nothing.
//
// These call the real router, because "declared behind a check" and "refused by
// that check" are different claims.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';

vi.mock('./db', () => ({
  getDb: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserByUsername: vi.fn(),
  normalizeEmail: (value: string) => value?.trim().toLowerCase(),
  normalizeUsername: (value: string) => value?.trim().toLowerCase(),
  revokeSession: vi.fn(),
}));

import { getDb } from './db';

const NOW = new Date('2026-08-24T00:00:00Z');

const superAdminCtx = (): TrpcContext => ({
  user: {
    id: 1, openId: 'admin-1', email: 'a@t.com', name: 'Admin', username: 'admin',
    loginMethod: 'password', role: 'admin', adminRole: 'SUPER_ADMIN', userRole: 'admin',
    accountStatus: 'active', onboardingStatus: 'approved', isDummy: false,
    createdAt: NOW, updatedAt: NOW, lastSignedIn: NOW,
  } as TrpcContext['user'],
  req: { protocol: 'https', headers: {} } as TrpcContext['req'],
  res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
});

function stubDb(rows: unknown[] = []) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  Object.assign(builder, {
    from: vi.fn(self), where: vi.fn(self), orderBy: vi.fn(self), limit: vi.fn(self),
    then: (resolve: (value: unknown) => unknown) => resolve(rows),
  });
  const db = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([{ insertId: 42 }]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]) })) })),
  };
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
  return db;
}

const ORIGINAL = process.env.TEST_LOGIN_ENABLED;
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.TEST_LOGIN_ENABLED;
  else process.env.TEST_LOGIN_ENABLED = ORIGINAL;
});

describe('QA persona machinery is refused where test login is off', () => {
  it('createDummyUser is refused, and writes nothing', async () => {
    delete process.env.TEST_LOGIN_ENABLED;
    const db = stubDb([]);
    const caller = appRouter.createCaller(superAdminCtx());
    await expect(
      caller.admin.createDummyUser({ userRole: 'homeowner', name: 'QA' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // The refusal must come before the insert, not after it.
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('issueTestLoginLink is refused, and mints no token', async () => {
    delete process.env.TEST_LOGIN_ENABLED;
    const db = stubDb([]);
    const caller = appRouter.createCaller(superAdminCtx());
    await expect(
      caller.admin.issueTestLoginLink({ userId: 5 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('the refusal is NOT_FOUND, so the endpoint looks absent rather than switched off', async () => {
    // Matches the sign-in paths deliberately. FORBIDDEN would confirm there is
    // a test-login mechanism to go hunting for.
    delete process.env.TEST_LOGIN_ENABLED;
    stubDb([]);
    const caller = appRouter.createCaller(superAdminCtx());
    await expect(caller.admin.createDummyUser({ userRole: 'homeowner' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(caller.admin.createDummyUser({ userRole: 'homeowner' }))
      .rejects.not.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('fails closed on every truthy-looking value that is not exactly "true"', async () => {
    // The flag standing between a production deployment and a password-less
    // session must not accept near-misses.
    for (const value of ['1', 'yes', 'TRUE', 'True', ' true', 'true ', '']) {
      process.env.TEST_LOGIN_ENABLED = value;
      stubDb([]);
      const caller = appRouter.createCaller(superAdminCtx());
      await expect(
        caller.admin.issueTestLoginLink({ userId: 5 }),
        `TEST_LOGIN_ENABLED=${JSON.stringify(value)} must not enable QA personas`,
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('staging still works: with the flag exactly "true" the gate lets the call through', async () => {
    // The other half of the claim. A gate that refuses everywhere is not a
    // gate, it is a removal - and staging depends on these two endpoints.
    process.env.TEST_LOGIN_ENABLED = 'true';
    const db = stubDb([]);
    const caller = appRouter.createCaller(superAdminCtx());
    const result = await caller.admin.createDummyUser({ userRole: 'homeowner', name: 'QA' });
    expect(result.success).toBe(true);
    expect(db.insert).toHaveBeenCalled();
    expect(result.email).toMatch(/^dummy\+[0-9a-f]{12}@buildhub\.test$/);
  });

  it('a QA persona is created frozen and deactivated, so the flag is not the only thing stopping it', async () => {
    // Defence in depth, asserted rather than assumed: even on staging the
    // persona cannot sign in until an administrator activates it.
    process.env.TEST_LOGIN_ENABLED = 'true';
    const values = vi.fn().mockResolvedValue([{ insertId: 42 }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
      select: () => ({ from: () => ({ where: () => ({ then: (r: (v: unknown) => unknown) => r([]) }) }) }),
      insert: vi.fn(() => ({ values })),
    });
    const caller = appRouter.createCaller(superAdminCtx());
    await caller.admin.createDummyUser({ userRole: 'contractor' });
    const inserted = values.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.isDummy).toBe(true);
    expect(inserted.accountStatus).toBe('frozen');
    expect(inserted.deactivatedAt).toBeInstanceOf(Date);
    expect(inserted.role).toBe('user');
    // The §18 claim: a QA user receives no administrator authority of any kind.
    expect(inserted.adminRole).toBeUndefined();
  });
});
