import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { oklchToRgb, contrast, rgbToHex } from '../scripts/brand/palette.mjs';
import { readSourceForAssertions } from './_testing/sourceText';

/**
 * ── SIX JOURNEYS, AND NOT ONE UMBRELLA ──────────────────────────────────
 *
 * The owner reviewed the deployed candidate and rejected the Explore RAKIZA
 * information architecture. Not its layout - its reasoning. The gateway had
 * one large "Suppliers & professionals" card described as "approved
 * contractors, engineers, architects, suppliers and project managers", with
 * Design Services and Finishing demoted to small chips beneath it, because all
 * of those destinations share one directory component over one provider table.
 *
 *   SHARED IMPLEMENTATION DOES NOT REQUIRE SHARED NAVIGATION IDENTITY.
 *
 * That is the correction, and it is the kind a passing suite cannot see: every
 * assertion was green while the homepage asked a first-time visitor to
 * understand RAKIZA's provider model before they could start looking for a
 * contractor. So these pin the SIX JOURNEYS, the axis each one filters on, and
 * the separation of the six jobs colour does here:
 *
 *   BRAND      whose platform is this         navy, amber, secondary blue
 *   DOMAIN     which marketplace area         products, providers
 *   JOURNEY    what am I trying to find       six of them
 *   STATUS     what state is this object in   success, warning, error, info
 *   PLACEMENT  why is this emphasised         Featured, Sponsored
 *   TAXONOMY   what category is this          Tiles, Marble, Paints
 */

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => readSourceForAssertions(read(rel));

const MODEL = () => code('client/src/components/brand/domainIdentity.ts');
const HOME = () => code('client/src/pages/Home.tsx');
const APP = () => code('client/src/App.tsx');
const CSS = () => read('client/src/index.css');

/** One journey's entry in the model, by id. */
function entry(id: string): string {
  const model = MODEL();
  const at = model.indexOf(`    id: '${id}',`);
  expect(at, `${id} is not in the journey model`).toBeGreaterThan(-1);
  const rest = model.slice(at);
  const end = rest.indexOf('\n  },');
  return end < 0 ? rest : rest.slice(0, end);
}

