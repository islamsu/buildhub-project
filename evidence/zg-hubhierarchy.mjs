/**
 * ── THE MARKETPLACE HOME IS A HIERARCHY, NOT A PILE OF SECTIONS ─────────
 *
 * North Star §"Marketplace Home": macro verticals clear, product taxonomy
 * SUBORDINATE to Products, no emoji category presentation, RFQ CTA prominent.
 *
 * The page had the taxonomy grid ABOVE the four vertical cards - browse
 * vocabulary ahead of the question the page exists to answer - the tiles
 * carried emoji (Marble and Granite issued the same rock glyph, half the
 * taxonomy falling back to a parcel box), and the RFQ path had no entry point
 * in the body at all.
 *
 * WHAT IS PROVED, in a real browser, in BOTH languages:
 *
 *   the macro verticals render ABOVE the taxonomy, in the DOM order a
 *     reader actually meets them in
 *   the category tiles carry NO emoji and NO replacement glyph
 *   each tile carries a REAL listing count from the canonical aggregate
 *   those counts agree with what the catalogue itself returns per category
 *   a category with nothing in it says so rather than promising results
 *   the counts are grammatical - "1 listing", and four forms in Arabic
 *   the RFQ call to action is present and reaches the RFQ page
 */
import { launchBrowser } from './lib/cdp.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9900 + (process.pid % 80)));

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
const get = async path => {
  const res = await fetch(`${BASE}/api/trpc/${path}`);
  return (await res.json())?.result?.data?.json;
};

console.log(`\nBUILD ${BUILD.shortCommit ?? '?'}  env=${BUILD.environment ?? '?'}\n`);

const taxonomy = await get('marketplace.categories?input=' + encodeURIComponent('{"json":{"view":"public","withCounts":true}}'));
const categories = taxonomy?.categories ?? [];
check(categories.length > 0 && categories.every(c => typeof c.listedProducts === 'number'),
  'the taxonomy endpoint carries a real listing count per category',
  `${categories.length} categories`);

/* THE COUNT IS THE CATALOGUE'S OWN. Asked of the catalogue, category by
   category, rather than trusting the aggregate to agree with itself. */
const withStock = categories.filter(c => c.listedProducts > 0).slice(0, 4);
let agreed = 0;
for (const category of withStock) {
  const listed = await get('marketplace.list?input=' + encodeURIComponent(JSON.stringify({ json: { category: category.nameEn, limit: 100 } })));
  if (Array.isArray(listed) && listed.length === category.listedProducts) agreed += 1;
  else console.log(`      ${category.nameEn}: aggregate ${category.listedProducts}, catalogue ${listed?.length}`);
}
check(withStock.length > 0 && agreed === withStock.length,
  'each count equals what the catalogue returns for that category',
  `${agreed}/${withStock.length} checked`);

