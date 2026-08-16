import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getProductVariants } from '../client/src/lib/marketplaceCatalog';

describe('marketplace variant RFQ handoff', () => {
  it('provides typed standard and bulk variants for a product unit', () => {
    const variants = getProductVariants({ unit: 'm²' });
    expect(variants.map(variant => variant.id)).toEqual(['standard', 'bulk']);
    expect(variants[0].label).toBe('m²');
    expect(variants[1].unitMultiplier).toBe(10);
  });

  it('reads the saved reference and includes it in the RFQ create mutation', () => {
    const source = readFileSync(resolve(process.cwd(), 'client/src/pages/RFQPage.tsx'), 'utf8');
    expect(source).toContain("localStorage.getItem('bh-rfq-product')");
    expect(source).toContain('productReference: marketplaceProduct ?? undefined');
    expect(source).toContain('rfq.productReference');
  });
});
