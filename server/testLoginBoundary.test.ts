import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Test-user sign-in must not exist in production.
 *
 * auth.signInDummy was a publicProcedure with NO environment gate: identical
 * behaviour in staging and production. The only thing in front of a production
 * session was account state - dummy accounts are created frozen and
 * deactivated - so an admin who unfroze one in production would have opened a
 * password-only door with no environment restriction and no second factor.
 *
 * The gate CANNOT be `isProduction`. Staging runs NODE_ENV=production too
 * (render.yaml sets it), so that check would either disable test login on
 * staging - the one place it is meant to work - or leave it live in
 * production. Hence an explicit, default-denied flag.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const ROUTERS = read('../server/routers.ts');
const ENV_SRC = read('../server/_core/env.ts');
const AUTH_PAGE = read('../client/src/pages/AuthPage.tsx');
const RENDER = read('../render.yaml');

const ORIGINAL = process.env.TEST_LOGIN_ENABLED;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.TEST_LOGIN_ENABLED;
  else process.env.TEST_LOGIN_ENABLED = ORIGINAL;
});

/** Re-evaluates the flag exactly as env.ts does. */
const flag = (value?: string) => {
  if (value === undefined) delete process.env.TEST_LOGIN_ENABLED;
  else process.env.TEST_LOGIN_ENABLED = value;
  return process.env.TEST_LOGIN_ENABLED === 'true';
};

describe('the flag fails closed', () => {
  it('is OFF when unset - the production case', () => {
    expect(flag(undefined)).toBe(false);
  });

  it('is OFF for every truthy-looking value that is not exactly "true"', () => {
    // A misconfiguration must not open the door. These are the values someone
    // reaches for when they mean "on".
    for (const v of ['1', 'yes', 'YES', 'TRUE', 'True', 'on', 'enabled', ' true', 'true ', '']) {
      expect(flag(v), `TEST_LOGIN_ENABLED=${JSON.stringify(v)} must be OFF`).toBe(false);
    }
  });

  it('is ON only for the exact string "true"', () => {
    expect(flag('true')).toBe(true);
  });

  it('compares against the exact string in source, not a loose coercion', () => {
    expect(ENV_SRC).toContain('process.env.TEST_LOGIN_ENABLED === "true"');
    expect(ENV_SRC).toContain('PRODUCTION MUST NEVER SET THIS');
  });
});

describe('the server refuses before doing any work', () => {
  const proc = () => {
    const start = ROUTERS.indexOf('signInDummy: publicProcedure');
    return ROUTERS.slice(start, ROUTERS.indexOf('return { success: true', start));
  };

  it('checks the flag inside signInDummy', () => {
    expect(proc()).toContain('!isTestLoginEnabled()');
  });

  it('checks it BEFORE the rate limiter and before any database read', () => {
    // A disabled deployment must do no work and reveal nothing about which
    // usernames exist - not even through timing.
    const p = proc();
    const gate = p.indexOf('!isTestLoginEnabled()');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(p.indexOf('enforceAuthRateLimit'));
    expect(gate).toBeLessThan(p.indexOf('getUserByUsername'));
  });

  it('answers NOT_FOUND, so a disabled deployment does not confirm the feature exists', () => {
    const p = proc();
    const gate = p.slice(p.indexOf('!isTestLoginEnabled()'), p.indexOf('enforceAuthRateLimit'));
    expect(gate).toContain("code: 'NOT_FOUND'");
    expect(gate).not.toContain('FORBIDDEN');
    expect(gate).not.toContain('UNAUTHORIZED');
  });

  it('still enforces every pre-existing condition once enabled', () => {
    // The boundary is added IN FRONT OF the old checks, never instead of them.
    const p = proc();
    expect(p).toContain('isDummy');
    expect(p).toContain("loginMethod !== 'dummy'");
    expect(p).toContain('verifyPassword');
    expect(p).toContain("accountStatus !== 'active'");
    expect(p).toContain('deactivatedAt');
    expect(p).toContain('enforceAuthRateLimit');
  });

  it('reports the capability so the UI never renders a door the server refuses', () => {
    expect(ROUTERS).toContain('testLogin: isTestLoginEnabled()');
  });
});

describe('the public auth page no longer advertises it', () => {
  it('has no test-user sign-in panel', () => {
    const code = AUTH_PAGE.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(code).not.toContain('Dummy / Test user sign-in');
    expect(code).not.toContain('Sign in as dummy');
    expect(code).not.toContain('Dummy username');
  });

  it('no longer calls signInDummy from the public page', () => {
    const code = AUTH_PAGE.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(code).not.toContain('trpc.auth.signInDummy');
    expect(code).not.toContain('handleDummySignIn');
  });

  it('ships no test credentials of any kind', () => {
    const code = AUTH_PAGE.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(code).not.toMatch(/password\s*[:=]\s*['"][^'"]{6,}['"]/i);
    expect(code).not.toMatch(/@(example|test)\.(com|invalid)/i);
  });
});

describe('the blueprint enables it on staging only', () => {
  it('staging sets it to the exact string "true"', () => {
    expect(RENDER).toContain('key: TEST_LOGIN_ENABLED');
    expect(RENDER).toMatch(/TEST_LOGIN_ENABLED\s*\n\s*value:\s*"true"/);
  });

  it('carries the warning where the value is set', () => {
    expect(RENDER).toContain('PRODUCTION MUST NEVER SET THIS');
  });
});
