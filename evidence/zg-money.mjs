/**
 * ── A NUMBER IS NOT A PRICE UNTIL IT SAYS WHICH CURRENCY ────────────────
 *
 * The owner asked for ONE instance of this to be fixed: an RFQ budget in the
 * supplier's enquiry queue rendered `{t('common.egp')} {budget}`, a hard-coded
 * Egyptian pound label on a number whose currency the RFQ record states. That
 * one was fixed. A census then found THIRTEEN MORE, on the quotation list, the
 * RFQ list, both project surfaces, both homeowner dashboards and a supplier's
 * public catalogue - every one of them rendering a record that carried its own
 * `currency` column.
 *
 * TWO OF THEM WERE WORSE THAN A LABEL. "Total Budget" and "Total Spent" read
 *
 *   `EGP ${projects.reduce((sum, p) => sum + Number(p.budget))}`
 *
 * Adding every project's budget is only a total while every project is in one
 * currency. This probe creates the case that breaks it - one project in EGP,
 * one in SAR, owned by the same buyer - and reads what the dashboard renders.
 *
 * WHY A DIRECT INSERT. Only Egypt is enabled in shared/markets.ts, and
 * `projects.create` refuses a market that is not, which is the guardrail
 * working. The row is inserted directly because the defect being tested is in
 * the READ path, and a buyer who holds a legacy or a future non-EGP project
 * must not be shown it in pounds. Both rows are removed afterwards and the
 * removal is proved.
 */
import { execSync } from 'node:child_process';
import { assertBuild } from './lib/build.mjs';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const PASSWORD = 'LocalSuperAdmin!2024';
const BUYER = 'zid6507832req@example.test';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? 9081);

const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();
const num = q => Number(sql(q) || '0');

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(page, expression, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(`return (${expression});`)) return true;
    await settle(250);
  }
  return false;
}

