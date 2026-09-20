/**
 * ── ONE PROJECT, TWO ANSWERS ABOUT THE SAME MONEY ────────────────────────
 *
 * The homeowner dashboard headlines "Total Spent". The project page headlines
 * "Budget used". They are the same question, and they were answered from two
 * different places:
 *
 *   the dashboard summed  projects.spent   - a column no screen ever writes
 *   the project page summed the EXPENSE LOG - the rows a homeowner enters
 *
 * So a homeowner who logged real expenses was told, on the screen they land
 * on first, that they had spent nothing at all. Not a rounding difference -
 * a structurally constant zero beside a real number.
 *
 * WHAT IS PROVED HERE, in a rendered browser and against seeded rows whose
 * sum is known in advance:
 *
 *   the project page reports the expense log
 *   the dashboard reports the SAME figure
 *   adding an expense moves BOTH
 *   a project with no expenses says zero, and means it
 *   the two never disagree
 *
 * This probe FAILED on the build that prompted it, which is the point of
 * writing it before the fix rather than after.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9400 + (process.pid % 80)));
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
async function waitFor(page, expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let v = 'false';
    try { v = await page.evaluate(`try { return String(${expression}); } catch { return 'false'; }`); } catch {}
    if (v === 'true') { await settle(300); return true; }
    await settle(250);
  }
  return false;
}
async function signIn(email) {
  const res = await fetch(`${BASE}/api/trpc/auth.signIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`signIn: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

/**
 * The number printed under a given label, wherever the label appears.
 * Read from the RENDERED text rather than from a prop, because the defect is
 * what a person is shown.
 */
const statReader = label => `
  const cards = Array.from(document.querySelectorAll('p'));
  const labelEl = cards.find(p => p.innerText.trim() === ${JSON.stringify(label)});
  if (!labelEl) return JSON.stringify({ found: false, value: null, raw: '' });
  const box = labelEl.parentElement;
  const value = box ? box.querySelector('p') : null;
  const raw = value ? value.innerText.trim() : '';
  const digits = raw.replace(/[^0-9.]/g, '');
  return JSON.stringify({ found: true, value: digits === '' ? null : Number(digits), raw: raw });
`;

function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zspend%') as probe)`;
  const projectIds = `(select id from (select id from projects where ownerId in ${ids}) as p)`;
  for (const statement of [
    `delete from expenses where projectId in ${projectIds}`,
    `delete from projectMembers where projectId in ${projectIds}`,
    `delete from notifications where userId in ${ids}`,
    `delete from commercialAuditEvents where actorId in ${ids} or ownerId in ${ids}`,
    `delete from projects where ownerId in ${ids}`,
    `delete from users where username like 'zspend%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 80)})`);
    }
  }
}

