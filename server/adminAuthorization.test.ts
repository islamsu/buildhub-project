// ── Administrator authentication, RBAC and least privilege ─────────────────
//
// The claims this file has to defend, in order of how much damage a regression
// would do:
//
//   1. Nobody but an administrator reaches an admin endpoint.
//   2. An administrator reaches only what their ROLE permits.
//   3. No administrator except a Super Admin can touch the authority model,
//      and not even a Super Admin can re-role or deactivate themselves.
//   4. An invitation is single-use, expiring, revocable and unguessable.
//   5. No password, hash or raw token ever leaves the server or reaches a log.
//
// These call the real router through createCaller rather than reading source
// text. Source assertions have their place - authorizationSweep.test.ts pins
// which tier each endpoint declares - but a tier declared correctly and a tier
// ENFORCED correctly are different claims, and only one of them is what an
// attacker meets.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import {
  ADMIN_ROLES, ADMIN_ROLE_PERMISSIONS, hasAdminPermission, permissionsForAdminRole,
  type AdminRole,
} from '@shared/adminRoles';

vi.mock('./db', () => ({
  getDb: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserByUsername: vi.fn(),
  normalizeEmail: (value: string) => value?.trim().toLowerCase(),
  normalizeUsername: (value: string) => value?.trim().toLowerCase(),
  revokeSession: vi.fn(),
}));

import { getDb, getUserByUsername } from './db';

const NOW = new Date('2026-08-24T00:00:00Z');

function ctxFor(overrides: Record<string, unknown> = {}): TrpcContext {
  return {
    user: {
      id: 1, openId: 'admin-1', email: 'a@t.com', name: 'Admin', username: 'admin',
      loginMethod: 'password', role: 'admin', adminRole: 'SUPER_ADMIN', userRole: 'admin',
      accountStatus: 'active', onboardingStatus: 'approved', isDummy: false,
      createdAt: NOW, updatedAt: NOW, lastSignedIn: NOW,
      ...overrides,
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  };
}
const anonCtx = (): TrpcContext => ({
  user: null,
  req: { protocol: 'https', headers: {} } as TrpcContext['req'],
  res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
});

/**
 * A db double that answers enough for the procedure under test to run.
 *
 * Two shapes, and the split is load-bearing:
 *
 *   - the BUILDER is thenable, because Drizzle lets you chain `.orderBy(...)`
 *     after `.where(...)` or just await it;
 *   - `db` ITSELF must not be, because the code does `await getDb()`. A
 *     thenable resolves recursively, so a thenable db was unwrapped into its
 *     own row array and every call then failed with "db.select is not a
 *     function" - a defect in the double that says nothing about the code.
 */
function stubDb(rows: unknown[] = []) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  Object.assign(builder, {
    from: vi.fn(self), where: vi.fn(self), orderBy: vi.fn(self),
    limit: vi.fn(self), for: vi.fn(self),
    then: (resolve: (value: unknown) => unknown) => resolve(rows),
  });
  const db = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([{ insertId: 42 }]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]) })) })),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
  return db;
}

beforeEach(() => vi.clearAllMocks());

// ── 1. The permission table itself ─────────────────────────────────────────

