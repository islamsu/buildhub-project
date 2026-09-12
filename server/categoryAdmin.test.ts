import { describe, expect, it, vi } from 'vitest';
import {
  createCategory, updateCategory, setCategoryStatus, deleteCategory,
  addCategoryAlias, removeCategoryAlias, listCategoriesForAdmin,
  CategoryAdminError, SLUG_PATTERN, CATEGORY_SCOPES, CATEGORY_STATUSES,
} from './categoryAdmin';
import { productCategories, productCategoryAliases, products } from '../drizzle/schema';

/**
 * ADMINISTERING THE TAXONOMY.
 *
 * The invariants here are the ones a supplier feels. Hiding a category must
 * never move a product; renaming must never break a link; an alias must never
 * become the AMBIGUOUS refusal a supplier can do nothing about; and there is no
 * delete at all, because products, import history and past listings reference a
 * category by id.
 *
 * These drive the real functions against a driver that RECORDS what SQL they
 * would run, so "nothing writes to products" is checked by observing the writes
 * rather than by reading the source and believing it.
 */

const CATEGORIES = [
  { id: 1, slug: 'waterproofing', nameEn: 'Waterproofing', nameAr: 'عزل مائي', scope: 'PRODUCT', status: 'active', parentId: null, sortOrder: 1, icon: null },
  { id: 2, slug: 'pools', nameEn: 'Swimming Pool Equipment', nameAr: 'معدات حمامات السباحة', scope: 'PRODUCT', status: 'active', parentId: null, sortOrder: 2, icon: null },
  { id: 3, slug: 'roofing', nameEn: 'Roofing', nameAr: 'أسقف', scope: 'PRODUCT', status: 'active', parentId: null, sortOrder: 3, icon: null },
];
const ALIASES = [{ id: 10, categoryId: 2, alias: 'Pools', normalized: 'pools', createdBy: 1 }];

/**
 * A driver that records every write, and answers reads from the fixtures above.
 *
 * `usage` is what the products table would report - supplied per test, because
 * "this category has forty products" is the fact most of these rules turn on.
 */
function stub(options: { usage?: { categoryId: number; total: number; active: number }[]; categories?: any[]; aliases?: any[] } = {}) {
  const writes: { table: string; op: string; values?: any }[] = [];
  const categories = options.categories ?? CATEGORIES;
  const aliases = options.aliases ?? ALIASES;
  const usage = options.usage ?? [];

  const name = (table: any) => table === productCategories ? 'productCategories'
    : table === productCategoryAliases ? 'productCategoryAliases'
    : table === products ? 'products' : 'other';

  const rowsFor = (table: any) => {
    const which = name(table);
    if (which === 'productCategories') return categories;
    if (which === 'productCategoryAliases') return aliases;
    if (which === 'products') return usage.map(u => ({ categoryId: u.categoryId, total: u.total, active: u.active }));
    return [];
  };

  const db: any = {
    select: () => ({
      from: (table: any) => {
        const rows = rowsFor(table);
        return Object.assign(
          {
            where: (predicate: any) => Promise.resolve(filtered(table, rows, predicate)),
            groupBy: () => Promise.resolve(rows),
          },
          { then: (resolve: (v: unknown) => unknown) => resolve(rows) },
        );
      },
    }),
    insert: (table: any) => ({
      values: (values: any) => { writes.push({ table: name(table), op: 'insert', values }); return Promise.resolve([{ insertId: 99 }]); },
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        where: () => { writes.push({ table: name(table), op: 'update', values }); return Promise.resolve(); },
      }),
    }),
    delete: (table: any) => ({
      where: () => { writes.push({ table: name(table), op: 'delete' }); return Promise.resolve(); },
    }),
  };

  /**
   * The stub cannot evaluate a drizzle predicate, and every `.where` here is an
   * id lookup, so it returns the row the caller is about to act on. The tests
   * that depend on "not found" pass an empty fixture rather than relying on the
   * predicate.
   */
  function filtered(table: any, rows: any[], _predicate: unknown) {
    return rows;
  }

  return { db, writes };
}

