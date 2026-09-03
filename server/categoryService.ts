/**
 * THE ONE CANONICAL CATEGORY SERVICE.
 *
 * Every category question in BuildHub is answered here: what may be listed
 * against, what a browse filter offers, what an administrator sees, and what an
 * uploaded string resolves to. There is deliberately no second implementation
 * for bulk upload - that separation is exactly what produced
 * "Waterproofing is not a BuildHub category" for a category the product already
 * had, and it is the thing this module exists to make impossible.
 *
 * RESOLUTION IS EXACT, NEVER FUZZY. Case, surrounding whitespace, runs of inner
 * whitespace, Arabic tatweel and zero-width characters are noise and are
 * normalised away. Nothing computes an edit distance: a near-match that quietly
 * files a product under the wrong category is worse than an error the uploader
 * can act on. The one place similarity appears is `suggestionsFor`, which
 * proposes a value for a HUMAN to choose and never applies one.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { productCategories, productCategoryAliases, products } from '../drizzle/schema';
import { normalizeCategoryKey, type CategoryScope, type CategoryStatus } from '../shared/categoryTaxonomy';

export type CanonicalCategory = {
  id: number;
  slug: string;
  nameEn: string;
  nameAr: string;
  scope: CategoryScope;
  status: CategoryStatus;
  parentId: number | null;
  sortOrder: number;
  icon: string | null;
};

/**
 * WHY A RESOLUTION FAILED, as a machine-readable reason.
 *
 * These are genuinely different problems for the person holding the
 * spreadsheet, and collapsing them into one message is what made the reported
 * failure unactionable. A hidden category is not an unknown one: the uploader
 * needs to know it exists and to ask an administrator, not to go looking for a
 * spelling mistake that is not there.
 */
export type CategoryRejection =
  | { reason: 'EMPTY' }
  | { reason: 'UNKNOWN'; supplied: string; suggestions: string[] }
  | { reason: 'INACTIVE'; supplied: string; category: CanonicalCategory }
  | { reason: 'SERVICE_ONLY'; supplied: string; category: CanonicalCategory }
  | { reason: 'NOT_ALLOWED_FOR_VENDOR'; supplied: string; category: CanonicalCategory }
  | { reason: 'AMBIGUOUS'; supplied: string; candidates: CanonicalCategory[] };

export type CategoryResolution =
  | { ok: true; category: CanonicalCategory; matchedBy: 'slug' | 'nameEn' | 'nameAr' | 'alias' }
  | { ok: false; rejection: CategoryRejection };

/** A category is listable against when it is active and not service-only. */
export function isListable(category: CanonicalCategory): boolean {
  return category.status === 'active' && category.scope !== 'SERVICE';
}

const asCategory = (row: any): CanonicalCategory => ({
  id: Number(row.id),
  slug: String(row.slug),
  nameEn: String(row.nameEn),
  nameAr: String(row.nameAr),
  scope: row.scope as CategoryScope,
  status: row.status as CategoryStatus,
  parentId: row.parentId == null ? null : Number(row.parentId),
  sortOrder: Number(row.sortOrder ?? 0),
  icon: row.icon ?? null,
});

/**
 * THE LOOKUP INDEX, built once per resolution batch.
 *
 * Bulk upload resolves hundreds of rows, and doing a query per row would make a
 * 500-row file 500 round trips. The whole taxonomy is small - tens of rows - so
 * it is read once and matched in memory.
 */
export type CategoryIndex = {
  all: CanonicalCategory[];
  byId: Map<number, CanonicalCategory>;
  /** normalized key -> the categories claiming it, so ambiguity is detectable. */
  byKey: Map<string, { category: CanonicalCategory; matchedBy: 'slug' | 'nameEn' | 'nameAr' | 'alias' }[]>;
};

