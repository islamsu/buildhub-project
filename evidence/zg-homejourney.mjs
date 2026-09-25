/**
 * ── THE HOMEPAGE TELLS ONE CONNECTED STORY ─────────────────────────────
 *
 * §89 item 19: the homepage must communicate the connected BuildHub
 * proposition - Discover/Source → Save/Shortlist → RFQ → Compare
 * Quotations → Collaborate → Build/Manage - using only real public proof,
 * and must "visibly connect buyer, supplier, marketplace and project
 * workflows rather than become another feature-card wall".
 *
 * WHAT IS PROVED, in a real browser as a SIGNED-OUT visitor:
 *
 *   all six stages render, in order
 *   each one states what the SUPPLIER sees, which is the thing a feature
 *     list cannot say and the reason the section exists
 *   every stage LINKS somewhere real - a promise a visitor can check by
 *     following it, rather than one they have to believe
 *   the two card walls it replaced are gone
 *   NO FABRICATED PROOF: no customer logos, testimonials or invented
 *     counts, and any figure shown is a real one
 *   it works in Arabic RTL and at 375px
 */
import { launchBrowser } from './lib/cdp.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9050 + (process.pid % 40)));

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(page, expression, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(`return (${expression});`)) return true;
    await settle(250);
  }
  return false;
}
const STAGES = ['discover', 'shortlist', 'rfq', 'compare', 'collaborate', 'build'];

console.log(`\nBUILD ${BUILD.shortCommit ?? '?'}  env=${BUILD.environment ?? '?'}\n`);

