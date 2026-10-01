/**
 * ── THE BRAND, AS RENDERED ──────────────────────────────────────────────
 *
 * The brand-system test in server/brandSystem.test.ts reads source: it proves
 * there is one logo component, that the role rainbow is gone, and that the
 * tokens exist. None of that proves the logo is VISIBLE.
 *
 * The specific thing static assertions cannot see is the navbar. It sits
 * transparent over a dark hero on the homepage and solid on white internal
 * pages, and the logo has to read in both. Before this pass the wordmark
 * switched colour and the icon tile did not - it kept its blue gradient
 * against the blue hero it was sitting on. A source test would have called
 * that correct, because the component was "used".
 *
 * So this measures computed colour against measured background, checks for
 * horizontal overflow at the widths the brief names, and does it in English
 * and Arabic.
 */
import { launchBrowser } from './lib/cdp.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
await assertBuild(BASE);
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9600 + (process.pid % 90)));

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));

const browser = await launchBrowser({ port: CDP_PORT });

/** Set the UI language the way the app itself stores it. */
async function setLang(page, lang) {
  /* `buildhub_lang`, not `lang`. The shorter key looks right and is not the
     one the LanguageContext reads, so a probe using it silently tests English
     twice and reports RTL as passing. */
  await page.evaluate(`try { localStorage.setItem('buildhub_lang', '${lang}'); } catch {} ; return true;`);
}