export async function loadCategoryIndex(db: any): Promise<CategoryIndex> {
  const [rows, aliasRows] = await Promise.all([
    db.select().from(productCategories),
    db.select().from(productCategoryAliases),
  ]);

  const all = (rows as any[]).map(asCategory)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const byId = new Map(all.map(category => [category.id, category]));
  const byKey = new Map<string, { category: CanonicalCategory; matchedBy: 'slug' | 'nameEn' | 'nameAr' | 'alias' }[]>();

  const claim = (raw: string, category: CanonicalCategory, matchedBy: 'slug' | 'nameEn' | 'nameAr' | 'alias') => {
    const key = normalizeCategoryKey(raw);
    if (!key) return;
    const existing = byKey.get(key);
    if (existing) {
      // Same category claiming the same key twice (a slug equal to its name, say)
      // is not ambiguity - it is one answer reached two ways.
      if (!existing.some(entry => entry.category.id === category.id)) existing.push({ category, matchedBy });
      return;
    }
    byKey.set(key, [{ category, matchedBy }]);
  };

  for (const category of all) {
    claim(category.slug, category, 'slug');
    claim(category.nameEn, category, 'nameEn');
    claim(category.nameAr, category, 'nameAr');
  }
  for (const alias of aliasRows as any[]) {
    const category = byId.get(Number(alias.categoryId));
    if (category) claim(String(alias.alias), category, 'alias');
  }

  return { all, byId, byKey };
}

/**
 * Names close enough to be worth OFFERING to a person - never close enough to
 * apply automatically. A shared prefix or one containing the other is the whole
 * of the similarity here; there is no scoring.
 */
function suggestionsFor(index: CategoryIndex, supplied: string): string[] {
  const key = normalizeCategoryKey(supplied);
  if (key.length < 3) return [];
  const near = index.all
    .filter(category => isListable(category))
    .filter(category => {
      const en = normalizeCategoryKey(category.nameEn);
      return en.includes(key) || key.includes(en);
    })
    .slice(0, 3)
    .map(category => category.nameEn);
  return near;
}

/**
 * Resolve one supplied value against the taxonomy.
 *
 * `allowedCategoryIds` is the vendor's own listable set where BuildHub restricts
 * it; omitted means no vendor restriction applies. Passing it here rather than
 * checking it at the call site is deliberate - it is the only way single product
 * and bulk upload can be guaranteed to apply the same rule.
 */
export function resolveCategory(
  index: CategoryIndex,
  supplied: string,
  options: { allowedCategoryIds?: ReadonlySet<number> } = {},
): CategoryResolution {
  const trimmed = (supplied ?? '').trim();
  if (!trimmed) return { ok: false, rejection: { reason: 'EMPTY' } };

  const matches = index.byKey.get(normalizeCategoryKey(trimmed));
  if (!matches || matches.length === 0) {
    return { ok: false, rejection: { reason: 'UNKNOWN', supplied: trimmed, suggestions: suggestionsFor(index, trimmed) } };
  }
  if (matches.length > 1) {
    // Two categories genuinely claim this name. Refuse and say which, rather
    // than picking the first row the database happened to return.
    return { ok: false, rejection: { reason: 'AMBIGUOUS', supplied: trimmed, candidates: matches.map(m => m.category) } };
  }

  const { category, matchedBy } = matches[0];
  if (category.scope === 'SERVICE') {
    return { ok: false, rejection: { reason: 'SERVICE_ONLY', supplied: trimmed, category } };
  }
  if (category.status !== 'active') {
    return { ok: false, rejection: { reason: 'INACTIVE', supplied: trimmed, category } };
  }
  if (options.allowedCategoryIds && !options.allowedCategoryIds.has(category.id)) {
    return { ok: false, rejection: { reason: 'NOT_ALLOWED_FOR_VENDOR', supplied: trimmed, category } };
  }
  return { ok: true, category, matchedBy };
}

/**
 * The three authorized views over the SAME taxonomy. Different filters, one
 * table - not three lists maintained apart.
 */
export function listableCategories(index: CategoryIndex): CanonicalCategory[] {
  return index.all.filter(isListable);
}

export function publicCategories(index: CategoryIndex): CanonicalCategory[] {
  // Browse shows what can be browsed. An archived category is retired from
  // discovery; a hidden one is not offered for new listings and not advertised.
  return index.all.filter(category => category.status === 'active');
}

export function adminCategories(index: CategoryIndex): CanonicalCategory[] {
  return index.all;
}

/** Real product counts per category. Never estimated, never fabricated. */
export async function categoryUsage(db: any): Promise<Map<number, { products: number; activeProducts: number }>> {
  const rows = await db.select({
    categoryId: products.categoryId,
    total: sql<number>`count(*)`,
    active: sql<number>`sum(case when ${products.active} = 1 then 1 else 0 end)`,
  }).from(products).groupBy(products.categoryId);

  const usage = new Map<number, { products: number; activeProducts: number }>();
  for (const row of rows as any[]) {
    if (row.categoryId == null) continue;
    usage.set(Number(row.categoryId), {
      products: Number(row.total ?? 0),
      activeProducts: Number(row.active ?? 0),
    });
  }
  return usage;
}
