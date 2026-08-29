import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Slice 3 — first-party email + password authentication.
 *
 * The defect these tests exist for: before this slice the ONLY way a real
 * (non-dummy) user could obtain a session was `/api/oauth/callback`, which
 * calls OAUTH_SERVER_URL — a Manus-platform service. On infrastructure BuildHub
 * controls, that host does not exist and nobody can sign in. `signInDummy`
 * refuses anything without `isDummy = true`, so it was not a fallback.
 *
 * A second, independent defect closed here: an admin could create an account,
 * the invitee could set a password through `admin.completeInvitation` — and no
 * endpoint anywhere would then accept that password.
 */

const scryptAsync = promisify(scryptCallback);

async function makeHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

const mocks = vi.hoisted(() => ({
  env: {
    appId: 'buildhub-test',
    cookieSecret: 'a-test-signing-secret-long-enough-for-hmac',
    databaseUrl: 'mysql://test',
    oAuthServerUrl: '',
    ownerOpenId: '',
    isProduction: false,
    forgeApiUrl: '',
    forgeApiKey: '',
    appBaseUrl: '',
    // The AI assistant's config participates in auth.capabilities, so a mocked
    // ENV that omits it makes isAiConfigured() read undefined.trim().
    openAiApiKey: '',
    openAiModel: 'gpt-5.6-luna',
    openAiBaseUrl: '',
  },
}));

vi.mock('./_core/env', async importOriginal => {
  const actual = await importOriginal<typeof import('./_core/env')>();
  return { ...actual, ENV: mocks.env };
});

vi.mock('./db', () => ({
  getDb: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserByUsername: vi.fn(),
  getUserByOpenId: vi.fn(),
  upsertUser: vi.fn(),
  normalizeEmail: vi.fn((v: string | null | undefined) => v?.trim().toLowerCase() || null),
  normalizeUsername: vi.fn((v: string | null | undefined) => v?.trim().toLowerCase() || null),
  revokeSession: vi.fn(),
  isSessionRevoked: vi.fn().mockResolvedValue(false),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import * as db from './db';
import { resetAuthLimiters } from './_core/rateLimit';
import { ConsoleMailer, NullMailer, isMailerConfigured, resetMailer, setMailer, type Mailer } from './_core/mailer';
import { sdk } from './_core/sdk';
import { COOKIE_NAME } from '@shared/const';

const ROUTERS_SOURCE = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
// hashPassword, verifyPassword and NO_SUCH_ACCOUNT_HASH moved here when the
// administrator bootstrap needed to hash a password without importing the whole
// router graph. routers.ts re-exports all three, so behaviour is unchanged -
// but assertions that read the SOURCE have to read the file it now lives in.
const PASSWORDS_SOURCE = readFileSync(new URL('./passwords.ts', import.meta.url), 'utf8');
const SDK_SOURCE = readFileSync(new URL('./_core/sdk.ts', import.meta.url), 'utf8');

function anonCtx() {
  const cookie = vi.fn();
  return {
    ctx: {
      user: null,
      req: { protocol: 'https', headers: {} } as TrpcContext['req'],
      res: { cookie, clearCookie: vi.fn() } as unknown as TrpcContext['res'],
    } as TrpcContext,
    cookie,
  };
}

function makeDb(options: { selectRows?: unknown[]; insertId?: number } = {}) {
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const fake = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(async () => options.selectRows ?? []) })) })),
    insert: vi.fn(() => ({
      values: vi.fn(async (value: Record<string, unknown>) => {
        inserts.push(value);
        return [{ insertId: options.insertId ?? 501 }];
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: Record<string, unknown>) => ({
        where: vi.fn(async () => { updates.push(value); return []; }),
      })),
    })),
  };
  (db.getDb as ReturnType<typeof vi.fn>).mockResolvedValue(fake);
  return { fake, updates, inserts };
}