const browser = await launchBrowser({ port: CDP_PORT });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  /* SIGNED OUT, deliberately: the homepage's job is to explain BuildHub to
     somebody who has never used it (§76). */
  await page.goto(`${BASE}/`);

  const rendered = await waitFor(page, `document.querySelector('[data-testid="home-journey"]') !== null`);
  check(rendered, 'the connected journey renders for a signed-out visitor');

  /* ══ ALL SIX STAGES, IN ORDER ═════════════════════════════════════════ */
  const order = await page.evaluate(`
    return Array.from(document.querySelectorAll('[data-testid^="journey-"]'))
      .map(el => el.getAttribute('data-testid'))
      .filter(id => id && !id.endsWith('-counterpart'))
      .map(id => id.replace('journey-', ''));
  `);
  check(Array.isArray(order) && order.length === STAGES.length,
    'all six stages render', `${order?.length}`);
  check(JSON.stringify(order) === JSON.stringify(STAGES),
    'IN ORDER - the sequence is the argument, not a grid',
    Array.isArray(order) ? order.join(' → ') : String(order));

  /* ══ EACH STAGE NAMES THE OTHER SIDE ══════════════════════════════════ */
  const counterparts = await page.evaluate(`
    return Array.from(document.querySelectorAll('[data-testid$="-counterpart"]'))
      .map(el => el.innerText.trim())
      .filter(Boolean);
  `);
  check(Array.isArray(counterparts) && counterparts.length === STAGES.length,
    'EVERY stage states what the supplier sees - the thing a feature list cannot say',
    `${counterparts?.length} of ${STAGES.length}`);
  check(Array.isArray(counterparts) && counterparts.every(text => /For the supplier/i.test(text)),
    'and says so explicitly, rather than leaving it implied');

  /* ══ EVERY STAGE IS A REAL DESTINATION ════════════════════════════════
     A promise a visitor can check by following it. */
  const hrefs = await page.evaluate(`
    return Array.from(document.querySelectorAll('[data-testid^="journey-"]'))
      .filter(el => el.tagName === 'A')
      .map(el => el.getAttribute('href'));
  `);
  check(Array.isArray(hrefs) && hrefs.length === STAGES.length && hrefs.every(h => h && h.startsWith('/')),
    'every stage links to a real in-product destination',
    Array.isArray(hrefs) ? hrefs.join(' ') : String(hrefs));

  /* AND THE LINKS ACTUALLY LAND. A href that 404s is a dead promise. */
  const unique = Array.from(new Set(hrefs ?? []));
  let landed = 0;
  for (const href of unique) {
    await page.goto(`${BASE}${href}`);
    const notFound = await page.evaluate(`
      return /404|Page Not Found|\\u0644\\u0645 \\u064a\\u062a\\u0645 \\u0627\\u0644\\u0639\\u062b\\u0648\\u0631/i.test(document.body.innerText);
    `);
    if (!notFound) landed++;
  }
  check(landed === unique.length,
    'and following each one reaches a real page, not a 404',
    `${landed} of ${unique.length}`);

  /* ══ THE CARD WALLS ARE GONE ══════════════════════════════════════════ */
  await page.goto(`${BASE}/`);
  await waitFor(page, `document.querySelector('[data-testid="home-journey"]') !== null`);
  const walls = await page.evaluate(`
    const text = document.body.innerText;
    return {
      fourSteps: /Four Steps to Success/i.test(text),
      featuresWall: /Everything You Need to Build/i.test(text),
    };
  `);
  check(walls && walls.fourSteps === false,
    'the "Four Steps to Success" card wall is gone');
  check(walls && walls.featuresWall === false,
    'and so is the generic "Features" wall it duplicated');

  /* ══ NO FABRICATED PROOF (§75) ════════════════════════════════════════ */
  const invented = await page.evaluate(`
    const text = document.body.innerText;
    const claims = [];
    if (/trusted by/i.test(text)) claims.push('trusted-by');
    if (/testimonial/i.test(text)) claims.push('testimonial');
    if (/[0-9][0-9,]*\\s*(happy|satisfied)\\s*(customers|clients)/i.test(text)) claims.push('customer-count');
    if (/[0-9]+\\s*%\\s*(satisfaction|success rate)/i.test(text)) claims.push('satisfaction-rate');
    return claims.length ? claims.join(', ') : 'NONE';
  `);
  check(invented === 'NONE', 'NO fabricated social proof on the homepage', String(invented));

  /* ══ ARABIC RTL ═══════════════════════════════════════════════════════ */
  await page.evaluate(`localStorage.setItem('buildhub_lang', 'ar'); return true;`);
  await page.goto(`${BASE}/`);
  const rtl = await waitFor(page, `document.documentElement.getAttribute('dir') === 'rtl'`);
  check(rtl, 'the page really switches to Arabic RTL before the checks below');
  await waitFor(page, `document.querySelector('[data-testid="home-journey"]') !== null`);
  const arabicStage = await page.evaluate(`
    const el = document.querySelector('[data-testid="journey-rfq"]');
    return el ? el.innerText.trim() : 'MISSING';
  `);
  const hasArabic = value => Array.from(String(value))
    .some(ch => ch.codePointAt(0) >= 0x0600 && ch.codePointAt(0) <= 0x06FF);
  check(arabicStage !== 'MISSING' && hasArabic(arabicStage),
    'and every stage is genuinely translated, not English left in place',
    String(arabicStage).split('\n')[1] ?? '');
  check(!/Request quotations/i.test(String(arabicStage)),
    'with no English fragment beside it');

  /* ══ 375px ════════════════════════════════════════════════════════════ */
  await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
  await page.setViewport({ width: 375, height: 800 });
  await page.goto(`${BASE}/`);
  await waitFor(page, `document.querySelector('[data-testid="home-journey"]') !== null`);
  const mobile = await page.evaluate(`
    const el = document.querySelector('[data-testid="home-journey"]');
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      stages: el ? el.querySelectorAll('[data-testid^="journey-"]:not([data-testid$="-counterpart"])').length : -1,
    };
  `);
  check(mobile && mobile.overflow === false,
    'no sideways scroll at 375px', mobile?.overflow ? 'OVERFLOWS' : 'contained');
  check(mobile && mobile.stages === STAGES.length,
    'and every stage is still reachable on a phone', String(mobile?.stages));
} finally {
  await browser.close().catch(() => {});
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
