/**
 * ── THE PRODUCT LIFECYCLE, HELD WHERE IT IS DECIDED ───────────────────────
 *
 * `products.active` was a BOOLEAN, and a boolean can only say two things. A
 * product still being written, a product temporarily off sale, and a product
 * discontinued last year all read as `active = 0` - so a supplier's catalogue
 * gave one undifferentiated pile of "not live" rows and no way to tell them
 * apart. Four rules this file exists to pin:
 *
 *   ONE DEFINITION OF "A BUYER CAN SEE THIS". `publicProductFilter()` and
 *   nothing else. The eleven readers that each spelled `eq(products.active,
 *   true)` out for themselves are exactly the shape that lets one of them keep
 *   serving drafts after the rule gains a state.
 *
 *   THE LEGACY BOOLEAN IS DERIVED. `products.active` is kept for one migration
 *   so the 0049 backfill stays reversible by inspection - written from the
 *   status in one place, never independently. Two fields meaning one thing is
 *   how they come to disagree, which this codebase has already been burned by.
 *
 *   ARCHIVE, NEVER DELETE. There is no delete in the vocabulary: a product id
 *   appears in questions, quotations, placements and audit events.
 *
 *   AN UNDECLARED MOVE IS REFUSED, and the refusal names both states.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  PRODUCT_STATUSES, PRODUCT_TRANSITIONS, PRODUCT_CREATABLE_STATUSES,
  PRODUCT_PUBLIC_STATUS, canTransitionProduct, activeFromStatus,
  productStatusLabel, productStatusHelp, type ProductStatus,
} from '@shared/productLifecycle';
import { transitionProduct, ProductLifecycleError } from './productLifecycle';

const SCHEMA = readSourceForAssertions(
  readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8'),
);
const LIFECYCLE = readSourceForAssertions(
  readFileSync(new URL('./productLifecycle.ts', import.meta.url), 'utf8'),
);

/**
 * The first select is the product row; anything after it is the live-placement
 * lookup the archive guard makes, answered from `laterRows` (empty by default).
 */
function fakeDb(row: Record<string, unknown> | null, laterRows: unknown[][] = []) {
  let call = 0;
  const writes: Record<string, unknown>[] = [];
  const db: any = {
    select: () => ({
      from: () => ({
        where: () => {
          const answer = () => Promise.resolve(
            call++ === 0 ? (row ? [row] : []) : (laterRows.shift() ?? []));
          let pending: Promise<unknown> | null = null;
          const take = () => (pending ??= answer());
          return Object.assign(take(), { limit: () => take() });
        },
      }),
    }),
    update: () => ({ set: (patch: Record<string, unknown>) => ({ where: () => { writes.push(patch); return Promise.resolve(); } }) }),
    insert: () => ({ values: () => Promise.resolve() }),
    writes,
  };
  return db;
}

const live = { id: 3, supplierId: 5, status: 'active' as const };

describe('the vocabulary is closed, and the schema agrees with it', () => {
  it('every status the shared list declares is in the column', () => {
    const table = SCHEMA.slice(
      SCHEMA.indexOf("export const products = mysqlTable"),
      SCHEMA.indexOf("export const portfolioItems = mysqlTable"),
    );
    for (const status of PRODUCT_STATUSES) expect(table, status).toContain(`'${status}'`);
    // The columns the service writes. A missing one fails only at runtime,
    // against a real database, in production.
    for (const column of ['statusChangedAt', 'archivedAt']) expect(table, column).toContain(column);
  });

  it('every status has a distinct label AND an explanation in both languages', () => {
    for (const status of PRODUCT_STATUSES) {
      expect(productStatusLabel(status, 'en'), status).not.toBe(status);
      expect(productStatusLabel(status, 'ar'), status).not.toBe(productStatusLabel(status, 'en'));
      // The help text is what tells a supplier what the state MEANS - which is
      // the whole reason four states beat one boolean.
      expect(productStatusHelp(status, 'en').length, status).toBeGreaterThan(20);
      expect(productStatusHelp(status, 'ar').length, status).toBeGreaterThan(10);
    }
  });

  it('THERE IS NO DELETE, in the vocabulary or in the service', () => {
    expect([...PRODUCT_STATUSES]).not.toContain('deleted');
    expect(LIFECYCLE).not.toContain('db.delete(');
  });
});

