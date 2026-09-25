/**
 * ── THE SUPPLIER'S OWN EMPHASIS, AND THE FENCE AROUND IT ────────────────
 *
 * CLAUDE.md §18: FEATURED is BuildHub's editorial choice, SPONSORED is a
 * commercial grant, and a SHOWCASE is the supplier saying "start here" on the
 * page that is already theirs.
 *
 * THREE RULES, and the first is the one that matters:
 *
 *   IT NEVER LEAVES THE STOREFRONT. The only reader below is keyed by one
 *   supplier's id and returns rows for that supplier's own page. Nothing here
 *   exports a scope, a surface, a priority or an ordering that any shared
 *   list could consume, because a supplier able to move themselves in a
 *   shared list has granted themselves a placement - Sponsored inventory
 *   with no admin decision, no period and no label (see shared/
 *   supplierShowcase.ts for why that is a correctness problem, not a tidiness
 *   one).
 *
 *   YOU CAN ONLY SHOWCASE WHAT IS YOURS. Ownership is re-derived from the
 *   target table on every write, against the SESSION's user id, never against
 *   an id in the payload. The three tables disagree about what the column is
 *   called - products.supplierId, serviceOfferings.providerId,
 *   portfolioItems.userId - which is exactly the kind of detail a single
 *   hand-written check gets wrong once and never again notices.
 *
 *   YOU CANNOT SHOWCASE WHAT NOBODY CAN SEE. A draft product emphasised on a
 *   public storefront is a card that 404s for every visitor. The writer
 *   refuses it; the reader drops it, and tells the OWNER it was dropped
 *   rather than quietly shortening their page.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { portfolioItems, products, serviceOfferings, supplierShowcase } from '../drizzle/schema';
import { publicProductFilter } from './productLifecycle';
import {
  MAX_SHOWCASE_ITEMS, normaliseShowcase, showcaseKey,
  type ShowcaseEntry, type ShowcaseItemKind,
} from '../shared/supplierShowcase';

type Db = any;

/**
 * WHICH OF THESE IDS DOES THIS SUPPLIER ACTUALLY OWN, AND CAN A VISITOR SEE?
 *
 * One query per kind, over the ids of that kind only, with ownership AND
 * public-visibility in the same WHERE. Both conditions live here rather than
 * in the caller so that "is it mine" and "can it be shown" cannot drift apart
 * - a showcase entry needs both to be true and neither alone is sufficient.
 *
 * Returns the ids that passed. An id that is absent from the result failed at
 * least one condition, and the caller does not learn which: "not yours" and
 * "not published" are both simply refused, so the endpoint cannot be used to
 * probe which product ids exist on the platform.
 */
async function ownedVisibleIds(
  db: Db, userId: number, kind: ShowcaseItemKind, ids: readonly number[],
): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  let rows: Array<{ id: number }> = [];
  if (kind === 'product') {
    rows = await db.select({ id: products.id }).from(products)
      .where(and(inArray(products.id, ids as number[]), eq(products.supplierId, userId), publicProductFilter()));
  } else if (kind === 'service') {
    // A service is public when it is `active`; draft/inactive/archived are not
    // rendered on the storefront, so they cannot be emphasised on it.
    rows = await db.select({ id: serviceOfferings.id }).from(serviceOfferings)
      .where(and(inArray(serviceOfferings.id, ids as number[]), eq(serviceOfferings.providerId, userId), eq(serviceOfferings.status, 'active')));
  } else {
    // Portfolio items have no lifecycle: a provider's past work is visible on
    // their storefront as soon as it exists. Ownership is the whole test.
    rows = await db.select({ id: portfolioItems.id }).from(portfolioItems)
      .where(and(inArray(portfolioItems.id, ids as number[]), eq(portfolioItems.userId, userId)));
  }
  return new Set(rows.map(row => Number(row.id)));
}

export type ShowcaseWriteResult = {
  stored: ShowcaseEntry[];
  /** Entries the caller sent that were refused, so the UI can say so. */
  refused: ShowcaseEntry[];
};

/**
 * REPLACE the supplier's showcase with exactly this selection.
 *
 * Wholesale replacement rather than add/remove/reorder mutations: the
 * selection IS the state, positions are contiguous by construction, and
 * there is no sequence of partial updates that can leave a gap or a
 * duplicate. It runs in one transaction so a failure leaves the old showcase
 * intact rather than an empty page.
 *
 * `userId` is the SESSION's, never an input - there is no parameter here by
 * which one supplier could write another's showcase.
 */
