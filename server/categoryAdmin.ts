/**
 * ADMINISTERING THE TAXONOMY.
 *
 * server/categoryService.ts answers "what does this string resolve to". This
 * answers "what may an administrator change, and what must changing it never
 * break" - the two are deliberately separate, because resolution is on the hot
 * path of every product write and administration is not.
 *
 * THE INVARIANTS THIS MODULE EXISTS TO HOLD
 *
 * IDENTITY IS THE id AND THE slug, NEVER THE ENGLISH LABEL. `products.categoryId`
 * points at the row and `productCategories.slug` names it for a URL. So a rename
 * is a label change and nothing else: no product moves, no import history is
 * rewritten, no link breaks. The slug is IMMUTABLE for the same reason - it is
 * half the stable identity, and a mutable one would make every URL and every
 * stored reference a guess about when it was written.
 *
 * A USED CATEGORY IS NEVER DESTROYED. There is no hard delete here at all.
 * `archived` retires a category from discovery and `hidden` withdraws it from
 * new listings; both leave every existing product exactly where it is, still
 * linked, still readable. The FK from products.categoryId is RESTRICT, so the
 * database would refuse a delete anyway - this makes the product refuse it
 * first, with an explanation.
 *
 * HIDING IS NOT RECATEGORISING. Nothing in this file writes to `products`. An
 * administrator hiding "Pools" changes what may be listed NEXT; the forty
 * products already in it keep their categoryId and their stored name.
 *
 * ONE ALIAS MEANS ONE CATEGORY. `productCategoryAliases.normalized` is UNIQUE,
 * so an alias cannot point at two categories - but a category NAME can collide
 * with an alias, which the resolver reports as AMBIGUOUS. That would be a
 * refusal a supplier cannot act on, so it is refused HERE, at the point where
 * somebody is choosing the alias and can choose a different one.
 *
 * EVERY MUTATION IS RECORDED. Renames, scope and status changes go to
 * fieldValueHistory as old -> new with the actor; creation and alias changes go
 * to commercialAuditEvents, which records the action without values. See
 * drizzle/0043 for why those two and not a third mechanism.
 */
import { and, eq, sql } from 'drizzle-orm';
import { productCategories, productCategoryAliases, products } from '../drizzle/schema';
import { normalizeCategoryKey, type CategoryScope, type CategoryStatus } from '../shared/categoryTaxonomy';
import { loadCategoryIndex, adminCategories, categoryUsage, type CanonicalCategory } from './categoryService';
import { recordFieldChange } from './audit/fieldHistory';
import { recordCommercialEvent } from './_core/commercialAudit';

export const CATEGORY_SCOPES = ['PRODUCT', 'SERVICE', 'BOTH'] as const;
export const CATEGORY_STATUSES = ['active', 'hidden', 'archived'] as const;

/** A slug is a URL segment and half of the stable identity. Narrow on purpose. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

export type AdminCategoryRow = CanonicalCategory & {
  /** REAL counts, from the products table. Never estimated and never invented. */
  productCount: number;
  activeProductCount: number;
  /** id AND text: a chip the screen cannot remove is a list, not a control. */
  aliases: { id: number; alias: string }[];
  parentName: string | null;
};

export class CategoryAdminError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
  }
}

const refuse = (reason: string, message: string): never => {
  throw new CategoryAdminError(reason, message);
};

/**
 * The whole taxonomy as an administrator sees it: every status, with real usage.
 *
 * Unpaged deliberately. The taxonomy is tens of rows, not thousands, and the
 * screen sorts, filters and searches over it - paging a list this size would
 * add a control that only ever shows one page while making the dependency
 * counts harder to scan.
 */
