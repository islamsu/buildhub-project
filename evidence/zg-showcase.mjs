/**
 * ── SUPPLIER SHOWCASE: THE SUPPLIER CHOOSES, AND IT STAYS PUT ───────────
 *
 * PRODUCT_NORTH_STAR item 15; CLAUDE.md §18 keeps three kinds of emphasis
 * apart and forbids merging them:
 *
 *   FEATURED   BuildHub's editorial choice
 *   SPONSORED  a commercial grant, bounded and revocable
 *   SHOWCASE   the supplier's own emphasis on their OWN storefront
 *
 * THE DANGER IS PRECISE. If a supplier's own pick could move them in a
 * SHARED list, they would have granted themselves a placement: Sponsored
 * inventory with no admin decision, no period, no revocation and no label.
 * BuildHub could no longer answer "why is this supplier above that one".
 *
 * WHAT IS PROVED, against real rows and a real browser:
 *
 *   a supplier picks items and they render on their own storefront
 *   labelled as THEIR choice, not as a BuildHub recommendation
 *   THE MARKETPLACE AND THE DIRECTORY DO NOT MOVE - proven by capturing
 *     the order BEFORE and AFTER a showcase is saved
 *   SUPPLIER A CANNOT SHOWCASE SUPPLIER B'S PRODUCT (the IDOR)
 *   an unpublished product is refused
 *   a product withdrawn AFTER being showcased leaves the public page, and
 *     the owner is told why
 *   the cap holds
 *
 * NEGATIVE AND POSITIVE CONTROLS BOTH: every refusal below is paired with
 * the same call succeeding for the rightful owner, so a refusal cannot be
 * the endpoint simply being broken.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9500 + (process.pid % 80)));
const PASSWORD = 'LocalSuperAdmin!2024';
const SUPPLIER_A = 'zid6507832vnd@example.test';
const SUPPLIER_B = 'zid6507832rfr@example.test';

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
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.result?.data?.json, message: body?.error?.json?.message };
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

console.log(`\nBUILD ${BUILD.shortCommit ?? '?'}  env=${BUILD.environment ?? '?'}\n`);

const cookieA = await signIn(SUPPLIER_A);
const cookieB = await signIn(SUPPLIER_B);
const idA = num(`SELECT id FROM users WHERE email='${SUPPLIER_A}'`);
const idB = num(`SELECT id FROM users WHERE email='${SUPPLIER_B}'`);
check(idA > 0 && idB > 0 && idA !== idB, 'two distinct approved suppliers', `#${idA} / #${idB}`);

/*
 * WHATEVER WAS THERE BEFORE, so the probe leaves no trace.
 *
 * `GROUP_CONCAT` over zero rows returns SQL NULL, which `mysql -N -B` prints
 * as the four characters "NULL" - a truthy JavaScript string. The first
 * version restored a showcase entry of kind 'NUL', which MySQL refused and
 * which took the whole probe down in its `finally` block, hiding the result.
 */
const priorRaw = sql(`SELECT GROUP_CONCAT(CONCAT(itemKind,':',itemId) ORDER BY position) FROM supplierShowcase WHERE userId=${idA}`);
const priorA = (priorRaw === 'NULL' || priorRaw === '') ? '' : priorRaw;

