/**
 * ── HOW TALL IS EXPLORE RAKIZA, REALLY ───────────────────────────────────
 *
 * The owner reviewed the six-journey gateway on Arabic mobile and accepted the
 * information architecture. What they rejected was its DENSITY: three tall
 * rows consuming most of the phone homepage, with verbose supporting copy,
 * generous padding and an oversized Get Quotes button.
 *
 * None of that is visible to a source test. "The card has p-4 at mobile" says
 * nothing about how many pixels six of them occupy once Arabic copy wraps to
 * three lines. So this measures the rendered box: section height, per-card
 * height, icon size, title and description line counts, CTA dimensions, tap
 * targets and overflow, at every width and in both languages.
 *
 * ── IT IS A MEASUREMENT TOOL, NOT A PASS/FAIL GATE ───────────────────────
 *
 * Run against a baseline commit it prints the numbers; run again after a
 * change it prints them beside each other. Pinning "the section must be under
 * N pixels" would be exactly the brittle pixel freeze the brief warns about -
 * one Arabic copy edit away from a false failure. The structural invariants
 * belong in server/journeyIdentity.test.ts; the job here is to tell the truth
 * about proportions so a density claim can be checked rather than asserted.
 *
 * The only hard assertions are the ones that are genuinely absolute: no
 * horizontal overflow, no tap target below 44x44, and no clipped text.
 *
 *   ZG_OUT=before.json ZG_LABEL=baseline node evidence/zg-journeydensity.mjs
 *   ZG_OUT=after.json  ZG_LABEL=after    node evidence/zg-journeydensity.mjs
 *   node evidence/zg-journeydensity.mjs --compare before.json after.json
 *
 * The JSON goes to ZG_OUT and the readable table to stdout. Redirecting
 * stdout instead put assertBuild's build banner on line 1 of the JSON, which
 * is a harness mistake that reads like a parse error in the product.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './lib/cdp.mjs';
import { assertBuild } from './lib/build.mjs';

/* ── COMPARE MODE, which needs no browser and no server ─────────────────── */
if (process.argv[2] === '--compare') {
  const before = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const after = JSON.parse(readFileSync(process.argv[4], 'utf8'));
  const key = m => `${m.lang}@${m.width}`;
  const byKey = rows => Object.fromEntries(rows.map(m => [key(m), m]));
  const [b, a] = [byKey(before.measurements), byKey(after.measurements)];
  const pct = (from, to) => from === 0 ? 'n/a'
    : `${to > from ? '+' : ''}${(((to - from) / from) * 100).toFixed(0)}%`;
  console.log(`${'width'.padEnd(10)}${'section px'.padEnd(26)}${'tallest card'.padEnd(24)}`
    + `${'icon'.padEnd(14)}${'desc lines'.padEnd(14)}cta`);
  for (const k of Object.keys(b)) {
    if (!a[k]) continue;
    const [x, y] = [b[k], a[k]];
    const line = [
      k.padEnd(10),
      `${x.sectionHeight} -> ${y.sectionHeight} (${pct(x.sectionHeight, y.sectionHeight)})`.padEnd(26),
      `${x.tallestCard} -> ${y.tallestCard} (${pct(x.tallestCard, y.tallestCard)})`.padEnd(24),
      `${x.iconBox} -> ${y.iconBox}`.padEnd(14),
      `${x.maxDescLines} -> ${y.maxDescLines}`.padEnd(14),
      `${x.ctaW}x${x.ctaH} -> ${y.ctaW}x${y.ctaH}`,
    ].join('');
    console.log(line);
  }
  process.exit(0);
}

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const build = await assertBuild(BASE);
const LABEL = process.env.ZG_LABEL ?? 'unlabelled';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9820 + (process.pid % 70)));

/* 375 is the owner-reviewed width; 393 is a current iPhone; 430 a large phone;
   768 and 1440 are the brief's tablet and desktop widths. */
const WIDTHS = [375, 393, 430, 768, 1440];
let hardFail = 0;
const measurements = [];

const browser = await launchBrowser({ port: CDP_PORT });
const settle = (ms = 1400) => new Promise(r => setTimeout(r, ms));