const reasonOf = async (run: () => Promise<unknown>) => {
  try { await run(); return null; }
  catch (error) { return error instanceof CategoryAdminError ? error.reason : `unexpected: ${(error as Error).message}`; }
};

describe('the vocabulary is closed and matches the column', () => {
  it('names the three scopes and the three statuses', () => {
    expect([...CATEGORY_SCOPES]).toEqual(['PRODUCT', 'SERVICE', 'BOTH']);
    expect([...CATEGORY_STATUSES]).toEqual(['active', 'hidden', 'archived']);
  });

  it('a slug is a URL segment, not free text', () => {
    for (const good of ['waterproofing', 'swimming-pools', 'a1b']) expect(SLUG_PATTERN.test(good), good).toBe(true);
    for (const bad of ['Waterproofing', 'water proofing', '-pools', 'pools-', 'a', 'a'.repeat(61), 'pools/1']) {
      expect(SLUG_PATTERN.test(bad), bad).toBe(false);
    }
  });
});

describe('creating a category', () => {
  it('writes the row and records the action', async () => {
    const { db, writes } = stub();
    await createCategory(db, 7, { slug: 'insulation', nameEn: 'Insulation', nameAr: 'عزل حراري', scope: 'PRODUCT' });
    const inserted = writes.find(w => w.table === 'productCategories');
    expect(inserted?.values).toMatchObject({ slug: 'insulation', nameEn: 'Insulation', status: 'active', createdBy: 7 });
    expect(writes.some(w => w.table === 'other' && w.op === 'insert'), 'the creation was not audited').toBe(true);
  });

  it('refuses a name another category already answers to', async () => {
    // Two categories claiming one name make every upload of that value
    // AMBIGUOUS - a refusal the supplier can do nothing about. It is refused
    // here, where the person choosing the name can choose another.
    const { db } = stub();
    expect(await reasonOf(() => createCategory(db, 1, { slug: 'wp2', nameEn: 'Waterproofing', nameAr: 'جديد', scope: 'PRODUCT' }))).toBe('DUPLICATE');
  });

  it('refuses a name that collides with an existing ALIAS, not just a name', async () => {
    // "Pools" is an alias of Swimming Pool Equipment. A new category called
    // Pools would make the alias ambiguous, which the unique index cannot see.
    const { db } = stub();
    expect(await reasonOf(() => createCategory(db, 1, { slug: 'pools-2', nameEn: 'Pools', nameAr: 'حمامات', scope: 'PRODUCT' }))).toBe('DUPLICATE');
  });

  it('requires an Arabic name as well as an English one', async () => {
    // BuildHub is bilingual; a category with no Arabic name renders as a blank
    // chip to half the market.
    const { db } = stub();
    expect(await reasonOf(() => createCategory(db, 1, { slug: 'x-cat', nameEn: 'X', nameAr: '   ', scope: 'PRODUCT' }))).toBe('NAME_REQUIRED');
  });

  it('refuses a malformed slug', async () => {
    const { db } = stub();
    expect(await reasonOf(() => createCategory(db, 1, { slug: 'Not A Slug', nameEn: 'X', nameAr: 'س', scope: 'PRODUCT' }))).toBe('BAD_SLUG');
  });

  it('writes nothing at all when it refuses', async () => {
    const { db, writes } = stub();
    await reasonOf(() => createCategory(db, 1, { slug: 'wp2', nameEn: 'Waterproofing', nameAr: 'ج', scope: 'PRODUCT' }));
    expect(writes).toEqual([]);
  });
});

