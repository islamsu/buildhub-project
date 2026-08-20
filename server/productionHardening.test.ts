import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { isSessionRevoked } from './db';
import { assertEnvOrExit, findEnvProblems } from './_core/env';
import { authLimiters, createRateLimiter, resetAuthLimiters } from './_core/rateLimit';
import { authorizeStorageKey } from './_core/storageProxy';
import { appRouter } from './routers';

// Phase 4B readiness audit, Slice 1. Each block below pins one finding from §10
// of BUILDHUB_PHASE4B_READINESS_AUDIT.md. These are the first tests in the repo
// to cover boot configuration, transport hardening and error-shape leakage -
// which is precisely why those defects survived four phases unnoticed.

const readSource = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

function env(overrides: Partial<ReturnType<typeof baseEnv>> = {}) {
  return { ...baseEnv(), ...overrides };
}
function baseEnv() {
  return {
    appId: 'app', cookieSecret: 'x'.repeat(48), databaseUrl: 'mysql://u:p@h:3306/d',
    oAuthServerUrl: '', ownerOpenId: '', isProduction: true, forgeApiUrl: '', forgeApiKey: '',
  };
}

// ── A1: an empty JWT_SECRET must not boot ──────────────────────────────────

describe('A1 - boot configuration is validated (Phase 4B audit)', () => {
  it('a fully configured environment reports no problems', () => {
    expect(findEnvProblems(env())).toEqual([]);
  });

  it('REGRESSION: an empty JWT_SECRET is a problem, not a default', () => {
    // Before the fix this booted silently and signed every session JWT with
    // `new TextEncoder().encode("")`.
    const problems = findEnvProblems(env({ cookieSecret: '' }));
    expect(problems).toHaveLength(1);
    expect(problems[0].variable).toBe('JWT_SECRET');
    expect(problems[0].problem).toMatch(/empty key/);
  });

  it('a too-short JWT_SECRET is rejected as well as an absent one', () => {
    const problems = findEnvProblems(env({ cookieSecret: 'short' }));
    expect(problems[0].variable).toBe('JWT_SECRET');
    expect(problems[0].problem).toMatch(/at least 32/);
  });

  it('an absent DATABASE_URL is a problem - silent empty results are not acceptable', () => {
    const problems = findEnvProblems(env({ databaseUrl: '' }));
    expect(problems.map(p => p.variable)).toContain('DATABASE_URL');
  });

  it('production REFUSES to start when configuration is missing', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const log = { error: vi.fn(), warn: vi.fn() };

    assertEnvOrExit(env({ cookieSecret: '' }), log);

    expect(exit).toHaveBeenCalledWith(1);
    expect(log.error).toHaveBeenCalledOnce();
    expect(String(log.error.mock.calls[0][0])).toMatch(/Refusing to start/);
    exit.mockRestore();
  });

  it('development only warns, so local work and the test suite are unaffected', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const log = { error: vi.fn(), warn: vi.fn() };

    assertEnvOrExit(env({ cookieSecret: '', isProduction: false }), log);

    expect(exit).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledOnce();
    exit.mockRestore();
  });

  it('validation is never run at module load, so importing cannot throw', () => {
    const source = readSource('./_core/env.ts');
    // The call belongs in startServer(), not at the top level of the module.
    expect(source).not.toMatch(/^assertEnvOrExit\(\)/m);
    expect(readSource('./_core/index.ts')).toContain('assertEnvOrExit()');
  });
});

// ── A2: session revocation must fail closed ────────────────────────────────

describe('A2 - session revocation fails CLOSED (Phase 4B audit)', () => {
  it('REGRESSION: an unreachable database treats the session as revoked', async () => {
    // No DATABASE_URL is configured in the test environment, so getDb() really
    // does return null here - this exercises the outage path for real rather
    // than through a mock. Before the fix it returned false, so a database blip
    // silently re-validated every revoked session.
    await expect(isSessionRevoked('any-jti')).resolves.toBe(true);
  });

  it('the reachable path still answers from the revocation table', () => {
    const source = readSource('./db.ts');
    const fn = source.slice(source.indexOf('export async function isSessionRevoked'), source.indexOf('export async function revokeSession'));
    // Fail-closed must be the DB-missing branch only - not a blanket `return true`.
    expect(fn).toContain('if (!db) return true;');
    expect(fn).toContain('revokedSessions.jti');
    expect(fn).toContain('return result.length > 0;');
  });

  it('the deliberate departure from graceful degradation is documented', () => {
    const source = readSource('./db.ts');
    const block = source.slice(Math.max(0, source.indexOf('export async function isSessionRevoked') - 1200));
    expect(block).toMatch(/fails CLOSED|FAILS CLOSED/);
  });
});

