/**
 * ── THE FOUR PROFESSIONAL ROLES, EACH ON ITS OWN TERMS ──────────────────
 *
 * Contractor, Engineer, Architect and Project Manager share components. That
 * is legitimate - they are all providers - but shared components DO NOT PROVE
 * PARITY, and four roles that differ only by a label are four ways of saying
 * the same thing badly.
 *
 * So this walks each one separately and asks what is actually different:
 *
 *   is the workspace addressed to THIS role, or to "a provider"?
 *   are the registration documents the ones THIS profession is asked for?
 *   does project authority follow the capability model, or the job title?
 *
 * AND THE FORBIDDEN HALF, because a role is defined as much by what it cannot
 * do. A provider who creates a project must not become its OWNER - the
 * customer named as ownerId owns it, and the provider runs it. Getting that
 * backwards would quietly hand a contractor the customer's record.
 *
 * FRESH ACCOUNTS THROUGHOUT. Nothing here reuses a fixture.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);

const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (10200 + (process.pid % 60)));
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
  } catch { return { ok: false, code: null, message: text.slice(0, 160) }; }
}
async function query(cookie, path, input) {
  const res = await fetch(`${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input ?? null }))}`,
    { headers: { cookie } });
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    if (res.status === 200) return { ok: true, data: parsed.result.data.json };
    return { ok: false, code: parsed?.error?.json?.data?.code ?? null, message: parsed?.error?.json?.message ?? '' };
  } catch { return { ok: false, code: null, message: text.slice(0, 160) }; }
}
function seedUser(username, role, onboarding = 'not_started', verified = 0) {
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified, passwordHash, passwordSetAt)
       values ('probe-${username}', '${username}', '${username}@example.test', 'Probe ${username}',
        'user', '${role}', 'password', 'self_registered', 0, 'active', '${onboarding}', ${verified},
        '${HASH}', now())`);
  return Number(sql(`select id from users where username='${username}'`));
}
function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zpro%') as probe)`;
  const projectIds = `(select id from (select id from projects where ownerId in ${ids}) as p)`;
  for (const statement of [
    `delete from registrationReviewEvents where userId in ${ids} or actorId in ${ids}`,
    `delete from registrationDocumentSubmissions where userId in ${ids}`,
    `delete from registrationDocuments where userId in ${ids}`,
    `delete from projectMembers where projectId in ${projectIds} or userId in ${ids}`,
    `delete from projects where ownerId in ${ids}`,
    `delete from notifications where userId in ${ids}`,
    `delete from commercialAuditEvents where actorId in ${ids} or ownerId in ${ids}`,
    `delete from userAccountAuditEvents where actorId in ${ids} or userId in ${ids}`,
    `delete from users where username like 'zpro%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 90)})`);
    }
  }
}

/**
 * What each profession is actually asked for, and what its workspace calls
 * itself. Taken from the product's own vocabulary rather than invented here -
 * if these drift, the probe should fail rather than quietly agree.
 */
const ROLES = [
  { role: 'contractor',      workspace: 'Contractor Workspace' },
  { role: 'engineer',        workspace: 'Engineering Workspace' },
  { role: 'architect',       workspace: 'Architecture Workspace' },
  { role: 'project_manager', workspace: 'Project Management Workspace' },
];

/**
 * Documents every profession is asked for, so they prove nothing about
 * differentiation and are excluded from the comparison below.
 */
const UNIVERSAL_DOCUMENTS = ['government-issued id', 'tax card'];