export async function listCategoriesForAdmin(db: any): Promise<AdminCategoryRow[]> {
  const [index, usage, aliasRows] = await Promise.all([
    loadCategoryIndex(db),
    categoryUsage(db),
    db.select().from(productCategoryAliases),
  ]);

  const aliasesByCategory = new Map<number, { id: number; alias: string }[]>();
  for (const alias of aliasRows as any[]) {
    const list = aliasesByCategory.get(Number(alias.categoryId)) ?? [];
    list.push({ id: Number(alias.id), alias: String(alias.alias) });
    aliasesByCategory.set(Number(alias.categoryId), list);
  }

  return adminCategories(index).map(category => ({
    ...category,
    productCount: usage.get(category.id)?.products ?? 0,
    activeProductCount: usage.get(category.id)?.activeProducts ?? 0,
    aliases: (aliasesByCategory.get(category.id) ?? []).sort((a, b) => a.alias.localeCompare(b.alias)),
    // The human name, not the raw id. An administrator reading "parent: 8" has
    // to go and look it up.
    parentName: category.parentId == null ? null : index.byId.get(category.parentId)?.nameEn ?? null,
  }));
}

/** How many products a status change would affect. Read before it is applied. */
export async function categoryDependencies(db: any, categoryId: number): Promise<{ products: number; activeProducts: number }> {
  const usage = await categoryUsage(db);
  return usage.get(categoryId) ?? { products: 0, activeProducts: 0 };
}

/**
 * Every key the taxonomy already answers to, so a new name or alias can be
 * refused BEFORE it creates an ambiguity a supplier would meet later.
 */
async function claimedKeys(db: any, exceptCategoryId?: number): Promise<Map<string, string>> {
  const index = await loadCategoryIndex(db);
  const claimed = new Map<string, string>();
  for (const [key, claimants] of Array.from(index.byKey.entries())) {
    const owner = claimants.find(entry => entry.category.id !== exceptCategoryId);
    if (owner) claimed.set(key, owner.category.nameEn);
  }
  return claimed;
}

export type CreateCategoryInput = {
  slug: string;
  nameEn: string;
  nameAr: string;
  scope: CategoryScope;
  parentId?: number | null;
  sortOrder?: number;
  icon?: string | null;
};

export async function createCategory(db: any, actorId: number, input: CreateCategoryInput): Promise<{ id: number }> {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) {
    refuse('BAD_SLUG', 'A slug must be 3-60 characters of lowercase letters, numbers and hyphens, starting and ending with a letter or number.');
  }
  const nameEn = input.nameEn.trim();
  const nameAr = input.nameAr.trim();
  if (!nameEn || !nameAr) {
    // Both, always. BuildHub is bilingual, and a category with no Arabic name
    // renders as a blank chip to half the market.
    refuse('NAME_REQUIRED', 'A category needs both an English and an Arabic name.');
  }

  const claimed = await claimedKeys(db);
  for (const [label, value] of [['slug', slug], ['English name', nameEn], ['Arabic name', nameAr]] as const) {
    const owner = claimed.get(normalizeCategoryKey(value));
    if (owner) {
      refuse('DUPLICATE', `That ${label} is already used by "${owner}". Two categories answering to one name make every upload of that value ambiguous.`);
    }
  }

  if (input.parentId != null) {
    const [parent] = await db.select({ id: productCategories.id }).from(productCategories).where(eq(productCategories.id, input.parentId));
    if (!parent) refuse('NO_PARENT', 'That parent category does not exist.');
  }

  const result = await db.insert(productCategories).values({
    slug, nameEn, nameAr,
    scope: input.scope,
    status: 'active',
    parentId: input.parentId ?? null,
    sortOrder: input.sortOrder ?? 0,
    icon: input.icon ?? null,
    createdBy: actorId,
  });
  const id = Number(result?.[0]?.insertId ?? 0);

  // Creation has no prior value to contrast, so it goes to the action trail
  // rather than to the old -> new one.
  await recordCommercialEvent(db, {
    actorId, ownerId: null, subjectType: 'category', subjectId: id,
    action: 'category_created',
    detail: `${slug} "${nameEn}" / "${nameAr}" scope=${input.scope}`,
  });
  return { id };
}