describe('renaming is a LABEL change and nothing else', () => {
  it('never writes to products', async () => {
    // Identity is the id and the slug. A rename moves no product, breaks no
    // link, and rewrites no import history - and this is how that is checked:
    // by observing that no write reaches the products table.
    const { db, writes } = stub();
    await updateCategory(db, 4, { id: 1, nameEn: 'Waterproofing & Damp Proofing' });
    expect(writes.filter(w => w.table === 'products')).toEqual([]);
  });

  it('records OLD -> NEW with the actor', async () => {
    const { db, writes } = stub();
    await updateCategory(db, 4, { id: 1, nameEn: 'Damp Proofing' });
    const audit = writes.find(w => w.table === 'other' && w.op === 'insert');
    expect(audit?.values).toMatchObject({
      subjectType: 'category', subjectId: 1, field: 'nameEn',
      oldValue: 'Waterproofing', newValue: 'Damp Proofing', actorId: 4,
    });
  });

  it('cannot change the slug - there is no input for it', async () => {
    const { db, writes } = stub();
    // Passing one is a type error; passing it at runtime must still not land.
    await updateCategory(db, 1, { id: 1, slug: 'renamed' } as never);
    const update = writes.find(w => w.table === 'productCategories' && w.op === 'update');
    expect(update).toBeUndefined();
  });

  it('refuses a rename onto a sibling\'s name', async () => {
    const { db } = stub();
    expect(await reasonOf(() => updateCategory(db, 1, { id: 1, nameEn: 'Roofing' }))).toBe('DUPLICATE');
  });

  it('allows a category to keep its own name - that is not a collision', async () => {
    // The exception check must exclude the row being edited, or no category
    // could ever be saved without renaming it.
    const { db } = stub();
    const result = await updateCategory(db, 1, { id: 1, nameEn: 'Waterproofing', sortOrder: 9 });
    expect(result.changed).toContain('sortOrder');
  });

  it('records nothing for a field that did not actually change', async () => {
    const { db, writes } = stub();
    await updateCategory(db, 1, { id: 1, nameEn: 'Waterproofing' });
    expect(writes.filter(w => w.table === 'other')).toEqual([]);
  });

  it('refuses to make a category its own parent', async () => {
    const { db } = stub();
    expect(await reasonOf(() => updateCategory(db, 1, { id: 1, parentId: 1 }))).toBe('CYCLE');
  });
});

describe('hiding a category never touches a product', () => {
  it('writes only the status, never the products table', async () => {
    const { db, writes } = stub({ usage: [{ categoryId: 1, total: 40, active: 31 }] });
    await setCategoryStatus(db, 5, { id: 1, status: 'hidden', expectedProductCount: 40 });
    expect(writes.filter(w => w.table === 'products')).toEqual([]);
    expect(writes.find(w => w.table === 'productCategories')?.values).toEqual({ status: 'hidden' });
  });

  it('records the change WITH the dependency count as context', async () => {
    const { db, writes } = stub({ usage: [{ categoryId: 1, total: 40, active: 31 }] });
    await setCategoryStatus(db, 5, { id: 1, status: 'hidden', expectedProductCount: 40 });
    const audit = writes.find(w => w.table === 'other' && w.op === 'insert');
    expect(audit?.values).toMatchObject({ subjectType: 'category', field: 'status', oldValue: 'active', newValue: 'hidden', actorId: 5 });
    expect(String(audit?.values.reason)).toContain('40');
  });

  it('REFUSES when the count has moved since the screen read it', async () => {
    // The administrator saw "3 products" and clicked Hide; forty more were
    // listed in between. Refusing is the difference between a decision and a
    // surprise.
    const { db, writes } = stub({ usage: [{ categoryId: 1, total: 43, active: 43 }] });
    expect(await reasonOf(() => setCategoryStatus(db, 5, { id: 1, status: 'hidden', expectedProductCount: 3 }))).toBe('STALE_COUNT');
    expect(writes).toEqual([]);
  });

  it('reactivating is the same operation in reverse, and equally inert', async () => {
    const hidden = CATEGORIES.map(c => (c.id === 1 ? { ...c, status: 'hidden' } : c));
    const { db, writes } = stub({ categories: hidden, usage: [{ categoryId: 1, total: 40, active: 31 }] });
    await setCategoryStatus(db, 5, { id: 1, status: 'active', expectedProductCount: 40 });
    expect(writes.find(w => w.table === 'productCategories')?.values).toEqual({ status: 'active' });
    expect(writes.filter(w => w.table === 'products')).toEqual([]);
  });

  it('setting the status it already has writes nothing', async () => {
    const { db, writes } = stub({ usage: [] });
    await setCategoryStatus(db, 5, { id: 1, status: 'active' });
    expect(writes).toEqual([]);
  });
});

