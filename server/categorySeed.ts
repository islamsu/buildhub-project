/**
 * SEEDING THE CANONICAL TAXONOMY, IDEMPOTENTLY.
 *
 * The taxonomy is administrator-managed from here on, so this is a one-time
 * reconciliation and not a source of truth that keeps overwriting the database.
 * It inserts what is missing by slug and leaves everything else alone: an
 * administrator who renames "Pools" or hides a category must not find their
 * change reverted by the next deployment.
 */
import { eq, inArray } from 'drizzle-orm';
import { productCategories, productCategoryAliases } from '../drizzle/schema';
import { SEED_CATEGORIES, normalizeCategoryKey } from '../shared/categoryTaxonomy';

export type SeedOutcome = {
  categoriesInserted: number;
  aliasesInserted: number;
  categoriesAlreadyPresent: number;
};

export async function seedProductCategories(db: any): Promise<SeedOutcome> {
  const existing = await db.select({ id: productCategories.id, slug: productCategories.slug })
    .from(productCategories);
  const bySlug = new Map<string, number>((existing as any[]).map(row => [String(row.slug), Number(row.id)]));

  let categoriesInserted = 0;
  for (let index = 0; index < SEED_CATEGORIES.length; index += 1) {
    const seed = SEED_CATEGORIES[index];
    if (bySlug.has(seed.slug)) continue;
    const result = await db.insert(productCategories).values({
      slug: seed.slug,
      nameEn: seed.nameEn,
      nameAr: seed.nameAr,
      scope: seed.scope ?? 'PRODUCT',
      status: 'active',
      sortOrder: index,
      icon: seed.icon ?? null,
      createdBy: null,
    });
    const id = Number((result as any)[0]?.insertId ?? 0);
    if (id) { bySlug.set(seed.slug, id); categoriesInserted += 1; }
  }

  // Aliases are inserted only where the normalized form is not already claimed.
  // The unique index would refuse a duplicate anyway; checking first keeps a
  // re-run quiet instead of noisy.
  const claimed = new Set<string>(
    ((await db.select({ normalized: productCategoryAliases.normalized }).from(productCategoryAliases)) as any[])
      .map(row => String(row.normalized)),
  );

  let aliasesInserted = 0;
  for (const seed of SEED_CATEGORIES) {
    const categoryId = bySlug.get(seed.slug);
    if (!categoryId || !seed.aliases) continue;
    for (const alias of seed.aliases) {
      const normalized = normalizeCategoryKey(alias);
      if (!normalized || claimed.has(normalized)) continue;
      await db.insert(productCategoryAliases).values({ categoryId, alias, normalized, createdBy: null });
      claimed.add(normalized);
      aliasesInserted += 1;
    }
  }

  return {
    categoriesInserted,
    aliasesInserted,
    categoriesAlreadyPresent: SEED_CATEGORIES.length - categoriesInserted,
  };
}

/**
 * Backfill `products.categoryId` from the legacy `products.category` string.
 *
 * Only rows whose stored value resolves EXACTLY to one canonical category are
 * linked. Anything that does not resolve is left alone and reported, because a
 * product silently attached to the wrong category is worse than one that still
 * needs a decision.
 */
export async function backfillProductCategoryIds(db: any): Promise<{ linked: number; unresolved: string[] }> {
  const { loadCategoryIndex, resolveCategory } = await import('./categoryService');
  const index = await loadCategoryIndex(db);
  const { products } = await import('../drizzle/schema');

  const rows = await db.select({ id: products.id, category: products.category, categoryId: products.categoryId })
    .from(products);

  let linked = 0;
  const unresolved = new Set<string>();
  for (const row of rows as any[]) {
    if (row.categoryId != null) continue;
    const resolution = resolveCategory(index, String(row.category ?? ''));
    if (!resolution.ok) {
      // A hidden or service-scoped category still identifies the product, so the
      // link is made for those; only a genuinely unrecognised value is left.
      const rejection = resolution.rejection;
      if (rejection.reason === 'INACTIVE' || rejection.reason === 'SERVICE_ONLY') {
        await db.update(products).set({ categoryId: rejection.category.id }).where(eq(products.id, row.id));
        linked += 1;
        continue;
      }
      if (row.category) unresolved.add(String(row.category));
      continue;
    }
    await db.update(products).set({ categoryId: resolution.category.id }).where(eq(products.id, row.id));
    linked += 1;
  }
  return { linked, unresolved: Array.from(unresolved) };
}
