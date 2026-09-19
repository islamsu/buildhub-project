/**
 * ── A NAME IN THE CONSOLE, CLICKED ───────────────────────────────────────
 *
 * `adminEntityLinks.test.ts` proves every admin surface that shows who
 * somebody is uses the one primitive. Source cannot tell you whether the
 * rendered element has an href, whether it goes to the right account, or
 * whether the referred party's NAME actually arrives from the server instead
 * of the `#4127` the screen used to print.
 *
 * So this seeds real records, signs in as a real administrator, reads the
 * rendered anchors out of the DOM, and follows one to the account.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9400 + (process.pid % 90)));
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 250) => new Promise(r => setTimeout(r, ms));
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

const PASSWORD = 'LocalSuperAdmin!2024';
const HASH = process.env.ZG_HASH;
if (!HASH) { console.error('set ZG_HASH to an application-minted password hash'); process.exit(2); }
const stamp = Date.now() % 100000000;

function makeUser(suffix, role, adminRole = null, name = null) {
  const u = `zid${stamp}${suffix}`;
  sql(`insert into users (openId, username, email, name, role, ${adminRole ? 'adminRole,' : ''} userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${u}', '${u}', '${u}@example.test', '${name ?? `Probe ${suffix}`}',
        '${adminRole ? 'admin' : 'user'}', ${adminRole ? `'${adminRole}',` : ''} '${role}',
        'password', 'admin_created', 0, 'active', 'approved', 1, '${HASH}', now())`);
  const id = Number(sql(`select id from users where username='${u}'`));
  if (!Number.isInteger(id) || id <= 0) throw new Error(`probe setup: ${u} not created`);
  return { id, email: `${u}@example.test`, name: name ?? `Probe ${suffix}` };
}

async function signIn(email) {
  const res = await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`adminSignIn: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

/**
 * CLICK A TAB THE WAY A PERSON DOES.
 *
 * `element.click()` does not open a Radix tab: it listens for pointerdown, so
 * a bare click leaves aria-selected exactly where it was. The probe read the
 * still-selected first tab, found no identities on it and reported the product
 * as wrong - the identities were one real click away.
 */
async function clickTab(page, pattern) {
  await page.evaluate(`
    const tab = [...document.querySelectorAll('[role="tab"]')]
      .find(t => ${pattern}.test(t.innerText));
    if (!tab) return false;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      tab.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  `);
  return waitFor(page, `[...document.querySelectorAll('[role="tab"]')]
    .some(t => ${pattern}.test(t.innerText) && t.getAttribute('aria-selected') === 'true')`);
}

/** Every rendered link to a user record on this page, with its text. */
const userLinks = page => page.evaluate(`
  return JSON.stringify([...document.querySelectorAll('a[href^="/admin/users/"]')].map(a => ({
    href: a.getAttribute('href'),
    text: (a.innerText || '').trim(),
  })));
`);

const browser = await launchBrowser({ port: CDP_PORT });