describe('the transition table says what it means to say', () => {
  it('every declared target is itself a declared status', () => {
    for (const [from, targets] of Object.entries(PRODUCT_TRANSITIONS)) {
      for (const to of targets) {
        expect(PRODUCT_STATUSES, `${from} → ${to}`).toContain(to);
      }
    }
  });

  it('no status declares a move to itself', () => {
    for (const [from, targets] of Object.entries(PRODUCT_TRANSITIONS)) {
      expect(targets, from).not.toContain(from);
    }
  });

  it('ARCHIVED COMES BACK TO OFF SALE, never straight to the marketplace', () => {
    // Restoring a discontinued line and republishing it are two decisions. A
    // single click that did both would put a year-old price back in front of
    // buyers.
    expect([...PRODUCT_TRANSITIONS.archived]).toEqual(['inactive']);
    expect(canTransitionProduct('archived', 'active')).toBe(false);
  });

  it('DRAFT IS ONE-WAY - nothing returns to it', () => {
    // A published product has been seen, asked about and possibly quoted on.
    // "Unpublish so I can rewrite it" is what off sale is for.
    for (const from of PRODUCT_STATUSES) {
      expect(canTransitionProduct(from, 'draft'), from).toBe(false);
    }
  });

  it('every state can be retired, so nothing is a dead end', () => {
    for (const from of PRODUCT_STATUSES) {
      if (from === 'archived') continue;
      expect(canTransitionProduct(from, 'archived'), from).toBe(true);
    }
  });

  it('only draft and live are creatable - the other two describe a past', () => {
    // Inactive and archived both mean "this was published once", which a
    // brand-new row never was.
    expect([...PRODUCT_CREATABLE_STATUSES]).toEqual(['draft', 'active']);
  });

  it('the legacy boolean is TRUE for exactly one status', () => {
    const live = PRODUCT_STATUSES.filter(status => activeFromStatus(status));
    expect(live).toEqual([PRODUCT_PUBLIC_STATUS]);
  });
});

