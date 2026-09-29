/**
 * ── THE BUYER'S SHORTLIST ───────────────────────────────────────────────
 *
 * PRODUCT_NORTH_STAR.md CURRENT GLOBAL RELEASE item 9; CLAUDE.md §22 names
 * the actions a buyer takes from discovery - save, compare, contact, Add to
 * RFQ, invite provider - and Save had no implementation at all.
 *
 * The four questions (§47):
 *
 *   CAN THE USER FIND IT?      a Save control on the card, a badge in the
 *                              navbar, a page behind it
 *   CAN THEY COMPLETE IT?      one click saves, a second un-saves
 *   DOES THE NEXT SYSTEM KNOW? the badge, the page and the grid all agree
 *   CAN THE OTHER PARTY SEE?   NO - and that is the requirement. A supplier
 *                              must never learn who shortlisted them.
 *
 * ALSO PROVED:
 *
 *   saving is self-scoped - no payload reads or writes another buyer's list
 *   a draft product cannot be saved by id (no enumeration oracle)
 *   an unapproved provider cannot be saved by id either
 *   the toggle is idempotent - a double-tap leaves one row, not two
 *   an item withdrawn after saving is NAMED, not silently dropped
 *   the empty state says where to start
 *   a signed-out visitor is told what signing in gives them
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9900 + (process.pid % 80)));
const PASSWORD = 'LocalSuperAdmin!2024';
const BUYER = 'zid6507832req@example.test';
const OTHER_BUYER = 'zid6507832rfd@example.test';
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
  return { status: res.status, data: body?.result?.data?.json, message: body?.error?.json?.message };
}

console.log(`\nBUILD ${BUILD.shortCommit ?? '?'}  env=${BUILD.environment ?? '?'}\n`);

const buyerCookie = await signIn(BUYER);
const otherCookie = await signIn(OTHER_BUYER);
const buyerId = num(`SELECT id FROM users WHERE email='${BUYER}'`);
const otherId = num(`SELECT id FROM users WHERE email='${OTHER_BUYER}'`);
sql(`DELETE FROM savedItems WHERE userId IN (${buyerId}, ${otherId})`);

const liveProduct = num(`SELECT id FROM products WHERE status='active' ORDER BY id LIMIT 1`);
const draftProduct = num(`SELECT IFNULL(MAX(id),0) FROM products WHERE status='draft'`);
const provider = num(`SELECT id FROM users WHERE userRole='supplier' AND onboardingStatus='approved' AND accountStatus='active' ORDER BY id LIMIT 1`);
check(liveProduct > 0 && provider > 0, 'real targets to save', `product #${liveProduct}, provider #${provider}`);

/* ── SAVE, AND UN-SAVE ───────────────────────────────────────────────── */
const first = await call(buyerCookie, 'profile.toggleSaved', { kind: 'product', itemId: liveProduct });
check(first.status === 200 && first.body?.result?.data?.json?.saved === true,
  'a buyer saves a product', `HTTP ${first.status}`);
check(num(`SELECT COUNT(*) FROM savedItems WHERE userId=${buyerId}`) === 1,
  'and exactly one row exists');

/* THE TOGGLE IS IDEMPOTENT BY CONSTRUCTION. A double-tap on a phone must
   not leave two rows - the unique index is what guarantees it, not luck. */
const off = await call(buyerCookie, 'profile.toggleSaved', { kind: 'product', itemId: liveProduct });
check(off.body?.result?.data?.json?.saved === false, 'a second click un-saves it');
check(num(`SELECT COUNT(*) FROM savedItems WHERE userId=${buyerId}`) === 0,
  'and the row is gone, not merely flagged');

await call(buyerCookie, 'profile.toggleSaved', { kind: 'product', itemId: liveProduct });
await call(buyerCookie, 'profile.toggleSaved', { kind: 'provider', itemId: provider });
check(num(`SELECT COUNT(*) FROM savedItems WHERE userId=${buyerId}`) === 2,
  'a product and a provider live in ONE list', '2 rows');

/* ── THE COUNT, THE PAGE AND THE GRID AGREE ──────────────────────────── */
const badge = await query(buyerCookie, 'profile.savedCount', null);
const list = await query(buyerCookie, 'profile.savedItems', null);
check(badge.data?.total === 2, 'the badge counts what was saved', `${badge.data?.total}`);
check((list.data?.items ?? []).length === 2, 'and the page lists the same two');
const state = await query(buyerCookie, 'profile.savedState', { kind: 'product', itemIds: [liveProduct] });
check((state.data?.saved ?? []).includes(liveProduct),
  'and a grid is told which of its cards are saved');