describe('the model offers journeys, not a provider umbrella', () => {
  it('ALL SIX JOURNEYS ARE FIRST-CLASS ENTRIES', () => {
    const model = MODEL();
    const ids = [...model.matchAll(/^    id: '([a-z]+)',$/gm)].map(m => m[1]);
    expect(ids, 'the six journeys are not all in the model').toEqual(
      ['products', 'suppliers', 'contractors', 'design', 'finishing', 'quotes']);
  });

  it('and the combined provider card is GONE from the model and the page', () => {
    /*
     * THE REJECTED PATTERN, pinned so it cannot come back: one umbrella entry
     * whose copy enumerates the provider roles, plus a secondary preset list
     * rendered as chips under it.
     */
    const model = MODEL();
    expect(model, 'the provider umbrella journey is back').not.toMatch(/id: 'providers'/);
    expect(model, 'the secondary preset list is back').not.toMatch(/PROVIDER_PRESETS/);
    const home = HOME();
    expect(home, 'the homepage still renders the preset chips').not.toMatch(/home-preset-/);

    /* COMMENT-STRIPPED, because the rejected copy is QUOTED in a comment in
       that file explaining why it went - and a raw read matched the
       explanation rather than a live string. `stripComments` keeps string
       literals, so the claim is unweakened: what it now searches is only the
       copy the product actually serves. */
    const copy = code('client/src/contexts/LanguageContext.tsx');
    expect(copy, 'the umbrella label is still defined')
      .not.toMatch(/Suppliers & professionals/);
    expect(copy, 'a journey blurb still enumerates the provider roles')
      .not.toMatch(/contractors, engineers, architects, suppliers and project managers/);
  });

  it('DESIGN SERVICES IS NAMED FOR THE SERVICE, NOT THE ROLE', () => {
    /*
     * An owner terminology decision, not a synonym. The customer wants a
     * service; "Professionals", "Design Professionals" or "Professionals &
     * Design" would name the database role of whoever supplies it and make the
     * visitor translate before they can start.
     */
    const copy = read('client/src/contexts/LanguageContext.tsx');
    expect(copy).toMatch(/'journey\.design': 'Design Services'/);
    for (const rejected of [
      "'journey.design': 'Professionals'", "'journey.design': 'Professionals / Design'",
      "'journey.design': 'Professionals & Design'", "'journey.design': 'Design Professionals'",
    ]) {
      expect(copy, `${rejected} is not the approved label`).not.toContain(rejected);
    }
  });

  it('every journey states the AXIS it filters on, and role and category stay apart', () => {
    /*
     * Two real axes, and the navigation needs both. Suppliers and Contractors
     * ask what kind of business it is (`users.userRole`). Design Services and
     * Finishing ask what the provider has DECLARED they do (`vendorCategories`,
     * the shared RFQ taxonomy). A contractor who declares Renovation belongs in
     * Finishing, so filtering Finishing by role would discard the providers the
     * customer came for - and filtering Suppliers by category would answer a
     * different question entirely.
     */
    expect(entry('suppliers')).toMatch(/filter: \{ by: 'role', value: 'supplier' \}/);
    expect(entry('contractors')).toMatch(/filter: \{ by: 'role', value: 'contractor' \}/);
    expect(entry('design')).toMatch(/filter: \{ by: 'category', value: 'Design' \}/);
    expect(entry('finishing')).toMatch(/filter: \{ by: 'category', value: 'Renovation' \}/);
    expect(entry('products')).toMatch(/filter: \{ by: 'none' \}/);
    expect(entry('quotes')).toMatch(/filter: \{ by: 'none' \}/);
  });

  it('GET QUOTES IS AN ACTION, NOT A SIXTH DISCOVERY DESTINATION', () => {
    const model = MODEL();
    const kinds = [...model.matchAll(/kind: '(discovery|action)'/g)].map(m => m[1]);
    expect(kinds.filter(k => k === 'discovery')).toHaveLength(5);
    expect(kinds.filter(k => k === 'action')).toHaveLength(1);
    const quotes = entry('quotes');
    expect(quotes).toContain("kind: 'action'");
    expect(quotes, 'the action took a marketplace domain').toContain('domain: null');
    expect(quotes, 'the action took a domain token').not.toMatch(/domain-(products|providers)/);
    expect(quotes).toContain('brand-accent');
  });

  it('every destination in the model is a route that exists', () => {
    const hrefs = [...MODEL().matchAll(/href: '([^']+)'/g)].map(m => m[1]);
    expect(hrefs).toHaveLength(6);
    const app = APP();
    for (const href of hrefs) {
      if (href === '/rfq') { expect(app).toMatch(/path=\{"\/rfq"\}/); continue; }
      expect(app, `${href} is not a route`).toContain(`path={"${href}"}`);
    }
  });

  it('identity is never colour alone - icon, label and copy on every journey', () => {
    for (const id of ['products', 'suppliers', 'contractors', 'design', 'finishing', 'quotes']) {
      const block = entry(id);
      expect(block, `${id} has no icon`).toMatch(/icon: \w+/);
      expect(block, `${id} has no label key`).toMatch(/labelKey: '[^']+'/);
      expect(block, `${id} has no supporting copy`).toMatch(/blurbKey: '[^']+'/);
      expect(block, `${id} has no CTA label`).toMatch(/ctaKey: '[^']+'/);
    }
    /* SIX DISTINCT ICONS. Four journeys share the provider hue, so the icon is
       what actually tells a visitor which card is theirs - a hard hat says
       contractor faster than any colour does. Two cards wearing one glyph
       would put the whole distinction back on hue. */
    const icons = [...MODEL().matchAll(/^    icon: (\w+),$/gm)].map(m => m[1]);
    expect(icons).toHaveLength(6);
    expect(new Set(icons).size, `two journeys share an icon: ${icons.join(',')}`).toBe(6);
  });

  it('THE ACTION CTA IS A FILL, THE DISCOVERY CTAs ARE LINKS', () => {
    /*
     * A contrast fact that became a hierarchy improvement. The domain accents
     * are 6.69:1 (teal) and 7.78:1 (violet) on a white card and are legal as
     * 14px text; Accent Amber's darkest permitted step is 3.11:1, which is a
     * glyph colour and not a small-label colour. So the action states its
     * accent as a fill with a dark label - and a filled pill among five text
     * links ranks the highest-intent journey first with no colour at all,
     * which is the grayscale criterion.
     */
    const quotes = entry('quotes');
    expect(quotes, 'the action CTA is not a fill').toMatch(/cta: '[^']*bg-brand-accent-500/);
    expect(quotes, 'the action CTA has no dark label').toMatch(/cta: '[^']*text-foreground/);
    expect(quotes, 'amber is being used as a text colour again')
      .not.toMatch(/cta: '[^']*text-brand-accent/);
    /* The five discovery CTAs reach their accent through a named constant
       (PRODUCTS_ACCENT / PROVIDER_ACCENT) rather than a literal, which is the
       point of the shared token - so this asserts the SHAPE: a bare accent
       reference, never a fill. The test above proves those constants resolve
       to exactly three domain tokens. */
    for (const id of ['products', 'suppliers', 'contractors', 'design', 'finishing']) {
      expect(entry(id), `${id} became a fill`).not.toMatch(/cta: [^,\n]*\bbg-/);
      expect(entry(id), `${id} lost its domain accent`).toMatch(/cta: (PRODUCTS|PROVIDER)_ACCENT/);
    }
  });

  it('COLOUR FOLLOWS THE DOMAIN, so six cards use three hue families', () => {
    /*
     * The anti-rainbow rule, as arithmetic. Six saturated hues for six cards is
     * the pre-RAKIZA failure - ten identities, four of them colliding with
     * status meanings. One flat brand tint is the opposite failure. Colour
     * follows the DOMAIN because that is the honest thing for it to follow:
     * one catalogue, one provider directory, one action.
     */
    const model = MODEL();
    const accents = [...model.matchAll(/^    accent: ([^,\n]+),$/gm)].map(m => m[1]);
    expect(accents).toHaveLength(6);
    expect(new Set(accents).size, `six cards are using ${new Set(accents).size} accents`).toBe(3);

    /* And the four provider journeys share ONE of them. */
    for (const id of ['suppliers', 'contractors', 'design', 'finishing']) {
      expect(entry(id), `${id} invented its own hue`).toContain('PROVIDER_ACCENT');
      expect(entry(id), `${id} is not in the provider domain`).toContain("domain: 'providers'");
    }
    expect(entry('products')).toContain("domain: 'products'");
  });

  it('no page keeps a private copy of a domain or journey colour', () => {
    function walk(dir: string, out: string[] = []): string[] {
      for (const item of readdirSync(dir)) {
        const full = join(dir, item);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(item)) out.push(full);
      }
      return out;
    }
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, 'client/src'))) {
      if (file.endsWith('domainIdentity.ts')) continue;
      const source = readSourceForAssertions(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(/\b(bg|text|border)-(teal|violet|purple|cyan|fuchsia)-\d{2,3}\b/g)) {
        offenders.push(`${file.slice(ROOT.length + 1)} :: ${match[0]}`);
      }
    }
    expect(offenders, 'a page is inventing its own journey hue').toEqual([]);
  });
});