// ── A3: error responses must not leak internals ────────────────────────────

describe('A3 - tRPC error shape leaks nothing (Phase 4B audit)', () => {
  const formatter = (appRouter as unknown as {
    _def: { _config: { errorFormatter: (opts: unknown) => { message: string; data: Record<string, unknown> } } };
  })._def._config.errorFormatter;

  const format = (code: string, message: string) =>
    formatter({
      shape: { message, code: -32603, data: { code, httpStatus: 500, stack: 'Error: at /app/server/secret.ts:42' } },
      error: { code, message },
      type: 'query', path: 'x', input: undefined, ctx: undefined,
    });

  it('an errorFormatter is configured at all', () => {
    expect(typeof formatter).toBe('function');
  });

  it('REGRESSION: the stack is stripped regardless of NODE_ENV', () => {
    // tRPC attaches shape.data.stack whenever its isDev flag is on, and that
    // flag defaults to NODE_ENV !== "production" - so any deploy missing that
    // variable served stack traces on every API error.
    expect(format('INTERNAL_SERVER_ERROR', 'boom').data).not.toHaveProperty('stack');
    expect(format('NOT_FOUND', 'RFQ not found').data).not.toHaveProperty('stack');
  });

  it('REGRESSION: an internal error never returns its own message', () => {
    // e.g. "Storage config missing: set BUILT_IN_FORGE_API_URL and ..."
    const shaped = format('INTERNAL_SERVER_ERROR', 'Storage config missing: set BUILT_IN_FORGE_API_KEY');
    expect(shaped.message).not.toMatch(/BUILT_IN_FORGE/);
    expect(shaped.message).toBe('Something went wrong. Please try again.');
  });

  it('server-authored messages for expected conditions still reach the client', () => {
    // The billing lifecycle and RFQ targeting both rely on the client showing
    // the server's own refusal reason - those must not be genericised.
    for (const [code, message] of [
      ['FORBIDDEN', 'This request does not match any of your declared service categories.'],
      ['NOT_FOUND', 'RFQ not found'],
      ['BAD_REQUEST', 'This vendor has already used their trial.'],
      ['TOO_MANY_REQUESTS', 'Too many attempts. Try again in 30s.'],
    ] as const) {
      expect(format(code, message).message).toBe(message);
    }
  });
});

// ── A4: the error boundary must not print stacks to users ──────────────────

describe('A4 - the client error boundary (Phase 4B audit)', () => {
  const source = readFileSync(new URL('../client/src/components/ErrorBoundary.tsx', import.meta.url), 'utf8');

  it('REGRESSION: no longer renders the stack trace into the UI', () => {
    expect(source).not.toMatch(/\{this\.state\.error\?\.stack\}/);
  });

  it('reports the error instead of discarding it', () => {
    expect(source).toContain('componentDidCatch');
  });

  it('still offers the user a recovery action', () => {
    expect(source).toContain('window.location.reload()');
  });
});

// ── A5: credential guessing must be bounded ────────────────────────────────

