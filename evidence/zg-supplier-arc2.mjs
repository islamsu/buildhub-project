/**
 * ── SUPPLIER ARC 2: LISTING, DISCOVERY, AND THE FIRST SALE ──────────────
 *
 * Arc 1 got a supplier approved. This is what they do next, and it is the
 * part where a marketplace either works or is a set of screens:
 *
 *   list a product          -> it appears where buyers look
 *   a buyer finds it        -> and can act on it without reverse-engineering
 *   Add to RFQ              -> the request that arrives CONTAINS the product
 *   the supplier sees it    -> as an opportunity, not a database row
 *   opens the enquiry       -> and the allowance actually moves
 *   quotes                  -> and can revise without losing what came before
 *
 * THE FOURTH QUESTION. Every check below asks whether the OTHER PARTY sees
 * the correct consequence. A buyer's Add to RFQ has to become a supplier's
 * opportunity; a supplier's price has to become a buyer's decision. A
 * marketplace is two-sided, so a one-sided pass is not a pass.
 *
 * STOREFRONT. The supplier's public page is checked against what a mature B2B
 * storefront needs. Where a section is missing this probe FAILS rather than
 * quietly narrowing what it asks for.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);

const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (10000 + (process.pid % 60)));
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

function seedUser(username, role, onboarding, verified) {
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified, passwordHash, passwordSetAt)
       values ('probe-${username}', '${username}', '${username}@example.test', 'Probe ${username}',
        'user', '${role}', 'password', 'self_registered', 0, 'active', '${onboarding}', ${verified},
        '${HASH}', now())`);
  return Number(sql(`select id from users where username='${username}'`));
}

function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zar2%') as probe)`;
  const productIds = `(select id from (select id from products where supplierId in ${ids}) as p)`;
  const rfqIds = `(select id from (select id from rfqs where requesterId in ${ids}) as r)`;
  for (const statement of [
    `delete from productQuestionReports where questionId in (select id from (select id from productQuestions where productId in ${productIds}) as q)`,
    `delete from productQuestions where productId in ${productIds}`,
    `delete from quotations where rfqId in ${rfqIds} or providerId in ${ids}`,
    `delete from rfqItems where rfqId in ${rfqIds}`,
    `delete from rfqSuppliers where rfqId in ${rfqIds}`,
    `delete from qualifiedEnquiries where rfqId in ${rfqIds} or userId in ${ids}`,
    `delete from enquiryAssignments where rfqId in ${rfqIds}`,
    `delete from rfqs where requesterId in ${ids}`,
    `delete from vendorCategories where userId in ${ids}`,
    `delete from vendorProfiles where userId in ${ids}`,
    `delete from products where supplierId in ${ids}`,
    `delete from notifications where userId in ${ids}`,
    `delete from analyticsEvents where userId in ${ids}`,
    `delete from commercialAuditEvents where actorId in ${ids} or ownerId in ${ids}`,
    `delete from users where username like 'zar2%'`,
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
  const supplier = `zar2S${stamp}`, buyer = `zar2B${stamp}`;
  const supplierId = seedUser(supplier, 'supplier', 'approved', 1);
  const buyerId = seedUser(buyer, 'homeowner', 'approved', 1);
  sql(`insert into vendorCategories (userId, category) values (${supplierId}, '${CATEGORY}')`);
  /*
   * A REAL BUSINESS PROFILE. The storefront renders its company block only
   * when the vendor has actually filled something in - an empty card saying
   * "Company: —" four times looks broken, and inventing a company name from
   * somebody's personal name would be fabricating business data. That is the
   * product being right, and the first version of this probe asserted the
   * block unconditionally against a supplier who had filled in nothing.
   */
  sql(`insert into vendorProfiles (userId, companyName, tradingName, website)
       values (${supplierId}, 'Nile Stone Trading LLC', 'Nile Stone', 'https://example.test')`);
  const supplierCookie = await signIn(`${supplier}@example.test`);
  const buyerCookie = await signIn(`${buyer}@example.test`);

  /* ── LIST A PRODUCT, THROUGH THE REAL PROCEDURE ──────────────────────── */
  const created = await call(supplierCookie, 'marketplace.create', {
    name: `Carrara Marble Slab ${stamp}`,
    nameAr: 'بلاطة رخام كرارا',
    description: 'Italian marble, polished finish.',
    category: CATEGORY,
    brand: 'Probe Quarry',
    price: 1450,
    unit: 'm2',
    stock: 200,
    origin: 'Italy',
    warranty: '2 years',
    status: 'active',
  });
  // `a ?? b || c` is a SyntaxError in JavaScript - the two operators cannot be
  // mixed without parentheses, and the parser says so rather than guessing.
  const productId = Number((created.data?.id ?? sql(
    `select id from products where supplierId=${supplierId} order by id desc limit 1`)) || 0);
  check(created.ok && productId > 0, 'LISTING: the supplier can list a product',
    created.ok ? `product ${productId}` : `${created.code} ${created.message}`.slice(0, 90));

  /* ── AND A DRAFT DOES NOT LEAK INTO THE MARKETPLACE ──────────────────── */
  const draft = await call(supplierCookie, 'marketplace.create', {
    name: `Unfinished listing ${stamp}`, category: CATEGORY, status: 'draft',
  });
  const draftId = Number(draft.data?.id ?? 0);
  const publicList = await query(null, 'marketplace.list', { page: 0, pageSize: 100, category: CATEGORY });
  const publicRows = publicList.data?.rows ?? publicList.data ?? [];
  check(publicRows.some?.(p => p.id === productId),
    'DISCOVERY: the published product is in the public marketplace',
    `${publicRows.length} products in ${CATEGORY}`);
  check(draftId > 0 && !publicRows.some?.(p => p.id === draftId),
    'DISCOVERY: while a DRAFT is not - unfinished work is not for sale',
    draftId ? 'draft correctly absent' : 'the draft was not created');

  /* ── THE PUBLIC STOREFRONT ───────────────────────────────────────────── */
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookies(asBrowserCookies(buyerCookie));
  await page.goto(`${BASE}/vendor/${supplierId}`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await page.goto(`${BASE}/vendor/${supplierId}`);
  await waitFor(page, `document.body.innerText.length > 300`);
  await settle(1000);
  const store = JSON.parse(await page.evaluate(`
    const main = document.querySelector('main') || document.body;
    const text = main.innerText;
    const has = id => !!document.querySelector('[data-testid="' + id + '"]');
    return JSON.stringify({
      company: has('vendor-company'),
      categories: has('vendor-categories'),
      catalogue: has('vendor-catalogue'),
      listsTheProduct: text.includes('Carrara Marble Slab'),
      // What a mature B2B storefront needs and this one is checked for:
      reviews: /review/i.test(text),
      // INSIDE A TEMPLATE LITERAL a lone backslash before an ordinary letter
      // is DROPPED, so \s here would reach the browser as a plain "s" and the
      // pattern would become /gets+a?s*quote/ - matching nothing. Written
      // without escapes so it cannot be mangled on the way in.
      getQuote: /(get|request) +a? *quote/i.test(text),
      contact: has('vendor-contact') || /contact supplier/i.test(text),
      verified: /verified/i.test(text),
      // NOTHING INTERNAL. A buyer must never see compliance paperwork.
      leaksCompliance: /commercial registration|tax card|bank account certificate|registration document/i.test(text),
      leaksAdminNote: /admin note|internal note/i.test(text),
      sample: text.slice(0, 160).split(String.fromCharCode(10)).join(' | '),
      hasQuoteTestid: !!document.querySelector('[data-testid="vendor-request-quote"]'),
    });
  `));
  check(store.company && store.categories && store.catalogue && store.listsTheProduct,
    'STOREFRONT: the supplier has a public page that identifies them and lists their catalogue',
    `company ${store.company}, categories ${store.categories}, catalogue ${store.catalogue}, product ${store.listsTheProduct}`);
  check(!store.leaksCompliance && !store.leaksAdminNote,
    'STOREFRONT: and it leaks NO internal compliance paperwork or admin notes',
    store.leaksCompliance ? `compliance wording on a public page: ${store.sample}` : 'clean');
  check(store.verified,
    'STOREFRONT: an approved supplier shows their verified standing',
    store.verified ? 'shown' : 'no verification indicator on the page');
  check(store.contact,
    'STOREFRONT: a buyer can start a conversation from the page',
    store.contact ? 'a contact route exists' : 'no Contact Supplier on the storefront');
  check(store.getQuote,
    'STOREFRONT: and can ask this supplier for a price',
    store.getQuote ? 'offered' : `no Request a quote on the storefront (testid ${store.hasQuoteTestid})`);

  /*
   * ── AND THE ASK REACHES THE SUPPLIER ────────────────────────────────────
   *
   * A button that opens a form proves nothing. What matters is whether the
   * intent survives the journey: does the request that gets posted actually
   * INVITE the supplier whose page the buyer was reading, and does that
   * supplier then see it as an invitation rather than as anonymous market
   * noise?
   */

  check(store.reviews,
    'STOREFRONT: and can see what other customers said',
    store.reviews ? 'a reviews section is present' : 'no reviews or reputation section on the storefront');

  /* ── THE SOURCING JOIN: ADD TO RFQ ───────────────────────────────────── */
  await page.goto(`${BASE}/marketplace/products/${productId}`);
  await waitFor(page, `document.body.innerText.includes('Carrara Marble Slab')`);
  await settle(700);
  const added = await page.evaluate(`
    const buttons = Array.from(document.querySelectorAll('button'));
    const b = buttons.find(x => /add to rfq/i.test(x.innerText));
    if (!b) return 'missing';
    b.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = b.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    b.dispatchEvent(new PointerEvent('pointerdown', o));
    b.dispatchEvent(new MouseEvent('mousedown', o));
    b.dispatchEvent(new PointerEvent('pointerup', o));
    b.dispatchEvent(new MouseEvent('mouseup', o));
    b.dispatchEvent(new MouseEvent('click', o));
    return 'clicked';
  `);
  check(added === 'clicked', 'SOURCING: the buyer can add the product to a request from its page', added);
  await settle(900);

  /*
   * NOW BACK TO THE SUPPLIER'S PAGE, AND ASK THEM FOR A PRICE.
   *
   * The probe FOLLOWS the button rather than navigating to /rfq itself. An
   * earlier version clicked it, then re-navigated to a bare /rfq for the
   * basket step - which dropped the `invite` parameter, and the invitation
   * never landed. The probe had walked past the intent it was testing.
   */
  await page.goto(`${BASE}/vendor/${supplierId}`);
  await waitFor(page, `!!document.querySelector('[data-testid="vendor-request-quote"]')`);
  await page.evaluate(clickOn('[data-testid="vendor-request-quote"]'));
  await settle(2000);
  const landed = await page.evaluate(`return location.pathname + location.search;`);
  check(landed.startsWith('/rfq') && landed.includes(`invite=${supplierId}`),
    'STOREFRONT: the ask carries WHICH supplier to the request form',
    landed);

  /* THE BASKET REMEMBERS IT - a toast with no state is not a feature. */
  await waitFor(page, `!!document.querySelector('[data-testid="rfq-post-trigger"]')`);
  await page.evaluate(clickOn('[data-testid="rfq-post-trigger"]'));
  await waitFor(page, `!!document.querySelector('[data-testid="rfq-title"]')`);
  await settle(700);
  const basket = JSON.parse(await page.evaluate(`
    const items = Array.from(document.querySelectorAll('[data-testid="rfq-basket-item"]'));
    return JSON.stringify({
      count: items.length,
      namesProduct: items.some(i => /Carrara Marble Slab/.test(i.innerText)),
    });
  `));
  check(basket.count > 0 && basket.namesProduct,
    'SOURCING: and the request form carries it - the basket kept the product, not just a toast',
    `${basket.count} item(s), names it ${basket.namesProduct}`);

  /* ── THE REQUEST THAT ARRIVES CONTAINS THE PRODUCT ───────────────────── */
  await page.evaluate(typeIntoScript('[data-testid="rfq-title"]', `Marble supply ${stamp}`));
  await page.evaluate(typeIntoScript('[data-testid="rfq-description"]', 'Forty square metres, polished.'));
  await page.evaluate(clickOn('[data-testid="rfq-category"]'));
  await settle(600);
  await page.evaluate(`
    const option = Array.from(document.querySelectorAll('[role="option"]')).find(
      o => o.innerText.trim() === ${JSON.stringify(CATEGORY)});
    if (option) option.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return 'true';
  `);
  await settle(700);
  await page.evaluate(clickOn('[data-testid="rfq-create-submit"]'));
  await settle(2600);
  const rfqId = Number(sql(`select id from rfqs where requesterId=${buyerId} order by id desc limit 1`) || '0');
  const items = sql(`select count(*) from rfqItems where rfqId=${rfqId} and productId=${productId}`);
  check(rfqId > 0 && items === '1',
    'SOURCING: the submitted request CONTAINS the product the buyer added',
    `rfq ${rfqId}, ${items} matching item(s)`);

  /* ── THE INVITATION IS REAL, NOT A TOAST ─────────────────────────────── */
  const invited = Number(sql(
    `select count(*) from rfqSuppliers where rfqId=${rfqId} and supplierId=${supplierId}`));
  check(invited === 1,
    'INVITATION: the supplier whose page the buyer was reading IS invited to the request',
    `${invited} invitation row(s)`);
  const invitedTold = Number(sql(
    `select count(*) from notifications where userId=${supplierId}`));
  check(invitedTold > 0,
    'INVITATION: and is told about it rather than having to go looking',
    `${invitedTold} notification(s)`);

  /* ── THE SUPPLIER SEES AN OPPORTUNITY ────────────────────────────────── */
  const feed = await query(supplierCookie, 'rfq.list', { page: 0, pageSize: 50 });
  const feedRows = feed.data?.rows ?? feed.data ?? [];
  check(feedRows.some?.(r => r.id === rfqId),
    'OPPORTUNITY: the supplier sees the request in their feed',
    `${feedRows.length} in feed`);

  /* ── AN INVITED LEAD IS FREE, AND THAT IS A DECISION ─────────────────── */
  //
  // An invitation is the buyer NAMING this firm, so it bypasses the allowance
  // and deliberately writes no usage row - charging for it, or recording it as
  // consumption, would make the supplier's usage say they spent something they
  // did not. The invitation row carries the record instead.
  //
  // An earlier version of this probe asserted the UNINVITED contract against
  // an invited supplier and read a correct, documented decision as a defect.
  const beforeInvited = await query(supplierCookie, 'billing.myEnquiryUsage', null);
  const openInvited = await call(supplierCookie, 'rfq.openEnquiry', { rfqId });
  const afterInvited = await query(supplierCookie, 'billing.myEnquiryUsage', null);
  check(openInvited.ok && Number(afterInvited.data?.used) === Number(beforeInvited.data?.used),
    'ENTITLEMENT: opening a lead the buyer INVITED them to costs no credit',
    `opened ${openInvited.ok}, used ${beforeInvited.data?.used} -> ${afterInvited.data?.used}`);

  /* ── AN UNINVITED LEAD DOES COST ONE ─────────────────────────────────── */
  sql(`insert into rfqs (requesterId, title, category, status)
       values (${buyerId}, 'Open market marble ${stamp}', '${CATEGORY}', 'open')`);
  const openRfqId = Number(sql(
    `select id from rfqs where requesterId=${buyerId} order by id desc limit 1`) || '0');
  const beforeOpen = await query(supplierCookie, 'billing.myEnquiryUsage', null);
  const openLead = await call(supplierCookie, 'rfq.openEnquiry', { rfqId: openRfqId });
  const engaged = Number(sql(
    `select count(*) from qualifiedEnquiries where rfqId=${openRfqId} and userId=${supplierId}`));
  check(openLead.ok && engaged === 1,
    'ENQUIRY: taking up a lead nobody invited them to records the engagement',
    `opened ${openLead.ok}, ${engaged} qualified enquiry`);

  const afterOpen = await query(supplierCookie, 'billing.myEnquiryUsage', null);
  const usedBefore = beforeOpen.data?.used ?? null;
  const usedAfter = afterOpen.data?.used ?? null;
  check(usedBefore !== null && usedAfter !== null && Number(usedAfter) === Number(usedBefore) + 1,
    'ENTITLEMENT: and THAT moves the allowance - one lead found, one credit',
    `used ${usedBefore} -> ${usedAfter}`);

  /* ── OPENING IT TWICE DOES NOT CHARGE TWICE ──────────────────────────── */
  const again = await call(supplierCookie, 'rfq.openEnquiry', { rfqId: openRfqId });
  const afterAgain = await query(supplierCookie, 'billing.myEnquiryUsage', null);
  const usedAgain = afterAgain.data?.used ?? null;
  check(usedAgain !== null && Number(usedAgain) === Number(usedAfter),
    'ENTITLEMENT: opening the same lead again does not charge a second credit',
    `used stayed at ${usedAgain} (retry ${again.ok ? 'accepted' : again.code})`);

  /* ── THE QUOTATION, AND A REVISION THAT KEEPS ITS HISTORY ────────────── */
  const validUntil = new Date(Date.now() + 30 * 86400000).toISOString();
  const quoted = await call(supplierCookie, 'rfq.submitQuotation', {
    rfqId, price: 62000, timeline: 21, warranty: '2 years', validUntil,
    notes: 'Supplied and fitted.',
  }, { validUntil: ['Date'] });
  const quotationId = Number(sql(
    `select id from quotations where rfqId=${rfqId} and providerId=${supplierId} order by id desc limit 1`) || '0');
  check(quoted.ok && quotationId > 0, 'QUOTATION: the supplier can price the work',
    quoted.ok ? `quotation ${quotationId}` : `${quoted.code} ${quoted.message}`.slice(0, 90));

  const noExpiry = await call(supplierCookie, 'rfq.submitQuotation', { rfqId, price: 100 });
  check(!noExpiry.ok,
    'QUOTATION: a price with no expiry is refused - nobody stands behind a bid that holds forever',
    `${noExpiry.code ?? 'accepted'}`);

  const revised = await call(supplierCookie, 'rfq.submitQuotation', {
    rfqId, price: 58000, timeline: 18, warranty: '2 years', validUntil,
    notes: 'Revised after a site visit.',
  }, { validUntil: ['Date'] });
  const current = sql(`select price, revisionNumber from quotations where rfqId=${rfqId}
                        and providerId=${supplierId} and status <> 'superseded'
                        order by id desc limit 1`).split('\t');
  const allRevisions = Number(sql(
    `select count(*) from quotations where rfqId=${rfqId} and providerId=${supplierId}`));
  check(revised.ok && Number(current[0]) === 58000,
    'REVISION: a revised price becomes the current one',
    `current ${current[0]}, revision ${current[1]}`);
  check(allRevisions >= 2,
    'REVISION: and the price it replaced is still on the record - history is not overwritten',
    `${allRevisions} quotation rows for this supplier on this request`);

  /* ── A RIVAL CANNOT READ THE PRICE ───────────────────────────────────── */
  const rival = `zar2R${stamp}`;
  const rivalId = seedUser(rival, 'supplier', 'approved', 1);
  sql(`insert into vendorCategories (userId, category) values (${rivalId}, '${CATEGORY}')`);
  const rivalCookie = await signIn(`${rival}@example.test`);
  const peek = await query(rivalCookie, 'rfq.quotations', { rfqId });
  const peeked = peek.data?.rows ?? peek.data ?? [];
  const sawRival = Array.isArray(peeked) && peeked.some(q => Number(q.price) === 58000);
  check(!sawRival,
    'PRIVACY: a rival supplier cannot read the price on the board',
    sawRival ? 'a competitor can see the bid' : `${peek.ok ? `${peeked.length} rows, none theirs` : peek.code}`);
} finally {
  cleanUp();
  await browser.close();
  try { await supplierBrowser?.close(); } catch { /* never started */ }
}

function typeIntoScript(selector, value) {
  return `
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'false';
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'true';
  `;
}

console.log(`\nBUILD ${BUILD.shortCommit} · ${BUILD.environment} · 1440x900 · en`);
console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
