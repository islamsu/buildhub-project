/**
 * ── THE FOUR NUMBERS ON THE MARKETPLACE HUB ───────────────────────────────
 *
 * The hub's section cards each carry a headline figure. Two of them counted
 * REAL ACCOUNTS and two counted a CONSTANT COMPILED INTO THE PAGE:
 *
 *     products    productCategories.length   the real taxonomy      honest
 *     vendors     directory.length           real accounts          honest
 *     designers   DESIGN_CATEGORIES.length   a hardcoded list of 14
 *     finishing   FINISHING_CATEGORIES.length a hardcoded list
 *
 * With no designer on the platform the card still read "14 disciplines" - a
 * number that cannot move, sitting in the same slot, in the same typeface, as
 * one that can. A reader comparing the four cards was being shown depth the
 * marketplace might not have. `Home.tsx` is the standard this failed to meet:
 * it renders a figure only when it is a real, non-zero count, and shows
 * nothing at all otherwise.
 *
 * The CHIPS are a different thing and stay: they describe what the section
 * covers, they are not filters, and the card as a whole is what navigates.
 * `client/src/lib/marketplaceData.ts` says as much in its own header.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const HUB = readSourceForAssertions(read('../client/src/pages/MarketplaceHub.tsx'));
const HOME = readSourceForAssertions(read('../client/src/pages/Home.tsx'));
const DESIGNERS = readSourceForAssertions(read('../client/src/pages/DesignersDirectory.tsx'));
const FINISHING = readSourceForAssertions(read('../client/src/pages/FinishingDirectory.tsx'));
const LANG = read('../client/src/contexts/LanguageContext.tsx');

/** One section's definition, by id, with both boundaries proven. */
function section(id: string): string {
  const start = HUB.indexOf(`id: '${id}'`);
  expect(start, `the ${id} section is gone`).toBeGreaterThan(-1);
  const end = HUB.indexOf('chips:', start);
  expect(end, `the ${id} section has no chips - the shape changed`).toBeGreaterThan(start);
  return HUB.slice(start, end);
}

describe('every headline count on the hub counts something real', () => {
  it('THE DESIGNERS CARD COUNTS DESIGNERS, not a list of disciplines', () => {
    const body = section('designers');
    expect(body).toContain('stat: `${designers.length}`');
    expect(body, 'the constant is back').not.toContain('DESIGN_CATEGORIES.length');
  });

  it('and the finishing card counts finishing providers', () => {
    const body = section('finishing');
    expect(body).toContain('stat: `${finishing.length}`');
    expect(body, 'the constant is back').not.toContain('FINISHING_CATEGORIES.length');
  });

  it('both are derived from the SAME authorized directory the strips render', () => {
    // Not a second, looser query: the directory already excludes unapproved
    // and unverified accounts, so nothing here can count a provider the
    // marketplace itself would not list.
    expect(HUB).toContain("const designers = directory.filter(v => v.categories?.includes('Design'))");
    expect(HUB).toContain("const finishing = directory.filter(v => v.categories?.includes('Renovation'))");
    expect(HUB).toContain('trpc.marketplace.vendors.useQuery');
  });

  it('and they are LABELLED as what they now count', () => {
    for (const id of ['designers', 'finishing']) {
      expect(section(id), id).toContain("statLabel: t('marketHub.providersLabel')");
    }
    const hits = [...LANG.matchAll(/'marketHub\.providersLabel': '([^']+)'/g)].map(m => m[1]);
    expect(hits, 'the label is not translated in both languages').toHaveLength(2);
    expect(hits[1], 'the Arabic label is an English fallback').toMatch(/[؀-ۿ]/);
  });

  it('the other two cards were already honest and are untouched', () => {
    expect(section('products')).toContain('stat: `${productCategories.length}`');
    expect(section('vendors')).toContain('stat: `${directory.length}`');
  });

  it('NO SECTION COUNTS A COMPILED-IN CONSTANT', () => {
    // The rule, over the whole block rather than card by card, so a new
    // section cannot quietly reintroduce it.
    const sections = HUB.slice(HUB.indexOf('const sections = ['), HUB.indexOf('EDITORIAL FEATURED') > -1
      ? HUB.indexOf('EDITORIAL FEATURED') : HUB.length);
    const stats = [...sections.matchAll(/stat: `\$\{([^}]+)\}`/g)].map(m => m[1]);
    expect(stats.length, 'the stats are gone').toBe(4);
    for (const expression of stats) {
      expect(expression, `${expression} is a constant, not a count of anything real`)
        .not.toMatch(/^[A-Z_]+\.length$/);
    }
  });
});

describe('the chips stay what they are', () => {
  it('they describe the section and do not pretend to filter', () => {
    // Each chip is a Badge, not a button, and the CARD is what navigates.
    const render = HUB.slice(HUB.indexOf('hub-chips-'));
    expect(render.length).toBeGreaterThan(60);
    expect(render).toContain('<Badge');
    expect(render, 'a chip became a control that filters nothing')
      .not.toMatch(/<Badge[^>]*onClick/);
  });

  it('and the product chips still come from the one canonical taxonomy', () => {
    // The defect CAT found: 33 browse chips sharing no values with the 19 the
    // write path accepted, so clicking one could never find a product.
    expect(section('products')).toBeTruthy();
    expect(HUB).toContain("trpc.marketplace.categories.useQuery({ view: 'public' })");
    expect(HUB, 'a third product-category list is back').not.toContain('PRODUCT_CATEGORIES');
  });
});

describe('the directories behind the cards read real accounts', () => {
  it('designers and finishing both render the real vendor directory', () => {
    for (const [name, source] of [['designers', DESIGNERS], ['finishing', FINISHING]] as const) {
      expect(source, `${name} no longer uses the shared directory`).toContain('VendorsDirectoryView');
      expect(source, `${name} is back to a hardcoded list`).not.toContain('marketplaceData');
    }
  });

  it('filtered on a category providers actually declare', () => {
    expect(DESIGNERS).toContain('presetCategory="Design"');
    expect(FINISHING).toContain('presetCategory="Renovation"');
  });
});

describe('the standard the hub had to meet', () => {
  it('Home shows a figure only when it is a real, non-zero count', () => {
    // Quoted here because it is the rule the hub was failing, and a reader of
    // this file should be able to see what "honest" was measured against.
    expect(HOME).toContain('trpc.marketplace.platformStats.useQuery');
    expect(HOME).toMatch(/show: stats\.registeredUsers > 0/);
    expect(HOME).toContain('.filter(stat => stat.show)');
  });
});
