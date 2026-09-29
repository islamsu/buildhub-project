/**
 * ── THE SHORTLIST REACHES THE REQUEST ───────────────────────────────────
 *
 * CLAUDE.md §6: a capability is not a product journey. Can the user find it,
 * can they complete it, does the next part of the product know it happened,
 * and can the other party see the correct consequence?
 *
 * The Saved page's primary action navigated to `/rfq` and nothing else. The
 * buyer arrived at an EMPTY create form and the suppliers and products they
 * had shortlisted were left behind on the page they came from. Every piece
 * worked; nothing connected them, and it looked finished from either end.
 *
 * WHAT IS PROVED HERE, end to end, in a real browser against real rows:
 *
 *   the buyer selects from their shortlist and presses ONE button
 *   the request form opens carrying the product as a basket LINE
 *   and NAMES the suppliers it is about to invite, before submission
 *   posting it writes real rfqItems and real rfqSuppliers rows
 *   THE SUPPLIER SEES IT - the invitation lands in their Opportunity Centre
 *   unticking an item leaves it behind, which is what makes the tick mean
 *     anything
 *
 * The last one is the control. A page that carries everything regardless of
 * the checkboxes passes every other check here.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9700 + (process.pid % 80)));
const PASSWORD = 'LocalSuperAdmin!2024';
const BUYER = 'zid6507832req@example.test';
const SUPPLIER = 'zid6507832vnd@example.test';

const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();
const num = q => Number(sql(q) || '0');

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
async function signIn(identifier) {
  const res = await fetch(`${BASE}/api/trpc/auth.signIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`signIn ${identifier}: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}
async function query(cookie, path, input) {
  const url = `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input ?? null }))}`;
  const res = await fetch(url, { headers: cookie ? { cookie } : {} });
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.result?.data?.json, message: body?.error?.json?.message };
}
async function call(cookie, path, input) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ json: input }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(page, expression, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(`return (${expression});`)) return true;
    await settle(250);
  }
  return false;
}
const clickOn = selector => `
  const el = document.querySelector('${selector}');
  if (!el) return false;
  el.click();
  return true;
`;

console.log(`\nBUILD ${BUILD.shortCommit ?? '?'}  env=${BUILD.environment ?? '?'}\n`);

const buyerCookie = await signIn(BUYER);
const buyerId = num(`SELECT id FROM users WHERE email='${BUYER}'`);
const supplierId = num(`SELECT id FROM users WHERE email='${SUPPLIER}'`);
check(buyerId > 0 && supplierId > 0, 'a buyer and an approved supplier exist', `#${buyerId} / #${supplierId}`);
check(sql(`SELECT onboardingStatus FROM users WHERE id=${supplierId}`) === 'approved',
  'the supplier is approved, so an invitation to them can be answered');

/* Two live products, so the control below has something to leave behind. */
const productIds = sql(`SELECT id FROM products WHERE status='active' ORDER BY id DESC LIMIT 2`)
  .split('\n').map(Number).filter(Boolean);
check(productIds.length === 2, 'two live products to shortlist', productIds.join(', '));

