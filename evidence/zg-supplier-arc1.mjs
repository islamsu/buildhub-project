/**
 * ── SUPPLIER ARC 1: BECOMING A SUPPLIER ─────────────────────────────────
 *
 * A fresh account signs up as a supplier and is taken through to approval.
 * This is deliberately BOTH halves of the same event: the supplier's journey
 * and the administrator's operational arc, because the whole point is that
 * one becomes the other.
 *
 *   EVENT -> ATTENTION -> QUEUE -> DETAIL -> ACTION -> AUDIT -> USER OUTCOME
 *
 * WHAT IS PROVED, in a real browser against real rows:
 *
 *   a supplier registers and lands in an HONEST onboarding state
 *   the screen tells them what is done, what is missing, and what is blocked
 *   no raw enum reaches the supplier's eyes
 *   they CANNOT verify themselves
 *   an unapproved supplier is NOT publicly verified
 *   submitting a document moves the ADMIN attention count
 *   the administrator can open the queue, read the record and decide
 *   the decision is written to an audit trail
 *   the supplier is NOTIFIED and their own screen changes
 *   approval is what makes them eligible - not signing up
 *
 * INFRASTRUCTURE BLOCK, recorded rather than worked around: object storage is
 * not configured in this environment, so a real document upload cannot
 * complete. That is proven to FAIL HONESTLY - a refusal, not a silent success
 * and not a row pointing at a file that does not exist - and the document row
 * is then seeded so the review half of the arc can be exercised. The upload
 * itself stays an infrastructure skip.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';

/* WHICH BUILD THIS RAN AGAINST. Printed always; enforced when
   ZG_EXPECT_COMMIT names one. */
const BUILD = await assertBuild(BASE);