describe('the permission model fails closed', () => {
  it('gives NOTHING to an unresolvable role', () => {
    // The single most important property here. A row whose adminRole is null,
    // misspelt, or left over from a role deleted in a later release must hold
    // no permissions - never the default ones.
    for (const bogus of [null, undefined, '', 'ADMIN', 'super_admin', 'SUPERADMIN', 0, {}, []]) {
      expect(permissionsForAdminRole(bogus), String(bogus)).toEqual([]);
      expect(hasAdminPermission(bogus, 'users.read'), String(bogus)).toBe(false);
      expect(hasAdminPermission(bogus, 'admins.manage'), String(bogus)).toBe(false);
    }
  });

  it('gives admins.manage to SUPER_ADMIN and to nobody else', () => {
    // Everything about least privilege rests on this one line.
    const holders = ADMIN_ROLES.filter(role => hasAdminPermission(role, 'admins.manage'));
    expect(holders).toEqual(['SUPER_ADMIN']);
  });

  it('gives qa.manage to SUPER_ADMIN alone', () => {
    // A QA link signs in as any business role, so issuing one is closer to
    // account creation than to support work.
    expect(ADMIN_ROLES.filter(role => hasAdminPermission(role, 'qa.manage'))).toEqual(['SUPER_ADMIN']);
  });

  it('grants each specialist role only its own domain', () => {
    expect(hasAdminPermission('BILLING_ADMIN', 'billing.manage')).toBe(true);
    expect(hasAdminPermission('BILLING_ADMIN', 'marketplace.manage')).toBe(false);
    expect(hasAdminPermission('BILLING_ADMIN', 'users.manage')).toBe(false);
    expect(hasAdminPermission('SUPPORT_ADMIN', 'support.manage')).toBe(true);
    expect(hasAdminPermission('SUPPORT_ADMIN', 'billing.read')).toBe(false);
    expect(hasAdminPermission('MARKETPLACE_ADMIN', 'marketplace.manage')).toBe(true);
    expect(hasAdminPermission('MARKETPLACE_ADMIN', 'settings.manage')).toBe(false);
    expect(hasAdminPermission('USER_ADMIN', 'users.manage')).toBe(true);
    expect(hasAdminPermission('USER_ADMIN', 'billing.manage')).toBe(false);
  });

  it('lets every role read the user directory, since the dashboard shell needs it', () => {
    for (const role of ADMIN_ROLES) expect(hasAdminPermission(role, 'users.read'), role).toBe(true);
  });

  it('SUPER_ADMIN holds every permission there is', () => {
    for (const role of ADMIN_ROLES) {
      for (const permission of ADMIN_ROLE_PERMISSIONS[role]) {
        expect(hasAdminPermission('SUPER_ADMIN', permission), permission).toBe(true);
      }
    }
  });
});

// ── 2. Reaching the admin surface at all ───────────────────────────────────