async function signIn(identifier) {
  const res = await fetch(`${BASE}/api/trpc/auth.signIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`signIn ${identifier}: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

const buyerId = num(`SELECT id FROM users WHERE email='${BUYER}'`);
check(buyerId > 0, 'the test buyer exists', `#${buyerId}`);

const TAG = `zgmoney${Date.now()}`;
let egpId = 0, sarId = 0;
const browser = await launchBrowser({ port: CDP_PORT });

try {
  /* ── Two projects, two currencies, one owner ────────────────────────────
   *
   * The amounts are deliberately far apart so the ordering rule - largest
   * first - is observable, and neither is a round number that could coincide
   * with something already on the account.
   */
  sql(`INSERT INTO projects (ownerId, title, description, status, marketCode, currency, budget, progress)
       VALUES (${buyerId}, '${TAG} Cairo tower', 'EGP project', 'active', 'EG', 'EGP', 1750000.00, 10)`);
  egpId = num(`SELECT id FROM projects WHERE title='${TAG} Cairo tower'`);
  sql(`INSERT INTO projects (ownerId, title, description, status, marketCode, currency, budget, progress)
       VALUES (${buyerId}, '${TAG} Riyadh villa', 'SAR project', 'active', 'SA', 'SAR', 4200000.00, 20)`);
  sarId = num(`SELECT id FROM projects WHERE title='${TAG} Riyadh villa'`);
  check(egpId > 0 && sarId > 0, 'two projects exist, one EGP and one SAR', `#${egpId} / #${sarId}`);
  check(sql(`SELECT currency FROM projects WHERE id=${sarId}`) === 'SAR',
    'and the SAR project really stores SAR, not the column default');

  const cookie = await signIn(BUYER);
  const page = await browser.newPage();
  /* A warm-up navigation first: localStorage on a fresh tab's about:blank
     origin throws SecurityError, which would kill the run before assertion 1. */
  await page.goto(`${BASE}/`);
  await page.setCookies(asBrowserCookies(cookie));

  /* ═══ THE HOMEOWNER DASHBOARD ═══ */

  await page.goto(`${BASE}/dashboard`);
  const loaded = await waitFor(page, `document.body.innerText.includes('${TAG} Riyadh villa')`);
  check(loaded, 'the buyer dashboard lists both projects');

  /*
   * SMALL ELEMENTS ONLY. A first attempt collected every div and span whose
   * text mentioned two currencies, and the winner was the page wrapper - which
   * contains the nav, both tiles and both project rows, so "both currencies in
   * one element" and "the larger one first" were true of the whole document
   * and proved nothing. A KPI tile's own text is short; an ancestor's is not.
   */
  const dash = await page.evaluate(`
    const short = Array.from(document.querySelectorAll('div,span,p'))
      .map(node => (node.textContent || '').trim())
      .filter(text => text.length > 0 && text.length < 80);
    return {
      text: document.body.innerText,
      tiles: short.filter(text => /^(EGP|SAR|AED)\\s/.test(text) || /^(EGP|SAR)[^·]*·[^·]*(EGP|SAR)/.test(text)),
    };
  `);

  check(/SAR/.test(dash.text), 'SAR appears on the dashboard at all', 'the label follows the record');
  check(/EGP/.test(dash.text), 'and EGP still appears for the Egyptian project');

  /* THE TOTAL. It must present both currencies, and it must not present their
     arithmetic sum - 1,750,000 + 4,200,000 = 5,950,000 - under one label. */
  const summed = /5,950,000|5\.95M|5,95/.test(dash.text.replace(/\s/g, ''));
  check(!summed, 'the budget tile does NOT add EGP to SAR', summed ? 'a summed figure is rendered' : 'no summed figure');
  const bothInOneTile = dash.tiles.some(text => /SAR/.test(text) && /EGP/.test(text));
  check(bothInOneTile, 'it states one total per currency in the same tile',
    dash.tiles.find(text => /SAR/.test(text) && /EGP/.test(text))?.slice(0, 60) ?? 'not found');

  /* Largest first: SAR 4.2M leads EGP 1.75M. */
  const tile = dash.tiles.find(text => /SAR/.test(text) && /EGP/.test(text)) ?? '';
  check(tile.indexOf('SAR') < tile.indexOf('EGP'), 'with the largest total first', tile.slice(0, 60));

  /* The per-project row names each project's own currency. */
  const rows = await page.evaluate(`
    const cards = Array.from(document.querySelectorAll('*'))
      .filter(node => node.children.length === 0 && /Budget|الميزانية/.test(node.textContent || ''));
    return cards.map(node => (node.textContent || '').trim()).slice(0, 12);
  `);
  check(rows.some(text => /SAR/.test(text)), 'the SAR project row is denominated in SAR',
    rows.find(text => /SAR/.test(text))?.slice(0, 60) ?? rows.join(' | ').slice(0, 80));
  check(rows.some(text => /EGP/.test(text)), 'and the EGP project row in EGP');

  /* NOTHING says "EGP" about the Saudi project. This is the actual defect: a
     4.2 million riyal budget rendered as 4.2 million pounds. */
  /*
   * THE SMALLEST element that still contains the whole project row, found by
   * text length rather than by child count. `children.length < 12` picked an
   * ancestor holding the nav and both tiles, so the check was reading the
   * page and calling it the row.
   */
  const sarRowSaysEgp = await page.evaluate(`
    const candidates = Array.from(document.querySelectorAll('div,li,article'))
      .filter(element => (element.textContent || '').includes('${TAG} Riyadh villa'))
      .filter(element => /Budget|الميزانية/.test(element.textContent || ''))
      .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    const node = candidates[0];
    if (!node) return null;
    return { egp: /EGP/.test(node.textContent || ''), text: (node.textContent || '').trim().slice(0, 120) };
  `);
  check(sarRowSaysEgp !== null && sarRowSaysEgp.egp === false,
    'the Saudi project row is nowhere labelled in Egyptian pounds',
    sarRowSaysEgp === null ? 'row not found' : sarRowSaysEgp.text);

  /* ═══ THE PROJECT PAGE ═══ */

  await page.goto(`${BASE}/projects/${sarId}`);
  await waitFor(page, `document.body.innerText.includes('${TAG} Riyadh villa')`);
  const detail = await page.evaluate('return document.body.innerText;');
  check(/SAR/.test(detail), 'the SAR project page is denominated in SAR');
  check(!/EGP/.test(detail), 'and says nothing about Egyptian pounds', detail.match(/.{0,30}EGP.{0,20}/)?.[0] ?? 'clean');

  /* ═══ ARABIC ═══ */

  await page.evaluate(`localStorage.setItem('buildhub_lang', 'ar'); return true;`);
  await page.goto(`${BASE}/projects/${sarId}`);
  await waitFor(page, `document.documentElement.dir === 'rtl'`);
  const arabic = await page.evaluate('return document.body.innerText;');
  check(/SAR/.test(arabic), 'Arabic keeps the ISO code rather than a symbol that is ambiguous across markets');
  check(!/جنيه/.test(arabic), 'and never calls a riyal a pound', arabic.match(/.{0,20}جنيه.{0,20}/)?.[0] ?? 'clean');
  await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);

  /* ═══ THE RFQ BASKET, WHICH CAN SPAN MARKETS ═══
   *
   * The subtotal read `Catalogue value: EGP ${subtotal}` over a sum of every
   * line's price. A basket holds whatever suppliers the buyer picked, each
   * with its own products.currency, so that number was two currencies added
   * as one unit under a label the view chose. The basket lives in
   * localStorage, so the two-currency case is seeded directly.
   */
  await page.goto(`${BASE}/rfq`);
  await settle(1500);
  await page.evaluate(`
    const items = [
      { productId: 9001, name: 'Cairo rebar', variantLabel: null, quantity: 2,
        unit: 'tonne', specifications: null, unitPrice: 1000, currency: 'EGP' },
      { productId: 9002, name: 'Riyadh cement', variantLabel: null, quantity: 3,
        unit: 'tonne', specifications: null, unitPrice: 500, currency: 'SAR' },
    ];
    localStorage.setItem('bh-rfq-basket', JSON.stringify(items));
    return true;
  `);
  await page.goto(`${BASE}/rfq`);
  /* The basket is reviewed inside the Post RFQ dialog, not on the page behind
     it - so it has to be opened before there is anything to read. */
  await waitFor(page, `!!document.querySelector('[data-testid="rfq-post-trigger"]')`);
  const count = await page.evaluate(
    `const node = document.querySelector('[data-testid="rfq-basket-count"]');
     return node ? node.textContent.trim() : null;`);
  check(count === '2', 'the trigger shows the two collected lines', count ?? 'no badge');
  await page.evaluate(`document.querySelector('[data-testid="rfq-post-trigger"]').click(); return true;`);
  const seeded = await waitFor(page, `!!document.querySelector('[data-testid="rfq-basket-subtotal"]')`);
  check(seeded, 'the seeded basket renders its catalogue value inside the dialog');
  if (seeded) {
    const subtotal = await page.evaluate(
      `return document.querySelector('[data-testid="rfq-basket-subtotal"]').textContent.trim();`);
    check(/EGP/.test(subtotal) && /SAR/.test(subtotal),
      'the basket states one catalogue value per currency', subtotal);
    /* 2×1000 EGP + 3×500 SAR = 3,500 only if you add pounds to riyals. */
    check(!/3,500|3500/.test(subtotal), 'and does not add pounds to riyals', subtotal);
    check(/not a quotation|ليس عرض سعر/.test(subtotal),
      'and still says it is not a quotation', subtotal);
  }
  await page.evaluate(`localStorage.removeItem('bh-rfq-basket'); return true;`);

  /* ═══ A SERVICE PRICE RANGE ═══
   *
   * Two identical local formatters spelled the currency `ar ? 'ج.م' : 'EGP'`.
   * 'ج.م' reads as a pound in more than one market in this region, which is
   * why the canonical formatter shows the ISO code.
   */
  {
    const providerId = num(
      "SELECT id FROM users WHERE onboardingStatus = 'approved' AND accountStatus = 'active'"
      + " AND userRole IN ('supplier','vendor','contractor','engineer','architect') ORDER BY id LIMIT 1");
    const categoryId = num('SELECT id FROM productCategories ORDER BY id LIMIT 1');
    let offeringId = 0;
    try {
      if (providerId > 0 && categoryId > 0) {
        /* A PRICED SERVICE, created for this check because the database had
           none. Removed below, and the removal is proved. */
        sql(`INSERT INTO serviceOfferings (providerId, categoryId, title, description,
               pricingBasis, priceMin, priceMax, status)
             VALUES (${providerId}, ${categoryId}, '${TAG} waterproofing', 'probe fixture',
               'per_square_metre', 120.00, 260.00, 'active')`);
        offeringId = num(`SELECT id FROM serviceOfferings WHERE title='${TAG} waterproofing'`);
      }
      check(offeringId > 0, 'a priced service offering exists to render', `#${offeringId}`);

      await page.goto(`${BASE}/vendor/${providerId}`);
      await waitFor(page, `document.body.innerText.includes('${TAG} waterproofing')`);
      const storefront = await page.evaluate('return document.body.innerText;');
      check(/120/.test(storefront) && /260/.test(storefront),
        'the storefront shows the range the provider entered');
      check(!/ج\.م/.test(storefront),
        'and no longer uses the ambiguous pound symbol',
        storefront.match(/.{0,25}ج\.م.{0,15}/)?.[0] ?? 'clean');
      check(/EGP/.test(storefront), 'it names the ISO currency code instead');

      /* Arabic too: the old formatter swapped in 'ج.م' for Arabic only, so
         English alone would not have caught it. */
      await page.evaluate(`localStorage.setItem('buildhub_lang', 'ar'); return true;`);
      await page.goto(`${BASE}/vendor/${providerId}`);
      await waitFor(page, `document.documentElement.dir === 'rtl'`);
      await waitFor(page, `document.body.innerText.includes('${TAG} waterproofing')`);
      const arabicStorefront = await page.evaluate('return document.body.innerText;');
      check(!/ج\.م/.test(arabicStorefront), 'in Arabic as well, which is where it used to appear',
        arabicStorefront.match(/.{0,25}ج\.م.{0,15}/)?.[0] ?? 'clean');
      check(/EGP/.test(arabicStorefront), 'and Arabic shows the same ISO code');
      await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
    } finally {
      if (offeringId) sql(`DELETE FROM serviceOfferings WHERE id=${offeringId}`);
      check(num(`SELECT COUNT(*) FROM serviceOfferings WHERE title LIKE '${TAG}%'`) === 0,
        'the service fixture is removed');
    }
  }

  /* ═══ THE TILE WITH NOTHING TO TOTAL ═══
   *
   * §10: a fresh account has no budget. "EGP 0" is a figure in a currency it
   * has never transacted in, which is an invented fact, so the tile shows a
   * dash. Checked by looking at a freshly created account's own dashboard.
   */
  {
    const fresh = `zgmoneyfresh${Date.now()}`;
    const res = await fetch(`${BASE}/api/trpc/auth.signUp`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: {
        username: fresh, email: `${fresh}@example.test`, password: PASSWORD,
        name: 'Fresh Buyer', userRole: 'homeowner',
      } }),
    });
    check(res.status === 200, 'a genuinely fresh buyer account can be created', `HTTP ${res.status}`);
    const freshCookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
    const freshPage = await browser.newPage();
    await freshPage.goto(`${BASE}/`);
    await freshPage.setCookies(asBrowserCookies(freshCookie));
    await freshPage.goto(`${BASE}/dashboard`);
    await settle(3500);
    const freshText = await freshPage.evaluate('return document.body.innerText;');
    check(!/EGP\s*0\b/.test(freshText) && !/EGP\s*0\.00/.test(freshText),
      'a fresh account is shown no zero in a currency it has never used',
      freshText.match(/.{0,20}EGP.{0,10}/)?.[0] ?? 'no EGP figure');
    /*
     * SIGNING UP MINTS A REFERRAL CODE, and 0057's lifecycle table records the
     * event with the new account as its actor. Deleting the account first hits
     * that foreign key - which is the constraint doing its job - so the audit
     * row goes first.
     */
    const freshId = num(`SELECT id FROM users WHERE email='${fresh}@example.test'`);
    sql(`DELETE FROM referralCodeEvents WHERE actorId=${freshId} OR userId=${freshId}`);
    sql(`DELETE FROM users WHERE id=${freshId}`);
    check(num(`SELECT COUNT(*) FROM users WHERE email='${fresh}@example.test'`) === 0,
      'and the fresh account is removed again');
  }
} finally {
  await browser.close();
  if (egpId) sql(`DELETE FROM projects WHERE id=${egpId}`);
  if (sarId) sql(`DELETE FROM projects WHERE id=${sarId}`);
  const left = num(`SELECT COUNT(*) FROM projects WHERE title LIKE '${TAG}%'`);
  check(left === 0, 'both inserted projects are removed', `${left} left`);
}

console.log(`\nBUILD  ${BUILD.shortCommit} (${BUILD.environment})`);
console.log(`RESULT ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
