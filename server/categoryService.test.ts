import { describe, expect, it } from 'vitest';
import {
  resolveCategory, isListable, listableCategories, publicCategories, adminCategories,
  type CategoryIndex, type CanonicalCategory,
} from './categoryService';
import {
  SEED_CATEGORIES, LEGACY_PRODUCT_CATEGORY_VALUES, normalizeCategoryKey,
} from '@shared/categoryTaxonomy';

/**
 * THE CATEGORY RESOLVER.
 *
 * Bulk Product Upload rejected "Waterproofing is not a BuildHub category" for a
 * category BuildHub already had - it lived in the browse-chip vocabulary while
 * the write path validated against a different, shorter list. These tests drive
 * the real resolver, not its source text, and they cover the two things that
 * make it safe: it resolves what should resolve, and it REFUSES rather than
 * guesses everywhere a guess would be wrong.
 */

/** Build an index the way loadCategoryIndex does, without a database. */
function indexFrom(seeds: readonly { slug: string; nameEn: string; nameAr: string; scope?: any; aliases?: readonly string[] }[],
                   overrides: Record<string, Partial<CanonicalCategory>> = {}): CategoryIndex {
  const all: CanonicalCategory[] = seeds.map((seed, i) => ({
    id: i + 1,
    slug: seed.slug,
    nameEn: seed.nameEn,
    nameAr: seed.nameAr,
    scope: (seed.scope ?? 'PRODUCT') as any,
    status: 'active',
    parentId: null,
    sortOrder: i,
    icon: null,
    ...(overrides[seed.slug] ?? {}),
  }));
  const byId = new Map(all.map(c => [c.id, c]));
  const byKey = new Map<string, { category: CanonicalCategory; matchedBy: any }[]>();
  const claim = (raw: string, category: CanonicalCategory, matchedBy: any) => {
    const key = normalizeCategoryKey(raw);
    if (!key) return;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.some(e => e.category.id === category.id)) existing.push({ category, matchedBy });
      return;
    }
    byKey.set(key, [{ category, matchedBy }]);
  };
  all.forEach((category, i) => {
    claim(category.slug, category, 'slug');
    claim(category.nameEn, category, 'nameEn');
    claim(category.nameAr, category, 'nameAr');
    for (const alias of seeds[i].aliases ?? []) claim(alias, category, 'alias');
  });
  return { all, byId, byKey };
}

const full = () => indexFrom(SEED_CATEGORIES);

describe('the seed itself is coherent', () => {
  it('has unique slugs', () => {
    const slugs = SEED_CATEGORIES.map(s => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('gives every category both an English and an Arabic name', () => {
    for (const seed of SEED_CATEGORIES) {
      expect(seed.nameEn.trim().length, seed.slug).toBeGreaterThan(0);
      expect(seed.nameAr.trim().length, `${seed.slug} has no Arabic name`).toBeGreaterThan(0);
    }
  });

  it('claims no normalized key twice - resolution must be deterministic', () => {
    // The index would report AMBIGUOUS at runtime; catching it in the seed means
    // the taxonomy never ships in that state.
    const seen = new Map<string, string>();
    for (const seed of SEED_CATEGORIES) {
      for (const name of [seed.slug, seed.nameEn, seed.nameAr, ...(seed.aliases ?? [])]) {
        const key = normalizeCategoryKey(name);
        const owner = seen.get(key);
        expect(owner === undefined || owner === seed.slug,
          `"${name}" is claimed by both ${owner} and ${seed.slug}`).toBe(true);
        seen.set(key, seed.slug);
      }
    }
  });
});

describe('the reported failure', () => {
  it.each(['Waterproofing', ' waterproofing ', 'WATERPROOFING', 'عزل مائي'])(
    '"%s" resolves to the waterproofing category', supplied => {
      const result = resolveCategory(full(), supplied);
      expect(result.ok && result.category.slug).toBe('waterproofing');
    });

  it('"Pools" resolves through its alias to the category BuildHub already had', () => {
    // Reused, not duplicated: the canonical name stays "Swimming Pool Equipment".
    const result = resolveCategory(full(), 'Pools');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.category.slug).toBe('pools');
      expect(result.category.nameEn).toBe('Swimming Pool Equipment');
    }
  });
});

describe('no existing data is broken', () => {
  it.each(LEGACY_PRODUCT_CATEGORY_VALUES)('the legacy write-path value "%s" still resolves', legacy => {
    // Every one of these may sit in products.category or in a vendor's saved
    // spreadsheet. If one stopped resolving, the reconciliation would have
    // orphaned real rows.
    expect(resolveCategory(full(), legacy).ok).toBe(true);
  });

  it('keeps Marble and Granite distinct rather than merging them', () => {
    const marble = resolveCategory(full(), 'Marble');
    const granite = resolveCategory(full(), 'Granite');
    expect(marble.ok && granite.ok).toBe(true);
    if (marble.ok && granite.ok) expect(marble.category.id).not.toBe(granite.category.id);
  });

  it('refuses the ambiguous "Marble & Granite" chip rather than picking one', () => {
    const result = resolveCategory(full(), 'Marble & Granite');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.reason).toBe('UNKNOWN');
  });
});

