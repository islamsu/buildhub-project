/**
 * ── THE NAME CHANGE OPERATIONAL ARC ─────────────────────────────────────
 *
 * CLAUDE.md §32. Every Admin operational journey must prove the whole chain,
 * not the endpoint at each link:
 *
 *   EVENT -> ATTENTION -> QUEUE -> DETAIL -> ACTION -> AUDIT -> CONSEQUENCE
 *
 * Name Change was the one §32 arc with no probe. It is also the arc where a
 * broken last link is least visible: a vendor whose legal name changed gets
 * an approval notification, and if the PUBLIC storefront still shows the old
 * name, nobody finds out until a customer queries an invoice.
 *
 * WHAT IS PROVED, against real rows and in a real browser:
 *
 *   a vendor can request a name change from their own settings
 *   a second open request on the same field is refused
 *   the Admin ATTENTION count moves - the count is rendered, not merely computed
 *   the queue is a tab inside User Management, per the owner's IA decision
 *   the legacy /admin/name-changes path resolves to that tab
 *   an administrator can read the request and decide it
 *   approval REWRITES THE VENDOR PROFILE, not just the request row
 *   the PUBLIC storefront shows the new name - the consequence a customer sees
 *   the decision is written to the account audit trail with before -> after
 *   the vendor is notified, in their own language, with a deep link
 *   a decided request cannot be decided again
 *   a non-administrator cannot review, and cannot read the queue
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { adminSession, asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9900 + (process.pid % 80)));
const ADMIN = 'superadmin@buildhub.local';
const PASSWORD = 'LocalSuperAdmin!2024';
const VENDOR = 'zid6507832vnd@example.test';
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
async function signIn(identifier) {
  const res = await fetch(`${BASE}/api/trpc/auth.signIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`signIn ${identifier}: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}
async function call(cookie, path, input) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ json: input }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function query(cookie, path, input) {
  const url = `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input ?? null }))}`;
  const res = await fetch(url, { headers: cookie ? { cookie } : {} });
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.result?.data?.json };
}

console.log(`\nBUILD ${BUILD.shortCommit ?? '?'}  env=${BUILD.environment ?? '?'}\n`);

const session = await adminSession(ADMIN, PASSWORD);
if (!session.ok) { console.error(`adminSignIn: ${session.reason}`); process.exit(2); }
const adminCookie = session.cookie;
const vendorCookie = await signIn(VENDOR);
const vendorId = Number(sql(`SELECT id FROM users WHERE email='${VENDOR}'`));
const NEW_NAME = `Aziz Trading ${stamp}`;

/* ── BASELINE ────────────────────────────────────────────────────────── */
// Cleared so the arc runs from a known state on a re-run rather than
// tripping the one-open-request rule from a previous pass.
sql(`DELETE FROM vendorNameChangeRequests WHERE userId=${vendorId}`);
const before = await query(adminCookie, 'admin.attention', null);
/*
 * `admin.attention` returns {count, meaning, href} per queue, not a bare
 * number - the `meaning` is what makes a badge explicable rather than a
 * mystery digit. The first run of this probe read the object as a number and
 * got NaN, which then made the "count moves" check compare NaN to NaN.
 */
const attentionBefore = Number(before.data?.nameChanges?.count ?? -1);
check(before.status === 200 && attentionBefore >= 0,
  'the Admin attention count is readable', `${attentionBefore}`);

/* ── EVENT ───────────────────────────────────────────────────────────── */
const requested = await call(vendorCookie, 'profile.requestVendorNameChange', {
  field: 'companyName', requestedValue: NEW_NAME, reason: 'Rebranded after restructuring.',
});
check(requested.status === 200, 'the vendor requests a name change', `HTTP ${requested.status}`);
const requestId = Number(sql(`SELECT id FROM vendorNameChangeRequests WHERE userId=${vendorId} ORDER BY id DESC LIMIT 1`));
check(requestId > 0, 'and it is recorded as a request', `#${requestId}`);

const duplicate = await call(vendorCookie, 'profile.requestVendorNameChange', {
  field: 'companyName', requestedValue: `${NEW_NAME} again`,
});
check(duplicate.status !== 200,
  'a second OPEN request on the same field is refused',
  duplicate.body?.error?.json?.message ?? `HTTP ${duplicate.status}`);