export async function setShowcase(
  db: Db, userId: number, entries: readonly unknown[],
): Promise<ShowcaseWriteResult> {
  const requested = normaliseShowcase(entries);

  const allowed: ShowcaseEntry[] = [];
  const refused: ShowcaseEntry[] = [];
  for (const kind of ['product', 'service', 'portfolio'] as const) {
    const ofKind = requested.filter(entry => entry.kind === kind);
    if (ofKind.length === 0) continue;
    const permitted = await ownedVisibleIds(db, userId, kind, ofKind.map(entry => entry.itemId));
    for (const entry of ofKind) {
      (permitted.has(entry.itemId) ? allowed : refused).push(entry);
    }
  }
  // The caller's ORDER is what the supplier chose; the per-kind grouping above
  // is an implementation detail of the checks and must not reorder the page.
  const allowedKeys = new Set(allowed.map(entry => showcaseKey(entry.kind, entry.itemId)));
  const stored = requested.filter(entry => allowedKeys.has(showcaseKey(entry.kind, entry.itemId)));

  await db.transaction(async (tx: Db) => {
    await tx.delete(supplierShowcase).where(eq(supplierShowcase.userId, userId));
    if (stored.length > 0) {
      await tx.insert(supplierShowcase).values(stored.map((entry, index) => ({
        userId, itemKind: entry.kind, itemId: entry.itemId, position: index,
      })));
    }
  });

  return { stored, refused };
}

export type ShowcaseCard = {
  kind: ShowcaseItemKind;
  itemId: number;
  position: number;
  title: string;
  subtitle: string | null;
  image: string | null;
  href: string;
};

/**
 * The showcase as a STOREFRONT renders it.
 *
 * `includeUnavailable` is false for the public and true for the owner. A
 * product withdrawn after it was showcased disappears from the visitor's view
 * - it must, there is nothing to link to - but the owner is TOLD, because a
 * page that quietly shortens teaches its owner nothing about why (§10, and
 * the same rule the saved shortlist follows).
 */
export async function listShowcase(
  db: Db, supplierId: number, options: { includeUnavailable?: boolean } = {},
): Promise<{ cards: ShowcaseCard[]; unavailable: number }> {
  const rows = await db.select({
    itemKind: supplierShowcase.itemKind,
    itemId: supplierShowcase.itemId,
    position: supplierShowcase.position,
  }).from(supplierShowcase)
    .where(eq(supplierShowcase.userId, supplierId))
    .orderBy(asc(supplierShowcase.position))
    .limit(MAX_SHOWCASE_ITEMS);

  const idsOf = (kind: ShowcaseItemKind) => rows
    .filter((row: any) => row.itemKind === kind).map((row: any) => Number(row.itemId));

  const [productRows, serviceRows, portfolioRows] = await Promise.all([
    idsOf('product').length === 0 ? [] : db.select({
      id: products.id, name: products.name, nameAr: products.nameAr,
      category: products.category, images: products.images,
    }).from(products).where(and(
      inArray(products.id, idsOf('product')),
      eq(products.supplierId, supplierId),
      // RE-CHECKED ON READ, not trusted from the write. A product archived
      // after it was showcased must leave the storefront the moment it is
      // archived, without anything having to run.
      publicProductFilter(),
    )),
    idsOf('service').length === 0 ? [] : db.select({
      id: serviceOfferings.id, title: serviceOfferings.title,
      description: serviceOfferings.description,
    }).from(serviceOfferings).where(and(
      inArray(serviceOfferings.id, idsOf('service')),
      eq(serviceOfferings.providerId, supplierId),
      eq(serviceOfferings.status, 'active'),
    )),
    idsOf('portfolio').length === 0 ? [] : db.select({
      id: portfolioItems.id, title: portfolioItems.title,
      location: portfolioItems.location, images: portfolioItems.images,
    }).from(portfolioItems).where(and(
      inArray(portfolioItems.id, idsOf('portfolio')),
      eq(portfolioItems.userId, supplierId),
    )),
  ]);

  const products_ = new Map<number, any>(productRows.map((row: any) => [Number(row.id), row]));
  const services_ = new Map<number, any>(serviceRows.map((row: any) => [Number(row.id), row]));
  const portfolio_ = new Map<number, any>(portfolioRows.map((row: any) => [Number(row.id), row]));

  const cards: ShowcaseCard[] = [];
  let unavailable = 0;
  for (const row of rows as any[]) {
    const itemId = Number(row.itemId);
    const position = Number(row.position);
    if (row.itemKind === 'product') {
      const found = products_.get(itemId);
      if (!found) { unavailable++; continue; }
      cards.push({
        kind: 'product', itemId, position,
        title: String(found.name ?? ''),
        subtitle: found.category ?? null,
        image: firstImage(found.images),
        href: `/marketplace/products/${itemId}`,
      });
    } else if (row.itemKind === 'service') {
      const found = services_.get(itemId);
      if (!found) { unavailable++; continue; }
      cards.push({
        kind: 'service', itemId, position,
        title: String(found.title ?? ''),
        subtitle: found.description ? String(found.description).slice(0, 120) : null,
        image: null,
        href: `/vendor/${supplierId}#services`,
      });
    } else {
      const found = portfolio_.get(itemId);
      if (!found) { unavailable++; continue; }
      cards.push({
        kind: 'portfolio', itemId, position,
        title: String(found.title ?? ''),
        subtitle: found.location ?? null,
        image: firstImage(found.images),
        href: `/vendor/${supplierId}#portfolio`,
      });
    }
  }

  return {
    cards,
    // The public is not told how many were dropped: it is not their business
    // and it would leak how much unpublished stock a supplier holds.
    unavailable: options.includeUnavailable ? unavailable : 0,
  };
}