describe('there is no delete', () => {
  it('refuses, and says what would be lost', async () => {
    const { db } = stub({ usage: [{ categoryId: 1, total: 12, active: 9 }] });
    await expect(deleteCategory(db, 1)).rejects.toThrow(/12 product/);
    expect(await reasonOf(() => deleteCategory(db, 1))).toBe('NO_DELETE');
  });

  it('refuses even an unused category, because history references it by id', async () => {
    const { db } = stub({ usage: [] });
    expect(await reasonOf(() => deleteCategory(db, 1))).toBe('NO_DELETE');
  });
});

describe('an alias points at exactly one category', () => {
  it('is stored normalised, so case and spacing cannot create a second one', async () => {
    const { db, writes } = stub();
    await addCategoryAlias(db, 3, { categoryId: 1, alias: '  Damp   Proofing ' });
    expect(writes.find(w => w.table === 'productCategoryAliases')?.values)
      .toMatchObject({ categoryId: 1, alias: 'Damp   Proofing', normalized: 'damp proofing' });
  });

  it('refuses an alias that another CATEGORY answers to by name', async () => {
    // The unique index cannot see this collision: the clash is with a
    // category's own name, not with another alias. The resolver would report it
    // to a supplier as AMBIGUOUS.
    const { db } = stub();
    expect(await reasonOf(() => addCategoryAlias(db, 1, { categoryId: 1, alias: 'Roofing' }))).toBe('DUPLICATE');
  });

  it('refuses an alias another category already claims as an alias', async () => {
    const { db } = stub();
    expect(await reasonOf(() => addCategoryAlias(db, 1, { categoryId: 1, alias: 'Pools' }))).toBe('DUPLICATE');
  });

  it('records adding and removing one', async () => {
    const added = stub();
    await addCategoryAlias(added.db, 3, { categoryId: 1, alias: 'Tanking' });
    expect(added.writes.some(w => w.table === 'other' && w.op === 'insert')).toBe(true);

    const removed = stub();
    await removeCategoryAlias(removed.db, 3, 10);
    expect(removed.writes.some(w => w.table === 'productCategoryAliases' && w.op === 'delete')).toBe(true);
    expect(removed.writes.some(w => w.table === 'other' && w.op === 'insert')).toBe(true);
  });
});

describe('the admin list reports REAL usage', () => {
  it('carries the product counts from the products table, and no invented ones', async () => {
    const { db } = stub({ usage: [{ categoryId: 2, total: 7, active: 5 }] });
    const rows = await listCategoriesForAdmin(db);
    const pools = rows.find(row => row.slug === 'pools');
    const roofing = rows.find(row => row.slug === 'roofing');
    expect(pools).toMatchObject({ productCount: 7, activeProductCount: 5 });
    // A category with no products reports zero, not a placeholder and not a
    // borrowed number from its neighbour.
    expect(roofing).toMatchObject({ productCount: 0, activeProductCount: 0 });
  });

  it('shows every status, unlike the listable and public views', async () => {
    const mixed = CATEGORIES.map(c => (c.id === 3 ? { ...c, status: 'archived' } : c));
    const { db } = stub({ categories: mixed });
    const rows = await listCategoriesForAdmin(db);
    expect(rows.map(row => row.status)).toContain('archived');
    expect(rows).toHaveLength(3);
  });

  it('carries each alias with its id, so the screen can remove one', async () => {
    const { db } = stub();
    const rows = await listCategoriesForAdmin(db);
    expect(rows.find(row => row.slug === 'pools')?.aliases).toEqual([{ id: 10, alias: 'Pools' }]);
  });
});
