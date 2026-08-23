import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { Request } from 'express';

/**
 * A successful sign-in must hand back a session the very next request accepts.
 *
 * Three independent defects each broke that, and all three survived a suite of
 * 1,139 tests because every test that touched this area asserted on the SOURCE
 * TEXT rather than on behaviour. One of them - A7 in productionHardening -
 * even describes this exact hazard in its comment and then pins the half that
 * was correct. So these tests call the real functions and mint real tokens.
 *
 * Reproduced against a live server with a real browser before fixing:
 *   1. Set-Cookie: ...; SameSite=None   with no Secure -> browser kept ZERO cookies
 *   2. token minted with appId:"" -> its own verifier rejected it, auth.me null
 *   3. cache never invalidated -> sign-up landed on /auth?mode=login
 */

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

const fakeRequest = (over: Partial<Request> = {}): Request =>
  ({ protocol: 'http', headers: {}, ...over }) as unknown as Request;

describe('the session cookie must be one browsers actually keep', () => {
  const load = async (env: Record<string, string | undefined>) => {
    vi.resetModules();
    process.env = { ...ORIGINAL, ...env };
    return (await import('./_core/cookies')).getSessionCookieOptions;
  };

  it('NEVER emits SameSite=None without Secure, in any environment', async () => {
    // The whole defect in one invariant. Browsers reject the pairing outright
    // rather than downgrading it, so this combination is not "less safe" - it
    // is a cookie that does not exist.
    for (const NODE_ENV of ['production', 'development', 'test', undefined]) {
      const getOptions = await load({ NODE_ENV });
      for (const req of [fakeRequest(), fakeRequest({ protocol: 'https' }),
                         fakeRequest({ headers: { 'x-forwarded-proto': 'https' } })]) {
        const options = getOptions(req);
        if (options.sameSite === 'none') {
          expect(options.secure, `NODE_ENV=${NODE_ENV} emitted SameSite=None without Secure`).toBe(true);
        }
      }
    }
  });

  it('falls back to Lax on a plain-HTTP request, so local development can log in', async () => {
    const getOptions = await load({ NODE_ENV: 'development' });
    const options = getOptions(fakeRequest());
    expect(options.secure).toBe(false);
    expect(options.sameSite).toBe('lax');
  });

  it('still uses None + Secure in production, so cross-site embedding is unchanged', async () => {
    const getOptions = await load({ NODE_ENV: 'production' });
    const options = getOptions(fakeRequest());
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe('none');
  });

  it('honours x-forwarded-proto, so a TLS-terminating proxy still gets None + Secure', async () => {
    const getOptions = await load({ NODE_ENV: 'development' });
    const options = getOptions(fakeRequest({ headers: { 'x-forwarded-proto': 'https' } }));
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe('none');
  });

  it('is always HttpOnly, whatever else it decides', async () => {
    const getOptions = await load({ NODE_ENV: 'development' });
    expect(getOptions(fakeRequest()).httpOnly).toBe(true);
  });
});

describe('a token this server mints must be one this server accepts', () => {
  const SECRET = 'session-establishment-test-secret-value';

  const load = async (appId: string | undefined) => {
    vi.resetModules();
    process.env = { ...ORIGINAL, JWT_SECRET: SECRET, VITE_APP_ID: appId };
    return (await import('./_core/sdk')).sdk;
  };

  /** A token with an arbitrary payload, signed with the server's real secret. */
  const mint = async (payload: Record<string, unknown>, secret = SECRET) =>
    new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setJti('11111111-2222-3333-4444-555555555555')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret));

  it('accepts its own freshly minted token when VITE_APP_ID is UNSET', async () => {
    // The defect, stated as a test. createSessionToken stamps `appId: ENV.appId`
    // and ENV.appId falls back to "". Requiring appId to be non-empty therefore
    // rejected every session this server issued - sign-up returned success, set
    // the cookie, and the user was silently anonymous from the next request on.
    // .env.example ships VITE_APP_ID empty, so the documented local setup could
    // not authenticate anybody.
    const sdk = await load(undefined);
    const token = await sdk.createSessionToken('local_unset-appid', { name: 'Someone' });
    const session = await sdk.verifySession(token);
    expect(session).not.toBeNull();
    expect(session!.openId).toBe('local_unset-appid');
  });

  it('accepts its own freshly minted token when VITE_APP_ID IS set', async () => {
    const sdk = await load('buildhub-staging');
    const token = await sdk.createSessionToken('local_set-appid', { name: 'Someone' });
    expect(await sdk.verifySession(token)).not.toBeNull();
  });

  it('rejects a token minted for a DIFFERENT app once one is configured', async () => {
    // Strictly stronger than the check it replaced: the old one accepted any
    // non-empty appId without ever comparing it to anything.
    const sdk = await load('buildhub-staging');
    const foreign = await mint({ openId: 'local_x', appId: 'someone-elses-app', name: 'X' });
    expect(await sdk.verifySession(foreign)).toBeNull();
  });

  it('does not reject a token merely for carrying no name', async () => {
    // `createSessionToken(openId)` with no options - the usage this file
    // documents as its own example - mints name:"". That must not be fatal;
    // a display name is not a security property.
    const sdk = await load(undefined);
    const token = await sdk.createSessionToken('local_no-name');
    const session = await sdk.verifySession(token);
    expect(session).not.toBeNull();
    expect(session!.name).toBe('');
  });

  it('STILL rejects a token with no openId, which is the one field that matters', async () => {
    const sdk = await load(undefined);
    expect(await sdk.verifySession(await mint({ appId: '', name: 'No subject' }))).toBeNull();
  });

  it('STILL rejects a token signed with a different secret', async () => {
    // The actual trust boundary, unchanged by any of this.
    const sdk = await load(undefined);
    const forged = await mint({ openId: 'local_forged', appId: '', name: 'Forged' }, 'a-completely-different-secret');
    expect(await sdk.verifySession(forged)).toBeNull();
  });

  it('STILL rejects an expired token', async () => {
    const sdk = await load(undefined);
    const expired = await new SignJWT({ openId: 'local_old', appId: '', name: 'Old' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(SECRET));
    expect(await sdk.verifySession(expired)).toBeNull();
  });

  it('rejects an empty or absent cookie without throwing', async () => {
    const sdk = await load(undefined);
    expect(await sdk.verifySession(undefined)).toBeNull();
    expect(await sdk.verifySession('')).toBeNull();
    expect(await sdk.verifySession('not-a-jwt')).toBeNull();
  });
});