try {
  for (const lang of ['en', 'ar']) {
    for (const width of WIDTHS) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 900 });
      await page.goto(`${BASE}/`);
      await page.evaluate(`try { localStorage.setItem('buildhub_lang', '${lang}'); } catch {} ; return true;`);
      await page.goto(`${BASE}/`);
      await settle();

      const raw = await page.evaluate(`
        var section = document.querySelector('[data-testid="home-explore"]');
        if (!section) { return JSON.stringify({ found: false }); }
        var browse = document.querySelector('[data-testid="home-browse"]');
        var cards = [].slice.call(section.querySelectorAll('[data-testid^="home-journey-"][data-journey-kind]'));

        /* LINE COUNT, FROM GEOMETRY. Measured as rendered height divided by
           computed line-height rather than by counting words, because Arabic
           wraps differently and the point is what the reader actually sees. */
        function lines(el) {
          if (!el) { return 0; }
          var cs = getComputedStyle(el);
          var lh = parseFloat(cs.lineHeight);
          if (!isFinite(lh) || lh <= 0) { lh = parseFloat(cs.fontSize) * 1.3; }
          return Math.max(1, Math.round(el.getBoundingClientRect().height / lh));
        }
        /* CLIPPED TEXT: content taller than its box with overflow hidden is
           copy the reader cannot finish. One of the ways to "reduce height"
           that the brief forbids, so it is measured rather than trusted. */
        function clipped(el) {
          if (!el) { return false; }
          var cs = getComputedStyle(el);
          var hides = cs.overflow === 'hidden' || cs.overflowY === 'hidden';
          return hides && el.scrollHeight > el.clientHeight + 1;
        }

        var per = cards.map(function (card) {
          var box = card.getBoundingClientRect();
          var well = card.querySelector('span');
          var link = card.querySelector('a');
          var cta = card.querySelector('[data-journey-cta]');
          var desc = (function () {
            var spans = [].slice.call(card.querySelectorAll('span'));
            /* THE VISIBLE DESCRIPTION, and the visibility test is the point.
               The card now ships two descriptions - a short phone phrase and a
               longer sentence - with CSS hiding one. Without the display check
               this picked the first span with text, which at tablet width and above is the
               HIDDEN short copy: zero height, 12px font. It reported the
               desktop description as having shrunk from 14px to 12px and
               wrapping to one line, which was the probe reading an element
               nobody can see. */
            return spans.filter(function (sp) {
              if (sp === well || sp === cta || sp.querySelector('svg')) { return false; }
              if ((sp.textContent || '').trim().length <= 10) { return false; }
              return getComputedStyle(sp).display !== 'none' && sp.offsetParent !== null;
            })[0] || null;
          })();
          var wellBox = well ? well.getBoundingClientRect() : null;
          var ctaBox = cta ? cta.getBoundingClientRect() : null;
          var linkBox = link ? link.getBoundingClientRect() : null;
          var cs = getComputedStyle(card);
          return {
            id: card.getAttribute('data-testid'),
            kind: card.getAttribute('data-journey-kind'),
            w: Math.round(box.width), h: Math.round(box.height),
            top: Math.round(box.top + window.scrollY),
            padTop: Math.round(parseFloat(cs.paddingTop)),
            icon: wellBox ? Math.round(wellBox.width) : 0,
            titleLines: lines(link),
            titleH: linkBox ? Math.round(linkBox.height) : 0,
            descLines: lines(desc),
            descFont: desc ? Math.round(parseFloat(getComputedStyle(desc).fontSize)) : 0,
            descClipped: clipped(desc),
            titleClipped: clipped(link),
            ctaW: ctaBox ? Math.round(ctaBox.width) : 0,
            ctaH: ctaBox ? Math.round(ctaBox.height) : 0,
            /* The TAP TARGET is the stretched link, which covers the card. */
            tapW: linkBox ? Math.round(box.width) : 0,
            tapH: linkBox ? Math.round(box.height) : 0,
          };
        });

        var sectionBox = section.getBoundingClientRect();
        return JSON.stringify({
          found: true,
          dir: document.documentElement.getAttribute('dir'),
          sectionHeight: Math.round(sectionBox.height),
          sectionTop: Math.round(sectionBox.top + window.scrollY),
          gapToBrowse: browse
            ? Math.round((browse.getBoundingClientRect().top + window.scrollY)
                - (sectionBox.bottom + window.scrollY))
            : null,
          /* THE NUMBER THE OWNER ACTUALLY FELT: how much of the page the
             section takes, as a share of one phone screen. */
          screensOfSection: Number((sectionBox.height / window.innerHeight).toFixed(2)),
          /* THE WELL TREATMENT, as painted. Two of the four provider
             journeys carry a hairline ring to tell the ROLE views apart from
             the CATEGORY views - same hue family, no second colour. Read from
             computed style so a class that does not actually resolve shows up
             as absent. */
          wells: cards.map(function (card) {
            var well = card.querySelector('[data-journey-well]');
            if (!well) { return { id: card.getAttribute('data-testid'), ring: 'none' }; }
            var cs = getComputedStyle(well);
            var w = parseFloat(cs.outlineWidth || '0');
            var shadow = cs.boxShadow || 'none';
            return {
              id: card.getAttribute('data-testid'),
              ring: (shadow !== 'none' && shadow.length > 4) ? shadow.slice(0, 48) : 'none',
              bg: cs.backgroundColor,
              fg: cs.color,
            };
          }),
          /* RENDERED ROWS, grouped by painted top. Row balance is the brief's
             concern and it is a per-ROW question: two cards side by side must
             match even when Arabic and English wrap differently. Comparing the
             tallest card on the page with the shortest answers a different,
             easier question. */
          rows: (function () {
            var groups = {};
            cards.forEach(function (c) {
              var top = Math.round(c.getBoundingClientRect().top / 4) * 4;
              groups[top] = groups[top] || [];
              groups[top].push(Math.round(c.getBoundingClientRect().height));
            });
            return Object.keys(groups).sort(function (a, b) { return a - b; })
              .map(function (k) { return groups[k]; });
          })(),
          /* THE ACTION BASELINE, PER ROW, and this one needed adding.
             Equal card heights do NOT imply aligned actions: with the action
             row sitting directly under its copy, two cards in one row can
             match in height while their links sit tens of pixels apart - which
             is the brief's "actions sitting far from the information they
             belong to", seen from the other side. Removing mt-auto left every
             height-based check passing, so the claim was unverified until this
             measured it.

             MEASURED AT THE BOTTOM EDGE, and that correction matters. The
             first version compared action TOPS and reported 12-16px of skew
             everywhere - which was true and was not a defect: the amber pill
             is 28px tall and a text link is 16px, so their tops cannot align
             while their bottoms do. mt-auto pins the action row to the bottom
             of the card, so the bottom edge is what it actually guarantees and
             what reads as a shared baseline against the card's padding. */
          ctaRows: (function () {
            var groups = {};
            cards.forEach(function (c) {
              var top = Math.round(c.getBoundingClientRect().top / 4) * 4;
              var cta = c.querySelector('[data-journey-cta]');
              if (!cta) { return; }
              groups[top] = groups[top] || [];
              groups[top].push(Math.round(cta.getBoundingClientRect().bottom));
            });
            return Object.keys(groups).sort(function (a, b) { return a - b; })
              .map(function (k) { return groups[k]; });
          })(),
          columns: (function () {
            if (cards.length < 2) { return cards.length; }
            var firstTop = Math.round(cards[0].getBoundingClientRect().top);
            return cards.filter(function (c) {
              return Math.abs(Math.round(c.getBoundingClientRect().top) - firstTop) < 4;
            }).length;
          })(),
          docOverflow: document.documentElement.scrollWidth - window.innerWidth,
          cards: per,
        });
      `);
      const m = JSON.parse(raw);
      if (!m.found) throw new Error(`the gateway is missing at ${lang}@${width}`);

      const discovery = m.cards.filter(c => c.kind === 'discovery');
      const action = m.cards.find(c => c.kind === 'action');
      const row = {
        lang, width, dir: m.dir,
        sectionHeight: m.sectionHeight,
        screensOfSection: m.screensOfSection,
        gapToBrowse: m.gapToBrowse,
        columns: m.columns,
        cardCount: m.cards.length,
        tallestCard: Math.max(...m.cards.map(c => c.h)),
        shortestCard: Math.min(...m.cards.map(c => c.h)),
        cardWidth: m.cards[0]?.w ?? 0,
        iconBox: m.cards[0]?.icon ?? 0,
        maxTitleLines: Math.max(...m.cards.map(c => c.titleLines)),
        maxDescLines: Math.max(...m.cards.map(c => c.descLines)),
        descFont: m.cards[0]?.descFont ?? 0,
        ctaW: action?.ctaW ?? 0,
        ctaH: action?.ctaH ?? 0,
        discoveryCtaW: discovery[0]?.ctaW ?? 0,
        docOverflow: m.docOverflow,
        clipped: m.cards.filter(c => c.descClipped || c.titleClipped).map(c => c.id),
        minTap: Math.min(...m.cards.map(c => Math.min(c.tapW, c.tapH))),
        /* The worst row, as a ratio. 1.00 means the pair match exactly. */
        worstRowBalance: Math.min(...m.rows.map(r => Math.min(...r) / Math.max(...r))),
        ringed: m.wells.filter(w => w.ring !== 'none').map(w => w.id.replace('home-journey-', '')),
        /* The largest vertical gap between two actions in the same row. */
        worstCtaSkew: Math.max(...m.ctaRows.map(r => Math.max(...r) - Math.min(...r))),
      };
      measurements.push(row);

      /* ── THE THREE ABSOLUTE RULES ─────────────────────────────────────── */
      const bad = [];
      if (row.docOverflow > 0) bad.push(`horizontal overflow ${row.docOverflow}px`);
      if (row.clipped.length > 0) bad.push(`clipped text: ${row.clipped.join(',')}`);
      if (row.minTap < 44) bad.push(`tap target ${row.minTap}px below 44`);
      if (row.cardCount !== 6) bad.push(`${row.cardCount} cards, not 6`);
      /* ROW BALANCE IS ABSOLUTE because `items-stretch` makes it so. Anything
         below 1 means a card is not filling its row, which is the "one card
         dramatically taller" complaint - and the fix must not be a fixed
         height, which is what breaks Arabic. */
      if (row.worstRowBalance < 0.999) {
        bad.push(`a row is unbalanced (${(row.worstRowBalance * 100).toFixed(0)}%)`);
      }
      /* The two CATEGORY journeys carry the ring; the rest do not. Rendered,
         so a Tailwind class that silently fails to resolve is caught. */
      const ringed = row.ringed.sort().join(',');
      if (ringed !== 'design,finishing') bad.push(`well rings on [${ringed}], expected design,finishing`);
      /* A couple of pixels is sub-pixel rounding; anything more means the
         actions in one row are no longer on a shared baseline. */
      if (row.worstCtaSkew > 2) {
        bad.push(`action baselines in a row are ${row.worstCtaSkew}px apart`);
      }
      if (bad.length > 0) { hardFail++; console.error(`FAIL ${lang}@${width}: ${bad.join('; ')}`); }

      await page.close();
    }
  }
} finally {
  await browser.close();
}

