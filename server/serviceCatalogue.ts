/**
 * ── THE SERVICE CATALOGUE, SERVER SIDE ────────────────────────────────────
 *
 * The same two-function shape the product lifecycle settled on, for the same
 * reason: ONE definition of "a customer can see this"
 * (`publicServiceFilter()`), and ONE place a status changes
 * (`transitionService()`). A visibility rule spelled out inline at each reader
 * drifts the moment it gains a second clause, and this one HAS a second clause
 * from the first day - see below.
 *
 * TWO CLAUSES, NOT ONE. A live service needs the offering to be active AND the
 * provider to be approved. A product only ever needed the first, because a
 * supplier's catalogue is goods; a service is a person turning up at your home
 * to do structural work, and advertising one from an account BuildHub has not
 * finished vetting is the kind of thing a marketplace gets held responsible
 * for. The provider clause is a join, so it lives in `visibleServicesFor` and
 * `publicServiceFilter` is documented as the offering half only - stated here
 * rather than left for a reader to discover.
 *
 * NO DELETE, for the reason products have none: an offering id will appear in
 * enquiries and audit events. Retiring archives it.
 */
import { and, eq, isNull, or, inArray } from 'drizzle-orm';
import { serviceOfferings, productCategories, users } from '../drizzle/schema';
import {
  SERVICE_PUBLIC_STATUS, SERVICE_TRANSITIONS, SERVICE_TITLE_MAX,
  SERVICE_DESCRIPTION_MAX, SERVICE_PRICE_MAX, SERVICE_LEAD_TIME_DAYS_MAX,
  SERVICE_WARRANTY_MONTHS_MAX, basisAcceptsPrice, DEFAULT_PRICING_BASIS,
  type ServiceStatus, type ServicePricingBasis,
} from '../shared/serviceCatalogue';
import { recordCommercialEvent } from './_core/commercialAudit';

type Db = any;

export class ServiceCatalogueError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN', message: string) {
    super(message);
    this.name = 'ServiceCatalogueError';
  }
}

/**
 * THE OFFERING HALF of the visibility rule. Draft was never published,
 * inactive was withdrawn, archived is retired.
 *
 * The PROVIDER half - the account must be approved - is a join and cannot live
 * in a column predicate. Every public reader must apply both; `visibleServices`
 * below does, and is what readers should call.
 */
export function publicServiceFilter() {
  return eq(serviceOfferings.status, SERVICE_PUBLIC_STATUS);
}

/** The provider half, as its own named rule so no reader invents a third one. */
export function approvedProviderFilter() {
  return eq(users.onboardingStatus, 'approved');
}

/**
 * A category may carry services only if an administrator scoped it to.
 *
 * SERVICE or BOTH, never PRODUCT: filing "bathroom waterproofing" under
 * "Cement & Concrete" would put a trade in the shopper's goods browse and a bag
 * of cement in the trades directory. `hidden` and `archived` categories are
 * refused for a NEW listing while leaving existing listings alone - retiring a
 * category must not invalidate work already published against it.
 */
export async function assertCategoryAcceptsServices(db: Db, categoryId: number): Promise<void> {
  const [row] = await db
    .select({ id: productCategories.id, scope: productCategories.scope, status: productCategories.status })
    .from(productCategories)
    .where(eq(productCategories.id, categoryId))
    .limit(1);
  if (!row) throw new ServiceCatalogueError('NOT_FOUND', 'That category does not exist.');
  if (row.scope === 'PRODUCT') {
    throw new ServiceCatalogueError('BAD_REQUEST',
      'That category is for products. Choose a service category.');
  }
  if (row.status !== 'active') {
    throw new ServiceCatalogueError('BAD_REQUEST',
      'That category is no longer open for new listings.');
  }
}

/**
 * THE PRICING COHERENCE RULE, in one place because both create and edit need
 * exactly it.
 *
 * "Quote on request" with a price beside it tells the customer two different
 * things and they will believe the number - so the figure is REFUSED rather
 * than dropped. A dropped field is a provider who thinks they published a rate
 * and did not.
 *
 * And a maximum below the minimum is refused rather than swapped: silently
 * reordering somebody's price range is a guess about which of the two numbers
 * they meant.
 */
export function validatePricing(input: {
  pricingBasis: ServicePricingBasis;
  priceMin?: number | null;
  priceMax?: number | null;
}): { priceMin: number | null; priceMax: number | null } {
  const min = input.priceMin ?? null;
  const max = input.priceMax ?? null;
  if (!basisAcceptsPrice(input.pricingBasis)) {
    if (min !== null || max !== null) {
      throw new ServiceCatalogueError('BAD_REQUEST',
        'Quote on request cannot carry a price. Choose a pricing basis, or remove the figures.');
    }
    return { priceMin: null, priceMax: null };
  }
  for (const [label, value] of [['minimum', min], ['maximum', max]] as const) {
    if (value === null) continue;
    if (!Number.isFinite(value) || value < 0) {
      throw new ServiceCatalogueError('BAD_REQUEST', `The ${label} price must be a positive amount.`);
    }
    if (value > SERVICE_PRICE_MAX) {
      throw new ServiceCatalogueError('BAD_REQUEST', `The ${label} price is implausibly large.`);
    }
  }
  if (min !== null && max !== null && max < min) {
    throw new ServiceCatalogueError('BAD_REQUEST',
      'The maximum price is below the minimum.');
  }
  return { priceMin: min, priceMax: max };
}

