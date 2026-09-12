import { describe, expect, it, vi } from 'vitest';
import {
  importTemplateCsv, parseCsv, parseProductImport, summariseLines,
  MAX_IMPORT_ROWS, IMPORT_COLUMNS,
} from '@shared/productImport';
import { SEED_CATEGORIES } from '@shared/categoryTaxonomy';
import { indexFromSeed, importCategoryResolver } from './categoryService';
import { productCategories, productCategoryAliases } from '../drizzle/schema';

/**
 * The REAL resolver over the REAL seed.
 *
 * parseProductImport used to take a list of permitted category strings, which
 * is exactly how bulk upload came to disagree with single product listing. It
 * now takes the same resolver the single-product path uses, so these tests
 * exercise the actual resolution rather than a stand-in list.
 */
const CATEGORY_RESOLVER = importCategoryResolver(indexFromSeed(SEED_CATEGORIES));

vi.mock('./db', () => ({ getDb: vi.fn() }));
import { appRouter } from './routers';
import { getDb } from './db';
import type { TrpcContext } from './_core/context';

/**
 * A SUPPLIER COULD ADD PRODUCTS ONLY ONE AT A TIME.
 *
 * A vendor with a 400-line catalogue had no way in, which turns onboarding a
 * real supplier into a manual data-entry project. The previous audit recorded
 * bulk import as NOT IMPLEMENTED; the owner has since asked for it.
 *
 * The rules that matter are the ones a CSV can attack: the file decides what
 * is listed, never WHO it belongs to, and never what a category means.
 */

let nextId = 7000;
const ctx = (userRole = 'supplier', onboardingStatus = 'approved'): TrpcContext => ({
  user: {
    id: (nextId += 1), openId: 'u', email: 'u@t.com', name: 'U', username: 'u',
    loginMethod: 'password', role: 'user', userRole,
    accountStatus: 'active', onboardingStatus, isDummy: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as TrpcContext['user'],
  req: { protocol: 'https', headers: {} } as TrpcContext['req'],
  res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
});

const HEAD = IMPORT_COLUMNS.join(',');
const csv = (...rows: string[]) => [HEAD, ...rows].join('\n');

/**
 * The taxonomy rows the resolver reads, shaped like the table.
 *
 * Derived from the real seed rather than invented, so a test cannot pass
 * against a category vocabulary the product does not have.
 */
const CATEGORY_ROWS = SEED_CATEGORIES.map((seed, i) => ({
  id: i + 1, slug: seed.slug, nameEn: seed.nameEn, nameAr: seed.nameAr,
  scope: seed.scope ?? 'PRODUCT', status: 'active', parentId: null, sortOrder: i, icon: null,
}));
const ALIAS_ROWS = SEED_CATEGORIES.flatMap((seed, i) =>
  (seed.aliases ?? []).map(alias => ({ id: 0, categoryId: i + 1, alias, normalized: alias.toLowerCase() })));

function stubDb(existingNames: string[] = []) {
  const written: Record<string, unknown>[][] = [];
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
    // `from()` is itself awaitable, because loadCategoryIndex reads a whole
    // table with no WHERE, while the supplier-name lookup chains one.
    select: () => ({
      from: (table: any) => {
        const rows = table === productCategories ? CATEGORY_ROWS
          : table === productCategoryAliases ? ALIAS_ROWS
          : existingNames.map(name => ({ name }));
        return Object.assign(
          { where: () => Promise.resolve(existingNames.map(name => ({ name }))) },
          { then: (resolve: (v: unknown) => unknown) => resolve(rows) },
        );
      },
    }),
    transaction: async (cb: (t: unknown) => Promise<unknown>) => cb({
      insert: () => ({ values: (rows: Record<string, unknown>[]) => { written.push(rows); return Promise.resolve([{ insertId: 1 }]); } }),
    }),
  });
  return written;
}

// ══ 1. THE CSV READER ══════════════════════════════════════════════════════

