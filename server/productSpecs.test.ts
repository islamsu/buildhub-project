import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

/**
 * PRODUCT SPECIFICATIONS / ATTRIBUTES MUST PERSIST.
 *
 * `products.specs` existed, and ProductDetail already rendered it as a list,
 * but neither create nor update accepted it and no form collected it - so the
 * rendered "Specifications" card was always empty. This pins the now-complete
 * chain: form -> create/update -> column -> detail render.
 */

const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));
const FORM = readSourceForAssertions(readFileSync(new URL('../client/src/pages/ProductFormPage.tsx', import.meta.url), 'utf8'));
const DETAIL = readSourceForAssertions(readFileSync(new URL('../client/src/pages/ProductDetail.tsx', import.meta.url), 'utf8'));

describe('product specifications persist end to end', () => {
  it('create accepts specs', () => {
    const block = ROUTERS.slice(ROUTERS.indexOf('create: approvedProviderProcedure'), ROUTERS.indexOf('importProducts:'));
    expect(block).toContain('specs: z.string().max(5000).optional()');
  });

  it('update accepts specs', () => {
    const block = ROUTERS.slice(ROUTERS.indexOf('updateProduct: approvedProviderProcedure'), ROUTERS.indexOf('setProductActive:'));
    expect(block).toContain('specs: z.string().max(5000).optional()');
  });

  it('the single-product form collects and submits specs', () => {
    expect(FORM).toContain('data-testid="product-specs"');
    expect(FORM).toContain('specs: form.specs.trim() || undefined');
  });

  it('ProductDetail renders specs from the stored column', () => {
    expect(DETAIL).toContain('parseList(product?.specs)');
  });
});