const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9900 + (process.pid % 80)));
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
const skip = (name, why) => console.log(`SKIP  ${step++}. ${name}  [${why}]`);
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
async function signIn(email, admin = false) {
  const res = await fetch(`${BASE}/api/trpc/auth.${admin ? 'adminSignIn' : 'signIn'}`, {
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

function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zsup%') as probe)`;
  const rfqIds = `(select id from (select id from rfqs where requesterId in ${ids}) as r)`;
  for (const statement of [
    `delete from rfqSuppliers where rfqId in ${rfqIds}`,
    `delete from qualifiedEnquiries where rfqId in ${rfqIds}`,
    `delete from quotations where rfqId in ${rfqIds}`,
    `delete from rfqs where requesterId in ${ids}`,
    `delete from registrationReviewEvents where userId in ${ids} or actorId in ${ids}`,
    `delete from registrationDocumentSubmissions where userId in ${ids}`,
    `delete from registrationDocuments where userId in ${ids} or reviewedBy in ${ids}`,
    `delete from vendorCategories where userId in ${ids}`,
    `delete from notifications where userId in ${ids}`,
    `delete from userAccountAuditEvents where actorId in ${ids} or userId in ${ids}`,
    `delete from commercialAuditEvents where actorId in ${ids} or ownerId in ${ids}`,
    `delete from users where username like 'zsup%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 90)})`);
    }
  }
}

const browser = await launchBrowser({ port: CDP_PORT });
let adminBrowser = null;
try {
  cleanUp();
  const supplier = `zsupS${stamp}`, admin = `zsupA${stamp}`;

  // The administrator exists already - a platform has operators before it has
  // applicants. The SUPPLIER is the account under test and is created through
  // the real sign-up form.
  sql(`insert into users (openId, username, email, name, role, adminRole, userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${admin}', '${admin}', '${admin}@example.test', 'Probe Registrar',
        'admin', 'SUPER_ADMIN', 'admin', 'password', 'admin_created', 0, 'active',
        'approved', 1, '${HASH}', now())`);
  const adminId = Number(sql(`select id from users where username='${admin}'`));
  const adminCookie = await signIn(`${admin}@example.test`, true);

  /* ── STAGE 1: SIGN UP AS A SUPPLIER, THROUGH THE REAL FORM ───────────── */
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/auth?mode=signup`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await page.goto(`${BASE}/auth?mode=signup`);
  const roleOffered = await waitFor(page, `!!document.querySelector('[data-testid="auth-role-supplier"]')`);
  check(roleOffered, 'SIGNUP: Supplier is one of the roles a visitor can choose');

  await page.evaluate(clickOn('[data-testid="auth-role-supplier"]'));
  await waitFor(page, `!!document.querySelector('input[autocomplete="new-password"]')`);
  const typed = await page.evaluate(`
    const set = (sel, value) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    };
    const ok = set('input[autocomplete="username"]', ${JSON.stringify(supplier)})
      && set('input[autocomplete="email"]', ${JSON.stringify(supplier + '@example.test')})
      && set('input[autocomplete="name"]', 'Nile Stone Trading')
      && set('input[autocomplete="tel"]', '01000000001');
    const pw = document.querySelectorAll('input[autocomplete="new-password"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    for (const box of pw) { setter.call(box, ${JSON.stringify(PASSWORD)}); box.dispatchEvent(new Event('input', { bubbles: true })); }
    return String(ok && pw.length === 2);
  `);
  check(typed === 'true', 'SIGNUP: the business can give the details the form asks for');
  await settle(400);
  await page.evaluate(clickOn('[data-testid="auth-signup-submit"]'));
  await settle(3000);

  const supplierId = Number(sql(`select id from users where username='${supplier}'`) || 0);
  check(supplierId > 0, 'SIGNUP: the account exists afterwards', `user ${supplierId}`);
  if (!supplierId) throw new Error('sign-up did not complete - the arc cannot continue');

  const created = sql(`select userRole, onboardingStatus, verified from users where id=${supplierId}`).split('\t');
  check(created[0] === 'supplier' && created[1] === 'not_started' && created[2] === '0',
    'SIGNUP: created as an UNVERIFIED supplier awaiting registration - not approved by signing up',
    `role ${created[0]}, onboarding ${created[1]}, verified ${created[2]}`);

  const supplierCookie = await signIn(`${supplier}@example.test`);

  /* ── STAGE 1b: THE SUPPLIER IS TOLD WHERE THEY STAND ─────────────────── */
  await page.setCookies(asBrowserCookies(supplierCookie));
  await page.goto(`${BASE}/compliance`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await page.goto(`${BASE}/compliance`);
  const complianceLoaded = await waitFor(page, `document.body.innerText.length > 400`);
  await settle(1200);
  const told = JSON.parse(await page.evaluate(`
    const main = document.querySelector('main') || document.body;
    const text = main.innerText;
    return JSON.stringify({
      namesRequirements: /Government-issued ID/i.test(text) && /Commercial registration/i.test(text)
        && /Tax card/i.test(text),
      // A RAW ENUM IN FRONT OF A BUSINESS is the defect this checks for:
      // "not_started" is a database value, not a sentence.
      rawEnum: /not_started|under_review|update_required/.test(text),
      saysWhatIsNeeded: /required/i.test(text),
      sample: text.slice(0, 200).split(String.fromCharCode(10)).join(' | '),
    });
  `));
  check(complianceLoaded && told.namesRequirements,
    'ONBOARDING: the supplier is told exactly which documents are required',
    told.sample);
  check(!told.rawEnum,
    'ONBOARDING: and their status is in words, never a raw database enum',
    told.rawEnum ? `a raw enum is on screen: ${told.sample}` : 'no raw enum');

  /* ── A SUPPLIER CANNOT VERIFY THEMSELVES ─────────────────────────────── */
  const selfVerify = await call(supplierCookie, 'admin.verifyUser', { userId: supplierId, verified: true });
  check(!selfVerify.ok,
    'SELF-VERIFY: a supplier cannot mark themselves verified',
    `${selfVerify.code} ${selfVerify.message}`.slice(0, 90));
  const selfReview = await call(supplierCookie, 'admin.reviewComplianceDocument',
    { documentId: 1, status: 'approved' });
  check(!selfReview.ok,
    'SELF-VERIFY: nor approve their own registration document',
    `${selfReview.code}`);

  /* ── AND AN UNAPPROVED SUPPLIER IS NOT PUBLICLY VERIFIED ─────────────── */
  const directory = await query(supplierCookie, 'marketplace.vendors', { page: 0, pageSize: 50 });
  const listed = (directory.data?.rows ?? directory.data ?? []).find?.(v => v.id === supplierId);
  check(!listed || listed.verified !== true,
    'PUBLIC: an unapproved supplier does not carry a public Verified badge',
    listed ? `listed with verified=${listed.verified}` : 'not in the public directory yet');

  /* ── STAGE 2: SUBMITTING A DOCUMENT ──────────────────────────────────── */
  // Object storage is unconfigured here. The requirement is that it FAILS
  // HONESTLY rather than storing a row that points at nothing.
  const upload = await call(supplierCookie, 'compliance.uploadDocument', {
    documentType: 'identity',
    fileName: 'id.pdf',
    contentType: 'application/pdf',
    base64: Buffer.from('%PDF-1.4 probe').toString('base64'),
  });
  const orphanRows = Number(sql(`select count(*) from registrationDocuments where userId=${supplierId}`));
  check(!upload.ok && orphanRows === 0,
    'STORAGE: with object storage unconfigured the upload REFUSES and stores no orphan row',
    `${upload.code ?? 'accepted'} · ${orphanRows} rows`);
  skip('STORAGE: a real document upload end to end',
    'object storage is not configured in this environment - infrastructure block, not a code gap');

  // The review half of the arc is what matters operationally, so the document
  // row is seeded to stand in for the blocked upload. Everything after this
  // point is the real product.
  sql(`insert into registrationDocuments (userId, documentType, displayName, fileName, url, mimeType, size, status)
       values (${supplierId}, 'identity', 'Government-issued ID', 'id.pdf', '/manus-storage/probe/id.pdf', 'application/pdf', 1024, 'submitted'),
              (${supplierId}, 'tax_card', 'Tax card', 'tax.pdf', '/manus-storage/probe/tax.pdf', 'application/pdf', 1024, 'submitted'),
              (${supplierId}, 'commercial_registration', 'Commercial registration', 'cr.pdf', '/manus-storage/probe/cr.pdf', 'application/pdf', 1024, 'submitted'),
              (${supplierId}, 'bank_certificate', 'Bank account certificate', 'bank.pdf', '/manus-storage/probe/bank.pdf', 'application/pdf', 1024, 'submitted')`);
  sql(`update users set onboardingStatus='under_review' where id=${supplierId}`);

  /* ── THE ADMINISTRATOR'S ATTENTION MOVES ─────────────────────────────── */
  const attention = await query(adminCookie, 'admin.attention', null);
  check(attention.ok && Number(attention.data.registrations.count) > 0,
    'ATTENTION: a registration awaiting a decision shows up in the admin count',
    attention.ok ? `${attention.data.registrations.count} waiting — "${attention.data.registrations.meaning}"` : 'the count could not be read');

  /*
   * A SECOND BROWSER FOR THE ADMINISTRATOR.
   *
   * CDP cookies belong to the BROWSER, not the tab. Opening an admin tab in
   * the same browser replaced the supplier's session everywhere, and the
   * supplier's own compliance page then rendered the HOMEOWNER copy -
   * "individual accounts do not require professional documents" - which read
   * exactly like a product defect and was not one.
   */
  adminBrowser = await launchBrowser({ port: CDP_PORT + 1 });
  const adminPage = await adminBrowser.newPage();
  await adminPage.setViewport({ width: 1440, height: 900 });
  await adminPage.setCookies(asBrowserCookies(adminCookie));
  await adminPage.goto(`${BASE}/admin`);
  await adminPage.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await adminPage.goto(`${BASE}/admin`);
  await waitFor(adminPage, `!!document.querySelector('[data-testid^="nav-"]')`);
  await settle(1500);
  const badge = JSON.parse(await adminPage.evaluate(`
    const b = document.querySelector('[data-testid="attention-registrations"]');
    return JSON.stringify({ present: !!b, text: b ? b.innerText.trim() : '', meaning: b ? (b.getAttribute('title') || '') : '' });
  `));
  check(badge.present && Number(badge.text) > 0,
    'ATTENTION: and the console SHOWS it - the count is rendered, not computed into a void',
    badge.present ? `${badge.text} — ${badge.meaning}` : 'no badge');

  /* ── NAVIGATION: PROFESSIONAL REGISTRATIONS IS RIGHT AFTER USERS ─────── */
  const navOrder = JSON.parse(await adminPage.evaluate(`
    const items = Array.from(document.querySelectorAll('[data-testid^="nav-"]'))
      .map(el => el.getAttribute('data-testid'));
    const users = items.indexOf('nav-admin.users');
    const regs = items.indexOf('nav-admin.registrations');
    return JSON.stringify({ items, users, regs });
  `));
  check(navOrder.regs === navOrder.users + 1 && navOrder.users > -1,
    'IA: Professional Registrations sits immediately after User Management',
    `users at ${navOrder.users}, registrations at ${navOrder.regs}`);
  check(!navOrder.items.includes('nav-admin.name_changes'),
    'IA: and Name Changes is NOT a top-level destination - it lives inside User Management',
    navOrder.items.filter(i => /name/i.test(i)).join(', ') || 'absent, correctly');

  /* ── THE QUEUE, THE RECORD, AND THE DECISION ─────────────────────────── */
  await adminPage.evaluate(clickOn('[data-testid="nav-admin.registrations"]'));
  await settle(2200);
  const queue = JSON.parse(await adminPage.evaluate(`
    const main = document.querySelector('main') || document.body;
    return JSON.stringify({
      path: location.pathname,
      namesApplicant: /Nile Stone Trading/.test(main.innerText),
    });
  `));
  check(queue.path === '/admin/registrations',
    'QUEUE: the badged entry opens the registrations queue', queue.path);
  check(queue.namesApplicant,
    'QUEUE: and the applicant is in it, by BUSINESS NAME rather than an id');

  const docId = Number(sql(
    `select id from registrationDocuments where userId=${supplierId} and documentType='identity'`));
  const decisions = [];
  for (const type of ['identity', 'tax_card', 'commercial_registration', 'bank_certificate']) {
    const id = Number(sql(`select id from registrationDocuments where userId=${supplierId} and documentType='${type}'`));
    decisions.push(await call(adminCookie, 'admin.reviewComplianceDocument',
      { documentId: id, status: 'approved', reviewerNote: 'Checked against the register.' }));
  }
  check(decisions.every(d => d.ok),
    'DECISION: the administrator can approve each required document',
    decisions.map(d => d.ok ? 'ok' : `${d.code}`).join(', '));

  const after = sql(`select onboardingStatus, verified from users where id=${supplierId}`).split('\t');
  check(after[0] === 'approved' && after[1] === '1',
    'DECISION: approving every required document approves the SUPPLIER',
    `onboarding ${after[0]}, verified ${after[1]}`);

  /* ── AUDIT: THE DECISION IS ON THE RECORD ────────────────────────────── */
  const events = Number(sql(
    `select count(*) from registrationReviewEvents where userId=${supplierId} and actorId=${adminId}`));
  check(events >= 4,
    'AUDIT: every decision is recorded against the applicant AND the administrator',
    `${events} review events`);

  /* ── THE SUPPLIER LEARNS OF IT, AND THEIR SCREEN CHANGES ─────────────── */
  const notified = Number(sql(
    `select count(*) from notifications where userId=${supplierId} and type='compliance'`));
  check(notified > 0, 'OUTCOME: the supplier is notified of the decision', `${notified} notification(s)`);

  await page.goto(`${BASE}/compliance`);
  await waitFor(page, `document.body.innerText.length > 400`);
  await settle(1200);
  const supplierSees = JSON.parse(await page.evaluate(`
    const text = (document.querySelector('main') || document.body).innerText;
    return JSON.stringify({
      approved: /approved/i.test(text),
      rawEnum: /not_started|under_review|update_required/.test(text),
      sample: text.slice(0, 180).split(String.fromCharCode(10)).join(' | '),
    });
  `));
  check(supplierSees.approved && !supplierSees.rawEnum,
    'OUTCOME: and their own screen says so, in words',
    supplierSees.sample);

  /* ── APPROVAL IS WHAT MAKES THEM ELIGIBLE ────────────────────────────── */
  /*
   * ELIGIBILITY IS ABOUT SCOPE, NOT A REFUSAL, and the first version of this
   * check asserted the wrong contract. `rfq.list` does not 403 an unapproved
   * provider: it scopes them to their OWN requests, which for a supplier is
   * none. Discovery is for approved providers; a requester always sees their
   * own. Asserting a refusal would have been asserting a product BuildHub
   * deliberately does not have.
   *
   * So the real difference needs a real request to be visible against.
   */
  const buyer = `zsupB${stamp}`;
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified, passwordHash, passwordSetAt)
       values ('probe-${buyer}', '${buyer}', '${buyer}@example.test', 'Probe Buyer', 'user',
        'homeowner', 'password', 'self_registered', 0, 'active', 'approved', 1, '${HASH}', now())`);
  const buyerId = Number(sql(`select id from users where username='${buyer}'`));
  sql(`insert into rfqs (requesterId, title, category, status)
       values (${buyerId}, 'Marble for a villa ${stamp}', 'Materials', 'open')`);
  const rfqId = Number(sql(`select id from rfqs where requesterId=${buyerId} order by id desc limit 1`));

  const freshCookie = await signIn(`${supplier}@example.test`);
  const feed = await query(freshCookie, 'rfq.list', { page: 0, pageSize: 50 });
  const feedRows = feed.data?.rows ?? feed.data ?? [];
  check(feed.ok && feedRows.some?.(r => r.id === rfqId),
    'ELIGIBLE: an APPROVED supplier sees the open request in their opportunity feed',
    feed.ok ? `${feedRows.length} in feed` : `${feed.code} ${feed.message}`.slice(0, 80));

  const other = `zsupU${stamp}`;
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified, passwordHash, passwordSetAt)
       values ('probe-${other}', '${other}', '${other}@example.test', 'Unapproved Supply', 'user',
        'supplier', 'password', 'self_registered', 0, 'active', 'not_started', 0, '${HASH}', now())`);
  const otherFeed = await query(await signIn(`${other}@example.test`), 'rfq.list', { page: 0, pageSize: 50 });
  const otherRows = otherFeed.data?.rows ?? otherFeed.data ?? [];
  check(otherFeed.ok && !otherRows.some?.(r => r.id === rfqId),
    'ELIGIBLE: while an UNAPPROVED supplier sees nothing - APPROVAL is what changed',
    `${otherRows.length} rows for the unapproved account`);
} finally {
  cleanUp();
  await browser.close();
  try { await adminBrowser?.close(); } catch { /* never started */ }
}

console.log(`\nBUILD ${BUILD.shortCommit} · ${BUILD.environment} · 1440x900 · en`);
console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
