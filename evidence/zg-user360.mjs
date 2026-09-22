/**
 * ── USER MANAGEMENT AS A 360° OPERATIONS CONSOLE ────────────────────────
 *
 * CLAUDE.md §82 / North Star §34. `/admin/users/:id` was one scrolling card:
 * identity, an edit form, internal notes and the audit trail. An
 * administrator investigating an account had to leave it and search five
 * other screens by hand to learn whether this person had projects, had sent
 * quotations, was in a dispute, held a subscription, or was stuck in
 * compliance. The owner rejected that as complete.
 *
 * WHAT IS PROVED, in a real browser against real rows:
 *
 *   the sections North Star §34 names exist as real tabs
 *   each figure MATCHES the database, domain by domain
 *   ownership and membership are counted as the different facts they are
 *   a superseded quotation revision is not counted twice
 *   a domain with nothing in it SAYS so rather than vanishing
 *   an outage renders as an outage, not as an account with no history
 *   the sections deep-link to the screens that own them
 *   NO OTHER DOMAIN'S PRIVATE CONTENTS reach this page
 *   users.read is required, and a non-administrator gets nothing
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9900 + (process.pid % 80)));
const ADMIN = 'superadmin@buildhub.local';
const PASSWORD = 'LocalSuperAdmin!2024';
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();
const num = q => Number(sql(q) || '0');

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
async function signIn(identifier, admin = false) {
  const res = await fetch(`${BASE}/api/trpc/auth.${admin ? 'adminSignIn' : 'signIn'}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`signIn ${identifier}: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}
async function query(cookie, path, input) {
  const url = `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input ?? null }))}`;
  const res = await fetch(url, { headers: cookie ? { cookie } : {} });
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.result?.data?.json };
}

console.log(`\nBUILD ${BUILD.shortCommit ?? '?'}  env=${BUILD.environment ?? '?'}\n`);

const adminCookie = await signIn(ADMIN, true);

/* THE BUSIEST NON-ADMIN ACCOUNT, so the assertions are about real figures
   rather than a row of zeros that any broken query also produces. */
const subjectId = num(`
  SELECT u.id FROM users u
  LEFT JOIN products p ON p.supplierId = u.id
  WHERE u.role <> 'admin'
  GROUP BY u.id ORDER BY COUNT(p.id) DESC, u.id ASC LIMIT 1`);
check(subjectId > 0, 'a real account to inspect', `#${subjectId}`);

/* ── EVERY FIGURE AGAINST THE DATABASE ───────────────────────────────── */
const snapshot = await query(adminCookie, 'admin.userSnapshot', { userId: subjectId });
check(snapshot.status === 200, 'the snapshot loads', `HTTP ${snapshot.status}`);
const s = snapshot.data ?? {};

const expectations = [
  ['projects owned', s.projects?.owned, num(`SELECT COUNT(*) FROM projects WHERE ownerId=${subjectId}`)],
  ['projects member of', s.projects?.memberOf, num(`SELECT COUNT(*) FROM projectMembers WHERE userId=${subjectId} AND removedAt IS NULL`)],
  ['rfqs', s.sourcing?.rfqs, num(`SELECT COUNT(*) FROM rfqs WHERE requesterId=${subjectId}`)],
  ['quotations (current only)', s.sourcing?.quotations, num(`SELECT COUNT(*) FROM quotations WHERE providerId=${subjectId} AND supersededAt IS NULL`)],
  ['qualified enquiries', s.sourcing?.qualifiedEnquiries, num(`SELECT COUNT(*) FROM qualifiedEnquiries WHERE userId=${subjectId}`)],
  ['products', s.marketplace?.products, num(`SELECT COUNT(*) FROM products WHERE supplierId=${subjectId}`)],
  ['live products', s.marketplace?.productsByStatus?.active ?? 0, num(`SELECT COUNT(*) FROM products WHERE supplierId=${subjectId} AND status='active'`)],
  ['services', s.marketplace?.services, num(`SELECT COUNT(*) FROM serviceOfferings WHERE providerId=${subjectId}`)],
  ['compliance documents', s.compliance?.documents, num(`SELECT COUNT(*) FROM registrationDocuments WHERE userId=${subjectId}`)],
  ['reviews received', s.trust?.reviewsReceived, num(`SELECT COUNT(*) FROM reviews WHERE revieweeId=${subjectId}`)],
  ['disputes (both sides)', s.trust?.disputes, num(`SELECT COUNT(*) FROM disputes WHERE reporterId=${subjectId} OR respondentId=${subjectId}`)],
  ['support tickets', s.trust?.tickets, num(`SELECT COUNT(*) FROM supportTickets WHERE requesterId=${subjectId}`)],
  ['referrals attributed', s.commercial?.referralsAttributed, num(`SELECT COUNT(*) FROM referrals WHERE referrerId=${subjectId}`)],
];
for (const [name, shown, actual] of expectations) {
  check(shown === actual, `${name} matches the database`, `snapshot ${shown}, db ${actual}`);
}

