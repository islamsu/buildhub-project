import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { oklchToRgb, contrast, rgbToHex } from '../scripts/brand/palette.mjs';
import { readSourceForAssertions } from './_testing/sourceText';

/**
 * ── DOMAIN IS A FOURTH JOB FOR COLOUR, AND IT STAYS IN ITS LANE ─────────
 *
 * The owner looked at the real staging site and found two things: the
 * marketplace domains had lost their identities in the rebrand, and the
 * homepage had put taxonomy ahead of the platform's own journeys.
 *
 * Both are hierarchy failures, and both are the kind that a passing test suite
 * cannot see - every assertion was green while the highest-intent workflow in
 * the product sat as the tenth tile in a category rail, a peer of "Marble".
 * So these pin the HIERARCHY and the SEPARATION, not the pixels.
 *
 *   BRAND      whose platform is this         navy, amber, secondary blue
 *   DOMAIN     which part of the marketplace  teal, violet
 *   STATUS     what happened / what state     success, warning, error, info
 *   PLACEMENT  why is this emphasised         Featured, Sponsored
 */

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => readSourceForAssertions(read(rel));

const MODEL = () => code('client/src/components/brand/domainIdentity.ts');
const HOME = () => code('client/src/pages/Home.tsx');
const CSS = () => read('client/src/index.css');