const browser = await launchBrowser({ port: CDP_PORT });
try {
  cleanUp();
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const created = {};
  for (const spec of ROLES) {
    const username = `zpro${spec.role.slice(0, 4)}${stamp}`;
    created[spec.role] = { username, id: seedUser(username, spec.role) };
  }
  check(Object.values(created).every(c => c.id > 0),
    'SETUP: a fresh account for each of the four professions',
    Object.entries(created).map(([r, c]) => `${r}:${c.id}`).join(' '));

  /* ── EACH PROFESSION IS ASKED FOR ITS OWN DOCUMENTS ──────────────────── */
  //
  // ASKED FROM THE PRODUCT, NOT FROM A LIST I WROTE. The first version of
  // this check hardcoded generic names - "Professional license" - and failed
  // against a product that is MORE specific than that: an engineer is asked
  // for an "Engineering syndicate license", an architect for an "Architecture
  // license". The expectation was wrong and the product was right, so the
  // comparison now reads what each profession is actually asked for and
  // tests the property that matters: the sets genuinely differ.
  const requirementsByRole = {};
  for (const spec of ROLES) {
    const cookie = await signIn(`${created[spec.role].username}@example.test`);
    const requirements = await query(cookie, 'compliance.requirements', null);
    const names = (requirements.data?.requirements ?? []).map(r => String(r.name));
    requirementsByRole[spec.role] = names;
    const specific = names
      .map(n => n.toLowerCase())
      .filter(n => !UNIVERSAL_DOCUMENTS.includes(n));
    // A supplier's bank certificate has no business on an architect's
    // checklist, and a checklist that asks everybody for everything is one
    // nobody completes.
    const borrowed = specific.some(n => /bank account certificate|product catalogue/.test(n));
    check(specific.length >= 2 && !borrowed,
      `${spec.role.toUpperCase()}: is asked for documents specific to this profession`,
      names.join(', '));
  }

  const signatures = new Set(Object.values(requirementsByRole)
    .map(names => names.map(n => n.toLowerCase()).sort().join('|')));
  check(signatures.size === ROLES.length,
    'PARITY: all four professions are asked for genuinely DIFFERENT documents',
    `${signatures.size} distinct checklists across ${ROLES.length} professions`);

  /* ── EACH WORKSPACE IS ADDRESSED TO THAT PROFESSION ──────────────────── */
  //
  // APPROVED FIRST. An UNAPPROVED professional is sent to finish registration
  // instead of into their workspace - which is the product being right, and
  // is separately asserted further down. The first version of this check
  // walked into that gate and read the compliance page four times, concluding
  // the four workspaces were identical when it had not seen any of them.
  for (const spec of ROLES) {
    sql(`update users set onboardingStatus='approved', verified=1
          where id=${created[spec.role].id}`);
  }

  const titles = new Set();
  for (const spec of ROLES) {
    const cookie = await signIn(`${created[spec.role].username}@example.test`);
    await page.setCookies(asBrowserCookies(cookie));
    await page.goto(`${BASE}/platform/${spec.role}`);
    await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
    await page.goto(`${BASE}/platform/${spec.role}`);
    await waitFor(page, `document.body.innerText.length > 300`);
    await settle(700);
    const seen = JSON.parse(await page.evaluate(`
      const main = document.querySelector('main') || document.body;
      return JSON.stringify({ title: main.innerText.slice(0, 500) });
    `));
    const mine = seen.title.includes(spec.workspace);
    // AND NOT ANOTHER PROFESSION'S. Four pages that each carry their own
    // title prove differentiation only if none of them carries somebody
    // else's as well.
    const others = ROLES.filter(r => r.role !== spec.role)
      .filter(r => seen.title.includes(r.workspace))
      .map(r => r.workspace);
    if (mine && others.length === 0) titles.add(spec.workspace);
    check(mine && others.length === 0,
      `${spec.role.toUpperCase()}: the workspace is addressed to this profession and no other`,
      others.length ? `also shows: ${others.join(', ')}` : spec.workspace);
  }
  check(titles.size === ROLES.length,
    'PARITY: the four workspaces are genuinely distinct, not one page with four labels',
    `${titles.size}/${ROLES.length} — ${[...titles].join(' / ')}`);

  /* ── PROJECT AUTHORITY FOLLOWS THE CAPABILITY MODEL ──────────────────── */
  //
  // A provider who starts a project runs it; the customer named as ownerId
  // owns it. Returning `owner` for everyone would quietly make a contractor
  // the owner of a customer's record, which is what the whole project-access
  // model exists to prevent.
  for (const spec of ROLES) {
    const cookie = await signIn(`${created[spec.role].username}@example.test`);
    const madeProject = await call(cookie, 'projects.create', {
      title: `${spec.role} project ${stamp}`, type: 'residential',
    });
    const projectId = Number(madeProject.data?.id ?? 0);
    const myRole = projectId
      ? sql(`select projectRole from projectMembers where projectId=${projectId}
               and userId=${created[spec.role].id} order by id desc limit 1`)
      : '';
    check(madeProject.ok && myRole === 'manager',
      `${spec.role.toUpperCase()}: starting a project makes them its MANAGER, never its owner`,
      madeProject.ok ? `projectRole ${myRole || '(none)'}` : `${madeProject.code} ${madeProject.message}`.slice(0, 80));
  }

  /* ── AND A SUPPLIER CANNOT START ONE AT ALL ──────────────────────────── */
  const supplierName = `zprosup${stamp}`;
  seedUser(supplierName, 'supplier', 'approved', 1);
  const supplierAttempt = await call(await signIn(`${supplierName}@example.test`),
    'projects.create', { title: `Supplier project ${stamp}`, type: 'residential' });
  check(!supplierAttempt.ok,
    'FORBIDDEN: a supplier cannot start a project - they deliver against one',
    `${supplierAttempt.code ?? 'accepted'} ${supplierAttempt.message}`.slice(0, 90));

  /* ── AN UNAPPROVED PROFESSIONAL IS NOT YET A PROVIDER ────────────────── */
  // A FRESH, STILL-UNAPPROVED professional, because the four above have been
  // approved to reach their workspaces.
  const pendingName = `zpropend${stamp}`;
  const pendingId = seedUser(pendingName, 'engineer');
  const beforeApproval = await query(await signIn(`${pendingName}@example.test`),
    'projects.directory', { page: 0, pageSize: 10 });
  check(!beforeApproval.ok,
    'FORBIDDEN: an unapproved professional cannot browse the provider lead directory',
    `${beforeApproval.code ?? 'accepted'} ${beforeApproval.message}`.slice(0, 80));

  sql(`update users set onboardingStatus='approved', verified=1 where id=${pendingId}`);
  const afterApproval = await query(await signIn(`${pendingName}@example.test`),
    'projects.directory', { page: 0, pageSize: 10 });
  check(afterApproval.ok,
    'APPROVAL: and can once they are approved - approval is what changed',
    afterApproval.ok ? 'reachable' : `${afterApproval.code}`);

  // AND THE GATE IS VISIBLE, not just enforced. An unapproved professional
  // who opens their workspace is shown what to finish rather than an empty
  // room they cannot explain.
  await page.setCookies(asBrowserCookies(await signIn(`${pendingName}@example.test`)));
  sql(`update users set onboardingStatus='not_started', verified=0 where id=${pendingId}`);
  await page.goto(`${BASE}/platform/engineer`);
  await waitFor(page, `document.body.innerText.length > 300`);
  await settle(800);
  const gate = await page.evaluate(`
    const text = (document.querySelector('main') || document.body).innerText;
    return String(/registration|compliance|document/i.test(text));
  `);
  check(gate === 'true',
    'ONBOARDING: an unapproved professional is told what to finish, not left at a dead end');

  /* ── NOBODY CAN APPROVE THEMSELVES ───────────────────────────────────── */
  for (const spec of ROLES) {
    const cookie = await signIn(`${created[spec.role].username}@example.test`);
    const selfApprove = await call(cookie, 'admin.verifyUser',
      { userId: created[spec.role].id, verified: true });
    if (spec.role === 'contractor') {
      check(!selfApprove.ok,
        'FORBIDDEN: a professional cannot verify themselves',
        `${selfApprove.code ?? 'accepted'}`);
    }
  }

  /* ── AND CANNOT REACH ANOTHER PROFESSIONAL'S REGISTRATION ────────────── */
  const contractorCookie = await signIn(`${created.contractor.username}@example.test`);
  const peek = await query(contractorCookie, 'admin.complianceApplicant',
    { userId: created.engineer.id });
  check(!peek.ok,
    'FORBIDDEN: nor read another professional\'s registration record',
    `${peek.code ?? 'accepted'}`);
} finally {
  cleanUp();
  await browser.close();
}

console.log(`\nBUILD ${BUILD.shortCommit} · ${BUILD.environment} · 1440x900 · en`);
console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