describe('signing in must refresh the cached session before navigating', () => {
  const source = () => require('node:fs').readFileSync(
    new URL('../client/src/pages/AuthPage.tsx', import.meta.url), 'utf8');

  it('invalidates auth.me before sending the user to a protected route', async () => {
    // useAuth reads auth.me from the React Query cache, which still holds the
    // `null` fetched when /auth loaded anonymously. Navigating without
    // refreshing it let the destination's guard see an anonymous user and
    // bounce to /auth?mode=login via window.location.href - a full page load,
    // which discarded the refetch too. Sign-up ended on the login screen while
    // holding a valid session; a manual reload landed on the right page.
    const block = source().slice(source().indexOf('const goAfterAuth'), source().indexOf('const signIn'));
    expect(block).toContain('await utils.auth.me.invalidate()');
    expect(block.indexOf('await utils.auth.me.invalidate()')).toBeLessThan(block.indexOf('navigate('));
  });

  it('routes every post-authentication path through that one helper', async () => {
    // signIn, signUp and QA-link redemption. Redemption used to inline its own
    // copy of the navigation and so would have kept the bug on its own.
    const text = source();
    for (const mutation of ['signIn', 'signUp', 'redeemTestLoginLink']) {
      const at = text.indexOf(`trpc.auth.${mutation}.useMutation`);
      expect(at, `${mutation} not found`).toBeGreaterThan(-1);
      expect(text.slice(at, at + 600), `${mutation} does not go through goAfterAuth`).toContain('goAfterAuth(');
    }
  });
});

describe('a metric label must survive the narrowest screen we support', () => {
  const rolePlatform = () => require('node:fs').readFileSync(
    new URL('../client/src/pages/RolePlatform.tsx', import.meta.url), 'utf8');

  /**
   * The <p> that renders `expression`, found by matching the element itself.
   *
   * An earlier version of this sliced a window around
   * indexOf('{metric.label}') - which matched `<Card key={metric.label}>` a
   * hundred characters earlier, so the window never contained the className at
   * all and the test passed whatever the code said. It survived its own
   * mutation test. Hence matching the element, and asserting it was found.
   */
  const paragraphRendering = (expression: string): string => {
    const found = rolePlatform().match(
      new RegExp(`<p className="([^"]*)">\\{${expression}\\}</p>`));
    expect(found, `no <p> renders {${expression}} - this test would otherwise be vacuous`).not.toBeNull();
    return found![1];
  };

  it('does not truncate the label that names the number', () => {
    // Measured in a real browser at 375px: the two-column grid minus a fixed
    // 44px icon, the gap and the padding left ~63px, while "Total Projects"
    // needed 72px and "Active Projects" 79px. English degraded to a guessable
    // "Total Projec..."; Arabic degraded to "إجمالي ال...", which names nothing.
    expect(paragraphRendering('metric\\.label')).not.toContain('truncate');
  });

  it('still truncates the VALUE, which is short and must stay on one line', () => {
    expect(paragraphRendering('metric\\.value')).toContain('truncate');
  });

  it('stacks the icon above the text before the row gets too narrow', () => {
    // The other half of the fix: without this the label still only gets the
    // width the icon leaves behind, and merely wraps into a thin column.
    const source = rolePlatform();
    const card = source.slice(source.indexOf('{metrics.map(metric => ('), source.indexOf('{metrics.map(metric => (') + 1400);
    expect(card).toContain('flex-col');
    expect(card).toContain('sm:flex-row');
  });
});
