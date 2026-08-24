// ── ADMIN_BOOTSTRAP_* ──────────────────────────────────────────────────────
//
// The properties that stop this being the backdoor scripts/create-admin.mjs
// warns about:
//
//   1. It creates the FIRST administrator only. Any existing admin makes it a
//      no-op, so a restart, redeploy or crash loop cannot reset anybody.
//   2. It CREATES rather than promotes, so pointing it at an existing user's
//      email grants that person nothing.
//   3. It never becomes a request handler - process start is the only trigger.
//   4. It is never fatal, so a bad value degrades to "no admin" and not to a
//      boot loop that takes the site down.
//
// It also must not reach the browser: a VITE_ prefix would inline the password
// into the client bundle.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({ getDb: vi.fn() }));
import { getDb } from './db';
import { bootstrapFirstAdmin, runAdminBootstrap } from './adminBootstrap';

const SOURCE = readFileSync(new URL('./adminBootstrap.ts', import.meta.url), 'utf8');
const ENV_EXAMPLE = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const RENDER = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');

const ORIGINAL = { ...process.env };
const GOOD = {
  ADMIN_BOOTSTRAP_EMAIL: 'ops@buildhub.test',
  ADMIN_BOOTSTRAP_USERNAME: 'buildhub-admin',
  ADMIN_BOOTSTRAP_PASSWORD: 'a-long-enough-bootstrap-password',
};

/** Row count for the "does an admin already exist?" probe. */
function stubDb(adminCount: number) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  const insertValues = vi.fn().mockResolvedValue([{ insertId: 1 }]);
  Object.assign(builder, {
    from: vi.fn(self), where: vi.fn(self),
    then: (resolve: (value: unknown) => unknown) => resolve([{ count: adminCount }]),
  });
  const db = { select: vi.fn(() => builder), insert: vi.fn(() => ({ values: insertValues })) };
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
  return { db, insertValues };
}

beforeEach(() => { vi.clearAllMocks(); process.env = { ...ORIGINAL }; });
afterEach(() => { process.env = { ...ORIGINAL }; });

describe('idempotence - the property that makes this safe to ship', () => {
  it('creates the administrator when there is none', async () => {
    process.env = { ...ORIGINAL, ...GOOD };
    const { insertValues } = stubDb(0);
    await expect(bootstrapFirstAdmin()).resolves.toMatchObject({ outcome: 'created' });
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.role).toBe('admin');
    expect(row.adminRole).toBe('SUPER_ADMIN');
    expect(row.username).toBe('buildhub-admin');
  });

  it('does NOTHING when an administrator already exists', async () => {
    process.env = { ...ORIGINAL, ...GOOD };
    const { db, insertValues } = stubDb(1);
    await expect(bootstrapFirstAdmin()).resolves.toEqual({ outcome: 'already-exists' });
    expect(insertValues).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('never overwrites a password or re-roles anybody', () => {
    // The whole file must contain no UPDATE at all. An insert-only bootstrap
    // cannot reset an existing administrator however it is invoked.
    expect(SOURCE).not.toMatch(/\.update\(/);
    expect(SOURCE).not.toMatch(/passwordHash:\s*await hashPassword\(password\)[\s\S]{0,200}\.update/);
  });

  it('checks for ANY administrator, not one matching this email', () => {
    // Scoping the probe by email would let a second bootstrap create a second
    // Super Admin under a different address.
    const probe = SOURCE.slice(SOURCE.indexOf('THE IDEMPOTENCE GATE'), SOURCE.indexOf('const passwordHash'));
    expect(probe).toContain("eq(users.role, 'admin')");
    expect(probe).not.toContain('users.email');
  });

  it('treats a lost insert race as already-exists rather than crashing the boot', async () => {
    process.env = { ...ORIGINAL, ...GOOD };
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    Object.assign(builder, {
      from: vi.fn(self), where: vi.fn(self),
      then: (resolve: (value: unknown) => unknown) => resolve([{ count: 0 }]),
    });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
      select: vi.fn(() => builder),
      insert: vi.fn(() => ({ values: vi.fn().mockRejectedValue(new Error('ER_DUP_ENTRY')) })),
    });
    await expect(bootstrapFirstAdmin()).resolves.toEqual({ outcome: 'already-exists' });
  });
});

