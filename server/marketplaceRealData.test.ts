import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The public marketplace shows real inventory.
 *
 * Found in staging QA, in a real browser, on a public URL: every product card
 * showed a broken image. Chasing the 401 led to the cause - the products page
 * rendered DEMO_PRODUCTS, ten hardcoded fictional products with invented
 * brands, prices, stock levels and ratings ("4.8 ★, 124 reviews" on inventory
 * that does not exist), and never called marketplace.list at all. Their images
 * pointed at Manus-era /manus-storage/ assets, which the storage proxy refuses
 * to anonymous callers.
 *
 * Same defect class as the vendor dashboard's fabricated statistics
 * (Phase 4A.6.4) and the admin dashboard's invented growth chart (Slice 4).
 * The vendor DIRECTORY was moved onto real data in Phase 4B.3; the product
 * catalogue was left behind.
 */

/**
 * Comments stripped before scanning. Every one of these assertions names the
 * thing it forbids, and the code explains next to it why that thing was wrong -
 * so a naive search finds the explanation and reports a failure. This has
 * caught me out repeatedly in this codebase.
 */
const codeOnly = (source: string) => source
  .split('\n')
  .filter(line => {
    const t = line.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  })
  .join('\n');

const read = (relative: string) => codeOnly(readFileSync(new URL(relative, import.meta.url), 'utf8'));
const MARKETPLACE = read('../client/src/pages/Marketplace.tsx');
const DETAIL = read('../client/src/pages/ProductDetail.tsx');
const CATALOGUE = read('../client/src/lib/marketplaceCatalog.ts');
const ROUTERS = read('./routers.ts');

describe('§1 no fabricated inventory', () => {
  it('REGRESSION: the fictional catalogue is gone', () => {
    expect(CATALOGUE).not.toContain('export const DEMO_PRODUCTS');
    for (const file of [MARKETPLACE, DETAIL]) {
      expect(file).not.toContain('DEMO_PRODUCTS');
    }
  });

  it('no invented brand or rating survives anywhere in the client', () => {
    for (const invention of ['Cleopatra', 'Carrara', 'SunPower', 'Italian Marble Slabs', 'Premium Ceramic Floor Tiles']) {
      expect(MARKETPLACE, invention).not.toContain(invention);
      expect(CATALOGUE, invention).not.toContain(invention);
    }
  });

  it('the variant helpers survive — they are real and the RFQ handoff uses them', () => {
    expect(CATALOGUE).toContain('export function getProductVariants');
    expect(CATALOGUE).toContain('DEFAULT_PRODUCT_VARIANTS');
  });
});

describe('§2 the pages read the database', () => {
  it('the listing calls marketplace.list', () => {
    expect(MARKETPLACE).toContain('trpc.marketplace.list.useQuery');
  });

  it('REGRESSION: product detail has no hardcoded id boundary', () => {
    // It was `enabled: productId > 10`, treating ids 1-10 as fictional. A real
    // product with a low id would have rendered as an invented one.
    expect(DETAIL).not.toContain('productId > 10');
    expect(DETAIL).toContain('productId > 0');
  });

  it('the compare table resolves against the same real list the grid renders', () => {
    expect(MARKETPLACE).toContain('filtered.find(x => x.id === id)');
  });

  it('ratings are not asserted for products that have none', () => {
    expect(MARKETPLACE).toContain('p.reviewCount > 0');
  });
});

describe('§3 the endpoint honours its own inputs', () => {
  const block = ROUTERS.slice(ROUTERS.indexOf('  list: publicProcedure'), ROUTERS.indexOf('  get: publicProcedure'));

  it('REGRESSION: category and search are actually applied', () => {
    // Both were accepted and silently ignored - the query built a filter
    // variable and never used it. Nothing noticed because the page filtered a
    // hardcoded array on the client rather than calling this endpoint.
    expect(block).toContain('input.category');
    expect(block).toContain('input.search');
    expect(block).toContain('like(products.name');
  });

  it('search covers the Arabic name too, on a bilingual marketplace', () => {
    expect(block).toContain('like(products.nameAr');
  });

  it('withdrawn products stay excluded from the listing', () => {
    expect(block).toContain('eq(products.active, true)');
  });

  it('"All" is treated as no filter rather than a category named All', () => {
    expect(block).toContain("input.category !== 'All'");
  });
});
