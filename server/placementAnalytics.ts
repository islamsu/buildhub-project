/**
 * ── COMMERCIAL PLACEMENT ANALYTICS ────────────────────────────────────────
 *
 * Real observations only. There is no SALE, ORDER, REVENUE, GMV or COMMISSION
 * here, because BuildHub observes none of them - payments are deferred, and a
 * metric with no observation behind it is a decoration an owner would make
 * decisions on.
 *
 * THIS ENDPOINT IS WRITTEN TO BY THE PUBLIC. Most marketplace browsing is
 * anonymous, so the browser must be able to report an impression without a
 * session. That makes it the one analytics surface an untrusted party can
 * write to, and it is treated accordingly:
 *
 *   - the event type comes from a CLOSED set, so nobody can invent a metric;
 *   - QUALIFIED_ENQUIRY is not in that set at all - a browser must never be
 *     able to assert that a business relationship exists;
 *   - the placement must EXIST and be LIVE, so a made-up id records nothing;
 *   - the entity and surface are read from the placement ROW, never taken from
 *     the request, so a reporter cannot attribute their event to somebody
 *     else's booking;
 *   - nothing personal is stored: no address, no agent, no fingerprint.
 *
 * What remains possible for a determined party is inflating the counts of a
 * placement that genuinely exists. That is the same exposure any web analytics
 * has, it is bounded by the checks above, and it is recorded here honestly
 * rather than described as prevented.
 */
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { analyticsEvents, vendorSponsorships } from '../drizzle/schema';
import { getDb } from './db';
import { recordEvent } from './analytics/events';
import { ANALYTICS_EVENTS } from '@shared/analyticsEvents';
import { rate, type PlacementClientEvent } from '@shared/placementAnalytics';

const CLIENT_EVENT_TYPE = {
  IMPRESSION: ANALYTICS_EVENTS.PLACEMENT_IMPRESSION,
  ENTITY_VIEW: ANALYTICS_EVENTS.PLACEMENT_ENTITY_VIEW,
  CTA_CLICK: ANALYTICS_EVENTS.PLACEMENT_CTA_CLICK,
} as const;

/**
 * Record a placement event reported by a browser.
 *
 * Returns whether it was recorded. A refusal is not an error the visitor needs
 * to see - the page carries on either way - but it must not be reported as a
 * success, because "we recorded it" is the whole value of this call.
 */
export async function recordPlacementEvent(params: {
  placementId: number;
  event: PlacementClientEvent;
  /** The signed-in reader, when there is one. Anonymous browsing is normal. */
  userId?: number | null;
  now?: Date;
}): Promise<{ recorded: boolean; reason?: string }> {
  const db = await getDb();
  if (!db) return { recorded: false, reason: 'unavailable' };
  const now = params.now ?? new Date();

  // THE PLACEMENT MUST EXIST AND BE LIVE. An id is not evidence: without this
  // read, a reporter could post events against a number they invented, or keep
  // inflating a placement that expired last month.
  const [placement] = await db
    .select({
      id: vendorSponsorships.id,
      surface: vendorSponsorships.surface,
      entityType: vendorSponsorships.entityType,
      vendorId: vendorSponsorships.vendorId,
      productId: vendorSponsorships.productId,
    })
    .from(vendorSponsorships)
    .where(and(
      eq(vendorSponsorships.id, params.placementId),
      isNull(vendorSponsorships.revokedAt),
      lte(vendorSponsorships.startsAt, now),
      or(isNull(vendorSponsorships.endsAt), gt(vendorSponsorships.endsAt, now)),
    ))
    .limit(1);
  if (!placement) return { recorded: false, reason: 'no_live_placement' };

  // The subject comes from the ROW, not from the request. A reporter cannot
  // attribute their event to a surface or an entity the booking does not have.
  const entityId = placement.entityType === 'PRODUCT' ? placement.productId : placement.vendorId;

  await recordEvent({
    type: CLIENT_EVENT_TYPE[params.event],
    userId: params.userId ?? null,
    subjectType: 'placement',
    subjectId: placement.id,
    metadata: {
      surface: placement.surface ?? '',
      entityType: placement.entityType,
      entityId: entityId ?? 0,
    },
    occurredAt: now,
  });
  return { recorded: true };
}

/**
 * Attribute a REAL enquiry to a placement. Server-side only.
 *
 * Deliberately not reachable from a browser: a visitor who can post their own
 * conversions can manufacture an advertiser's performance report. This is
 * called from the code that creates the actual RFQ or qualified enquiry, at the
 * moment the relationship genuinely comes into existence.
 *
 * It records an ATTRIBUTED ENQUIRY. It is not a sale, and nothing downstream
 * may present it as revenue.
 */
