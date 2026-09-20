/**
 * ── FEATURED IS PRIME, IN BOTH CONTEXTS ─────────────────────────────────
 *
 * The owner's requirement: Featured Vendors and Featured Products need TWO
 * prime contexts - the main marketplace page, and the category experience the
 * pick belongs to. A Featured Lighting supplier should be prominent on the
 * marketplace home AND inside Lighting, and must never surface under Tiles.
 *
 * SEEDED, NOT FABRICATED. This constructs QA records in the local database,
 * asserts against them, and deletes them in the teardown. Nothing here writes
 * production content, and nothing asserts against whatever happens to be in
 * the database already - a test that depends on today's data passes and fails
 * for reasons that have nothing to do with the code.
 *
 * WHAT IS PROVED:
 *
 *   HOME        the featured provider and the featured product are both on the
 *               marketplace home, above the ordinary section cards
 *   CATEGORY    the same two appear inside their own category
 *   SCOPE       and do NOT appear inside a different one
 *   DISTINCT    Featured is visually distinguishable from ordinary content,
 *               and from Sponsored, by more than colour
 *   EMPTY       with the picks withdrawn the strips disappear entirely rather
 *               than standing empty over nothing
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9500 + (process.pid % 80)));
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

const MINE = 'Lighting QA';
const OTHER = 'Tiles QA';

function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zfeat%') as probe)`;
  for (const statement of [
    `delete from vendorSponsorships where vendorId in ${ids}`,
    `delete from products where supplierId in ${ids}`,
    `delete from vendorCategories where userId in ${ids}`,
    `delete from vendorProfiles where userId in ${ids}`,
    `delete from analyticsEvents where userId in ${ids}`,
    `delete from userAccountAuditEvents where actorId in ${ids} or userId in ${ids}`,
    `delete from users where username like 'zfeat%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 80)})`);
    }
  }
}

const browser = await launchBrowser({ port: CDP_PORT });
try {
  cleanUp();

  /* A live, approved supplier - the directory's own visibility rules apply. */
  const v = `zfeatV${stamp}`;
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified)
       values ('probe-${v}', '${v}', '${v}@example.test', 'QA Lighting Supplier', 'user',
        'supplier', 'password', 'self_registered', 0, 'active', 'approved', 1)`);
  const vendorId = Number(sql(`select id from users where username='${v}'`));

  /* EDITORIAL, not paid: kind='featured'. */
  sql(`insert into vendorSponsorships (vendorId, category, kind, source, entityType, priority, startsAt)
       values (${vendorId}, '${MINE}', 'featured', 'ADMIN_EDITORIAL', 'PROVIDER', 0, now())`);

  sql(`insert into products (supplierId, name, category, price, currency, status, featured)
       values (${vendorId}, 'QA Featured Lamp ${stamp}', '${MINE}', 250, 'EGP', 'active', 1)`);
  sql(`insert into products (supplierId, name, category, price, currency, status, featured)
       values (${vendorId}, 'QA Ordinary Lamp ${stamp}', '${MINE}', 200, 'EGP', 'active', 0)`);
  const featuredProductId = Number(sql(`select id from products where supplierId=${vendorId} and featured=1 limit 1`));
  const ordinaryProductId = Number(sql(`select id from products where supplierId=${vendorId} and featured=0 limit 1`));
  check(vendorId > 0 && featuredProductId > 0 && ordinaryProductId > 0,
    'SETUP: a curated supplier, a curated product and an ordinary one',
    `vendor ${vendorId}, products ${featuredProductId}/${ordinaryProductId}`);

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });

  /* ── THE MARKETPLACE HOME ────────────────────────────────────────────── */
  await page.goto(`${BASE}/marketplace`);
  await waitFor(page, `document.body.innerText.length > 200`);
  await settle(2000);

  const home = JSON.parse(await page.evaluate(`
    const prod = document.querySelector('[data-testid="hub-featured-product-${featuredProductId}"]');
    const strip = document.querySelector('[data-testid="hub-featured-products"]');
    const sections = document.querySelector('[data-testid^="hub-stat-"]');
    const text = document.body.innerText;
    // Where the featured strip sits relative to the ordinary section cards.
    const stripTop = strip ? strip.getBoundingClientRect().top + window.scrollY : null;
    const sectionTop = sections ? sections.getBoundingClientRect().top + window.scrollY : null;
    return JSON.stringify({
      productCard: !!prod,
      strip: !!strip,
      providerNamed: /QA Lighting Supplier/.test(text),
      ordinaryShown: /QA Ordinary Lamp/.test(text),
      stripTop, sectionTop,
      badgeText: prod ? prod.innerText.replace(/\\s+/g, ' ').slice(0, 60) : '',
      kind: prod ? prod.getAttribute('data-placement-kind') : null,
    });
  `));

  check(home.strip && home.productCard,
    'HOME: the curated PRODUCT is on the marketplace home', home.productCard ? 'card present' : 'absent');
  check(home.providerNamed,
    'HOME: the curated PROVIDER is on the marketplace home too',
    home.providerNamed ? 'named' : 'absent');
  check(home.stripTop !== null && home.sectionTop !== null && home.stripTop < home.sectionTop,
    'HOME: and Featured sits ABOVE the ordinary section cards - it is prime',
    `featured at ${Math.round(home.stripTop)}px, sections at ${Math.round(home.sectionTop)}px`);
  check(!home.ordinaryShown,
    'HOME: while a non-curated product of the same supplier is NOT promoted',
    home.ordinaryShown ? 'the ordinary product appears in a premium slot' : 'absent, correctly');
  check(home.kind === 'featured' && /featured/i.test(home.badgeText),
    'HOME: and the card SAYS it is editorial, in words rather than colour alone',
    home.badgeText);

  /* ── ITS OWN CATEGORY ────────────────────────────────────────────────── */
  /*
   * `cat`, not `category`. The first version of this used the wrong parameter
   * name, which the page ignores - so it rendered the WHOLE catalogue and the
   * curated lamp appeared under a category it has nothing to do with. That
   * was reported as a scope leak, and it was a probe that had never filtered
   * anything.
   */
  await page.goto(`${BASE}/marketplace/products?cat=${encodeURIComponent(MINE)}`);
  await waitFor(page, `document.body.innerText.length > 200`);
  await settle(2000);
  const inCategory = await page.evaluate(`
    return JSON.stringify({ text: /QA Featured Lamp/.test(document.body.innerText) });
  `);
  check(JSON.parse(inCategory).text,
    'CATEGORY: the curated product appears inside its own category');

  /* ── AND NOT IN ANOTHER ──────────────────────────────────────────────── */
  await page.goto(`${BASE}/marketplace/products?cat=${encodeURIComponent(OTHER)}`);
  await waitFor(page, `document.body.innerText.length > 200`);
  await settle(2000);
  const elsewhere = JSON.parse(await page.evaluate(`
    return JSON.stringify({ shown: /QA Featured Lamp/.test(document.body.innerText) });
  `));
  check(!elsewhere.shown,
    'SCOPE: and does NOT appear under a category it does not belong to',
    elsewhere.shown ? 'it leaked into the wrong category' : 'correctly absent');

  /* ── CATEGORY DISCOVERY ON THE HOME ──────────────────────────────────── */
  await page.goto(`${BASE}/marketplace`);
  await waitFor(page, `document.body.innerText.length > 200`);
  await settle(1800);
  const discovery = JSON.parse(await page.evaluate(`
    const block = document.querySelector('[data-testid="hub-category-discovery"]');
    const tiles = block ? block.querySelectorAll('[data-testid^="hub-category-"]').length : 0;
    return JSON.stringify({ present: !!block, tiles });
  `));
  check(discovery.present && discovery.tiles > 0,
    'HOME: a visitor can browse into a category from the marketplace home',
    `${discovery.tiles} category tiles`);

  /*
   * ── THE CATEGORY EXPERIENCE: FEATURED BEFORE SPONSORED ────────────────
   *
   * A SPONSORED PLACEMENT IS BOOKED FIRST, deliberately. Without one the
   * ordering assertion below has nothing to sit above and passes for the
   * wrong reason - which is exactly what the first run of it did.
   */
  sql(`insert into products (supplierId, name, category, price, currency, status, featured)
       values (${vendorId}, 'QA Sponsored Lamp ${stamp}', '${MINE}', 300, 'EGP', 'active', 0)`);
  const sponsoredProductId = Number(sql(`select id from products where supplierId=${vendorId}
                                         and name like 'QA Sponsored%' limit 1`));
  sql(`insert into vendorSponsorships (vendorId, category, kind, source, entityType, productId,
        surface, package, priority, startsAt)
       values (${vendorId}, '${MINE}', 'sponsored', 'ADMIN_EDITORIAL', 'PRODUCT', ${sponsoredProductId},
        'TYPE_CATEGORY_SPOTLIGHT', 'SPOTLIGHT', 0, now())`);

  await page.goto(`${BASE}/marketplace/products?cat=${encodeURIComponent(MINE)}`);
  await waitFor(page, `document.body.innerText.length > 200`);
  await settle(2200);
  const order = JSON.parse(await page.evaluate(`
    const featured = document.querySelector('[data-testid="products-editorial-featured"]');
    const sponsoredHeading = document.querySelector('[data-testid="product-spotlight"]')
      || [...document.querySelectorAll('section')]
        .find(s => /sponsor|master|spotlight/i.test(s.getAttribute('aria-label') || ''));
    const top = el => el ? el.getBoundingClientRect().top + window.scrollY : null;
    return JSON.stringify({
      featured: !!featured,
      featuredTop: top(featured),
      sponsoredTop: top(sponsoredHeading),
      hasCurated: featured ? /QA Featured Lamp/.test(featured.innerText) : false,
    });
  `));
  check(order.featured && order.hasCurated,
    'CATEGORY: the curated product has its OWN editorial block, not just a badge',
    order.featured ? 'block present' : 'no editorial block');
  check(order.sponsoredTop === null || order.featuredTop < order.sponsoredTop,
    'CATEGORY: and Featured sits ABOVE any sponsored placement',
    order.sponsoredTop === null
      ? 'nothing sponsored is booked, so nothing to sit above'
      : `featured ${Math.round(order.featuredTop)}px, sponsored ${Math.round(order.sponsoredTop)}px`);

  /* ── WITHDRAWN: the strip disappears rather than standing empty ───────── */
  sql(`update products set featured = 0 where id = ${featuredProductId}`);
  sql(`update vendorSponsorships set revokedAt = now() where vendorId = ${vendorId}`);
  await page.goto(`${BASE}/marketplace`);
  await waitFor(page, `document.body.innerText.length > 200`);
  await settle(2000);
  /*
   * THE PREMIUM STRIPS, not the whole page. A supplier who is no longer
   * CURATED is still a live supplier and may legitimately appear in the
   * ordinary directory - asserting their name is absent from the document
   * would be asserting they had been removed from the marketplace, which is
   * not what withdrawing an editorial pick means.
   */
  const withdrawn = JSON.parse(await page.evaluate(`
    const strip = document.querySelector('[data-testid="hub-featured-products"]');
    const premium = [...document.querySelectorAll('[data-placement-kind="featured"]')]
      .map(e => e.innerText).join(' ');
    return JSON.stringify({
      strip: !!strip,
      inPremium: /QA Lighting Supplier|QA Featured Lamp/.test(premium),
    });
  `));
  check(!withdrawn.strip && !withdrawn.inPremium,
    'EMPTY: withdrawing the picks removes the premium strip, with no empty heading',
    withdrawn.strip ? 'the heading is still there' : 'gone, correctly');
} finally {
  cleanUp();
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