describe('the file is read as CSV, not split on commas', () => {
  it('keeps a quoted comma inside one field', () => {
    // Splitting on ',' would silently corrupt any description containing one.
    const rows = parseCsv('name,description\n"Rebar, 12mm","Grade 60, mill certificate"');
    expect(rows[1]).toEqual(['Rebar, 12mm', 'Grade 60, mill certificate']);
  });

  it('handles an escaped quote', () => {
    expect(parseCsv('name\n"He said ""yes"""')[1]).toEqual(['He said "yes"']);
  });

  it('handles a newline inside a quoted field', () => {
    expect(parseCsv('name,description\n"Tile","Line one\nLine two"')[1][1]).toBe('Line one\nLine two');
  });

  it('strips the BOM Excel writes, so the first column name is usable', () => {
    expect(parseCsv('﻿name,category\nX,Materials')[0][0]).toBe('name');
  });

  it('ignores blank lines rather than importing empty products', () => {
    expect(parseCsv('name\nA\n\n\nB')).toHaveLength(3);
  });

  it('the template it hands out actually parses, and carries Arabic', () => {
    const parsed = parseProductImport(importTemplateCsv(), CATEGORY_RESOLVER);
    expect(parsed.errors, JSON.stringify(parsed.errors)).toEqual([]);
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(parsed.rows.some(row => /[؀-ۿ]/.test(row.nameAr ?? ''))).toBe(true);
  });
});

// ══ 2. EVERY ROW IS CHECKED, AND EVERY PROBLEM REPORTED ════════════════════

describe('validation reports every problem, not the first', () => {
  it('names the row and the column for each error', () => {
    const { errors } = parseProductImport(csv(
      ',Materials,,,,,,,',                     // no name
      'Cement,NotACategory,,,,,,,',            // bad category
      'Tile,Materials,,notanumber,,,,,',       // bad price
    ), CATEGORY_RESOLVER);
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors.map(e => e.line)).toEqual(expect.arrayContaining([2, 3, 4]));
    expect(errors.some(e => e.column === 'name')).toBe(true);
    expect(errors.some(e => e.column === 'category')).toBe(true);
  });

  it('rejects a category outside the BuildHub taxonomy', () => {
    // A category the directory has no filter for makes the product unfindable.
    const { errors } = parseProductImport(csv('Rebar,,Invented Category,,,,,,'), CATEGORY_RESOLVER);
    expect(errors.some(e => e.column === 'category')).toBe(true);
  });

  it('accepts Arabic-Indic digits, which an Egyptian spreadsheet may hold', () => {
    const { rows, errors } = parseProductImport(csv('Rebar,,Materials,,١٢٥٠,,,,'), CATEGORY_RESOLVER);
    expect(errors).toEqual([]);
    expect(rows[0].price).toBe(1250);
  });

  it('accepts a thousands separator', () => {
    const { rows } = parseProductImport(csv('Rebar,,Materials,,"18,500",,,,'), CATEGORY_RESOLVER);
    expect(rows[0].price).toBe(18500);
  });

  it('refuses a negative price and a fractional stock count', () => {
    const { errors } = parseProductImport(csv(
      'A,,Materials,,-5,,,,',
      'B,,Materials,,10,2.5,,,',
    ), CATEGORY_RESOLVER);
    expect(errors.some(e => e.column === 'price')).toBe(true);
    expect(errors.some(e => e.column === 'stock')).toBe(true);
  });

  it('reports a duplicate WITHIN the file against the row it duplicates', () => {
    const { errors, duplicatesInFile } = parseProductImport(csv(
      'Rebar 12mm,,Materials,,10,,,,',
      'Rebar 12mm,,Materials,,20,,,,',
    ), CATEGORY_RESOLVER);
    expect(errors.some(e => /Duplicate of row 2/.test(e.message))).toBe(true);
    expect(duplicatesInFile).toContain('Rebar 12mm');
  });

  it('refuses a missing required column outright', () => {
    const { errors } = parseProductImport('name,price\nRebar,10', CATEGORY_RESOLVER);
    expect(errors.some(e => /Missing required column "category"/.test(e.message))).toBe(true);
  });

  it('refuses a file with more rows than the cap', () => {
    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `P${i},,Materials,,1,,,,`);
    const { errors, rows } = parseProductImport(csv(...many), CATEGORY_RESOLVER);
    expect(rows).toEqual([]);
    expect(errors[0].message).toMatch(/exceeds the maximum/);
  });

  it('an empty file is an error, not an empty success', () => {
    expect(parseProductImport('', CATEGORY_RESOLVER).errors[0].message).toMatch(/empty/i);
  });
});

