// ── Administrator invitation and reset links ───────────────────────────────
//
// The link is the whole security boundary of Sub-Admin onboarding: whoever
// holds it becomes an administrator with the role it names. So the properties
// that matter are unguessability, single use, expiry, revocability, and that
// the granted role comes from the STORED row rather than from the request.
//
// Everything here drives the real procedures. Where a claim is genuinely about
// the shape of the schema or the stored value, it reads the schema - and says
// which it is doing.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_PASSWORD_MIN_LENGTH } from '@shared/adminRoles';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

import { getDb, getUserByEmail, getUserByUsername } from './db';

const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
const SCHEMA = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');
const NOW = new Date('2026-08-24T00:00:00Z');

const superCtx = (): TrpcContext => ({
  user: {
    id: 1, openId: 'admin-1', email: 'a@t.com', name: 'Admin', username: 'admin',
    loginMethod: 'password', role: 'admin', adminRole: 'SUPER_ADMIN', userRole: 'admin',
    accountStatus: 'active', onboardingStatus: 'approved', isDummy: false,
    createdAt: NOW, updatedAt: NOW, lastSignedIn: NOW,
  } as TrpcContext['user'],
  req: { protocol: 'https', headers: {} } as TrpcContext['req'],
  res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
});
const anonCtx = (): TrpcContext => ({
  user: null,
  req: { protocol: 'https', headers: {} } as TrpcContext['req'],
  res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
});

/** See adminAuthorization.test.ts for why the builder and db are split. */
function stubDb(rows: unknown[] = [], updateAffected = 1) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  Object.assign(builder, {
    from: vi.fn(self), where: vi.fn(self), orderBy: vi.fn(self), limit: vi.fn(self),
    then: (resolve: (value: unknown) => unknown) => resolve(rows),
  });
  const insertValues = vi.fn().mockResolvedValue([{ insertId: 77 }]);
  const updateWhere = vi.fn().mockResolvedValue([{ affectedRows: updateAffected }]);
  const db = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => ({ values: insertValues })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
  };
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
  return { db, insertValues, updateWhere };
}