export async function attributePlacementEnquiry(params: {
  placementId: number;
  userId: number;
  subjectType: 'rfq' | 'enquiry';
  subjectId: number;
  now?: Date;
}): Promise<{ recorded: boolean }> {
  const db = await getDb();
  if (!db) return { recorded: false };
  const now = params.now ?? new Date();

  const [placement] = await db
    .select({ id: vendorSponsorships.id, surface: vendorSponsorships.surface })
    .from(vendorSponsorships)
    .where(eq(vendorSponsorships.id, params.placementId))
    .limit(1);
  // A placement that has since EXPIRED still gets the attribution: the journey
  // began while it was live, and stripping the credit because the campaign
  // ended between click and submission would understate what it earned.
  if (!placement) return { recorded: false };

  await recordEvent({
    type: ANALYTICS_EVENTS.PLACEMENT_QUALIFIED_ENQUIRY,
    userId: params.userId,
    subjectType: 'placement',
    subjectId: placement.id,
    metadata: {
      surface: placement.surface ?? '',
      enquiryType: params.subjectType,
      enquiryId: params.subjectId,
    },
    occurredAt: now,
  });
  return { recorded: true };
}

export type PlacementPerformanceRow = {
  placementId: number;
  surface: string | null;
  entityType: string;
  entityName: string | null;
  impressions: number;
  entityViews: number;
  ctaActions: number;
  qualifiedEnquiries: number;
  /** Percentages, or NULL where the denominator is zero. Never a decorative 0. */
  ctr: number | null;
  viewRate: number | null;
  conversionRate: number | null;
};

/**
 * Performance per placement, counted from real events.
 *
 * Every figure is a COUNT of rows that exist. A placement nobody has seen
 * reports zeros and null rates, which is the truthful answer and the one the
 * Admin screen renders as an empty state rather than as failure.
 */
export async function placementPerformance(now: Date = new Date()): Promise<PlacementPerformanceRow[]> {
  const db = await getDb();
  if (!db) return [];

  const placements = await db
    .select({
      id: vendorSponsorships.id,
      surface: vendorSponsorships.surface,
      entityType: vendorSponsorships.entityType,
      vendorId: vendorSponsorships.vendorId,
      productId: vendorSponsorships.productId,
    })
    .from(vendorSponsorships)
    .orderBy(vendorSponsorships.id);
  if (placements.length === 0) return [];

  // ONE grouped query rather than four per placement: a report that issues
  // 4N queries stops being openable at exactly the point the product succeeds.
  const counts = await db
    .select({
      subjectId: analyticsEvents.subjectId,
      eventType: analyticsEvents.eventType,
      total: sql<number>`count(*)`,
    })
    .from(analyticsEvents)
    .where(eq(analyticsEvents.subjectType, 'placement'))
    .groupBy(analyticsEvents.subjectId, analyticsEvents.eventType);

  const tally = new Map<string, number>();
  for (const row of counts as { subjectId: number | null; eventType: string; total: number }[]) {
    tally.set(`${row.subjectId}:${row.eventType}`, Number(row.total ?? 0));
  }
  const count = (id: number, type: string) => tally.get(`${id}:${type}`) ?? 0;

  // Names, so the Admin screen shows a business rather than a row id.
  const names = await placementEntityNames(db, placements as PlacementRowLite[]);

  return (placements as PlacementRowLite[]).map(placement => {
    const impressions = count(placement.id, ANALYTICS_EVENTS.PLACEMENT_IMPRESSION);
    const entityViews = count(placement.id, ANALYTICS_EVENTS.PLACEMENT_ENTITY_VIEW);
    const ctaActions = count(placement.id, ANALYTICS_EVENTS.PLACEMENT_CTA_CLICK);
    const qualifiedEnquiries = count(placement.id, ANALYTICS_EVENTS.PLACEMENT_QUALIFIED_ENQUIRY);
    return {
      placementId: placement.id,
      surface: placement.surface,
      entityType: placement.entityType,
      entityName: names.get(placement.id) ?? null,
      impressions,
      entityViews,
      ctaActions,
      qualifiedEnquiries,
      ctr: rate(ctaActions, impressions),
      viewRate: rate(entityViews, impressions),
      conversionRate: rate(qualifiedEnquiries, entityViews),
    };
  });
}

type PlacementRowLite = {
  id: number; surface: string | null; entityType: string;
  vendorId: number | null; productId: number | null;
};

/** Batched name lookup - never one query per row. */
async function placementEntityNames(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  placements: PlacementRowLite[],
): Promise<Map<number, string | null>> {
  const { users, products } = await import('../drizzle/schema');
  const { inArray } = await import('drizzle-orm');

  const vendorIds = placements.map(p => p.vendorId).filter((id): id is number => id != null);
  const productIds = placements.map(p => p.productId).filter((id): id is number => id != null);

  const vendorRows = vendorIds.length > 0
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, vendorIds))
    : [];
  const productRows = productIds.length > 0
    ? await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, productIds))
    : [];

  const vendorName = new Map((vendorRows as { id: number; name: string | null }[]).map(r => [r.id, r.name]));
  const productName = new Map((productRows as { id: number; name: string | null }[]).map(r => [r.id, r.name]));

  const out = new Map<number, string | null>();
  for (const placement of placements) {
    out.set(placement.id, placement.entityType === 'PRODUCT'
      ? productName.get(placement.productId ?? -1) ?? null
      : vendorName.get(placement.vendorId ?? -1) ?? null);
  }
  return out;
}