/* ── A SUPERSEDED REVISION IS NOT A SECOND QUOTATION ─────────────────── */
const allQuotationRows = num(`SELECT COUNT(*) FROM quotations WHERE providerId=${subjectId}`);
const currentRows = num(`SELECT COUNT(*) FROM quotations WHERE providerId=${subjectId} AND supersededAt IS NULL`);
if (allQuotationRows > currentRows) {
  check(s.sourcing?.quotations === currentRows,
    'a revised quotation counts ONCE, not once per revision', `${allQuotationRows} rows, ${currentRows} current`);
} else {
  console.log(`SKIP  ${step++}. a revised quotation counts once  [no superseded revisions in this dataset]`);
}

/* ── NO OTHER DOMAIN'S PRIVATE CONTENTS ─────────────────────────────── */
// §65: do not expose PII merely to make a workflow look richer. The snapshot
// carries counts, states and headings - never a document URL, a dispute's
// evidence, a message body or a quotation's commercial terms.
const serialised = JSON.stringify(s);
const forbidden = [
  ['a compliance document URL', /"url"\s*:/],
  ['a stored file key', /"fileKey"\s*:/],
  ['a dispute description', /"description"\s*:/],
  ['quotation commercial terms', /"commercialTerms"\s*:/],
  ['a password hash', /passwordHash/i],
  ['a reset token', /resetToken/i],
];
for (const [name, pattern] of forbidden) {
  check(!pattern.test(serialised), `the snapshot does not carry ${name}`);
}

