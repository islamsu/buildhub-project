/**
 * ── THE TOP OF THE MOBILE HOMEPAGE, MEASURED ──────────────────────────────
 *
 * The owner reviewed the real staging site on a phone and said the area above
 * the (now accepted) Explore RAKIZA section needed attention. The audit this
 * probe was written for answered the first question - is anything actually
 * broken - and the answer was no: nothing clipped, nothing under the fixed
 * header, no overflow at any of ten viewports. The screenshot reproduced
 * exactly at scrollY 1100 as ordinary mid-scroll framing.
 *
 * What was real was the HEIGHT. At 375 the hero ran 1414px - 1.68 phone
 * screens - before Explore began, with a third of it spent on a four-item
 * trust strip rendered in ONE column.
 *
 * So this exists to keep that honest in both directions: it reports the
 * composition rather than asserting a pixel budget, and it hard-fails only on
 * the things that are absolutely wrong however the design evolves - clipped
 * copy, content hidden behind the header, horizontal overflow, or body text
 * below a readable size. A density pass that hits its number by any of those
 * has not improved anything.
 *
 *   ZG_OUT=before.json ZG_LABEL=baseline node evidence/zg-hometop.mjs
 *   ZG_OUT=after.json  ZG_LABEL=refined  node evidence/zg-hometop.mjs
 *   node evidence/zg-hometop.mjs --compare before.json after.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './lib/cdp.mjs';
import { assertBuild } from './lib/build.mjs';

if (process.argv[2] === '--compare') {
  const [before, after] = [3, 4].map(i => JSON.parse(readFileSync(process.argv[i], 'utf8')));
  const by = rows => Object.fromEntries(rows.map(m => [`${m.lang}@${m.width}`, m]));
  const [b, a] = [by(before.measurements), by(after.measurements)];
  const pct = (x, y) => x === 0 ? 'n/a' : `${y > x ? '+' : ''}${(((y - x) / x) * 100).toFixed(0)}%`;
  const pad = (v, n) => String(v).padEnd(n);
  console.log(`${pad('view', 9)}${pad('hero height', 26)}${pad('screens', 16)}`
    + `${pad('nav gap', 13)}${pad('subtitle', 11)}${pad('trust', 22)}${pad('explore@', 22)}`);
  for (const k of Object.keys(b)) {
    if (!a[k]) continue;
    const [x, y] = [b[k], a[k]];
    console.log(pad(k, 9)
      + pad(`${x.heroHeight} -> ${y.heroHeight} (${pct(x.heroHeight, y.heroHeight)})`, 26)
      + pad(`${x.heroScreens} -> ${y.heroScreens}`, 16)
      + pad(`${x.navGap} -> ${y.navGap}px`, 13)
      + pad(`${x.subtitleLines} -> ${y.subtitleLines}L`, 11)
      + pad(`${x.trustCols}col ${x.trustHeight} -> ${y.trustCols}col ${y.trustHeight}`, 22)
      + pad(`${x.exploreTop} -> ${y.exploreTop}`, 22));
  }
  process.exit(0);
}

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const build = await assertBuild(BASE);
const LABEL = process.env.ZG_LABEL ?? 'unlabelled';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9880 + (process.pid % 60)));

/* 375 is the owner-reviewed width; 393 a current iPhone; 430 a large phone;
   768 and 1440 the tablet and desktop widths the brief names. 844 tall is a
   real phone viewport, which is what makes "screens of scrolling" meaningful. */
const WIDTHS = [375, 393, 430, 768, 1440];
let hardFail = 0;
const measurements = [];

const browser = await launchBrowser({ port: CDP_PORT });
const settle = (ms = 1600) => new Promise(r => setTimeout(r, ms));