const out = { label: LABEL, build: build?.shortCommit ?? 'unknown', measurements };
if (process.env.ZG_OUT) writeFileSync(process.env.ZG_OUT, JSON.stringify(out, null, 1));

/* The readable table, which is what a person reads in a report. */
const pad = (v, n) => String(v).padStart(n);
console.log(`\nEXPLORE RAKIZA DENSITY  label=${LABEL}  build=${out.build}`);
console.log(`${'view'.padEnd(9)}${pad('cols', 5)}${pad('section', 9)}${pad('screens', 9)}`
  + `${pad('tall', 6)}${pad('short', 6)}${pad('cardW', 7)}${pad('icon', 6)}`
  + `${pad('titleL', 7)}${pad('descL', 6)}${pad('descPx', 7)}${pad('cta', 10)}${pad('gap', 6)}`
  + `${pad('row=', 7)}${pad('skew', 7)}`);
for (const m of measurements) {
  console.log(`${`${m.lang}@${m.width}`.padEnd(9)}${pad(m.columns, 5)}${pad(m.sectionHeight, 9)}`
    + `${pad(m.screensOfSection, 9)}${pad(m.tallestCard, 6)}${pad(m.shortestCard, 6)}`
    + `${pad(m.cardWidth, 7)}${pad(m.iconBox, 6)}${pad(m.maxTitleLines, 7)}${pad(m.maxDescLines, 6)}`
    + `${pad(m.descFont, 7)}${pad(`${m.ctaW}x${m.ctaH}`, 10)}${pad(m.gapToBrowse, 6)}`
    + `${pad(`${(m.worstRowBalance * 100).toFixed(0)}%`, 7)}${pad(`${m.worstCtaSkew}px`, 7)}`);
}
if (hardFail > 0) { console.error(`\n${hardFail} viewport(s) broke an absolute rule`); process.exit(1); }
console.log(`\nOK  no overflow, no clipped text, no tap target under 44px, six cards,`
  + ` rows balanced, actions on a shared baseline, well rings on design+finishing only`);