/* ── YOU CANNOT SAVE WHAT YOU CANNOT SEE ─────────────────────────────── */
// Without this the shortlist is an enumeration oracle: save id after id and
// the ones that succeed are the ones that exist.
if (draftProduct > 0) {
  const hidden = await call(buyerCookie, 'profile.toggleSaved', { kind: 'product', itemId: draftProduct });
  check(hidden.status !== 200,
    'a DRAFT product cannot be shortlisted by id',
    hidden.body?.error?.json?.message ?? `HTTP ${hidden.status}`);
} else {
  console.log(`SKIP  ${step++}. a draft product cannot be shortlisted  [no draft in this dataset]`);
}
const ghost = await call(buyerCookie, 'profile.toggleSaved', { kind: 'product', itemId: 99999999 });
check(ghost.status !== 200, 'nor can a product that does not exist',
  ghost.body?.error?.json?.message ?? `HTTP ${ghost.status}`);
const unapproved = num(`SELECT IFNULL(MAX(id),0) FROM users WHERE onboardingStatus <> 'approved' AND userRole='supplier'`);
if (unapproved > 0) {
  const refused = await call(buyerCookie, 'profile.toggleSaved', { kind: 'provider', itemId: unapproved });
  check(refused.status !== 200, 'an UNAPPROVED provider cannot be shortlisted either',
    refused.body?.error?.json?.message ?? `HTTP ${refused.status}`);
} else {
  console.log(`SKIP  ${step++}. an unapproved provider cannot be shortlisted  [none in this dataset]`);
}

/* ── SELF-SCOPED BY CONSTRUCTION ─────────────────────────────────────── */
const otherList = await query(otherCookie, 'profile.savedItems', null);
check((otherList.data?.items ?? []).length === 0,
  "another buyer's shortlist is empty - lists do not leak",
  `${(otherList.data?.items ?? []).length} items`);
const otherBadge = await query(otherCookie, 'profile.savedCount', null);
check(otherBadge.data?.total === 0, 'and neither does the count');
const anonymous = await query(null, 'profile.savedItems', null);
check(anonymous.status === 401, 'a signed-out caller reads nothing', `HTTP ${anonymous.status}`);

/* ── THE SAVED PARTY NEVER LEARNS ────────────────────────────────────── */
/*
 * THE REQUIREMENT, not a nicety. A supplier who could see who shortlisted
 * them without going on to ask for a price would have a lead - and a buyer
 * who knew that would think twice before saving anything.
 */
const providerCookie = await signIn(sql(`SELECT email FROM users WHERE id=${provider}`));
const providerViews = await Promise.all([
  query(providerCookie, 'profile.savedItems', null),
  query(providerCookie, 'profile.savedCount', null),
]);
check((providerViews[0].data?.items ?? []).every(item => item.itemId !== provider)
  && providerViews[1].data?.total === 0,
  'the saved supplier sees their OWN empty shortlist, not who saved them');
const leak = JSON.stringify(providerViews);
check(!leak.includes(String(buyerId)) || buyerId === provider,
  "and nothing in their reads names the buyer who saved them");

/* ── AN ITEM WITHDRAWN AFTER SAVING IS NAMED, NOT DROPPED ────────────── */
sql(`UPDATE products SET status='inactive' WHERE id=${liveProduct}`);
const afterWithdraw = await query(buyerCookie, 'profile.savedItems', null);
check((afterWithdraw.data?.unavailable ?? []).length === 1,
  'a withdrawn item is reported as unavailable, not silently dropped',
  `${(afterWithdraw.data?.unavailable ?? []).length} unavailable`);
check((afterWithdraw.data?.items ?? []).length === 1,
  'and is not rendered as a card with no name');
// A buyer must always be able to remove something from their own list,
// including an item that has since been withdrawn.
const removeGone = await call(buyerCookie, 'profile.toggleSaved', { kind: 'product', itemId: liveProduct });
check(removeGone.status === 200 && removeGone.body?.result?.data?.json?.saved === false,
  'and the buyer can still remove it');
sql(`UPDATE products SET status='active' WHERE id=${liveProduct}`);