try {
  /* ══ 1. THE CANDIDATES ARE THE SUPPLIER'S OWN PUBLISHED ITEMS ═════════ */
  const candidates = await query(cookieA, 'profile.showcaseCandidates');
  check(candidates.status === 200, 'the supplier can read what they may showcase', String(candidates.message ?? ''));
  const mine = candidates.data ?? [];
  check(mine.length > 0, 'and there is something to choose from', `${mine.length} candidates`);

  const ownProducts = mine.filter(c => c.kind === 'product').map(c => c.itemId);
  check(ownProducts.length > 0, 'including published products of their own', ownProducts.slice(0, 3).join(','));

  /* EVERY candidate really is theirs - the list is not another supplier's. */
  const foreign = ownProducts.filter(id =>
    num(`SELECT COUNT(*) FROM products WHERE id=${id} AND supplierId=${idA}`) === 0);
  check(foreign.length === 0, 'and every candidate genuinely belongs to them',
    foreign.length ? `foreign: ${foreign.join(',')}` : 'all owned');

  /* ══ 2. THE IDOR: SUPPLIER A CANNOT SHOWCASE SUPPLIER B'S PRODUCT ═════ */
  const productOfB = num(`SELECT id FROM products WHERE supplierId=${idB} AND status='active' ORDER BY id DESC LIMIT 1`);
  if (productOfB > 0) {
    const stolen = await call(cookieA, 'profile.setShowcase', {
      entries: [{ kind: 'product', itemId: productOfB }],
    });
    check(stolen.status === 200, 'the cross-supplier attempt is ACCEPTED as a request, not a crash',
      String(stolen.message ?? stolen.status));
    check((stolen.data?.stored ?? []).length === 0,
      "SUPPLIER A CANNOT SHOWCASE SUPPLIER B'S PRODUCT - nothing stored",
      JSON.stringify(stolen.data?.stored ?? []));
    check((stolen.data?.refused ?? []).length === 1,
      'and the refusal is reported rather than silently dropped');
    check(num(`SELECT COUNT(*) FROM supplierShowcase WHERE userId=${idA} AND itemId=${productOfB} AND itemKind='product'`) === 0,
      'AND NO ROW REACHED THE DATABASE', 'verified in SQL, not from the response');
    /* THE POSITIVE CONTROL: the identical call with their OWN product works,
       so the refusal above is the ownership rule and not a broken endpoint. */
    const ownOk = await call(cookieA, 'profile.setShowcase', {
      entries: [{ kind: 'product', itemId: ownProducts[0] }],
    });
    check((ownOk.data?.stored ?? []).length === 1,
      'POSITIVE CONTROL: the same call with their OWN product succeeds',
      JSON.stringify(ownOk.data?.stored ?? []));
  } else {
    check(false, 'no product belonging to supplier B to attempt the IDOR with', 'SKIP');
  }

  /* ══ 3. AN UNPUBLISHED ITEM IS REFUSED ════════════════════════════════ */
  const draft = num(`SELECT id FROM products WHERE supplierId=${idA} AND status<>'active' ORDER BY id DESC LIMIT 1`);
  let restoreDraft = null;
  let draftId = draft;
  if (draftId === 0 && ownProducts.length > 1) {
    draftId = ownProducts[ownProducts.length - 1];
    restoreDraft = sql(`SELECT status FROM products WHERE id=${draftId}`);
    sql(`UPDATE products SET status='draft' WHERE id=${draftId}`);
  }
  if (draftId > 0) {
    const refused = await call(cookieA, 'profile.setShowcase', {
      entries: [{ kind: 'product', itemId: draftId }],
    });
    check((refused.data?.stored ?? []).length === 0,
      'an UNPUBLISHED product is refused - it would 404 for every visitor',
      JSON.stringify(refused.data?.refused ?? []));
  }
  if (restoreDraft) sql(`UPDATE products SET status='${restoreDraft}' WHERE id=${draftId}`);

  /* ══ 4. THE CAP ═══════════════════════════════════════════════════════ */
  const manyEntries = mine.slice(0, 12).map(c => ({ kind: c.kind, itemId: c.itemId }));
  if (manyEntries.length > 6) {
    const capped = await call(cookieA, 'profile.setShowcase', { entries: manyEntries });
    check((capped.data?.stored ?? []).length <= 6,
      'the cap of six holds on the server, not only in the browser',
      String((capped.data?.stored ?? []).length));
  }

  /* ══ 5. THE SHARED SURFACES DO NOT MOVE ═══════════════════════════════
     The heart of §18. Captured BEFORE and AFTER a showcase is saved. */
  /*
   * `marketplace.vendors` RETURNS A BARE ARRAY, not `{ rows }`.
   *
   * The first version of this probe read `.rows ?? .vendors ?? []` and
   * captured an empty list twice - so "the order is unchanged" was true of
   * nothing at all. The `!== '[]'` guard below is what caught it, and it is
   * kept and strengthened: a ranking comparison over an empty list is
   * exactly the pass a broken confinement would produce.
   */
  const orderOf = data => JSON.stringify((Array.isArray(data) ? data : []).map(v => v.id ?? v.userId));
  const directoryBefore = await query(cookieA, 'marketplace.vendors', { limit: 50 });
  const productsBefore = await query(cookieA, 'marketplace.list', { limit: 50 });
  const beforeOrder = orderOf(directoryBefore.data);
  const beforeProducts = orderOf(productsBefore.data?.items ?? productsBefore.data);
  check(JSON.parse(beforeOrder).length >= 2,
    'the directory has enough rows for a ranking comparison to mean anything',
    `${JSON.parse(beforeOrder).length} providers`);

  const chosen = mine.slice(0, 3).map(c => ({ kind: c.kind, itemId: c.itemId }));
  const saved = await call(cookieA, 'profile.setShowcase', { entries: chosen });
  check((saved.data?.stored ?? []).length === chosen.length,
    'the supplier saves a real showcase', `${(saved.data?.stored ?? []).length} stored`);

  const directoryAfter = await query(cookieA, 'marketplace.vendors', { limit: 50 });
  const productsAfter = await query(cookieA, 'marketplace.list', { limit: 50 });
  const afterOrder = orderOf(directoryAfter.data);
  const afterProducts = orderOf(productsAfter.data?.items ?? productsAfter.data);
  check(beforeOrder === afterOrder && beforeOrder !== '[]',
    'THE PROVIDER DIRECTORY ORDER IS UNCHANGED - no self-granted placement',
    beforeOrder === afterOrder ? `identical, ${JSON.parse(beforeOrder).length} rows` : 'MOVED');
  check(beforeProducts === afterProducts && beforeProducts !== '[]',
    'AND THE MARKETPLACE PRODUCT ORDER IS UNCHANGED',
    beforeProducts === afterProducts ? `identical, ${JSON.parse(beforeProducts).length} rows` : 'MOVED');

  /* And the placement store itself never saw the showcase. */
  check(num(`SELECT COUNT(*) FROM vendorSponsorships WHERE vendorId=${idA} AND grantedBy IS NULL AND grantedReason IS NULL AND source='ADMIN_EDITORIAL' AND startsAt > DATE_SUB(NOW(), INTERVAL 2 MINUTE)`) === 0,
    'and no placement row was created by saving a showcase');

  /* ══ 6. IN THE BROWSER ════════════════════════════════════════════════ */
  const browser = await launchBrowser({ port: CDP_PORT });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1200 });
    /* A DIFFERENT SIGNED-IN BUYER, not the supplier themselves: the
       storefront must show the showcase to VISITORS. */
    await page.setCookies(asBrowserCookies(cookieB));
    await page.goto(`${BASE}/vendor/${idA}`);

    const shown = await waitFor(page, `document.querySelector('[data-testid="showcase-strip"]') !== null`);
    check(shown, 'the showcase renders on the storefront for a visitor');

    const stripText = await page.evaluate(`
      const el = document.querySelector('[data-testid="showcase-strip"]');
      return el ? el.innerText.trim() : 'MISSING';
    `);
    check(stripText !== 'MISSING' && /Selected by this supplier/i.test(String(stripText)),
      "LABELLED AS THE SUPPLIER'S OWN CHOICE", String(stripText).split('\n')[1] ?? '');
    check(stripText !== 'MISSING' && /not a paid placement/i.test(String(stripText)),
      'and explicitly NOT a BuildHub recommendation or a paid slot');

    const cardCount = await page.evaluate(`
      const el = document.querySelector('[data-testid="showcase-strip"]');
      return el ? el.querySelectorAll('[data-testid^="showcase-card-"]').length : -1;
    `);
    check(cardCount === chosen.length,
      'and renders exactly what the supplier chose', `${cardCount} of ${chosen.length}`);

    /* ══ 7. WITHDRAWN AFTER SHOWCASING ══════════════════════════════════ */
    const showcasedProduct = chosen.find(entry => entry.kind === 'product');
    if (showcasedProduct) {
      const before = sql(`SELECT status FROM products WHERE id=${showcasedProduct.itemId}`);
      sql(`UPDATE products SET status='draft' WHERE id=${showcasedProduct.itemId}`);
      await page.goto(`${BASE}/vendor/${idA}`);
      await settle(2000);
      const afterWithdraw = await page.evaluate(`
        const el = document.querySelector('[data-testid="showcase-card-product-${showcasedProduct.itemId}"]');
        return el === null ? 'GONE' : 'STILL SHOWN';
      `);
      check(afterWithdraw === 'GONE',
        'a product withdrawn AFTER showcasing leaves the public page at once',
        String(afterWithdraw));

      /* AND THE OWNER IS TOLD. A page that quietly shortens teaches its
         owner nothing about why. */
      const ownerView = await query(cookieA, 'profile.myShowcase');
      check(Number(ownerView.data?.unavailable ?? 0) > 0,
        'and the OWNER is told it was dropped, with a count',
        String(ownerView.data?.unavailable));
      const publicView = await query(cookieB, 'profile.showcase', { userId: idA });
      check(Number(publicView.data?.unavailable ?? 0) === 0,
        'while a VISITOR is not - it would leak unpublished stock',
        String(publicView.data?.unavailable));
      sql(`UPDATE products SET status='${before}' WHERE id=${showcasedProduct.itemId}`);
    }

    /* ══ 8. THE EDITOR IS REACHABLE AND SAYS WHAT IT DOES NOT DO ════════ */
    await page.setCookies(asBrowserCookies(cookieA));
    await page.goto(`${BASE}/settings`);
    const editor = await waitFor(page, `document.querySelector('[data-testid="showcase-manager"]') !== null`);
    check(editor, 'the supplier can find the editor in Settings');
    const scopeNote = await page.evaluate(`
      const el = document.querySelector('[data-testid="showcase-scope-note"]');
      return el ? el.innerText.trim() : 'MISSING';
    `);
    check(scopeNote !== 'MISSING' && /does not change your position in the marketplace/i.test(String(scopeNote)),
      'and is told plainly that it does NOT affect marketplace ranking',
      String(scopeNote).slice(0, 80));
  } finally {
    await browser.close().catch(() => {});
  }
} finally {
  sql(`DELETE FROM supplierShowcase WHERE userId=${idA}`);
  if (priorA) {
    // Restore whatever was there before, so the probe leaves no trace.
    let position = 0;
    for (const pair of priorA.split(',')) {
      const [kind, itemId] = pair.split(':');
      sql(`INSERT IGNORE INTO supplierShowcase (userId,itemKind,itemId,position) VALUES (${idA},'${kind}',${Number(itemId)},${position++})`);
    }
  }
  console.log(`\n(cleanup) showcase rows for #${idA}: ${num(`SELECT COUNT(*) FROM supplierShowcase WHERE userId=${idA}`)}`);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