describe('rejections say WHICH problem it is', () => {
  it('an empty value is EMPTY, not UNKNOWN', () => {
    const result = resolveCategory(full(), '   ');
    expect(!result.ok && result.rejection.reason).toBe('EMPTY');
  });

  it('an unrecognised value is UNKNOWN and may carry a suggestion', () => {
    const result = resolveCategory(full(), 'Waterproof');
    expect(!result.ok && result.rejection.reason).toBe('UNKNOWN');
    if (!result.ok && result.rejection.reason === 'UNKNOWN') {
      // Offered to a person, never applied.
      expect(result.rejection.suggestions).toContain('Waterproofing');
    }
  });

  /**
   * A SUGGESTION IS ACTED ON BY A PERSON, SO IT IS HELD TO THE SAME STANDARD
   * AS AN ASSIGNMENT.
   *
   * These exist because a live probe found the previous rule - plain substring
   * containment - offering "Roofing" for "Watrproofing", since "watrproofing"
   * happens to end in "roofing". Nothing was auto-applied, so no product was
   * misfiled by the code; a supplier who accepts that suggestion misfiles it
   * himself one step later, which is the same outcome.
   */
  describe('and a suggestion is never a misleading one', () => {
    const suggestionsFor = (supplied: string, index = full()) => {
      const result = resolveCategory(index, supplied);
      if (result.ok || result.rejection.reason !== 'UNKNOWN') return null;
      return result.rejection.suggestions;
    };

    it('offers the right category for a one-letter typo', () => {
      expect(suggestionsFor('Watrproofing')).toContain('Waterproofing');
    });

    it('THE REGRESSION: and does not offer an unrelated trade it merely contains', () => {
      // Roofing and Waterproofing are different trades at different prices. A
      // bitumen membrane filed under Roofing is wrong stock in the wrong place.
      expect(suggestionsFor('Watrproofing')).not.toContain('Roofing');
    });

    it('reaches a category through a typo of its ALIAS, not only its name', () => {
      // "Poolz" is nowhere near "Swimming Pool Equipment", and one letter from
      // the "Pools" alias. Offering nothing here is a worse answer than the
      // alias can give.
      expect(suggestionsFor('Poolz')).toContain('Swimming Pool Equipment');
    });

    it('offers a category the supplied value NARROWS - a prefix or a whole word', () => {
      expect(suggestionsFor('Waterproof')).toContain('Waterproofing');
      expect(suggestionsFor('Pool')).toContain('Swimming Pool Equipment');
    });

    it('offers nothing at all rather than something wrong', () => {
      // Genuinely unrelated. An empty list tells the supplier to go and look;
      // a wrong one tells him to stop looking.
      expect(suggestionsFor('Zqxwv')).toEqual([]);
    });

    it('never proposes a value that is itself ambiguous', () => {
      // Two categories claiming one name is refused on resolution, so offering
      // it as the fix would send the supplier round the same loop.
      const index = indexFrom([
        ...SEED_CATEGORIES,
        { slug: 'granite-alt', nameEn: 'Granite', nameAr: 'جرانيت بديل' },
      ]);
      expect(suggestionsFor('Granit', index) ?? []).not.toContain('Granite');
    });

    it('never proposes a hidden or service-only category', () => {
      const index = indexFrom(SEED_CATEGORIES, { waterproofing: { status: 'hidden' } });
      expect(suggestionsFor('Watrproofing', index) ?? []).not.toContain('Waterproofing');
    });

    it('is deterministic and bounded - the same file gives the same message twice', () => {
      const first = suggestionsFor('Cemen');
      expect(suggestionsFor('Cemen')).toEqual(first);
      expect((first ?? []).length).toBeLessThanOrEqual(3);
    });

    it('does not guess from two or three characters', () => {
      // At that length almost everything is within two edits of something.
      expect(suggestionsFor('ce')).toEqual([]);
    });
  });

  it('a hidden category is INACTIVE, never "not a BuildHub category"', () => {
    // The distinction the reported error could not make. A hidden category
    // EXISTS; the uploader needs to ask an administrator, not hunt for a typo.
    const index = indexFrom(SEED_CATEGORIES, { waterproofing: { status: 'hidden' } });
    const result = resolveCategory(index, 'Waterproofing');
    expect(!result.ok && result.rejection.reason).toBe('INACTIVE');
    if (!result.ok && result.rejection.reason === 'INACTIVE') {
      expect(result.rejection.category.slug).toBe('waterproofing');
    }
  });

  it('an archived category is INACTIVE too', () => {
    const index = indexFrom(SEED_CATEGORIES, { pools: { status: 'archived' } });
    const result = resolveCategory(index, 'Pools');
    expect(!result.ok && result.rejection.reason).toBe('INACTIVE');
  });

  it('a service-only category used for a product is SERVICE_ONLY', () => {
    const index = indexFrom(SEED_CATEGORIES, { materials: { scope: 'SERVICE' } });
    const result = resolveCategory(index, 'Materials');
    expect(!result.ok && result.rejection.reason).toBe('SERVICE_ONLY');
  });

  it('a category outside the vendor allowance is NOT_ALLOWED_FOR_VENDOR', () => {
    // Adding a global category must not make every vendor eligible for it.
    const result = resolveCategory(full(), 'Waterproofing', { allowedCategoryIds: new Set([-1]) });
    expect(!result.ok && result.rejection.reason).toBe('NOT_ALLOWED_FOR_VENDOR');
  });

  it('two categories claiming one name is AMBIGUOUS, not first-wins', () => {
    const index = indexFrom([
      { slug: 'a', nameEn: 'Tiles', nameAr: 'بلاط' },
      { slug: 'b', nameEn: 'Tiles', nameAr: 'سيراميك' },
    ]);
    const result = resolveCategory(index, 'Tiles');
    expect(!result.ok && result.rejection.reason).toBe('AMBIGUOUS');
    if (!result.ok && result.rejection.reason === 'AMBIGUOUS') {
      expect(result.rejection.candidates).toHaveLength(2);
    }
  });
});

