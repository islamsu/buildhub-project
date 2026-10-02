/**
 * ── PUBLIC MARKETPLACE ELIGIBILITY: THE ONE AUTHORITY ─────────────────────
 *
 * A product on a public RAKIZA surface is a commercial offer made by a
 * business. Two independent things have to be true before a visitor may see
 * it, and the second one is the one that keeps getting forgotten:
 *
 *   THE OFFER      publicProductFilter() - published, not a draft, not off
 *                  sale, not archived. Owned by server/productLifecycle.ts.
 *   THE SELLER     directoryVisibilityFilter() - a provider role, account
 *                  active, not deactivated, onboarding approved, and (outside
 *                  test-login builds) not a dummy account. Owned by
 *                  server/vendorDirectory.ts.
 *
 * Neither definition is restated here. This module's whole job is the AND.
 *
 * ── WHY THE SELLER GATE KEEPS GOING MISSING ───────────────────────────────
 *
 * Because suspending a seller changes nothing about their products. Every row
 * in `products` reads exactly as it did the day before: status 'active',
 * priced, categorised, images attached. Nothing about the product says its
 * business is gone, so a reader that asks only about the product gets a
 * confident yes - and goes on offering the catalogue of a company the
 * marketplace has withdrawn.
 *
 * It had already gone missing twice, in opposite directions. The promotional
 * surfaces disagreed with each other: `placedProducts` joined the directory
 * and `listFeaturedProducts` did not, so freezing a supplier silenced their
 * Sponsored slot and left their Featured slot advertising them. Fixing that
 * exposed the larger one - the ORGANIC catalogue, the public storefront
 * inventory, the sitemap, the homepage product count and the category counts
 * all asked only about the product, which made the promoted strips stricter
 * than the listings beneath them.
 *
 * ── WHY THIS IS A SUBQUERY AND NOT A JOIN ─────────────────────────────────
 *
 * This is the design decision in the file, so it is worth being explicit.
 *
 * The seller's clauses live on `users`, so expressing them as a join makes
 * every call site responsible for adding that join - and for making it INNER,
 * because a LEFT join leaves them filtering nothing. That is a footgun with a
 * silent failure mode: the predicate looks present, the query looks right, and
 * the gate does nothing. It is exactly how the Featured surface came to have a
 * `leftJoin(users)` beside a filter that could not use it.
 *
 * So the gate carries its own reach. `products.supplierId IN (SELECT ...)` is
 * one SQL statement, no join obligation, no shape change at the call site, and
 * nothing to remember. A reader adds this predicate and is correct; a reader
 * that forgets it is visibly missing a named function rather than invisibly
 * missing a join clause.
 *
 * It also means readers may still join `users` for the seller's NAME - several
 * do - without that join being load-bearing for eligibility. Those are now
 * independent concerns, and a test pins that they stay independent.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 *
 * Not subscription, billing, plan, entitlement, placement, market interest,
 * legal country or GCC market approval. Public listing eligibility is the
 * directory's existing rule and nothing else; a paid plan does not buy
 * visibility and an unpaid one does not remove it.
 */
import { and, inArray } from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/mysql-core';
import { products, users } from '../drizzle/schema';
import { publicProductFilter } from './productLifecycle';
import { directoryVisibilityFilter } from './vendorDirectory';

/**
 * The ids of providers the public directory lists.
 *
 * Built with Drizzle's standalone QueryBuilder so the predicate needs no
 * database handle - `publicMarketplaceProductFilter()` then reads exactly like
 * `publicProductFilter()` at every call site, which is the point: a gate that
 * is awkward to apply gets left out.
 */
export function eligibleSellerIds() {
  return new QueryBuilder().select({ id: users.id }).from(users).where(directoryVisibilityFilter());
}

/**
 * PUBLIC MARKETPLACE PRODUCT ELIGIBILITY.
 *
 *   PRODUCT STATE ELIGIBILITY + SELLER PUBLIC ELIGIBILITY
 *
 * The authority for every public product read: catalogue, search, category
 * listings, public storefront inventory, product detail, counts, sitemap and
 * public metadata. Promotional surfaces compose it rather than restating it -
 * see publiclyPromotableProductFilter in server/publicPlacement.ts.
 *
 * COMPOSED, NEVER COPIED. The two dimensions stay separate everywhere else: a
 * suspended seller's products keep their own lifecycle state and their own
 * history, and when the seller is reinstated an otherwise-eligible product
 * becomes visible again with no status rewritten. Hiding a product by
 * archiving it would be destroying one dimension to express the other.
 */
export function publicMarketplaceProductFilter() {
  return and(publicProductFilter(), inArray(products.supplierId, eligibleSellerIds()));
}
