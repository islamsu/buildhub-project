import { describe, expect, it, vi } from 'vitest';
import {
  importTemplateCsv, parseCsv, parseProductImport,
  MAX_IMPORT_ROWS, IMPORT_COLUMNS,
} from '@shared/productImport';
import { PRODUCT_CATEGORIES } from '@shared/productCategories';

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

function stubDb(existingNames: string[] = []) {
  const written: Record<string, unknown>[][] = [];
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
    select: () => ({ from: () => ({ where: () => Promise.resolve(existingNames.map(name => ({ name }))) }) }),
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
    const parsed = parseProductImport(importTemplateCsv(), PRODUCT_CATEGORIES);
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
    ), PRODUCT_CATEGORIES);
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors.map(e => e.line)).toEqual(expect.arrayContaining([2, 3, 4]));
    expect(errors.some(e => e.column === 'name')).toBe(true);
    expect(errors.some(e => e.column === 'category')).toBe(true);
  });

  it('rejects a category outside the BuildHub taxonomy', () => {
    // A category the directory has no filter for makes the product unfindable.
    const { errors } = parseProductImport(csv('Rebar,,Invented Category,,,,,,'), PRODUCT_CATEGORIES);
    expect(errors.some(e => e.column === 'category')).toBe(true);
  });

  it('accepts Arabic-Indic digits, which an Egyptian spreadsheet may hold', () => {
    const { rows, errors } = parseProductImport(csv('Rebar,,Materials,,١٢٥٠,,,,'), PRODUCT_CATEGORIES);
    expect(errors).toEqual([]);
    expect(rows[0].price).toBe(1250);
  });

  it('accepts a thousands separator', () => {
    const { rows } = parseProductImport(csv('Rebar,,Materials,,"18,500",,,,'), PRODUCT_CATEGORIES);
    expect(rows[0].price).toBe(18500);
  });

  it('refuses a negative price and a fractional stock count', () => {
    const { errors } = parseProductImport(csv(
      'A,,Materials,,-5,,,,',
      'B,,Materials,,10,2.5,,,',
    ), PRODUCT_CATEGORIES);
    expect(errors.some(e => e.column === 'price')).toBe(true);
    expect(errors.some(e => e.column === 'stock')).toBe(true);
  });

  it('reports a duplicate WITHIN the file against the row it duplicates', () => {
    const { errors, duplicatesInFile } = parseProductImport(csv(
      'Rebar 12mm,,Materials,,10,,,,',
      'Rebar 12mm,,Materials,,20,,,,',
    ), PRODUCT_CATEGORIES);
    expect(errors.some(e => /Duplicate of row 2/.test(e.message))).toBe(true);
    expect(duplicatesInFile).toContain('Rebar 12mm');
  });

  it('refuses a missing required column outright', () => {
    const { errors } = parseProductImport('name,price\nRebar,10', PRODUCT_CATEGORIES);
    expect(errors.some(e => /Missing required column "category"/.test(e.message))).toBe(true);
  });

  it('refuses a file with more rows than the cap', () => {
    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `P${i},,Materials,,1,,,,`);
    const { errors, rows } = parseProductImport(csv(...many), PRODUCT_CATEGORIES);
    expect(rows).toEqual([]);
    expect(errors[0].message).toMatch(/exceeds the maximum/);
  });

  it('an empty file is an error, not an empty success', () => {
    expect(parseProductImport('', PRODUCT_CATEGORIES).errors[0].message).toMatch(/empty/i);
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
      PRODUCT_CATEGORIES,
    );
    expect(rows).toHaveLength(1);
    const allowed = new Set([...IMPORT_COLUMNS, 'line']);
    for (const key of Object.keys(rows[0])) {
      expect(allowed.has(key), `"${key}" must not survive parsing`).toBe(true);
    }
    for (const forbidden of ['supplierId', 'active', 'featured', 'rating']) {
      expect(rows[0]).not.toHaveProperty(forbidden);
    }
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
