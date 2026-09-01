import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

/**
 * FEATURED PRODUCTS ARE EDITORIAL, NOT PAID PLACEMENT.
 *
 * `products.featured` existed and the marketplace sorted by it, but nothing
 * could set it, so the sort and the "Featured" badge were inert. This pins the
 * admin control that closes that gap and the least-privilege tier it sits on.
 */

const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));
const COMMERCIAL = readSourceForAssertions(readFileSync(new URL('./_core/commercialAudit.ts', import.meta.url), 'utf8'));

function procedureBody(anchor: string): string {
  const start = ROUTERS.indexOf(anchor);
  expect(start, `${anchor} not found`).toBeGreaterThan(-1);
  const end = ROUTERS.indexOf('\n  setVendorPlanManually:', start);
  return ROUTERS.slice(start, end === -1 ? undefined : end);
}

describe('admin.setProductFeatured', () => {
  it('is gated on marketplace.manage, not a broader or narrower admin role', () => {
    expect(ROUTERS).toMatch(/setProductFeatured: adminWith\('marketplace\.manage'\)/);
  });

  it('updates the real products.featured column', () => {
    const body = procedureBody('setProductFeatured: adminWith');
    expect(body).toContain('.update(products).set({ featured: input.featured })');
    expect(body).toContain('eq(products.id, input.productId)');
  });

  it('does not change product ownership', () => {
    const body = procedureBody('setProductFeatured: adminWith');
    expect(body).not.toContain('supplierId =');
    expect(body).not.toMatch(/set\(\{[^}]*supplierId/);
  });

  it('records the value change and the commercial event', () => {
    const body = procedureBody('setProductFeatured: adminWith');
    expect(body).toContain("field: 'featured'");
    expect(body).toContain("action: input.featured ? 'product_featured' : 'product_unfeatured'");
  });

  it('the new commercial actions are declared in the audit contract', () => {
    expect(COMMERCIAL).toContain("'product_featured' | 'product_unfeatured'");
  });
});
