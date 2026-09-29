/**
 * ── A CONTROL THE SERVER WILL REFUSE ─────────────────────────────────────
 *
 * The reachability census found `myProjectRole` returned by five procedures
 * and read by no client file. Its own comment in routers.ts says why it
 * exists: "the caller's own capacity travels with the record so the UI can
 * render the right controls". The UI never used it.
 *
 * So the project page renders the same controls for everybody on a project:
 * a member added as a VIEWER sees the status dropdown, Add Expense, Add
 * Member and Remove Member. The server refuses every one of them - correctly,
 * and that is the point. The authorization is sound; the SCREEN is lying.
 *
 * This is the same shape as `projects.spent`: a value computed for a purpose
 * that never materialised, invisible to every test that asks "does the
 * endpoint work".
 *
 * WHAT IS PROVED HERE:
 *
 *   the server really does refuse a viewer      (positive control)
 *   the owner really can do all of it           (so refusal is about ROLE)
 *   a viewer is NOT shown controls they cannot use
 *   a viewer still sees everything they CAN do
 *   finance is separate from read - a contractor on a job has no business
 *     reading what the customer paid everyone else
 *
 * This probe FAILED on the build that prompted it, which is the point of
 * writing it before the fix.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';

/* WHICH BUILD THIS RAN AGAINST. Printed always; enforced when
   ZG_EXPECT_COMMIT names one. */
await assertBuild(BASE);

const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9800 + (process.pid % 80)));
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
const clickOn = selector => `
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return 'false';
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, composed: true,
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  el.dispatchEvent(new MouseEvent('mousedown', o));
  el.dispatchEvent(new PointerEvent('pointerup', o));
  el.dispatchEvent(new MouseEvent('mouseup', o));
  el.dispatchEvent(new MouseEvent('click', o));
  return 'true';
`;
async function signIn(email) {
  const res = await fetch(`${BASE}/api/trpc/auth.signIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`signIn ${email}: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}
async function call(cookie, path, input) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ json: input }),
  });
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    if (res.status === 200) return { ok: true, data: parsed.result.data.json };
    return { ok: false, code: parsed?.error?.json?.data?.code ?? null, message: parsed?.error?.json?.message ?? '' };
  } catch { return { ok: false, code: null, message: text.slice(0, 120) }; }
}

function seedUser(username, role) {
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified, passwordHash, passwordSetAt)
       values ('probe-${username}', '${username}', '${username}@example.test', 'Probe ${username}',
        'user', '${role}', 'password', 'self_registered', 0, 'active', 'approved', 1, '${HASH}', now())`);
  return Number(sql(`select id from users where username='${username}'`));
}

function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zcap%') as probe)`;
  const projectIds = `(select id from (select id from projects where ownerId in ${ids}) as p)`;
  for (const statement of [
    `delete from expenses where projectId in ${projectIds}`,
    `delete from projectMembers where projectId in ${projectIds} or userId in ${ids}`,
    `delete from notifications where userId in ${ids}`,
    `delete from commercialAuditEvents where actorId in ${ids} or ownerId in ${ids}`,
    `delete from projects where ownerId in ${ids}`,
    `delete from users where username like 'zcap%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 90)})`);
    }
  }
}