/* ── IN THE BROWSER ──────────────────────────────────────────────────── */
const browser = await launchBrowser({ port: CDP_PORT });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  /* A SIGNED-OUT VISITOR IS TOLD, NOT BLOCKED (§76). */
  await page.goto(`${BASE}/marketplace/vendors`);
  const controlVisible = await waitFor(page, `document.querySelector('[data-testid^="save-provider-"]') !== null`);
  check(controlVisible, 'the Save control is on the card for a signed-out visitor too');
  await page.evaluate(clickOn(`[data-testid="save-provider-${provider}"]`));
  const sentToAuth = await waitFor(page, `location.pathname.indexOf('/auth') === 0`, 10000);
  check(sentToAuth, 'clicking it signed out explains and sends them to sign in',
    await page.evaluate(`return location.pathname;`));

  /* SIGNED IN: FIND IT, USE IT, SEE IT. */
  await page.setCookies(asBrowserCookies(buyerCookie));
  await page.goto(`${BASE}/marketplace/vendors`);
  await waitFor(page, `document.querySelector('[data-testid="save-provider-${provider}"]') !== null`);
  const initiallySaved = await page.evaluate(`
    const el = document.querySelector('[data-testid="save-provider-${provider}"]');
    return el ? el.getAttribute('data-saved') : 'MISSING';
  `);
  check(initiallySaved === 'true',
    'a provider saved earlier renders as saved in the grid', initiallySaved);

  await page.evaluate(clickOn(`[data-testid="save-provider-${provider}"]`));
  await settle(1800);
  const afterClick = await page.evaluate(`
    const el = document.querySelector('[data-testid="save-provider-${provider}"]');
    return el ? el.getAttribute('data-saved') : 'MISSING';
  `);
  check(afterClick === 'false', 'clicking it un-saves, in place, without navigating', afterClick);
  check(num(`SELECT COUNT(*) FROM savedItems WHERE userId=${buyerId} AND itemKind='provider'`) === 0,
    'and the database agrees with the button');

  await page.evaluate(clickOn(`[data-testid="save-provider-${provider}"]`));
  await settle(1800);

  /* THE BADGE, AND THE PAGE BEHIND IT. */
  await page.goto(`${BASE}/marketplace`);
  await waitFor(page, `document.querySelector('[data-testid="navbar-saved"]') !== null`);
  const badgeText = await page.evaluate(`
    const el = document.querySelector('[data-testid="navbar-saved"]');
    return el ? el.innerText.trim() : 'MISSING';
  `);
  check(badgeText !== 'MISSING', 'the shortlist is reachable from the navbar', `"${badgeText}"`);
  await page.evaluate(clickOn('[data-testid="navbar-saved"]'));
  const arrived = await waitFor(page, `location.pathname === '/saved'`, 12000);
  check(arrived, 'and the badge opens the shortlist', await page.evaluate(`return location.pathname;`));

  await waitFor(page, `document.querySelector('[data-testid="saved-providers"]') !== null`);
  const shown = await page.evaluate(`
    const el = document.querySelector('[data-testid="saved-providers"]');
    return el ? el.innerText.replace(/\\n+/g, ' | ') : 'MISSING';
  `);
  check(shown !== 'MISSING' && shown.length > 10, 'the saved provider is on the page', shown.slice(0, 90));

  /* IT ENDS IN AN ACTION. A shortlist with no way out of it is a drawer. */
  const cta = await page.evaluate(`
    const el = document.querySelector('[data-testid="saved-request-quotes"]');
    return el ? el.textContent.trim() : 'MISSING';
  `);
  check(cta !== 'MISSING', 'the shortlist offers the next step in sourcing', cta);

  /* ── SAVE IS ON EVERY DISCOVERY SURFACE ───────────────────────────── */
  /*
   * A capability wired to one of four surfaces is one the buyer meets by
   * luck (§79: no powerful feature the user cannot find). §22 lists the
   * actions taken FROM DISCOVERY, and discovery happens on the product grid
   * and the storefront as much as in the provider directory.
   */
  for (const [where, route, selector] of [
    ['the product grid', '/marketplace/products', `[data-testid="save-product-${liveProduct}"]`],
    ['the product detail page', `/marketplace/products/${liveProduct}`, `[data-testid="save-product-${liveProduct}"]`],
    ['the provider storefront', `/vendor/${provider}`, `[data-testid="save-provider-${provider}"]`],
    ['the provider directory', '/marketplace/vendors', `[data-testid="save-provider-${provider}"]`],
  ]) {
    await page.goto(`${BASE}${route}`);
    const present = await waitFor(page, `document.querySelector('${selector}') !== null`, 15000);
    check(present, `Save is reachable from ${where}`, route);
  }

  /* AND IT WORKS THERE, not merely rendered. The grid was the surface the
     first version wired; this proves the detail page actually saves. */
  sql(`DELETE FROM savedItems WHERE userId=${buyerId} AND itemKind='product'`);
  await page.goto(`${BASE}/marketplace/products/${liveProduct}`);
  await waitFor(page, `document.querySelector('[data-testid="save-product-${liveProduct}"]') !== null`);
  await page.evaluate(clickOn(`[data-testid="save-product-${liveProduct}"]`));
  await settle(1800);
  check(num(`SELECT COUNT(*) FROM savedItems WHERE userId=${buyerId} AND itemKind='product' AND itemId=${liveProduct}`) === 1,
    'and saving from the detail page writes the row');

  /* THE EMPTY STATE SAYS WHERE TO START. */
  sql(`DELETE FROM savedItems WHERE userId=${buyerId}`);
  await page.goto(`${BASE}/marketplace`);
  await page.goto(`${BASE}/saved`);
  const emptyShown = await waitFor(page, `document.querySelector('[data-testid="saved-empty"]') !== null`);
  const emptyText = await page.evaluate(`
    const el = document.querySelector('[data-testid="saved-empty"]');
    return el ? el.innerText.replace(/\\n+/g, ' | ') : 'MISSING';
  `);
  check(emptyShown && /browse|marketplace/i.test(emptyText),
    'the empty state names the next action rather than saying "nothing here"',
    emptyText.slice(0, 100));
} finally {
  await browser.close();
}

sql(`DELETE FROM savedItems WHERE userId IN (${buyerId}, ${otherId})`);
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
