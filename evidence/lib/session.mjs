/**
 * A REAL ADMIN SESSION, OBTAINED ONCE AND REUSED ACROSS PROBE RUNS.
 *
 * BuildHub rate-limits auth.adminSignIn by IP burst and by identifier - which
 * is correct, and which the probes were tripping: each run signed in twice, and
 * a verification pass runs several probes several times. The failure was loud
 * (every probe aborts if sign-in fails rather than reporting a 401 as a
 * successful denial), but it made re-verification impossible.
 *
 * The fix is not to raise the limit or to skip the sign-in. It is to sign in
 * once and keep the cookie: the session is exactly as real, and the probe still
 * proves the credential works because a stale cookie is detected and a fresh
 * sign-in performed.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CACHE_DIR = '/tmp/zg-sessions';
const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';

const cachePath = identifier => join(CACHE_DIR, `${identifier.replace(/[^a-z0-9]/gi, '_')}.txt`);

/** Does this cookie still name a signed-in administrator? */
async function stillValid(cookie) {
  if (!cookie) return false;
  const res = await fetch(`${BASE}/api/trpc/auth.me?input=${encodeURIComponent('{"json":null}')}`,
    { headers: { cookie } });
  if (res.status !== 200) return false;
  const body = await res.json().catch(() => null);
  return Boolean(body?.result?.data?.json?.id ?? body?.result?.data?.json?.user?.id);
}

/**
 * Returns { ok, cookie, reused }. Never throws on a rate limit - it reports it,
 * so a probe can abort with an accurate reason instead of a misleading 401.
 */
export async function adminSession(identifier, password) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = cachePath(identifier);

  if (existsSync(path)) {
    const cached = readFileSync(path, 'utf8').trim();
    if (await stillValid(cached)) return { ok: true, cookie: cached, reused: true };
  }

  const res = await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier, password } }),
  });
  if (res.status !== 200) {
    const body = await res.json().catch(() => null);
    return { ok: false, cookie: '', reused: false, reason: body?.error?.json?.message ?? `HTTP ${res.status}` };
  }
  const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  if (!cookie) return { ok: false, cookie: '', reused: false, reason: 'no session cookie returned' };
  writeFileSync(path, cookie);
  return { ok: true, cookie, reused: false };
}

/** The cookie split into CDP cookie objects, for the browser probes. */
export function asBrowserCookies(cookie, domain = '127.0.0.1') {
  return cookie.split('; ').filter(Boolean).map(pair => {
    const index = pair.indexOf('=');
    return { name: pair.slice(0, index), value: pair.slice(index + 1), domain, path: '/' };
  });
}