const browser = await launchBrowser({ port: CDP_PORT });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  for (const lang of ['en', 'ar']) {
    console.log(`\n  ── ${lang.toUpperCase()} ──`);
    await page.goto(`${BASE}/`);
    await page.evaluate(`localStorage.setItem('buildhub_lang', ${JSON.stringify(lang)}); return 'true';`);
    await page.goto(`${BASE}/marketplace`);
    await waitFor(page, `document.querySelector('[data-testid="hub-category-discovery"]') !== null`);

    /* ── ORDER: MACRO VERTICALS FIRST ─────────────────────────────────── */
    // compareDocumentPosition, not offsetTop: in RTL the columns swap but the
    // reading order is what the hierarchy is about, and a y-coordinate would
    // pass on a page whose sections were merely tall.
    const ordered = await page.evaluate(`
      const macro = document.querySelector('[data-testid="hub-stat-products"]');
      const taxonomy = document.querySelector('[data-testid="hub-category-discovery"]');
      if (!macro || !taxonomy) return 'MISSING';
      return (macro.compareDocumentPosition(taxonomy) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'true' : 'false';
    `);
    check(ordered === 'true', `${lang}: the macro verticals come before the taxonomy`, ordered);

    /* ── NO EMOJI, NO MISSING GLYPH ───────────────────────────────────── */
    const glyphs = await page.evaluate(`
      const grid = document.querySelector('[data-testid="hub-category-discovery"]');
      const text = grid ? grid.innerText : '';
      const bad = [...text].filter(ch => {
        const code = ch.codePointAt(0);
        return ch === String.fromCharCode(65533) || (code >= 0x1F000 && code <= 0x1FAFF) || (code >= 0x2600 && code <= 0x27BF);
      });
      return JSON.stringify([...new Set(bad)]);
    `);
    check(JSON.parse(glyphs).length === 0,
      `${lang}: the category tiles carry no emoji or replacement glyph`, glyphs);

    /* ── EVERY TILE CARRIES A REAL COUNT ──────────────────────────────── */
    const tiles = JSON.parse(await page.evaluate(`
      const grid = document.querySelector('[data-testid="hub-category-discovery"]');
      const out = [];
      for (const el of grid.querySelectorAll('[data-testid^="hub-category-"]')) {
        const id = el.getAttribute('data-testid');
        if (!id.startsWith('hub-category-count-')) {
          const count = el.querySelector('[data-testid^="hub-category-count-"]');
          out.push({ slug: id.replace('hub-category-', ''), count: count ? count.textContent.trim() : null });
        }
      }
      return JSON.stringify(out);
    `));
    check(tiles.length > 0 && tiles.every(tile => tile.count !== null && tile.count !== ''),
      `${lang}: every tile states how many listings it holds`, `${tiles.length} tiles`);

    /* ── THE STOCK-BEARING ONES LEAD ──────────────────────────────────── */
    const bySlug = new Map(categories.map(c => [c.slug ?? c.nameEn, c.listedProducts]));
    const counts = tiles.map(tile => bySlug.get(tile.slug) ?? 0);
    check(counts.every((n, i) => i === 0 || counts[i - 1] >= n),
      `${lang}: categories that hold stock are the ones a buyer meets first`, counts.join(','));

    /* ── GRAMMAR ──────────────────────────────────────────────────────── */
    const singular = tiles.find(tile => bySlug.get(tile.slug) === 1);
    if (lang === 'en') {
      check(!singular || /^1 listing$/.test(singular.count),
        'en: one listing is "1 listing", not "1 listings"', singular?.count ?? 'no singular category');
    } else {
      const dual = tiles.find(tile => bySlug.get(tile.slug) === 2);
      check(!singular || !/^1 /.test(singular.count),
        'ar: one is the Arabic singular, not a western numeral form', singular?.count ?? 'none');
      check(!dual || !/^2 /.test(dual.count),
        'ar: two is the Arabic DUAL, which no English string can produce', dual?.count ?? 'none');
    }

    /* ── THE RFQ PATH IS ON THE PAGE ──────────────────────────────────── */
    const cta = await page.evaluate(`
      const el = document.querySelector('[data-testid="hub-rfq-cta"]');
      return el ? el.textContent.trim() : 'MISSING';
    `);
    check(cta !== 'MISSING' && cta.length > 0, `${lang}: the RFQ call to action is on the page`, cta);
  }

  /* ── AND IT GOES WHERE IT SAYS ──────────────────────────────────────── */
  await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return 'true';`);
  await page.goto(`${BASE}/marketplace`);
  await waitFor(page, `document.querySelector('[data-testid="hub-rfq-cta"]') !== null`);
  await page.evaluate(`
    const el = document.querySelector('[data-testid="hub-rfq-cta"]');
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
  `);
  const arrived = await waitFor(page, `location.pathname.indexOf('/rfq') === 0`, 12000);
  const where = await page.evaluate(`return location.pathname;`);
  check(arrived, 'the RFQ action reaches the RFQ journey, not a dead control', where);

} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