// ══ 3. THE FILE NEVER DECIDES WHO OWNS THE PRODUCTS ════════════════════════

describe('the server owns what the file cannot', () => {
  it('every imported row is written with the CALLER\'s supplierId', async () => {
    const written = stubDb();
    const caller = ctx();
    await appRouter.createCaller(caller).marketplace.importProducts({
      csv: csv('Rebar,,Materials,,100,5,tonne,,'), dryRun: false,
    });
    expect(written[0][0].supplierId).toBe(caller.user.id);
  });

  it('a supplierId column in the file is ignored entirely', async () => {
    // The obvious attack: hand the importer somebody else's id.
    const written = stubDb();
    const caller = ctx();
    await appRouter.createCaller(caller).marketplace.importProducts({
      csv: 'name,category,supplierId\nRebar,Materials,999\n', dryRun: false,
    });
    expect(written[0][0].supplierId).toBe(caller.user.id);
    expect(written[0][0].supplierId).not.toBe(999);
  });

  it('the parser emits ONLY known columns, so nothing else can reach the insert', () => {
    /**
     * This is where the "supplierId column" defence actually lives. The row
     * objects the insert maps over are built field by field from a fixed list,
     * so an extra column in the file is dropped at parse time and never
     * reaches a value the database would accept.
     *
     * Asserting it here rather than only at the procedure: mutating the insert
     * to read `row.supplierId` is a no-op precisely BECAUSE of this, which
     * makes the procedure-level test unable to see the difference.
     */
    const { rows } = parseProductImport(
      'name,category,supplierId,active,featured,rating\nRebar,Materials,999,1,1,5\n',
      CATEGORY_RESOLVER,
    );
    expect(rows).toHaveLength(1);
    // The rule is "nothing FROM THE FILE reaches the insert". `categoryId` and
    // `resolvedCategory` are the server's own answer from the category
    // resolver, not columns anybody can put in a spreadsheet - a file
    // containing a `categoryId` column is ignored exactly like `supplierId`,
    // which the explicit list below still proves.
    const serverDerived = ['categoryId', 'resolvedCategory'];
    const allowed = new Set([...IMPORT_COLUMNS, 'line', ...serverDerived]);
    for (const key of Object.keys(rows[0])) {
      expect(allowed.has(key), `"${key}" must not survive parsing`).toBe(true);
    }
    for (const forbidden of ['supplierId', 'active', 'featured', 'rating']) {
      expect(rows[0]).not.toHaveProperty(forbidden);
    }
  });

  it('a categoryId column in the file cannot choose the category', async () => {
    // Now that products carry a real categoryId, a file offering one is the
    // obvious way to try to reach a category the resolver would refuse.
    const { rows } = parseProductImport(
      'name,category,categoryId\nRebar,Materials,9999\n',
      CATEGORY_RESOLVER,
    );
    expect(rows).toHaveLength(1);
    // The id comes from resolving "Materials", never from the cell.
    expect(rows[0].categoryId).not.toBe(9999);
    expect(rows[0].resolvedCategory).toBe('Materials');
  });

  it('a supplier cannot mark their own import featured or pre-rated', async () => {
    // `featured` is a paid placement and `rating` is earned; neither is a
    // column a supplier fills in.
    const written = stubDb();
    await appRouter.createCaller(ctx()).marketplace.importProducts({
      csv: 'name,category,featured,rating,active\nRebar,Materials,1,5,1\n', dryRun: false,
    });
    expect(written[0][0]).not.toHaveProperty('featured');
    expect(written[0][0]).not.toHaveProperty('rating');
  });

  it('a non-supplier cannot import, even with a provider role', async () => {
    stubDb();
    await expect(
      appRouter.createCaller(ctx('contractor')).marketplace.importProducts({ csv: csv('A,,Materials,,1,,,,'), dryRun: false }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('an UNAPPROVED supplier cannot import', async () => {
    stubDb();
    await expect(
      appRouter.createCaller(ctx('supplier', 'under_review')).marketplace.importProducts({ csv: csv('A,,Materials,,1,,,,'), dryRun: false }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a homeowner cannot import', async () => {
    stubDb();
    await expect(
      appRouter.createCaller(ctx('homeowner')).marketplace.importProducts({ csv: csv('A,,Materials,,1,,,,'), dryRun: false }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// ══ 4. ALL OR NOTHING ══════════════════════════════════════════════════════

describe('an import is all or nothing', () => {
  it('one bad row writes NOTHING', async () => {
    // A partial import leaves a supplier unable to tell what landed, and
    // re-uploading then duplicates whatever did.
    const written = stubDb();
    const result = await appRouter.createCaller(ctx()).marketplace.importProducts({
      csv: csv('Good,,Materials,,10,,,,', 'Bad,,NotACategory,,10,,,,'), dryRun: false,
    });
    expect(written).toHaveLength(0);
    expect(result.imported).toBe(0);
    expect(result.errorCount).toBeGreaterThan(0);
  });

  it('a clean file writes every row in ONE transaction', async () => {
    const written = stubDb();
    const result = await appRouter.createCaller(ctx()).marketplace.importProducts({
      csv: csv('A,,Materials,,1,,,,', 'B,,Steel,,2,,,,', 'C,,Wood,,3,,,,'), dryRun: false,
    });
    expect(written).toHaveLength(1);          // one insert call
    expect(written[0]).toHaveLength(3);       // three rows in it
    expect(result.imported).toBe(3);
  });

  it('a dry run writes nothing but reports the same verdict', async () => {
    const written = stubDb();
    const preview = await appRouter.createCaller(ctx()).marketplace.importProducts({
      csv: csv('A,,Materials,,1,,,,', 'B,,Steel,,2,,,,'), dryRun: true,
    });
    expect(written).toHaveLength(0);
    expect(preview.dryRun).toBe(true);
    expect(preview.totalRows).toBe(2);
    expect(preview.imported).toBe(0);
  });

  it('a name already in THIS supplier\'s catalogue is reported, not duplicated', async () => {
    const written = stubDb(['Rebar 12mm']);
    const result = await appRouter.createCaller(ctx()).marketplace.importProducts({
      csv: csv('Rebar 12mm,,Materials,,10,,,,'), dryRun: false,
    });
    expect(written).toHaveLength(0);
    expect(result.errors.some(e => /already in your catalogue/.test(e.message))).toBe(true);
  });

  it('another supplier selling the same name is NOT a conflict', async () => {
    // The existing-name query is scoped to the caller; telling a supplier what
    // a rival lists would leak a competitor's catalogue.
    const written = stubDb([]);   // this supplier's catalogue is empty
    const result = await appRouter.createCaller(ctx()).marketplace.importProducts({
      csv: csv('Rebar 12mm,,Materials,,10,,,,'), dryRun: false,
    });
    expect(result.imported).toBe(1);
    expect(written[0]).toHaveLength(1);
  });

  it('the error report is bounded rather than returning thousands of lines', async () => {
    stubDb();
    const bad = Array.from({ length: 300 }, (_, i) => `P${i},,NotACategory,,1,,,,`);
    const result = await appRouter.createCaller(ctx()).marketplace.importProducts({ csv: csv(...bad), dryRun: true });
    expect(result.errors.length).toBeLessThanOrEqual(100);
    expect(result.errorCount).toBeGreaterThan(result.errors.length);
  });
});

// ══ 5. THE THIRD WRITE PATH ════════════════════════════════════════════════
//
// Add and Bulk were reconciled onto one resolver; EDIT was the remaining way
// for them to drift apart. `updateProduct` took `category` as free text, never
// resolved it, and never touched `categoryId` - so a product created as
// Waterproofing could be edited to any string at all while its link still
// pointed at Waterproofing. The row then says two different things about
// itself, which is the reported defect reached through a different door.

describe('editing a product goes through the SAME resolver', () => {
  const OWNED = {
    id: 77, supplierId: 501, name: 'Bitumen Membrane', category: 'Waterproofing',
    categoryId: SEED_CATEGORIES.findIndex(s => s.slug === 'waterproofing') + 1,
    unit: 'roll', price: '850', stock: 10, active: true, description: null,
  };

  /** Enough of a driver for one edit: read the row, write the patch, audit it. */
  function editStub() {
    const patches: Record<string, unknown>[] = [];
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
      select: () => ({
        from: (table: any) => {
          const rows = table === productCategories ? CATEGORY_ROWS
            : table === productCategoryAliases ? ALIAS_ROWS
            : [OWNED];
          return Object.assign(
            { where: () => Promise.resolve(rows) },
            { then: (resolve: (v: unknown) => unknown) => resolve(rows) },
          );
        },
      }),
      update: () => ({ set: (patch: Record<string, unknown>) => { patches.push(patch); return { where: () => Promise.resolve() }; } }),
      insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
    });
    return patches;
  }

  const supplier = () => {
    const base = ctx();
    (base.user as { id: number }).id = OWNED.supplierId;
    return base;
  };

  it('accepts the alias and stores the CANONICAL name, exactly as bulk does', async () => {
    const patches = editStub();
    await appRouter.createCaller(supplier()).marketplace.updateProduct({ id: OWNED.id, category: 'Pools' });
    expect(patches[0].category).toBe('Swimming Pool Equipment');
  });

  it('THE LINK MOVES WITH THE NAME - never left pointing at the old category', async () => {
    const patches = editStub();
    await appRouter.createCaller(supplier()).marketplace.updateProduct({ id: OWNED.id, category: 'Pools' });
    const pools = SEED_CATEGORIES.findIndex(s => s.slug === 'pools') + 1;
    expect(patches[0].categoryId).toBe(pools);
    expect(patches[0].categoryId).not.toBe(OWNED.categoryId);
  });

  it('refuses free text rather than storing it', async () => {
    const patches = editStub();
    await expect(
      appRouter.createCaller(supplier()).marketplace.updateProduct({ id: OWNED.id, category: 'Not A Category At All' }),
    ).rejects.toThrow(/not a BuildHub category/);
    expect(patches, 'a refused edit must write nothing').toEqual([]);
  });

  it('names a hidden category as hidden, not as unknown', async () => {
    // Same distinction the bulk path makes. A supplier told "not a BuildHub
    // category" about a category that plainly exists goes hunting for a typo.
    const patches = editStub();
    CATEGORY_ROWS[OWNED.categoryId - 1].status = 'hidden';
    try {
      await expect(
        appRouter.createCaller(supplier()).marketplace.updateProduct({ id: OWNED.id, category: 'Waterproofing' }),
      ).rejects.toThrow(/not currently available for new listings/);
    } finally {
      CATEGORY_ROWS[OWNED.categoryId - 1].status = 'active';
    }
    expect(patches).toEqual([]);
  });

  it('leaves the category alone when the edit does not mention it', async () => {
    // A supplier changing the price must not be refused because of a field
    // they did not touch, and must not have their link rewritten.
    const patches = editStub();
    await appRouter.createCaller(supplier()).marketplace.updateProduct({ id: OWNED.id, price: 900 });
    expect(patches[0]).not.toHaveProperty('category');
    expect(patches[0]).not.toHaveProperty('categoryId');
    expect(patches[0].price).toBe('900');
  });
});

// ══ 6. A FIFTY-ROW PROBLEM READS AS ONE PROBLEM ════════════════════════════

describe('summariseLines collapses consecutive rows into ranges', () => {
  it('collapses a run', () => {
    expect(summariseLines([2, 3, 4, 5])).toEqual([{ from: 2, to: 5 }]);
  });

  it('keeps separate runs separate', () => {
    expect(summariseLines([2, 3, 7, 9, 10])).toEqual([
      { from: 2, to: 3 }, { from: 7, to: 7 }, { from: 9, to: 10 },
    ]);
  });

  it('does not depend on the order it was given', () => {
    // The lines arrive from a Map, and a screen must not read differently
    // because of insertion order.
    expect(summariseLines([10, 2, 9, 3])).toEqual([{ from: 2, to: 3 }, { from: 9, to: 10 }]);
  });

  it('ignores a repeated line rather than emitting it twice', () => {
    expect(summariseLines([4, 4, 5])).toEqual([{ from: 4, to: 5 }]);
  });

  it('is empty for no lines, so a caller renders nothing rather than "rows"', () => {
    expect(summariseLines([])).toEqual([]);
  });

  it('a single line is a range of one, not a special case the caller handles', () => {
    expect(summariseLines([12])).toEqual([{ from: 12, to: 12 }]);
  });
});
