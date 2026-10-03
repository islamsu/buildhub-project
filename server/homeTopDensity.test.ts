import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';

/**
 * ── THE TOP OF THE MOBILE HOMEPAGE ────────────────────────────────────────
 *
 * The owner reviewed the real staging site on a phone, accepted the Explore
 * RAKIZA section below, and said the area above it needed attention. An audit
 * answered the first question - is anything broken - and the answer was no:
 * nothing clipped, nothing under the fixed header, no overflow at any of ten
 * viewports, and the screenshot reproduced exactly at scrollY 1100 as ordinary
 * mid-scroll framing.
 *
 * What was real was the HEIGHT: 1414px at 375, 1.68 phone screens before
 * Explore began, a third of it spent on four capability statements rendered in
 * ONE column.
 *
 * ── WHAT THESE ASSERTIONS ARE FOR ─────────────────────────────────────────
 *
 * Structural invariants only. The pixels live in evidence/zg-hometop.mjs,
 * which measures before and after at ten viewports - freezing a height here
 * would be one Arabic copy edit away from a false failure, and the brief
 * explicitly asked for behaviour rather than pixel freezes.
 *
 * What is pinned is the shape of the fix and the things that must not be used
 * to achieve it: no truncation, no clamping, no fixed heights, no body copy
 * below 16px, and all four trust statements retained.
 */

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => readSourceForAssertions(read(rel));
const HOME = () => code('client/src/pages/Home.tsx');
const COPY = () => read('client/src/contexts/LanguageContext.tsx');

/** The hero section's source, bounded by its own opening tag. */
function hero(): string {
  const home = HOME();
  const at = home.indexOf('<section className="relative overflow-hidden gradient-hero">');
  expect(at, 'the hero section is gone').toBeGreaterThan(-1);
  return home.slice(at, home.indexOf('data-testid="home-explore"'));
}

describe('A - the trust strip is two by two on a phone', () => {
  it('FOUR STATEMENTS IN TWO COLUMNS, not four in one', () => {
    /*
     * 4 x 116px stacked measured 467px - the single largest contributor to the
     * 1.68 screens. Two columns is the same pattern the Explore grid below
     * already uses, so the two sections read as one system.
     */
    /*
     * THE UL'S OWN CLASS STRING, and nothing else.
     *
     * The first version of this took everything from 400 characters before the
     * testid to the END of the hero - which includes the platform-stats grid,
     * which has its own `grid-cols-2`. Removing the class from the trust strip
     * left the assertion passing on the stats block's copy of it, and a
     * mutation proved the most important check in this pass was vacuous.
     */
    const section = hero();
    const at = section.indexOf('data-testid="home-trust-strip"');
    expect(at, 'the trust strip is gone').toBeGreaterThan(-1);
    const classAt = section.lastIndexOf('className="', at);
    const strip = section.slice(classAt, section.indexOf('"', classAt + 11));
    expect(strip, 'the strip is no longer two columns on a phone').toMatch(/grid-cols-2/);
    expect(strip, 'the four-column desktop step is gone').toMatch(/lg:grid-cols-4/);
    /* And it is the UL being measured, not something near it. The element's
       tag sits on the line ABOVE its className, so the lookback has to clear
       the indentation - a 10-character window found only whitespace, which
       this guard caught on itself. */
    expect(section.slice(Math.max(0, classAt - 40), classAt), 'the window drifted off the <ul>')
      .toContain('<ul');
  });

  it('and all four capability statements are retained', () => {
    /*
     * Not removed, not carousewhichever, not hidden behind a toggle, and not
     * converted into numbers. These are claims the next page can be checked
     * against, which is the only kind of trust signal this product may make.
     */
    const home = HOME();
    const keys = [...home.matchAll(/\{ icon: \w+, key: '(\w+)' \}/g)].map(m => m[1]);
    expect(keys, 'a trust statement was dropped')
      .toEqual(['verified', 'compare', 'free', 'oneplace']);
    const copy = COPY();
    for (const key of keys) {
      for (const suffix of ['', '.note']) {
        const values = [...copy.matchAll(
          new RegExp(`'home\\.trust\\.${key}${suffix.replace('.', '\\.')}': '([^']*)'`, 'g'))];
        expect(values.length, `home.trust.${key}${suffix} is not defined twice`).toBe(2);
      }
    }
    expect(home, 'the strip became a carousel').not.toMatch(/carousel|Carousel|embla/);
  });

  it('and the statements are still capability claims, not numbers', () => {
    const copy = COPY();
    for (const key of ['verified', 'compare', 'free', 'oneplace']) {
      const values = [...copy.matchAll(new RegExp(`'home\\.trust\\.${key}': '([^']*)'`, 'g'))]
        .map(m => m[1]);
      for (const value of values) {
        expect(value, `"${value}" put a number in a capability statement`)
          .not.toMatch(/\d/);
      }
    }
  });
});

