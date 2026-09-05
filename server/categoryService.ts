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
 * normalised away. `resolveCategory` computes no similarity of any kind: a
 * near-match that quietly files a product under the wrong category is worse
 * than an error the uploader can act on.
 *
 * The one place similarity appears is `suggestionsFor`, which PROPOSES a value
 * for a human to choose and never applies one - and which is held to a
 * comparable standard, because a suggestion somebody accepts misfiles the
 * product just as thoroughly as an automatic assignment would. See the comment
 * on that function.
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
 * How far apart two keys are, giving up as soon as they are further than `max`.
 *
 * Bounded on purpose: the only distances that interest us are one or two, and
 * a full matrix over every key in the taxonomy for every failed row of a
 * 500-row file is work spent to learn "not close".
 */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      if (current[j] < best) best = current[j];
    }
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

/**
 * Names close enough to be worth OFFERING to a person - never close enough to
 * apply automatically.
 *
 * THIS WAS SUBSTRING CONTAINMENT, AND SUBSTRING CONTAINMENT IS THE WRONG
 * INSTRUMENT. A live probe typed "Watrproofing" - the reported category with
 * one letter missing - and was offered "Roofing", because "watrproofing"
 * happens to end in "roofing". Nothing is auto-applied, so no product was
 * misfiled by the code; but a supplier who accepts that suggestion files a
 * bitumen membrane under Roofing, which is the same wrong outcome reached one
 * step later. A suggestion a person will act on has to be as careful as an
 * assignment.
 *
 * Two rules replace it, and a candidate needs only one:
 *
 *   TYPO       within a small edit distance - one or two characters, and never
 *              more than 30% of the value. "Watrproofing" is one edit from
 *              "Waterproofing" and five from "Roofing".
 *   NARROWING  the category name STARTS WITH the supplied value, or contains it
 *              as a whole word: "cement" -> "Cement & Concrete",
 *              "pool" -> "Swimming Pool Equipment". Containment the other way
 *              round - the supplied value swallowing a category name - is
 *              exactly the "watrproofing" case and is not accepted.
 *
 * Both run over every key the index knows, ALIASES INCLUDED, so a supplier who
 * typed "Poolz" is offered "Swimming Pool Equipment" through the "Pools" alias
 * rather than nothing at all. What is offered is always the canonical name.
 *
 * Deterministic: closest first, then the taxonomy's own order. An error message
 * that reshuffles between two runs of the same file is not a fixed message.
 */