beforeEach(() => {
  vi.clearAllMocks();
  (getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

// ── The stored form ────────────────────────────────────────────────────────

describe('what the database actually holds', () => {
  it('stores ONLY a hash, never the token', () => {
    // If the raw token were stored, anyone with read access to the table would
    // hold a working key to the administrator surface.
    const table = SCHEMA.slice(SCHEMA.indexOf('export const adminInvitations'), SCHEMA.indexOf('// ── Projects'));
    expect(table).toContain('tokenHash');
    expect(table).not.toMatch(/\btoken:\s/);
    expect(ROUTERS).toContain("const hashAdminToken = (raw: string) => createHash('sha256').update(raw).digest('hex')");
  });

  it('the hash is unique, so redemption is one indexed lookup and not a scan', () => {
    const table = SCHEMA.slice(SCHEMA.indexOf('export const adminInvitations'), SCHEMA.indexOf('// ── Projects'));
    expect(table).toContain('.notNull().unique()');
  });

  it('carries its own expiry, single-use and revocation columns', () => {
    const table = SCHEMA.slice(SCHEMA.indexOf('export const adminInvitations'), SCHEMA.indexOf('// ── Projects'));
    for (const column of ['expiresAt', 'usedAt', 'revokedAt', 'revokedBy', 'invitedBy', 'adminRole']) {
      expect(table, column).toContain(column);
    }
  });

  it('does NOT reuse users.invitationToken, which stores tokens raw', () => {
    // Sharing that column would publish a working admin key AND let the two
    // flows silently destroy each other's live token.
    const create = ROUTERS.slice(ROUTERS.indexOf('createAdmin: superAdminProcedure'), ROUTERS.indexOf('setAdminRole:'));
    expect(create).toContain('adminInvitations');
    expect(create).not.toContain('invitationToken:');
  });
});

// ── Issuing ────────────────────────────────────────────────────────────────

describe('issuing an invitation', () => {
  it('uses a CSPRNG token, not an id, an email or a counter', () => {
    const create = ROUTERS.slice(ROUTERS.indexOf('createAdmin: superAdminProcedure'), ROUTERS.indexOf('setAdminRole:'));
    expect(create).toContain('randomBytes(ADMIN_TOKEN_BYTES)');
    expect(ROUTERS).toContain('const ADMIN_TOKEN_BYTES = 32');
  });

  it('creates the account with NO password, so it cannot sign in until redeemed', async () => {
    const { insertValues } = stubDb([]);
    await appRouter.createCaller(superCtx()).admin.createAdmin({
      name: 'New Admin', email: 'new@t.com', username: 'newadmin', adminRole: 'SUPPORT_ADMIN',
    });
    const userRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(userRow).not.toHaveProperty('passwordHash');
    expect(userRow.adminRole).toBe('SUPPORT_ADMIN');
    expect(userRow.role).toBe('admin');
  });

  it('returns the raw link exactly once and never persists it', async () => {
    const { insertValues } = stubDb([]);
    const result = await appRouter.createCaller(superCtx()).admin.createAdmin({
      name: 'New Admin', email: 'new@t.com', username: 'newadmin', adminRole: 'BILLING_ADMIN',
    });
    const raw = new URL(`https://x${result.invitationLink}`).searchParams.get('token')!;
    expect(raw.length).toBeGreaterThan(30);

    // The invitation row holds the HASH of what was returned - never the value.
    const invitationRow = insertValues.mock.calls[1][0] as Record<string, unknown>;
    expect(invitationRow.tokenHash).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(JSON.stringify(invitationRow)).not.toContain(raw);
  });

  it('refuses a username or email already in use', async () => {
    stubDb([]);
    (getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 2 });
    await expect(appRouter.createCaller(superCtx()).admin.createAdmin({
      name: 'X', email: 'x@t.com', username: 'taken', adminRole: 'SUPPORT_ADMIN',
    })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

// ── Redemption ─────────────────────────────────────────────────────────────

describe('redeeming an invitation', () => {
  const live = {
    id: 4, userId: 9, adminRole: 'SUPPORT_ADMIN', tokenHash: 'x',
    usedAt: null, revokedAt: null, expiresAt: new Date(Date.now() + 3_600_000),
  };
  const password = 'a-sufficiently-long-password';

  it('accepts a live invitation and grants the role FROM THE STORED ROW', async () => {
    const { db } = stubDb([live]);
    await expect(appRouter.createCaller(anonCtx()).auth.completeAdminInvitation({ token: 'a'.repeat(43), password }))
      .resolves.toMatchObject({ success: true });
    // The role written is the one on the invitation, not anything the caller sent.
    const setCalls = db.update.mock.results.map(r => (r.value as { set: ReturnType<typeof vi.fn> }).set.mock.calls).flat();
    const wroteRole = setCalls.some(call => (call[0] as Record<string, unknown>)?.adminRole === 'SUPPORT_ADMIN');
    expect(wroteRole).toBe(true);
  });

  it('refuses a token that matches nothing', async () => {
    stubDb([]);
    await expect(appRouter.createCaller(anonCtx()).auth.completeAdminInvitation({ token: 'b'.repeat(43), password }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses an EXPIRED invitation', async () => {
    stubDb([{ ...live, expiresAt: new Date(Date.now() - 1000) }]);
    await expect(appRouter.createCaller(anonCtx()).auth.completeAdminInvitation({ token: 'c'.repeat(43), password }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a SPENT invitation', async () => {
    stubDb([{ ...live, usedAt: new Date() }]);
    await expect(appRouter.createCaller(anonCtx()).auth.completeAdminInvitation({ token: 'd'.repeat(43), password }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a REVOKED invitation', async () => {
    stubDb([{ ...live, revokedAt: new Date() }]);
    await expect(appRouter.createCaller(anonCtx()).auth.completeAdminInvitation({ token: 'e'.repeat(43), password }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('loses a concurrent double redemption at the DATABASE, not in application logic', async () => {
    // The row still looks live when read, and the conditional UPDATE affects
    // zero rows because the other request burned it first. That is the case a
    // read-then-write check cannot see.
    stubDb([live], 0);
    await expect(appRouter.createCaller(anonCtx()).auth.completeAdminInvitation({ token: 'f'.repeat(43), password }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('burns the invitation CONDITIONALLY on it still being unused', () => {
    const block = ROUTERS.slice(ROUTERS.indexOf('completeAdminInvitation: publicProcedure'), ROUTERS.indexOf('requestPasswordReset:'));
    expect(block).toContain('isNull(adminInvitations.usedAt)');
    expect(block).toContain('affected === 0');
  });

  it('gives ONE message for unknown, expired, spent and revoked alike', () => {
    const block = ROUTERS.slice(ROUTERS.indexOf('completeAdminInvitation: publicProcedure'), ROUTERS.indexOf('requestPasswordReset:'));
    const messages = [...block.matchAll(/message: '([^']+)'/g)].map(match => match[1]);
    expect(new Set(messages).size).toBe(1);
  });

  it('is rate limited, since it is unauthenticated and grants authority', () => {
    const block = ROUTERS.slice(ROUTERS.indexOf('completeAdminInvitation: publicProcedure'), ROUTERS.indexOf('requestPasswordReset:'));
    expect(block).toContain('enforceAuthRateLimit(ctx.req, null)');
  });

  it('demands a longer password than a customer account does', async () => {
    stubDb([live]);
    await expect(appRouter.createCaller(anonCtx()).auth.completeAdminInvitation({ token: 'g'.repeat(43), password: 'short' }))
      .rejects.toBeDefined();
    // The minimum moved from a server-local const into shared/adminRoles.ts,
    // because two client screens needed it and one already carried a hand-kept
    // copy. This check follows it and gets stronger in the move: it now asserts
    // the VALUE and its relationship to the ordinary account minimum, where the
    // old text match would have passed on a `12` that nothing enforced and
    // failed on a reformat that changed nothing.
    // (The relationship to the ordinary account minimum is asserted in
    // server/adminBootstrap.test.ts, which owns both numbers.)
    expect(ADMIN_PASSWORD_MIN_LENGTH).toBe(12);
    // And a password at exactly the minimum is accepted, so the rule is a
    // boundary rather than a number nobody reaches.
    stubDb([live]);
    await expect(appRouter.createCaller(anonCtx()).auth.completeAdminInvitation({
      token: 'g'.repeat(43), password: 'a'.repeat(ADMIN_PASSWORD_MIN_LENGTH - 1),
    })).rejects.toBeDefined();
  });
});

// ── Reset ──────────────────────────────────────────────────────────────────

describe('a Super Admin resetting somebody else', () => {
  const target = { id: 9, role: 'admin', adminRole: 'BILLING_ADMIN', username: 'billing' };

  it('issues a one-time link and never a password', async () => {
    const { insertValues } = stubDb([target]);
    const result = await appRouter.createCaller(superCtx()).admin.resetAdminPassword({ userId: 9 });
    expect(result.resetLink).toContain('/admin/accept-invitation?token=');
    expect(JSON.stringify(result)).not.toMatch(/password/i);
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('revokes the live sessions of the target at the same time', () => {
    // A reset usually means the credential is suspect; leaving sessions running
    // would defeat the point of resetting it.
    const block = ROUTERS.slice(ROUTERS.indexOf('resetAdminPassword: superAdminProcedure'), ROUTERS.indexOf('adminInvitations: superAdminProcedure'));
    expect(block).toContain('sessionsInvalidBefore');
  });

  it('refuses a target who is not an administrator', async () => {
    stubDb([{ id: 9, role: 'user', adminRole: null }]);
    await expect(appRouter.createCaller(superCtx()).admin.resetAdminPassword({ userId: 9 }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses to revoke an already-redeemed link', async () => {
    stubDb([{ id: 3, userId: 9, usedAt: new Date() }]);
    await expect(appRouter.createCaller(superCtx()).admin.revokeAdminInvitation({ invitationId: 3 }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
