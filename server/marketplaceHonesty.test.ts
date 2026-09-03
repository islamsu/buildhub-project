// ── No surface may publish a rating BuildHub did not earn ──────────────────
//
// CLOSURE PARTS 5 AND 15. client/src/lib/marketplaceData.ts held VENDORS,
// DESIGNERS and FINISHING_COMPANIES: hardcoded "providers" with invented
// ratings, review counts, project counts, years of experience, team sizes and
// `verified: true` badges. Several of them were REAL, NAMED Egyptian companies
// - Ezz Steel, Elsewedy Electric, Ceramica Cleopatra, Jotun Egypt - which have
// no BuildHub account and never agreed to a rating being published about them.
//
// They were rendered on /marketplace/designers, /marketplace/finishing and the
// Marketplace Hub's three "featured" strips and search autocomplete. An earlier
// phase converted /marketplace/vendors and /marketplace/products to real data
// and left these four surfaces behind.
//
// Every provider surface now reads marketplace.vendors: rating from verified
// reviews, verification from the compliance decision, categories declared by
// the vendor. These tests keep it that way.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

/**
 * Source with comments removed.
 *
 * Fourth time in this engagement that a source assertion has tripped on the
 * comment written to explain the thing it was looking for - "verified:" and
 * "VENDORS" both survive here only inside the paragraph describing their
 * removal. Stripping is the fix; weakening the assertion is not.
 */
const codeOnly = (source: string) => source
  .split('\n')
  .filter(line => {
    const trimmed = line.trim();
    return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
  })
  .join('\n');
const DATA = codeOnly(read('../client/src/lib/marketplaceData.ts'));
const HUB = codeOnly(read('../client/src/pages/MarketplaceHub.tsx'));
const DESIGNERS = codeOnly(read('../client/src/pages/DesignersDirectory.tsx'));
const FINISHING = codeOnly(read('../client/src/pages/FinishingDirectory.tsx'));
const DIRECTORY = read('../client/src/pages/VendorsDirectory.tsx');

describe('the fabricated provider lists are gone', () => {
  it('REGRESSION: marketplaceData exports no provider entities', () => {
    for (const symbol of ['VENDORS', 'DESIGNERS', 'FINISHING_COMPANIES']) {
      expect(DATA, `${symbol} is back`).not.toContain(`export const ${symbol}`);
    }
    for (const type of ['Vendor', 'Designer', 'FinishingCompany']) {
      expect(DATA, `${type} is back`).not.toContain(`export interface ${type} {`);
    }
  });

  it('REGRESSION: no real company is named anywhere in the client bundle sources', () => {
    // Named explicitly. These are the ones that were there, and a rating
    // attached to a real business is a factual claim about a third party.
    const clientDir = new URL('../client/src/', import.meta.url);
    const offenders: string[] = [];
    const walk = (dir: URL) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
        if (entry.isDirectory()) { walk(child); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const source = readFileSync(child, 'utf8');
        for (const company of ['Ezz Steel', 'Elsewedy Electric', 'Ceramica Cleopatra', 'Jotun Egypt', 'Alchemy Design Studio']) {
          if (source.includes(company)) offenders.push(`${entry.name}: ${company}`);
        }
      }
    };
    walk(clientDir);
    expect(offenders, 'a real company is still named in client source').toEqual([]);
  });

  it('the taxonomy that remains asserts nothing about anybody', () => {
    // Browse vocabulary is allowed to stay; what must NOT survive is a
    // per-entity claim. This asserted PRODUCT_CATEGORIES specifically, as the
    // control proving the honesty pass had not over-deleted. That list has
    // since become a database table - see shared/categoryTaxonomy.ts and
    // /admin/categories - so the control now names the two vocabularies that
    // legitimately remain. The rule is unchanged and the coverage is the same:
    // something must still be here, and it must claim nothing about anybody.
    expect(DATA).toContain('export const DESIGN_CATEGORIES');
    expect(DATA).toContain('export const FINISHING_CATEGORIES');
    // And the product list must NOT come back. A category vocabulary compiled
    // into the client is the exact defect that produced
    // "Waterproofing is not a BuildHub category".
    expect(DATA, 'the product category list is a database table now')
      .not.toContain('export const PRODUCT_CATEGORIES');
    for (const attribute of ['rating:', 'reviewCount:', 'verified:', 'yearsExperience:', 'teamSize:', 'projectCount:', 'awardWinning:']) {
      expect(DATA, `${attribute} survives in the data file`).not.toContain(attribute);
    }
  });

  it('the orphaned profile sheet that rendered those attributes is gone', () => {
    expect(existsSync(new URL('../client/src/components/MarketplaceProfileSheet.tsx', import.meta.url))).toBe(false);
  });
});

describe('every provider surface reads the authorized directory', () => {
  it('the hub queries marketplace.vendors and nothing else', () => {
    expect(HUB).toContain('trpc.marketplace.vendors.useQuery');
    expect(HUB).not.toContain('VENDORS');
    expect(HUB).not.toContain('DESIGNERS');
    expect(HUB).not.toContain('FINISHING_COMPANIES');
  });

  it('both directories render the SAME component as /marketplace/vendors', () => {
    for (const [name, source] of [['designers', DESIGNERS], ['finishing', FINISHING]] as const) {
      expect(source, `${name} does not reuse the real directory`).toContain('VendorsDirectoryView');
      expect(source).toContain('presetCategory');
    }
    expect(DIRECTORY).toContain('export function VendorsDirectoryView');
  });

  it('the preset categories come from the shared RFQ taxonomy', () => {
    // Not a private vendor vocabulary invented for these two pages.
    const taxonomy = read('../shared/rfqCategories.ts');
    for (const [source, category] of [[DESIGNERS, 'Design'], [FINISHING, 'Renovation']] as const) {
      expect(source).toContain(`presetCategory="${category}"`);
      expect(taxonomy, `${category} is not a real category`).toContain(`'${category}'`);
    }
  });
});

describe('an absent rating is shown as absent, not as a number', () => {
  it('the hub card renders "no reviews yet" when averageRating is null', () => {
    // This is the distinction the fabricated lists erased. A vendor with no
    // verified reviews has no rating - not 0, and not a plausible 4.8.
    expect(HUB).toContain('vendor.averageRating != null');
    expect(HUB).toContain("t('marketHub.noReviewsYet')");
  });

  it('an empty directory renders an empty state rather than filler', () => {
    expect(HUB).toContain("t('marketHub.noneYet')");
    expect(HUB).toContain('featuredVendors.length === 0');
    expect(HUB).toContain('featuredDesigners.length === 0');
    expect(HUB).toContain('featuredCompanies.length === 0');
  });

  it('the hub does not conflate organic order with PAID placement', () => {
    // marketplace.featuredVendors is the paid, labelled surface. The hub's
    // strips are the top of the organic list and must not call that endpoint
    // without the sponsored labelling the vendors page carries.
    expect(HUB).not.toContain('featuredVendors.useQuery');
  });
});
