/**
 * ── THE SUPPLIER'S MARKETING CENTER: A COMPOSITION, NOT A DOMAIN ────────
 *
 * CLAUDE.md §89 item 16 is explicit: compose the canonical systems that
 * already exist and do not create duplicate placement, sponsorship,
 * analytics or entitlement domains. So this file defines NO new table, NO
 * new event type and NO new metric. Every number below is read through a
 * reader that already existed and is already used by the Admin screen:
 *
 *   vendorSponsorships       the placement record (§18's canonical store)
 *   placementPerformance()   the SAME function the Admin report calls,
 *                            given a scope argument rather than a fork
 *   listShowcase()           the supplier's own storefront emphasis
 *
 * The screen it feeds answers the five questions §89 names, and it answers
 * them with facts the database can produce.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────
 *
 * No budget, no CPC, no CPM, no spend, no revenue, no GMV, no ROI, no
 * "trending", no projected reach, no benchmark against other suppliers.
 * BuildHub has no payment provider, so every one of those would be a number
 * invented to make a screen look commercial (§10, §30). A supplier who acted
 * on a fabricated ROI figure would be making real business decisions on
 * something BuildHub made up.
 *
 * ── AND WHAT SEPARATION IS PRESERVED ───────────────────────────────────
 *
 * FEATURED and SPONSORED are never summed into one total. An editorial
 * pick's impressions are not advertising inventory, and adding them together
 * would overstate what BuildHub actually sells - the same rule
 * `PlacementPerformanceRow.kind` exists to keep, applied one screen further
 * out. SUPPLIER SHOWCASE is reported separately again, and explicitly as
 * something that does NOT affect marketplace ranking, so a supplier cannot
 * read it as promotion they have been given.
 */
import { eq, inArray, or, sql } from 'drizzle-orm';
import { products, vendorSponsorships } from '../drizzle/schema';
import { requireDb } from './_core/requireDb';
import { placementPerformance, type PlacementPerformanceRow } from './placementAnalytics';
import { listShowcase } from './supplierShowcase';
import { placementLabel } from '@shared/placement';

type Db = any;

export type MarketingPlacement = {
  placementId: number;
  /** 'FEATURED' | 'SPONSORED' - the canonical label, never a raw column. */
  label: ReturnType<typeof placementLabel>;
  kind: string;
  entityType: string;
  entityName: string | null;
  /** Where it runs and in which taxonomy - the "scope" §89 asks for. */
  surface: string | null;
  category: string | null;
  package: string | null;
  source: string;
  startsAt: Date | null;
  /** null = open-ended until revoked. Rendered as such, never as "expired". */
  endsAt: Date | null;
  /** Derived at read time, so an elapsed placement stops counting as active. */
  active: boolean;
  impressions: number;
  entityViews: number;
  ctaActions: number;
  qualifiedEnquiries: number;
  /** Percentages, or NULL where the denominator is zero. Never a decorative 0. */
  ctr: number | null;
  viewRate: number | null;
  conversionRate: number | null;
};

export type MarketingOverview = {
  placements: MarketingPlacement[];
  /**
   * COUNTED SEPARATELY BY LABEL, never as one total (§18). Summing an
   * editorial pick with a commercial slot would report BuildHub as selling
   * inventory it gave away.
   */
  activeFeatured: number;
  activeSponsored: number;
  /** The supplier's own storefront emphasis. Not promotion; reported apart. */
  showcaseCount: number;
  /**
   * Whether ANY placement has ever recorded an event. Distinguishes "nobody
   * has seen this yet" from "we are not measuring", which a bare 0 cannot.
   */
  measuredEvents: number;
};

/**
 * Everything the supplier's Marketing Center renders, in one read.
 *
 * `requireDb()` rather than `getDb()`: an outage here must fail honestly. A
 * screen that answers "0 impressions, 0 enquiries" because the database was
 * unreachable tells a supplier their promotion is not working, which is a
 * commercial claim made on no evidence (§10, §64).
 */
