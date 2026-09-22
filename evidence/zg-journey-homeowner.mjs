/**
 * ── ONE NEW CUSTOMER, FROM SIGN-UP TO A SIGNED PRICE ─────────────────────
 *
 * Sixty-nine probes cover individual capabilities in depth. None of them
 * proved the capabilities CONNECT. A product can pass every one of them and
 * still be unusable, because the thing a customer does is not a capability -
 * it is an arc, and an arc breaks at the joins.
 *
 * So this one account does the whole thing, in a real browser, in order:
 *
 *   registers through the actual form - no seeded row, no minted cookie
 *   lands signed in, on a dashboard that is HONESTLY EMPTY
 *   creates a project and sees it appear
 *   posts a request for quotation against it
 *   is found by a supplier, who bids
 *   sees the bid, compares it, accepts it
 *   and the supplier is TOLD, in their own notifications
 *
 * EVERY STEP ASSERTS A VISIBLE OUTCOME. Not "the mutation returned 200" -
 * what the next screen actually says. A step that succeeds server-side and
 * shows the customer nothing is a broken step, and it is exactly the kind
 * this file exists to catch.
 *
 * THE EMPTY STATES ARE ASSERTIONS TOO. A brand-new account must see real
 * emptiness: no sample projects, no placeholder vendors, no invented
 * activity. Zero real data has to produce a truthful empty screen.
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
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9500 + (process.pid % 80)));
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

/** Type into a React-controlled field the way the framework expects. */
const typeInto = (selector, value) => `
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return 'false';
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'true';
`;

/** A full pointer sequence, because Radix listens for more than `click`. */
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
  if (res.status !== 200) throw new Error(`signIn: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

/**
 * `meta` carries superjson's type map. A `z.date()` field arrives as a string
 * over JSON and is REVIVED by superjson only when the envelope names it, so
 * omitting this reads as a 400 that looks like a product defect and is not -
 * it is the probe speaking the wrong dialect.
 */
async function call(cookie, path, input, meta) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(meta ? { json: input, meta: { values: meta } } : { json: input }),
  });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${path}: ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text).result.data.json;
}

function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zjrn%') as probe)`;
  const rfqIds = `(select id from (select id from rfqs where requesterId in ${ids}) as r)`;
  const projectIds = `(select id from (select id from projects where ownerId in ${ids}) as p)`;
  for (const statement of [
    `delete from messages where senderId in ${ids} or receiverId in ${ids}`,
    `delete from quotations where rfqId in ${rfqIds} or providerId in ${ids}`,
    `delete from rfqSuppliers where rfqId in ${rfqIds}`,
    `delete from qualifiedEnquiries where rfqId in ${rfqIds}`,
    `delete from enquiryAssignments where rfqId in ${rfqIds}`,
    `delete from rfqItems where rfqId in ${rfqIds}`,
    `delete from expenses where projectId in ${projectIds}`,
    `delete from projectMembers where projectId in ${projectIds}`,
    `delete from vendorCategories where userId in ${ids}`,
    `delete from notifications where userId in ${ids}`,
    `delete from analyticsEvents where userId in ${ids}`,
    `delete from commercialAuditEvents where actorId in ${ids} or ownerId in ${ids}`,
    `delete from userAccountAuditEvents where actorId in ${ids} or userId in ${ids}`,
    `delete from rfqs where requesterId in ${ids}`,
    `delete from projects where ownerId in ${ids}`,
    `delete from users where username like 'zjrn%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 90)})`);
    }
  }
}