describe('A5 - brute-force protection on auth endpoints (Phase 4B audit)', () => {
  beforeEach(() => resetAuthLimiters());

  it('a limiter blocks once its window budget is spent, then recovers', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 3 });
    const t0 = 1_000_000;
    expect([1, 2, 3].map(i => limiter.check('k', t0 + i).allowed)).toEqual([true, true, true]);

    const blocked = limiter.check('k', t0 + 4);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);

    // The window is not a permanent lockout.
    expect(limiter.check('k', t0 + 2000).allowed).toBe(true);
  });

  it('per-identifier limiting bounds many sources targeting ONE account', () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 10; i++) {
      expect(authLimiters.identifierSustained.check('victim', t0).allowed).toBe(true);
    }
    expect(authLimiters.identifierSustained.check('victim', t0).allowed).toBe(false);
    // A different account is unaffected - one user cannot lock out another.
    expect(authLimiters.identifierSustained.check('bystander', t0).allowed).toBe(true);
  });

  it('REGRESSION: both unauthenticated secret-accepting endpoints are guarded', () => {
    const source = readSource('./routers.ts');
    const signIn = source.slice(source.indexOf('signInDummy: publicProcedure'), source.indexOf('checkSignupAvailability:'));
    expect(signIn).toContain('enforceAuthRateLimit(ctx.req, input.username)');

    const invitation = source.slice(source.indexOf('completeInvitation: publicProcedure'));
    expect(invitation.slice(0, 900)).toContain('enforceAuthRateLimit(ctx.req, null)');
  });

  it('the check runs BEFORE any credential comparison', () => {
    const source = readSource('./routers.ts');
    const signIn = source.slice(source.indexOf('signInDummy: publicProcedure'), source.indexOf('checkSignupAvailability:'));
    expect(signIn.indexOf('enforceAuthRateLimit')).toBeLessThan(signIn.indexOf('verifyPassword'));
  });

  it('reuses the existing limiter rather than introducing a second one', () => {
    const source = readSource('./routers.ts');
    expect(source).toContain("from './_core/rateLimit'");
    expect(source).not.toMatch(/new RateLimiter|class \w*RateLimit/);
  });
});

// ── A6: avatars were unreachable ───────────────────────────────────────────

describe('A6 - avatar storage authorization (Phase 4B audit)', () => {
  const user = { id: 5, role: 'user' } as Parameters<typeof authorizeStorageKey>[1];

  it('REGRESSION: an authenticated user can fetch an avatar', async () => {
    // Before the fix `avatars/` had no branch, so every request fell through to
    // the fail-closed default and the proxy 403'd every profile picture.
    await expect(authorizeStorageKey('avatars/user-5/1234-me.png', user)).resolves.toBe(true);
    await expect(authorizeStorageKey('avatars/user-99/1234-other.png', user)).resolves.toBe(true);
  });

  it('an anonymous request is still refused', async () => {
    await expect(authorizeStorageKey('avatars/user-5/1234-me.png', null)).resolves.toBe(false);
  });

  it('the fail-closed default is preserved for unclassified prefixes', async () => {
    await expect(authorizeStorageKey('some-unknown-prefix/file.png', user)).resolves.toBe(false);
  });
});

// ── A7/A8/A9: transport, binding and deploy scripts ────────────────────────

describe('A7 - transport hardening (Phase 4B audit)', () => {
  it('trust proxy is set in production so req.protocol and req.ip are real', () => {
    expect(readSource('./_core/index.ts')).toContain("app.set(\"trust proxy\", 1)");
  });

  it('it is NOT set outside production, where the header would be spoofable', () => {
    const source = readSource('./_core/index.ts');
    const block = source.slice(source.indexOf('trust proxy') - 300, source.indexOf('trust proxy') + 60);
    expect(block).toContain('ENV.isProduction');
  });

  it('REGRESSION: the session cookie pins Secure in production', () => {
    // sameSite:"none" without Secure is dropped by browsers, so deriving it
    // per-request could silently log a user out.
    expect(readSource('./_core/cookies.ts')).toContain('ENV.isProduction ? true : isSecureRequest(req)');
  });
});

describe('A8 - deterministic port binding (Phase 4B audit)', () => {
  const source = readSource('./_core/index.ts');

  it('REGRESSION: production binds the configured port or fails', () => {
    const block = source.slice(source.indexOf('async function resolvePort'), source.indexOf('async function startServer'));
    expect(block).toContain('ENV.isProduction');
    expect(block).toContain('process.exit(1)');
  });

  it('development still scans, so parallel local sessions keep working', () => {
    const block = source.slice(source.indexOf('async function resolvePort'), source.indexOf('async function startServer'));
    expect(block).toContain('findAvailablePort');
  });

  it('a startup failure exits non-zero instead of printing and continuing', () => {
    expect(source).not.toContain('startServer().catch(console.error)');
    expect(source.slice(source.indexOf('startServer().catch'))).toContain('process.exit(1)');
  });
});

describe('A9 - migration scripts (Phase 4B audit)', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

  it('an apply-only migration script exists for deploy pipelines', () => {
    expect(pkg.scripts['db:migrate']).toBe('drizzle-kit migrate');
    expect(pkg.scripts['db:migrate']).not.toContain('generate');
  });

  it('db:push is unchanged and still authors migrations for local work', () => {
    expect(pkg.scripts['db:push']).toBe('drizzle-kit generate && drizzle-kit migrate');
  });
});
