/**
 * ── THE PROJECT AN RFQ WAS RAISED FOR, IN A REAL BROWSER ──────────────────
 *
 * `rfqs.projectId` was written by the RFQ form and returned by `rfq.get`, and
 * no screen rendered it. A buyer running several projects could link a request
 * to one of them and then open that request and find no mention of which - and
 * no way back to the project it belongs to.
 *
 * This drives the real product: real accounts through the real signup, a real
 * project, a real membership, a real RFQ created over the real API, and a real
 * Chromium rendering the real bundle. Three cases, because the interesting
 * part is not that a name appears - it is WHEN it may:
 *
 *   THE MEMBER WHO RAISED IT sees the project's name and can click through to
 *     it. That is the capability.
 *
 *   THE SAME PERSON, ONCE REMOVED FROM THE PROJECT, is told the link exists
 *     and that the project is no longer theirs to open - and is NOT told its
 *     name. Removal revoking access is the rule this guard exists for, and a
 *     page that kept showing the name would quietly outlive the revocation.
 *
 *   A SUPPLIER READING THE OPEN REQUEST sees no project line at all. Which of
 *     a buyer's projects a request belongs to is the buyer's business.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const PORT = Number(process.env.ZG_CDP ?? 9351);
const stamp = Date.now().toString().slice(-8);

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};
const sql = q => execSync('mysql -h 127.0.0.1 -u bh -pbhlocal buildhub_prelaunch -N -B',
  { input: q, encoding: 'utf8' }).trim();

/** Sign up through the real endpoint and keep the session cookie. */
async function signup(username, userRole) {
  const res = await fetch(`${BASE}/api/trpc/auth.signUp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: {
      username, email: `${username}@example.test`, password: 'ProbePass!2024',
      name: `Probe ${userRole}`, userRole,
    } }),
  });
  const body = await res.text();
  if (res.status !== 200) throw new Error(`signUp ${username}: ${res.status} ${body.slice(0, 200)}`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error(`signUp ${username}: no session cookie`);
  return cookie;
}

async function call(cookie, path, input) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ json: input }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.result?.data?.json, error: body?.error?.json?.message };
}

/**
 * A tRPC QUERY is a GET with `?input=`. POSTing one answers 405 and says
 * nothing about authorization - which is how this probe first recorded a
 * refusal it had not actually tested.
 */
async function query(cookie, path, input) {
  const url = `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetch(url, { headers: { cookie } });
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.result?.data?.json, error: body?.error?.json?.message };
}

const browserCookies = cookie => cookie.split('; ').map(pair => {
  const i = pair.indexOf('=');
  return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: '127.0.0.1', path: '/' };
});

/**
 * THE TITLE IS NOT THE READINESS CONDITION.
 *
 * The page fires TWO queries: `rfq.summary`, which paints the title, and - for
 * the owner only - `rfq.get`, which carries the project. Reading the DOM as
 * soon as the title appears reads it between the two, and reports a missing
 * project line that is merely a millisecond early. That is how this probe
 * first "found" a defect that did not exist.
 *
 * So an owner's visit waits for the owner-only record to have SETTLED - either
 * project element present - and only a genuine absence can exhaust the window.
 * A visitor who is not the owner has no second query to wait for, so their
 * page is given a fixed settle before absence is asserted.
 */
async function visit(page, cookie, url, { owner = false } = {}) {
  await page.setCookies(browserCookies(cookie));
  await page.goto(url);
  for (let i = 0; i < 40; i++) {
    const ready = await page.evaluate(`return document.querySelector('[data-testid="rfq-detail-title"]') !== null;`)
      .catch(() => false);
    if (ready) break;
    await new Promise(r => setTimeout(r, 250));
  }
  if (!owner) { await new Promise(r => setTimeout(r, 3000)); return; }
  for (let i = 0; i < 60; i++) {
    const settled = await page.evaluate(
      `return document.querySelector('[data-testid="rfq-detail-project"], [data-testid="rfq-detail-project-unavailable"]') !== null;`
    ).catch(() => false);
    if (settled) return;
    await new Promise(r => setTimeout(r, 250));
  }
}

const seen = async (page, testid) => page.evaluate(
  `const el = document.querySelector('[data-testid="${testid}"]'); return el ? el.innerText.trim() : '';`
).catch(() => '');