const browser = await launchBrowser({ port: CDP_PORT });
try {
  cleanUp();
  const h = `zspendH${stamp}`;
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified, passwordHash, passwordSetAt)
       values ('probe-${h}', '${h}', '${h}@example.test', 'Probe Homeowner', 'user',
        'homeowner', 'password', 'self_registered', 0, 'active', 'approved', 1, '${HASH}', now())`);
  const ownerId = Number(sql(`select id from users where username='${h}'`));

  // TWO projects, so the dashboard total is a SUM and not one row passed
  // through - a bug that only shows up when there is more than one.
  sql(`insert into projects (ownerId, title, type, status, budget, spent, location)
       values (${ownerId}, 'Spend probe A ${stamp}', 'residential', 'active', '100000.00', '0.00', 'Cairo'),
              (${ownerId}, 'Spend probe B ${stamp}', 'residential', 'active', '50000.00', '0.00', 'Giza')`);
  const [projectA, projectB] = sql(
    `select id from projects where ownerId=${ownerId} order by id`).split('\n').map(Number);
  check(ownerId > 0 && projectA > 0 && projectB > 0,
    'SETUP: a homeowner with two projects and nothing spent yet',
    `owner ${ownerId}, projects ${projectA}/${projectB}`);

  const page = await browser.newPage();
  await page.setCookies(asBrowserCookies(await signIn(`${h}@example.test`)));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/dashboard`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");

  /* ── NOTHING SPENT MEANS ZERO, AND MEANS IT ──────────────────────────── */
  await page.goto(`${BASE}/dashboard`);
  await waitFor(page, `document.body.innerText.includes('Total Spent')`);
  const emptyDash = JSON.parse(await page.evaluate(statReader('Total Spent')));
  check(emptyDash.found && emptyDash.value === 0,
    'EMPTY: with no expenses logged the dashboard says zero',
    emptyDash.found ? emptyDash.raw : 'the card was not found');

  /* ── REAL EXPENSES, WITH A SUM KNOWN IN ADVANCE ──────────────────────── */
  sql(`insert into expenses (projectId, category, description, amount, currency)
       values (${projectA}, 'Materials', 'Probe cement', '1200.00', 'EGP'),
              (${projectA}, 'Labour', 'Probe crew', '800.00', 'EGP'),
              (${projectB}, 'Materials', 'Probe tiles', '500.00', 'EGP')`);
  const EXPECTED_A = 2000, EXPECTED_TOTAL = 2500;

  await page.goto(`${BASE}/projects/${projectA}`);
  await waitFor(page, `document.body.innerText.includes('Budget Used') || document.body.innerText.includes('Budget used')`);
  await settle(800);
  const detail = JSON.parse(await page.evaluate(`
    const cards = Array.from(document.querySelectorAll('p'));
    const labelEl = cards.find(p => /^budget used$/i.test(p.innerText.trim()));
    if (!labelEl) return JSON.stringify({ found: false, value: null, raw: '' });
    const value = labelEl.parentElement.querySelector('p');
    const raw = value ? value.innerText.trim() : '';
    const digits = raw.replace(/[^0-9.]/g, '');
    return JSON.stringify({ found: true, value: digits === '' ? null : Number(digits), raw: raw });
  `));
  check(detail.found && detail.value === EXPECTED_A,
    'PROJECT: the project page reports the expense log exactly',
    detail.found ? `${detail.raw} (expected ${EXPECTED_A})` : 'the card was not found');

  /* ── AND THE DASHBOARD HAS TO AGREE ──────────────────────────────────── */
  await page.goto(`${BASE}/dashboard`);
  await waitFor(page, `document.body.innerText.includes('Total Spent')`);
  await settle(800);
  const dash = JSON.parse(await page.evaluate(statReader('Total Spent')));
  check(dash.found && dash.value === EXPECTED_TOTAL,
    'DASHBOARD: and the dashboard reports the same money, summed over projects',
    dash.found ? `${dash.raw} (expected ${EXPECTED_TOTAL})` : 'the card was not found');
  check(dash.value !== null && detail.value !== null && dash.value >= detail.value,
    'CONSISTENT: the dashboard total is never LESS than one project inside it',
    `dashboard ${dash.value} vs project A ${detail.value}`);

  /* ── ADDING AN EXPENSE MOVES BOTH, so neither is a frozen snapshot ───── */
  sql(`insert into expenses (projectId, category, description, amount, currency)
       values (${projectB}, 'Labour', 'Probe extra', '300.00', 'EGP')`);
  await page.goto(`${BASE}/dashboard`);
  await waitFor(page, `document.body.innerText.includes('Total Spent')`);
  await settle(800);
  const after = JSON.parse(await page.evaluate(statReader('Total Spent')));
  check(after.value === EXPECTED_TOTAL + 300,
    'LIVE: a new expense moves the dashboard figure',
    `${after.raw} (expected ${EXPECTED_TOTAL + 300})`);

  /* ── A STALE STORED COLUMN MUST NOT BE ABLE TO OVERRIDE THE TRUTH ────── */
  sql(`update projects set spent='999999.00' where id=${projectA}`);
  await page.goto(`${BASE}/dashboard`);
  await waitFor(page, `document.body.innerText.includes('Total Spent')`);
  await settle(800);
  const poisoned = JSON.parse(await page.evaluate(statReader('Total Spent')));
  check(poisoned.value === EXPECTED_TOTAL + 300,
    'DERIVED: writing the stored column directly does NOT change what is shown',
    `${poisoned.raw} (expected ${EXPECTED_TOTAL + 300})`);

  /* ── AND A PROJECT WITH NO EXPENSES IS HONESTLY EMPTY ────────────────── */
  sql(`delete from expenses where projectId in (${projectA}, ${projectB})`);
  await page.goto(`${BASE}/dashboard`);
  await waitFor(page, `document.body.innerText.includes('Total Spent')`);
  await settle(800);
  const cleared = JSON.parse(await page.evaluate(statReader('Total Spent')));
  check(cleared.value === 0,
    'TRUTHFUL EMPTY: removing every expense returns the figure to zero',
    `${cleared.raw} (expected 0)`);
} finally {
  cleanUp();
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