describe('who may reach an admin endpoint', () => {
  it('refuses an anonymous caller with UNAUTHORIZED', async () => {
    stubDb();
    await expect(appRouter.createCaller(anonCtx()).admin.users())
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuses a normal authenticated user with FORBIDDEN', async () => {
    stubDb();
    const customer = ctxFor({ role: 'user', adminRole: null, userRole: 'homeowner' });
    await expect(appRouter.createCaller(customer).admin.users())
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses role=admin with NO adminRole - the pre-0020 shape', async () => {
    // Fails closed rather than defaulting to full authority. Migration 0020
    // backfills real rows, so this can only be a row created wrongly later.
    //
    // BOTH endpoints, and the second is the one that matters. admin.users is
    // adminWith('users.read'), so hasAdminPermission(null, ...) refuses it
    // whatever the door does - an earlier version of this test asserted only
    // that, passed for the wrong reason, and survived deleting the door check
    // entirely. admin.me is bare adminProcedure, so it exercises the door and
    // nothing else.
    stubDb();
    await expect(appRouter.createCaller(ctxFor({ adminRole: null })).admin.users())
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(appRouter.createCaller(ctxFor({ adminRole: null })).admin.me())
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses an unrecognised adminRole at the door, not merely per-permission', async () => {
    stubDb();
    await expect(appRouter.createCaller(ctxFor({ adminRole: 'ROOT' })).admin.me())
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses an adminRole that is not a real role', async () => {
    stubDb();
    await expect(appRouter.createCaller(ctxFor({ adminRole: 'ROOT' })).admin.users())
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('admits a properly-roled administrator', async () => {
    stubDb([]);
    await expect(appRouter.createCaller(ctxFor()).admin.users()).resolves.toBeDefined();
  });
});

// ── 3. Role-scoped authority ───────────────────────────────────────────────

describe('an administrator reaches only their own domain', () => {
  it('lets a BILLING_ADMIN drive billing', async () => {
    stubDb([]);
    await expect(appRouter.createCaller(ctxFor({ adminRole: 'BILLING_ADMIN' })).admin.vendorBilling({ userId: 11 }))
      .resolves.toBeDefined();
  });

  it('refuses that same BILLING_ADMIN the compliance queue', async () => {
    stubDb([]);
    await expect(appRouter.createCaller(ctxFor({ adminRole: 'BILLING_ADMIN' })).admin.complianceQueue({}))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a SUPPORT_ADMIN the billing lifecycle', async () => {
    stubDb([]);
    await expect(appRouter.createCaller(ctxFor({ adminRole: 'SUPPORT_ADMIN' })).admin.changeVendorPlan({ userId: 11, plan: 'premium' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a MARKETPLACE_ADMIN the platform settings', async () => {
    stubDb([]);
    await expect(appRouter.createCaller(ctxFor({ adminRole: 'MARKETPLACE_ADMIN' })).admin.settings())
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a USER_ADMIN the QA persona tools', async () => {
    // QA links sign in as a real business role; that is not user administration.
    stubDb([]);
    await expect(appRouter.createCaller(ctxFor({ adminRole: 'USER_ADMIN' })).admin.issueTestLoginLink({ userId: 5 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('reports each administrator their OWN permissions, derived not stored', async () => {
    for (const role of ADMIN_ROLES) {
      const me = await appRouter.createCaller(ctxFor({ adminRole: role })).admin.me();
      expect(me.adminRole).toBe(role);
      expect(me.permissions).toEqual(permissionsForAdminRole(role));
      expect(me).not.toHaveProperty('passwordHash');
    }
  });
});

// ── 4. Least privilege around the authority model ──────────────────────────

describe('only a Super Admin shapes administrator authority', () => {
  const managementCalls: [string, (c: ReturnType<typeof appRouter.createCaller>) => Promise<unknown>][] = [
    ['admins', c => c.admin.admins()],
    ['createAdmin', c => c.admin.createAdmin({ name: 'X', email: 'x@t.com', username: 'xadmin', adminRole: 'SUPPORT_ADMIN' })],
    ['setAdminRole', c => c.admin.setAdminRole({ userId: 9, adminRole: 'SUPER_ADMIN' })],
    ['setAdminActive', c => c.admin.setAdminActive({ userId: 9, active: false })],
    ['revokeAdminSessions', c => c.admin.revokeAdminSessions({ userId: 9 })],
    ['resetAdminPassword', c => c.admin.resetAdminPassword({ userId: 9 })],
    ['revokeAdminInvitation', c => c.admin.revokeAdminInvitation({ invitationId: 3 })],
  ];

  for (const role of ADMIN_ROLES.filter(r => r !== 'SUPER_ADMIN')) {
    it(`refuses every management call to a ${role}`, async () => {
      stubDb([]);
      for (const [name, call] of managementCalls) {
        await expect(call(appRouter.createCaller(ctxFor({ adminRole: role }))), `${role} -> ${name}`)
          .rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
    });
  }

  it('a sub-admin cannot elevate ITSELF', async () => {
    // The escalation that matters most: pointing setAdminRole at your own id.
    stubDb([]);
    await expect(appRouter.createCaller(ctxFor({ id: 7, adminRole: 'SUPPORT_ADMIN' })).admin.setAdminRole({ userId: 7, adminRole: 'SUPER_ADMIN' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('not even a Super Admin can re-role themselves', async () => {
    // Otherwise one misclick leaves a platform where nobody can manage
    // administrators, and no path back in through the application.
    stubDb([]);
    await expect(appRouter.createCaller(ctxFor({ id: 7 })).admin.setAdminRole({ userId: 7, adminRole: 'SUPPORT_ADMIN' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('not even a Super Admin can deactivate themselves', async () => {
    stubDb([]);
    await expect(appRouter.createCaller(ctxFor({ id: 7 })).admin.setAdminActive({ userId: 7, active: false }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a Super Admin CAN re-role and deactivate somebody else', async () => {
    stubDb([{ id: 9, role: 'admin', adminRole: 'SUPPORT_ADMIN', username: 'other' }]);
    const caller = appRouter.createCaller(ctxFor({ id: 7 }));
    await expect(caller.admin.setAdminRole({ userId: 9, adminRole: 'BILLING_ADMIN' })).resolves.toMatchObject({ success: true });
    await expect(caller.admin.setAdminActive({ userId: 9, active: false })).resolves.toMatchObject({ success: true });
  });

  it('refuses to re-role a target who is not an administrator', async () => {
    stubDb([{ id: 9, role: 'user', adminRole: null, username: 'customer' }]);
    await expect(appRouter.createCaller(ctxFor({ id: 7 })).admin.setAdminRole({ userId: 9, adminRole: 'SUPER_ADMIN' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('every administrator may change their OWN password, and cannot name a target', async () => {
    // changeOwnPassword is adminProcedure by design. What stops it becoming a
    // way to seize another account is that it accepts no userId at all - so
    // this asserts the input schema rejects one.
    stubDb([{ passwordHash: null }]);
    const caller = appRouter.createCaller(ctxFor({ adminRole: 'SUPPORT_ADMIN' }));
    await expect(
      caller.admin.changeOwnPassword({ currentPassword: 'x', newPassword: 'a-long-enough-password', userId: 9 } as never),
    ).rejects.toBeDefined();
  });
});

// ── 5. Administrator sign-in ───────────────────────────────────────────────

describe('the administrator door', () => {
  const account = {
    id: 5, openId: 'local-5', username: 'boss', email: 'boss@t.com', name: 'Boss',
    role: 'admin', adminRole: 'SUPER_ADMIN', accountStatus: 'active', deactivatedAt: null,
    isDummy: false, passwordHash: 'scrypt$aa$bb',
  };

  it('refuses a customer with the SAME message as a wrong password', async () => {
    // The endpoint must not become an oracle for which accounts are
    // administrators, so both rejections have to be indistinguishable.
    stubDb();
    (getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({ ...account, role: 'user', adminRole: null });
    const notAdmin = await appRouter.createCaller(anonCtx()).auth.adminSignIn({ identifier: 'boss', password: 'whatever' })
      .then(() => null, (error: Error) => error.message);

    (getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const noSuchUser = await appRouter.createCaller(anonCtx()).auth.adminSignIn({ identifier: 'ghost', password: 'whatever' })
      .then(() => null, (error: Error) => error.message);

    expect(notAdmin).toBeTruthy();
    expect(notAdmin).toBe(noSuchUser);
  });

  it('refuses an administrator whose role is missing', async () => {
    stubDb();
    (getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({ ...account, adminRole: null });
    await expect(appRouter.createCaller(anonCtx()).auth.adminSignIn({ identifier: 'boss', password: 'x' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuses a QA persona outright, whatever its role column says', async () => {
    // QA accounts can never hold administrator authority. Excluded before
    // anything else is considered.
    stubDb();
    (getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({ ...account, isDummy: true });
    await expect(appRouter.createCaller(anonCtx()).auth.adminSignIn({ identifier: 'boss', password: 'x' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuses a deactivated administrator', async () => {
    stubDb();
    (getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({ ...account, accountStatus: 'frozen' });
    await expect(appRouter.createCaller(anonCtx()).auth.adminSignIn({ identifier: 'boss', password: 'x' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuses an account that has never set a password', async () => {
    // An invited administrator who has not yet redeemed their link.
    stubDb();
    (getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({ ...account, passwordHash: null });
    await expect(appRouter.createCaller(anonCtx()).auth.adminSignIn({ identifier: 'boss', password: 'x' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

// ── 6. Nothing secret ever leaves ──────────────────────────────────────────

describe('no credential material crosses the wire', () => {
  it('the administrator directory returns an explicit column allowlist', async () => {
    const row = {
      id: 3, name: 'A', username: 'a', email: 'a@t.com', adminRole: 'USER_ADMIN',
      accountStatus: 'active', deactivatedAt: null, invitationStatus: 'none',
      createdAt: NOW, lastSignedIn: NOW, passwordSetAt: NOW,
    };
    stubDb([row]);
    const result = await appRouter.createCaller(ctxFor()).admin.admins();
    const serialised = JSON.stringify(result);
    for (const forbidden of ['passwordHash', 'passwordResetToken', 'invitationToken', 'tokenHash', 'scrypt$']) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
  });

  it('the invitation list never returns a token or its hash', async () => {
    stubDb([{ id: 1, adminRole: 'SUPPORT_ADMIN', invitedBy: 1, createdAt: NOW, expiresAt: NOW, usedAt: null, revokedAt: null }]);
    const result = await appRouter.createCaller(ctxFor()).admin.adminInvitations({ userId: 9 });
    expect(JSON.stringify(result)).not.toContain('tokenHash');
    expect(JSON.stringify(result)).not.toContain('token');
  });
});

// ── 7. Revocation actually revokes ─────────────────────────────────────────

describe('killing a session leaves no window', () => {
  const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');

  it('deactivation, revocation and admin-initiated reset all round the cutoff UP', () => {
    // authenticateRequest compares whole seconds with `issuedSecond <
    // cutoffSecond`. That strict `<` is correct where a NEW session is minted in
    // the same second - a password reset would otherwise log out the person who
    // just reset. Where nothing is being minted it leaves a one-second window in
    // which a deactivated administrator keeps working.
    //
    // Found by driving it live: a sub-admin signed in and was deactivated inside
    // the same second, and their session survived. These three sites round the
    // cutoff up so nothing issued in that second can pass.
    expect(ROUTERS).toContain('const revocationCutoff = () => new Date(Date.now() + 1000)');
    for (const [name, next] of [
      ['setAdminActive', 'revokeAdminSessions'],
      ['revokeAdminSessions', 'resetAdminPassword'],
      ['resetAdminPassword', 'adminInvitations: superAdminProcedure'],
    ] as const) {
      const block = ROUTERS.slice(ROUTERS.indexOf(`${name}: superAdminProcedure`), ROUTERS.indexOf(next));
      expect(block, name).toContain('sessionsInvalidBefore: revocationCutoff()');
    }
  });

  it('changing your OWN password does NOT round up, because it re-cookies you', () => {
    // The one case where the tolerance is load-bearing: this mints a replacement
    // session in the same second, and rounding up would sign out the
    // administrator who just changed their password.
    const block = ROUTERS.slice(ROUTERS.indexOf('changeOwnPassword: adminProcedure'));
    expect(block).toContain('sessionsInvalidBefore: new Date()');
    expect(block).not.toContain('revocationCutoff()');
    // ...and it hands back a fresh cookie, which is what makes that safe.
    expect(block).toContain('ctx.res.cookie(COOKIE_NAME');
  });
});

// ── 9. The other door onto the authority model ─────────────────────────────
//
// Section 4 asserts that only a Super Admin may shape administrator authority,
// and it does so against admin.admins/createAdmin/setAdminRole/... - the
// endpoints that obviously belong to that model. The gap it left is that
// admin.createUser writes the SAME `role` column from a completely different
// permission, `users.manage`, which USER_ADMIN holds. Its enum accepted
// 'admin', and the row it wrote said role='admin'.
//
// That never granted a permission - `adminRole` stays null and every
// adminWith(...) endpoint fails closed on a null role - so this is not a
// privilege escalation. It is something narrower and still worth closing: a
// row the rest of the platform treats as an administrator wherever it checks
// `role` rather than `adminRole`. Concretely it is exempt from the
// frozen-account check in _core/trpc.ts, it renders the admin menu, and it
// exists without the adminInvitations row and `admin_created` audit event that
// are the only record of an administrator being created.
describe('createUser cannot be a second way to make an administrator', () => {
  const draft = { username: 'newuser', email: 'new@t.com', name: 'New User', phone: '+201000000000' };

  it("refuses userRole:'admin' - the input schema does not offer it", async () => {
    stubDb([]);
    (getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      appRouter.createCaller(ctxFor({ adminRole: 'USER_ADMIN' }))
        .admin.createUser({ ...draft, userRole: 'admin' } as never),
    ).rejects.toBeDefined();
  });

  it('writes role=user for every role it DOES accept', async () => {
    // The enum is one half. This is the other: even if a later edit widened the
    // enum again, the insert must not derive `role` from what was submitted.
    for (const userRole of ['homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager'] as const) {
      const db = stubDb([]);
      (getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      await appRouter.createCaller(ctxFor({ adminRole: 'USER_ADMIN' }))
        .admin.createUser({ ...draft, username: `u_${userRole}`, email: `${userRole}@t.com`, userRole });
      const inserted = db.insert.mock.results[0].value.values.mock.calls[0][0];
      expect(inserted.role, `${userRole} must not become an authorization admin`).toBe('user');
      expect(inserted.userRole).toBe(userRole);
    }
  });

  it('the source no longer derives the authorization column from the request', () => {
    // Reading source as well as behaviour, because the failure mode here is a
    // future edit reintroducing the ternary rather than the current code being
    // wrong. `role:` inside admin.createUser must be a literal.
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const createUser = source.slice(source.indexOf("  createUser: adminWith('users.manage')"));
    const body = createUser.slice(0, createUser.indexOf('\n  resendInvitation:'));
    expect(body).not.toMatch(/role:\s*input\./);
    expect(body).toContain("role: 'user'");
  });

  it('the Create-account dialog offers no admin option either', () => {
    // Not security - the server is the control - but a UI that offers a choice
    // the server rejects is a defect of its own.
    const page = readFileSync(new URL('../client/src/pages/AdminDashboard.tsx', import.meta.url), 'utf8');
    expect(page).toContain("ROLE_GROUPS.filter(group => group.key !== 'admin')");
  });
});
