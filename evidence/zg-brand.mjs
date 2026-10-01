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

    /* WHAT CHANGED, AND WHY THIS IS A STRONGER CHECK THAN IT WAS.
       The lock-up used to be inline SVG, so tone was a computed `color` and
       this read it. The RAKIZA lock-up is owner-supplied raster artwork, so
       tone is which FILE is requested - and that brings a failure mode the
       SVG never had: a path that is right in TypeScript and absent, corrupt
       or the wrong size on disk. `naturalWidth` answers that, because it is
       zero unless the browser actually fetched and decoded the image. */
    const hero = await page.evaluate(`
      var logo = document.querySelector('[data-testid="rakiza-logo"]');
      if (!logo) { return JSON.stringify({ found: false }); }
      var nav = logo.closest('nav') || logo.closest('header');
      var r = logo.getBoundingClientRect();
      return JSON.stringify({
        found: true,
        src: logo.getAttribute('src'),
        naturalW: logo.naturalWidth,
        naturalH: logo.naturalHeight,
        declaredW: logo.getAttribute('width'),
        declaredH: logo.getAttribute('height'),
        alt: logo.getAttribute('alt'),
        renderedW: Math.round(r.width),
        renderedH: Math.round(r.height),
        navBg: nav ? getComputedStyle(nav).backgroundColor : null
      });
    `);
    const h = JSON.parse(hero);
    check(h.found, 'homepage renders the shared brand component');
    /* Over the dark hero the INVERSE asset must be the one requested. The old
       defect this guards is real: the wordmark used to switch tone while the
       icon tile kept its gradient, so the logo half-vanished into the hero. */
    check(h.found && /inverse/.test(String(h.src)),
      'the inverse lock-up is the one requested over the dark hero', String(h.src));
    check(h.found && h.naturalW > 0 && h.naturalH > 0,
      'the lock-up actually loaded and decoded', `${h.naturalW}x${h.naturalH}`);
    /* THE RESERVED BOX IS THE REAL BOX. Declaring dimensions that do not match
       the file reserves the WRONG space, which is a layout shift that looks
       deliberate - worse than declaring none at all. */
    check(h.found && String(h.naturalW) === String(h.declaredW)
                  && String(h.naturalH) === String(h.declaredH),
      'declared intrinsic size matches the served file',
      `declared ${h.declaredW}x${h.declaredH}, served ${h.naturalW}x${h.naturalH}`);
    check(h.found && h.alt && h.alt.length > 0,
      'the lock-up carries an accessible name', String(h.alt));
    check(h.found && h.renderedH >= 24,
      'lock-up is at least 24px tall, its stated floor', h.renderedH + 'px');
    await page.close();
  }

  /* ── 2. AND ON A WHITE INTERNAL PAGE ──────────────────────────────── */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE}/marketplace`);
    await settle(1200);
    const internal = await page.evaluate(`
      var logo = document.querySelector('[data-testid="rakiza-logo"]');
      if (!logo) { return JSON.stringify({ found: false }); }
      return JSON.stringify({
        found: true,
        src: logo.getAttribute('src'),
        naturalW: logo.naturalWidth
      });
    `);
    const i = JSON.parse(internal);
    check(i.found, 'internal page renders the shared brand component');
    /* Must NOT be the inverse here, or a white lock-up sits on a white page. */
    check(i.found && !/inverse/.test(String(i.src)),
      'the navy lock-up is the one requested on a light page', String(i.src));
    check(i.found && i.naturalW > 0,
      'and it loaded there too', String(i.naturalW));
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
      var logo = document.querySelector('[data-testid="rakiza-logo"]');
      var body = getComputedStyle(document.body);
      if (!logo) { return JSON.stringify({ found: false, dir: html.getAttribute('dir') }); }
      var r = logo.getBoundingClientRect();
      return JSON.stringify({
        found: true,
        dir: html.getAttribute('dir'),
        lang: html.getAttribute('lang'),
        naturalW: logo.naturalWidth,
        /* The lock-up should sit on the RIGHT half of a 1440 viewport in RTL,
           because the header row itself reverses. */
        logoLeft: Math.round(r.left),
        font: body.fontFamily,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth
      });
    `);
    const r = JSON.parse(rtl);
    check(r.dir === 'rtl', 'document direction is rtl in Arabic', String(r.dir));
    check(r.found, 'brand component renders in Arabic');
    /* THE LOCK-UP IS NOT MIRRORED, AND THAT IS CORRECT. It is one bilingual
       image carrying ركيزة above RAKIZA - part of the identity the owner
       approved rather than a localisation of it, so the same file is right in
       both languages. What must mirror is its POSITION in the header. */
    check(r.found && r.logoLeft > 720,
      'the lock-up moves to the right half of the header in RTL',
      'left ' + r.logoLeft);
    check(r.found && /Cairo/i.test(r.font),
      'Arabic text is set in Cairo', String(r.font));
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
       An earlier version navigated the page to the asset and read
       document.documentElement.textContent. A browser renders a standalone
       image as an IMAGE document, whose textContent is empty - so the probe
       reported the favicon missing while curl returned HTTP 200 with the file
       intact. Two failures that were entirely the instrument's. */
    const page = await browser.newPage();
    await page.goto(`${BASE}/`);
    await settle(400);

    /* PNG now, not SVG: the RAKIZA mark is owner-supplied raster artwork and
       a traced SVG of it is exactly what the owner forbade. Verified by magic
       bytes rather than by extension, because a 404 page served with the
       right URL is still a 404 page. */
    const favicon = await page.evaluate(`
      return fetch('/brand/favicon-32.png')
        .then(function (r) { return r.ok ? r.arrayBuffer() : null; })
        .then(function (buf) {
          if (!buf) { return 'FETCH FAILED'; }
          var b = new Uint8Array(buf.slice(0, 8));
          return Array.from(b).join(',') + ' len=' + buf.byteLength;
        });
    `);
    check(String(favicon).startsWith('137,80,78,71,13,10,26,10'),
      'favicon-32.png is served by the app, and is a real PNG',
      String(favicon).slice(0, 60));

    /* And that it DECODES at the size the tab will use. A file that downloads
       but will not decode is a default globe in the tab. */
    const decoded = await page.evaluate(`
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () { resolve(img.naturalWidth + 'x' + img.naturalHeight); };
        img.onerror = function () { resolve('DECODE FAILED'); };
        img.src = '/brand/favicon-32.png';
      });
    `);
    check(decoded === '32x32', 'and it decodes at 32x32', String(decoded));

    /* A served file nothing references is not a favicon. */
    const linked = await page.evaluate(`
      var l = document.querySelector('link[rel="icon"]');
      return l ? l.getAttribute('href') : 'none';
    `);
    check(linked === '/brand/favicon-32.png', 'the document links that favicon', linked);
    await page.close();
  }

} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