const TITLE = `ZG shortlist carry ${Date.now()}`;
let createdRfqId = 0;
try {
  /* ── THE SHORTLIST ──────────────────────────────────────────────────── */
  for (const productId of productIds) {
    await call(buyerCookie, 'profile.toggleSaved', { kind: 'product', itemId: productId });
  }
  await call(buyerCookie, 'profile.toggleSaved', { kind: 'provider', itemId: supplierId });
  const shortlist = await query(buyerCookie, 'profile.savedItems');
  const savedProducts = (shortlist.data?.items ?? [])
    .filter(item => item.itemKind === 'product');
  const savedProductIds = savedProducts.map(item => Number(item.target.id));
  /*
   * THE NAMES, because the basket renders NAMES.
   *
   * The first version of the control below searched the basket's text for
   * the product's ID and asserted it was absent. The basket has never
   * rendered an id, so the string was never there and the check passed
   * whatever the page did - it SURVIVED the exact mutation it exists to
   * catch (a page that ignores the checkboxes entirely).
   */
  const nameOf = id => {
    const found = savedProducts.find(item => Number(item.target.id) === id);
    return String(found?.target?.name ?? '');
  };
  check(productIds.every(id => savedProductIds.includes(id)),
    'both products and the supplier are on the shortlist',
    `${savedProductIds.length} products`);

  const browser = await launchBrowser({ port: CDP_PORT });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1200 });
    await page.setCookies(asBrowserCookies(buyerCookie));
    await page.goto(`${BASE}/saved`);

    const listed = await waitFor(page,
      `document.querySelector('[data-testid="saved-request-quotes"]') !== null`);
    check(listed, 'the shortlist renders with its primary action');

    /* ── THE CONTROL: UNTICK ONE PRODUCT ─────────────────────────────────
       Without this, a page that ignores the checkboxes entirely passes
       every other check in this file. */
    const untickTarget = productIds[1];
    const unticked = await page.evaluate(clickOn(`[data-testid="saved-pick-product-${untickTarget}"]`));
    check(unticked === true, 'a product can be left out of the request', `#${untickTarget}`);
    await settle(600);
    const summary = await page.evaluate(`
      const el = document.querySelector('[data-testid="saved-selection-summary"]');
      return el ? el.innerText.trim() : 'MISSING';
    `);
    check(/1 product/.test(String(summary)),
      'and the action reports the narrowed selection, not the whole list', String(summary));

    /* ── ONE BUTTON ──────────────────────────────────────────────────── */
    await page.evaluate(clickOn('[data-testid="saved-request-quotes"]'));
    const arrived = await waitFor(page, `location.pathname === '/rfq'`);
    check(arrived, 'pressing it reaches the request form',
      await page.evaluate(`return location.pathname + location.search;`));

    const carriedUrl = await page.evaluate(`return location.search;`);
    check(/invite=/.test(String(carriedUrl)) && /basket=/.test(String(carriedUrl)),
      'CARRYING BOTH: the basket flag and the invitation', String(carriedUrl));
    check(String(carriedUrl).includes(`invite=${supplierId}`),
      'and the invitation names the supplier that was ticked', String(carriedUrl));

    /* ── THE FORM SAYS WHAT IT IS CARRYING ───────────────────────────── */
    const dialogOpen = await waitFor(page,
      `document.querySelector('[data-testid="rfq-invite-carry"]') !== null`);
    check(dialogOpen, 'the form opens and NAMES the invitation it will send');
    const carryText = await page.evaluate(`
      const el = document.querySelector('[data-testid="rfq-invite-carry"]');
      return el ? el.innerText.trim() : 'MISSING';
    `);
    check(carryText !== 'MISSING' && !/#\\d+$/.test(String(carryText).split('\\n')[1] ?? ''),
      "by name, not by raw id - it is on the buyer's own shortlist",
      String(carryText).split('\\n').slice(0, 2).join(' | '));
    check(/in addition to that, not instead of it/i.test(String(carryText)),
      'and does not let the buyer think it narrows who can see the request');

    const basketText = await page.evaluate(`
      const el = document.querySelector('[data-testid="rfq-basket"]');
      return el ? el.innerText.trim() : 'MISSING';
    `);
    const keptName = nameOf(productIds[0]);
    const droppedName = nameOf(untickTarget);
    check(keptName.length > 0 && droppedName.length > 0 && keptName !== droppedName,
      'the two products have distinct names, so the control below can tell them apart',
      `${keptName} / ${droppedName}`);
    check(basketText !== 'MISSING' && String(basketText).includes(keptName),
      'the ticked product arrived as a basket line, BY NAME', keptName);
    check(basketText !== 'MISSING' && !String(basketText).includes(droppedName),
      'AND THE UNTICKED ONE DID NOT - the checkbox means something', droppedName);
    const renderedLines = await page.evaluate(`
      const card = document.querySelector('[data-testid="rfq-basket"]');
      if (!card) return -1;
      return card.querySelectorAll('[data-testid="rfq-basket-item"]').length;
    `);
    // A count as well as a name: if the basket ever stopped rendering names
    // the assertions above would go quiet rather than fail.
    check(renderedLines === 1,
      'and the basket holds exactly one line', String(renderedLines));

    /* ── POST IT ─────────────────────────────────────────────────────── */
    await page.evaluate(`
      const setValue = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const inputs = Array.from(document.querySelectorAll('input, textarea'));
      const title = inputs.find(el => el.tagName === 'INPUT' && !el.type.match(/date|number|file|checkbox/));
      const body = document.querySelector('textarea');
      if (title) setValue(title, ${JSON.stringify(TITLE)});
      if (body) setValue(body, 'Carried from the shortlist by the automated journey probe.');
      return Boolean(title && body);
    `);
    await settle(500);

    /* THE CATEGORY IS REQUIRED, and it is a Radix Select: open it, then pick
       the first real option. Typing into it does nothing. */
    await page.evaluate(clickOn('[data-testid="rfq-category"]'));
    await settle(800);
    const picked = await page.evaluate(`
      const option = document.querySelector('[role="option"]');
      if (!option) return 'NO-OPTIONS';
      const label = option.textContent;
      option.click();
      return label;
    `);
    check(picked !== 'NO-OPTIONS', 'a category can be chosen', String(picked));
    await settle(800);

    /* BY TESTID, NOT BY LABEL TEXT. The first version matched any enabled
       button whose text contained "post" and clicked the trigger that OPENS
       the dialog - so it reported a successful submission of a request that
       was never sent, and only the missing database row caught it. */
    const submitState = await page.evaluate(`
      const el = document.querySelector('[data-testid="rfq-create-submit"]');
      if (!el) return 'MISSING';
      if (el.disabled) return 'DISABLED';
      el.click();
      return 'CLICKED';
    `);
    check(submitState === 'CLICKED', 'the request can be posted from the carried form', String(submitState));

    /* ── THE DATABASE KNOWS IT HAPPENED ──────────────────────────────── */
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && createdRfqId === 0) {
      createdRfqId = num(`SELECT id FROM rfqs WHERE title=${JSON.stringify(TITLE).replace(/"/g, "'")} ORDER BY id DESC LIMIT 1`);
      if (createdRfqId === 0) await settle(700);
    }
    check(createdRfqId > 0, 'a real request row exists', `#${createdRfqId}`);

    if (createdRfqId > 0) {
      await settle(2500);
      const itemCount = num(`SELECT COUNT(*) FROM rfqItems WHERE rfqId=${createdRfqId}`);
      check(itemCount === 1, 'with exactly the ONE line that was ticked', `${itemCount} rfqItems`);
      const carriedProduct = num(`SELECT COUNT(*) FROM rfqItems WHERE rfqId=${createdRfqId} AND productId=${productIds[0]}`);
      check(carriedProduct === 1, 'and it is the product the buyer kept', `product #${productIds[0]}`);
      const leftBehind = num(`SELECT COUNT(*) FROM rfqItems WHERE rfqId=${createdRfqId} AND productId=${untickTarget}`);
      check(leftBehind === 0, 'the unticked product is genuinely absent from the record');

      const invited = num(`SELECT COUNT(*) FROM rfqSuppliers WHERE rfqId=${createdRfqId} AND supplierId=${supplierId}`);
      check(invited === 1, 'A REAL INVITATION ROW EXISTS - not a toast', `${invited} rfqSuppliers`);

      /* ── AND THE OTHER PARTY SEES THE CONSEQUENCE (§6) ─────────────── */
      const supplierCookie = await signIn(SUPPLIER);
      const opportunities = await query(supplierCookie, 'rfq.queue',
        { page: 0, pageSize: 100, scope: 'opportunities' });
      const row = (opportunities.data?.rows ?? []).find(r => Number(r.rfqId) === createdRfqId);
      check(row !== undefined,
        'THE SUPPLIER SEES IT IN THEIR OPPORTUNITY CENTRE - the journey completes');
      check(row?.responseState === 'invited',
        'as an invitation they have not yet taken', String(row?.responseState));
      check(row?.source === 'invitation',
        'and it says WHY it reached them', String(row?.source));
      check(row?.free === true,
        'opening it costs them nothing, because an invitation is allowance-exempt',
        String(row?.free));
    }
  } finally {
    await browser.close().catch(() => {});
  }
} finally {
  if (createdRfqId > 0) {
    sql(`DELETE FROM rfqSuppliers WHERE rfqId=${createdRfqId}`);
    sql(`DELETE FROM rfqItems WHERE rfqId=${createdRfqId}`);
    sql(`DELETE FROM rfqs WHERE id=${createdRfqId}`);
    console.log(`\n(cleanup) removed probe RFQ #${createdRfqId}: ${num(`SELECT COUNT(*) FROM rfqs WHERE id=${createdRfqId}`) === 0 ? 'gone' : 'STILL PRESENT'}`);
  }
  sql(`DELETE FROM savedItems WHERE userId=${buyerId} AND itemId IN (${[...productIds, supplierId].join(',')})`);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
