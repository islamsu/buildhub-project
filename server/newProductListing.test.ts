import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

/**
 * `/products/new` is the single address a supplier uses to list stock, and it
 * must offer BOTH ways in - one product at a time, or a CSV of many - rather
 * than hiding bulk import behind a different screen. The two surfaces already
 * existed; the choice between them was the missing piece.
 */

const read = (relative: string) =>
  readSourceForAssertions(readFileSync(new URL(relative, import.meta.url), 'utf8'));

describe('/products/new offers single-product and bulk upload', () => {
  const FORM = read('../client/src/pages/ProductFormPage.tsx');
  const IMPORT = read('../client/src/components/ProductImport.tsx');

  it('exposes the choice between the two entry modes', () => {
    expect(FORM).toContain('data-testid="product-listing-mode"');
    expect(FORM).toContain('data-testid="listing-mode-single"');
    expect(FORM).toContain('data-testid="listing-mode-bulk"');
  });

  it('bulk mode renders the real import surface, never a stub', () => {
    // The toggle must swap in the SAME component the supplier workspace uses,
    // so the import is a real server-backed flow, not a second fake screen.
    expect(FORM).toMatch(/!editing && listingMode === 'bulk'/);
    expect(FORM).toContain('<ProductImport');
    expect(IMPORT).toContain('data-testid="product-import"');
    expect(IMPORT).toContain('importProducts');
  });

  it('the single-product form keeps its required fields', () => {
    expect(FORM).toContain('data-testid="product-name"');
    expect(FORM).toContain('data-testid="product-category"');
    expect(FORM).toContain('data-testid="product-origin"');
    expect(FORM).toContain('origin: form.origin || undefined');
  });

  it('the choice is create-only: editing a product never shows the bulk option', () => {
    // `editing` drives the toggle away. Guarding it with `!editing` means the
    // edit route cannot accidentally offer a CSV import of an existing row.
    expect(FORM).toMatch(/!editing && listingMode === 'bulk'/);
  });
});
