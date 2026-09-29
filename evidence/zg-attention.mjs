/**
 * ── THE CONSOLE SAYS WHAT IS WAITING ────────────────────────────────────
 *
 * The owner's complaint: "Vendor Enquiries does not highlight that there are
 * NEW Vendor Enquiries." An administrator had to open the page to find out
 * whether it needed them, which means a queue is only attended to by somebody
 * who already suspected it needed attending to.
 *
 * WHAT IS PROVED HERE, in a rendered console rather than in a query:
 *
 * WHAT AN ENQUIRY IS, since the first version of this probe got it wrong.
 * The queue is not "every vendor whose categories match an open request" - it
 * is the pairs that have actually ENGAGED: an invitation was sent, a credit
 * was spent opening the lead, or a bid was submitted. Creating a request and a
 * matching vendor therefore produces no enquiry at all, and the badge that
 * correctly stayed empty was reported as broken. The setup below invites.
 *
 *   0 waiting     no badge at all - an empty queue is not decorated
 *   1 waiting     a badge appears, reading 1
 *   many waiting  the badge counts them, exactly
 *   assigned      taking one off the pile takes it off the badge
 *   the link      clicking opens the queue, filtered to what was counted
 *   survives      a refresh does not change it: it is server state, not local
 *   AN OUTAGE     is NOT rendered as zero
 *
 * THE LAST ONE IS THE POINT OF THE WHOLE FILE. A console that shows no badges
 * when the count failed is telling an administrator every queue is clear.
 * That is the most dangerous thing it can say, and it is the easiest to ship
 * by accident, because "render nothing on error" looks like good manners.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';

/* WHICH BUILD THIS RAN AGAINST. Printed always; enforced when
   ZG_EXPECT_COMMIT names one, so a pass can never be reported against
   a build somebody did not mean to test. */
await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9300 + (process.pid % 80)));
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
  const res = await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`adminSignIn: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

/** What the sidebar shows for the enquiries queue, right now. */
/** Any attention badge, sidebar or tab, read the same way. */
const badgeReader = testid => `
  const b = document.querySelector('[data-testid="${testid}"]');
  return JSON.stringify({
    present: !!b,
    state: b ? b.getAttribute('data-attention-state') : null,
    count: b ? b.getAttribute('data-attention-count') : null,
    text: b ? b.innerText.trim() : '',
    meaning: b ? (b.getAttribute('title') || '') : '',
  });
`;

const BADGE = `
  const b = document.querySelector('[data-testid="attention-enquiries"]');
  return JSON.stringify({
    present: !!b,
    state: b ? b.getAttribute('data-attention-state') : null,
    count: b ? b.getAttribute('data-attention-count') : null,
    text: b ? b.innerText.trim() : '',
    meaning: b ? (b.getAttribute('title') || '') : '',
  });
`;

function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zatt%') as probe)`;
  const rfqIds = `(select id from (select id from rfqs where requesterId in ${ids}) as r)`;
  for (const statement of [
    `delete from enquiryAssignments where rfqId in ${rfqIds}`,
    `delete from qualifiedEnquiries where rfqId in ${rfqIds}`,
    `delete from rfqSuppliers where rfqId in ${rfqIds}`,
    `delete from quotations where rfqId in ${rfqIds}`,
    `delete from vendorNameChangeRequests where userId in ${ids} or reviewerId in ${ids}`,
    `delete from vendorCategories where userId in ${ids}`,
    `delete from analyticsEvents where userId in ${ids}`,
    `delete from notifications where userId in ${ids}`,
    `delete from userAccountAuditEvents where actorId in ${ids} or userId in ${ids}`,
    `delete from commercialAuditEvents where actorId in ${ids} or ownerId in ${ids}`,
    `delete from rfqs where requesterId in ${ids}`,
    `delete from users where username like 'zatt%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 80)})`);
    }
  }
}

