/**
 * ── WHICH BUILD IS THE OWNER LOOKING AT? ─────────────────────────────────
 *
 * The owner opened a deployed BuildHub, clicked through the admin console, and
 * reported that changes they had asked for were absent. They were right about
 * what they saw. The code was on the branch; the build in front of them did
 * not contain it. Nothing in the running product could answer "which commit is
 * this?", so a deployment lag was indistinguishable from a missing feature -
 * and the wrong thing was investigated for days.
 *
 * This probe exists so that can never happen silently again.
 *
 * WHAT IS PROVED, against a running server and a rendered console:
 *
 *   /version answers with a real identity, not a placeholder
 *   the commit is a COMMIT - never a branch name, a URL or a secret
 *   the console shows the same identity the endpoint serves
 *   an administrator can read it without knowing where to look
 *   the environment is reported as the process was TOLD, never guessed
 *   a build that cannot identify itself SAYS SO, visibly and in red
 *
 * THE LAST ONE IS THE POINT. A build stamp that quietly renders "unknown" the
 * same way it renders a commit is worse than none: it looks like an answer.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';

/* WHICH BUILD THIS RAN AGAINST. Printed always; enforced when
   ZG_EXPECT_COMMIT names one, so a pass can never be reported against
   a build somebody did not mean to test. */
const identity = await assertBuild(BASE);

const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9600 + (process.pid % 80)));
const PASSWORD = 'LocalSuperAdmin!2024';
const HASH = process.env.ZG_HASH;
if (!HASH) { console.error('set ZG_HASH to an application-minted password hash'); process.exit(2); }
const stamp = Date.now().toString(36);
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, expression, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let v = 'false';
    try { v = await page.evaluate(`try { return String(${expression}); } catch { return 'false'; }`); } catch {}
    if (v === 'true') { await settle(350); return true; }
    await settle(250);
  }
  return false;
}
async function signIn(email) {
  const res = await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`adminSignIn: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

function cleanUp() {
  for (const statement of [
    `delete from users where username like 'zbld%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 80)})`);
    }
  }
}