const ACCOUNT = {
  id: 77,
  openId: 'local_11111111-2222-3333-4444-555555555555',
  username: 'realvendor',
  name: 'Real Vendor',
  email: 'vendor@example.com',
  isDummy: false,
  loginMethod: 'password',
  accountStatus: 'active' as const,
  deactivatedAt: null,
  userRole: 'contractor' as const,
  onboardingStatus: 'approved' as const,
  passwordHash: '',
  emailVerifiedAt: null,
  passwordResetToken: null,
  passwordResetExpiresAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthLimiters();
  resetMailer();
  mocks.env.oAuthServerUrl = '';
  mocks.env.appBaseUrl = '';
  (db.isSessionRevoked as ReturnType<typeof vi.fn>).mockResolvedValue(false);
  (db.getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (db.getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

// ── §1 The launch blocker itself ───────────────────────────────────────────

describe('§1 a real user can sign in without any external identity service', () => {
  it('signIn accepts a non-dummy account holding a password', async () => {
    const passwordHash = await makeHash('correct horse battery');
    (db.getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ACCOUNT, passwordHash });
    makeDb();
    const { ctx, cookie } = anonCtx();

    const result = await appRouter.createCaller(ctx).auth.signIn({
      identifier: 'realvendor', password: 'correct horse battery',
    });

    expect(result.success).toBe(true);
    expect(result.userRole).toBe('contractor');
    expect(cookie).toHaveBeenCalledTimes(1);
  });

  it('signIn accepts an email address as the identifier', async () => {
    const passwordHash = await makeHash('correct horse battery');
    (db.getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ACCOUNT, passwordHash });
    makeDb();
    const { ctx } = anonCtx();

    await expect(appRouter.createCaller(ctx).auth.signIn({
      identifier: 'vendor@example.com', password: 'correct horse battery',
    })).resolves.toMatchObject({ success: true });
    expect(db.getUserByEmail).toHaveBeenCalledWith('vendor@example.com');
    expect(db.getUserByUsername).not.toHaveBeenCalled();
  });

  it('REGRESSION: an admin-created account that set a password via invitation can now sign in', async () => {
    // This combination previously had no endpoint that would accept it:
    // signInDummy demands isDummy, and OAuth demands an external provider.
    const passwordHash = await makeHash('invited-password');
    (db.getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ACCOUNT, loginMethod: 'admin_created', openId: 'admin_abc', passwordHash,
    });
    makeDb();
    const { ctx } = anonCtx();

    await expect(appRouter.createCaller(ctx).auth.signIn({
      identifier: 'realvendor', password: 'invited-password',
    })).resolves.toMatchObject({ success: true });
  });

  it('the session cookie is set through the shared cookie helper, not hand-rolled options', () => {
    const block = ROUTERS_SOURCE.slice(ROUTERS_SOURCE.indexOf('signIn: publicProcedure'), ROUTERS_SOURCE.indexOf('requestPasswordReset:'));
    expect(block).toContain('getSessionCookieOptions(ctx.req)');
    expect(block).not.toMatch(/sameSite:\s*['"]/);
    expect(block).not.toMatch(/secure:\s*(true|false)/);
  });
});

// ── §2 Sign-up ─────────────────────────────────────────────────────────────

describe('§2 signUp', () => {
  const VALID = {
    username: 'newvendor', email: 'new@example.com', password: 'a-good-password',
    name: 'New Vendor', userRole: 'contractor' as const,
  };

  it('creates an active, self-registered, non-dummy account and issues a session', async () => {
    const { inserts } = makeDb({ selectRows: [{ openId: 'local_new' }], insertId: 900 });
    const { ctx, cookie } = anonCtx();

    const result = await appRouter.createCaller(ctx).auth.signUp(VALID);

    expect(result).toMatchObject({ success: true, userRole: 'contractor', onboardingStatus: 'not_started' });
    expect(cookie).toHaveBeenCalledTimes(1);
    const created = inserts[0];
    expect(created.isDummy).toBe(false);
    expect(created.accountSource).toBe('self_registered');
    expect(created.loginMethod).toBe('password');
    expect(String(created.openId)).toMatch(/^local_/);
  });

  it('pins role to "user" — a self-registering caller can never become an admin', async () => {
    const { inserts } = makeDb({ selectRows: [{ openId: 'local_new' }] });
    const { ctx } = anonCtx();
    await appRouter.createCaller(ctx).auth.signUp(VALID);
    expect(inserts[0].role).toBe('user');
  });

  it('rejects userRole "admin" at the schema boundary', async () => {
    makeDb({ selectRows: [{ openId: 'local_new' }] });
    const { ctx } = anonCtx();
    await expect(appRouter.createCaller(ctx).auth.signUp({
      ...VALID, userRole: 'admin' as never,
    })).rejects.toThrow();
  });

  it('stores a scrypt hash, never the password itself', async () => {
    const { inserts } = makeDb({ selectRows: [{ openId: 'local_new' }] });
    const { ctx } = anonCtx();
    await appRouter.createCaller(ctx).auth.signUp(VALID);
    expect(String(inserts[0].passwordHash)).toMatch(/^scrypt\$/);
    expect(JSON.stringify(inserts[0])).not.toContain('a-good-password');
  });

  it('a professional role starts unverified and pending compliance', async () => {
    const { inserts } = makeDb({ selectRows: [{ openId: 'local_new' }] });
    const { ctx } = anonCtx();
    await appRouter.createCaller(ctx).auth.signUp({ ...VALID, userRole: 'engineer' });
    expect(inserts[0].verified).toBe(false);
    expect(inserts[0].onboardingStatus).toBe('not_started');
  });

  it('a homeowner follows the same rule auth.updateRole already applies', async () => {
    const { inserts } = makeDb({ selectRows: [{ openId: 'local_new' }] });
    const { ctx } = anonCtx();
    await appRouter.createCaller(ctx).auth.signUp({ ...VALID, userRole: 'homeowner' });
    expect(inserts[0].verified).toBe(true);
    expect(inserts[0].onboardingStatus).toBe('approved');
  });

  it('refuses a username already in use', async () => {
    (db.getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ACCOUNT });
    makeDb();
    const { ctx } = anonCtx();
    await expect(appRouter.createCaller(ctx).auth.signUp(VALID)).rejects.toThrow(/username is already in use/i);
  });

  it('refuses an email already in use', async () => {
    (db.getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ACCOUNT });
    makeDb();
    const { ctx } = anonCtx();
    await expect(appRouter.createCaller(ctx).auth.signUp(VALID)).rejects.toThrow(/email is already in use/i);
  });

  it('a duplicate-key race surfaces as a conflict, not a 500', async () => {
    (db.getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
      select: vi.fn(),
      insert: vi.fn(() => ({ values: vi.fn().mockRejectedValue(new Error("ER_DUP_ENTRY: Duplicate entry 'newvendor'")) })),
      update: vi.fn(),
    });
    const { ctx } = anonCtx();
    await expect(appRouter.createCaller(ctx).auth.signUp(VALID)).rejects.toThrow(/just taken/i);
  });

  it('rejects a password below the 8-character floor', async () => {
    makeDb({ selectRows: [{ openId: 'local_new' }] });
    const { ctx } = anonCtx();
    await expect(appRouter.createCaller(ctx).auth.signUp({ ...VALID, password: 'short7c' })).rejects.toThrow();
  });

  it('writes an audit event for the new account', async () => {
    const { inserts } = makeDb({ selectRows: [{ openId: 'local_new' }], insertId: 900 });
    const { ctx } = anonCtx();
    await appRouter.createCaller(ctx).auth.signUp(VALID);
    expect(inserts.some(row => row.action === 'password_account_created')).toBe(true);
  });
});