const CATEGORY = 'Materials';
const browser = await launchBrowser({ port: CDP_PORT });
try {
  cleanUp();
  const a = `zattA${stamp}`, b = `zattB${stamp}`, v = `zattV${stamp}`;
  sql(`insert into users (openId, username, email, name, role, adminRole, userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${a}', '${a}', '${a}@example.test', 'Probe Attention', 'admin',
        'SUPER_ADMIN', 'admin', 'password', 'admin_created', 0, 'active', 'approved', 1,
        '${HASH}', now())`);
  for (const [name, role] of [[b, 'homeowner'], [v, 'supplier']]) {
    sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
          accountSource, isDummy, accountStatus, onboardingStatus, verified)
         values ('probe-${name}', '${name}', '${name}@example.test', 'Probe ${name}', 'user',
          '${role}', 'password', 'self_registered', 0, 'active', 'approved', 1)`);
  }
  const adminId = Number(sql(`select id from users where username='${a}'`));
  const buyerId = Number(sql(`select id from users where username='${b}'`));
  const vendorId = Number(sql(`select id from users where username='${v}'`));
  sql(`insert into vendorCategories (userId, category) values (${vendorId}, '${CATEGORY}')`);
  check(adminId > 0 && buyerId > 0 && vendorId > 0, 'SETUP: an admin, a buyer and a supplier');

  const page = await browser.newPage();
  await page.setCookies(asBrowserCookies(await signIn(`${a}@example.test`)));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/admin`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");

  /* ── NOTHING WAITING ─────────────────────────────────────────────────── */
  const baselineCount = Number(JSON.parse(await (await fetch(
    `${BASE}/api/trpc/admin.attention?input=${encodeURIComponent('{"json":null}')}`,
    { headers: { cookie: await signIn(`${a}@example.test`) } })).text())
    .result.data.json.enquiries.count);

  await page.goto(`${BASE}/admin`);
  await waitFor(page, `!!document.querySelector('[data-testid^="nav-"]')`);
  await settle(1200);
  const empty = JSON.parse(await page.evaluate(BADGE));
  if (baselineCount === 0) {
    check(!empty.present, 'EMPTY: with nothing waiting there is no badge at all',
      empty.present ? `a badge reading ${empty.text}` : 'no badge');
  } else {
    check(empty.present && empty.count === String(baselineCount),
      'BASELINE: the badge matches the server count', `${empty.text} vs ${baselineCount}`);
  }

  /* ── ONE WAITING ─────────────────────────────────────────────────────── */
  sql(`insert into rfqs (requesterId, title, category, status)
       values (${buyerId}, 'Attention probe one', '${CATEGORY}', 'open')`);
  const rfq1 = Number(sql(`select id from rfqs where requesterId=${buyerId} order by id desc limit 1`));
  sql(`insert into rfqSuppliers (rfqId, supplierId, invitedBy, status)
       values (${rfq1}, ${vendorId}, ${buyerId}, 'invited')`);
  await page.goto(`${BASE}/admin`);
  await waitFor(page, `!!document.querySelector('[data-testid="attention-enquiries"]')`);
  const one = JSON.parse(await page.evaluate(BADGE));
  check(one.present && one.count === String(baselineCount + 1),
    'ONE: a new enquiry raises the badge', `${one.text} (was ${baselineCount})`);
  check(one.state === 'waiting' && one.meaning.length > 0,
    'and the badge says WHAT it is counting', one.meaning);

  /* ── SEVERAL WAITING ─────────────────────────────────────────────────── */
  sql(`insert into rfqs (requesterId, title, category, status) values
        (${buyerId}, 'Attention probe two', '${CATEGORY}', 'open'),
        (${buyerId}, 'Attention probe three', '${CATEGORY}', 'open')`);
  const extra = sql(`select id from rfqs where requesterId=${buyerId} and id <> ${rfq1} order by id`).split('\n').map(Number);
  for (const id of extra) {
    sql(`insert into rfqSuppliers (rfqId, supplierId, invitedBy, status)
         values (${id}, ${vendorId}, ${buyerId}, 'invited')`);
  }
  await page.goto(`${BASE}/admin`);
  await waitFor(page, `!!document.querySelector('[data-testid="attention-enquiries"]')`);
  const many = JSON.parse(await page.evaluate(BADGE));
  check(many.count === String(baselineCount + 3), 'MANY: the badge counts them exactly',
    `${many.text} (expected ${baselineCount + 3})`);

  /* ── A CLOSED REQUEST IS NOT WAITING FOR ANYONE ──────────────────────── */
  sql(`update rfqs set status='closed' where id=${rfq1}`);
  await page.goto(`${BASE}/admin`);
  await settle(1500);
  const afterClose = JSON.parse(await page.evaluate(BADGE));
  check(afterClose.count === String(baselineCount + 2),
    'CLOSED: a closed request stops counting as waiting',
    `${afterClose.text} (expected ${baselineCount + 2})`);
  sql(`update rfqs set status='open' where id=${rfq1}`);

  /* ── ASSIGNING ONE TAKES IT OFF THE PILE ─────────────────────────────── */
  sql(`insert into enquiryAssignments (rfqId, vendorId, assigneeId, actorId, note)
       values (${rfq1}, ${vendorId}, ${adminId}, ${adminId}, 'probe')`);
  await page.goto(`${BASE}/admin`);
  await settle(1500);
  const assigned = JSON.parse(await page.evaluate(BADGE));
  check(assigned.count === String(baselineCount + 2),
    'ASSIGNED: taking one takes it off the badge',
    `${assigned.text} (expected ${baselineCount + 2})`);

  /* ── AND RELEASING IT PUTS IT BACK, because the table is append-only ─── */
  sql(`insert into enquiryAssignments (rfqId, vendorId, assigneeId, actorId, note)
       values (${rfq1}, ${vendorId}, NULL, ${adminId}, 'released')`);
  await page.goto(`${BASE}/admin`);
  await settle(1500);
  const released = JSON.parse(await page.evaluate(BADGE));
  check(released.count === String(baselineCount + 3),
    'RELEASED: unassigning puts it back - the latest event wins, not the first',
    `${released.text} (expected ${baselineCount + 3})`);

  /* ── THE BADGE SURVIVES A RELOAD, because it is server state ─────────── */
  await page.goto(`${BASE}/admin`);
  await waitFor(page, `!!document.querySelector('[data-testid="attention-enquiries"]')`);
  const reloaded = JSON.parse(await page.evaluate(BADGE));
  check(reloaded.count === released.count, 'REFRESH: the count survives a reload',
    `${reloaded.text}`);

  /* ── AND CLICKING IT OPENS THE QUEUE ─────────────────────────────────── */
  await page.evaluate(`
    const el = document.querySelector('[data-testid="nav-admin.enquiries"]');
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
    return true;
  `);
  await settle(1800);
  const landed = await page.evaluate("return location.pathname;");
  check(landed === '/admin/enquiries', 'CLICK: the badged entry opens the enquiries queue', landed);
  /*
   * ── NAME CHANGES: THE QUEUE THE OWNER COULD NOT FIND ────────────────────
   *
   * The count existed on the server and was rendered nowhere. Correcting a
   * vendor's legal or trading name is identity administration, so the queue
   * is a TAB inside User Management rather than a destination of its own -
   * which means the sidebar entry that owns the tab has to carry the number,
   * and the tab itself has to repeat it. A sidebar badge that sends an
   * administrator to a user directory with nothing waiting on it would be a
   * worse lie than no badge at all.
   *
   * Both numbers come from one procedure, so the two cannot drift apart.
   */
  const nameBase = Number(sql(
    `select count(*) from vendorNameChangeRequests where status in ('pending','under_review','needs_information')`));

  sql(`insert into vendorNameChangeRequests (userId, field, currentValue, requestedValue, reason, status)
       values (${vendorId}, 'tradingName', 'Probe ${v}', 'Probe ${v} Trading', 'probe', 'pending')`);
  const nameReqId = Number(sql(`select id from vendorNameChangeRequests where userId=${vendorId} order by id desc limit 1`));

  await page.goto(`${BASE}/admin`);
  await waitFor(page, `!!document.querySelector('[data-testid="attention-nameChanges"]')`);
  const nameSidebar = JSON.parse(await page.evaluate(badgeReader('attention-nameChanges')));
  check(nameSidebar.present && nameSidebar.count === String(nameBase + 1),
    'NAME CHANGES: User Management carries the count, so the queue is findable',
    `${nameSidebar.text} (expected ${nameBase + 1})`);
  check(nameSidebar.state === 'waiting' && /name change/i.test(nameSidebar.meaning),
    'and the badge says it is name changes it is counting, not users',
    nameSidebar.meaning);

  /* THE TAB REPEATS IT, so following the badge lands on the work. */
  await page.goto(`${BASE}/admin/users`);
  await waitFor(page, `!!document.querySelector('[data-testid="users-tab-name-changes"]')`);
  await settle(1200);
  const nameTab = JSON.parse(await page.evaluate(badgeReader('tab-attention-nameChanges')));
  check(nameTab.present && nameTab.count === nameSidebar.count,
    'NAME CHANGES: and the tab inside User Management shows the SAME number',
    `tab ${nameTab.text} vs sidebar ${nameSidebar.text}`);

  /* AND THE TAB OPENS THE QUEUE ITSELF, not a page about it. */
  await page.evaluate(`
    const el = document.querySelector('[data-testid="users-tab-name-changes"]');
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
    return true;
  `);
  await settle(1800);
  const queueShown = await page.evaluate(`
    const main = document.querySelector('main') || document.body;
    return String(main.innerText.includes('Probe ${v} Trading'));
  `);
  check(queueShown === 'true',
    'NAME CHANGES: clicking the badged tab shows the actual pending request',
    queueShown === 'true' ? 'the requested name is on screen' : 'the request is not listed');

  /* DECIDING IT CLEARS BOTH, because both read the same open-state set. */
  sql(`update vendorNameChangeRequests set status='approved', reviewerId=${adminId}, reviewedAt=now() where id=${nameReqId}`);
  await page.goto(`${BASE}/admin/users`);
  await waitFor(page, `!!document.querySelector('[data-testid="users-tab-name-changes"]')`);
  await settle(1500);
  const nameAfter = JSON.parse(await page.evaluate(badgeReader('attention-nameChanges')));
  const tabAfter = JSON.parse(await page.evaluate(badgeReader('tab-attention-nameChanges')));
  const expectAfter = nameBase === 0 ? 'no badge' : String(nameBase);
  /*
   * A CLEARED BADGE ONLY MEANS SOMETHING IF IT WAS THERE. Without the first
   * clause this check passes on a build that never renders either badge at
   * all, which is the exact defect it is meant to catch.
   */
  check(nameSidebar.present && nameTab.present
        && (nameBase === 0 ? !nameAfter.present : nameAfter.count === String(nameBase))
        && (nameBase === 0 ? !tabAfter.present : tabAfter.count === String(nameBase)),
    'NAME CHANGES: deciding the request clears the badge in BOTH places',
    `sidebar ${nameAfter.present ? nameAfter.text : 'none'}, tab ${tabAfter.present ? tabAfter.text : 'none'} (expected ${expectAfter})`);

  /*
   * ── AND AN OUTAGE IS NOT ZERO ───────────────────────────────────────────
   *
   * The whole point. With the database unreachable the console must not
   * quietly drop its badges: that renders exactly like "every queue is clear",
   * and an administrator acts on it by not looking.
   *
   * The database is stopped for a few seconds and restarted in the finally
   * below whatever happens, because leaving it down would break every probe
   * after this one.
   */
  try {
    execSync('service mariadb stop', { stdio: 'ignore' });
    await settle(1500);
    await page.goto(`${BASE}/admin`);
    // The nav is shell, not data - it renders whether or not the queries work.
    await waitFor(page, `!!document.querySelector('[data-testid^="nav-"]')`, 15000);
    // Then give the count query time to exhaust its retries and settle.
    await waitFor(page, `!!document.querySelector('[data-testid="attention-enquiries"]')`, 20000);
    const outage = JSON.parse(await page.evaluate(BADGE));
    const shown = JSON.parse(await page.evaluate(`
      return JSON.stringify({
        navs: document.querySelectorAll('[data-testid^="nav-"]').length,
        unavailable: !!document.querySelector('[data-testid="admin-auth-unavailable"]'),
        marketing: /Build Your Future with BuildHub/i.test(document.body.innerText),
        text: document.body.innerText.slice(0, 100).split(String.fromCharCode(10)).join(' | '),
      });
    `));
    /*
     * THE BIGGER FINDING. With the database down the console rendered the
     * PUBLIC MARKETING HOME: the admin guard read `!isAuthenticated` as "not
     * signed in" when it is also true for "could not be checked", and hard
     * redirected an administrator out of their own console mid-investigation.
     */
    check(!shown.marketing,
      'OUTAGE: an administrator is NOT thrown out to the public site',
      shown.marketing ? `the marketing page rendered: ${shown.text}` : 'stayed in the console');
    check(shown.unavailable,
      'OUTAGE: and is told the session could not be checked, with a retry',
      shown.unavailable ? 'the unavailable panel is shown' : shown.text);
    /*
     * The badge itself is only reachable when the console renders at all, so
     * it is asserted only in that case - and the console not rendering is the
     * finding above rather than a silent pass here.
     */
    if (shown.navs > 0) {
      check(outage.present && outage.state === 'unknown',
        'OUTAGE: the badge says UNKNOWN rather than nothing',
        outage.present ? `"${outage.text}" (${outage.state})` : 'no badge - reads as "nothing waiting"');
    }
  } finally {
    execSync('service mariadb start', { stdio: 'ignore' });
    for (let i = 0; i < 20; i++) {
      try { sql('select 1'); break; } catch { await settle(1000); }
    }
  }
} finally {
  cleanUp();
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