describe('normalisation is exact, not fuzzy', () => {
  it('ignores case, surrounding and repeated whitespace', () => {
    expect(normalizeCategoryKey('  WATER   proofing ')).toBe('water proofing');
  });

  it('strips Arabic tatweel and zero-width characters, which carry no meaning', () => {
    expect(normalizeCategoryKey('عزلـ مائي')).toBe(normalizeCategoryKey('عزل مائي'));
    expect(normalizeCategoryKey('Pools​')).toBe('pools');
  });

  it('does NOT resolve a near-miss - a typo is refused, never corrected', () => {
    // "Poolz" is one character from a real category. Accepting it would file a
    // product under a category the uploader never chose.
    expect(resolveCategory(full(), 'Poolz').ok).toBe(false);
    expect(resolveCategory(full(), 'Watrproofing').ok).toBe(false);
  });
});

describe('the authorized views are filters over one taxonomy', () => {
  const index = indexFrom(SEED_CATEGORIES, {
    pools: { status: 'hidden' },
    materials: { scope: 'SERVICE' },
    marble: { status: 'archived' },
  });

  it('listable excludes hidden, archived and service-only', () => {
    const slugs = listableCategories(index).map(c => c.slug);
    expect(slugs).not.toContain('pools');
    expect(slugs).not.toContain('materials');
    expect(slugs).not.toContain('marble');
    expect(slugs).toContain('waterproofing');
  });

  it('public excludes anything not active', () => {
    const slugs = publicCategories(index).map(c => c.slug);
    expect(slugs).not.toContain('pools');
    expect(slugs).not.toContain('marble');
  });

  it('admin sees everything, including what nobody else does', () => {
    expect(adminCategories(index)).toHaveLength(SEED_CATEGORIES.length);
    expect(adminCategories(index).map(c => c.slug)).toContain('pools');
  });

  it('and all three are views of the SAME rows, never separate lists', () => {
    const ids = new Set(adminCategories(index).map(c => c.id));
    for (const category of [...listableCategories(index), ...publicCategories(index)]) {
      expect(ids.has(category.id)).toBe(true);
    }
  });

  it('isListable is what "may be listed against" means, in one place', () => {
    expect(isListable({ ...index.all[0], status: 'active', scope: 'PRODUCT' })).toBe(true);
    expect(isListable({ ...index.all[0], status: 'active', scope: 'BOTH' })).toBe(true);
    expect(isListable({ ...index.all[0], status: 'active', scope: 'SERVICE' })).toBe(false);
    expect(isListable({ ...index.all[0], status: 'hidden', scope: 'PRODUCT' })).toBe(false);
  });
});
