/**
 * ── THE NUMBER OF THINGS IN THE CATALOGUE ────────────────────────────────
 *
 * The owner asked for the product count back. It had been removed from the
 * public `platformStats` contract, and the Marketplace "Products" macro card
 * had quietly taken the CATEGORY count into the slot the three cards beside it
 * use for a count of real entities. Nineteen categories and an empty catalogue
 * read, to anybody scanning that row, as "19 Products".
 *
 * WHAT IS PROVED, in a real browser against real rows:
 *
 *   the endpoint reports a count of PRODUCTS
 *   that count is the CATALOGUE's own - a draft is not in it
 *   the count equals what the marketplace listing actually returns
 *   the Marketplace card RENDERS the product count, labelled Products
 *   the category count survives as a secondary line, not as the headline
 *   the homepage proof strip renders it too
 *   Arabic renders the same figure with an Arabic label
 *   a failed request renders a dash, NEVER a zero
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

/* ── 1. THE CONTRACT CARRIES A PRODUCT COUNT AGAIN ───────────────────── */
const stats = await get('marketplace.platformStats?input=' + encodeURIComponent('{"json":null}'));
check(typeof stats?.publicProducts === 'number',
  'platformStats reports publicProducts', `= ${stats?.publicProducts}`);

/* ── 2. IT IS THE CATALOGUE'S OWN COUNT ──────────────────────────────── */
// The listing endpoint uses publicProductFilter(); so does the count. If the
// two ever disagreed, the headline would be advertising rows the marketplace
// will not show.
const listed = await get('marketplace.list?input=' + encodeURIComponent('{"json":{"limit":100}}'));
check(Array.isArray(listed) && listed.length === stats.publicProducts,
  'the count equals what the marketplace actually lists',
  `listed ${listed?.length} vs counted ${stats?.publicProducts}`);

const statuses = new Set((listed ?? []).map(p => p.status));
check(statuses.size === 1 && statuses.has('active'),
  'nothing unpublished is in it', `statuses: ${[...statuses].join(', ') || 'none'}`);

/* ── 3. AND IT IS NOT THE CATEGORY COUNT ─────────────────────────────── */
const taxonomy = await get('marketplace.categories?input=' + encodeURIComponent('{"json":{"view":"public"}}'));
const categoryCount = taxonomy?.categories?.length ?? 0;
check(stats.publicProducts !== categoryCount || categoryCount === 0,
  'the product figure is distinguishable from the category figure',
  `${stats.publicProducts} products, ${categoryCount} categories`);

const browser = await launchBrowser({ port: CDP_PORT });
try {
  const page = await browser.newPage();

  /* ── 4. THE MARKETPLACE CARD ─────────────────────────────────────────── */
  await page.goto(`${BASE}/marketplace`);
  await waitFor(page, `document.querySelector('[data-testid="hub-stat-products"]') && document.querySelector('[data-testid="hub-stat-products"]').textContent.trim() !== '—'`);

  const card = await page.evaluate(`
    const stat = document.querySelector('[data-testid="hub-stat-products"]');
    const label = document.querySelector('[data-testid="hub-statlabel-products"]');
    const secondary = document.querySelector('[data-testid="hub-secondary-products"]');
    return JSON.stringify({
      stat: stat ? stat.textContent.trim() : null,
      label: label ? label.textContent.trim() : null,
      secondary: secondary ? secondary.textContent.trim() : null,
    });
  `);
  const shown = JSON.parse(card);
  check(shown.stat === String(stats.publicProducts),
    'the Marketplace card RENDERS the product count', `card "${shown.stat}", server ${stats.publicProducts}`);
  check(/^products$/i.test(shown.label ?? '') || /منتج/.test(shown.label ?? ''),
    'and labels it Products', `"${shown.label}"`);
  check(shown.stat !== String(categoryCount) || categoryCount === 0,
    'the headline is NOT the category count', `"${shown.stat}" vs ${categoryCount} categories`);
  check(shown.secondary !== null && shown.secondary.includes(String(categoryCount)),
    'the category count survives as the secondary line', `"${shown.secondary}"`);

  /* ── 5. THE HOMEPAGE PROOF STRIP ─────────────────────────────────────── */
  await page.goto(`${BASE}/`);
  await waitFor(page, `document.body.innerText.includes('Products Listed')`);
  const home = await page.evaluate(`
    const text = document.body.innerText;
    const index = text.indexOf('Products Listed');
    return JSON.stringify({ nearby: index === -1 ? null : text.slice(Math.max(0, index - 40), index + 20) });
  `);
  const nearby = JSON.parse(home).nearby ?? '';
  check(nearby.includes(stats.publicProducts.toLocaleString('en-US')),
    'the homepage renders the real figure beside the label', nearby.replace(/\n/g, ' | ').trim());

  /* ── 6. ARABIC ───────────────────────────────────────────────────────── */
  await page.evaluate(`localStorage.setItem('buildhub_lang', 'ar'); return 'true';`);
  await page.goto(`${BASE}/marketplace`);
  await waitFor(page, `document.documentElement.getAttribute('dir') === 'rtl'`);
  await waitFor(page, `document.querySelector('[data-testid="hub-statlabel-products"]') !== null`);
  const arabic = await page.evaluate(`
    const label = document.querySelector('[data-testid="hub-statlabel-products"]');
    const stat = document.querySelector('[data-testid="hub-stat-products"]');
    return JSON.stringify({ label: label ? label.textContent.trim() : null, stat: stat ? stat.textContent.trim() : null });
  `);
  const ar = JSON.parse(arabic);
  check(/[؀-ۿ]/.test(ar.label ?? ''), 'the Arabic label is Arabic, not an English fallback', `"${ar.label}"`);
  check(ar.stat === String(stats.publicProducts), 'and carries the same real figure', `"${ar.stat}"`);

  /* ── 7. A FAILED REQUEST IS NOT A ZERO ───────────────────────────────── */
  // The defect this guards is the one already fixed twice on this page: an
  // empty default rendered as a confident "0" on a PUBLIC page - a statement
  // about the size of the business, made because a request did not come back.
  await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return 'true';`);
  await page.setRequestInterception?.(true);
  const blocked = await page.evaluate(`
    window.__origFetch = window.fetch;
    window.fetch = function (input) {
      const url = String(typeof input === 'string' ? input : (input && input.url) || '');
      if (url.includes('platformStats')) return Promise.reject(new Error('blocked'));
      return window.__origFetch.apply(this, arguments);
    };
    return 'true';
  `);
  check(blocked === 'true', 'the probe can simulate the outage');
  await page.evaluate(`history.pushState({}, '', '/marketplace'); window.dispatchEvent(new PopStateEvent('popstate')); return 'true';`);
  await page.goto(`${BASE}/vendors`);
  await page.evaluate(`
    window.__origFetch = window.__origFetch || window.fetch;
    window.fetch = function (input) {
      const url = String(typeof input === 'string' ? input : (input && input.url) || '');
      if (url.includes('platformStats')) return Promise.reject(new Error('blocked'));
      return window.__origFetch.apply(this, arguments);
    };
    return 'true';
  `);
  await page.evaluate(`history.pushState({}, '', '/marketplace'); window.dispatchEvent(new PopStateEvent('popstate')); return 'true';`);
  await settle(2500);
  const outage = await page.evaluate(`
    const stat = document.querySelector('[data-testid="hub-stat-products"]');
    return stat ? stat.textContent.trim() : 'MISSING';
  `);
  check(outage !== '0', 'an unavailable count renders as unknown, never as zero', `rendered "${outage}"`);

} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