// ── §3 Sign-in refusals ────────────────────────────────────────────────────

describe('§3 signIn refusals', () => {
  it('gives one identical message for an unknown account and a wrong password', async () => {
    const passwordHash = await makeHash('right-password');
    makeDb();
    const { ctx } = anonCtx();

    (db.getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const unknown = await appRouter.createCaller(ctx).auth.signIn({ identifier: 'ghost', password: 'x'.repeat(12) })
      .catch((error: Error) => error.message);

    (db.getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ACCOUNT, passwordHash });
    const wrong = await appRouter.createCaller(ctx).auth.signIn({ identifier: 'realvendor', password: 'wrong-password' })
      .catch((error: Error) => error.message);

    expect(unknown).toBe(wrong);
    expect(unknown).toMatch(/invalid username, email, or password/i);
  });

  it('spends the same work on a nonexistent account, so timing does not enumerate users', () => {
    // The guard is structural: verifyPassword is called unconditionally against
    // a constant well-formed hash. A short-circuit `if (!target) throw` would
    // return in microseconds and leak which usernames exist.
    const block = ROUTERS_SOURCE.slice(ROUTERS_SOURCE.indexOf('signIn: publicProcedure'), ROUTERS_SOURCE.indexOf('requestPasswordReset:'));
    expect(block).toContain('NO_SUCH_ACCOUNT_HASH');
    expect(block).toMatch(/const passwordMatches = await verifyPassword\([\s\S]*?\);\s*\n\s*if \(!candidate \|\| !passwordMatches\)/);
  });

  it('the constant decoy hash never validates any password', async () => {
    const decoy = PASSWORDS_SOURCE.match(/NO_SUCH_ACCOUNT_HASH =\s*\n?\s*'([^']+)'\s*\+\s*'0'\.repeat\(128\)/);
    expect(decoy).not.toBeNull();
    makeDb();
    (db.getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ACCOUNT, passwordHash: `${decoy![1]}${'0'.repeat(128)}` });
    const { ctx } = anonCtx();
    await expect(appRouter.createCaller(ctx).auth.signIn({ identifier: 'realvendor', password: '' }))
      .rejects.toThrow();
  });

  it('refuses a dummy account — those keep their own endpoint and its frozen-by-default policy', async () => {
    const passwordHash = await makeHash('buildhub123');
    (db.getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ACCOUNT, isDummy: true, loginMethod: 'dummy', passwordHash,
    });
    makeDb();
    const { ctx } = anonCtx();
    await expect(appRouter.createCaller(ctx).auth.signIn({ identifier: 'testvendor', password: 'buildhub123' }))
      .rejects.toThrow(/invalid username, email, or password/i);
  });

  it('refuses an account with no password set — an OAuth-only account cannot be password-guessed into', async () => {
    (db.getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ACCOUNT, passwordHash: null });
    makeDb();
    const { ctx } = anonCtx();
    await expect(appRouter.createCaller(ctx).auth.signIn({ identifier: 'realvendor', password: 'anything-at-all' }))
      .rejects.toThrow(/invalid username, email, or password/i);
  });

  it('refuses a frozen account, but only after the password is verified', async () => {
    const passwordHash = await makeHash('right-password');
    (db.getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ACCOUNT, accountStatus: 'frozen', passwordHash,
    });
    makeDb();
    const { ctx } = anonCtx();
    await expect(appRouter.createCaller(ctx).auth.signIn({ identifier: 'realvendor', password: 'right-password' }))
      .rejects.toThrow(/not active/i);
  });

  it('refuses a deactivated account', async () => {
    const passwordHash = await makeHash('right-password');
    (db.getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ACCOUNT, deactivatedAt: new Date(), passwordHash,
    });
    makeDb();
    const { ctx } = anonCtx();
    await expect(appRouter.createCaller(ctx).auth.signIn({ identifier: 'realvendor', password: 'right-password' }))
      .rejects.toThrow(/not active/i);
  });

  it('is rate limited before any credential comparison happens', async () => {
    makeDb();
    const { ctx } = anonCtx();
    const attempt = () => appRouter.createCaller(ctx).auth.signIn({ identifier: 'someone', password: 'guess-guess' })
      .catch((error: Error) => error.message);
    const messages: string[] = [];
    for (let i = 0; i < 12; i++) messages.push(await attempt());
    expect(messages.some(message => /too many attempts/i.test(message))).toBe(true);
  });

  it('no session cookie is issued on a failed attempt', async () => {
    makeDb();
    const { ctx, cookie } = anonCtx();
    await appRouter.createCaller(ctx).auth.signIn({ identifier: 'ghost', password: 'nope-nope-nope' }).catch(() => {});
    expect(cookie).not.toHaveBeenCalled();
  });
});