try {
  for (const lang of ['en', 'ar']) {
    for (const width of WIDTHS) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 844 });
      await page.goto(`${BASE}/`);
      await page.evaluate(`try { localStorage.setItem('buildhub_lang', '${lang}'); } catch {} ; return true;`);
      await page.goto(`${BASE}/`);
      await settle();

      const raw = await page.evaluate(`
        function box(el) {
          if (!el) { return null; }
          var r = el.getBoundingClientRect();
          return {
            top: Math.round(r.top + window.scrollY), bottom: Math.round(r.bottom + window.scrollY),
            h: Math.round(r.height), w: Math.round(r.width),
          };
        }
        function lines(el) {
          if (!el) { return 0; }
          var cs = getComputedStyle(el);
          var lh = parseFloat(cs.lineHeight);
          if (!isFinite(lh) || lh <= 0) { lh = parseFloat(cs.fontSize) * 1.3; }
          return Math.max(1, Math.round(el.getBoundingClientRect().height / lh));
        }
        /* Copy the reader cannot finish: taller than its box, with the
           overflow hidden. One of the forbidden ways to save height. */
        function clipped(el) {
          if (!el) { return false; }
          var cs = getComputedStyle(el);
          var hides = cs.overflow === 'hidden' || cs.overflowY === 'hidden';
          return hides && el.scrollHeight > el.clientHeight + 1;
        }

        var nav = document.querySelector('nav');
        var hero = document.querySelector('section.gradient-hero');
        var h1 = hero ? hero.querySelector('h1') : null;
        var badge = hero ? hero.querySelector('.rounded-full.border') : null;
        var subtitle = hero ? hero.querySelector('p.max-w-xl') : null;
        var search = document.querySelector('[data-testid="sourcing-search"]');
        var input = document.querySelector('[data-testid="sourcing-search-input"]');
        var ctaA = document.querySelector('[data-testid="hero-cta-rfq"]');
        var ctaB = document.querySelector('[data-testid="hero-cta-marketplace"]');
        var trust = document.querySelector('[data-testid="home-trust-strip"]');
        var stats = document.querySelector('[data-testid="platform-stats"]');
        var explore = document.querySelector('[data-testid="home-explore"]');

        var navH = nav ? Math.round(nav.getBoundingClientRect().height) : 0;
        var heroBox = hero ? hero.getBoundingClientRect() : null;

        /* SPILL: with the hero carrying overflow-hidden, does any descendant
           extend past its box? That is what a real clipping defect looks like. */
        var spill = [];
        if (hero) {
          [].slice.call(hero.querySelectorAll('[data-testid], h1, p, li, ul')).forEach(function (el) {
            var r = el.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) { return; }
            var over = Math.max(
              Math.round(r.bottom - heroBox.bottom),
              Math.round(r.right - heroBox.right),
              Math.round(heroBox.left - r.left));
            if (over > 1) { spill.push((el.getAttribute('data-testid') || el.tagName) + '+' + over); }
          });
        }
        /* UNDER THE HEADER at rest: hero text inside the fixed navbar's band. */
        var hidden = [];
        if (hero) {
          [].slice.call(hero.querySelectorAll('h1, p, li')).forEach(function (el) {
            var r = el.getBoundingClientRect();
            if (r.height < 4) { return; }
            if (r.top < navH && r.bottom > 0) { hidden.push(el.tagName + '@' + Math.round(r.top)); }
          });
        }

        var trustItems = trust ? [].slice.call(trust.children).map(function (li) {
          return Math.round(li.getBoundingClientRect().height);
        }) : [];
        var statTiles = stats ? [].slice.call(stats.children).map(function (d) {
          var ps = d.querySelectorAll('p');
          return {
            value: (ps[0] ? ps[0].textContent : '').trim(),
            label: (ps[1] ? ps[1].textContent : '').trim(),
          };
        }) : [];

        var firstContent = badge || h1;
        return JSON.stringify({
          dir: document.documentElement.getAttribute('dir'),
          vh: window.innerHeight,
          navH: navH,
          navPosition: nav ? getComputedStyle(nav).position : 'none',
          heroOverflow: hero ? getComputedStyle(hero).overflow : 'none',
          hero: box(hero), h1: box(h1), badge: box(badge), subtitle: box(subtitle),
          search: box(search), ctaA: box(ctaA), ctaB: box(ctaB),
          trust: box(trust), stats: box(stats), explore: box(explore),
          /* The gap the audit named: navbar bottom edge to the first thing in
             the hero. 48px of nothing at 375 before this pass. */
          navGap: firstContent ? Math.round(firstContent.getBoundingClientRect().top) - navH : null,
          h1Lines: lines(h1),
          h1Font: h1 ? Math.round(parseFloat(getComputedStyle(h1).fontSize)) : 0,
          subtitleLines: lines(subtitle),
          subtitleFont: subtitle ? Math.round(parseFloat(getComputedStyle(subtitle).fontSize)) : 0,
          inputFont: input ? Math.round(parseFloat(getComputedStyle(input).fontSize)) : 0,
          trustCols: trust ? getComputedStyle(trust).gridTemplateColumns.split(' ').length : 0,
          trustItems: trustItems,
          statCols: stats ? getComputedStyle(stats).gridTemplateColumns.split(' ').length : 0,
          statTiles: statTiles,
          clipped: [].slice.call(document.querySelectorAll('section.gradient-hero p, section.gradient-hero h1, section.gradient-hero li'))
            .filter(clipped).length,
          docOverflow: document.documentElement.scrollWidth - window.innerWidth,
          spill: spill, hiddenUnderHeader: hidden,
        });
      `);
      const m = JSON.parse(raw);
      if (!m.hero) throw new Error(`no hero section at ${lang}@${width}`);

      const row = {
        lang, width, dir: m.dir, vh: m.vh,
        navH: m.navH, navPosition: m.navPosition, navGap: m.navGap,
        heroHeight: m.hero.h,
        heroScreens: Number((m.hero.h / m.vh).toFixed(2)),
        h1Lines: m.h1Lines, h1Font: m.h1Font,
        subtitleLines: m.subtitleLines, subtitleFont: m.subtitleFont,
        ctaHeight: m.ctaA && m.ctaB ? m.ctaB.bottom - m.ctaA.top : 0,
        searchHeight: m.search?.h ?? 0,
        inputFont: m.inputFont,
        trustCols: m.trustCols, trustHeight: m.trust?.h ?? 0, trustItems: m.trustItems,
        statCols: m.statCols, statHeight: m.stats?.h ?? 0, statTiles: m.statTiles,
        exploreTop: m.explore?.top ?? -1,
        exploreScreens: m.explore ? Number((m.explore.top / m.vh).toFixed(2)) : -1,
        docOverflow: m.docOverflow,
        clipped: m.clipped, spill: m.spill, hiddenUnderHeader: m.hiddenUnderHeader,
        heroOverflow: m.heroOverflow,
      };
      measurements.push(row);

      /* ── THE ABSOLUTE RULES. Everything else is reported, not judged. ──── */
      const bad = [];
      if (row.docOverflow > 0) bad.push(`horizontal overflow ${row.docOverflow}px`);
      if (row.clipped > 0) bad.push(`${row.clipped} clipped text node(s)`);
      if (row.spill.length > 0) bad.push(`spills the hero box: ${row.spill.join(', ')}`);
      if (row.hiddenUnderHeader.length > 0) {
        bad.push(`under the fixed header: ${row.hiddenUnderHeader.join(', ')}`);
      }
      /* THE 16px INPUT RULE IS A PHONE RULE, and the first version of this
         applied it everywhere. iOS zooms the viewport when a focused input is
         under 16px - that is a touch-keyboard behaviour, so 14px at 768 and
         1440 is a deliberate desktop size, not a defect. Four viewports failed
         on the probe's own over-reach before this was narrowed.

         The body-copy floor is NOT narrowed: 16px stays the minimum at every
         width, because shrinking type is not a density technique. */
      const phone = row.width < 640;
      if (phone && row.inputFont < 16) {
        bad.push(`search input ${row.inputFont}px on a phone, under 16`);
      }
      if (row.subtitleFont < 16) bad.push(`hero subtitle ${row.subtitleFont}px, under 16`);
      if (row.trustItems.length !== 4) bad.push(`${row.trustItems.length} trust statements, not 4`);
      if (bad.length > 0) { hardFail++; console.error(`FAIL ${lang}@${width}: ${bad.join('; ')}`); }

      await page.close();
    }
  }
} finally {
  await browser.close();
}

