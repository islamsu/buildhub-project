/**
 * ── EDITORIAL FEATURED PRODUCTS, AS A READER ──────────────────────────────
 *
 * `products.featured` has existed for a long time and did exactly one thing:
 * it broke ties in the catalogue's ORDER BY. A product BuildHub had
 * deliberately chosen appeared a little higher in a list and nowhere else, so
 * the editorial decision was invisible to the person it was made for.
 *
 * This is the reader that gives it a surface, and it is deliberately the
 * mirror of listFeaturedProviders:
 *
 *   EDITORIAL, NEVER COMMERCIAL. A Premium plan cannot produce a row here and
 *   a paid placement is never rendered under the Featured label. The paid
 *   routes are masterProduct and spotlightProducts, and they stay separate -
 *   the whole point of the two labels is that a reader can tell which is
 *   which.
 *
 *   THE CATALOGUE'S OWN VISIBILITY RULE, not a second one. publicProductFilter
 *   is the same filter the catalogue uses, so a product that is archived, a
 *   draft or off sale cannot appear in a premium slot after it has vanished
 *   from the list beneath it.
 *
 *   NOTHING IS INVENTED WHEN THERE IS NOTHING. An empty array, and the screen
 *   renders no heading - never a placeholder, because a fabricated editorial
 *   pick is a claim BuildHub made about a supplier it did not choose.
 */
import { and, desc, eq } from 'drizzle-orm';
import { products, users } from '../drizzle/schema';
import { requireDb } from './_core/requireDb';
import { publicProductFilter } from './productLifecycle';

export type FeaturedProduct = {
  id: number;
  name: string;
  nameAr: string | null;
  brand: string | null;
  category: string | null;
  price: string | null;
  currency: string | null;
  unit: string | null;
  images: string | null;
  supplierId: number | null;
  /**
   * WHO SELLS IT. A premium product card that does not name its supplier is
   * an advertisement for a thing rather than an introduction to a business,
   * and a buyer comparing two lamps is comparing two companies.
   */
  supplierName: string | null;
};

/**
 * @param category when given, only products in it - which is what makes the
 * same editorial pick appear in its own category experience as well as on the
 * marketplace home, and what stops a Lighting pick surfacing under Tiles.
 */
export async function listFeaturedProducts(
  filters: { category?: string; limit?: number } = {},
): Promise<FeaturedProduct[]> {
  const db = await requireDb();
  const limit = Math.min(Math.max(filters.limit ?? 8, 1), 24);

  const conditions = [publicProductFilter(), eq(products.featured, true)];
  if (filters.category && filters.category !== 'All') {
    conditions.push(eq(products.category, filters.category));
  }

  const rows = await db.select({
    id: products.id,
    name: products.name,
    nameAr: products.nameAr,
    brand: products.brand,
    category: products.category,
    price: products.price,
    currency: products.currency,
    unit: products.unit,
    images: products.images,
    supplierId: products.supplierId,
    supplierName: users.name,
  }).from(products)
    .leftJoin(users, eq(users.id, products.supplierId))
    .where(and(...conditions))
    // Newest deliberate pick first. Ties broken by id so the order is stable
    // between two requests - a premium strip that reshuffles on refresh reads
    // as randomness rather than as a decision.
    .orderBy(desc(products.createdAt), desc(products.id))
    .limit(limit);

  return rows as FeaturedProduct[];
}