// ── §4 Password reset request ──────────────────────────────────────────────

describe('§4 requestPasswordReset', () => {
  function configureMailer(): { sent: { to: string; subject: string; body: string }[]; mailer: Mailer } {
    const sent: { to: string; subject: string; body: string }[] = [];
    const mailer: Mailer = { id: 'test', send: async email => { sent.push(email); } };
    setMailer(mailer);
    mocks.env.appBaseUrl = 'https://buildhub.example';
    return { sent, mailer };
  }

  it('refuses outright when no mail provider is configured, rather than claiming to have sent one', async () => {
    makeDb();
    const { ctx } = anonCtx();
    await expect(appRouter.createCaller(ctx).auth.requestPasswordReset({ email: 'vendor@example.com' }))
      .rejects.toThrow(/not available on this deployment/i);
  });

  it('refuses when a mailer exists but APP_BASE_URL does not — the link would have nowhere to point', async () => {
    setMailer({ id: 'test', send: async () => {} });
    mocks.env.appBaseUrl = '';
    makeDb();
    const { ctx } = anonCtx();
    await expect(appRouter.createCaller(ctx).auth.requestPasswordReset({ email: 'vendor@example.com' }))
      .rejects.toThrow(/not available on this deployment/i);
  });

  it('answers identically for a known and an unknown address', async () => {
    configureMailer();
    const passwordHash = await makeHash('right-password');

    (db.getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ACCOUNT, passwordHash });
    makeDb();
    const known = await appRouter.createCaller(anonCtx().ctx).auth.requestPasswordReset({ email: 'vendor@example.com' });

    (db.getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    makeDb();
    const unknown = await appRouter.createCaller(anonCtx().ctx).auth.requestPasswordReset({ email: 'nobody@example.com' });

    expect(known).toEqual(unknown);
    expect(known).toEqual({ requested: true });
  });

  it('issues no token at all for an unknown address', async () => {
    configureMailer();
    (db.getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { updates } = makeDb();
    await appRouter.createCaller(anonCtx().ctx).auth.requestPasswordReset({ email: 'nobody@example.com' });
    expect(updates).toHaveLength(0);
  });

  it('stores a bounded-lifetime token and mails a link built from APP_BASE_URL', async () => {
    const { sent } = configureMailer();
    const passwordHash = await makeHash('right-password');
    (db.getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ACCOUNT, passwordHash });
    const { updates } = makeDb();

    await appRouter.createCaller(anonCtx().ctx).auth.requestPasswordReset({ email: 'vendor@example.com' });

    expect(updates).toHaveLength(1);
    const stored = String(updates[0].passwordResetToken);
    const expiry = updates[0].passwordResetExpiresAt as Date;
    expect(expiry.getTime()).toBeGreaterThan(Date.now());
    expect(expiry.getTime()).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('vendor@example.com');

    // WHAT IS EMAILED AND WHAT IS STORED ARE NOT THE SAME STRING.
    //
    // This used to assert the emailed link contained the STORED value, which
    // was true only because the raw token was written to the column. A dump of
    // the users table then handed over a live reset for every account with a
    // pending request - while testLoginTokens and adminInvitations, in the same
    // file, already stored only a hash for exactly that reason.
    //
    // The assertion is now the stronger one: the link carries a token, that
    // token is NOT what the column holds, and the column holds its sha256.
    const emailed = sent[0].body.match(/reset-password\?token=([^\s]+)/)?.[1];
    expect(emailed, 'the email must carry a reset token').toBeTruthy();
    expect(emailed!.length).toBeGreaterThan(20);
    expect(sent[0].body).toContain(`https://buildhub.example/auth/reset-password?token=${emailed}`);
    expect(stored, 'the raw token must not be what is stored').not.toBe(emailed);
    expect(stored).toBe(createHash('sha256').update(emailed!).digest('hex'));
  });

  it('never puts the reset link anywhere in the API response', async () => {
    configureMailer();
    const passwordHash = await makeHash('right-password');
    (db.getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ACCOUNT, passwordHash });
    const { updates } = makeDb();
    const result = await appRouter.createCaller(anonCtx().ctx).auth.requestPasswordReset({ email: 'vendor@example.com' });
    // Neither the stored hash nor the raw token that was emailed.
    expect(JSON.stringify(result)).not.toContain(String(updates[0].passwordResetToken));
    expect(Object.keys(result)).toEqual(['requested']);
  });

  it('a delivery failure still returns the neutral answer — an error here would be an existence oracle', async () => {
    setMailer({ id: 'broken', send: async () => { throw new Error('SMTP refused'); } });
    mocks.env.appBaseUrl = 'https://buildhub.example';
    const passwordHash = await makeHash('right-password');
    (db.getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ACCOUNT, passwordHash });
    makeDb();
    await expect(appRouter.createCaller(anonCtx().ctx).auth.requestPasswordReset({ email: 'vendor@example.com' }))
      .resolves.toEqual({ requested: true });
  });

  it('issues nothing for a dummy or frozen account', async () => {
    configureMailer();
    const passwordHash = await makeHash('right-password');

    (db.getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ACCOUNT, isDummy: true, passwordHash });
    const dummyRun = makeDb();
    await appRouter.createCaller(anonCtx().ctx).auth.requestPasswordReset({ email: 'a@example.com' });
    expect(dummyRun.updates).toHaveLength(0);

    (db.getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ACCOUNT, accountStatus: 'frozen', passwordHash });
    const frozenRun = makeDb();
    await appRouter.createCaller(anonCtx().ctx).auth.requestPasswordReset({ email: 'b@example.com' });
    expect(frozenRun.updates).toHaveLength(0);
  });
});

