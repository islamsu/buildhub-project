/**
 * ── SUPPLIER ARC 3: WITHDRAWAL, DECISION, AND WHAT EACH SIDE SEES ───────
 *
 * Arc 2 got a price onto the board. This is what happens to it, and every
 * check asks the fourth question: CAN THE OTHER PARTY SEE THE CORRECT
 * CONSEQUENCE? A marketplace is two-sided, so a one-sided pass is not a pass.
 *
 *   the supplier withdraws        -> the buyer stops seeing a live price
 *   the buyer accepts             -> the supplier learns they won
 *   the supplier follows the link -> and lands on the thing it is about
 *   either side messages          -> the other side is told, and can reply
 *   the supplier's dashboard      -> reflects work that actually happened
 *
 * AND THE NEGATIVES, because an authorization that only works when nobody
 * pushes is not an authorization:
 *
 *   an ACCEPTED price cannot be withdrawn - walking away from an agreement
 *     is a dispute, not a state change
 *   a rival cannot withdraw somebody else's price
 *   somebody else's quotation is NOT_FOUND, never FORBIDDEN - no oracle
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);

const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (10100 + (process.pid % 60)));
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
async function call(cookie, path, input, meta) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(meta ? { json: input, meta: { values: meta } } : { json: input }),
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
    { headers: cookie ? { cookie } : {} });
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    if (res.status === 200) return { ok: true, data: parsed.result.data.json };
    return { ok: false, code: parsed?.error?.json?.data?.code ?? null, message: parsed?.error?.json?.message ?? '' };
  } catch { return { ok: false, code: null, message: text.slice(0, 160) }; }
}
function seedUser(username, role) {
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified, passwordHash, passwordSetAt)
       values ('probe-${username}', '${username}', '${username}@example.test', 'Probe ${username}',
        'user', '${role}', 'password', 'self_registered', 0, 'active', 'approved', 1, '${HASH}', now())`);
  return Number(sql(`select id from users where username='${username}'`));
}
function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zar3%') as probe)`;
  const rfqIds = `(select id from (select id from rfqs where requesterId in ${ids}) as r)`;
  for (const statement of [
    `delete from messages where senderId in ${ids} or receiverId in ${ids}`,
    `delete from quotations where rfqId in ${rfqIds} or providerId in ${ids}`,
    `delete from rfqItems where rfqId in ${rfqIds}`,
    `delete from rfqSuppliers where rfqId in ${rfqIds}`,
    `delete from qualifiedEnquiries where rfqId in ${rfqIds} or userId in ${ids}`,
    `delete from enquiryAssignments where rfqId in ${rfqIds}`,
    `delete from rfqs where requesterId in ${ids}`,
    `delete from vendorCategories where userId in ${ids}`,
    `delete from notifications where userId in ${ids}`,
    `delete from commercialAuditEvents where actorId in ${ids} or ownerId in ${ids}`,
    `delete from users where username like 'zar3%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 90)})`);
    }
  }
}

const CATEGORY = 'Materials';
const browser = await launchBrowser({ port: CDP_PORT });
let supplierBrowser = null;
try {
  cleanUp();
  const supplier = `zar3S${stamp}`, rival = `zar3R${stamp}`, buyer = `zar3B${stamp}`;
  const supplierId = seedUser(supplier, 'supplier');
  const rivalId = seedUser(rival, 'supplier');
  const buyerId = seedUser(buyer, 'homeowner');
  for (const id of [supplierId, rivalId]) {
    sql(`insert into vendorCategories (userId, category) values (${id}, '${CATEGORY}')`);
  }
  const supplierCookie = await signIn(`${supplier}@example.test`);
  const rivalCookie = await signIn(`${rival}@example.test`);
  const buyerCookie = await signIn(`${buyer}@example.test`);

  const validUntil = new Date(Date.now() + 30 * 86400000).toISOString();
  const makeRfq = async title => {
    sql(`insert into rfqs (requesterId, title, category, status)
         values (${buyerId}, '${title} ${stamp}', '${CATEGORY}', 'open')`);
    return Number(sql(`select id from rfqs where requesterId=${buyerId} order by id desc limit 1`));
  };
  const bid = async (cookie, rfqId, price) => {
    await call(cookie, 'rfq.openEnquiry', { rfqId });
    return call(cookie, 'rfq.submitQuotation',
      { rfqId, price, timeline: 20, validUntil, notes: 'Probe bid' }, { validUntil: ['Date'] });
  };

  /* ── WITHDRAWAL ──────────────────────────────────────────────────────── */
  const rfqA = await makeRfq('Withdrawable request');
  await bid(supplierCookie, rfqA, 50000);
  const quoteA = Number(sql(
    `select id from quotations where rfqId=${rfqA} and providerId=${supplierId} order by id desc limit 1`));
  check(quoteA > 0, 'SETUP: a live price on the board', `quotation ${quoteA}`);

  const strangerWithdraw = await call(rivalCookie, 'rfq.withdrawQuotation',
    { quotationId: quoteA, reason: 'Not mine.' });
  check(!strangerWithdraw.ok && strangerWithdraw.code === 'NOT_FOUND',
    'WITHDRAW: somebody else\'s price is NOT_FOUND, never FORBIDDEN - no oracle',
    `${strangerWithdraw.code ?? 'accepted'}`);

  const withdrew = await call(supplierCookie, 'rfq.withdrawQuotation',
    { quotationId: quoteA, reason: 'Material cost moved.' });
  const statusA = sql(`select status from quotations where id=${quoteA}`);
  check(withdrew.ok && statusA === 'withdrawn',
    'WITHDRAW: a supplier can take their own price off the table',
    `status ${statusA}`);

  // AND THE BUYER STOPS SEEING A LIVE PRICE. A withdrawn bid that still shows
  // an Accept button is worse than no withdrawal at all.
  const buyerPage = await browser.newPage();
  await buyerPage.setViewport({ width: 1440, height: 900 });
  await buyerPage.setCookies(asBrowserCookies(buyerCookie));
  await buyerPage.goto(`${BASE}/rfq/${rfqA}`);
  await buyerPage.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await buyerPage.goto(`${BASE}/rfq/${rfqA}`);
  await waitFor(buyerPage, `!!document.querySelector('[data-testid="rfq-detail-title"]')`);
  await settle(1200);
  const buyerSeesWithdrawn = JSON.parse(await buyerPage.evaluate(`
    const text = (document.querySelector('main') || document.body).innerText;
    return JSON.stringify({
      saysWithdrawn: /withdrawn/i.test(text),
      canStillAccept: !!document.querySelector('[data-testid="quotation-accept-${quoteA}"]'),
    });
  `));
  check(buyerSeesWithdrawn.saysWithdrawn,
    'WITHDRAW: and the buyer is told it was withdrawn rather than left guessing',
    buyerSeesWithdrawn.saysWithdrawn ? 'stated' : 'the page says nothing about it');
  check(!buyerSeesWithdrawn.canStillAccept,
    'WITHDRAW: and cannot accept a price that is no longer offered',
    buyerSeesWithdrawn.canStillAccept ? 'the Accept control is still live' : 'correctly gone');

  /* ── AN ACCEPTED PRICE IS AN AGREEMENT ───────────────────────────────── */
  const rfqB = await makeRfq('Accepted request');
  await bid(supplierCookie, rfqB, 47000);
  const quoteB = Number(sql(
    `select id from quotations where rfqId=${rfqB} and providerId=${supplierId} order by id desc limit 1`));
  const accepted = await call(buyerCookie, 'rfq.acceptQuotation', { quotationId: quoteB, rfqId: rfqB });
  check(accepted.ok && sql(`select status from quotations where id=${quoteB}`) === 'accepted',
    'DECISION: the buyer accepts a price', accepted.ok ? 'accepted' : `${accepted.code} ${accepted.message}`);

  const lateWithdraw = await call(supplierCookie, 'rfq.withdrawQuotation',
    { quotationId: quoteB, reason: 'Changed my mind.' });
  check(!lateWithdraw.ok && lateWithdraw.code === 'CONFLICT',
    'WITHDRAW: an ACCEPTED price cannot be withdrawn - that is a dispute, not a state change',
    `${lateWithdraw.code ?? 'accepted'} ${lateWithdraw.message}`.slice(0, 100));
  check(/dispute/i.test(lateWithdraw.message ?? ''),
    'WITHDRAW: and the refusal names the process that DOES apply',
    (lateWithdraw.message ?? '').slice(0, 90));

  /* ── THE SUPPLIER LEARNS THEY WON, AND THE LINK GOES SOMEWHERE ───────── */
  const won = sql(`select link from notifications where userId=${supplierId}
                     and title like '%accept%' order by id desc limit 1`);
  check(won.length > 0,
    'CONSEQUENCE: the supplier is told their price was accepted', won || 'no notification');

  supplierBrowser = await launchBrowser({ port: CDP_PORT + 1 });
  const supplierPage = await supplierBrowser.newPage();
  await supplierPage.setViewport({ width: 1440, height: 900 });
  await supplierPage.setCookies(asBrowserCookies(supplierCookie));
  await supplierPage.goto(`${BASE}${won || '/messages?tab=notifications'}`);
  await supplierPage.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await supplierPage.goto(`${BASE}${won || '/messages?tab=notifications'}`);
  await waitFor(supplierPage, `document.body.innerText.length > 300`);
  await settle(1200);
  const landing = JSON.parse(await supplierPage.evaluate(`
    const text = (document.querySelector('main') || document.body).innerText;
    return JSON.stringify({
      path: location.pathname,
      notFound: /not found|does not exist|404/i.test(text),
      aboutThisWork: /Accepted request|${stamp}/.test(text),
      sample: text.slice(0, 150).split(String.fromCharCode(10)).join(' | '),
    });
  `));
  check(!landing.notFound,
    'DEEP LINK: the notification lands somewhere real, not on a dead route',
    `${landing.path} — ${landing.sample}`);
  check(landing.aboutThisWork,
    'DEEP LINK: and on the thing the notification is actually about',
    landing.aboutThisWork ? landing.path : `${landing.path} shows something else`);

  /* ── MESSAGING, BOTH DIRECTIONS ──────────────────────────────────────── */
  const sent = await call(buyerCookie, 'messages.send',
    { receiverId: supplierId, content: `When can you start? ${stamp}` });
  check(sent.ok, 'MESSAGING: the buyer can contact the supplier they chose',
    sent.ok ? 'sent' : `${sent.code} ${sent.message}`);

  await supplierPage.goto(`${BASE}/platform/supplier`);
  await waitFor(supplierPage, `!!document.querySelector('[data-testid="nav-dash.messages"]')`);
  await settle(1500);
  const unread = JSON.parse(await supplierPage.evaluate(`
    const b = document.querySelector('[data-testid="nav-unread-notifications"]');
    return JSON.stringify({ present: !!b, count: b ? b.innerText.trim() : '' });
  `));
  check(unread.present && Number(unread.count) > 0,
    'MESSAGING: the supplier WORKSPACE shows there is something to read',
    unread.present ? `badge ${unread.count}` : 'no unread indicator in the workspace');

  await supplierPage.evaluate(clickOn('[data-testid="nav-dash.messages"]'));
  await waitFor(supplierPage, `document.body.innerText.length > 300`);
  await settle(2000);
  const conversation = await supplierPage.evaluate(`
    return String(document.body.innerText.includes('When can you start'));
  `);
  check(conversation === 'true',
    'MESSAGING: following the badge opens the conversation it was counting');

  const replied = await call(supplierCookie, 'messages.send',
    { receiverId: buyerId, content: `We can start Monday. ${stamp}` });
  const buyerThread = await query(buyerCookie, 'messages.list', { otherUserId: supplierId });
  const buyerSawReply = (buyerThread.data?.messages ?? []).some?.(m => /start Monday/.test(m.content ?? ''));
  check(replied.ok && buyerSawReply,
    'MESSAGING: the supplier replies and the BUYER sees it - both directions close',
    `replied ${replied.ok}, buyer sees it ${buyerSawReply}`);

  /* ── THE DASHBOARD REFLECTS WORK THAT HAPPENED ───────────────────────── */
  await supplierPage.goto(`${BASE}/platform/supplier`);
  await waitFor(supplierPage, `document.body.innerText.length > 400`);
  await settle(1500);
  /*
   * READ THE STAT CARD AS A CARD, not by slicing backwards through innerText.
   * The first version matched digits behind the label in a flattened string;
   * the dashboard was correct and the extractor was not. A stat tile is a
   * label element with its value beside it - so find the label and read its
   * sibling, which is what a person's eye does.
   */
  const dashboard = JSON.parse(await supplierPage.evaluate(`
    const main = document.querySelector('main') || document.body;
    const labels = Array.from(main.querySelectorAll('p, span, div'));
    const labelEl = labels.find(el => el.children.length === 0
      && el.innerText.trim().toLowerCase() === 'my quotations');
    let value = null;
    if (labelEl && labelEl.parentElement) {
      const numeric = Array.from(labelEl.parentElement.querySelectorAll('p, span, div'))
        .map(el => el.innerText.trim())
        .find(t => /^[0-9]+$/.test(t));
      if (numeric !== undefined) value = Number(numeric);
    }
    return JSON.stringify({
      quotations: value,
      foundLabel: !!labelEl,
      sample: main.innerText.slice(0, 200).split(String.fromCharCode(10)).join(' | '),
    });
  `));
  const realQuotations = Number(sql(
    `select count(*) from quotations where providerId=${supplierId}`));
  check(dashboard.quotations !== null && dashboard.quotations === realQuotations,
    'DASHBOARD: the supplier workspace counts the quotations they really submitted',
    `dashboard ${dashboard.quotations}, database ${realQuotations}, label found ${dashboard.foundLabel}`);
} finally {
  cleanUp();
  await browser.close();
  try { await supplierBrowser?.close(); } catch { /* never started */ }
}

console.log(`\nBUILD ${BUILD.shortCommit} · ${BUILD.environment} · 1440x900 · en`);
console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
