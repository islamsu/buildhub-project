import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { products, users, vendorSponsorships } from '../drizzle/schema';

type Db = any;

export type PlacementPackage = 'BOOST' | 'SPOTLIGHT' | 'PREMIER';
export type PlacementSurface = 'MASTER_DISCOVERY' | 'TYPE_CATEGORY_SPOTLIGHT' | 'SEARCH_RESULTS_BOOST';
export type PlacementSource = 'PAID_SPONSORSHIP' | 'ADMIN_EDITORIAL' | 'REFERRAL_REWARD' | 'PROMOTIONAL_COMP';

export type PlacementBooking = {
  entityType: 'PROVIDER' | 'PRODUCT';
  entityId: number;
  package: PlacementPackage;
  surface: PlacementSurface;
  source: PlacementSource;
  category: string;
  startsAt: Date;
  endsAt: Date | null;
  priority?: number;
  /**
   * The administrator who granted it, or NULL for the platform. The column is
   * nullable and always has been; typing this as `number` forced a referral
   * reward to name its own beneficiary as the grantor.
   */
  grantedBy: number | null;
  reason?: string;
};

export const PACKAGE_SURFACES: Record<PlacementPackage, PlacementSurface[]> = {
  BOOST: ['SEARCH_RESULTS_BOOST'],
  SPOTLIGHT: ['TYPE_CATEGORY_SPOTLIGHT', 'SEARCH_RESULTS_BOOST'],
  PREMIER: ['MASTER_DISCOVERY', 'TYPE_CATEGORY_SPOTLIGHT', 'SEARCH_RESULTS_BOOST'],
};

export function isValidPackageSurface(packageValue: PlacementPackage, surface: PlacementSurface): boolean {
  return PACKAGE_SURFACES[packageValue].includes(surface);
}

const livePlacement = (now: Date) => and(
  isNull(vendorSponsorships.revokedAt),
  lte(vendorSponsorships.startsAt, now),
  or(isNull(vendorSponsorships.endsAt), gt(vendorSponsorships.endsAt, now)),
);

export async function bookPlacement(db: Db, booking: PlacementBooking, now: Date = new Date()): Promise<{ outcome: 'granted'; placementId: number } | { outcome: 'rejected'; reason: string }> {
  if (!isValidPackageSurface(booking.package, booking.surface)) {
    return { outcome: 'rejected', reason: `${booking.package} does not include the ${booking.surface} surface.` };
  }
  if (booking.endsAt && booking.endsAt.getTime() <= booking.startsAt.getTime()) {
    return { outcome: 'rejected', reason: 'The placement end date must be after its start date.' };
  }

  if (booking.entityType === 'PROVIDER') {
    const [provider] = await db.select({
      id: users.id,
      userRole: users.userRole,
      onboardingStatus: users.onboardingStatus,
      accountStatus: users.accountStatus,
    }).from(users).where(eq(users.id, booking.entityId)).limit(1);
    if (!provider) return { outcome: 'rejected', reason: 'Provider not found.' };
    if (provider.onboardingStatus !== 'approved' || provider.accountStatus !== 'active') {
      return { outcome: 'rejected', reason: 'Only an approved, active provider can be placed.' };
    }
  } else {
    const [product] = await db.select({ id: products.id, active: products.active }).from(products).where(eq(products.id, booking.entityId)).limit(1);
    if (!product || !product.active) return { outcome: 'rejected', reason: 'Only an active product can be placed.' };
  }

  if (booking.package === 'PREMIER' && booking.surface === 'MASTER_DISCOVERY') {
    const overlap = await db.select({ id: vendorSponsorships.id }).from(vendorSponsorships).where(and(
      eq(vendorSponsorships.entityType, booking.entityType),
      eq(vendorSponsorships.surface, booking.surface),
      eq(vendorSponsorships.category, booking.category),
      isNull(vendorSponsorships.revokedAt),
      or(isNull(vendorSponsorships.endsAt), gt(vendorSponsorships.endsAt, booking.startsAt)),
    )).limit(1);
    if (overlap.length > 0) return { outcome: 'rejected', reason: 'An exclusive Master placement already overlaps this scope.' };
  }

  if (booking.package === 'SPOTLIGHT' && booking.surface === 'TYPE_CATEGORY_SPOTLIGHT') {
    const active = await db.select({ id: vendorSponsorships.id }).from(vendorSponsorships).where(and(
      eq(vendorSponsorships.entityType, booking.entityType),
      eq(vendorSponsorships.surface, booking.surface),
      eq(vendorSponsorships.category, booking.category),
      livePlacement(now),
    ));
    if (active.length >= 3) return { outcome: 'rejected', reason: 'Spotlight capacity for this scope is full.' };
  }

  const result = await db.insert(vendorSponsorships).values({
    vendorId: booking.entityType === 'PROVIDER' ? booking.entityId : null,
    productId: booking.entityType === 'PRODUCT' ? booking.entityId : null,
    category: booking.category,
    kind: booking.source === 'PAID_SPONSORSHIP' ? 'sponsored' : 'featured',
    source: booking.source,
    package: booking.package,
    surface: booking.surface,
    entityType: booking.entityType,
    priority: booking.priority ?? 0,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    grantedBy: booking.grantedBy,
    grantedReason: booking.reason ?? null,
  });
  return { outcome: 'granted', placementId: Number(result?.[0]?.insertId ?? 0) };
}