// ── §5 Password reset completion ───────────────────────────────────────────

describe('§5 resetPassword', () => {
  const LIVE_TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-ffff1111';

  function tokenRow(overrides: Record<string, unknown> = {}) {
    return {
      ...ACCOUNT,
      passwordResetToken: LIVE_TOKEN,
      passwordResetExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      ...overrides,
    };
  }

  it('sets a new hash and clears the token in the same write', async () => {
    const { updates } = makeDb({ selectRows: [tokenRow()] });
    await appRouter.createCaller(anonCtx().ctx).auth.resetPassword({ token: LIVE_TOKEN, password: 'brand-new-password' });

    expect(updates).toHaveLength(1);
    expect(String(updates[0].passwordHash)).toMatch(/^scrypt\$/);
    expect(updates[0].passwordResetToken).toBeNull();
    expect(updates[0].passwordResetExpiresAt).toBeNull();
    expect(JSON.stringify(updates[0])).not.toContain('brand-new-password');
  });

  it('invalidates every existing session — the point of a reset is that someone else may hold one', async () => {
    const { updates } = makeDb({ selectRows: [tokenRow()] });
    await appRouter.createCaller(anonCtx().ctx).auth.resetPassword({ token: LIVE_TOKEN, password: 'brand-new-password' });
    expect(updates[0].sessionsInvalidBefore).toBeInstanceOf(Date);
  });

  it('marks the mailbox verified, since completing the flow proves control of it', async () => {
    const { updates } = makeDb({ selectRows: [tokenRow()] });
    await appRouter.createCaller(anonCtx().ctx).auth.resetPassword({ token: LIVE_TOKEN, password: 'brand-new-password' });
    expect(updates[0].emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('does not overwrite an earlier verification timestamp', async () => {
    const earlier = new Date('2026-01-01T00:00:00Z');
    const { updates } = makeDb({ selectRows: [tokenRow({ emailVerifiedAt: earlier })] });
    await appRouter.createCaller(anonCtx().ctx).auth.resetPassword({ token: LIVE_TOKEN, password: 'brand-new-password' });
    expect(updates[0].emailVerifiedAt).toBe(earlier);
  });

  it('does NOT hand back a session — the user must re-authenticate with the new password', async () => {
    const { ctx, cookie } = anonCtx();
    makeDb({ selectRows: [tokenRow()] });
    const result = await appRouter.createCaller(ctx).auth.resetPassword({ token: LIVE_TOKEN, password: 'brand-new-password' });
    expect(cookie).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('rejects an unknown token', async () => {
    makeDb({ selectRows: [] });
    await expect(appRouter.createCaller(anonCtx().ctx).auth.resetPassword({ token: LIVE_TOKEN, password: 'brand-new-password' }))
      .rejects.toThrow(/invalid or has already been used/i);
  });

  it('rejects an expired token and clears it', async () => {
    const { updates } = makeDb({ selectRows: [tokenRow({ passwordResetExpiresAt: new Date(Date.now() - 1000) })] });
    await expect(appRouter.createCaller(anonCtx().ctx).auth.resetPassword({ token: LIVE_TOKEN, password: 'brand-new-password' }))
      .rejects.toThrow(/expired/i);
    expect(updates).toHaveLength(1);
    expect(updates[0].passwordResetToken).toBeNull();
    expect(updates[0]).not.toHaveProperty('passwordHash');
  });

  it('rejects a row whose expiry is missing rather than treating null as "never expires"', async () => {
    makeDb({ selectRows: [tokenRow({ passwordResetExpiresAt: null })] });
    await expect(appRouter.createCaller(anonCtx().ctx).auth.resetPassword({ token: LIVE_TOKEN, password: 'brand-new-password' }))
      .rejects.toThrow(/expired/i);
  });

  it('enforces the same 8-character floor as signUp', async () => {
    makeDb({ selectRows: [tokenRow()] });
    await expect(appRouter.createCaller(anonCtx().ctx).auth.resetPassword({ token: LIVE_TOKEN, password: 'short7c' }))
      .rejects.toThrow();
  });

  it('is rate limited by IP only — keying on the token would bound nothing', () => {
    const block = ROUTERS_SOURCE.slice(ROUTERS_SOURCE.indexOf('resetPassword: publicProcedure'), ROUTERS_SOURCE.indexOf('checkSignupAvailability:'));
    expect(block).toContain('enforceAuthRateLimit(ctx.req, null)');
  });

  it('records the reset in the account audit trail', async () => {
    const { inserts } = makeDb({ selectRows: [tokenRow()] });
    await appRouter.createCaller(anonCtx().ctx).auth.resetPassword({ token: LIVE_TOKEN, password: 'brand-new-password' });
    expect(inserts.some(row => row.action === 'password_reset_completed')).toBe(true);
  });
});

// ── §6 Bulk session invalidation actually takes effect ─────────────────────

describe('§6 sessionsInvalidBefore is enforced at authentication', () => {
  function request(token: string) {
    return { headers: { cookie: `${COOKIE_NAME}=${token}` } } as never;
  }

  it('every issued token now carries an iat — without one the cutoff cannot be evaluated', async () => {
    const token = await sdk.createSessionToken('local_x', { name: 'X' });
    const session = await sdk.verifySession(token);
    expect(session?.issuedAt).toBeInstanceOf(Date);
  });

  it('a session issued before the cutoff is refused', async () => {
    const token = await sdk.createSessionToken('local_x', { name: 'X' });
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ACCOUNT, openId: 'local_x',
      sessionsInvalidBefore: new Date(Date.now() + 10_000),
    });
    await expect(sdk.authenticateRequest(request(token))).rejects.toThrow(/invalidated/i);
  });

  it('a session issued after the cutoff is accepted', async () => {
    const token = await sdk.createSessionToken('local_x', { name: 'X' });
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ACCOUNT, openId: 'local_x',
      sessionsInvalidBefore: new Date(Date.now() - 60_000),
    });
    await expect(sdk.authenticateRequest(request(token))).resolves.toMatchObject({ openId: 'local_x' });
  });

  it('an account that never reset a password is unaffected', async () => {
    const token = await sdk.createSessionToken('local_x', { name: 'X' });
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ACCOUNT, openId: 'local_x', sessionsInvalidBefore: null,
    });
    await expect(sdk.authenticateRequest(request(token))).resolves.toMatchObject({ openId: 'local_x' });
  });

  it('a session minted in the same second as the reset survives — otherwise the reset locks the user out of their own new session', async () => {
    const now = new Date();
    const token = await sdk.createSessionToken('local_x', { name: 'X' });
    (db.getUserByOpenId as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ACCOUNT, openId: 'local_x',
      // Sub-second offset: a raw millisecond comparison would reject this.
      sessionsInvalidBefore: new Date(Math.floor(now.getTime() / 1000) * 1000 + 750),
    });
    await expect(sdk.authenticateRequest(request(token))).resolves.toMatchObject({ openId: 'local_x' });
  });

  it('fails CLOSED for a legacy token that carries no iat', () => {
    const block = SDK_SOURCE.slice(SDK_SOURCE.indexOf('if (user.sessionsInvalidBefore)'), SDK_SOURCE.indexOf('await db.upsertUser({\n      openId: user.openId'));
    expect(block).toContain('issuedSecond === null || issuedSecond < cutoffSecond');
  });
});

