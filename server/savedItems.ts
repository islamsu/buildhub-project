/**
 * ── THE BUYER'S SHORTLIST, SERVER SIDE ──────────────────────────────────
 *
 * Save / Shortlist, PRODUCT_NORTH_STAR.md CURRENT GLOBAL RELEASE item 9.
 *
 * THREE RULES THIS MODULE ENFORCES, all of them in one place:
 *
 *   SELF-SCOPED BY CONSTRUCTION. No function here takes a userId from a
 *     caller's payload; every one takes the authenticated id. There is
 *     therefore no shape of request that reads or writes another buyer's
 *     shortlist, which is a stronger guarantee than a check that could be
 *     forgotten on the next procedure added beside them.
 *
 *   YOU CANNOT SAVE WHAT YOU CANNOT SEE. The target is resolved against the
 *     SAME public predicate the marketplace lists by, so a draft product or
 *     an unapproved provider cannot be shortlisted by id. Without this the
 *     shortlist would be an enumeration oracle: save id after id, and the
 *     ones that succeed are the ones that exist.
 *
 *   A VANISHED TARGET IS ABSENT, NOT BROKEN. The readers JOIN, so a product
 *     withdrawn after it was saved drops out of the list rather than
 *     rendering as a card with no name. The row stays - the buyer may want
 *     to know something they were considering is gone - and `listSaved`
 *     reports it separately rather than pretending it was never there.
 */
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { products, savedItems, users, vendorProfiles } from '../drizzle/schema';
import { MAX_SAVED_ITEMS, MAX_SAVED_NOTE, type SavedItemKind } from '../shared/savedItems';
import { publicProductFilter } from './productLifecycle';
import { directoryVisibilityFilter } from './vendorDirectory';
import { isDuplicateKeyError } from './_core/dbErrors';

type Db = any;

export class SavedItemError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT', message: string) {
    super(message);
  }
}

/**
 * Does this target exist AND may this buyer see it?
 *
 * One question, not two, and asked with the marketplace's own predicates so
 * the shortlist cannot diverge from what is browsable. A provider who is not
 * in the directory and a provider who does not exist give the SAME answer,
 * because telling them apart is what turns an id field into a probe.
 */
async function targetIsVisible(db: Db, kind: SavedItemKind, itemId: number): Promise<boolean> {
  if (kind === 'product') {
    const [row] = await db.select({ id: products.id }).from(products)
      .where(and(eq(products.id, itemId), publicProductFilter())).limit(1);
    return row !== undefined;
  }
  const [row] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.id, itemId), directoryVisibilityFilter())).limit(1);
  return row !== undefined;
}

/**
 * Save, or un-save. ONE ACTION, because that is one gesture on the screen.
 *
 * Returns what the item's state now IS rather than what happened, so a
 * button rendering the result cannot disagree with the database - the shape
 * that makes a double-tap harmless rather than merely unlikely.
 */