let browser;
try {
  // ── Real accounts, a real project, a real membership ────────────────────
  const ownerCookie = await signup(`zrp${stamp}owner`, 'homeowner');
  const memberCookie = await signup(`zrp${stamp}member`, 'project_manager');
  const supplierCookie = await signup(`zrp${stamp}supplier`, 'supplier');
  const ownerId = Number(sql(`select id from users where username='zrp${stamp}owner'`));
  const memberId = Number(sql(`select id from users where username='zrp${stamp}member'`));
  check(ownerId > 0 && memberId > 0, '1. SETUP: three real accounts exist',
    `owner=${ownerId} member=${memberId}`);

  const created = await call(ownerCookie, 'projects.create', {
    title: `Probe Project ${stamp}`, description: 'Raised by the RFQ project probe',
    type: 'residential', budget: 750000, location: 'Cairo',
  });
  const projectId = created.data?.id ?? Number(sql(`select id from projects where title='Probe Project ${stamp}'`));
  check(Number.isInteger(projectId) && projectId > 0, '2. and a real project the owner created',
    `project=${projectId} status=${created.status}`);

  const added = await call(ownerCookie, 'projects.addMember',
    { projectId, userId: memberId, projectRole: 'manager' });
  const memberRow = sql(`select count(*) from projectMembers where projectId=${projectId} and userId=${memberId} and removedAt is null`);
  check(memberRow === '1', '3. with the second account a LIVE member of it',
    `addMember http ${added.status}${added.error ? ` ${added.error}` : ''}`);

  // ── The member raises an RFQ against that project ───────────────────────
  const rfq = await call(memberCookie, 'rfq.create', {
    title: `Probe RFQ ${stamp}`, description: 'Quote for the probe project',
    category: 'Materials', projectId,
  });
  const rfqId = (typeof rfq.data === 'object' && rfq.data ? (rfq.data.id ?? rfq.data.rfqId) : rfq.data) ?? Number(sql(`select id from rfqs where title='Probe RFQ ${stamp}'`));
  const storedProject = sql(`select projectId from rfqs where id=${rfqId}`);
  check(String(storedProject) === String(projectId),
    '4. and links a REAL RFQ to it, stored as rfqs.projectId',
    `rfq=${rfqId} projectId=${storedProject} http=${rfq.status} ${rfq.error ?? ''}`);

  browser = await launchBrowser({ port: PORT });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440 });

  // ── CASE 1: the member who raised it ────────────────────────────────────
  await visit(page, memberCookie, `${BASE}/rfq/${rfqId}`, { owner: true });
  const link = await seen(page, 'rfq-detail-project');
  check(link.includes(`Probe Project ${stamp}`),
    '5. THE BUYER SEES WHICH PROJECT the request was raised for', link || '(nothing rendered)');

  const href = await page.evaluate(
    `const a = document.querySelector('[data-testid="rfq-detail-project"]'); return a ? (a.getAttribute('href') || a.closest('a')?.getAttribute('href') || '') : '';`
  ).catch(() => '');
  check(href === `/projects/${projectId}`,
    '6. and it is a real link to that project, not a dead label', href || '(no href)');

  await page.goto(`${BASE}${href}`);
  await new Promise(r => setTimeout(r, 1500));
  const landed = await page.evaluate(`return location.pathname;`).catch(() => '');
  const projectText = await page.evaluate(`return document.body.innerText.slice(0, 4000);`).catch(() => '');
  check(landed === `/projects/${projectId}` && projectText.includes(`Probe Project ${stamp}`),
    '7. and following it ARRIVES at the project, rendered', `${landed}`);

  // ── CASE 2: the same person, removed from the project ───────────────────
  const removed = await call(ownerCookie, 'projects.removeMember', { projectId, userId: memberId });
  const stillMember = sql(`select count(*) from projectMembers where projectId=${projectId} and userId=${memberId} and removedAt is null`);
  check(stillMember === '0', '8. the owner REMOVES them from the project',
    `removeMember http ${removed.status}${removed.error ? ` ${removed.error}` : ''}`);

  await visit(page, memberCookie, `${BASE}/rfq/${rfqId}`, { owner: true });
  const afterName = await seen(page, 'rfq-detail-project');
  const afterNotice = await seen(page, 'rfq-detail-project-unavailable');
  check(afterName === '' && afterNotice !== '',
    '9. THE NAME IS GONE, and the page says so plainly instead of going blank',
    afterNotice || `(still showing: ${afterName})`);

  const bodyNow = await page.evaluate(`return document.body.innerText;`).catch(() => '');
  check(!bodyNow.includes(`Probe Project ${stamp}`),
    '10. and the project NAME appears nowhere on the page — revocation held',
    bodyNow.includes(`Probe Project ${stamp}`) ? 'LEAKED' : 'absent');

  const api = await query(memberCookie, 'rfq.get', { id: rfqId });
  check(api.data?.project === null && api.data?.projectLinked === true,
    '11. THE API AGREES — the boundary is server-side, not a hidden element',
    `project=${JSON.stringify(api.data?.project)} linked=${api.data?.projectLinked}`);

  // ── CASE 3: a supplier reading the open request ─────────────────────────
  await visit(page, supplierCookie, `${BASE}/rfq/${rfqId}`);
  const supplierName = await seen(page, 'rfq-detail-project');
  const supplierNotice = await seen(page, 'rfq-detail-project-unavailable');
  check(supplierName === '' && supplierNotice === '',
    '12. A SUPPLIER SEES NO PROJECT LINE AT ALL — not even that one exists',
    supplierName || supplierNotice || 'absent');

  const supplierApi = await query(supplierCookie, 'rfq.get', { id: rfqId });
  check(supplierApi.status !== 200,
    '13. and rfq.get refuses them outright — it is the owner\'s record',
    `http ${supplierApi.status} ${supplierApi.error ?? ''}`);

  await page.close();
} catch (e) {
  check(false, 'PROBE COMPLETED', String(e.message).slice(0, 200));
} finally {
  try { browser?.close(); } catch {}
  try {
    sql(`delete from rfqItems where rfqId in (select id from rfqs where title like 'Probe RFQ ${stamp}%')`);
    sql(`delete from rfqs where title like 'Probe RFQ ${stamp}%'`);
    sql(`delete from projectMembers where projectId in (select id from projects where title like 'Probe Project ${stamp}%')`);
    sql(`delete from commercialAuditEvents where actorId in (select id from users where username like 'zrp${stamp}%')`);
    sql(`delete from userAccountAuditEvents where userId in (select id from users where username like 'zrp${stamp}%')`);
    sql(`delete from notifications where userId in (select id from users where username like 'zrp${stamp}%')`);
    sql(`delete from projects where title like 'Probe Project ${stamp}%'`);
    sql(`delete from users where username like 'zrp${stamp}%'`);
  } catch (e) { console.log(`cleanup note: ${String(e.message).slice(0, 120)}`); }
  const left = sql(`select count(*) from users where username like 'zrp${stamp}%'`);
  check(left === '0', 'CLEANUP: every account this probe created is gone', `users=${left}`);
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