// ── §7 Capability reporting ────────────────────────────────────────────────

describe('§7 auth.capabilities', () => {
  it('reports password sign-in as always available — it depends on nothing external', async () => {
    const result = await appRouter.createCaller(anonCtx().ctx).auth.capabilities();
    expect(result.passwordSignIn).toBe(true);
  });

  it('reports OAuth as unavailable when OAUTH_SERVER_URL is unset', async () => {
    mocks.env.oAuthServerUrl = '';
    const result = await appRouter.createCaller(anonCtx().ctx).auth.capabilities();
    expect(result.oauthSignIn).toBe(false);
  });

  it('reports OAuth as available once OAUTH_SERVER_URL is configured', async () => {
    mocks.env.oAuthServerUrl = 'https://oauth.example';
    const result = await appRouter.createCaller(anonCtx().ctx).auth.capabilities();
    expect(result.oauthSignIn).toBe(true);
  });

  it('reports password reset as unavailable unless BOTH a mailer and a base URL exist', async () => {
    const ctx = anonCtx().ctx;
    expect((await appRouter.createCaller(ctx).auth.capabilities()).passwordReset).toBe(false);

    setMailer({ id: 'test', send: async () => {} });
    expect((await appRouter.createCaller(ctx).auth.capabilities()).passwordReset).toBe(false);

    mocks.env.appBaseUrl = 'https://buildhub.example';
    expect((await appRouter.createCaller(ctx).auth.capabilities()).passwordReset).toBe(true);
  });

  it('takes no input at all — capability is a server fact, never a client claim', () => {
    const block = ROUTERS_SOURCE.slice(ROUTERS_SOURCE.indexOf('capabilities: publicProcedure'), ROUTERS_SOURCE.indexOf('signUp: publicProcedure'));
    expect(block).not.toContain('.input(');
  });
});