/** Lead time and warranty are optional facts, but not arbitrary ones. */
export function validateCommitments(input: { leadTimeDays?: number | null; warrantyMonths?: number | null }): void {
  const lead = input.leadTimeDays ?? null;
  const warranty = input.warrantyMonths ?? null;
  if (lead !== null && (!Number.isInteger(lead) || lead < 0 || lead > SERVICE_LEAD_TIME_DAYS_MAX)) {
    throw new ServiceCatalogueError('BAD_REQUEST', 'The lead time must be between 0 and 365 days.');
  }
  if (warranty !== null && (!Number.isInteger(warranty) || warranty < 0 || warranty > SERVICE_WARRANTY_MONTHS_MAX)) {
    throw new ServiceCatalogueError('BAD_REQUEST', 'The warranty must be between 0 and 600 months.');
  }
}

/**
 * Load one offering AS ITS OWNER.
 *
 * A service belonging to somebody else is NOT_FOUND, not FORBIDDEN: telling a
 * stranger that offering 412 exists but is not theirs is a row-existence oracle
 * over every provider's unpublished drafts.
 */
export async function requireOwnedService(db: Db, serviceId: number, providerId: number) {
  const [row] = await db.select().from(serviceOfferings).where(eq(serviceOfferings.id, serviceId)).limit(1);
  if (!row || row.providerId !== providerId) {
    throw new ServiceCatalogueError('NOT_FOUND', 'That service does not exist.');
  }
  return row;
}

/** Is this move declared? Shares the product transition table - see shared/. */
export const canTransitionService = (from: ServiceStatus, to: ServiceStatus): boolean =>
  (SERVICE_TRANSITIONS[from] ?? []).includes(to);

/**
 * Move a service between lifecycle states.
 *
 * The refusal names BOTH states, because "cannot go from archived to active"
 * tells a provider what to do next and "invalid status" does not.
 */
export async function transitionService(
  db: Db,
  params: { serviceId: number; providerId: number; to: ServiceStatus },
): Promise<{ from: ServiceStatus; to: ServiceStatus }> {
  const row = await requireOwnedService(db, params.serviceId, params.providerId);
  const from = row.status as ServiceStatus;
  if (from === params.to) return { from, to: params.to };
  if (!canTransitionService(from, params.to)) {
    throw new ServiceCatalogueError('CONFLICT',
      `A service cannot go from ${from} to ${params.to}.`);
  }
  // PUBLISHING IS A CLAIM MADE IN PUBLIC, so it is refused while the account is
  // still being vetted. Draft and edit stay open throughout - a provider
  // waiting on approval can prepare their catalogue, which is the whole point
  // of draft existing.
  if (params.to === SERVICE_PUBLIC_STATUS) {
    const [provider] = await db
      .select({ onboardingStatus: users.onboardingStatus })
      .from(users).where(eq(users.id, params.providerId)).limit(1);
    if (provider?.onboardingStatus !== 'approved') {
      throw new ServiceCatalogueError('FORBIDDEN',
        'Your registration must be approved before you can publish a service.');
    }
  }
  await db.update(serviceOfferings).set({
    status: params.to,
    statusChangedAt: new Date(),
    archivedAt: params.to === 'archived' ? new Date() : null,
  }).where(eq(serviceOfferings.id, params.serviceId));

  await recordCommercialEvent(db, {
    actorId: params.providerId,
    // The provider is both actor and owner here: a service is published by the
    // account that owns it, and there is no admin path that publishes one for
    // them. Stated rather than left implicit, because the two fields diverge
    // everywhere an administrator acts on somebody else's record.
    ownerId: params.providerId,
    action: params.to === SERVICE_PUBLIC_STATUS ? 'service_published'
      : params.to === 'archived' ? 'service_archived'
      : 'service_delisted',
    subjectType: 'service',
    subjectId: params.serviceId,
    detail: `${from} -> ${params.to}`,
  });
  return { from, to: params.to };
}

/**
 * The public catalogue for one provider: live offerings only, and only if the
 * provider is approved. BOTH clauses, applied here so no caller has to remember
 * the second one.
 */
export type PublicServiceOffering = {
  id: number;
  title: string;
  description: string | null;
  categoryId: number;
  categorySlug: string;
  categoryNameEn: string;
  categoryNameAr: string;
  pricingBasis: ServicePricingBasis;
  priceMin: string | null;
  priceMax: string | null;
  leadTimeDays: number | null;
  warrantyMonths: number | null;
};

export async function visibleServicesFor(db: Db, providerId: number): Promise<PublicServiceOffering[]> {
  const [provider] = await db
    .select({ onboardingStatus: users.onboardingStatus })
    .from(users).where(eq(users.id, providerId)).limit(1);
  if (provider?.onboardingStatus !== 'approved') return [];
  return db.select({
    id: serviceOfferings.id,
    title: serviceOfferings.title,
    description: serviceOfferings.description,
    categoryId: serviceOfferings.categoryId,
    categorySlug: productCategories.slug,
    categoryNameEn: productCategories.nameEn,
    categoryNameAr: productCategories.nameAr,
    pricingBasis: serviceOfferings.pricingBasis,
    priceMin: serviceOfferings.priceMin,
    priceMax: serviceOfferings.priceMax,
    leadTimeDays: serviceOfferings.leadTimeDays,
    warrantyMonths: serviceOfferings.warrantyMonths,
  })
    .from(serviceOfferings)
    .innerJoin(productCategories, eq(serviceOfferings.categoryId, productCategories.id))
    .where(and(eq(serviceOfferings.providerId, providerId), publicServiceFilter()));
}

export { SERVICE_TITLE_MAX, SERVICE_DESCRIPTION_MAX, DEFAULT_PRICING_BASIS };