const browser = await launchBrowser({ port: CDP_PORT });
try {
  cleanUp();
  const owner = `zcapO${stamp}`, viewer = `zcapV${stamp}`;
  const ownerId = seedUser(owner, 'homeowner');
  const viewerId = seedUser(viewer, 'contractor');
  sql(`insert into projects (ownerId, title, type, status, budget, location)
       values (${ownerId}, 'Capability probe ${stamp}', 'residential', 'active', '100000.00', 'Cairo')`);
  const projectId = Number(sql(`select id from projects where ownerId=${ownerId} order by id desc limit 1`));

  const ownerCookie = await signIn(`${owner}@example.test`);
  const viewerCookie = await signIn(`${viewer}@example.test`);

  // Added as a VIEWER: reads the project and nothing else. That is the whole
  // point of the role.
  const added = await call(ownerCookie, 'projects.addMember',
    { projectId, userId: viewerId, projectRole: 'viewer' });
  check(projectId > 0 && added.ok,
    'SETUP: a project with a member added as a VIEWER',
    `project ${projectId}, added ${added.ok}`);

  /* ── THE SERVER IS RIGHT. This is the positive control for everything
        below: if the server let a viewer through, the screen would not be
        the thing at fault. ───────────────────────────────────────────── */
  const viewerUpdate = await call(viewerCookie, 'projects.update', { id: projectId, status: 'completed' });
  check(!viewerUpdate.ok, 'SERVER: a viewer cannot change the project',
    `${viewerUpdate.code} ${viewerUpdate.message}`);
  const viewerExpense = await call(viewerCookie, 'projects.addExpense',
    { projectId, amount: 100, category: 'Materials' });
  check(!viewerExpense.ok, 'SERVER: nor record an expense against it',
    `${viewerExpense.code} ${viewerExpense.message}`);
  const viewerMember = await call(viewerCookie, 'projects.addMember',
    { projectId, userId: ownerId, projectRole: 'viewer' });
  check(!viewerMember.ok, 'SERVER: nor put somebody else on the job',
    `${viewerMember.code} ${viewerMember.message}`);

  const ownerUpdate = await call(ownerCookie, 'projects.update', { id: projectId, status: 'active' });
  check(ownerUpdate.ok,
    'SERVER: while the owner can - so the refusals above are about ROLE, not a broken endpoint');

  /* ── AND THE SCREEN MUST AGREE WITH IT ───────────────────────────────── */
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookies(asBrowserCookies(viewerCookie));
  await page.goto(`${BASE}/projects/${projectId}`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await page.goto(`${BASE}/projects/${projectId}`);
  const loaded = await waitFor(page, `document.body.innerText.includes('Capability probe ${stamp}')`);
  check(loaded, 'VIEWER: can open the project they were added to - read still works');

  /*
   * THE TABS HAVE TO BE OPENED FIRST.
   *
   * Radix renders only the ACTIVE tab's content, and this page opens on
   * Tasks. The first version of this probe measured Add Expense and Add
   * Member without opening anything and found them absent for the viewer -
   * which looked exactly like a pass. The OWNER control caught it: the owner
   * could not see them either, because nobody can see a closed tab.
   *
   * A check that cannot tell "hidden by role" from "not rendered yet" is
   * measuring the wrong thing.
   */
  const readControls = async target => {
    const out = { statusControl: false, addExpense: false, addMember: false, removeMember: false, financeVisible: false, buttons: '' };
    out.statusControl = await target.evaluate(
      `return String(!!document.querySelector('[data-testid="project-status-select"]'));`) === 'true';

    // The tab TRIGGER is visible to everyone; what matters is whether the
    // section behind it exists at all for this role.
    const hasExpensesTab = await target.evaluate(
      `return String(!!document.querySelector('[data-testid="project-tab-expenses"]'));`) === 'true';
    out.financeVisible = hasExpensesTab;
    if (hasExpensesTab) {
      await target.evaluate(clickOn('[data-testid="project-tab-expenses"]'));
      await settle(900);
      out.addExpense = await target.evaluate(`
        const buttons = Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim());
        return String(buttons.some(b => /add expense/i.test(b)));
      `) === 'true';
    }

    const hasTeamTab = await target.evaluate(
      `return String(!!document.querySelector('[data-testid="project-tab-team"]'));`) === 'true';
    if (hasTeamTab) {
      await target.evaluate(clickOn('[data-testid="project-tab-team"]'));
      await settle(900);
      const team = JSON.parse(await target.evaluate(`
        const buttons = Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean);
        return JSON.stringify({
          addMember: buttons.some(b => /add member/i.test(b)),
          removeMember: !!document.querySelector('[data-testid^="member-remove-"]'),
          buttons: buttons.slice(0, 18).join(' | '),
        });
      `));
      out.addMember = team.addMember;
      out.removeMember = team.removeMember;
      out.buttons = team.buttons;
    }
    return out;
  };

  const shown = await readControls(page);

  check(!shown.addExpense,
    'VIEWER: is NOT offered Add Expense - the server would refuse it',
    shown.addExpense ? `offered. buttons: ${shown.buttons}` : 'correctly absent');
  check(!shown.addMember,
    'VIEWER: is NOT offered Add Member',
    shown.addMember ? `offered. buttons: ${shown.buttons}` : 'correctly absent');
  check(!shown.removeMember,
    'VIEWER: is NOT offered Remove Member',
    shown.removeMember ? 'a remove control is rendered' : 'correctly absent');
  check(!shown.statusControl,
    'VIEWER: and cannot change the project status from the page',
    shown.statusControl ? 'the status control is rendered' : 'correctly absent');
  check(!shown.financeVisible,
    'VIEWER: nor read the spend - finance is deliberately NOT part of read',
    shown.financeVisible ? 'the expenses section is offered to a viewer' : 'correctly absent');

  /* ── THE OWNER STILL HAS EVERYTHING. A fix that hides the controls from
        everybody is not a fix. ────────────────────────────────────────── */
  const ownerPage = await browser.newPage();
  await ownerPage.setViewport({ width: 1440, height: 900 });
  await ownerPage.setCookies(asBrowserCookies(ownerCookie));
  await ownerPage.goto(`${BASE}/projects/${projectId}`);
  await ownerPage.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await ownerPage.goto(`${BASE}/projects/${projectId}`);
  await waitFor(ownerPage, `document.body.innerText.includes('Capability probe ${stamp}')`);
  await settle(900);
  const ownerSees = await readControls(ownerPage);
  check(ownerSees.addExpense && ownerSees.addMember && ownerSees.statusControl && ownerSees.financeVisible,
    'OWNER: still has every control - the fix gates by ROLE, it does not hide the feature',
    `expense ${ownerSees.addExpense}, member ${ownerSees.addMember}, status ${ownerSees.statusControl}, finance ${ownerSees.financeVisible}`);
} finally {
  cleanUp();
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
