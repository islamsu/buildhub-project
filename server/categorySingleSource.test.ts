import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { SEED_CATEGORIES, LEGACY_PRODUCT_CATEGORY_VALUES } from '@shared/categoryTaxonomy';
import { stripComments } from './_testing/sourceText';

/**
 * ONE TAXONOMY. THIS IS THE GUARD THAT KEEPS IT ONE.
 *
 * The reported failure - "Waterproofing is not a BuildHub category" for a
 * category BuildHub plainly had - was not a missing value. It was FOUR
 * separately-maintained product-category vocabularies:
 *
 *   shared/productCategories.ts        19 strings, the write-path validator
 *   client/src/lib/marketplaceData.ts  33 browse chips, sharing NO values with it
 *   marketplace.categories (inline)    27 names that DID include Waterproofing
 *   Marketplace.tsx CATEGORY_AR/ICONS  a fifth and sixth, for Arabic and icons
 *
 * A marketplace filter offered a category, a supplier chose it, and the write
 * path refused it. All of them are gone; the taxonomy is a database table with
 * one canonical name, one Arabic name and one icon per category.
 *
 * These tests sweep the repository for a new one appearing. Adding a category
 * list back into the client or into shared code is the defect, not a style
 * preference, so it fails the build rather than a review.
 */

const ROOT = new URL('../', import.meta.url);

function sourcesUnder(relative: string, found: { path: string; text: string }[] = []) {
  const dir = new URL(relative, ROOT);
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const child = `${relative}${entry.name}${entry.isDirectory() ? '/' : ''}`;
    if (entry.isDirectory()) { sourcesUnder(child, found); continue; }
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.test.ts')) continue;
    found.push({ path: child, text: readFileSync(new URL(child, ROOT), 'utf8') });
  }
  return found;
}

describe('the sweep reads real files - otherwise every rule below is vacuous', () => {
  it('finds the client and the shared directory', () => {
    const client = sourcesUnder('client/src/');
    expect(client.length).toBeGreaterThan(50);
    expect(client.some(f => f.path.endsWith('pages/Marketplace.tsx'))).toBe(true);
    expect(sourcesUnder('shared/').length).toBeGreaterThan(5);
  });
});

describe('the retired vocabularies stay retired', () => {
  it('shared/productCategories.ts no longer exists', () => {
    // It held the nineteen strings the write path validated against. Its values
    // survive as LEGACY_PRODUCT_CATEGORY_VALUES, which the resolver tests drive
    // to prove no stored product was orphaned by the reconciliation.
    expect(existsSync(new URL('shared/productCategories.ts', ROOT))).toBe(false);
    expect(LEGACY_PRODUCT_CATEGORY_VALUES.length).toBe(19);
  });

  it('nothing imports it', () => {
    const offenders = [...sourcesUnder('client/src/'), ...sourcesUnder('shared/'), ...sourcesUnder('server/')]
      .filter(file => /from ['"][^'"]*productCategories['"]/.test(file.text))
      .map(file => file.path);
    expect(offenders).toEqual([]);
  });

  it('marketplaceData exports no product category list', () => {
    const text = readFileSync(new URL('client/src/lib/marketplaceData.ts', ROOT), 'utf8');
    expect(text).not.toContain('export const PRODUCT_CATEGORIES');
  });

  it('Marketplace.tsx keeps no Arabic-name or icon map of its own', () => {
    // These were keyed on the retired 27-name list and had already fallen
    // behind: "Cement & Concrete" appeared in neither, so an Arabic-reading
    // shopper saw an English chip with no icon.
    const text = readFileSync(new URL('client/src/pages/Marketplace.tsx', ROOT), 'utf8');
    expect(text).not.toContain('const CATEGORY_AR');
    expect(text).not.toContain('const CATEGORY_ICONS');
    expect(text).not.toContain('const CATEGORY_EMOJI');
  });
});

describe('every category surface reads the one taxonomy', () => {
  const reads = (path: string) => readFileSync(new URL(path, ROOT), 'utf8');

  it.each([
    ['client/src/pages/Marketplace.tsx', 'the marketplace filter'],
    ['client/src/pages/MarketplaceHub.tsx', 'the discovery hub chips'],
    ['client/src/pages/ProductFormPage.tsx', 'the single-product form'],
    ['client/src/components/ProductImport.tsx', 'the bulk upload reference'],
  ])('%s queries marketplace.categories (%s)', (path) => {
    expect(reads(path)).toContain('trpc.marketplace.categories.useQuery');
  });

  it('the admin page reads the admin view, which is a different FILTER not a different list', () => {
    expect(reads('client/src/pages/AdminCategories.tsx')).toContain('trpc.admin.categories.useQuery');
  });
});