/**
 * WHAT THIS SUPPLIER IS ALLOWED TO SHOWCASE.
 *
 * One reader rather than three role-gated queries stitched together in the
 * browser. `products.myProducts` is supplier-only, `services.mine` sits
 * behind the compliance gate and `portfolio.list` behind neither - so a
 * client assembling the candidate list from those three would show an
 * architect their portfolio and silently omit their services, and the
 * omission would look like "you have none".
 *
 * It returns exactly the set the WRITER accepts, computed by the same
 * ownership-and-visibility rule. A candidate list that offers something the
 * writer will refuse is a form that fails on submit for no visible reason.
 */
export async function listShowcaseCandidates(db: Db, userId: number): Promise<ShowcaseCard[]> {
  const [productRows, serviceRows, portfolioRows] = await Promise.all([
    db.select({ id: products.id, name: products.name, category: products.category, images: products.images })
      .from(products).where(and(eq(products.supplierId, userId), publicProductFilter())).limit(200),
    db.select({ id: serviceOfferings.id, title: serviceOfferings.title, description: serviceOfferings.description })
      .from(serviceOfferings).where(and(eq(serviceOfferings.providerId, userId), eq(serviceOfferings.status, 'active'))).limit(200),
    db.select({ id: portfolioItems.id, title: portfolioItems.title, location: portfolioItems.location, images: portfolioItems.images })
      .from(portfolioItems).where(eq(portfolioItems.userId, userId)).limit(200),
  ]);

  return [
    ...productRows.map((row: any): ShowcaseCard => ({
      kind: 'product', itemId: Number(row.id), position: 0,
      title: String(row.name ?? ''), subtitle: row.category ?? null,
      image: firstImage(row.images), href: `/marketplace/products/${row.id}`,
    })),
    ...serviceRows.map((row: any): ShowcaseCard => ({
      kind: 'service', itemId: Number(row.id), position: 0,
      title: String(row.title ?? ''),
      subtitle: row.description ? String(row.description).slice(0, 120) : null,
      image: null, href: `/vendor/${userId}#services`,
    })),
    ...portfolioRows.map((row: any): ShowcaseCard => ({
      kind: 'portfolio', itemId: Number(row.id), position: 0,
      title: String(row.title ?? ''), subtitle: row.location ?? null,
      image: firstImage(row.images), href: `/vendor/${userId}#portfolio`,
    })),
  ];
}

/** Images are a JSON text column and may arrive parsed or not, or malformed. */
function firstImage(raw: unknown): string | null {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && typeof (first as any).url === 'string') return (first as any).url;
  return null;
}
