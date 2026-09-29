/**
 * ── EVERY UPLOAD FAMILY, AGAINST THE RUNNING DOWNLOAD PROXY ───────────────
 *
 * BuildHub stores files under a prefix per family, and `/manus-storage/*`
 * decides access by dispatching on that prefix, with a fail-closed default. A
 * family whose branch is MISSING therefore does not become insecure - it
 * becomes unreadable, which is how `portfolio-images/` shipped: providers
 * uploaded work samples that nobody, including themselves, could ever load.
 *
 * OBJECT STORAGE IS NOT CONFIGURED ON THIS DEPLOYMENT, and that is exactly
 * what makes this probe possible rather than what stops it. The proxy answers
 * in a fixed order - 401 unauthenticated, 403 unauthorized, 503 authorized but
 * no storage backend - so with S3 unset the AUTHORIZATION DECISION is
 * observable on its own:
 *
 *     403 = the proxy refused this caller
 *     503 = the proxy ALLOWED this caller and had no bucket to serve from
 *
 * A real byte-for-byte round trip through a bucket remains BLOCKED by that
 * missing configuration and is NOT claimed here.
 */
import { execSync } from 'node:child_process';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';

/* WHICH BUILD THIS RAN AGAINST. Printed always; enforced when
   ZG_EXPECT_COMMIT names one, so a pass can never be reported against
   a build somebody did not mean to test. */
await assertBuild(BASE);
const stamp = Date.now().toString().slice(-8);

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};
const sql = q => execSync('mysql -h 127.0.0.1 -u bh -pbhlocal buildhub_prelaunch -N -B',
  { input: q, encoding: 'utf8' }).trim();

async function signup(username, userRole) {
  const res = await fetch(`${BASE}/api/trpc/auth.signUp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: {
      username, email: `${username}@example.test`, password: 'ProbePass!2024',
      name: `Probe ${userRole}`, userRole,
    } }),
  });
  if (res.status !== 200) throw new Error(`signUp ${username}: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

const fetchKey = async (cookie, key) => (await fetch(
  `${BASE}/manus-storage/${key}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' },
)).status;

async function post(cookie, path, input) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ json: input }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.result?.data?.json, error: body?.error?.json?.message };
}

try {
  const providerCookie = await signup(`zup${stamp}prov`, 'supplier');
  const otherCookie = await signup(`zup${stamp}other`, 'supplier');
  const providerId = Number(sql(`select id from users where username='zup${stamp}prov'`));
  const otherId = Number(sql(`select id from users where username='zup${stamp}other'`));
  // portfolio.create is an approvedProviderProcedure, so an unapproved account
  // is refused BEFORE the ownership rule is ever consulted - which made the
  // theft check pass for the wrong reason on the first run. Approval is a
  // different system, verified by its own probes; here it is setup.
  sql(`update users set onboardingStatus='approved' where username like 'zup${stamp}%'`);
  const approved = sql(`select count(*) from users where username like 'zup${stamp}%' and onboardingStatus='approved'`);
  check(providerId > 0 && otherId > 0 && approved === '2',
    '1. SETUP: two real, APPROVED provider accounts',
    `provider=${providerId} other=${otherId} approved=${approved}`);

  // ── The refusal vocabulary is real, or nothing below means anything ─────
  check(await fetchKey(null, `avatars/${providerId}/x.png`) === 401,
    '2. an unauthenticated request is refused 401 before any prefix is read');

  const wellFormed = await fetchKey(providerCookie, `legacy-unclassified/${providerId}/x.png`);
  check(wellFormed === 403,
    '3. and an UNCLASSIFIED prefix still fails closed with 403 — the default holds',
    `http ${wellFormed}`);

  const traversal = await fetchKey(providerCookie, `portfolio-images/user-${providerId}/../../etc/passwd`);
  check(traversal === 403, '4. a traversal key is refused even inside a served family',
    `http ${traversal}`);

  // ── THE DEFECT: every family a router writes must be SERVABLE ───────────
  const families = [
    ['avatars', `avatars/${providerId}/x.png`],
    ['product-images', `product-images/user-${providerId}/x.png`],
    ['portfolio-images', `portfolio-images/user-${providerId}/x.png`],
  ];
  const refused = [];
  for (const [name, key] of families) {
    const status = await fetchKey(providerCookie, key);
    if (status !== 503) refused.push(`${name} -> http ${status}`);
  }
  check(refused.length === 0,
    '5. EVERY PUBLIC IMAGE FAMILY IS AUTHORIZED for a signed-in viewer (503 = allowed, no bucket)',
    refused.length ? refused.join(' | ') : 'avatars, product-images, portfolio-images all 503');

  const crossViewer = await fetchKey(otherCookie, `portfolio-images/user-${providerId}/x.png`);
  check(crossViewer === 503,
    '6. including ANOTHER provider viewing it — a portfolio is a showcase, not a secret',
    `http ${crossViewer}`);

  // ── CLAIMING one is the act that is refused ─────────────────────────────
  const theft = await post(otherCookie, 'portfolio.create', {
    title: `Stolen ${stamp}`, description: 'Someone else work',
    images: [`/manus-storage/portfolio-images/user-${providerId}/x.png`],
  });
  check(theft.status !== 200 && /only use images you uploaded/i.test(theft.error ?? ''),
    '7. but CLAIMING another provider photograph is refused on the write',
    `http ${theft.status} ${theft.error ?? ''}`);

  const stolenRows = sql(`select count(*) from portfolioItems where title='Stolen ${stamp}'`);
  check(stolenRows === '0', '8. and nothing was written — the refusal is not cosmetic',
    `rows=${stolenRows}`);

  const traversalClaim = await post(otherCookie, 'portfolio.create', {
    title: `Traversal ${stamp}`, description: 'Climbing out',
    images: [`/manus-storage/portfolio-images/user-${otherId}/../user-${providerId}/x.png`],
  });
  check(traversalClaim.status !== 200,
    '9. nor a reference that STARTS in their own prefix and climbs out of it',
    `http ${traversalClaim.status} ${traversalClaim.error ?? ''}`);

  const ownClaim = await post(providerCookie, 'portfolio.create', {
    title: `Mine ${stamp}`, description: 'My own work',
    images: [`/manus-storage/portfolio-images/user-${providerId}/kitchen.png`],
  });
  check(ownClaim.status === 200,
    '10. THE POSITIVE CONTROL — a provider may still use their OWN image',
    `http ${ownClaim.status} ${ownClaim.error ?? ''}`);

  // ── The standing infrastructure limit, stated rather than hidden ────────
  console.log('BLOCKED  object storage is unconfigured (S3_* unset), so a real '
    + 'bucket round-trip is NOT verified here and is NOT claimed as passing.');
} catch (e) {
  check(false, 'PROBE COMPLETED', String(e.message).slice(0, 200));
} finally {
  try {
    sql(`delete from portfolioItems where userId in (select id from users where username like 'zup${stamp}%')`);
    sql(`delete from notifications where userId in (select id from users where username like 'zup${stamp}%')`);
    sql(`delete from userAccountAuditEvents where userId in (select id from users where username like 'zup${stamp}%')`);
    sql(`delete from users where username like 'zup${stamp}%'`);
  } catch (e) { console.log(`cleanup note: ${String(e.message).slice(0, 120)}`); }
  const left = sql(`select count(*) from users where username like 'zup${stamp}%'`);
  check(left === '0', 'CLEANUP: every account this probe created is gone', `users=${left}`);
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