export async function toggleSaved(db: Db, params: {
  userId: number; kind: SavedItemKind; itemId: number; note?: string | null;
}): Promise<{ saved: boolean; total: number }> {
  const [existing] = await db.select({ id: savedItems.id }).from(savedItems)
    .where(and(
      eq(savedItems.userId, params.userId),
      eq(savedItems.itemKind, params.kind),
      eq(savedItems.itemId, params.itemId),
    )).limit(1);

  if (existing) {
    await db.delete(savedItems).where(eq(savedItems.id, existing.id));
    return { saved: false, total: await countSaved(db, params.userId) };
  }

  // THE VISIBILITY CHECK IS ON THE SAVE, not on the un-save: a buyer must
  // always be able to remove something from their own list, including an
  // item that has since been withdrawn.
  if (!await targetIsVisible(db, params.kind, params.itemId)) {
    throw new SavedItemError('NOT_FOUND',
      params.kind === 'product' ? 'Product not found' : 'Provider not found');
  }

  const total = await countSaved(db, params.userId);
  if (total >= MAX_SAVED_ITEMS) {
    throw new SavedItemError('CONFLICT',
      `A shortlist holds ${MAX_SAVED_ITEMS} items. Remove something, or turn what you have into a request for quotations.`);
  }

  const note = (params.note ?? '').trim().slice(0, MAX_SAVED_NOTE) || null;
  /*
   * ── TWO SAVES AT ONCE ANSWERED 500 ─────────────────────────────────────
   *
   * The read above and this insert are not one atomic step. Two concurrent
   * saves of the same item both found nothing, both inserted, and
   * `savedItems_user_item_unique` rejected the loser - as it should. What was
   * wrong is what the loser's caller received: the raw duplicate-key error
   * escaped as INTERNAL_SERVER_ERROR. Measured by firing two saves with
   * Promise.all (evidence/zg-reliability.mjs), which answered 500 and 200.
   *
   * The DATA was never at risk; the unique index is what guarantees that, and
   * the shortlist held one row throughout. The defect was the answer: a 500 on
   * a double-tap tells a buyer their shortlist is broken when it is correct,
   * and §64 requires a retry not to look like a fault.
   *
   * So the duplicate is CAUGHT and reported as the state it produced: saved.
   * That is the contract this function already documented - "returns what the
   * item's state now IS rather than what happened" - and the losing call now
   * honours it instead of contradicting it.
   *
   * A locking read would also work and is heavier: it would take a row lock on
   * every save, including the overwhelming majority that are not racing, to
   * avoid an error that is already impossible to get wrong in the data.
   *
   * `isDuplicateKeyError` walks `error.cause`, and that is not incidental: the
   * first version of this catch read `error.code` and never matched, because
   * drizzle throws its own "Failed query" error and leaves MySQL's on the
   * cause. See server/_core/dbErrors.ts.
   */
  try {
    await db.insert(savedItems).values({
      userId: params.userId, itemKind: params.kind, itemId: params.itemId, note,
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    // The other call won the race. The item IS saved, which is what was asked
    // for, so the count is re-read rather than assumed.
    return { saved: true, total: await countSaved(db, params.userId) };
  }
  return { saved: true, total: total + 1 };
}

/** How many things this buyer has shortlisted. Counted, never estimated. */
export async function countSaved(db: Db, userId: number): Promise<number> {
  const [row] = await db.select({ n: count() }).from(savedItems)
    .where(eq(savedItems.userId, userId));
  return Number(row?.n ?? 0);
}

/**
 * WHICH OF THESE IS ALREADY SAVED.
 *
 * For a grid: one query for the whole page rather than one per card. The
 * alternative - a `saved` boolean on every marketplace row - would put a
 * per-viewer fact inside a cacheable public read, which is how a shared
 * cache ends up showing one buyer another's shortlist.
 */
export async function savedStateFor(db: Db, userId: number, kind: SavedItemKind, itemIds: number[]) {
  if (itemIds.length === 0) return new Set<number>();
  const rows = await db.select({ itemId: savedItems.itemId }).from(savedItems)
    .where(and(
      eq(savedItems.userId, userId),
      eq(savedItems.itemKind, kind),
      inArray(savedItems.itemId, itemIds),
    ));
  return new Set<number>(rows.map((row: any) => Number(row.itemId)));
}

/**
 * The shortlist, with enough of each item to decide what to do next.
 *
 * JOINED rather than read as ids and hydrated by the caller: a shortlist of
 * twenty items would otherwise be twenty round trips, and the page exists to
 * be scanned quickly.
 *
 * `unavailable` is the honest half. An item whose target has been withdrawn
 * since it was saved is NOT silently dropped - the buyer chose it, and
 * "three of your saved products are no longer listed" is information they
 * can act on, where a list that quietly shortens is not.
 */
export async function listSaved(db: Db, userId: number) {
  const rows = await db.select({
    id: savedItems.id,
    itemKind: savedItems.itemKind,
    itemId: savedItems.itemId,
    note: savedItems.note,
    createdAt: savedItems.createdAt,
  }).from(savedItems)
    .where(eq(savedItems.userId, userId))
    .orderBy(desc(savedItems.createdAt))
    .limit(MAX_SAVED_ITEMS);

  const productIds = rows.filter((row: any) => row.itemKind === 'product').map((row: any) => Number(row.itemId));
  const providerIds = rows.filter((row: any) => row.itemKind === 'provider').map((row: any) => Number(row.itemId));

  const [productRows, providerRows] = await Promise.all([
    productIds.length === 0 ? [] : db.select({
      id: products.id, name: products.name, nameAr: products.nameAr,
      category: products.category, price: products.price, currency: products.currency,
      unit: products.unit, images: products.images, supplierId: products.supplierId,
    }).from(products).where(and(inArray(products.id, productIds), publicProductFilter())),
    providerIds.length === 0 ? [] : db.select({
      id: users.id, name: users.name, avatar: users.avatar, location: users.location,
      userRole: users.userRole, verified: users.verified,
      // The BUSINESS where there is one, the same rule the directory follows -
      // a shortlist that names people where the directory names companies
      // would look like a different marketplace.
      companyName: vendorProfiles.companyName,
      tradingName: vendorProfiles.tradingName,
    }).from(users)
      .leftJoin(vendorProfiles, eq(vendorProfiles.userId, users.id))
      .where(and(inArray(users.id, providerIds), directoryVisibilityFilter())),
  ]);

  const productById = new Map<number, any>(productRows.map((row: any) => [Number(row.id), row]));
  const providerById = new Map<number, any>(providerRows.map((row: any) => [Number(row.id), row]));

  const items: any[] = [];
  const unavailable: any[] = [];
  for (const row of rows) {
    const target = row.itemKind === 'product'
      ? productById.get(Number(row.itemId))
      : providerById.get(Number(row.itemId));
    const entry = {
      id: Number(row.id), itemKind: row.itemKind, itemId: Number(row.itemId),
      note: row.note, createdAt: row.createdAt,
    };
    if (target) {
      items.push({
        ...entry,
        ...(row.itemKind === 'provider'
          ? {
            target: {
              ...target,
              businessName: (target.tradingName ?? '').trim() || (target.companyName ?? '').trim() || null,
            },
          }
          : { target }),
      });
    } else {
      unavailable.push(entry);
    }
  }

  return { items, unavailable, total: rows.length };
}