const browser = await launchBrowser({ port: CDP_PORT });
try {
  cleanUp();

  /* ── THE ENDPOINT ANSWERS WITH AN IDENTITY ───────────────────────────── */
  const version = await (await fetch(`${BASE}/version`)).json();
  check(typeof version.commit === 'string' && version.commit.length > 0,
    'VERSION: /version answers with a commit field', JSON.stringify(version));
  check(/^[0-9a-f]{7,40}$/i.test(version.commit),
    'VERSION: and it is a COMMIT, not a branch name or a placeholder',
    version.commit);
  check(version.shortCommit === version.commit.slice(0, 7),
    'VERSION: the short form is derived from it, never resolved twice',
    `${version.shortCommit} vs ${version.commit.slice(0, 7)}`);
  check(typeof version.buildTime === 'string' && !Number.isNaN(Date.parse(version.buildTime)),
    'VERSION: it says WHEN it was built - "built" and "restarted" are different facts',
    String(version.buildTime));
  check(typeof version.environment === 'string' && version.environment.length > 0
    && version.environment !== 'unknown',
    'VERSION: and which environment it believes it is', String(version.environment));

  /* ── AND NOTHING ELSE. An identity endpoint is a tempting place to leak. */
  const keys = Object.keys(version).sort();
  check(JSON.stringify(keys) === JSON.stringify(['buildTime', 'commit', 'environment', 'shortCommit']),
    'VERSION: exactly four fields - no host, no branch, no configuration',
    keys.join(', '));
  const body = JSON.stringify(version);
  check(!/mysql:|postgres:|password|secret|key|token|@/i.test(body),
    'VERSION: and nothing in it looks like a credential', body);

  /*
   * ── THE COMMIT IS THE ONE IT WAS BUILT FROM ─────────────────────────────
   *
   * NOT the commit the working tree is on. The first version of this check
   * compared against `git rev-parse HEAD` and failed the moment a commit
   * landed after the last build - which was the stamp being RIGHT: a server
   * reports the build it is running, and the tree moving on does not change
   * what is deployed. Asserting otherwise would have meant "rebuild before
   * every probe", and would have taught somebody to relax the stamp to make
   * a probe pass.
   *
   * What must be true is narrower and is the thing that actually matters:
   * the served identity is the one recorded in the artefact the server reads,
   * and that identity is a REAL commit in this repository rather than a
   * plausible-looking string.
   */
  const stamp = JSON.parse(execSync('cat dist/build-info.json', { encoding: 'utf8' }));
  check(version.commit.toLowerCase() === String(stamp.commit).toLowerCase(),
    'TRUTHFUL: the running build reports the commit it was BUILT from',
    `serving ${version.shortCommit}, stamp ${stamp.shortCommit}`);
  check(version.buildTime === stamp.buildTime,
    'TRUTHFUL: and the build time it was stamped with, not the time it started',
    `${version.buildTime} vs ${stamp.buildTime}`);
  const known = execSync(
    `git cat-file -e ${version.commit}^{commit} 2>&1 && echo real || echo unknown`,
    { encoding: 'utf8', shell: '/bin/bash' }).trim();
  check(known.endsWith('real'),
    'TRUTHFUL: and that commit really exists in this repository',
    `${version.shortCommit}: ${known}`);

  /* ── AN ADMINISTRATOR CAN SEE IT ─────────────────────────────────────── */
  const admin = `zbldA${stamp}`;
  sql(`insert into users (openId, username, email, name, role, adminRole, userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${admin}', '${admin}', '${admin}@example.test', 'Probe Build Admin',
        'admin', 'SUPER_ADMIN', 'admin', 'password', 'admin_created', 0, 'active',
        'approved', 1, '${HASH}', now())`);
  const adminId = Number(sql(`select id from users where username='${admin}'`));
  check(adminId > 0, 'SETUP: an administrator to look at the console', `admin ${adminId}`);

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookies(asBrowserCookies(await signIn(`${admin}@example.test`)));
  await page.goto(`${BASE}/admin/operations`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await page.goto(`${BASE}/admin/operations`);
  const shown = await waitFor(page, `!!document.querySelector('[data-testid="oh-commit-value"]')`);
  check(shown, 'CONSOLE: the build is on Admin -> Operations, without hunting for it');

  const rendered = JSON.parse(await page.evaluate(`
    const el = document.querySelector('[data-testid="oh-commit-value"]');
    const box = document.querySelector('[data-testid="oh-commit"]');
    return JSON.stringify({
      value: el ? el.innerText.trim() : null,
      full: el ? (el.getAttribute('data-full-value') || '') : '',
      note: box ? box.innerText.trim().split(String.fromCharCode(10)).join(' | ') : '',
    });
  `));
  check(rendered.value === version.shortCommit,
    'CONSOLE: and it shows the SAME build the endpoint serves',
    `console "${rendered.value}" vs endpoint "${version.shortCommit}"`);
  check(rendered.full.toLowerCase() === version.commit.toLowerCase(),
    'CONSOLE: with the full commit available to copy, not just the short one',
    rendered.full);
  check(rendered.note.includes(version.environment),
    'CONSOLE: and names the environment beside it',
    rendered.note);

  /*
   * ── A BUILD THAT CANNOT SAY WHAT IT IS MUST SAY SO ───────────────────────
   *
   * The whole mechanism rests on this. A stamp that renders "unknown" in the
   * same quiet grey as a real commit looks like an answer, and somebody acts
   * on it. The screen marks it as a problem instead.
   *
   * Asserted against the SOURCE, because forcing a running server into the
   * unknown state would mean restarting it without its build stamp and would
   * leave every later probe in this run testing an unidentifiable build.
   */
  const source = execSync(
    'cat client/src/components/AdminOperationalHealth.tsx', { encoding: 'utf8' });
  check(/bad=\{data\.commit === 'unknown'\}/.test(source),
    'HONEST: an unidentifiable build is marked as a problem, not shown in grey');
  check(/cannot say which commit it is/.test(source),
    'HONEST: and says so in words a person can act on');

  /* ── THE PROBE GUARD ITSELF REFUSES A MISMATCH ───────────────────────── */
  const guard = execSync(
    `ZG_EXPECT_COMMIT=deadbeef node -e "import('./evidence/lib/build.mjs').then(m => m.assertBuild('${BASE}'))" 2>&1; echo "exit=$?"`,
    { encoding: 'utf8', shell: '/bin/bash' });
  check(/MISMATCH/.test(guard) && /exit=3/.test(guard),
    'GATE: a probe told to expect another commit refuses to report at all',
    guard.trim().split('\n').pop());
} finally {
  cleanUp();
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