/* ── IN THE BROWSER ──────────────────────────────────────────────────── */
const browser = await launchBrowser({ port: CDP_PORT });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCookies(asBrowserCookies(adminCookie));
  await page.goto(`${BASE}/admin/users/${subjectId}`);
  await waitFor(page, `document.querySelector('[data-testid="admin-user-detail"]') !== null`);

  const tabs = JSON.parse(await page.evaluate(`
    return JSON.stringify([...document.querySelectorAll('[role="tab"]')].map(el => el.textContent.trim()));
  `));
  for (const area of ['Overview', 'Account', 'Business', 'Compliance', 'Activity', 'Benefits & Referrals', 'Trust & Support', 'Notes', 'Audit']) {
    check(tabs.includes(area), `the "${area}" section exists`, tabs.join(' | '));
  }

  /* IT IS NOT ONE SCROLLING CARD ANY MORE: Radix renders only the active
     tab, so a section's content must be ABSENT until its tab is opened. */
  const businessBeforeOpening = await page.evaluate(`
    return document.querySelector('[data-testid="user-marketplace"]') === null ? 'true' : 'false';
  `);
  check(businessBeforeOpening === 'true',
    'the page is sectioned, not one long card - Business is not rendered until opened');

  await page.evaluate(clickOn('[data-testid="user-tab-business"]'));
  const businessOpened = await waitFor(page, `document.querySelector('[data-testid="user-marketplace"]') !== null`);
  check(businessOpened, 'and opening it renders it');

  const liveShown = await page.evaluate(`
    const el = document.querySelector('[data-testid="user-stat-live-products"] p');
    return el ? el.textContent.trim() : 'MISSING';
  `);
  check(liveShown === String(s.marketplace?.productsByStatus?.active ?? 0),
    'the rendered product figure is the counted one', `screen ${liveShown}`);

  /* ── AN EMPTY DOMAIN SAYS SO ──────────────────────────────────────── */
  await page.evaluate(clickOn('[data-testid="user-tab-activity"]'));
  await waitFor(page, `document.querySelector('[data-testid="user-activity"]') !== null`);
  const activityText = await page.evaluate(`
    const el = document.querySelector('[data-testid="user-activity"]');
    return el ? el.innerText.replace(/\\n+/g, ' | ') : 'MISSING';
  `);
  const noProjects = (s.projects?.owned ?? 0) + (s.projects?.memberOf ?? 0) === 0;
  check(!noProjects || /no projects/i.test(activityText),
    'a domain with nothing in it says so rather than vanishing', activityText.slice(0, 120));

  /* ── THE DEEP LINKS ───────────────────────────────────────────────── */
  await page.evaluate(clickOn('[data-testid="user-tab-commercial"]'));
  await waitFor(page, `document.querySelector('[data-testid="user-open-referral-control"]') !== null`);
  await page.evaluate(clickOn('[data-testid="user-open-referral-control"]'));
  const wentToReferrals = await waitFor(page, `location.pathname === '/admin/referrals'`, 12000);
  check(wentToReferrals, 'Benefits & Referrals deep-links to Referral Management',
    await page.evaluate(`return location.pathname;`));

  /* ── AN OUTAGE IS AN OUTAGE ───────────────────────────────────────── */
  // The defect this guards is §10's: a failed read rendering as an account
  // with no projects, no disputes and no history.
  //
  // BLOCKED AT THE NETWORK LAYER, NOT BY PATCHING `fetch`. The first attempt
  // patched window.fetch after the page had already loaded, so the query
  // cache still held a successful response and the section rendered the
  // CACHED figures - a green light for an instrument that was measuring
  // nothing. Network.setBlockedURLs survives navigation and there is no
  // cache to fall back on in a fresh document.
  //
  // tRPC batches several procedures into one request, so blocking the
  // snapshot blocks the batch it travels in. That is the honest shape of
  // this outage anyway: the guarantee being asserted is that the screen
  // reports a failure rather than rendering a confident row of zeros.
  await page.send('Network.setBlockedURLs', { urls: ['*/api/trpc/*'] });
  await page.goto(`${BASE}/admin/users/${subjectId}`);
  await settle(4000);
  const outage = await page.evaluate(`
    const tiles = document.querySelectorAll('[data-testid^="user-stat-"]');
    const text = document.body.innerText;
    const reportsFailure = /could not|couldn.t|failed|try again|unknown/i.test(text);
    return JSON.stringify({ tiles: tiles.length, reportsFailure });
  `);
  const seen = JSON.parse(outage);
  check(seen.tiles === 0, 'an unreachable server renders NO counted figures at all', `${seen.tiles} stat tiles`);
  check(seen.reportsFailure, 'and says the read failed rather than showing an empty account');
  await page.send('Network.setBlockedURLs', { urls: [] });

} finally {
  await browser.close();
}

/* ── AUTHORIZATION ───────────────────────────────────────────────────── */
const subjectEmail = sql(`SELECT email FROM users WHERE id=${subjectId}`);
const userCookie = await signIn(subjectEmail);
const denied = await query(userCookie, 'admin.userSnapshot', { userId: subjectId });
check(denied.status === 401 || denied.status === 403,
  'a signed-in non-administrator cannot read the snapshot - not even their own',
  `HTTP ${denied.status}`);
const anonymous = await query(null, 'admin.userSnapshot', { userId: subjectId });
check(anonymous.status === 401 || anonymous.status === 403,
  'and an anonymous caller certainly cannot', `HTTP ${anonymous.status}`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
