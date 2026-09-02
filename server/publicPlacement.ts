/**
 * ── PUBLIC COMMERCIAL PLACEMENT: WHAT A VISITOR ACTUALLY SEES ─────────────
 *
 * server/placementBooking.ts decides what MAY be sold. This file decides what
 * is RENDERED, and they are deliberately different questions: a placement that
 * was validly booked six months ago must stop appearing the moment it expires,
 * the moment it is revoked, and the moment its target stops being eligible -
 * without anything having to run overnight to notice.
 *
 * THREE RULES GOVERN EVERY QUERY HERE.
 *
 * 1. TIME IS DERIVED, NEVER SWEPT. A row is live only if it is not revoked,
 *    has started, and has not ended, evaluated against `now` at read time.
 *    Scheduled placements are invisible early; expired ones vanish on their
 *    own. Nothing needs a cron job, so nothing breaks when one does not run.
 *
 * 2. A PLACEMENT BUYS A SLOT, NEVER AN EXEMPTION. Target eligibility is
 *    re-checked at render time against the SAME filters the organic listings
 *    use - `directoryVisibilityFilter` for providers, published-and-eligible
 *    for products. A suspended provider with a paid Master booking renders
 *    nothing. This is why those filters are imported rather than restated:
 *    two copies of an eligibility rule is how one of them ends up laxer.
 *
 * 3. SCOPE IS MATCHED EXACTLY. A placement bought for "Lighting" does not
 *    appear under "Tiles", and a platform-wide GLOBAL placement does not leak
 *    into a category view. Paid visibility never defeats relevance.
 */