const out = { label: LABEL, build: build?.shortCommit ?? 'unknown', measurements };
if (process.env.ZG_OUT) writeFileSync(process.env.ZG_OUT, JSON.stringify(out, null, 1));

const pad = (v, n) => String(v).padStart(n);
console.log(`\nMOBILE HOMEPAGE TOP  label=${LABEL}  build=${out.build}`);
console.log(`${'view'.padEnd(9)}${pad('hero', 6)}${pad('scrn', 6)}${pad('navGap', 7)}${pad('h1', 4)}`
  + `${pad('subL', 5)}${pad('subPx', 6)}${pad('cta', 5)}${pad('tCol', 5)}${pad('trust', 6)}`
  + `${pad('sCol', 5)}${pad('stats', 6)}${pad('explore@', 9)}${pad('scrn', 6)}${pad('ovf', 5)}`);
for (const m of measurements) {
  console.log(`${`${m.lang}@${m.width}`.padEnd(9)}${pad(m.heroHeight, 6)}${pad(m.heroScreens, 6)}`
    + `${pad(m.navGap, 7)}${pad(m.h1Lines, 4)}${pad(m.subtitleLines, 5)}${pad(m.subtitleFont, 6)}`
    + `${pad(m.ctaHeight, 5)}${pad(m.trustCols, 5)}${pad(m.trustHeight, 6)}${pad(m.statCols, 5)}`
    + `${pad(m.statHeight, 6)}${pad(m.exploreTop, 9)}${pad(m.exploreScreens, 6)}${pad(m.docOverflow, 5)}`);
}
console.log(`\nstat labels (375): EN ${JSON.stringify(measurements.find(m => m.lang === 'en' && m.width === 375)?.statTiles)}`);
console.log(`                   AR ${JSON.stringify(measurements.find(m => m.lang === 'ar' && m.width === 375)?.statTiles)}`);
if (hardFail > 0) { console.error(`\n${hardFail} viewport(s) broke an absolute rule`); process.exit(1); }
console.log(`\nOK  nothing clipped, nothing under the header, no overflow,`
  + ` body text readable, four trust statements everywhere`);
