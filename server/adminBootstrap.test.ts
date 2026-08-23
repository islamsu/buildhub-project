import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hashPassword, verifyPassword } from './routers';
import {
  hashPasswordForBootstrap,
  validateAdminPassword,
  ADMIN_PASSWORD_MIN_LENGTH,
  APP_PASSWORD_MIN_LENGTH,
} from '../scripts/create-admin.mjs';

/**
 * The first administrator.
 *
 * BuildHub could not create one. admin.createUser and admin.createDummyUser are
 * both adminProcedure, registration never sets role='admin', and there is no
 * first-user rule - so making an admin required already being one. On a fresh
 * database that is a dead end, in production as much as in staging.
 *
 * The fix is deliberately an OPERATOR TOOL rather than an application feature.
 * An auto-promoting env var, a first-user rule, or a bootstrap endpoint would
 * each be a privilege-escalation primitive living in production forever. These
 * tests pin that boundary, and pin the thing most likely to rot: the script
 * carries its own copy of the password hashing, so it must stay compatible
 * with the application's.
 */

const SCRIPT = readFileSync(new URL('../scripts/create-admin.mjs', import.meta.url), 'utf8');

describe('the bootstrap script hashes exactly like the application', () => {
  it('produces a hash the application accepts', async () => {
    const password = 'a-correct-horse-battery-staple';
    const hash = await hashPasswordForBootstrap(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
  });

  it('produces a hash the application rejects for the wrong password', async () => {
    const hash = await hashPasswordForBootstrap('the-real-password-value');
    await expect(verifyPassword('not-the-password', hash)).resolves.toBe(false);
  });

  it('emits the same hash format the application emits', async () => {
    const mine = await hashPasswordForBootstrap('some-password-value');
    const theirs = await hashPassword('some-password-value');
    const shape = /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/;
    expect(mine).toMatch(shape);
    expect(theirs).toMatch(shape);
  });

  it('salts, so two runs of the same password differ', async () => {
    const a = await hashPasswordForBootstrap('identical-password');
    const b = await hashPasswordForBootstrap('identical-password');
    expect(a).not.toBe(b);
    await expect(verifyPassword('identical-password', a)).resolves.toBe(true);
    await expect(verifyPassword('identical-password', b)).resolves.toBe(true);
  });
});

describe('it refuses the ways an operator could get this wrong', () => {
  it('requires more of an admin password than of a user password', () => {
    expect(ADMIN_PASSWORD_MIN_LENGTH).toBeGreaterThan(APP_PASSWORD_MIN_LENGTH);
    expect(validateAdminPassword('short')).toBeTruthy();
    expect(validateAdminPassword('a'.repeat(APP_PASSWORD_MIN_LENGTH))).toBeTruthy();
    expect(validateAdminPassword('a'.repeat(ADMIN_PASSWORD_MIN_LENGTH))).toBeNull();
  });

  it('rejects an empty or over-long password', () => {
    expect(validateAdminPassword('')).toBeTruthy();
    expect(validateAdminPassword(undefined)).toBeTruthy();
    expect(validateAdminPassword('a'.repeat(129))).toBeTruthy();
  });

  it('never accepts the password as a command-line argument', () => {
    // argv is world-readable through ps and lands in shell history.
    expect(SCRIPT).toContain("a === '--password'");
    expect(SCRIPT).toContain('BOOTSTRAP_ADMIN_PASSWORD');
  });

  it('refuses to run once any administrator exists', () => {
    // Bootstrapping is for the FIRST admin. A script that can mint admin
    // number two is a backdoor with extra steps.
    expect(SCRIPT).toContain("role = 'admin'");
    expect(SCRIPT).toContain('process.exit(3)');
  });

  it('creates an account the application will actually accept at sign-in', () => {
    // auth.signIn requires !isDummy, a passwordHash, accountStatus 'active'
    // and no deactivatedAt. An admin that cannot log in is not a bootstrap.
    expect(SCRIPT).toContain("'admin'");
    expect(SCRIPT).toContain("'active'");
    expect(SCRIPT).toMatch(/isDummy[\s\S]{0,400}0,/);
  });
});

describe('it stays out of the running application', () => {
  it('is not referenced by any server module', () => {
    // The moment the app imports this, it stops being an operator tool.
    for (const file of ['../server/routers.ts', '../server/_core/index.ts']) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8')).not.toContain('create-admin');
    }
  });

  it('is not wired into container start or any deploy step', () => {
    const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
    const render = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');
    expect(dockerfile).not.toContain('create-admin');
    expect(render).not.toContain('create-admin');
  });

  it('adds no env-var route to admin inside the app', () => {
    // The auto-promotion backdoor, checked for by name.
    const routers = readFileSync(new URL('../server/routers.ts', import.meta.url), 'utf8');
    for (const backdoor of ['ADMIN_EMAIL', 'BOOTSTRAP_ADMIN', 'SEED_ADMIN', 'INITIAL_ADMIN']) {
      expect(routers).not.toContain(backdoor);
    }
  });
});