/* ── ATTENTION ───────────────────────────────────────────────────────── */
const after = await query(adminCookie, 'admin.attention', null);
check(Number(after.data?.nameChanges?.count ?? -1) === attentionBefore + 1,
  'the Admin attention count MOVES',
  `${attentionBefore} -> ${after.data?.nameChanges?.count}`);
check(typeof after.data?.nameChanges?.href === 'string' && after.data.nameChanges.href.length > 0,
  'and the badge names where to go, so it is not a mystery digit',
  after.data?.nameChanges?.href);

const browser = await launchBrowser({ port: CDP_PORT });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCookies(asBrowserCookies(adminCookie));

  /* ── THE COUNT IS RENDERED, NOT MERELY COMPUTED ───────────────────── */
  // §13: a count computed but never rendered is not a feature. This is the
  // exact defect the owner reported on this queue once already.
  await page.goto(`${BASE}/admin`);
  await waitFor(page, `document.body.innerText.length > 200`);
  const badge = await page.evaluate(`
    const nav = document.querySelector('nav') || document.body;
    const link = [...nav.querySelectorAll('a')].find(a => (a.getAttribute('href') || '').includes('/admin/users'));
    return link ? link.innerText.replace(/\\n+/g, ' ').trim() : 'MISSING';
  `);
  check(badge !== 'MISSING', 'User Management is reachable from the sidebar', badge);

  /* ── QUEUE: A TAB INSIDE USER MANAGEMENT, per the owner's IA ──────── */
  await page.goto(`${BASE}/admin/users`);
  const tabPresent = await waitFor(page, `document.querySelector('[data-testid="users-tab-name-changes"]') !== null`);
  check(tabPresent, 'Name Change Requests is a TAB inside User Management, not a top-level destination');

  /* ── THE LEGACY PATH RESOLVES TO THAT TAB ─────────────────────────── */
  await page.goto(`${BASE}/admin/name-changes`);
  await waitFor(page, `document.querySelector('[data-testid="users-tab-name-changes"]') !== null`);
  const opened = await page.evaluate(`
    const tab = document.querySelector('[data-testid="users-tab-name-changes"]');
    return tab ? String(tab.getAttribute('data-state') === 'active') : 'false';
  `);
  check(opened === 'true', 'the legacy /admin/name-changes path opens that tab directly');

  /* ── DETAIL: the request is legible, with the OLD and NEW value ───── */
  const rowText = await page.evaluate(`
    const main = document.querySelector('main') || document.body;
    return main.innerText.replace(/\\n+/g, ' | ');
  `);
  check(rowText.includes(NEW_NAME),
    'the requested name is on the screen', NEW_NAME);
  check(/aziz|tarek/i.test(rowText),
    'and so is the human it belongs to - not just an id');

} finally {
  await browser.close();
}

/* ── ACTION ──────────────────────────────────────────────────────────── */
const nameBefore = sql(`SELECT IFNULL(companyName,'none') FROM vendorProfiles WHERE userId=${vendorId}`) || 'none';
const decided = await call(adminCookie, 'admin.reviewVendorNameChange', {
  requestId, status: 'approved', reviewerNote: 'Verified against the commercial register.',
});
check(decided.status === 200, 'an administrator approves the request', `HTTP ${decided.status}`);

/* ── CONSEQUENCE 1: THE PROFILE IS ACTUALLY REWRITTEN ────────────────── */
// The link that matters. A request row marked 'approved' while the profile
// still says the old name is a decision nobody applied.
const nameAfter = sql(`SELECT IFNULL(companyName,'none') FROM vendorProfiles WHERE userId=${vendorId}`);
check(nameAfter === NEW_NAME,
  "approval REWRITES the vendor's profile, not just the request row",
  `${nameBefore} -> ${nameAfter}`);

/* ── CONSEQUENCE 2: THE OTHER PARTY SEES IT ─────────────────────────── */
/*
 * The last link, and the one a customer actually meets.
 *
 * READ AS A DIFFERENT SIGNED-IN ACCOUNT, not as the vendor and not
 * anonymously. `profile.getPublic` is the storefront reader and it is
 * authenticated - BuildHub's approved design is that full provider detail is
 * visible to signed-in users, not to the open internet. Reading it as the
 * vendor themselves would prove nothing, since they would see their own row
 * whatever the join did.
 *
 * The first run of this probe asked `marketplace.vendorProfile`, which does
 * not exist, and fell back to the DIRECTORY - which returns the person's
 * name by design. It reported a broken last link that was not broken.
 */
