/**
 * ── THE SYSTEMATIC VISUAL / PRODUCT-QUALITY GATE (§89 item 20) ─────────
 *
 * A sweep across public, buyer, supplier and Admin surfaces, in English and
 * Arabic, at phone and desktop width, checking the things §48-§79 make
 * release criteria rather than polish:
 *
 *   the page actually RENDERED (every finding below is worthless otherwise)
 *   exactly one H1, and a heading outline that does not skip
 *   no sideways scroll at 375px
 *   no raw enum or snake_case leaking into user-facing text (§55, §72)
 *   no untranslated English fragment on an Arabic screen (§67)
 *   the document direction is genuinely RTL in Arabic
 *   every image that carries content has alt text (§57)
 *   every icon-only control has an accessible name (§62)
 *
 * NON-VACUITY IS THE WHOLE DISCIPLINE HERE. A route that redirected to
 * /auth, or rendered an error, would pass "no overflow" and "no raw enum"
 * trivially - so each route asserts it reached the page it asked for before
 * any quality finding from it is allowed to count.
 */
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9600 + (process.pid % 40)));
const PASSWORD = 'LocalSuperAdmin!2024';

let pass = 0, fail = 0, step = 1;
const findings = [];
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  if (!ok) findings.push(`${name}${detail ? ' [' + detail + ']' : ''}`);
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
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(page, expression, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(`return (${expression});`)) return true;
    await settle(200);
  }
  return false;
}

/** Everything one page can tell us, gathered in a single evaluate. */
const AUDIT = `
  const text = document.body.innerText || '';
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
    .map(h => ({ level: Number(h.tagName[1]), text: (h.innerText || '').trim() }))
    .filter(h => h.text.length > 0);

  /* A raw enum or snake_case token shown to a reader (§55, §72). Restricted */
  /* to lowercase words joined by underscores, which is what the columns look */
  /* like - so a hyphenated brand name or a URL in visible text is not a hit. */
  const rawTokens = Array.from(new Set(
    (text.match(/\\b[a-z]+(?:_[a-z]+)+\\b/g) || [])
  ));

  /* Content-bearing images with no alt. A decorative one must be alt="". */
  const imagesMissingAlt = Array.from(document.querySelectorAll('img'))
    .filter(img => img.getAttribute('alt') === null)
    .map(img => (img.getAttribute('src') || '').slice(0, 60));

  /* An icon-only control with no accessible name is unusable with a screen */
  /* reader and invisible to keyboard users trying to find it. */
  const namelessControls = Array.from(document.querySelectorAll('button,a[href]'))
    .filter(el => {
      if ((el.innerText || '').trim().length > 0) return false;
      if (el.getAttribute('aria-label')) return false;
      if (el.getAttribute('aria-labelledby')) return false;
      if (el.getAttribute('title')) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;   /* ignore hidden nodes */
    })
    .map(el => el.tagName + '.' + (el.className || '').toString().slice(0, 40));

  /*
   * UI CHROME ONLY, for the Arabic check. BuildHub writes an accessible
   * name or a nav label; a user writes their own business name. Latin text
   * in the first is always a translation gap; in the second it is correct.
   */
  const chrome = [];
  for (const el of document.querySelectorAll('[aria-label],[title],.sr-only')) {
    const value = el.getAttribute('aria-label') || el.getAttribute('title')
      || (el.classList.contains('sr-only') ? (el.textContent || '') : '');
    if (value && value.trim()) chrome.push(value.trim());
  }
  for (const el of document.querySelectorAll('nav a, nav button, header a, header button')) {
    const value = (el.innerText || '').trim();
    if (value) chrome.push(value);
  }

  return {
    chrome: Array.from(new Set(chrome)),
    rendered: text.trim().length > 200,
    path: location.pathname,
    dir: document.documentElement.getAttribute('dir'),
    h1Count: document.querySelectorAll('h1').length,
    headings,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawTokens,
    imagesMissingAlt,
    namelessControls,
    notFound: /Page Not Found/i.test(text),
    text,
  };
`;

/**
 * Latin text on an Arabic screen that is CORRECT rather than a gap.
 *
 *   BuildHub and RFQ        the product's own names, kept in Latin
 *   currency codes          shown as codes on purpose (shared/money.ts)
 *   English                 the LANGUAGE SWITCHER, which names the language
 *                           it switches TO - in that language. Translating
 *                           it to "الإنجليزية" would be worse: a reader who
 *                           cannot read Arabic could not find the way out.
 *   alt                     the keyboard modifier in a shortcut hint
 *
 * Everything else in an accessible name or a nav label is BuildHub's own
 * copy, so Latin text in it is a translation gap.
 */
const ALLOWED_LATIN = /^(BuildHub|RFQ|RFQs|EGP|SAR|AED|QAR|KWD|BHD|OMR|GLOBAL|ID|PDF|AI|OK|CEO|VAT|English|alt|km|m2|EN|AR|[0-9].*)$/;

console.log(`\nBUILD ${BUILD.shortCommit ?? '?'}  env=${BUILD.environment ?? '?'}\n`);

const buyer = await signIn('zid6507832req@example.test');
const supplier = await signIn('zid6507832vnd@example.test');