describe('there is one domain model, and pages read it', () => {
  it('the model names exactly the domains the architecture has', () => {
    /*
     * Two. `/marketplace/products` is the catalogue; `/marketplace/vendors` is
     * ONE directory holding all five provider roles. A third entry earns its
     * place when the product gains a real third domain - not because a mockup
     * showed one.
     */
    const model = MODEL();
    const domains = [...model.matchAll(/kind: '(domain|workflow)'/g)].map(m => m[1]);
    expect(domains.filter(k => k === 'domain')).toHaveLength(2);
    expect(domains.filter(k => k === 'workflow')).toHaveLength(1);
    expect(model).toContain("id: 'products'");
    expect(model).toContain("id: 'providers'");
  });

  it('GET QUOTES IS A WORKFLOW, NOT A THIRD DOMAIN COLOUR', () => {
    /*
     * It sits beside the two domains and carries the RAKIZA accent, and that
     * amber means "this is the primary RAKIZA action" - the same thing it means
     * on Sign Up and on Search. It is not "the Get Quotes colour". Amber stops
     * meaning anything the moment it is also a domain, a category, a warning
     * and a sponsorship, so the distinction is typed rather than remembered.
     */
    const model = MODEL();
    const quotes = model.slice(model.indexOf("id: 'quotes'"));
    expect(quotes.slice(0, 400)).toContain("kind: 'workflow'");
    expect(quotes.slice(0, 400), 'the workflow took a domain token')
      .not.toMatch(/domain-(products|providers)/);
    expect(quotes.slice(0, 400)).toContain('brand-accent');
  });

  it('THE WORKFLOW CTA IS A FILL, THE DOMAIN CTAs ARE LINKS', () => {
    /*
     * This started as a contrast fix and ended up a hierarchy improvement, so
     * it is worth pinning for both reasons.
     *
     * The contrast reason: the domain accents are 6.69:1 and 7.78:1 on a white
     * card and are legal as 14px text; Accent Amber's darkest permitted step
     * is 3.11:1, which is a glyph colour and not a small-label colour. A
     * rendered probe measured that after the source tests had passed it.
     *
     * The hierarchy reason: a filled pill beside two text links ranks the RFQ
     * journey first with no colour involved, which is exactly the grayscale
     * criterion the owner set. The difference is structural, so it survives
     * being desaturated, printed, or viewed by someone who cannot separate
     * teal from violet from amber.
     */
    const model = MODEL();
    const entries = [...model.matchAll(/id: '(products|providers|quotes)'[\s\S]{0,900}?\n  \},/g)]
      .map(m => m[0]);
    expect(entries, 'the model no longer parses as three entries').toHaveLength(3);
    for (const entry of entries) {
      expect(entry, 'an entry has no CTA treatment').toMatch(/cta: '[^']+'/);
    }
    const quotes = entries.find(e => e.includes("id: 'quotes'"))!;
    const domains = entries.filter(e => !e.includes("id: 'quotes'"));

    expect(quotes, 'the workflow CTA is not a fill').toMatch(/cta: '[^']*bg-brand-accent-500/);
    expect(quotes, 'the workflow CTA has no dark label').toMatch(/cta: '[^']*text-foreground/);
    expect(quotes, 'amber is being used as a text colour again')
      .not.toMatch(/cta: '[^']*text-brand-accent/);
    for (const domain of domains) {
      expect(domain, 'a domain CTA became a fill').not.toMatch(/cta: '[^']*\bbg-/);
      expect(domain, 'a domain CTA lost its own accent').toMatch(/cta: 'text-domain-/);
    }
  });

  it('every destination in the model is a route that exists', () => {
    const routes = [...MODEL().matchAll(/href: '([^']+)'/g)].map(m => m[1]);
    expect(routes.length).toBeGreaterThanOrEqual(5);
    const app = code('client/src/App.tsx');
    for (const route of routes) {
      expect(app, `${route} is not a route`).toContain(`path={"${route}"}`);
    }
  });

  it('no page keeps a private copy of a domain colour', () => {
    /*
     * The failure this prevents is the one the pre-RAKIZA system had: ten
     * identities across two incompatible tables, four of them colliding with
     * status meanings. A call site names the DOMAIN; the model supplies the
     * value.
     */
    function walk(dir: string, out: string[] = []): string[] {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry)) out.push(full);
      }
      return out;
    }
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, 'client/src'))) {
      if (file.endsWith('domainIdentity.ts')) continue;
      const source = readSourceForAssertions(readFileSync(file, 'utf8'));
      for (const m of source.matchAll(/\b(bg|text|border)-(teal|violet|purple|cyan|fuchsia)-\d{2,3}\b/g)) {
        offenders.push(`${file.slice(ROOT.length + 1)} :: ${m[0]}`);
      }
    }
    expect(offenders, 'a page is inventing its own domain hue').toEqual([]);
  });

  it('identity is never colour alone - every domain has an icon and a label key', () => {
    const model = MODEL();
    const entries = [...model.matchAll(/id: '(products|providers|quotes)'[\s\S]{0,400}?\}/g)].map(m => m[0]);
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry, 'a domain has no icon').toMatch(/icon: \w+/);
      expect(entry, 'a domain has no label key').toMatch(/labelKey: '[^']+'/);
      expect(entry, 'a domain has no supporting copy').toMatch(/blurbKey: '[^']+'/);
    }
  });
});

