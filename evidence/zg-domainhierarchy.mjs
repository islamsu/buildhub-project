/**
 * ── THE HIERARCHY, AS RENDERED ──────────────────────────────────────────
 *
 * server/domainIdentity.test.ts reads source. It proves the gateway precedes
 * the rail in the DOM, that the tokens clear AA by computation, and that the
 * model has one copy of each domain. None of that proves what the owner
 * actually checked, which was to open the site and look at it.
 *
 * The owner's complaint was itself invisible to a green suite: every assertion
 * passed while Get Quotes sat as the tenth tile of a nine-category grid. So
 * what this measures is the stuff a source test structurally cannot see -
 * COMPUTED colour against MEASURED background, RENDERED geometry, and the
 * ranking that survives when colour is removed - at the three widths the brief
 * names, in both languages.
 */
import { launchBrowser } from './lib/cdp.mjs';
import { assertBuild } from './lib/build.mjs';
import { oklchToRgb } from '../scripts/brand/palette.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
await assertBuild(BASE);
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9700 + (process.pid % 90)));

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));

/**
 * COMPUTED COLOUR -> sRGB.
 *
 * Chromium does NOT normalise `oklch()` to `rgb()` in getComputedStyle - it
 * returns `oklch(0.45 0.11 195)` verbatim, and every token in this product is
 * authored in oklch. The first version of this probe pulled the first three
 * numbers out of whatever string came back and treated them as 0-255 channels,
 * so a perfectly legible teal measured 1.79:1 and eighteen assertions failed
 * against the probe's own arithmetic rather than the page.
 *
 * Anything neither rgb() nor oklch() THROWS rather than returning null: a
 * colour space this cannot read must stop the run, not quietly skip the
 * contrast check that is the whole point of it.
 */