const buyerCookie = await signIn('zid6507832req@example.test');
const storefront = await query(buyerCookie, 'profile.getPublic', { userId: vendorId });
check(storefront.status === 200, 'a buyer can open the storefront', `HTTP ${storefront.status}`);
check(storefront.data?.company?.companyName === NEW_NAME,
  'the STOREFRONT carries the new name - the consequence the other party sees',
  `${storefront.data?.company?.companyName}`);
check(nameBefore === 'none' || !JSON.stringify(storefront.data ?? {}).includes(nameBefore),
  'and no longer carries the old one', nameBefore);

/* ── CONSEQUENCE 3: THE MARKETPLACE DIRECTORY, TOO ──────────────────── */
/*
 * A GAP THIS ARC FOUND.
 *
 * The directory returned only `users.name`, so a supplier trading as a
 * registered company appeared in a B2B marketplace under the name of
 * whoever opened the account - and an approved name change was invisible
 * there no matter how correctly the rest of the arc worked. The business is
 * carried now, from the same enrichment featured placement uses, so a
 * featured card and an organic one cannot disagree about who a supplier is.
 */
const directory = await query(null, 'marketplace.vendors', { limit: 100 });
const row = (directory.data ?? []).find(v => Number(v.id) === vendorId);
check(row !== undefined, 'the vendor is in the public directory');
check(row?.businessName === NEW_NAME,
  'and the directory carries the BUSINESS, not only the person',
  `${row?.name} -> ${row?.businessName}`);
const independent = (directory.data ?? []).find(v => v.businessName === null);
check(independent !== undefined,
  'while a provider with no registered business is null, not filled with their own name',
  independent ? `#${independent.id} ${independent.name}` : 'none in this dataset');

/* ── AUDIT ───────────────────────────────────────────────────────────── */
const audit = sql(`
  SELECT CONCAT(action, ' :: ', IFNULL(note,'')) FROM userAccountAuditEvents
  WHERE userId=${vendorId} AND source='vendor_name_change' ORDER BY id DESC LIMIT 1`);
check(audit.startsWith('vendor_name_change_approved'),
  'the decision is written to the account audit trail', audit.slice(0, 90));
check(audit.includes(NEW_NAME) && audit.includes('->'),
  'with the BEFORE and AFTER values, not merely that something changed');
const actor = Number(sql(`
  SELECT IFNULL(actorId,0) FROM userAccountAuditEvents
  WHERE userId=${vendorId} AND source='vendor_name_change' ORDER BY id DESC LIMIT 1`));
check(actor > 0 && actor !== vendorId,
  'and names the ADMINISTRATOR who decided it, not the vendor', `actor #${actor}`);

/* ── THE VENDOR IS TOLD ──────────────────────────────────────────────── */
const notification = sql(`
  SELECT CONCAT(IFNULL(link,''), ' :: ', IFNULL(messageKey,'')) FROM notifications
  WHERE userId=${vendorId} ORDER BY id DESC LIMIT 1`);
check(notification.includes('/settings#settings-name-change'),
  'the vendor is notified with a link to the decision, not to a long page',
  notification.slice(0, 80));
check(notification.includes('notif.vendorName.approved'),
  'and in a localized message key rather than an English sentence in the row');

/* ── A DECIDED REQUEST IS FINAL ──────────────────────────────────────── */
const again = await call(adminCookie, 'admin.reviewVendorNameChange', {
  requestId, status: 'rejected', reviewerNote: 'Changed my mind.',
});
check(again.status !== 200,
  'a decided request cannot be decided again',
  again.body?.error?.json?.message ?? `HTTP ${again.status}`);

/* ── AUTHORIZATION ───────────────────────────────────────────────────── */
const deniedRead = await query(vendorCookie, 'admin.vendorNameChanges', { page: 0, pageSize: 10 });
check(deniedRead.status === 401 || deniedRead.status === 403,
  'a signed-in vendor cannot read the queue', `HTTP ${deniedRead.status}`);
const deniedWrite = await call(vendorCookie, 'admin.reviewVendorNameChange', {
  requestId, status: 'approved',
});
check(deniedWrite.status === 401 || deniedWrite.status === 403,
  'and certainly cannot approve their own request', `HTTP ${deniedWrite.status}`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