// ── §8 The mailer adapter contract ─────────────────────────────────────────

describe('§8 mailer adapter', () => {
  it('defaults to refusing, so nothing can silently claim to have sent an email', async () => {
    resetMailer();
    expect(isMailerConfigured()).toBe(false);
    await expect(new NullMailer().send({ to: 'a@b.c', subject: 's', body: 'b' }))
      .rejects.toThrow(/no outbound email provider is configured/i);
  });

  it('a registered provider reports itself configured', () => {
    setMailer({ id: 'smtp', send: async () => {} });
    expect(isMailerConfigured()).toBe(true);
    resetMailer();
    expect(isMailerConfigured()).toBe(false);
  });

  it('the development console mailer is never registered in production', () => {
    // Slice 3 pinned the literal `if (!ENV.isProduction) { setMailer(...) }`
    // shape. The SMTP work replaced that branch with resolveMailerFromEnv(),
    // so this now asserts the same GUARANTEE against the new structure rather
    // than the old spelling - the guarantee is what matters, and it is
    // stronger here: the console mailer is reachable only through a branch
    // that production can never return.
    const startup = readFileSync(new URL('./_core/index.ts', import.meta.url), 'utf8');
    const smtp = readFileSync(new URL('./_core/smtpMailer.ts', import.meta.url), 'utf8');

    // ConsoleMailer is registered only under the 'console' branch.
    expect(startup).toMatch(/mail\.kind === "console"\)\s*\{\s*\n\s*setMailer\(new ConsoleMailer\(\)\);/);
    expect(startup.match(/setMailer\(new ConsoleMailer\(\)\)/g) ?? []).toHaveLength(1);

    // And production can never produce that branch.
    expect(smtp).toContain('ENV.isProduction ? { kind: "none" } : { kind: "console" }');
    expect(smtp).not.toMatch(/kind:\s*"console"[\s\S]{0,80}isProduction\s*\?/);
  });

  it('a production deployment with no SMTP_HOST keeps NullMailer', async () => {
    // Which is what makes auth.capabilities report password reset as
    // unavailable, so the UI hides a button that could only ever fail.
    vi.resetModules();
    vi.doMock('./_core/env', () => ({ ENV: { isProduction: true } }));
    const { resolveMailerFromEnv } = await import('./_core/smtpMailer');
    expect(resolveMailerFromEnv({}).kind).toBe('none');
    vi.doUnmock('./_core/env');
    vi.resetModules();
  });

  it('the console mailer writes the message somewhere a developer can read it', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await new ConsoleMailer().send({ to: 'a@b.c', subject: 'Reset', body: 'https://x/reset?token=t' });
    expect(log.mock.calls.flat().join(' ')).toContain('https://x/reset?token=t');
    log.mockRestore();
  });
});