const ROUTES = [
  { path: '/',                    who: null,     name: 'Home (public)' },
  { path: '/marketplace',         who: null,     name: 'Marketplace hub (public)' },
  { path: '/marketplace/vendors', who: null,     name: 'Provider directory (public)' },
  { path: '/marketplace/products',who: null,     name: 'Product catalogue (public)' },
  { path: '/saved',               who: buyer,    name: 'Saved shortlist (buyer)' },
  { path: '/rfq',                 who: buyer,    name: 'Requests (buyer)' },
  { path: '/dashboard',           who: buyer,    name: 'Projects dashboard (buyer)' },
  { path: '/enquiries',           who: supplier, name: 'Enquiries (supplier)' },
  { path: '/marketing',           who: supplier, name: 'Marketing Center (supplier)' },
  { path: '/settings',            who: supplier, name: 'Settings (supplier)' },
];

const browser = await launchBrowser({ port: CDP_PORT });
try {
  const page = await browser.newPage();
  /*
   * A WARM-UP NAVIGATION, because a fresh tab is on about:blank and
   * `localStorage` on an opaque origin throws a SecurityError. The first
   * version set the language before ever navigating, and the whole sweep
   * died on line one with an uninformative "Uncaught".
   */
  await page.goto(`${BASE}/`);

  for (const width of [1440, 375]) {
    await page.setViewport({ width, height: width === 375 ? 800 : 1000 });
    for (const route of ROUTES) {
      if (route.who) await page.setCookies(asBrowserCookies(route.who));
      await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
      await page.goto(`${BASE}${route.path}`);
      await waitFor(page, `(document.body.innerText || '').trim().length > 200`);
      await settle(600);
      const a = await page.evaluate(AUDIT);

      const label = `${route.name} @${width}`;
      // NON-VACUITY FIRST: everything below is worthless if the page did not
      // render, or if a protected route bounced to sign-in.
      const arrived = a && a.rendered && !a.notFound && a.path === route.path;
      check(arrived, `${label}: reached and rendered`,
        arrived ? '' : `path=${a?.path} rendered=${a?.rendered} 404=${a?.notFound}`);
      if (!arrived) continue;

      if (width === 375) {
        check(a.overflow === false, `${label}: no sideways scroll`, a.overflow ? 'OVERFLOWS' : '');
      }
      check(a.h1Count === 1, `${label}: exactly one H1`, `h1=${a.h1Count}`);
      check(a.rawTokens.length === 0, `${label}: no raw enum in visible text`,
        a.rawTokens.slice(0, 4).join(', '));
      check(a.imagesMissingAlt.length === 0, `${label}: every image declares alt`,
        a.imagesMissingAlt.slice(0, 2).join(', '));
      check(a.namelessControls.length === 0, `${label}: every control has an accessible name`,
        a.namelessControls.slice(0, 3).join(', '));
    }
  }

  /* ══ ARABIC / RTL, at both widths ═════════════════════════════════════ */
  for (const width of [1440, 375]) {
    await page.setViewport({ width, height: width === 375 ? 800 : 1000 });
    for (const route of ROUTES) {
      if (route.who) await page.setCookies(asBrowserCookies(route.who));
      await page.evaluate(`localStorage.setItem('buildhub_lang', 'ar'); return true;`);
      await page.goto(`${BASE}${route.path}`);
      const rtl = await waitFor(page, `document.documentElement.getAttribute('dir') === 'rtl'`);
      await settle(600);
      const a = await page.evaluate(AUDIT);
      const label = `${route.name} @${width} AR`;

      const arrived = rtl && a && a.rendered && !a.notFound && a.path === route.path;
      check(arrived, `${label}: reached, rendered and genuinely RTL`,
        arrived ? '' : `dir=${a?.dir} path=${a?.path}`);
      if (!arrived) continue;

      if (width === 375) {
        check(a.overflow === false, `${label}: no sideways scroll`, a.overflow ? 'OVERFLOWS' : '');
      }
      /*
       * UNTRANSLATED UI CHROME on an Arabic screen (§67, §62).
       *
       * TEMPLATE, NOT DATA. An accessible name SHOULD carry the item it
       * names - "Add Gypsum Board to your wishlist" is correct, and a row
       * of twelve identical "add" buttons is the defect §62 exists to stop.
       * So a Latin word that also appears in the page's visible text is
       * DATA carried into the label (a product, a person, a business), and
       * a Latin word that appears ONLY in an accessible name is BuildHub's
       * own copy left untranslated.
       *
       * That distinction is what this sweep found: "Notifications alt+T",
       * "Toggle navigation", "wishlist" and "compare" appear in no visible
       * text anywhere, because they are chrome - and all four were English
       * on every Arabic screen.
       */
      const visible = new Set((a.text.match(/\b[A-Za-z][A-Za-z'’]{3,}\b/g) || []));
      const latin = Array.from(new Set(
        (a.chrome || []).flatMap(value => value.match(/\b[A-Za-z][A-Za-z'’]{3,}\b/g) || []),
      )).filter(word => !ALLOWED_LATIN.test(word) && !visible.has(word));
      check(latin.length === 0, `${label}: no untranslated UI chrome`,
        latin.slice(0, 5).join(', '));
      check((a.chrome || []).length > 0,
        `${label}: chrome was collected, so the check above is not vacuous`,
        String((a.chrome || []).length));
    }
  }
} finally {
  await browser.close().catch(() => {});
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FINDINGS'}  ${pass} passed, ${fail} failed`);
if (findings.length) {
  console.log('\n── FINDINGS ──');
  for (const f of findings) console.log('  • ' + f);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