describe('no new hard-coded product taxonomy has appeared', () => {
  /**
   * A category array is recognisable: several of the taxonomy's own canonical
   * names, as string literals, in one file. Three or more is not a coincidence
   * - a screen naming one category in a label is fine, a screen listing them is
   * a second vocabulary.
   *
   * COMMENTS ARE STRIPPED FIRST. This codebase explains its own defects at
   * length, and both categoryService.ts and routers.ts discuss "Waterproofing"
   * and "Swimming Pool Equipment" by name in the comments that say why the
   * taxonomy exists. Matching prose would fail the files that document the fix.
   */
  const CANONICAL = SEED_CATEGORIES.map(seed => seed.nameEn);
  const listsCategories = (text: string) =>
    CANONICAL.filter(name => text.includes(`'${name}'`) || text.includes(`"${name}"`));

  /**
   * Files exempt from the rule, each with its reason. A file may be missing
   * from the sweep only by appearing here, which turns the exemption into a
   * decision somebody wrote down.
   */
  const EXEMPT: Readonly<Record<string, string>> = {
    'shared/categoryTaxonomy.ts':
      'IS the seed - the one place the canonical names belong',
    'shared/knowledgeTaxonomy.ts':
      'the AI knowledge corpus: topics for retrieval, not categories a product is filed under. '
      + 'It shares words with the taxonomy because construction topics are named after materials, '
      + 'and nothing validates a product against it',
  };

  it('no client or shared file lists three or more canonical category names', () => {
    const offenders: string[] = [];
    for (const file of [...sourcesUnder('client/src/'), ...sourcesUnder('shared/')]) {
      if (EXEMPT[file.path]) continue;
      const hits = listsCategories(stripComments(file.text));
      if (hits.length >= 3) offenders.push(`${file.path}: ${hits.slice(0, 5).join(', ')}`);
    }
    expect(offenders, `these look like a second category vocabulary: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('and neither does the server', () => {
    const offenders: string[] = [];
    for (const file of sourcesUnder('server/')) {
      if (EXEMPT[file.path]) continue;
      const hits = listsCategories(stripComments(file.text));
      if (hits.length >= 3) offenders.push(`${file.path}: ${hits.slice(0, 5).join(', ')}`);
    }
    expect(offenders, `these look like a second category vocabulary: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('the sweep can still SEE a violation - otherwise the two rules above are vacuous', () => {
    // The exact failure mode this file exists to prevent, fed to the same
    // detector. A guard that cannot recognise the defect proves nothing.
    const planted = `const CATEGORIES = ['${CANONICAL[0]}', '${CANONICAL[1]}', '${CANONICAL[2]}'];`;
    expect(listsCategories(stripComments(planted)).length).toBeGreaterThanOrEqual(3);
  });

  it('RFQ service categories are a DIFFERENT concern and stay separate', () => {
    /*
     * shared/rfqCategories.ts matches vendors to RFQs by declared SERVICE. It
     * is persisted in rfqs.category and vendorCategories.category, and merging
     * it into the product taxonomy would silently recategorise both.
     *
     * The two vocabularies DO share two words, and always have: "Materials"
     * and "Furniture". They mean different things in different columns - an
     * RFQ categorised "Materials" is a request for materials to be supplied,
     * while a product categorised "Materials" is a product. That overlap is
     * pinned here so it stays exactly two: a third would mean the two are
     * converging, which is a decision to take deliberately rather than to
     * discover later.
     */
    expect(existsSync(new URL('shared/rfqCategories.ts', ROOT))).toBe(true);
    const rfq = stripComments(readFileSync(new URL('shared/rfqCategories.ts', ROOT), 'utf8'));
    const overlap = CANONICAL.filter(name => rfq.includes(`'${name}'`)).sort();
    expect(overlap).toEqual(['Furniture', 'Materials']);
  });

  it('and no product write path validates against the RFQ vocabulary', () => {
    // The separation that actually matters: whatever words they share, an
    // RFQ service category must never be accepted as a product category.
    const routers = stripComments(readFileSync(new URL('server/routers.ts', ROOT), 'utf8'));
    const importProducts = routers.slice(routers.indexOf('importProducts:'), routers.indexOf('importProducts:') + 4000);
    expect(importProducts).not.toContain('RFQ_CATEGORIES');
    expect(importProducts).toContain('loadCategoryIndex');
  });
});