describe('the compact pass changed proportions, not the architecture', () => {
  /**
   * ── WHAT THE OWNER FROZE, AND WHAT THEY ASKED TO CHANGE ────────────────
   *
   * The six journeys were reviewed on the real Arabic mobile site and
   * APPROVED. What was rejected was density: a measured 1086px at 375px wide -
   * 1.21 phone screens for one section - with descriptions wrapping to four
   * lines inside a 158px card and an amber pill 48px tall.
   *
   * So the titles, routes and filters are frozen here, and the structure that
   * delivers the density is pinned. The PIXELS are not: they live in
   * evidence/zg-journeydensity.mjs, which measures before and after rather
   * than freezing a number that one Arabic copy edit would falsify.
   */
  it('THE SIX TITLES ARE EXACTLY WHAT THE OWNER APPROVED', () => {
    const copy = code('client/src/contexts/LanguageContext.tsx');
    const frozen: Array<[string, string, string]> = [
      ['journey.products', 'Products & Materials', 'المنتجات والمواد'],
      ['journey.suppliers', 'Suppliers', 'الموردون'],
      ['journey.contractors', 'Contractors', 'المقاولون'],
      ['journey.design', 'Design Services', 'خدمات التصميم'],
      ['journey.finishing', 'Finishing', 'التشطيبات'],
      ['journey.quotes', 'Get Quotes', 'اطلب عروض أسعار'],
    ];
    for (const [key, en, ar] of frozen) {
      expect(copy, `${key} is no longer "${en}"`).toContain(`'${key}': '${en}'`);
      expect(copy, `${key} is no longer "${ar}"`).toContain(`'${key}': '${ar}'`);
    }
  });

  it('every journey has BOTH a long and a short description, and both CTAs', () => {
    /*
     * The density fix is copy length before padding before type size, so the
     * short strings are load-bearing: a journey that lost its `.short` would
     * render `undefined` on a phone, and one that lost its `.blurb` would lose
     * the sentence the desktop card has room for.
     */
    const copy = code('client/src/contexts/LanguageContext.tsx');
    const model = MODEL();
    const shortKeys = [...model.matchAll(/shortKey: '([^']+)'/g)].map(m => m[1]);
    expect(shortKeys, 'a journey has no short description').toHaveLength(6);
    const ctaKeys = [...model.matchAll(/ctaKey: '([^']+)'/g)].map(m => m[1]);
    const arabic = /[؀-ۿ]/;
    for (const key of [...shortKeys, ...ctaKeys, ...ctaKeys.map(k => `${k}.short`)]) {
      const values = [...copy.matchAll(new RegExp(`'${key.replace(/\./g, '\\.')}': '([^']*)'`, 'g'))]
        .map(m => m[1]);
      expect(values.length, `${key} is not defined twice (EN + AR)`).toBe(2);
      expect(values.some(v => arabic.test(v)), `${key} has no Arabic value`).toBe(true);
      expect(values.every(v => v.trim().length > 0), `${key} is empty`).toBe(true);
    }
  });

  it('and the short copy is ACTUALLY SHORTER than the long copy', () => {
    /*
     * Otherwise two keys exist and nothing is gained. Compared per journey and
     * per language, because an English pair that shortens while the Arabic one
     * does not would leave the phone card tall in exactly the language the
     * owner reviewed.
     */
    const copy = code('client/src/contexts/LanguageContext.tsx');
    const value = (key: string) =>
      [...copy.matchAll(new RegExp(`'${key.replace(/\./g, '\\.')}': '([^']*)'`, 'g'))].map(m => m[1]);
    for (const id of ['products', 'suppliers', 'contractors', 'design', 'finishing', 'quotes']) {
      const long = value(`journey.${id}.blurb`);
      const brief = value(`journey.${id}.short`);
      expect(long).toHaveLength(2);
      expect(brief).toHaveLength(2);
      for (let lang = 0; lang < 2; lang++) {
        expect(brief[lang].length, `journey.${id}.short[${lang}] is not shorter than its blurb`)
          .toBeLessThan(long[lang].length);
      }
    }
  });

  it('CSS CHOOSES WHICH DESCRIPTION SHOWS, NOT JAVASCRIPT', () => {
    /*
     * A matchMedia hook was the obvious alternative and is worse: the existing
     * useIsMobile returns false on first render, so a phone would paint the
     * long copy and then swap - a flash and a layout shift on the most
     * important section of the homepage. `display: none` also keeps the hidden
     * string out of the accessibility tree, so a screen reader is read exactly
     * one description rather than both.
     */
    const home = HOME();
    const explore = home.slice(home.indexOf('data-testid="home-explore"'));
    const section = explore.slice(0, explore.indexOf('</section>'));
    expect(section, 'the phone description is gone').toMatch(/shortKey[\s\S]{0,40}/);
    expect(section, 'the phone copy is not hidden above the breakpoint').toMatch(/sm:hidden/);
    expect(section, 'the long copy is not hidden below the breakpoint').toMatch(/hidden[^"]*sm:inline/);
    expect(section, 'a media-query hook crept back in').not.toMatch(/useIsMobile|matchMedia/);
  });

  it('and nothing achieves compactness by clipping or fixing a height', () => {
    /*
     * The forbidden shortcuts, and they are forbidden for the same reason: a
     * fixed height breaks Arabic the moment a word wraps differently, and
     * `overflow: hidden` on meaningful copy is a sentence the reader cannot
     * finish. The rendered probe measures both; this stops them being written.
     */
    const home = HOME();
    const explore = home.slice(home.indexOf('data-testid="home-explore"'));
    const section = explore.slice(0, explore.indexOf('</section>'));
    /* THE CARD'S OWN CLASS STRING. A first version banned `h-[` across the
       whole section and tripped on the icon glyph's `h-[18px]` - which is an
       icon size, not a card height, and exactly the kind of precision this
       rule needs: fixing a CARD's height breaks Arabic, fixing an ICON's is
       how icons are sized. */
    const cardClass = section.slice(section.indexOf('className="group relative'));
    expect(cardClass.slice(0, 400), 'a card has a fixed height').not.toMatch(/\bh-\[\d|\bh-\d+\b/);
    expect(section, 'meaningful copy is being clipped').not.toMatch(/overflow-hidden|line-clamp/);
    expect(section, 'the body copy shrank below 12px').not.toMatch(/text-\[(?:[0-9]|10|11)px\]/);
  });

  it('the action keeps its fill and the five discovery cards keep text links', () => {
    /*
     * The pill got smaller, not weaker. §9: it must not become an ordinary
     * text link, and it must not grow to dominate a 180px card either - the
     * measured 124x48 is now 109x28, still the only filled action in the grid.
     */
    const quotes = entry('quotes');
    expect(quotes, 'the action stopped being a fill').toMatch(/cta: '[^']*bg-brand-accent-500/);
    expect(quotes, 'the action lost its dark label').toMatch(/cta: '[^']*text-foreground/);
    expect(quotes, 'the pill is no longer compact on a phone').toMatch(/px-2\.5 py-1\.5/);
    expect(quotes, 'the pill lost its roomier desktop padding').toMatch(/sm:px-3\.5 sm:py-2/);
  });

  it('THE PROVIDER FAMILY IS DIFFERENTIATED BY AXIS, NOT BY A NEW HUE', () => {
    /*
     * The owner's second note: the four provider journeys "look strongly
     * related - which is good - but slightly too identical". Four saturated
     * hues would fix recognition and rebuild the rainbow, so the variation is
     * the one distinction the architecture has - role views versus declared-
     * category views - expressed as a hairline ring rather than a colour.
     * Fill versus outline is a shape, so it survives grayscale.
     */
    const model = MODEL();
    const ringed = ['products', 'suppliers', 'contractors', 'design', 'finishing', 'quotes']
      .filter(id => entry(id).includes('wellRing'));
    expect(ringed, 'the ring is no longer on exactly the two category journeys')
      .toEqual(['design', 'finishing']);
    /* And the ring stays inside the provider family: it is the domain accent
       at low opacity, never a second colour. */
    expect(model, 'the ring became its own colour')
      .toMatch(/CATEGORY_WELL_RING = 'ring-1 ring-domain-providers\/\d+'/);
    /* The accents are still three, which is the anti-rainbow invariant. */
    const accents = [...model.matchAll(/^    accent: ([^,\n]+),$/gm)].map(m => m[1]);
    expect(new Set(accents).size, 'the ring turned into a fourth accent').toBe(3);
  });

  it('and the section breathes less without losing its hierarchy', () => {
    /*
     * §21: once the cards shorten, 160px of section padding reads as a gap
     * rather than a rhythm. Reduced at the phone end only - the desktop
     * proportions were never the complaint.
     */
    const home = HOME();
    /* The section's OPENING TAG, found by its own class rather than by slicing
       forward from the testid - the padding sits before `data-testid` in the
       attribute order, so a forward slice from there could never see it. */
    const open = home.indexOf('<section className="border-b bg-background');
    expect(open, 'the gateway section is gone').toBeGreaterThan(-1);
    expect(home.slice(open, open + 200), 'the section padding no longer scales')
      .toMatch(/py-12 sm:py-16 lg:py-20/);
    const explore = home.slice(home.indexOf('data-testid="home-explore"'));
    const section = explore.slice(0, explore.indexOf('</section>'));
    expect(section, 'the header block no longer scales').toMatch(/mb-6 max-w-2xl sm:mb-8 lg:mb-10/);
    expect(section, 'the card padding no longer scales').toMatch(/p-3\.5 /);
    expect(section, 'the card lost its roomier desktop padding').toMatch(/sm:p-5 lg:p-7/);
  });
});

describe('the journey tokens are accessible, computed not asserted', () => {
  function tokenRgb(block: string, token: string): [number, number, number] {
    const m = block.match(new RegExp(`${token}:\\s*oklch\\(\\s*([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`));
    expect(m, `${token} is missing`).toBeTruthy();
    return oklchToRgb(Number(m![1]) / 100, Number(m![2]), Number(m![3])) as [number, number, number];
  }
  function block(selector: string): string {
    const css = CSS();
    /* Anchored at a line start: `.dark` also appears inside
       `@custom-variant dark (&:is(.dark *))` and in prose, and a bare indexOf
       found the custom-variant, walked to the next `{` - which belongs to
       `:root` - and reported the light tokens as the dark ones. */
    const rule = new RegExp(`^${selector.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm');
    const found = rule.exec(css);
    if (!found) throw new Error(`${selector} is not a rule`);
    const open = css.indexOf('{', found.index);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) return css.slice(open, i);
    }
    throw new Error(`${selector} unterminated`);
  }
  const LIGHT = () => block(':root');
  const DARK = () => block('.dark');

  it('each accent clears AA against the page and against its own tint', () => {
    for (const domain of ['products', 'providers']) {
      const accent = tokenRgb(LIGHT(), `--domain-${domain}`);
      const tint = tokenRgb(LIGHT(), `--domain-${domain}-tint`);
      const muted = tokenRgb(LIGHT(), '--muted');
      expect(contrast(accent, [255, 255, 255]), `${domain} on white`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accent, tint), `${domain} on its own tint`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accent, muted), `${domain} on a muted panel`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('and the dark theme resolves separately rather than reusing light values', () => {
    for (const domain of ['products', 'providers']) {
      const light = tokenRgb(LIGHT(), `--domain-${domain}`);
      const dark = tokenRgb(DARK(), `--domain-${domain}`);
      expect(rgbToHex(dark), `${domain} reuses its light value on dark`).not.toBe(rgbToHex(light));
      expect(contrast(dark, tokenRgb(DARK(), '--background')), `${domain} on the dark page`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it('no journey hue lands in a status or placement family', () => {
    /*
     * §48's invariant, as degrees. JOURNEY = Supplier, DOMAIN = Provider,
     * VERIFICATION = Verified and PLACEMENT = Sponsored must all be
     * simultaneously representable on one card, so no navigation hue may sit
     * close enough to a status or brand hue to be mistaken for it.
     */
    const hueOf = (blk: string, token: string) => {
      const m = blk.match(new RegExp(`${token}:\\s*oklch\\([\\d.]+%\\s+[\\d.]+\\s+([\\d.]+)\\)`));
      return Number(m![1]);
    };
    const taken = [145, 75, 25, 240, 259, 262, 70];  // success, warning, error, info, navy, blue, amber
    for (const domain of ['products', 'providers']) {
      const hue = hueOf(LIGHT(), `--domain-${domain}`);
      for (const other of taken) {
        const gap = Math.min(Math.abs(hue - other), 360 - Math.abs(hue - other));
        expect(gap, `${domain} (h${hue}) is only ${gap} degrees from h${other}`).toBeGreaterThan(30);
      }
    }
  });
});

describe('journeys come before taxonomy, and stay out of it', () => {
  it('EXPLORE RAKIZA PRECEDES BROWSE BY CATEGORY IN THE DOCUMENT', () => {
    /*
     * Document order decides this at EVERY breakpoint - a grid cannot reflow
     * one section ahead of another - so pinning the order pins the mobile
     * hierarchy too.
     */
    const home = HOME();
    const explore = home.indexOf('data-testid="home-explore"');
    const browse = home.indexOf('data-testid="home-browse"');
    expect(explore, 'the gateway is missing').toBeGreaterThan(-1);
    expect(browse, 'the category rail is missing').toBeGreaterThan(-1);
    expect(explore, 'taxonomy is ahead of the journeys again').toBeLessThan(browse);
  });

  it('and the hero still precedes both', () => {
    const home = HOME();
    expect(home.indexOf('data-testid="home-trust-strip"'))
      .toBeLessThan(home.indexOf('data-testid="home-explore"'));
  });

  it('NO JOURNEY IS IN THE TAXONOMY RAIL', () => {
    /*
     * Get Quotes was once the tenth tile in a nine-category grid - a workflow
     * rendered as a peer of "Marble". The rule now covers all six: internal
     * filtering mechanism does not define public information architecture, so
     * Design and Finishing do not belong in the rail either just because they
     * resolve through category presets.
     */
    const home = HOME();
    const browse = home.slice(home.indexOf('data-testid="home-browse"'));
    const rail = browse.slice(0, browse.indexOf('</section>'));
    expect(rail, 'a journey is in the taxonomy rail').not.toMatch(/home-journey-/);
    expect(rail, 'the Get Quotes tile is back in the rail').not.toContain('home-get-quotes-tile');
  });

  it('the gateway renders every journey from the model', () => {
    const home = HOME();
    const explore = home.slice(home.indexOf('data-testid="home-explore"'));
    const section = explore.slice(0, explore.indexOf('</section>'));
    expect(section).toContain('JOURNEY_IDENTITIES.map');
    expect(section, 'the per-journey testid is gone')
      .toContain('data-testid={`home-journey-${journey.id}`}');
    expect(section, 'the journey kind is no longer exposed').toContain('data-journey-kind');
  });

  it('THE SIX CARDS HAVE COMPARABLE PROMINENCE - no giant card, no chips', () => {
    /*
     * The rejected pattern was one oversized provider card and two small
     * chips. Every card now comes out of one `.map` over one grid with one set
     * of classes, so unequal prominence is not expressible without editing the
     * loop - which is a stronger guarantee than measuring six boxes.
     */
    const home = HOME();
    const explore = home.slice(home.indexOf('data-testid="home-explore"'));
    const section = explore.slice(0, explore.indexOf('</section>'));
    /* The CARD's own testid - `home-journey-${journey.id}` - not the card plus
       the stretched link's `-link` variant, which the first version counted
       and then reported two loops where there is one. */
    const cards = [...section.matchAll(/data-testid=\{`home-journey-\$\{journey\.id\}`\}/g)];
    expect(cards, 'the cards are no longer rendered from one loop').toHaveLength(1);
    expect(section, 'the grid is gone').toMatch(/grid-cols-2[\s\S]{0,80}lg:grid-cols-3/);
  });

  it('and the hierarchy survives grayscale', () => {
    /*
     * The explicit QA criterion. Colour is supplemental: the journey cards are
     * larger, carry an icon and supporting copy that the category tiles do
     * not, and come first.
     */
    const home = HOME();
    const explore = home.slice(home.indexOf('data-testid="home-explore"'));
    const card = explore.slice(0, explore.indexOf('</section>'));
    expect(card, 'the journey cards lost their supporting copy').toContain('blurbKey');
    expect(card, 'the journey cards lost their larger padding').toMatch(/lg:p-7/);
    expect(card, 'the journey cards lost their icon well').toContain('data-journey-well');

    const browse = home.slice(home.indexOf('data-testid="home-browse"'));
    const tile = browse.slice(0, browse.indexOf('</section>'));
    expect(tile, 'category tiles grew to journey size').toContain('p-4');
  });

  it('THE GATEWAY CARD NESTS NO INTERACTIVE CONTENT', () => {
    /*
     * An earlier version made each card a <button> and put secondary links
     * inside it as `role="link" tabIndex={0}` spans. That is invalid HTML and
     * invalid in the way that matters: the inner control is skipped or
     * mis-announced, and both it and the card claimed the same keypress.
     */
    const home = HOME();
    const explore = home.slice(home.indexOf('data-testid="home-explore"'));
    const section = explore.slice(0, explore.indexOf('</section>'));
    expect(section, 'the gateway card is a <button> again').not.toMatch(/<button/);
    expect(section, 'a span is impersonating a link').not.toMatch(/role="link"/);
    expect(section, 'a span is faking focusability').not.toMatch(/tabIndex/);
    expect(section, 'the card lost its stretched hit target')
      .toContain('after:absolute after:inset-0');
  });
});

describe('the gateway speaks Arabic', () => {
  it('every journey label, blurb and CTA has an Arabic value', () => {
    const copy = read('client/src/contexts/LanguageContext.tsx');
    const keys = [...MODEL().matchAll(/(?:labelKey|blurbKey|ctaKey): '([^']+)'/g)].map(m => m[1]);
    const all = [...new Set([...keys, 'home.explore.title', 'home.explore.subtitle'])];
    expect(all.length, 'the journey copy keys are gone').toBeGreaterThanOrEqual(15);
    const arabic = /[؀-ۿ]/;
    for (const key of all) {
      const values = [...copy.matchAll(new RegExp(`'${key.replace(/\./g, '\\.')}': '([^']*)'`, 'g'))]
        .map(m => m[1]);
      expect(values.length, `${key} is not defined twice (EN + AR)`).toBe(2);
      expect(values.some(v => arabic.test(v)), `${key} has no Arabic value`).toBe(true);
      expect(values.every(v => v.trim().length > 0), `${key} has an empty value`).toBe(true);
    }
  });

  it('and the two new directories have Arabic titles too', () => {
    const copy = read('client/src/contexts/LanguageContext.tsx');
    const arabic = /[؀-ۿ]/;
    for (const key of [
      'suppliersDir.title', 'suppliersDir.subtitle',
      'contractorsDir.title', 'contractorsDir.subtitle',
      'marketHub.sectionSuppliersTitle', 'marketHub.sectionContractorsTitle',
    ]) {
      const values = [...copy.matchAll(new RegExp(`'${key.replace(/\./g, '\\.')}': '([^']*)'`, 'g'))]
        .map(m => m[1]);
      expect(values.length, `${key} is not defined twice`).toBe(2);
      expect(values.some(v => arabic.test(v)), `${key} has no Arabic value`).toBe(true);
    }
  });

  it('and no journey copy claims an approval the directory does not mean', () => {
    /*
     * The rejected card read "Approved contractors, engineers, architects,
     * suppliers and project managers". `onboardingStatus = 'approved'` is real,
     * but it means a completed professional registration that an administrator
     * accepted - not an endorsement of the business, and not verification,
     * which is a separate state with its own badge.
     */
    const copy = read('client/src/contexts/LanguageContext.tsx');
    const claims = [...copy.matchAll(
      /'(journey|suppliersDir|contractorsDir|designersDir|finishingDir)\.[\w.]+': '([^']*)'/g)];
    expect(claims.length, 'the journey copy is gone').toBeGreaterThan(20);
    for (const [, , value] of claims) {
      expect(value, `"${value}" claims approval`).not.toMatch(/\bapproved\b/i);
      expect(value, `"${value}" claims trust`).not.toMatch(/\btrusted\b/i);
      expect(value, `"${value}" claims approval in Arabic`).not.toMatch(/معتمد/);
    }
  });
});