describe('it validates before it writes', () => {
  it('is silent and inert when nothing is configured', async () => {
    await expect(bootstrapFirstAdmin()).resolves.toEqual({ outcome: 'not-configured' });
  });

  it('refuses a partial configuration rather than inventing the rest', async () => {
    process.env = { ...ORIGINAL, ADMIN_BOOTSTRAP_EMAIL: 'ops@buildhub.test' };
    await expect(bootstrapFirstAdmin()).resolves.toMatchObject({ outcome: 'invalid' });
  });

  it('demands a password longer than a customer account needs', async () => {
    process.env = { ...ORIGINAL, ...GOOD, ADMIN_BOOTSTRAP_PASSWORD: 'short-pw' };
    const result = await bootstrapFirstAdmin();
    expect(result).toMatchObject({ outcome: 'invalid' });
    expect((result as { reason: string }).reason).toContain('12');
  });

  it('refuses a malformed username or email', async () => {
    process.env = { ...ORIGINAL, ...GOOD, ADMIN_BOOTSTRAP_USERNAME: 'no spaces allowed' };
    await expect(bootstrapFirstAdmin()).resolves.toMatchObject({ outcome: 'invalid' });
    process.env = { ...ORIGINAL, ...GOOD, ADMIN_BOOTSTRAP_EMAIL: 'not-an-email' };
    await expect(bootstrapFirstAdmin()).resolves.toMatchObject({ outcome: 'invalid' });
  });

  it('degrades rather than throwing when the database is unavailable', async () => {
    process.env = { ...ORIGINAL, ...GOOD };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(bootstrapFirstAdmin()).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('runAdminBootstrap NEVER throws, whatever happens underneath', async () => {
    // A bad bootstrap must not become a boot loop.
    process.env = { ...ORIGINAL, ...GOOD };
    (getDb as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('connection refused'));
    await expect(runAdminBootstrap()).resolves.toEqual({ outcome: 'unavailable' });
  });
});

describe('nothing about it reaches the browser or the log', () => {
  it('uses no VITE_ prefix, which would inline the password into the bundle', () => {
    expect(SOURCE).not.toContain('VITE_ADMIN');
    expect(ENV_EXAMPLE).not.toContain('VITE_ADMIN_BOOTSTRAP');
    expect(RENDER).not.toContain('VITE_ADMIN_BOOTSTRAP');
  });

  it('never logs the password, nor anything derived from it', async () => {
    process.env = { ...ORIGINAL, ...GOOD };
    stubDb(0);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runAdminBootstrap();
    const printed = [...log.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(printed).not.toContain(GOOD.ADMIN_BOOTSTRAP_PASSWORD);
    expect(printed).not.toContain('scrypt$');
    log.mockRestore(); error.mockRestore();
  });

  it('is reachable only from process start - it is not a procedure', () => {
    const routers = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    expect(routers).not.toContain('bootstrapFirstAdmin');
    expect(routers).not.toContain('ADMIN_BOOTSTRAP');
    const index = readFileSync(new URL('./_core/index.ts', import.meta.url), 'utf8');
    expect(index).toContain('await runAdminBootstrap()');
  });

  it('is documented in .env.example without a real value', () => {
    expect(ENV_EXAMPLE).toContain('ADMIN_BOOTSTRAP_EMAIL=');
    expect(ENV_EXAMPLE).toContain('ADMIN_BOOTSTRAP_USERNAME=');
    expect(ENV_EXAMPLE).toContain('ADMIN_BOOTSTRAP_PASSWORD=');
    expect(ENV_EXAMPLE).not.toMatch(/ADMIN_BOOTSTRAP_PASSWORD=.+/);
  });
});