try {
  /* ── 1. THE LOGO READS OVER THE DARK HERO ──────────────────────────── */
  {
    const page = await browser.newPage();
    /* EXPLICIT VIEWPORT. Without one the renderer picks a narrow default and
       the desktop navbar is never mounted - the probe then measures an
       unmounted mobile drawer and reports whatever it likes. */
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE}/`);
    await settle(1200);

    const hero = await page.evaluate(`
      var mark = document.querySelector('[data-testid="buildhub-mark"]');
      var word = document.querySelector('[data-testid="buildhub-wordmark"]');
      if (!mark || !word) { return JSON.stringify({ found: false }); }
      var nav = mark.closest('nav') || mark.closest('header');
      return JSON.stringify({
        found: true,
        markColor: getComputedStyle(mark).color,
        wordColor: getComputedStyle(word).color,
        navBg: nav ? getComputedStyle(nav).backgroundColor : null,
        markBox: mark.getBoundingClientRect().width,
        /* THE ACCENT NODE, SELECTED BY STRUCTURE.
           First attempt used querySelector('rect:last-of-type'), which returns
           the first match in DOCUMENT ORDER - and the four frame rects live
           inside a <g>, so it found the g's last rect, whose fill is set on
           the group rather than the element. It read null and reported a
           failure the product did not have.
           The accent rect is the only rect that is a DIRECT child of the svg,
           which is what ':scope > rect' says. */
        nodeFill: mark.querySelector(':scope > rect')
          ? mark.querySelector(':scope > rect').getAttribute('fill') : null
      });
    `);
    const h = JSON.parse(hero);
    check(h.found, 'homepage renders the shared brand component');
    /* Over the dark hero the mark must be light. rgb(255,255,255) is the
       inverse tone; anything dark means the tile is competing with the hero. */
    check(h.found && /255,\s*255,\s*255/.test(h.markColor),
      'mark is light over the dark hero', h.markColor);
    check(h.found && /255,\s*255,\s*255/.test(h.wordColor),
      'wordmark is light over the dark hero', h.wordColor);
    check(h.found && h.markBox >= 24,
      'mark is at least 24px wide, its stated floor', h.markBox + 'px');
    check(h.found && h.nodeFill && h.nodeFill.includes('brand-accent'),
      'accent node is a brand token, not a literal colour', String(h.nodeFill));
    await page.close();
  }

  /* ── 2. AND ON A WHITE INTERNAL PAGE ──────────────────────────────── */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE}/marketplace`);
    await settle(1200);
    const internal = await page.evaluate(`
      var mark = document.querySelector('[data-testid="buildhub-mark"]');
      if (!mark) { return JSON.stringify({ found: false }); }
      return JSON.stringify({ found: true, markColor: getComputedStyle(mark).color });
    `);
    const i = JSON.parse(internal);
    check(i.found, 'internal page renders the shared brand component');
    /* Must NOT be white here, or it vanishes against the page. */
    check(i.found && !/255,\s*255,\s*255/.test(i.markColor),
      'mark is NOT white on a light page', i.markColor);
    await page.close();
  }

  /* ── 3. NO HORIZONTAL OVERFLOW AT THE BRIEFED WIDTHS ──────────────── */
  for (const width of [320, 375, 390, 430]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 800 });
    await page.goto(`${BASE}/`);
    await settle(900);
    const overflow = await page.evaluate(`
      return JSON.stringify({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth
      });
    `);
    const o = JSON.parse(overflow);
    /* A couple of pixels is subpixel rounding; a real overflow is wider. */
    check(o.scrollW - o.clientW <= 2,
      `no sideways scroll at ${width}px`, `scroll ${o.scrollW} vs client ${o.clientW}`);
    await page.close();
  }

  /* ── 4. ARABIC / RTL ──────────────────────────────────────────────── */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE}/`);
    await setLang(page, 'ar');
    await page.goto(`${BASE}/`);
    await settle(1400);
    const rtl = await page.evaluate(`
      var html = document.documentElement;
      var mark = document.querySelector('[data-testid="buildhub-mark"]');
      var word = document.querySelector('[data-testid="buildhub-wordmark"]');
      if (!mark || !word) { return JSON.stringify({ found: false, dir: html.getAttribute('dir') }); }
      var m = mark.getBoundingClientRect(), w = word.getBoundingClientRect();
      return JSON.stringify({
        found: true,
        dir: html.getAttribute('dir'),
        lang: html.getAttribute('lang'),
        /* In RTL the lock-up should mirror: the mark sits to the RIGHT of the
           wordmark, because the flex row itself reverses. */
        markLeft: Math.round(m.left),
        wordLeft: Math.round(w.left),
        font: getComputedStyle(word).fontFamily,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth
      });
    `);
    const r = JSON.parse(rtl);
    check(r.dir === 'rtl', 'document direction is rtl in Arabic', String(r.dir));
    check(r.found, 'brand component renders in Arabic');
    check(r.found && r.markLeft > r.wordLeft,
      'lock-up mirrors: mark sits right of the wordmark in RTL',
      `mark ${r.markLeft} vs word ${r.wordLeft}`);
    check(r.found && /Cairo/i.test(r.font),
      'wordmark uses Cairo in Arabic', String(r.font));
    check(r.found && r.scrollW - r.clientW <= 2,
      'no sideways scroll in Arabic at 1440px', `${r.scrollW} vs ${r.clientW}`);
    await page.close();
  }

  /* ── 5. THE ROLE SECTION IS ONE ECOSYSTEM ─────────────────────────── */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1200 });
    await page.goto(`${BASE}/`);
    await settle(1400);
    const roles = await page.evaluate(`
      /* The six role icon containers: a sized rounded box holding an svg,
         inside the roles grid. Measured by computed background rather than by
         class name, so a hue reintroduced through any route is caught. */
      var svgs = Array.from(document.querySelectorAll('div.rounded-xl > svg'));
      var bgs = svgs.map(function (s) {
        return getComputedStyle(s.parentElement).backgroundColor;
      }).filter(function (c) { return c && c !== 'rgba(0, 0, 0, 0)'; });
      return JSON.stringify({ count: bgs.length, distinct: Array.from(new Set(bgs)) });
    `);
    const g = JSON.parse(roles);
    check(g.count >= 6, 'role icon containers render', g.count + ' found');
    /* Two treatments by design - brand tint, and the accent for the two
       commercially-transacting roles. Six would be the rainbow. */
    check(g.distinct.length > 0 && g.distinct.length <= 3,
      'role containers use at most 3 background treatments, not 6',
      g.distinct.length + ' distinct: ' + g.distinct.join(' | '));
    await page.close();
  }

  /* ── 6. THE FAVICON IS ACTUALLY SERVED ────────────────────────────── */
  {
    /* FETCHED, NOT NAVIGATED TO.
       The first version navigated the page to the .svg and read
       document.documentElement.textContent. A browser renders a standalone SVG
       as an IMAGE document, whose textContent is empty - so the probe reported
       the favicon missing while curl returned HTTP 200 with the right
       content-type and the file intact. Two failures that were entirely the
       instrument's. */
    const page = await browser.newPage();
    await page.goto(`${BASE}/`);
    await settle(400);
    const favicon = await page.evaluate(`
      return fetch('/brand/favicon.svg')
        .then(function (r) { return r.ok ? r.text() : 'HTTP ' + r.status; })
        .then(function (t) { return t.slice(0, 900); });
    `);
    check(/<svg|<rect/i.test(favicon), 'favicon.svg is served by the app',
      String(favicon).slice(0, 60));
    check(/f0a44a/i.test(favicon),
      'favicon keeps the accent node that distinguishes it at 16px');

    /* And the <link> actually points at it - a served file nothing references
       is not a favicon. */
    const linked = await page.evaluate(`
      var l = document.querySelector('link[rel="icon"]');
      return l ? l.getAttribute('href') : 'none';
    `);
    check(linked === '/brand/favicon.svg', 'the document links that favicon', linked);
    await page.close();
  }

} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