describe('transitionProduct', () => {
  it('moves a live product off sale, writing the status, the stamp and the derived boolean together', async () => {
    const db = fakeDb(live);
    await expect(transitionProduct(db, { productId: 3, supplierId: 5, to: 'inactive' }))
      .resolves.toEqual({ ok: true, from: 'active', to: 'inactive' });
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ status: 'inactive', active: false, archivedAt: null });
    expect(db.writes[0].statusChangedAt).toBeInstanceOf(Date);
  });

  it('archiving stamps archivedAt; anything else clears it', async () => {
    const archived = fakeDb(live);
    await transitionProduct(archived, { productId: 3, supplierId: 5, to: 'archived' });
    expect(archived.writes[0].archivedAt).toBeInstanceOf(Date);

    const restored = fakeDb({ ...live, status: 'archived' });
    await transitionProduct(restored, { productId: 3, supplierId: 5, to: 'inactive' });
    expect(restored.writes[0].archivedAt).toBeNull();
  });

  it('SOMEBODY ELSE\'S PRODUCT IS NOT FOUND, not forbidden', async () => {
    // Confirming a product id belongs to someone else lets a competitor's
    // catalogue be walked one id at a time.
    const db = fakeDb({ ...live, supplierId: 999 });
    await expect(transitionProduct(db, { productId: 3, supplierId: 5, to: 'inactive' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.writes).toEqual([]);
  });

  it('a product that does not exist answers the same way', async () => {
    await expect(transitionProduct(fakeDb(null), { productId: 3, supplierId: 5, to: 'inactive' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('an administrator may act on a product that is not theirs', async () => {
    const db = fakeDb({ ...live, supplierId: 999 });
    await expect(transitionProduct(db, {
      productId: 3, supplierId: 1, to: 'inactive', actorIsAdmin: true,
    })).resolves.toMatchObject({ ok: true });
  });

  it('an UNDECLARED move is refused and the refusal NAMES BOTH STATES', async () => {
    // "Invalid status" tells a supplier nothing. "A product cannot go from
    // Archived to Live" tells them to restore it first.
    const db = fakeDb({ ...live, status: 'archived' });
    await expect(transitionProduct(db, { productId: 3, supplierId: 5, to: 'active' }))
      .rejects.toThrow(/Archived.*Live/);
    expect(db.writes).toEqual([]);
  });

  it('a move to the state it is already in is refused rather than written twice', async () => {
    const db = fakeDb(live);
    await expect(transitionProduct(db, { productId: 3, supplierId: 5, to: 'active' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.writes).toEqual([]);
  });

  it('ARCHIVING A PRODUCT WITH A LIVE PLACEMENT IS REFUSED, not silently accepted', async () => {
    // publicPlacement filters on the same status, so archiving would leave a
    // paid slot rendering nothing while the vendor's entitlement went on being
    // consumed. Telling the supplier to end the placement first is a real
    // answer; quietly breaking it is not.
    const db = fakeDb(live, [[{ id: 77 }]]);
    await expect(transitionProduct(db, { productId: 3, supplierId: 5, to: 'archived' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(db.writes).toEqual([]);
  });

  it('the placement check applies to ARCHIVING ONLY - going off sale is still allowed', async () => {
    // Off sale is reversible and the supplier may need it urgently (a stock
    // problem, a pricing error). Blocking that on a placement would make the
    // paid slot a trap.
    const db = fakeDb(live, [[{ id: 77 }]]);
    await expect(transitionProduct(db, { productId: 3, supplierId: 5, to: 'inactive' }))
      .resolves.toMatchObject({ ok: true });
  });

  it('every refusal is a ProductLifecycleError carrying one of the three codes', async () => {
    const failures = await Promise.allSettled([
      transitionProduct(fakeDb(null), { productId: 3, supplierId: 5, to: 'inactive' }),
      transitionProduct(fakeDb({ ...live, status: 'archived' }), { productId: 3, supplierId: 5, to: 'active' }),
      transitionProduct(fakeDb(live, [[{ id: 77 }]]), { productId: 3, supplierId: 5, to: 'archived' }),
    ]);
    expect(failures.every(f => f.status === 'rejected')).toBe(true);
    for (const failure of failures) {
      const reason = (failure as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(ProductLifecycleError);
      expect(['NOT_FOUND', 'BAD_REQUEST', 'CONFLICT']).toContain(reason.code);
      expect(String(reason.message).length).toBeGreaterThan(10);
    }
  });
});

describe('ONE DEFINITION of a publicly visible product, and one writer of the legacy boolean', () => {
  const FILES = [
    'routers.ts', 'publicPlacement.ts', 'placementBooking.ts', 'categoryService.ts',
    'placementAnalytics.ts', 'categorySeed.ts', 'admin/platformSearch.ts',
  ] as const;

  const source = (file: string) =>
    readSourceForAssertions(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'));

  it('no module outside productLifecycle.ts builds its own status predicate', () => {
    // `eq(products.status, ...)` anywhere else is a second definition of
    // "public", and a second definition is what let eleven readers disagree
    // when the rule was a boolean. The admin list filters by status through
    // `enumFilter`, which is a filter the ADMINISTRATOR chose, not a
    // visibility rule - a different thing, and it reads the column's own
    // enumValues rather than restating the vocabulary.
    for (const file of FILES) {
      expect(source(file), file).not.toMatch(/eq\(\s*products\.status\s*,/);
    }
    expect(LIFECYCLE).toMatch(/eq\(products\.status, PRODUCT_PUBLIC_STATUS\)/);
  });

  it('no module outside productLifecycle.ts reads or compares products.active', () => {
    // The boolean survives one migration for reversibility. Anything that
    // READS it is trusting a derived column over the authoritative one, which
    // is how the two would come to disagree without anybody noticing.
    for (const file of FILES) {
      const text = source(file);
      // The two INSERT paths write it alongside the status they create the row
      // in; there is no prior state for transitionProduct to move from.
      const writesOnInsert = (text.match(/active: activeFromStatus\(input\.status\)|active: true,/g) ?? []).length;
      const mentions = (text.match(/products\.active/g) ?? []).length;
      expect(mentions, `${file} still reads products.active`).toBe(0);
      expect(writesOnInsert, file).toBeLessThanOrEqual(2);
    }
  });

  it('the derived boolean is written in exactly one place outside the two inserts', () => {
    const writes = (LIFECYCLE.match(/active: activeFromStatus\(/g) ?? []).length;
    expect(writes).toBe(1);
  });

  it('the migration backfills from the boolean rather than defaulting everything live', () => {
    // A backfill that set every row to 'active' would silently republish
    // products their suppliers had withdrawn.
    const migration = readFileSync(
      new URL('../drizzle/0049_product_lifecycle.sql', import.meta.url), 'utf8');
    expect(migration).toMatch(/CASE WHEN `active` = 1 THEN 'active' ELSE 'inactive' END/);
    // Every statement separated, or the driver refuses the file as one query.
    const statements = migration.split('--> statement-breakpoint').filter(s => s.trim());
    expect(statements.length).toBeGreaterThanOrEqual(6);
  });
});
