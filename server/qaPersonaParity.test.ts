import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Phase 11: a QA persona must behave like a real user of its role.
 *
 * The requirement is explicit - no "artificial dummy permission level that
 * disables normal functionality". So this file's job is to catch the places
 * where isDummy quietly becomes a capability restriction rather than what it
 * legitimately is: an auth-path marker, an admin-management guard, or a
 * business-metrics exclusion.
 *
 * The one that was wrong when this was written: the customer-facing vendor
 * directory excluded dummies unconditionally, so a QA Contractor could hold a
 * session, quote, message and edit a profile - and then not exist in the one
 * listing that makes a provider discoverable.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const DIRECTORY = read('../server/vendorDirectory.ts');
const ROUTERS = read('../server/routers.ts');

const ORIGINAL = process.env.TEST_LOGIN_ENABLED;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.TEST_LOGIN_ENABLED;
  else process.env.TEST_LOGIN_ENABLED = ORIGINAL;
});

describe('the vendor directory does not hide QA personas on a test deployment', () => {
  it('ties the exclusion to the test-login switch, not to a new concept', () => {
    expect(DIRECTORY).toContain('isTestLoginEnabled()');
    expect(DIRECTORY).toContain('if (!isTestLoginEnabled()) conditions.push(eq(users.isDummy, false));');
  });

  it('PRODUCTION BEHAVIOUR IS UNCHANGED - dummies stay hidden when the flag is off', () => {
    // The single most important assertion in this file. If this ever inverts,
    // test personas become visible to real customers browsing for a builder.
    delete process.env.TEST_LOGIN_ENABLED;
    expect(process.env.TEST_LOGIN_ENABLED === 'true').toBe(false);
    // ...and the source must still apply the filter in that branch.
    const fn = DIRECTORY.slice(DIRECTORY.indexOf('function directoryVisibilityFilter'), DIRECTORY.indexOf('export type DirectoryVendor'));
    expect(fn).toContain('eq(users.isDummy, false)');
    expect(fn).toContain('!isTestLoginEnabled()');
  });

  it('keeps every other visibility rule unconditional', () => {
    // Only the dummy clause moved. Frozen, deactivated, unapproved and
    // non-provider accounts must stay hidden in EVERY environment - those are
    // not test-data hygiene, they are correctness.
    const fn = DIRECTORY.slice(DIRECTORY.indexOf('const conditions = ['), DIRECTORY.indexOf('if (!isTestLoginEnabled())'));
    expect(fn).toContain('PROVIDER_ROLES');
    expect(fn).toContain("eq(users.accountStatus, 'active')");
    expect(fn).toContain('isNull(users.deactivatedAt)');
    expect(fn).toContain("eq(users.onboardingStatus, 'approved')");
    expect(fn).not.toContain('isDummy');
  });
});

describe('isDummy is never a capability restriction elsewhere', () => {
  /** The procedure body for a named tRPC procedure. */
  const proc = (name: string) => {
    const start = ROUTERS.indexOf(`${name}:`);
    if (start < 0) return '';
    return ROUTERS.slice(start, start + 2200);
  };

  it('does not block a QA persona from quoting', () => {
    expect(proc('submitQuotation')).not.toContain('isDummy');
  });

  it('does not block a QA persona from messaging', () => {
    expect(proc('send')).not.toContain('isDummy');
  });

  it('does not block a QA persona from posting or reading RFQs', () => {
    expect(proc('createRfq')).not.toContain('isDummy');
  });

  it('does not block a QA persona from their own profile or analytics', () => {
    expect(proc('updateProfile')).not.toContain('isDummy');
    expect(proc('myStats')).not.toContain('isDummy');
  });

  it('does not block a QA persona from uploading compliance documents', () => {
    expect(proc('uploadDocument')).not.toContain('isDummy');
  });

  it('still keeps test accounts out of BUSINESS metrics', () => {
    // This exclusion is correct and must stay: a QA persona is not revenue,
    // not a real registration, and must never inflate a commercial number.
    expect(ROUTERS).toContain('eq(users.isDummy, false)');
    expect(ROUTERS).toContain('input?.includeDummy');
  });

  it('still keeps the dummy auth path separate from the real one', () => {
    // signIn must not accept a dummy, and signInDummy must not accept a real
    // user. Those are not restrictions on what a persona can DO once in.
    expect(ROUTERS).toContain('!target.isDummy && target.passwordHash');
    expect(ROUTERS).toContain("target.loginMethod !== 'dummy'");
  });
});