export async function vendorMarketingOverview(
  db: Db, vendorId: number, now: Date = new Date(),
): Promise<MarketingOverview> {
  // A supplier's placements are the ones pointing AT them: a PROVIDER
  // placement carrying their id, or a PRODUCT placement carrying one of
  // their products. Scoping on vendorId alone would hide every sponsored
  // product they have, which is most of what they came to see.
  const ownProducts = await db.select({ id: products.id }).from(products)
    .where(eq(products.supplierId, vendorId));
  const productIds = ownProducts.map((row: any) => Number(row.id));

  const [rows, performance, showcase] = await Promise.all([
    db.select({
      id: vendorSponsorships.id,
      kind: vendorSponsorships.kind,
      category: vendorSponsorships.category,
      package: vendorSponsorships.package,
      surface: vendorSponsorships.surface,
      source: vendorSponsorships.source,
      entityType: vendorSponsorships.entityType,
      startsAt: vendorSponsorships.startsAt,
      endsAt: vendorSponsorships.endsAt,
      revokedAt: vendorSponsorships.revokedAt,
    }).from(vendorSponsorships).where(
      productIds.length > 0
        ? or(eq(vendorSponsorships.vendorId, vendorId), inArrayOrNever(productIds))
        : eq(vendorSponsorships.vendorId, vendorId),
    ),
    placementPerformance(now, { vendorId, productIds }),
    listShowcase(db, vendorId),
  ]);

  const byId = new Map<number, PlacementPerformanceRow>(
    performance.map(row => [row.placementId, row]),
  );

  const placements: MarketingPlacement[] = (rows as any[]).map(row => {
    const id = Number(row.id);
    const metrics = byId.get(id);
    return {
      placementId: id,
      // THE CANONICAL LABEL, so this screen cannot start calling a sponsored
      // slot "featured" the way a hand-written ternary eventually would.
      label: placementLabel(row.source),
      kind: String(row.kind),
      entityType: String(row.entityType),
      entityName: metrics?.entityName ?? null,
      surface: row.surface ?? null,
      category: row.category ?? null,
      package: row.package ?? null,
      source: String(row.source),
      startsAt: row.startsAt ?? null,
      endsAt: row.endsAt ?? null,
      // DERIVED, NEVER STORED. A placement that elapsed last night is not
      // active this morning whether or not anything ran to tidy it up - the
      // same fail-closed rule `liveSponsorshipFilter` applies.
      active: row.revokedAt == null
        && (row.startsAt == null || new Date(row.startsAt) <= now)
        && (row.endsAt == null || new Date(row.endsAt) > now),
      impressions: metrics?.impressions ?? 0,
      entityViews: metrics?.entityViews ?? 0,
      ctaActions: metrics?.ctaActions ?? 0,
      qualifiedEnquiries: metrics?.qualifiedEnquiries ?? 0,
      ctr: metrics?.ctr ?? null,
      viewRate: metrics?.viewRate ?? null,
      conversionRate: metrics?.conversionRate ?? null,
    };
  });

  return {
    placements,
    activeFeatured: placements.filter(p => p.active && p.label === 'FEATURED').length,
    activeSponsored: placements.filter(p => p.active && p.label === 'SPONSORED').length,
    showcaseCount: showcase.cards.length,
    measuredEvents: placements.reduce(
      (sum, p) => sum + p.impressions + p.entityViews + p.ctaActions + p.qualifiedEnquiries, 0),
  };
}

/**
 * `inArray` over an EMPTY list is the dangerous shape: MySQL rejects `in ()`
 * and some builders drop the clause entirely, which would turn "none of my
 * products" into "every placement on the platform". FAIL CLOSED instead.
 *
 * The caller already guards the empty case, so this is belt and braces - but
 * the guarantee belongs in the expression rather than in a future reader's
 * memory of what the caller does.
 */
function inArrayOrNever(ids: readonly number[]) {
  if (ids.length === 0) return sql`1 = 0`;
  return inArray(vendorSponsorships.productId, ids as number[]);
}