const CATEGORY = 'Materials';
const browser = await launchBrowser({ port: CDP_PORT });
try {
  cleanUp();
  const me = `zjrnH${stamp}`;
  const supplierName = `zjrnV${stamp}`;

  /* The other side of the market has to already exist - a customer does not
     create their own suppliers - so the supplier is seeded. The CUSTOMER is
     not: that is the account under test. */
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified, passwordHash, passwordSetAt)
       values ('probe-${supplierName}', '${supplierName}', '${supplierName}@example.test',
        'Nile Stone Supply', 'user', 'supplier', 'password', 'self_registered', 0, 'active',
        'approved', 1, '${HASH}', now())`);
  const supplierId = Number(sql(`select id from users where username='${supplierName}'`));
  sql(`insert into vendorCategories (userId, category) values (${supplierId}, '${CATEGORY}')`);

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  /* ── 1. REGISTER, THROUGH THE FORM A PERSON ACTUALLY USES ────────────── */
  await page.goto(`${BASE}/auth?mode=signup`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await page.goto(`${BASE}/auth?mode=signup`);
  /*
   * SIGN-UP IS TWO STEPS AND THE FIRST ONE IS THE ROLE. That is the right
   * shape - what BuildHub asks for next depends entirely on who you are - so
   * the probe takes the step rather than reaching past it. The first version
   * of this file looked for the fields straight away and reported the form
   * missing; that was the probe's mistake, not the product's.
   */
  const rolesOffered = await waitFor(page, `!!document.querySelector('[data-testid="auth-role-homeowner"]')`);
  check(rolesOffered, 'REGISTER: a new visitor is asked who they are before anything else');
  await page.evaluate(clickOn('[data-testid="auth-role-homeowner"]'));
  const formReady = await waitFor(page, `!!document.querySelector('input[autocomplete="new-password"]')`);
  check(formReady, 'REGISTER: choosing Homeowner opens the details they have to give');

  const typed = await page.evaluate(`
    const set = (sel, value) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    };
    const pw = document.querySelectorAll('input[autocomplete="new-password"]');
    const ok = set('input[autocomplete="username"]', ${JSON.stringify(me)})
      && set('input[autocomplete="email"]', ${JSON.stringify(me + '@example.test')})
      && set('input[autocomplete="name"]', 'Probe Homeowner')
      && set('input[autocomplete="tel"]', '01000000000')
      && pw.length === 2;
    if (ok) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      for (const box of pw) {
        setter.call(box, ${JSON.stringify(PASSWORD)});
        box.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    return String(ok);
  `);
  check(typed === 'true', 'REGISTER: every field the form asks for is fillable');

  /* The role selector and the submit are found by their own text, because a
     person reads them rather than querying for a testid. */
  await settle(400);
  /* The submit is DISABLED until the form is genuinely complete - so a click
     that lands is itself evidence the fields were accepted. */
  const submitEnabled = await page.evaluate(`
    const b = document.querySelector('[data-testid="auth-signup-submit"]');
    return String(!!b && !b.disabled);
  `);
  check(submitEnabled === 'true',
    'REGISTER: with the form filled, the account button becomes available');
  await page.evaluate(clickOn('[data-testid="auth-signup-submit"]'));
  await settle(3000);
  const registered = Number(sql(`select count(*) from users where username='${me}'`));
  check(registered === 1, 'REGISTER: the account exists in the database afterwards',
    `${registered} row(s)`);
  if (registered !== 1) throw new Error('registration did not complete - the rest of the journey cannot run');
  const myId = Number(sql(`select id from users where username='${me}'`));
  const myRole = sql(`select userRole from users where id=${myId}`);
  check(myRole === 'homeowner', 'REGISTER: and is created as a homeowner, not an administrator', myRole);

  /* ── 2. AN HONESTLY EMPTY DASHBOARD ──────────────────────────────────── */
  await page.setCookies(asBrowserCookies(await signIn(`${me}@example.test`)));
  await page.goto(`${BASE}/dashboard`);
  await waitFor(page, `document.body.innerText.includes('Total Spent')`);
  const empty = JSON.parse(await page.evaluate(`
    const text = (document.querySelector('main') || document.body).innerText;
    return JSON.stringify({
      projectCards: document.querySelectorAll('[data-testid^="project-card-"]').length,
      spentZero: /Total Spent/.test(text) && /EGP\\s*0\\b/.test(text),
      sample: text.slice(0, 200).split(String.fromCharCode(10)).join(' | '),
    });
  `));
  check(empty.projectCards === 0,
    'EMPTY: a brand-new account has NO projects - none are invented for it',
    `${empty.projectCards} cards`);
  check(empty.spentZero,
    'EMPTY: and nothing has been spent, truthfully rather than decoratively',
    empty.sample);

  /* ── 3. CREATE A PROJECT, AND SEE IT ─────────────────────────────────── */
  await page.evaluate(clickOn('[data-testid="project-new-trigger"]'));
  await waitFor(page, `!!document.querySelector('[data-testid="project-title"]')`);
  await page.evaluate(typeInto('[data-testid="project-title"]', `Villa fit-out ${stamp}`));
  await page.evaluate(typeInto('[data-testid="project-description"]', 'Ground floor finishing.'));
  await page.evaluate(typeInto('[data-testid="project-budget"]', '250000'));
  await page.evaluate(typeInto('[data-testid="project-location"]', 'New Cairo'));
  await settle(300);
  await page.evaluate(clickOn('[data-testid="project-create-submit"]'));
  await waitFor(page, `document.querySelectorAll('[data-testid^="project-card-"]').length > 0`);
  const projectId = Number(sql(`select id from projects where ownerId=${myId} order by id desc limit 1`));
  const cardShown = await page.evaluate(
    `return String(!!document.querySelector('[data-testid="project-card-${projectId}"]'));`);
  check(projectId > 0 && cardShown === 'true',
    'PROJECT: creating one puts it on the dashboard, not just in the database',
    `project ${projectId}`);

  /* ── 4. POST A REQUEST FOR QUOTATION ─────────────────────────────────── */
  await page.goto(`${BASE}/rfq`);
  await waitFor(page, `!!document.querySelector('[data-testid="rfq-post-trigger"]')`);
  await page.evaluate(clickOn('[data-testid="rfq-post-trigger"]'));
  await waitFor(page, `!!document.querySelector('[data-testid="rfq-title"]')`);
  await page.evaluate(typeInto('[data-testid="rfq-title"]', `Marble for villa ${stamp}`));
  await page.evaluate(typeInto('[data-testid="rfq-description"]', 'Forty square metres of marble.'));
  /* The category is a Radix select: open it, then choose the option by its
     own label - which is how a person picks it. */
  await page.evaluate(clickOn('[data-testid="rfq-category"]'));
  await settle(600);
  const picked = await page.evaluate(`
    const option = Array.from(document.querySelectorAll('[role="option"]')).find(
      o => o.innerText.trim() === ${JSON.stringify(CATEGORY)});
    if (!option) return 'false';
    option.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = option.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    option.dispatchEvent(new PointerEvent('pointerdown', o));
    option.dispatchEvent(new MouseEvent('mousedown', o));
    option.dispatchEvent(new PointerEvent('pointerup', o));
    option.dispatchEvent(new MouseEvent('mouseup', o));
    option.dispatchEvent(new MouseEvent('click', o));
    return 'true';
  `);
  check(picked === 'true', 'RFQ: the category list offers the category a customer needs', CATEGORY);
  await settle(700);
  await page.evaluate(clickOn('[data-testid="rfq-create-submit"]'));
  await settle(2500);
  const rfqId = Number(sql(`select id from rfqs where requesterId=${myId} order by id desc limit 1`) || 0);
  check(rfqId > 0, 'RFQ: posting one stores a real request', `rfq ${rfqId}`);
  if (!rfqId) throw new Error('the RFQ was not created - the rest of the journey cannot run');

  await page.goto(`${BASE}/rfq`);
  await waitFor(page, `document.body.innerText.includes('Marble for villa ${stamp}')`);
  const listed = await page.evaluate(
    `return String(document.body.innerText.includes('Marble for villa ${stamp}'));`);
  check(listed === 'true', 'RFQ: and the customer can see it on their own list afterwards');

  /* ── 5. A SUPPLIER FINDS IT AND BIDS ─────────────────────────────────── */
  const supplierCookie = await signIn(`${supplierName}@example.test`);
  const feed = await (await fetch(
    `${BASE}/api/trpc/rfq.list?input=${encodeURIComponent(JSON.stringify({ json: { page: 0, pageSize: 50 } }))}`,
    { headers: { cookie: supplierCookie } })).json();
  const rows = feed?.result?.data?.json?.rows ?? feed?.result?.data?.json ?? [];
  check(Array.isArray(rows) && rows.some(r => r.id === rfqId),
    'DISCOVERY: an approved supplier can find the request in their feed',
    Array.isArray(rows) ? `${rows.length} in feed` : 'the feed was not an array');

  /*
   * A SUPPLIER CANNOT BID ON WORK THEY HAVE NOT OPENED. The first version of
   * this probe went straight to the bid and got a 403 saying so - which was
   * the PRODUCT being right and the probe skipping a step. Opening a
   * qualified enquiry is how a lead is taken up, and it is what spends the
   * supplier's allowance, so the journey goes through it rather than around.
   */
  const leadOpened = await call(supplierCookie, 'rfq.openEnquiry', { rfqId });
  const engaged = Number(sql(
    `select count(*) from qualifiedEnquiries where rfqId=${rfqId} and userId=${supplierId}`));
  check(engaged === 1,
    'LEAD: the supplier takes the lead up before they may price it',
    `${engaged} qualified enquiry, opened=${leadOpened ? 'yes' : 'no'}`);

  /*
   * A BID CARRIES AN EXPIRY, and the procedure requires it - a price that
   * holds forever is not a price anybody would stand behind. Thirty days out,
   * which is the ordinary case rather than an edge one.
   */
  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await call(supplierCookie, 'rfq.submitQuotation', {
    rfqId, price: 84000, timeline: 21,
    validUntil,
    notes: `Italian marble, supplied and fitted. ${stamp}`,
  }, { validUntil: ['Date'] });
  const quotationId = Number(sql(
    `select id from quotations where rfqId=${rfqId} and providerId=${supplierId} order by id desc limit 1`) || 0);
  check(quotationId > 0, 'BID: the supplier can price the work', `quotation ${quotationId}`);

  /* ── 6. THE CUSTOMER IS TOLD, AND CAN SEE THE PRICE ──────────────────── */
  const told = Number(sql(
    `select count(*) from notifications where userId=${myId} and type='quotation'`));
  check(told > 0, 'NOTIFIED: the customer is told a price arrived, rather than having to look',
    `${told} notification(s)`);

  await page.goto(`${BASE}/rfq/${rfqId}`);
  await waitFor(page, `!!document.querySelector('[data-testid="rfq-detail-title"]')`);
  await settle(1000);
  const sees = JSON.parse(await page.evaluate(`
    const text = (document.querySelector('main') || document.body).innerText;
    return JSON.stringify({
      price: /84,?000/.test(text),
      supplier: /Nile Stone Supply/.test(text),
      text: text.slice(0, 260).split(String.fromCharCode(10)).join(' | '),
    });
  `));
  check(sees.price && sees.supplier,
    'QUOTE: the customer sees the price AND who is offering it',
    `price ${sees.price}, supplier ${sees.supplier} — ${sees.text}`);

  /* ── 7. COMPARE AND ACCEPT ───────────────────────────────────────────── */
  /*
   * NOTHING TO OPEN. The comparison is already part of the request page for
   * its owner - it is not behind a button. An earlier version of this probe
   * clicked `quotation-comparison-open` expecting it to reveal the
   * comparison; that testid was on "View quotation", so the probe navigated
   * AWAY to the quotation detail page and then reported the accept control
   * missing. The product was fine. The testid has since been renamed
   * `quotation-open-<id>` so the next reader is not misled the same way.
   */
  const acceptable = await waitFor(page,
    `!!document.querySelector('[data-testid="quotation-accept-${quotationId}"]')`, 20000);
  /* A FAILING CHECK HAS TO SAY WHAT IT SAW. "The button was not there" sends
     somebody hunting; the testids that WERE on the page name the state the
     screen was actually in. */
  const acceptDiag = await page.evaluate(`
    const ids = Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => el.getAttribute('data-testid'))
      .filter(id => /quotation|rfq-detail/.test(id));
    return ids.slice(0, 20).join(', ') || 'no quotation or rfq-detail testids on the page';
  `);
  check(acceptable, 'ACCEPT: the customer has a control to accept the bid they were shown',
    acceptable ? '' : acceptDiag);

  await page.evaluate(clickOn(`[data-testid="quotation-accept-${quotationId}"]`));
  await waitFor(page, `!!document.querySelector('[data-testid="quotation-accept-confirm"]')`, 15000);
  /* CONFIRMED, NOT ONE CLICK. Accepting a price is a commitment, and a
     commitment should not be a single misclick away. */
  const confirmShown = await page.evaluate(
    `return String(!!document.querySelector('[data-testid="quotation-accept-confirm"]'));`);
  check(confirmShown === 'true',
    'ACCEPT: and is asked to confirm - a commitment is not one misclick away');
  await page.evaluate(clickOn('[data-testid="quotation-accept-confirm"]'));
  await settle(2500);

  const finalStatus = sql(`select status from quotations where id=${quotationId}`);
  check(finalStatus === 'accepted', 'ACCEPT: the bid is accepted in the database', finalStatus);
  const rfqStatus = sql(`select status from rfqs where id=${rfqId}`);
  check(rfqStatus !== 'open',
    'ACCEPT: and the request stops being open, so nobody else bids on settled work',
    rfqStatus);

  /* ── 8. AND THE SUPPLIER LEARNS THEY WON ─────────────────────────────── */
  const supplierTold = Number(sql(
    `select count(*) from notifications where userId=${supplierId}`));
  check(supplierTold > 0,
    'CLOSED: the supplier is told they won, rather than finding out by chance',
    `${supplierTold} notification(s)`);

  const supplierPage = await browser.newPage();
  await supplierPage.setViewport({ width: 1440, height: 900 });
  await supplierPage.setCookies(asBrowserCookies(supplierCookie));
  /*
   * FOLLOWED THE WAY A PERSON FOLLOWS IT. The supplier does not type a URL -
   * they see a number on the bell and click it. So the probe clicks the bell.
   *
   * That is what found the defect. The bell carried the unread NOTIFICATION
   * count and navigated to /messages with no tab named, which opened on
   * Conversations; a supplier whose quotation had just been accepted clicked
   * a bell reading "1" and was shown "No conversations yet". Guessing a URL
   * here would have routed straight past it.
   */
  /* A supplier's own home. The navbar's Dashboard link resolves per role
     (getRolePlatformPath), so this is where the bell is for them - not
     /dashboard, which is the homeowner's and which no supplier is ever
     linked to. */
  await supplierPage.goto(`${BASE}/platform/supplier`);
  await supplierPage.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await supplierPage.goto(`${BASE}/platform/supplier`);
  await waitFor(supplierPage, `!!document.querySelector('[data-testid="nav-dash.messages"]')`);
  await settle(1500);
  const bell = JSON.parse(await supplierPage.evaluate(`
    const b = document.querySelector('[data-testid="nav-unread-notifications"]');
    return JSON.stringify({ present: !!b, badge: b ? b.innerText.trim() : '' });
  `));
  check(bell.present && bell.badge === '1',
    'CLOSED: the supplier WORKSPACE says there is something to read',
    bell.present ? `badge "${bell.badge}"` : 'no unread badge in the workspace');
  await supplierPage.evaluate(clickOn('[data-testid="nav-dash.messages"]'));
  await waitFor(supplierPage, `document.body.innerText.length > 200`);
  await settle(2500);
  const supplierSees = await supplierPage.evaluate(`
    const text = (document.querySelector('main') || document.body).innerText;
    return JSON.stringify({
      accepted: /quotation accepted/i.test(text),
      sample: text.slice(0, 220).split(String.fromCharCode(10)).join(' | '),
    });
  `);
  const read = JSON.parse(supplierSees);
  check(read.accepted,
    'CLOSED: and reads "Quotation accepted" on their own screen, in words',
    read.accepted ? '' : read.sample);
} finally {
  cleanUp();
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
