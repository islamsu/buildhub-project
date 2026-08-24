import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Where `name:` is declared in the router source, whatever tier follows it.
 *
 * Anchors used to read `name: adminProcedure`. Endpoints now sit behind the
 * permission they need - `adminWith('marketplace.manage')` - so a literal anchor
 * silently matched nothing, indexOf returned -1, and slice produced ''. Every
 * `expect(block).not.toMatch(...)` on that empty string then passed vacuously.
 * This throws instead, so a moved procedure breaks the test rather than hollowing
 * it out.
 */
function declarationOf(source: string, name: string): number {
  const at = source.search(new RegExp(`\\n\\s*${name}:\\s*(?:\\w+Procedure|adminWith\\()`));
  if (at === -1) throw new Error(`procedure ${name} not found in the router source`);
  return at;
}


/**
 * Admin-issued QA sign-in links (Phases 7-9).
 *
 * The replacement for the public "Dummy / Test user sign-in" form, which
 * advertised a test-login pathway to every visitor and had no environment
 * boundary. A LINK IS A CREDENTIAL, so the properties below are the ones that
 * make it a safe one - and each is the kind of thing a well-meaning refactor
 * quietly removes.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const ROUTERS = read('../server/routers.ts');
const SCHEMA = read('../drizzle/schema.ts');

const redeem = () => ROUTERS.slice(
  ROUTERS.indexOf('redeemTestLoginLink: publicProcedure'),
  ROUTERS.indexOf('capabilities: publicProcedure'),
);
const issue = () => ROUTERS.slice(
  declarationOf(ROUTERS, 'issueTestLoginLink'),
  declarationOf(ROUTERS, 'testLoginLinks'),
);

describe('the token is treated as a credential', () => {
  it('is generated from a CSPRNG, not a counter or a uuid', () => {
    expect(issue()).toContain('randomBytes(TEST_LOGIN_TOKEN_BYTES)');
    expect(ROUTERS).toContain('const TEST_LOGIN_TOKEN_BYTES = 32');
  });

  it('stores only the hash - a table dump must yield nothing redeemable', () => {
    expect(issue()).toContain('tokenHash: hashTestLoginToken(raw)');
    // The raw value must never be written to a column.
    expect(issue()).not.toMatch(/token:\s*raw\s*,\s*\n\s*userId/);
    expect(SCHEMA).toContain("varchar('tokenHash'");
    expect(SCHEMA).not.toContain("varchar('token'");
  });

  it('looks up BY hash, so redemption is an indexed lookup not a scan', () => {
    expect(redeem()).toContain('eq(testLoginTokens.tokenHash, hashTestLoginToken(input.token))');
  });

  it('never returns the hash to a client', () => {
    // An explicit column list, because select().from() would ship tokenHash to
    // every admin screen that renders this.
    const list = ROUTERS.slice(declarationOf(ROUTERS, 'testLoginLinks'), ROUTERS.indexOf('revokeTestLoginLink:'));
    expect(list).toContain('db.select({');
    expect(list).not.toContain('tokenHash: testLoginTokens.tokenHash');
  });
});

describe('redemption enforces every promise', () => {
  it('checks the environment boundary FIRST, before any work', () => {
    const r = redeem();
    const gate = r.indexOf('isTestLoginEnabled()');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(r.indexOf('enforceAuthRateLimit'));
    expect(gate).toBeLessThan(r.indexOf('getDb'));
    expect(r.slice(gate, r.indexOf('enforceAuthRateLimit'))).toContain("code: 'NOT_FOUND'");
  });

  it('rejects revoked, used and expired links', () => {
    const r = redeem();
    expect(r).toContain('row.revokedAt');
    expect(r).toContain('row.usedAt');
    expect(r).toContain('row.expiresAt.getTime() <= Date.now()');
  });

  it('gives every rejection the SAME message', () => {
    // Telling the holder which failure it was tells them whether they found a
    // real token. One reject() closure, used for all of them.
    const r = redeem();
    expect(r).toContain('const reject = ()');
    expect((r.match(/throw reject\(\);/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('re-checks the account at redemption, not only at issue', () => {
    // It could have been frozen, deleted or promoted since the link was cut.
    const r = redeem();
    expect(r).toContain('!target?.isDummy');
    expect(r).toContain("target.accountStatus !== 'active'");
    expect(r).toContain('target.deactivatedAt');
  });

  it('burns the token BEFORE issuing the session, conditionally on being unused', () => {
    // The isNull predicate is what makes single-use atomic: two simultaneous
    // redemptions race here and exactly one matches a row. Marking it used
    // after issuing the session would let both through.
    const r = redeem();
    const burn = r.indexOf('isNull(testLoginTokens.usedAt)');
    expect(burn).toBeGreaterThan(-1);
    expect(burn).toBeLessThan(r.indexOf('createSessionToken'));
    expect(r).toContain('if (affected === 0) throw reject();');
  });

  it('is rate limited', () => {
    expect(redeem()).toContain('enforceAuthRateLimit');
  });
});

describe('issuing is admin-only and QA-only', () => {
  it('requires an admin', () => {
    expect(ROUTERS).toContain("issueTestLoginLink: adminWith('qa.manage')");
    expect(ROUTERS).toContain("revokeTestLoginLink: adminWith('qa.manage')");
    expect(ROUTERS).toContain("testLoginLinks: adminWith('qa.manage')");
  });

  it('refuses to mint a link for a real account', () => {
    // A link into a real user would be a password-less backdoor into a real
    // account, which is the whole thing this design exists to avoid.
    expect(issue()).toContain('!target?.isDummy');
  });

  it('caps the lifetime', () => {
    expect(ROUTERS).toContain('TEST_LOGIN_TTL_MINUTES_MAX');
    expect(issue()).toContain('max(TEST_LOGIN_TTL_MINUTES_MAX)');
  });

  it('records who issued, redeemed and revoked', () => {
    expect(ROUTERS).toContain("action: 'test_login_link_issued'");
    expect(ROUTERS).toContain("action: 'test_login_link_redeemed'");
    expect(ROUTERS).toContain("action: 'test_login_link_revoked'");
    expect(SCHEMA).toContain("int('issuedBy')");
    expect(SCHEMA).toContain("int('revokedBy')");
  });
});

describe('the admin UI shows the token once and never re-offers it', () => {
  const ADMIN_UI = read('../client/src/pages/AdminDashboard.tsx');
  const AUTH_PAGE = read('../client/src/pages/AuthPage.tsx');

  it('lives in the admin area, not on any public page', () => {
    expect(ADMIN_UI).toContain('trpc.admin.issueTestLoginLink');
    expect(ADMIN_UI).toContain('trpc.admin.revokeTestLoginLink');
    // The public auth page may REDEEM a link, but must never issue one.
    expect(AUTH_PAGE).not.toContain('issueTestLoginLink');
  });

  it('holds the raw token only in component state, never persisted', () => {
    // No localStorage/sessionStorage: the server cannot show it again, so a
    // copy left in browser storage would outlive the only place it exists.
    const dialog = ADMIN_UI.slice(ADMIN_UI.indexOf('issuedToken'), ADMIN_UI.indexOf('dummyPasswordTarget)}'));
    expect(dialog).not.toContain('localStorage');
    expect(dialog).not.toContain('sessionStorage');
    expect(ADMIN_UI).toContain('setIssuedToken(null)');
  });

  it('tells the admin plainly that the token will not be shown again', () => {
    expect(ADMIN_UI).toContain('it will never be shown again');
  });

  it('warns when the capability is switched off rather than offering a dead link', () => {
    expect(ADMIN_UI).toContain('capabilities.data?.testLogin === true');
    expect(ADMIN_UI).toContain('will be refused when redeemed');
  });

  it('strips the token from the URL as soon as it is read', () => {
    // Otherwise a spent credential sits in the address bar, in history, and in
    // the Referer header of the next navigation.
    expect(AUTH_PAGE).toContain("window.history.replaceState({}, '', '/auth')");
    const effect = AUTH_PAGE.slice(AUTH_PAGE.indexOf('if (!qaToken || qaRedeemed.current) return;'));
    expect(effect.indexOf('replaceState')).toBeLessThan(effect.indexOf('redeemQaLink.mutate'));
  });

  it('redeems at most once per page load', () => {
    expect(AUTH_PAGE).toContain('qaRedeemed.current = true');
  });
});