import { and, asc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { products, users, vendorSponsorships } from '../drizzle/schema';
import { getDb } from './db';
import {
  DIRECTORY_VENDOR_COLUMNS,
  directoryVisibilityFilter,
  enrichVendorRows,
  type DirectoryVendor,
} from './vendorDirectory';
import { GLOBAL_PLACEMENT_SCOPE, placementLabel, type PlacementLabel } from '@shared/placement';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type PlacementSurface = 'MASTER_DISCOVERY' | 'TYPE_CATEGORY_SPOTLIGHT' | 'SEARCH_RESULTS_BOOST';
export type PlacementEntityType = 'PROVIDER' | 'PRODUCT';

/**
 * How many entities each surface may show at once.
 *
 * MASTER is one, by definition - it is the exclusive slot Premier buys.
 * SPOTLIGHT's three is a commercial target, not a law of nature, which is why
 * it is a named constant the owner can move rather than a literal buried in a
 * query. It matches the capacity the booking engine enforces at sale time; if
 * the two ever disagree, oversold inventory renders as a truncated block
 * rather than an overfull one - fail-closed, in the buyer's favour.
 */
export const SURFACE_CAPACITY: Record<PlacementSurface, number> = {
  MASTER_DISCOVERY: 1,
  TYPE_CATEGORY_SPOTLIGHT: 3,
  SEARCH_RESULTS_BOOST: 12,
};

/** Not revoked · already started · not yet ended. Evaluated at read time. */
function livePlacementFilter(now: Date) {
  return and(
    isNull(vendorSponsorships.revokedAt),
    lte(vendorSponsorships.startsAt, now),
    or(isNull(vendorSponsorships.endsAt), gt(vendorSponsorships.endsAt, now)),
  );
}

export type PlacementRow = {
  placementId: number;
  entityId: number;
  entityType: PlacementEntityType;
  surface: PlacementSurface;
  source: string;
  package: string | null;
  category: string;
  priority: number;
  label: PlacementLabel;
};

/**
 * The live placement ROWS for one surface and scope - ids and commercial
 * metadata only, no entity content yet.
 *
 * Split from the entity fetch on purpose. The rows say who was BOOKED; the
 * fetch decides who is ELIGIBLE. Keeping them separate is what makes rule 2
 * above structurally true instead of a comment: this function cannot return a
 * renderable entity, so no caller can accidentally render one that the
 * visibility filter would have dropped.
 */
export async function livePlacementRows(params: {
  db: Db;
  surface: PlacementSurface;
  entityType: PlacementEntityType;
  /** The exact scope. Use GLOBAL_PLACEMENT_SCOPE for platform-wide surfaces. */
  category: string;
  now?: Date;
}): Promise<PlacementRow[]> {
  const now = params.now ?? new Date();
  const rows = await params.db
    .select({
      placementId: vendorSponsorships.id,
      vendorId: vendorSponsorships.vendorId,
      productId: vendorSponsorships.productId,
      entityType: vendorSponsorships.entityType,
      surface: vendorSponsorships.surface,
      source: vendorSponsorships.source,
      package: vendorSponsorships.package,
      category: vendorSponsorships.category,
      priority: vendorSponsorships.priority,
    })
    .from(vendorSponsorships)
    .where(and(
      eq(vendorSponsorships.surface, params.surface),
      eq(vendorSponsorships.entityType, params.entityType),
      // Exact scope. No wildcard, no fallback - see rule 3.
      eq(vendorSponsorships.category, params.category),
      livePlacementFilter(now),
    ))
    // Lower priority value first, then the oldest booking - so a commercial
    // ordering decision is honoured, and ties resolve to whoever bought first
    // rather than to whatever order the database felt like returning.
    .orderBy(asc(vendorSponsorships.priority), asc(vendorSponsorships.createdAt));

  const seen = new Set<number>();
  const out: PlacementRow[] = [];
  for (const row of rows as (Omit<PlacementRow, 'entityId' | 'label' | 'entityType' | 'surface'> & {
    vendorId: number | null; productId: number | null; entityType: string; surface: string;
  })[]) {
    const entityId = params.entityType === 'PROVIDER' ? row.vendorId : row.productId;
    if (entityId == null) continue;   // a malformed row is skipped, never rendered
    // Two overlapping bookings for the same entity are an administrative
    // untidiness, not two slots.
    if (seen.has(entityId)) continue;
    seen.add(entityId);
    out.push({
      placementId: row.placementId,
      entityId,
      entityType: params.entityType,
      surface: params.surface,
      source: row.source,
      package: row.package,
      category: row.category,
      priority: row.priority,
      label: placementLabel(row.source),
    });
  }
  return out;
}

export type PlacedProvider = DirectoryVendor & {
  placementId: number;
  label: PlacementLabel;
  placementCategory: string;
};

/**
 * Providers holding a live placement on one surface and scope, ALREADY
 * filtered to those a visitor is allowed to see.
 *
 * Ordering follows the booking, not the database: the ids come back in
 * commercial order and the enriched rows are re-sorted into it, because
 * `inArray` makes no promise about order and a Premier advertiser must not
 * land second because MySQL felt like it.
 */
export async function placedProviders(params: {
  db: Db;
  surface: PlacementSurface;
  category: string;
  now?: Date;
  limit?: number;
}): Promise<PlacedProvider[]> {
  const rows = await livePlacementRows({ ...params, entityType: 'PROVIDER' });
  if (rows.length === 0) return [];

  const eligible = await params.db
    .select(DIRECTORY_VENDOR_COLUMNS)
    .from(users)
    // The organic directory's own filter. A placement cannot widen it.
    .where(and(directoryVisibilityFilter(), inArray(users.id, rows.map(row => row.entityId))));
  const enriched = await enrichVendorRows(params.db, eligible as { id: number }[]);
  const byId = new Map(enriched.map(vendor => [vendor.id, vendor]));

  const capacity = params.limit ?? SURFACE_CAPACITY[params.surface];
  const out: PlacedProvider[] = [];
  for (const row of rows) {
    const vendor = byId.get(row.entityId);
    if (!vendor) continue;            // booked but no longer eligible: dropped
    out.push({ ...vendor, placementId: row.placementId, label: row.label, placementCategory: row.category });
    if (out.length >= capacity) break;
  }
  return out;
}

/**
 * The product columns a public placement may carry.
 *
 * An allowlist rather than `select()`: the placement response is public and
 * unauthenticated, and `select()` would hand every future column to anonymous
 * readers the day somebody adds one. Cost, margin and internal notes are
 * exactly the kind of column a catalogue table grows.
 */
export const PLACEMENT_PRODUCT_COLUMNS = {
  id: products.id,
  supplierId: products.supplierId,
  name: products.name,
  nameAr: products.nameAr,
  category: products.category,
  brand: products.brand,
  origin: products.origin,
  price: products.price,
  currency: products.currency,
  unit: products.unit,
  images: products.images,
} as const;

export type PlacedProduct = {
  id: number;
  supplierId: number;
  name: string;
  nameAr: string | null;
  category: string;
  brand: string | null;
  origin: string | null;
  price: string | null;
  currency: string | null;
  unit: string | null;
  images: string | null;
  /** The real seller's display name, so a card can say who sells it. */
  supplierName: string | null;
  placementId: number;
  label: PlacementLabel;
  placementCategory: string;
};

/**
 * Products holding a live placement, filtered to those a visitor may see.
 *
 * TWO eligibility gates, not one. The product must be active - and its
 * SUPPLIER must still be an eligible provider. A supplier who is suspended
 * keeps rows in `products` with `active = 1`, and without the join a paid
 * placement would go on advertising a seller the marketplace has withdrawn.
 * That is precisely the "paid placement bypasses a safety gate" case, so the
 * join is inner and the filter is the directory's own.
 */
export async function placedProducts(params: {
  db: Db;
  surface: PlacementSurface;
  category: string;
  now?: Date;
  limit?: number;
}): Promise<PlacedProduct[]> {
  const rows = await livePlacementRows({ ...params, entityType: 'PRODUCT' });
  if (rows.length === 0) return [];

  const eligible = await params.db
    .select({ ...PLACEMENT_PRODUCT_COLUMNS, supplierName: users.name })
    .from(products)
    .innerJoin(users, eq(users.id, products.supplierId))
    .where(and(
      eq(products.active, true),
      directoryVisibilityFilter(),
      inArray(products.id, rows.map(row => row.entityId)),
    ));
  const byId = new Map((eligible as (Omit<PlacedProduct, 'placementId' | 'label' | 'placementCategory'>)[])
    .map(product => [product.id, product]));

  const capacity = params.limit ?? SURFACE_CAPACITY[params.surface];
  const out: PlacedProduct[] = [];
  for (const row of rows) {
    const product = byId.get(row.entityId);
    if (!product) continue;
    out.push({ ...product, placementId: row.placementId, label: row.label, placementCategory: row.category });
    if (out.length >= capacity) break;
  }
  return out;
}

/**
 * THE MASTER SLOT: one provider, or none.
 *
 * `category` is the scope. Omitted means the platform-wide GLOBAL scope, which
 * is what provider discovery shows before a visitor picks a type. Returns null
 * rather than a substitute when nothing is booked or nothing booked is
 * eligible - the surface collapses, and no placeholder advertiser is invented
 * to fill it.
 */
export async function masterProvider(category?: string, now?: Date): Promise<PlacedProvider | null> {
  const db = await getDb();
  if (!db) return null;
  const found = await placedProviders({
    db, surface: 'MASTER_DISCOVERY', category: category || GLOBAL_PLACEMENT_SCOPE, now, limit: 1,
  });
  return found[0] ?? null;
}

/** The Master product slot. Same rule, same honesty about emptiness. */
export async function masterProduct(category?: string, now?: Date): Promise<PlacedProduct | null> {
  const db = await getDb();
  if (!db) return null;
  const found = await placedProducts({
    db, surface: 'MASTER_DISCOVERY', category: category || GLOBAL_PLACEMENT_SCOPE, now, limit: 1,
  });
  return found[0] ?? null;
}