try {
  sql(`delete from reviewReports where id in (select id from (select id from reviewReports) t)`.replace(/.*/, 'select 1'));
  sql(`delete from referrals where code like 'ZID%'`);
  sql(`delete from supportTickets where subject like 'ZID%'`);
  sql(`delete from vendorSponsorships where grantedReason like 'ZID%'`);
  sql(`delete from users where username like 'zid%'`);

  const admin = makeUser('admin', 'admin', 'SUPER_ADMIN', 'Probe Super');
  const requester = makeUser('req', 'homeowner', null, 'Dalia Mansour');
  const referrer = makeUser('rfr', 'supplier', null, 'Omar Khaled');
  const referred = makeUser('rfd', 'homeowner', null, 'Nour Saad');
  const vendor = makeUser('vnd', 'supplier', null, 'Tarek Aziz');

  const TICKET_REF = `TCK-ID-${stamp}`;
  sql(`insert into supportTickets (requesterId, reference, category, subject, description, priority, status)
       values (${requester.id}, '${TICKET_REF}', 'billing', 'ZID invoice question', 'Probe', 'medium', 'open')`);
  sql(`insert into referrals (referrerId, referredId, code, status)
       values (${referrer.id}, ${referred.id}, 'ZID${stamp}', 'registered')`);
  sql(`insert into vendorSponsorships (vendorId, category, startsAt, grantedBy, grantedReason, kind, priority, source, entityType)
       values (${vendor.id}, 'Materials', now(), ${admin.id}, 'ZID probe sponsorship', 'SPONSORED', 1, 'ADMIN_GRANT', 'VENDOR')`);

  check(true, '1. SETUP: real records exist for four distinct people',
    `requester ${requester.name}, referrer ${referrer.name}, referred ${referred.name}, vendor ${vendor.name}`);

  const cookie = await signIn(admin.email);
  const page = await browser.newPage();
  await page.setCookies(asBrowserCookies(cookie));
  await page.goto(`${BASE}/admin`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");

  // ── The support queue ─────────────────────────────────────────────────
  await page.goto(`${BASE}/admin/support`);
  await waitFor(page, `document.body.innerText.includes(${JSON.stringify(TICKET_REF)})`);
  const supportLinks = JSON.parse(await userLinks(page));
  const requesterLink = supportLinks.find(l => l.text === requester.name);
  check(Boolean(requesterLink),
    '2. SUPPORT QUEUE: the requester is a link, by name',
    requesterLink ? `${requesterLink.text} -> ${requesterLink.href}` : `anchors: ${supportLinks.map(l => l.text).join(', ') || 'none'}`);
  check(requesterLink?.href === `/admin/users/${requester.id}`,
    '3. and it points at THAT person\'s record', String(requesterLink?.href));

  // FOLLOWED, not merely rendered.
  await page.goto(`${BASE}${requesterLink?.href ?? '/admin/users'}`);
  const landed = await waitFor(page, `document.body.innerText.includes(${JSON.stringify(requester.name)})`);
  check(landed, '4. and following it opens the account', landed ? requester.name : 'the name never appeared');

  // ── The referral ledger: the defect that printed a bare id ────────────
  await page.goto(`${BASE}/admin/referrals`);
  await waitFor(page, `document.body.innerText.includes(${JSON.stringify(referrer.name)}) || document.body.innerText.length > 400`);
  const referralLinks = JSON.parse(await userLinks(page));
  check(referralLinks.some(l => l.text === referrer.name && l.href === `/admin/users/${referrer.id}`),
    '5. REFERRALS: the referrer is a link, by name');
  const referredLink = referralLinks.find(l => l.href === `/admin/users/${referred.id}`);
  check(referredLink?.text === referred.name,
    '6. AND THE REFERRED PARTY IS A PERSON, NOT A NUMBER',
    referredLink ? `rendered as "${referredLink.text}"` : 'no link to the referred account at all');
  check(!/#\d+/.test(referredLink?.text ?? '#0'),
    '7. and the raw id is not their whole identity', `"${referredLink?.text}"`);

  // ── A commercial ledger ───────────────────────────────────────────────
  await page.goto(`${BASE}/admin/placements`);
  await waitFor(page, `document.body.innerText.length > 300`);
  const placementText = await page.evaluate(`return document.body.innerText`);
  const sponsorLinks = JSON.parse(await userLinks(page));
  check(sponsorLinks.some(l => l.text === vendor.name) || placementText.includes(vendor.name),
    '8. PROMOTIONS: the sponsored vendor is shown by name',
    sponsorLinks.map(l => l.text).join(', ').slice(0, 60) || 'none');

  // ── Nothing renders a link it cannot address ──────────────────────────
  const dead = JSON.parse(await page.evaluate(`
    return JSON.stringify([...document.querySelectorAll('a[href^="/admin/users/"]')]
      .map(a => a.getAttribute('href'))
      .filter(href => !/^\\/admin\\/users\\/[1-9][0-9]*$/.test(href)));
  `));
  check(dead.length === 0, '9. and no identity link points at a non-record',
    dead.length ? dead.join(', ') : 'every href addresses a real row');

  /*
   * THE AUDIT TRAIL NEEDS AN EVENT TO SHOW.
   *
   * The first version of this check asserted that identity links exist on
   * Operations and failed with "0 links" - because the probe seeds through raw
   * SQL, which writes no audit events, so the trail was legitimately empty. An
   * assertion about how a row is rendered needs a row.
   *
   * So a REAL admin action is performed through the API, which is what writes
   * the event: a subject (the person verified) and an actor (this
   * administrator). Both are identities, and neither was reachable from the
   * trail before this pass.
   */
  const verify = await fetch(`${BASE}/api/trpc/admin.verifyUser`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ json: { userId: requester.id, verified: true } }),
  });
  check(verify.status === 200, '9b. a real administrative action is recorded',
    `admin.verifyUser -> HTTP ${verify.status}`);

  // ── The audit trail: subject AND actor ────────────────────────────────
  await page.goto(`${BASE}/admin/operations`);
  await waitFor(page, `document.body.innerText.length > 400`);
  /*
   * THE ACCOUNT TRAIL IS THE SECOND TAB. The trail has two - Commercial and
   * Accounts - and opens on Commercial, which records campaigns and rewards
   * rather than people. The first version of this check read the default tab,
   * found no identities and reported the product as wrong; the identities were
   * one click away, which is where an account audit belongs.
   */
  const onAccounts = await clickTab(page, '/accounts|الحسابات/i');
  check(onAccounts, '9c. and the account trail can be opened', onAccounts ? 'Accounts tab selected' : 'the tab did not select');
  /*
   * SEARCHED, NOT SCROLLED. The trail is paged and ordered, and earlier probe
   * runs left their own events on page one - so "the event I just wrote is not
   * visible" said nothing about whether the SUBJECT column links at all. The
   * screen has a server-side search; the probe uses it, the way somebody
   * looking for this event would.
   */
  await waitFor(page, `!!document.querySelector('[data-testid="audit-search"]')`);
  await page.evaluate(`
    const box = document.querySelector('[data-testid="audit-search"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(box, ${JSON.stringify(requester.name)});
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `);
  await waitFor(page, `document.body.innerText.includes(${JSON.stringify(requester.name)})`);
  const auditLinks = JSON.parse(await userLinks(page));
  const subject = auditLinks.find(l => l.href === `/admin/users/${requester.id}`);
  const actor = auditLinks.find(l => l.href === `/admin/users/${admin.id}`);
  check(subject?.text === requester.name,
    '10. AUDIT TRAIL: the SUBJECT of the event opens their account',
    subject ? `"${subject.text}"` : `anchors: ${auditLinks.map(l => l.text).join(', ') || 'none'}`);
  check(actor?.text === admin.name,
    '10b. and so does the ADMINISTRATOR who caused it',
    actor ? `"${actor.text}"` : 'the actor is not reachable');

  // ── Arabic ────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/admin/support`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'ar'); return true;");
  await page.goto(`${BASE}/admin/support`);
  await waitFor(page, `document.body.innerText.includes(${JSON.stringify(TICKET_REF)})`);
  const arabicLinks = JSON.parse(await userLinks(page));
  check(arabicLinks.some(l => l.text === requester.name),
    '11. ARABIC: the same name is the same link under RTL',
    `dir=${await page.evaluate(`return document.documentElement.getAttribute('dir') || ''`)}`);

} catch (error) {
  check(false, 'PROBE ABORTED', String(error.message).slice(0, 200));
} finally {
  try { browser.close(); } catch { /* the result is already printed */ }
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
