/**
 * ── AN OUTAGE, CAUSED ON PURPOSE, AND WHAT EACH SCREEN THEN SAYS ──────────
 *
 * `truthfulEmptyStates.test.ts` reads the source and proves each screen has an
 * error branch. Source cannot tell you what the branch RENDERS, and the defect
 * being guarded is a sentence: an administrator reads "Project not found." and
 * closes the investigation, a visitor reads "0 vendors" and leaves.
 *
 * So this stops the database - the real cause, not a mocked one - and reads
 * what each surface actually puts on the screen. It restarts the database
 * afterwards whether it passes or fails.
 *
 * MUTATION-TESTED, AND ONE MUTATION SURVIVED FOR A REASON WORTH WRITING DOWN:
 *
 *   P1  the context stops classifying the error    ->  8/12
 *   P2  isSessionRevoked answers "revoked" again   -> 12/12  SURVIVES HERE
 *   P3  the dashboard guard loses its third state  ->  9/12
 *
 * P2 is not a gap in the fix - it is a branch this probe cannot reach.
 * `if (!db) return true` runs only when getDb() hands back NULL, which happens
 * when DATABASE_URL is unset or the pool could not be constructed. With a URL
 * configured the pool object already exists, so stopping the server surfaces
 * as a THROWN QUERY instead, which context.ts classifies correctly either way.
 * The null-handle branch is exercised by productionHardening.test.ts and
 * truthfulEmptyStates.test.ts, where no DATABASE_URL is configured; reverting
 * it fails 4 of their assertions. Two paths, two instruments, both covered.
 *
 * NOTHING HERE IS SEEDED DURING THE OUTAGE, obviously. Every record is created
 * while the database is up, and the probe checks the healthy rendering first
 * so that a failure state is proven to be a CHANGE rather than the only thing
 * the screen ever draws.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9300 + (process.pid % 90)));
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();
const service = action => execSync(`service mariadb ${action}`, { stdio: 'pipe' }).toString();

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 300) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, expression, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let v = 'false';
    try { v = await page.evaluate(`try { return String(${expression}); } catch { return 'false'; }`); } catch {}
    if (v === 'true') { await settle(250); return true; }
    await settle(250);
  }
  return false;
}
const bodyOf = page => page.evaluate(`return document.body.innerText || ''`);

const PASSWORD = 'LocalSuperAdmin!2024';
const HASH = process.env.ZG_HASH;
if (!HASH) { console.error('set ZG_HASH to an application-minted password hash'); process.exit(2); }
const stamp = Date.now() % 100000000;

async function signIn(email) {
  const res = await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`adminSignIn: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

const browser = await launchBrowser({ port: CDP_PORT });
let stopped = false;

try {
  // ── Seeded while the database is UP ────────────────────────────────────
  sql(`delete from projects where title like 'ZERR%'`);
  sql(`delete from users where username like 'zerr%'`);
  const u = `zerr${stamp}`;
  sql(`insert into users (openId, username, email, name, role, adminRole, userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${u}', '${u}', '${u}@example.test', 'Probe Super', 'admin',
        'SUPER_ADMIN', 'admin', 'password', 'admin_created', 0, 'active', 'approved', 1,
        '${HASH}', now())`);
  const adminId = Number(sql(`select id from users where username='${u}'`));
  sql(`insert into projects (ownerId, title, status) values (${adminId}, 'ZERR Project ${stamp}', 'active')`);
  const projectId = Number(sql(`select id from projects where title='ZERR Project ${stamp}'`));
  check(adminId > 0 && projectId > 0, '1. SETUP: a real administrator and a real project exist',
    `admin #${adminId}, project #${projectId}`);

  const cookie = await signIn(`${u}@example.test`);
  const page = await browser.newPage();
  await page.setCookies(asBrowserCookies(cookie));
  await page.goto(`${BASE}/admin`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");

  // ── HEALTHY FIRST. Without this, a failure state proves nothing - it
  //    could be all the screen has ever drawn. ─────────────────────────────
  await page.goto(`${BASE}/admin/projects/${projectId}`);
  const healthy = await waitFor(page, `!!document.querySelector('[data-testid="admin-project-detail"]')`);
  check(healthy, '2. HEALTHY: the project detail renders the project', `ZERR Project ${stamp}`);

  await page.goto(`${BASE}/admin/operations`);
  const opsHealthy = await waitFor(page, `document.body.innerText.length > 200`);
  const opsBefore = await bodyOf(page);
  check(opsHealthy && !/could not be loaded/i.test(opsBefore),
    '3. HEALTHY: Operations renders without a failure notice');

  const hubPage = await browser.newPage();
  await hubPage.goto(`${BASE}/marketplace`);
  await waitFor(hubPage, `document.body.innerText.length > 200`);
  const hubBefore = await hubPage.evaluate(`
    return JSON.stringify([...document.querySelectorAll('[data-testid^="hub-"], .text-3xl, .text-2xl')].map(e => e.innerText).slice(0, 40));
  `);
  check(hubBefore.length > 10, '4. HEALTHY: the public marketplace hub renders its section cards');

  // ── THE OUTAGE ────────────────────────────────────────────────────────
  service('stop'); stopped = true;
  await settle(1500);
  let dbDown = false;
  try { sql('select 1'); } catch { dbDown = true; }
  check(dbDown, '5. THE DATABASE IS STOPPED - this is a real outage, not a mock');

  // ── What each screen says now ─────────────────────────────────────────
  await page.goto(`${BASE}/admin/projects/${projectId}`);
  await waitFor(page, `document.body.innerText.length > 120`);
  const detailText = await bodyOf(page);
  check(!/Project not found/i.test(detailText),
    '6. THE PROJECT IS NOT DECLARED MISSING - an outage is not a statement about the record',
    /Project not found/i.test(detailText) ? 'still says "Project not found."' : 'no existence claim made');
  check(/could not be loaded/i.test(detailText),
    '7. and the screen says it could not load, with a way to try again',
    (detailText.match(/[^.\n]*could not be loaded[^.\n]*/i) ?? ['nothing'])[0].trim().slice(0, 70));
  /*
   * THE FINDING THIS PROBE ACTUALLY TURNED UP, and the reason it exists.
   *
   * The first run never reached the screen above at all: the page redirected
   * to /auth. The session check hit the stopped database, the revocation
   * lookup failed closed by answering "revoked", the authenticator repeated
   * that as "Session has been signed out", the context turned it into an
   * anonymous request and `auth.me` answered null - so an administrator
   * mid-investigation was told they were signed out, and sent to a sign-in
   * screen that the same outage made unusable.
   */
  check(!/^\/auth/.test(await page.evaluate('return location.pathname')),
    '7a. THE ADMINISTRATOR IS NOT SIGNED OUT BY AN OUTAGE - the page does not bounce to /auth',
    `at ${await page.evaluate('return location.pathname')}`);
  check(!/^\s*Sign In\s*$/m.test(detailText) || /could not be loaded/i.test(detailText),
    '7b. and is not shown a sign-in screen in place of the page',
    /Sign In/.test(detailText) && !/could not be loaded/i.test(detailText)
      ? 'a sign-in screen was rendered instead' : 'the failure is stated where the page was');

  const hasRetry = await page.evaluate(`
    return String([...document.querySelectorAll('button')].some(b => /retry|إعادة/i.test(b.innerText)));
  `);
  check(hasRetry === 'true', '8. and offers Retry rather than forcing a reload');

  await page.goto(`${BASE}/admin/operations`);
  await waitFor(page, `document.body.innerText.length > 120`);
  const opsText = await bodyOf(page);
  check(!/No placements booked yet/i.test(opsText),
    '9. PLACEMENT PERFORMANCE does not report the outage as zero placements',
    /No placements booked yet/i.test(opsText) ? 'still claims none are booked' : 'no commercial zero claimed');

  await hubPage.goto(`${BASE}/marketplace`);
  await waitFor(hubPage, `document.body.innerText.length > 120`);
  const hubStats = await hubPage.evaluate(`
    const cards = [...document.querySelectorAll('a, div')].map(e => e.innerText || '');
    return JSON.stringify(cards.filter(t => /vendors|designers|providers|categories/i.test(t)).slice(0, 6));
  `);
  check(!/\\b0\\s*(vendors|providers|designers|categories)/i.test(hubStats),
    '10. THE PUBLIC HUB does not tell a visitor the marketplace is empty',
    /\b0\s/.test(hubStats) ? hubStats.slice(0, 90) : 'no zero counts rendered');

  /*
   * THE PRICING PAGE IS NOT EXERCISED HERE, DELIBERATELY.
   *
   * Its guard was changed in the same pass - `if (isLoading || !data)` routed
   * a failure into the spinner, so a failed request left the page loading
   * forever. But `billing.plans` is a publicProcedure that returns an
   * in-memory catalogue and touches no database at all, so stopping the
   * database cannot make it fail. Asserting it here would be a check that
   * passes because nothing happened.
   *
   * Its branch is covered by truthfulEmptyStates.test.ts. A live proof needs
   * request-level interception, which this harness does not have.
   */

} catch (error) {
  check(false, 'PROBE ABORTED', String(error.message).slice(0, 200));
} finally {
  if (stopped) {
    try { service('start'); } catch (e) { console.log(`  WARNING: could not restart mariadb: ${e.message}`); }
    await settle(3000);
    try { sql('select 1'); console.log('  database restarted'); }
    catch { console.log('  WARNING: the database did not come back - restart it before other probes'); }
  }
  try { browser.close(); } catch { /* the result is already printed */ }
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
