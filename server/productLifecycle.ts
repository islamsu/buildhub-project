/**
 * ── THE PRODUCT LIFECYCLE, SERVER SIDE ────────────────────────────────────
 *
 * ONE DEFINITION OF "A BUYER CAN SEE THIS" - `publicProductFilter()` - and one
 * place where a status changes - `transitionProduct()`. The pair exists for
 * the reason the reviews work established: a visibility rule spelled out
 * inline at each reader drifts the moment the rule gains a second clause, and
 * `products.active` was already read inline in eleven places.
 *
 * THE LEGACY BOOLEAN. `products.active` is kept for one migration so the 0049
 * backfill stays reversible by inspection. It is written HERE and nowhere
 * else, derived from the status, so the two cannot disagree. The census in
 * productLifecycle.test.ts holds every other module to that.
 *
 * NO DELETE. A product id appears in questions, quotations, placements and
 * audit events. Retiring a product archives it; the row and its history stay.
 */
import { and, eq } from 'drizzle-orm';
import { products, vendorSponsorships } from '../drizzle/schema';
import {
  PRODUCT_PUBLIC_STATUS, activeFromStatus, canTransitionProduct,
  productStatusLabel, type ProductStatus,
} from '../shared/productLifecycle';
import { recordCommercialEvent } from './_core/commercialAudit';
import { recordFieldChange } from './audit/fieldHistory';
import { livePlacementFilter } from './publicPlacement';

type Db = any;

export class ProductLifecycleError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT', message: string) {
    super(message);
  }
}

/**
 * THE ONE VISIBILITY RULE for every public read of the products table.
 *
 * Draft has never been published, inactive has been withdrawn, archived is
 * retired. A boolean could not tell those apart, so `active = 0` was the only
 * thing eleven readers could ask for; now they all ask this.
 */
export function publicProductFilter() {
  return eq(products.status, PRODUCT_PUBLIC_STATUS);
}

/**
 * Move a product between lifecycle states.
 *
 * The transition is checked against the declared table, not assumed from the
 * call site, and the refusal names BOTH states - "cannot go from archived to
 * active" tells a supplier what to do next, where "invalid status" does not.
 *
 * ARCHIVING A SPONSORED PRODUCT IS REFUSED rather than silently accepted. A
 * live commercial placement points at this row and `publicPlacement` filters
 * on the same status, so archiving would leave a paid slot rendering nothing
 * while the vendor's entitlement went on being consumed. The supplier is told
 * to end the placement first; that is a real answer, and quietly breaking a
 * paid placement is not.
 */
export async function transitionProduct(db: Db, params: {
  productId: number; supplierId: number; to: ProductStatus; actorIsAdmin?: boolean;
}): Promise<{ ok: true; from: ProductStatus; to: ProductStatus }> {
  const [product] = await db.select({
    id: products.id, supplierId: products.supplierId, status: products.status,
  }).from(products).where(eq(products.id, params.productId)).limit(1);

  if (!product) throw new ProductLifecycleError('NOT_FOUND', 'Product not found');
  if (!params.actorIsAdmin && product.supplierId !== params.supplierId) {
    // NOT FOUND rather than FORBIDDEN: confirming a product id belongs to
    // somebody else lets a competitor's catalogue be walked.
    throw new ProductLifecycleError('NOT_FOUND', 'Product not found');
  }

  const from = product.status as ProductStatus;
  if (from === params.to) {
    throw new ProductLifecycleError('BAD_REQUEST', `This product is already ${productStatusLabel(params.to, 'en')}.`);
  }
  if (!canTransitionProduct(from, params.to)) {
    throw new ProductLifecycleError(
      'BAD_REQUEST',
      `A product cannot go from ${productStatusLabel(from, 'en')} to ${productStatusLabel(params.to, 'en')}.`,
    );
  }

  if (params.to === 'archived') {
    const [sponsored] = await db.select({ id: vendorSponsorships.id })
      .from(vendorSponsorships)
      .where(and(
        eq(vendorSponsorships.productId, params.productId),
        // ONE definition of "live", imported rather than restated - see the
        // note on livePlacementFilter.
        livePlacementFilter(new Date()),
      )).limit(1);
    if (sponsored) {
      throw new ProductLifecycleError(
        'CONFLICT',
        'This product has a live placement. End the placement before archiving it, or the paid slot would render nothing.',
      );
    }
  }

  const now = new Date();
  await db.update(products).set({
    status: params.to,
    statusChangedAt: now,
    archivedAt: params.to === 'archived' ? now : null,
    // THE LEGACY BOOLEAN, written here and nowhere else.
    active: activeFromStatus(params.to),
  }).where(eq(products.id, params.productId));

  // A status change without its previous value cannot answer "was this live
  // when the customer says they saw it".
  await recordFieldChange(db, {
    subjectType: 'product', subjectId: params.productId,
    ownerId: product.supplierId, actorId: params.supplierId,
    field: 'status', oldValue: from, newValue: params.to,
  });
  await recordCommercialEvent(db, {
    actorId: params.supplierId, ownerId: product.supplierId,
    subjectType: 'product', subjectId: params.productId,
    action: commercialActionFor(params.to),
    detail: `${from} → ${params.to}`,
  });

  return { ok: true, from, to: params.to };
}

/**
 * The four states map onto the existing commercial vocabulary rather than
 * growing it: publishing is `product_published` whatever it was published
 * from, and everything that takes a product off the marketplace is a
 * delisting, distinguished by the `detail` which carries both states.
 */
function commercialActionFor(to: ProductStatus) {
  return to === PRODUCT_PUBLIC_STATUS ? 'product_published' as const : 'product_delisted' as const;
}