export type UpdateCategoryInput = {
  id: number;
  nameEn?: string;
  nameAr?: string;
  scope?: CategoryScope;
  parentId?: number | null;
  sortOrder?: number;
  icon?: string | null;
};

/**
 * Rename, re-scope, re-parent, reorder. NOT status - see setCategoryStatus,
 * which has a dependency check this does not.
 *
 * `slug` is absent by construction. It is half the stable identity, and a
 * category whose slug can move is a category whose URLs and stored references
 * are guesses about when they were written.
 */
export async function updateCategory(db: any, actorId: number, input: UpdateCategoryInput): Promise<{ id: number; changed: string[] }> {
  const [existing] = await db.select().from(productCategories).where(eq(productCategories.id, input.id));
  if (!existing) refuse('NOT_FOUND', 'That category does not exist.');

  const patch: Record<string, unknown> = {};
  if (input.nameEn !== undefined) {
    const nameEn = input.nameEn.trim();
    if (!nameEn) refuse('NAME_REQUIRED', 'A category needs an English name.');
    patch.nameEn = nameEn;
  }
  if (input.nameAr !== undefined) {
    const nameAr = input.nameAr.trim();
    if (!nameAr) refuse('NAME_REQUIRED', 'A category needs an Arabic name.');
    patch.nameAr = nameAr;
  }
  if (input.scope !== undefined) patch.scope = input.scope;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.parentId !== undefined) {
    if (input.parentId === input.id) refuse('CYCLE', 'A category cannot be its own parent.');
    if (input.parentId != null) {
      const [parent] = await db.select({ id: productCategories.id, parentId: productCategories.parentId })
        .from(productCategories).where(eq(productCategories.id, input.parentId));
      if (!parent) refuse('NO_PARENT', 'That parent category does not exist.');
      // One level of loop is all the current shape can produce, and a cycle
      // would make any tree render recurse forever.
      if (Number(parent.parentId) === input.id) refuse('CYCLE', 'That would make the two categories each other\'s parent.');
    }
    patch.parentId = input.parentId;
  }

  // A name a sibling already answers to would make every upload of that value
  // AMBIGUOUS - a refusal the supplier can do nothing about. Refuse it here,
  // where the person choosing the name can choose a different one.
  const claimed = await claimedKeys(db, input.id);
  for (const [label, value] of [['English name', patch.nameEn], ['Arabic name', patch.nameAr]] as const) {
    if (typeof value !== 'string') continue;
    const owner = claimed.get(normalizeCategoryKey(value));
    if (owner) refuse('DUPLICATE', `That ${label} is already used by "${owner}".`);
  }

  if (Object.keys(patch).length === 0) return { id: input.id, changed: [] };
  await db.update(productCategories).set(patch).where(eq(productCategories.id, input.id));

  // OLD -> NEW, per field. The value it moved FROM is the whole reason this
  // subject was added to fieldValueHistory.
  const changed: string[] = [];
  for (const [field, value] of Object.entries(patch)) {
    const before = (existing as Record<string, unknown>)[field];
    if (String(before ?? '') === String(value ?? '')) continue;
    changed.push(field);
    await recordFieldChange(db, {
      subjectType: 'category', subjectId: input.id,
      // The platform owns the taxonomy; no user does. Null is the truthful
      // answer, not a placeholder.
      ownerId: null, actorId,
      field, oldValue: before == null ? null : String(before), newValue: value == null ? null : String(value),
    });
  }
  return { id: input.id, changed };
}

/**
 * Retire or restore a category, WITHOUT touching a single product.
 *
 * `expectedProductCount` is the dependency confirmation: the screen shows the
 * real count and echoes it back, so an administrator who saw "3 products" and
 * clicks Hide after somebody else listed forty more is stopped rather than
 * surprised. Omitted means "I am not claiming to have checked", which is
 * allowed when nothing depends on the category.
 */