describe('the domain tokens are accessible, computed not asserted', () => {
  /** `--token: oklch(L% C H)` out of a named block. */
  function tokenRgb(block: string, token: string): [number, number, number] {
    const m = block.match(new RegExp(`${token}:\\s*oklch\\(\\s*([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`));
    expect(m, `${token} is missing`).toBeTruthy();
    return oklchToRgb(Number(m![1]) / 100, Number(m![2]), Number(m![3])) as [number, number, number];
  }
  function block(selector: string): string {
    const css = CSS();
    /*
     * Anchored at a line start, because `.dark` also appears inside
     * `@custom-variant dark (&:is(.dark *))` on line 4 and in two prose
     * comments. A bare indexOf found the custom-variant, walked to the next
     * `{` - which belongs to `:root` - and then reported the light tokens as
     * the dark ones. The first version of this helper passed the "dark differs
     * from light" assertion for the wrong reason until a missing token made it
     * fail loudly.
     */
    const rule = new RegExp(`^${selector.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm');
    const found = rule.exec(css);
    if (!found) throw new Error(`${selector} is not a rule`);
    const at = found.index;
    const open = css.indexOf('{', at);
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
      const page = tokenRgb(LIGHT(), '--muted');   // closest neutral surface in oklch form
      expect(contrast(accent, [255, 255, 255]), `${domain} on white`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accent, tint), `${domain} on its own tint`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accent, page), `${domain} on a muted panel`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('and the dark theme resolves separately rather than reusing light values', () => {
    /*
     * The brand RAMP is a palette and does not invert - what changes is which
     * step a surface reaches for. A domain token is a single role-based value,
     * so it must resolve per theme or the teal that reads at 6.69:1 on white
     * reads at 1.6:1 on near-black.
     */
    for (const domain of ['products', 'providers']) {
      const light = tokenRgb(LIGHT(), `--domain-${domain}`);
      const dark = tokenRgb(DARK(), `--domain-${domain}`);
      expect(rgbToHex(dark), `${domain} reuses its light value on dark`).not.toBe(rgbToHex(light));
      const darkBg = tokenRgb(DARK(), '--background');
      expect(contrast(dark, darkBg), `${domain} on the dark page`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('no domain hue lands in a status family', () => {
    /*
     * Carbon ships exactly four support tokens and nothing else may enter that
     * family. A domain hue inside success/warning/error/info would make
     * "Products" readable as "succeeded".
     */
    const hueOf = (block: string, token: string) => {
      const m = block.match(new RegExp(`${token}:\\s*oklch\\([\\d.]+%\\s+[\\d.]+\\s+([\\d.]+)\\)`));
      return Number(m![1]);
    };
    const statusHues = [145, 75, 25, 240, 259, 262, 70];  // success, warning, error, info, navy, blue, amber
    for (const domain of ['products', 'providers']) {
      const hue = hueOf(LIGHT(), `--domain-${domain}`);
      for (const taken of statusHues) {
        const gap = Math.min(Math.abs(hue - taken), 360 - Math.abs(hue - taken));
        expect(gap, `${domain} (h${hue}) is only ${gap} degrees from h${taken}`).toBeGreaterThan(30);
      }
    }
  });
});

describe('platform journeys come before taxonomy', () => {
  it('EXPLORE RAKIZA PRECEDES BROWSE BY CATEGORY IN THE DOCUMENT', () => {
    /*
     * The whole correction, in one assertion. Document order is what decides
     * this at EVERY breakpoint - a grid cannot reflow one section ahead of
     * another - so pinning the order pins the mobile hierarchy too.
     */
    const home = HOME();
    const explore = home.indexOf('data-testid="home-explore"');
    const browse = home.indexOf('data-testid="home-browse"');
    expect(explore, 'the gateway is missing').toBeGreaterThan(-1);
    expect(browse, 'the category rail is missing').toBeGreaterThan(-1);
    expect(explore, 'taxonomy is ahead of the platform journeys again').toBeLessThan(browse);
  });

  it('and the hero still precedes both', () => {
    const home = HOME();
    expect(home.indexOf('data-testid="home-trust-strip"'))
      .toBeLessThan(home.indexOf('data-testid="home-explore"'));
  });

  it('GET QUOTES LEFT THE TAXONOMY RAIL', () => {
    /*
     * It was the tenth tile in a nine-category grid - a workflow rendered as a
     * peer of "Marble". That is the category error the owner saw.
     */
    const home = HOME();
    const browse = home.slice(home.indexOf('data-testid="home-browse"'));
    const railEnd = browse.indexOf('</section>');
    expect(browse.slice(0, railEnd), 'a workflow is back in the taxonomy rail')
      .not.toContain('home-get-quotes-tile');
    /*
     * And it is in the gateway instead. The testid is composed from the model
     * (`home-domain-${domain.id}`), so the concatenated string never appears
     * in the source - assert the template and the model entry, which is what
     * actually guarantees the card renders.
     */
    const explore = home.slice(home.indexOf('data-testid="home-explore"'));
    expect(explore.slice(0, explore.indexOf('</section>')))
      .toContain('data-testid={`home-domain-${domain.id}`}');
    expect(MODEL(), 'Get Quotes left the rail without arriving in the gateway')
      .toContain("id: 'quotes'");
  });

  it('the gateway renders all three cards from the model', () => {
    const home = HOME();
    expect(home).toContain('DOMAIN_IDENTITIES.map');
    expect(home, 'the provider presets are not rendered').toContain('PROVIDER_PRESETS.map');
  });

  it('THE GATEWAY CARD NESTS NO INTERACTIVE CONTENT', () => {
    /*
     * The first version of this gateway made each card a <button> and put the
     * two Providers presets inside it as `role="link" tabIndex={0}` spans.
     * That is invalid HTML - interactive content inside a button - and it is
     * invalid in the way that matters: the inner control is skipped or
     * mis-announced by assistive technology, and an activation inside a button
     * is ambiguous. Both the card and the preset claimed the same keypress.
     *
     * The card is now a container; one stretched link makes the whole surface
     * clickable; the presets are real links stacked above it.
     */
    const home = HOME();
    const explore = home.slice(home.indexOf('data-testid="home-explore"'));
    const section = explore.slice(0, explore.indexOf('</section>'));

    expect(section, 'the gateway card is a <button> again').not.toMatch(/<button/);
    expect(section, 'a preset is faking a link with a role on a span')
      .not.toMatch(/role="link"/);
    expect(section, 'a preset is faking focusability with tabIndex')
      .not.toMatch(/tabIndex/);
    expect(section, 'the card lost its stretched hit target')
      .toContain('after:absolute after:inset-0');
    expect(section, 'the presets are not real links').toMatch(/<Link\s+key=\{preset\.id\}/);
    expect(section, 'the presets would sit under the stretched link')
      .toContain('relative z-10');
  });

  it('the hierarchy survives grayscale', () => {
    /*
     * The explicit QA criterion. Colour is supplemental: the gateway cards are
     * larger (p-7 vs p-4), carry supporting copy that the category tiles do
     * not, and come first. Remove every hue and the ranking is unchanged.
     */
    const home = HOME();
    const explore = home.slice(home.indexOf('data-testid="home-explore"'));
    const exploreCard = explore.slice(0, explore.indexOf('</section>'));
    expect(exploreCard, 'the gateway cards lost their larger padding').toContain('p-7');
    expect(exploreCard, 'the gateway cards lost their supporting copy').toContain('blurbKey');

    const browse = home.slice(home.indexOf('data-testid="home-browse"'));
    const browseCard = browse.slice(0, browse.indexOf('</section>'));
    expect(browseCard, 'category tiles grew to gateway size').toContain('p-4');
  });
});

describe('the gateway speaks Arabic', () => {
  it('every label and blurb has an Arabic value', () => {
    const copy = read('client/src/contexts/LanguageContext.tsx');
    const keys = [...MODEL().matchAll(/(?:labelKey|blurbKey): '([^']+)'/g)].map(m => m[1]);
    const presetKeys = [...MODEL().matchAll(/labelKey: '(domain\.preset\.[^']+)'/g)].map(m => m[1]);
    const all = [...new Set([...keys, ...presetKeys, 'home.explore.title', 'home.explore.subtitle'])];
    expect(all.length).toBeGreaterThanOrEqual(8);
    const arabic = /[؀-ۿ]/;
    for (const key of all) {
      const values = [...copy.matchAll(new RegExp(`'${key.replace(/\./g, '\\.')}': '([^']*)'`, 'g'))]
        .map(m => m[1]);
      expect(values.length, `${key} is not defined twice (EN + AR)`).toBe(2);
      expect(values.some(v => arabic.test(v)), `${key} has no Arabic value`).toBe(true);
    }
  });
});