// ── §9 Things that must not have changed ───────────────────────────────────

describe('§9 no regression to the existing doors', () => {
  it('the OAuth callback route still exists and is untouched by this slice', () => {
    const source = readFileSync(new URL('./_core/oauth.ts', import.meta.url), 'utf8');
    expect(source).toContain('/api/oauth/callback');
    expect(source).toContain('sdk.exchangeCodeForToken');
  });

  it('signInDummy still refuses anything that is not a dummy account', () => {
    const block = ROUTERS_SOURCE.slice(ROUTERS_SOURCE.indexOf('signInDummy: publicProcedure'), ROUTERS_SOURCE.indexOf('// ── First-party password authentication'));
    expect(block).toContain("!target?.isDummy || target.loginMethod !== 'dummy'");
  });

  it('the invitation flow keeps its own 6-character floor — raising it would break links already in flight', () => {
    const block = ROUTERS_SOURCE.slice(ROUTERS_SOURCE.indexOf('completeInvitation: publicProcedure'), ROUTERS_SOURCE.indexOf('fullAuditReport:'));
    expect(block).toContain('password: z.string().min(6).max(128)');
  });

  it('none of the new procedures ever return a password hash or a reset token', () => {
    const block = ROUTERS_SOURCE.slice(ROUTERS_SOURCE.indexOf('capabilities: publicProcedure'), ROUTERS_SOURCE.indexOf('checkSignupAvailability:'));
    const returns = block.match(/return \{[^}]*\}/g) ?? [];
    for (const statement of returns) {
      expect(statement).not.toContain('passwordHash');
      expect(statement).not.toContain('passwordResetToken');
      expect(statement).not.toContain('openId');
    }
  });
});