function suggestionsFor(index: CategoryIndex, supplied: string): string[] {
  const key = normalizeCategoryKey(supplied);
  if (key.length < 3) return [];
  const budget = Math.min(2, Math.floor(key.length * 0.3));
  const wordBoundary = new RegExp(`(?:^|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);

  const scored = new Map<string, { distance: number; sortOrder: number; id: number }>();
  for (const [candidateKey, claimants] of Array.from(index.byKey.entries())) {
    // A key two categories claim is not a helpful thing to propose: the
    // supplier would be told to use a value that is itself refused.
    if (claimants.length !== 1) continue;
    const category = claimants[0].category;
    if (!isListable(category)) continue;
    // WHAT IS OFFERED MUST ITSELF RESOLVE. The candidate key may be
    // unambiguous while the canonical name we would print is not - a second
    // category answering to "Granite" is reachable through the unambiguous
    // slug "granite-alt". Offering "Granite" then sends the supplier round the
    // same refusal a second time.
    if ((index.byKey.get(normalizeCategoryKey(category.nameEn))?.length ?? 0) !== 1) continue;

    const distance = budget > 0 ? editDistance(key, candidateKey, budget) : budget + 1;
    const narrowing = candidateKey.startsWith(key) || wordBoundary.test(candidateKey);
    if (distance > budget && !narrowing) continue;

    // Rank by the BEST route to this category: a category reachable both as a
    // typo of its alias and as a narrowing of its name should be offered once.
    const score = distance <= budget ? distance : budget + 1;
    const existing = scored.get(category.nameEn);
    if (!existing || score < existing.distance) {
      scored.set(category.nameEn, { distance: score, sortOrder: category.sortOrder, id: category.id });
    }
  }

  return Array.from(scored.entries())
    .sort((a, b) => a[1].distance - b[1].distance || a[1].sortOrder - b[1].sortOrder || a[1].id - b[1].id)
    .slice(0, 3)
    .map(([name]) => name);
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

/**
 * THE BULK-UPLOAD ADAPTER.
 *
 * Bulk upload asks the same question as single product listing, so it calls the
 * same resolver - this only shapes the answer into the contract the parser
 * expects, and turns a rejection reason into a sentence a supplier can act on.
 *
 * The messages are deliberately DIFFERENT per reason. Every one of these used
 * to read "X is not a BuildHub category", which sent someone holding a correct
 * spreadsheet hunting for a spelling mistake that was not there.
 */
export function importCategoryResolver(
  index: CategoryIndex,
  options: { allowedCategoryIds?: ReadonlySet<number> } = {},
) {
  return (supplied: string) => {
    const result = resolveCategory(index, supplied, options);
    if (result.ok) {
      return { ok: true as const, id: result.category.id, canonicalName: result.category.nameEn };
    }
    const rejection = result.rejection;
    switch (rejection.reason) {
      case 'EMPTY':
        return { ok: false as const, reason: rejection.reason, message: 'Category is required' };
      case 'INACTIVE':
        return {
          ok: false as const,
          reason: rejection.reason,
          message: `"${rejection.category.nameEn}" is a BuildHub category but is not currently available for new listings. Ask an administrator to reactivate it, or choose another.`,
        };
      case 'SERVICE_ONLY':
        return {
          ok: false as const,
          reason: rejection.reason,
          message: `"${rejection.category.nameEn}" is a service category and cannot be used for a product listing.`,
        };
      case 'NOT_ALLOWED_FOR_VENDOR':
        return {
          ok: false as const,
          reason: rejection.reason,
          message: `"${rejection.category.nameEn}" is not one of the categories your account is approved to list in.`,
        };
      case 'AMBIGUOUS':
        return {
          ok: false as const,
          reason: rejection.reason,
          message: `"${rejection.supplied}" matches more than one BuildHub category (${rejection.candidates.map(c => c.nameEn).join(', ')}). Use the exact category name.`,
          suggestions: rejection.candidates.map(c => c.nameEn),
        };
      default:
        return {
          ok: false as const,
          reason: 'UNKNOWN',
          message: rejection.suggestions.length > 0
            ? `"${rejection.supplied}" is not a BuildHub category. Did you mean ${rejection.suggestions.map(s => `"${s}"`).join(' or ')}?`
            : `"${rejection.supplied}" is not a BuildHub category. Choose an active BuildHub product category.`,
          suggestions: rejection.suggestions,
        };
    }
  };
}

/**
 * An index built from the SEED, with no database.
 *
 * For tests and for any caller that needs the shape of the taxonomy before a
 * connection exists. It is deliberately the same code path as the live index -
 * a test that built its own simplified lookup would be testing the test.
 */
export function indexFromSeed(seeds: readonly {
  slug: string; nameEn: string; nameAr: string; scope?: CategoryScope; aliases?: readonly string[];
}[]): CategoryIndex {
  const all: CanonicalCategory[] = seeds.map((seed, i) => ({
    id: i + 1,
    slug: seed.slug,
    nameEn: seed.nameEn,
    nameAr: seed.nameAr,
    scope: seed.scope ?? 'PRODUCT',
    status: 'active',
    parentId: null,
    sortOrder: i,
    icon: null,
  }));
  const byId = new Map(all.map(category => [category.id, category]));
  const byKey = new Map<string, { category: CanonicalCategory; matchedBy: 'slug' | 'nameEn' | 'nameAr' | 'alias' }[]>();
  const claim = (raw: string, category: CanonicalCategory, matchedBy: 'slug' | 'nameEn' | 'nameAr' | 'alias') => {
    const key = normalizeCategoryKey(raw);
    if (!key) return;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.some(entry => entry.category.id === category.id)) existing.push({ category, matchedBy });
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