describe('B and C - the mobile top and its rhythm', () => {
  it('THE HERO CLEARS THE FIXED NAVBAR BY PADDING, with less of it', () => {
    /*
     * `pt-28` over a 64px fixed navbar left 48px of measured nothing. `pt-20`
     * leaves 16px - still deliberate separation, not a collision - and the
     * desktop figure is untouched.
     *
     * NO NEGATIVE MARGIN, which the brief forbids and which would be the
     * tempting way to buy the same pixels: the hero would then start above the
     * navbar and rely on z-order to look right.
     */
    const section = hero();
    expect(section, 'the hero top padding no longer scales')
      .toMatch(/pt-20 pb-10 sm:pt-24 sm:pb-14 lg:pt-32 lg:pb-20/);
    expect(section, 'a negative margin is doing the spacing').not.toMatch(/-mt-|-pt-/);
    /* The navbar is still fixed at 64px, which is what the 16px of clearance
       is measured against. */
    expect(code('client/src/components/Navbar.tsx'), 'the navbar stopped being fixed')
      .toMatch(/fixed top-0 inset-x-0 z-50/);
    expect(code('client/src/components/Navbar.tsx'), 'the navbar height changed')
      .toMatch(/justify-between h-16/);
  });

  it('and each tightened gap keeps its desktop value', () => {
    /*
     * Desktop was never the complaint. Every change is a phone value with the
     * original restored at `sm` or `lg` - so the two compositions are tuned
     * separately rather than one being sacrificed for the other.
     */
    const section = hero();
    expect(section, 'the trust gap lost its desktop value').toMatch(/mt-10 grid[^"]*sm:mt-14/);
    expect(section, 'the stats gap lost its desktop value')
      .toMatch(/mt-8 grid[^"]*sm:mt-12[^"]*sm:pt-8/);
  });
});

describe('D - the hero subtitle', () => {
  it('16px ON A PHONE, 18px ABOVE, and never below 16', () => {
    /*
     * 18px wrapped to four lines inside a 327px column. 16px is comfortable
     * mobile body size and the floor the rendered probe enforces.
     *
     * HONEST OUTCOME: the line count stays 4 at 375 and 393 in English - the
     * sentence is simply long - and drops to 3 at 430 and at every Arabic
     * width. The brief forbade rewriting the value proposition to force a line
     * count, so it was not rewritten; what the change bought is the type size
     * and the leading, not the wrap.
     */
    const section = hero();
    expect(section, 'the subtitle no longer scales')
      .toMatch(/text-base leading-relaxed text-white\/75 sm:mb-8 sm:text-lg/);
    /* THE SUBTITLE'S OWN CLASS STRING. A first version scanned the whole hero
       and tripped on the section's `overflow-hidden`, which has been there
       since the grid overlay was added and has nothing to do with copy - the
       precision matters, because clipping a paragraph and clipping a
       decorative background are different acts. */
    const subtitleAt = section.indexOf('text-base leading-relaxed text-white/75');
    const subtitleClass = section.slice(section.lastIndexOf('className="', subtitleAt), subtitleAt + 90);
    expect(subtitleClass, 'the subtitle is being truncated or clamped')
      .not.toMatch(/line-clamp|truncate|overflow-hidden|max-h-/);
  });

  it('and the value proposition itself is unchanged in both languages', () => {
    const copy = COPY();
    expect(copy).toMatch(/'hero\.subtitle': 'Rakiza connects homeowners, contractors, engineers/);
    expect(copy).toMatch(/'hero\.subtitle': 'تربط ركيزة أصحاب المنازل والمقاولين/);
  });
});

describe('E - a stat label agrees with its own number', () => {
  it('ONE SELECTOR FOR COUNTED NOUNS, serving both call sites', () => {
    /*
     * "1 Active Projects" was on the real homepage. The category rail already
     * had a correct four-form Arabic selector; the proof strip had a flat
     * constant. A second, simpler rule beside a correct one is how the simpler
     * one ends up being the one that ships, so there is now one.
     */
    const home = HOME();
    expect(home, 'the shared count selector is gone')
      .toMatch(/const countForm = \(n: number\): 'one' \| 'two' \| 'few' \| 'other'/);
    expect(home, 'the rail stopped using the shared selector')
      .toMatch(/\}\[countForm\(n\)\]/);
    expect(home, 'the stats stopped using the shared selector')
      .toMatch(/const form = countForm\(n\)/);
    expect(home, 'the dead label constant is still here').not.toMatch(/STAT_LABELS\./);
    /* And the call site no longer branches on language itself - the selector
       knows which language it is in. */
    const grid = home.slice(home.indexOf('data-testid="platform-stats"'));
    expect(grid.slice(0, 900), 'a language ternary came back to the call site')
      .not.toMatch(/lang === 'ar' \? stat\./);
  });

  it('ARABIC GETS FOUR FORMS, NOT AN ENGLISH PLURAL', () => {
    /*
     * Arabic number agreement is singular / dual / 3-10 / accusative-singular
     * after 11. Before this the page showed "29 منتج معروض" - the 11-and-above
     * slot filled with a singular. A naive plural suffix would have been the
     * same mistake with extra steps.
     */
    const copy = COPY();
    const arabic = /[؀-ۿ]/;
    for (const key of ['publicProducts', 'registeredUsers', 'activeProjects', 'verifiedProviders']) {
      const forms = ['one', 'two', 'few', 'other'];
      for (const form of forms) {
        const values = [...copy.matchAll(
          new RegExp(`'home\\.stat\\.${key}\\.${form}': '([^']*)'`, 'g'))].map(m => m[1]);
        expect(values.length, `home.stat.${key}.${form} is not defined twice (EN + AR)`).toBe(2);
        expect(values.some(v => arabic.test(v)), `home.stat.${key}.${form} has no Arabic`).toBe(true);
      }
      /* The four ARABIC forms must be genuinely different from each other -
         four identical strings would be the English model wearing a four-form
         costume. */
      const arForms = forms.map(form => {
        const all = [...copy.matchAll(
          new RegExp(`'home\\.stat\\.${key}\\.${form}': '([^']*)'`, 'g'))].map(m => m[1]);
        return all.find(v => arabic.test(v))!;
      });
      expect(new Set(arForms).size, `${key} has ${new Set(arForms).size} distinct Arabic forms, not 4`)
        .toBe(4);
      /* English legitimately has two distinct values across four keys. */
      const enForms = forms.map(form => {
        const all = [...copy.matchAll(
          new RegExp(`'home\\.stat\\.${key}\\.${form}': '([^']*)'`, 'g'))].map(m => m[1]);
        return all.find(v => !arabic.test(v))!;
      });
      expect(new Set(enForms).size, `${key} has no English singular`).toBe(2);
      expect(enForms[0], `${key} singular is not singular`).not.toBe(enForms[3]);
    }
  });

  it('and Average Rating declares one form, because it is not a count', () => {
    const copy = COPY();
    expect(copy).toMatch(/'home\.stat\.satisfaction\.other': 'Average Rating'/);
    expect(copy).toMatch(/'home\.stat\.satisfaction\.other': 'متوسط التقييم'/);
    expect(copy, 'a rating was given a plural').not.toMatch(/'home\.stat\.satisfaction\.(one|two|few)'/);
    /* Passed count 0, which resolves to `other` in both languages - the one
       form it declares. Passing the rating would ask Arabic to decline a label
       that has no plural. */
    expect(HOME()).toMatch(/key: 'satisfaction'[^\n]*count: 0/);
  });

  it('THE STATS THEMSELVES ARE UNTOUCHED - presentation only', () => {
    /*
     * The brief authorised the singular/plural presentation and nothing else:
     * no query, no definition, no suppression rule. 1 Active Project still
     * shows, because truthful thin proof is better than fabricated proof.
     */
    const home = HOME();
    const block = home.slice(home.indexOf('const liveStats ='));
    const body = block.slice(0, block.indexOf('.filter(stat => stat.show)'));
    for (const key of [
      'publicProducts', 'registeredUsers', 'activeProjects', 'verifiedProviders', 'satisfaction',
    ]) {
      expect(body, `${key} is no longer a stat`).toContain(`key: '${key}'`);
    }
    /* The same suppress-at-zero rule on the same four counts. */
    for (const key of ['publicProducts', 'registeredUsers', 'activeProjects', 'verifiedProviders']) {
      expect(body, `${key} lost its non-zero guard`).toContain(`show: stats.${key} > 0`);
    }
    expect(body, 'the rating guard changed').toContain('show: stats.satisfaction !== null');
    expect(body, 'a stat value is being massaged').not.toMatch(/Math\.(round|max|min|floor)/);
    expect(home, 'the stats query changed')
      .toContain('trpc.marketplace.platformStats.useQuery()');
  });
});

describe('the pass stopped where Explore RAKIZA begins', () => {
  it('EXPLORE RAKIZA IS BYTE-FOR-BYTE WHAT THE OWNER ACCEPTED', () => {
    /*
     * A hard freeze, asserted rather than promised. The homepage-top pass ends
     * immediately before this section, so every class, label, icon, route and
     * gap inside it is the accepted a97b721 text.
     *
     * Checked as a digest of the section's whole source: any edit at all -
     * a padding, a word, a testid - changes it. If this fails after an
     * intentional Explore change, the digest is updated in the same commit
     * that changes the section, deliberately and visibly.
     */
    const home = HOME();
    const start = home.indexOf('<section className="border-b bg-background py-12 sm:py-16 lg:py-20" data-testid="home-explore">');
    expect(start, 'the Explore section opening tag changed').toBeGreaterThan(-1);
    const end = home.indexOf('data-testid="home-browse"');
    expect(end, 'the category rail is gone').toBeGreaterThan(start);
    const section = home.slice(start, end);

    /* The six journeys, their order, and the structure around them. */
    expect(section).toContain('JOURNEY_IDENTITIES.map');
    expect(section).toContain('data-testid={`home-journey-${journey.id}`}');
    expect(section).toMatch(/grid grid-cols-2 items-stretch gap-2\.5 sm:gap-4 lg:grid-cols-3 lg:gap-5/);
    expect(section).toMatch(/p-3\.5 text-start[\s\S]{0,200}sm:p-5 lg:p-7/);
    expect(section).toContain('data-journey-well');
    expect(section).toContain('data-journey-cta');
    expect(section).toMatch(/h-10 w-10[\s\S]{0,80}sm:h-11 sm:w-11 lg:h-14 lg:w-14/);
    expect(section).toMatch(/mt-auto flex pt-2\.5 sm:pt-3\.5/);
    /* Both halves of the phone/desktop copy switch, asserted independently -
       a distance window between them only measured how long the comment
       between them happened to be. */
    expect(section, 'the phone description is gone').toContain('t(journey.shortKey)');
    expect(section, 'the phone copy is not hidden above the breakpoint').toMatch(/sm:hidden/);
    expect(section, 'the long copy is not hidden below the breakpoint')
      .toMatch(/hidden[^"]*sm:inline/);
  });

  it('and the journey model is untouched', () => {
    const model = code('client/src/components/brand/domainIdentity.ts');
    const ids = [...model.matchAll(/^    id: '([a-z]+)',$/gm)].map(m => m[1]);
    expect(ids).toEqual(['products', 'suppliers', 'contractors', 'design', 'finishing', 'quotes']);
    const copy = COPY();
    for (const [key, en, ar] of [
      ['journey.products', 'Products & Materials', 'المنتجات والمواد'],
      ['journey.suppliers', 'Suppliers', 'الموردون'],
      ['journey.contractors', 'Contractors', 'المقاولون'],
      ['journey.design', 'Design Services', 'خدمات التصميم'],
      ['journey.finishing', 'Finishing', 'التشطيبات'],
      ['journey.quotes', 'Get Quotes', 'اطلب عروض أسعار'],
    ] as Array<[string, string, string]>) {
      expect(copy, `${key} is no longer "${en}"`).toContain(`'${key}': '${en}'`);
      expect(copy, `${key} is no longer "${ar}"`).toContain(`'${key}': '${ar}'`);
    }
  });

  it('and Explore still follows the proof strip, which follows the hero', () => {
    const home = HOME();
    const order = ['home-trust-strip', 'platform-stats', 'home-explore', 'home-browse']
      .map(id => home.indexOf(`data-testid="${id}"`));
    expect(order.every(i => i > -1), 'a section is missing').toBe(true);
    for (let i = 1; i < order.length; i++) {
      expect(order[i], `section ${i} moved ahead of section ${i - 1}`).toBeGreaterThan(order[i - 1]);
    }
  });
});

describe('F was deferred, and the navbar proves it', () => {
  it('no navbar, menu or language-control dimension changed', () => {
    /*
     * The audit found the header controls at 36x36 and 80x32 - which pass
     * WCAG 2.2 AA (SC 2.5.8 wants 24x24) and sit below the 44x44 of SC 2.5.5
     * AAA and the platform guidelines. The owner deferred that refinement, and
     * it is unrelated to the hero-height problem, so the header is untouched.
     */
    const nav = code('client/src/components/Navbar.tsx');
    expect(nav).toMatch(/justify-between h-16/);
    expect(nav).toMatch(/className=\{`md:hidden \$\{isTransparent/);
    expect(nav).toMatch(/<LanguageToggle className=/);
  });
});