export async function setCategoryStatus(
  db: any,
  actorId: number,
  input: { id: number; status: CategoryStatus; expectedProductCount?: number },
): Promise<{ id: number; status: CategoryStatus; products: number }> {
  const [existing] = await db.select().from(productCategories).where(eq(productCategories.id, input.id));
  if (!existing) refuse('NOT_FOUND', 'That category does not exist.');

  const dependencies = await categoryDependencies(db, input.id);
  if (input.expectedProductCount != null && input.expectedProductCount !== dependencies.products) {
    refuse('STALE_COUNT',
      `This category now holds ${dependencies.products} product(s), not ${input.expectedProductCount}. Review the change and try again.`);
  }

  if (existing.status === input.status) return { id: input.id, status: input.status, products: dependencies.products };

  await db.update(productCategories).set({ status: input.status }).where(eq(productCategories.id, input.id));
  await recordFieldChange(db, {
    subjectType: 'category', subjectId: input.id, ownerId: null, actorId,
    field: 'status', oldValue: String(existing.status), newValue: input.status,
    // The count is the context somebody reviewing this later actually needs.
    reason: `${dependencies.products} product(s) linked at the time`,
  });
  return { id: input.id, status: input.status, products: dependencies.products };
}

/**
 * There is no delete. This is the function that says so.
 *
 * Kept as a named refusal rather than as an absent endpoint, because "the API
 * has no delete" and "delete is refused, and here is why" read identically to
 * a caller and very differently to whoever is looking for the capability.
 */
export async function deleteCategory(db: any, categoryId: number): Promise<never> {
  const dependencies = await categoryDependencies(db, categoryId);
  return refuse('NO_DELETE',
    dependencies.products > 0
      ? `"Archive" retires a category; it is never deleted. ${dependencies.products} product(s) reference this one and would lose their category.`
      : 'A category is archived, never deleted - import history and past listings reference it by id.');
}

export async function addCategoryAlias(db: any, actorId: number, input: { categoryId: number; alias: string }): Promise<{ id: number }> {
  const alias = input.alias.trim();
  if (alias.length < 2 || alias.length > 120) refuse('BAD_ALIAS', 'An alias must be between 2 and 120 characters.');
  const normalized = normalizeCategoryKey(alias);
  if (!normalized) refuse('BAD_ALIAS', 'That alias is empty once whitespace is normalised.');

  const [category] = await db.select({ id: productCategories.id, nameEn: productCategories.nameEn })
    .from(productCategories).where(eq(productCategories.id, input.categoryId));
  if (!category) refuse('NOT_FOUND', 'That category does not exist.');

  // ONE ALIAS, ONE CATEGORY. The unique index stops two aliases sharing a key;
  // this also stops an alias colliding with a category's own name, which the
  // index cannot see and which the resolver would report to a supplier as
  // AMBIGUOUS - a refusal they can do nothing about.
  const claimed = await claimedKeys(db, input.categoryId);
  const owner = claimed.get(normalized);
  if (owner) refuse('DUPLICATE', `"${alias}" already means "${owner}". An alias must point at exactly one category.`);

  const result = await db.insert(productCategoryAliases).values({
    categoryId: input.categoryId, alias, normalized, createdBy: actorId,
  });
  await recordCommercialEvent(db, {
    actorId, ownerId: null, subjectType: 'category', subjectId: input.categoryId,
    action: 'category_alias_added', detail: `"${alias}" -> ${category.nameEn}`,
  });
  return { id: Number(result?.[0]?.insertId ?? 0) };
}

export async function removeCategoryAlias(db: any, actorId: number, aliasId: number): Promise<{ removed: boolean }> {
  const [alias] = await db.select().from(productCategoryAliases).where(eq(productCategoryAliases.id, aliasId));
  if (!alias) refuse('NOT_FOUND', 'That alias does not exist.');
  await db.delete(productCategoryAliases).where(eq(productCategoryAliases.id, aliasId));
  await recordCommercialEvent(db, {
    actorId, ownerId: null, subjectType: 'category', subjectId: Number(alias.categoryId),
    action: 'category_alias_removed', detail: `"${alias.alias}"`,
  });
  return { removed: true };
}