function parseColour(input) {
  const s = String(input).trim();
  if (s === 'transparent' || s === 'rgba(0, 0, 0, 0)') { return null; }
  const rgb = s.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const n = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return [n[0], n[1], n[2]];
  }
  const ok = s.match(/^oklch\(([^)]+)\)$/);
  if (ok) {
    const parts = ok[1].split(/[\s/]+/).filter(Boolean);
    const L = parts[0].endsWith('%') ? Number(parts[0].slice(0, -1)) / 100 : Number(parts[0]);
    return oklchToRgb(L, Number(parts[1]), Number(parts[2]));
  }
  throw new Error(`unreadable colour space: ${s}`);
}
function lum([r, g, b]) {
  const f = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const browser = await launchBrowser({ port: CDP_PORT });

async function setLang(page, lang) {
  await page.evaluate(`try { localStorage.setItem('buildhub_lang', '${lang}'); } catch {} ; return true;`);
}

try {
  for (const lang of ['en', 'ar']) {
    for (const width of [375, 768, 1440]) {
      const tag = `${lang}@${width}`;
      const page = await browser.newPage();
      await page.setViewport({ width, height: 900 });
      await page.goto(`${BASE}/`);
      await setLang(page, lang);
      await page.goto(`${BASE}/`);
      await settle(1400);

      /* ── 1. ORDER ON SCREEN, NOT IN THE SOURCE ──────────────────────
         Document order is asserted statically; this measures the painted
         vertical position, which is what a visitor experiences and what a
         stray `order-` utility or an absolutely positioned section could
         still get wrong at one breakpoint only. */
      const geo = await page.evaluate(`
        function top(sel) {
          var el = document.querySelector(sel);
          if (!el) { return null; }
          var r = el.getBoundingClientRect();
          return Math.round(r.top + window.scrollY);
        }
        var cards = [].slice.call(document.querySelectorAll('[data-testid^="home-domain-"][data-domain-kind]'));
        var tiles = [].slice.call(document.querySelectorAll('[data-testid="home-browse"] a, [data-testid="home-browse"] button'));
        return JSON.stringify({
          hero: top('[data-testid="home-trust-strip"]'),
          explore: top('[data-testid="home-explore"]'),
          browse: top('[data-testid="home-browse"]'),
          cardCount: cards.length,
          cardAreas: cards.map(function (c) {
            var r = c.getBoundingClientRect();
            return { id: c.getAttribute('data-testid'), kind: c.getAttribute('data-domain-kind'), w: Math.round(r.width), h: Math.round(r.height) };
          }),
          tileArea: tiles.length ? (function () { var r = tiles[0].getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
          docOverflow: document.documentElement.scrollWidth - window.innerWidth,
          dir: document.documentElement.getAttribute('dir')
        });
      `);
      const g = JSON.parse(geo);

      check(g.explore !== null && g.browse !== null,
        `${tag} both sections render`, `explore=${g.explore} browse=${g.browse}`);
      check(g.hero !== null && g.hero < g.explore,
        `${tag} hero/trust precedes the gateway`, `${g.hero} < ${g.explore}`);
      check(g.explore < g.browse,
        `${tag} ON SCREEN the gateway is above Browse by Category`, `${g.explore} < ${g.browse}`);
      check(g.cardCount === 3, `${tag} three gateway cards`, `${g.cardCount}`);
      check(g.docOverflow <= 0, `${tag} no horizontal page scroll`, `overflow=${g.docOverflow}px`);
      check(g.dir === (lang === 'ar' ? 'rtl' : 'ltr'), `${tag} document direction`, `dir=${g.dir}`);

      /* ── 2. HIERARCHY SURVIVES GRAYSCALE ────────────────────────────
         The owner's explicit criterion. If a gateway card is not visibly
         larger than a category tile, the ranking rested on hue. */
      if (g.tileArea && g.cardAreas.length) {
        const cardArea = g.cardAreas[0].w * g.cardAreas[0].h;
        const tileArea = g.tileArea.w * g.tileArea.h;
        check(cardArea > tileArea * 1.3,
          `${tag} a gateway card outweighs a category tile without colour`,
          `card=${cardArea}px2 tile=${tileArea}px2`);
      }

      /* ── 3. ONE WORKFLOW, TWO DOMAINS ─────────────────────────────── */
      const kinds = g.cardAreas.map(c => c.kind);
      check(kinds.filter(k => k === 'domain').length === 2 && kinds.filter(k => k === 'workflow').length === 1,
        `${tag} two domains and one workflow are on screen`, kinds.join(','));

      /* ── 4. COMPUTED COLOUR vs MEASURED BACKGROUND ──────────────────
         The only part of the contrast story a token test cannot tell: the
         token could resolve correctly and still be painted on a surface
         nobody computed it against. */
      const colours = await page.evaluate(`
        /* The painted backdrop behind an element: walk up until something is
           actually opaque, because a tint declared at /12 alpha composites
           against whatever is beneath it and measuring the tint alone would
           flatter every ratio on the page. */
        function backdrop(el) {
          var node = el;
          while (node) {
            var b = getComputedStyle(node).backgroundColor;
            var m = b.match(/rgba?\\(([^)]+)\\)/);
            var a = m ? m[1].split(',')[3] : undefined;
            var opaque = b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent'
              && (a === undefined || Number(a) > 0.9);
            if (opaque) { return b; }
            node = node.parentElement;
          }
          return 'rgb(255, 255, 255)';
        }
        var out = [];
        var cards = [].slice.call(document.querySelectorAll('[data-testid^="home-domain-"][data-domain-kind]'));
        cards.forEach(function (card) {
          var id = card.getAttribute('data-testid');
          var well = card.querySelector('span');
          /* TARGETED BY ATTRIBUTE, not by shape. The first version of this
             took "the last span containing an svg", which on the Providers
             card is the PRESETS container - so the Providers CTA was never
             measured and the assertion passed on the wrong element. A probe
             that silently measures something else is worse than no probe. */
          var cta = card.querySelector('[data-domain-cta]');
          var fontPx = cta ? parseFloat(getComputedStyle(cta).fontSize) : 0;
          var weight = cta ? Number(getComputedStyle(cta).fontWeight) : 0;
          out.push({
            id: id,
            kind: card.getAttribute('data-domain-kind'),
            /* THE GLYPH: non-text UI, SC 1.4.11, needs 3:1. */
            iconFg: well ? getComputedStyle(well).color : null,
            iconBg: well ? backdrop(well.parentElement) : null,
            /* THE CTA LABEL: real text, SC 1.4.3. 4.5:1 unless it is large
               (>=24px, or >=18.66px bold), in which case 3:1. The size is
               MEASURED rather than assumed, because "large text" is the
               exemption an amber label would have to earn. */
            ctaFg: cta ? getComputedStyle(cta).color : null,
            ctaBg: cta ? backdrop(cta) : null,
            ctaPx: fontPx,
            ctaLarge: fontPx >= 24 || (fontPx >= 18.66 && weight >= 700),
            hasIcon: !!(well && well.querySelector('svg')),
            label: (card.textContent || '').trim().slice(0, 40)
          });
        });
        return JSON.stringify(out);
      `);
      for (const c of JSON.parse(colours)) {
        /* A MISSING element reports as a failed check above; it must not
           also crash the run inside parseColour, which throws by design on
           anything it cannot read. */
        const iconFg = c.iconFg ? parseColour(c.iconFg) : null;
        const iconBg = c.iconBg ? parseColour(c.iconBg) : null;
        if (iconFg && iconBg) {
          const ratio = contrast(iconFg, iconBg);
          check(ratio >= 3, `${tag} ${c.id} glyph clears 3:1 on its painted surface`,
            `${c.iconFg} on ${c.iconBg} = ${ratio.toFixed(2)}`);
        }
        check(c.ctaFg !== null, `${tag} ${c.id} exposes a measurable CTA row`);
        const ctaFg = c.ctaFg ? parseColour(c.ctaFg) : null;
        const ctaBg = c.ctaBg ? parseColour(c.ctaBg) : null;
        if (ctaFg && ctaBg) {
          const need = c.ctaLarge ? 3 : 4.5;
          const ratio = contrast(ctaFg, ctaBg);
          check(ratio >= need, `${tag} ${c.id} CTA label clears AA as rendered`,
            `${c.ctaPx}px${c.ctaLarge ? ' large' : ''} needs ${need}:1, got ${ratio.toFixed(2)} (${c.ctaFg} on ${c.ctaBg})`);
        }
        check(c.hasIcon, `${tag} ${c.id} carries an icon, not colour alone`);
        check(c.label.length > 2, `${tag} ${c.id} carries a text label`, JSON.stringify(c.label));
      }

      /* ── 5. THE TWO DOMAINS ARE ACTUALLY DISTINGUISHABLE ───────────── */
      const parsed = JSON.parse(colours);
      const dom = parsed.filter(c => c.kind === 'domain').map(c => parseColour(c.iconFg));
      if (dom.length === 2 && dom[0] && dom[1]) {
        const dist = Math.hypot(dom[0][0] - dom[1][0], dom[0][1] - dom[1][1], dom[0][2] - dom[1][2]);
        check(dist > 60, `${tag} Products and Providers are visually distinct`, `rgb distance ${dist.toFixed(0)}`);
      }

      /* ── 6. NO RAINBOW. Count the distinct strong hues on the page. ──
         The owner's constraint was "restore domain identity without turning
         RAKIZA into a rainbow", and the only honest way to check that is to
         count. */
      const hues = await page.evaluate(`
        /* RAW STRINGS OUT, BUCKETED IN NODE.
           Doing the hue maths in-page needed two code paths - oklch carries
           its hue directly, rgb needs converting - and they disagreed: the
           amber ramp mixes a literal #F59E0B with oklch steps, so one amber
           counted as two "hue families" and the rainbow census over-reported.
           One verified converter, applied once, outside the page. */
        var seen = [];
        [].slice.call(document.querySelectorAll('main *, section *')).forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (r.width < 8 || r.height < 8) { return; }
          var cs = getComputedStyle(el);
          seen.push(cs.color);
          seen.push(cs.backgroundColor);
        });
        return JSON.stringify(seen);
      `);
      const tally = new Map();
      for (const raw of JSON.parse(hues)) {
        let rgb; try { rgb = parseColour(raw); } catch { continue; }
        if (!rgb) continue;
        const [r, g, b] = rgb.map(v => v / 255);
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        if (d < 0.12) continue;                       /* neutral, not a hue */
        let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h = Math.round(h * 60); if (h < 0) h += 360;
        const bucket = Math.floor(h / 30) * 30;       /* 12 families of 30deg */
        tally.set(bucket, (tally.get(bucket) ?? 0) + 1);
      }
      const buckets = [...tally.entries()]
        .filter(([, n]) => n >= 3)                    /* one-off decoration is not a palette */
        .map(([h]) => h).sort((a, b) => a - b);
      check(buckets.length <= 6, `${tag} the page is not a rainbow`,
        `${buckets.length} hue families in use: ${buckets.join(', ')}`);

      await page.close();
    }
  }

  /* ── 7. KEYBOARD: the stretched link and the presets are both reachable,
     and nothing is nested inside anything interactive. ───────────────── */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE}/`);
    await settle(1400);
    const kb = await page.evaluate(`
      var section = document.querySelector('[data-testid="home-explore"]');
      if (!section) { return JSON.stringify({ found: false }); }
      var focusables = [].slice.call(section.querySelectorAll('a[href], button, [tabindex]:not([tabindex="-1"])'));
      /* THE DEFECT THIS CATCHES: an interactive element inside another one.
         It is invalid HTML and it is announced wrongly, and the first version
         of this gateway had exactly that - role="link" spans inside a button. */
      var nested = focusables.filter(function (el) {
        var p = el.parentElement;
        while (p && p !== section) {
          if (p.matches('a[href], button, [role="link"], [role="button"]')) { return true; }
          p = p.parentElement;
        }
        return false;
      });
      var fakeLinks = [].slice.call(section.querySelectorAll('[role="link"]:not(a), [role="button"]:not(button)'));
      return JSON.stringify({
        found: true,
        focusable: focusables.length,
        nested: nested.map(function (e) { return e.getAttribute('data-testid') || e.tagName; }),
        fakeLinks: fakeLinks.length,
        presets: section.querySelectorAll('[data-testid^="home-preset-"]').length
      });
    `);
    const k = JSON.parse(kb);
    check(k.found, 'keyboard: the gateway is in the DOM');
    check(k.focusable >= 5, 'keyboard: every card and preset is focusable', `${k.focusable} stops`);
    check(k.nested.length === 0, 'KEYBOARD: NO INTERACTIVE ELEMENT IS NESTED IN ANOTHER',
      k.nested.join(',') || 'none');
    check(k.fakeLinks === 0, 'keyboard: no span is impersonating a link', `${k.fakeLinks}`);
    check(k.presets === 2, 'keyboard: both provider presets render', `${k.presets}`);
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`\n${fail === 0 ? 'OK' : 'FAILED'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
