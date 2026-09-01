/**
 * ── ADMIN-GRANTED SPONSORED PLACEMENT ──────────────────────────────────────
 *
 * BuildHub already had ONE route to a sponsored slot: `listFeaturedVendors`,
 * derived from live billing state - a Premium plan buys placement. That is
 * real commercial data and it stays exactly as it is.
 *
 * The owner has approved a SECOND route: an administrator grants a named
 * vendor a slot in a named service category, for a period, with a reason.
 * That is a commercial arrangement BuildHub did not previously sell, and it is
 * recorded as a real row rather than simulated in the UI - a hard-coded list
 * of "sponsored" firms would be inventing commercial relationships that do not
 * exist, which is the one thing that must never happen here.
 *
 * WHAT THIS RECORDS AND WHAT IT DELIBERATELY DOES NOT.
 *
 * It records THAT a sponsorship was granted, by whom, for which category, over
 * what period, and why. It records no price, no invoice and no payment:
 * BuildHub has no payment provider, and a `priceAgreed` column would be the
 * same fabrication in a different place. If the business later charges for
 * this, the charge belongs in the billing engine, not here.
 *
 * SPONSORSHIP IS NOT ENDORSEMENT, and the directory must never let it read as
 * one. It buys a labelled slot; it does not buy `verified`, a rating, a
 * position in the organic list, or any implication that BuildHub recommends
 * the vendor. That constraint is inherited from the entitlement model's own
 * design note and is not relaxed here.
 */

import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { users, vendorSponsorships } from '../drizzle/schema';

type Db = any;

/**
 * IS THIS SPONSORSHIP LIVE RIGHT NOW?
 *
 * Time-derived, exactly like every entitlement in the billing engine: a
 * sponsorship whose `endsAt` passed last night stops appearing this morning,
 * whether or not anything ran overnight to tidy it up. Nothing sweeps this
 * table, and nothing needs to.
 *
 * Three conditions, and all three matter:
 *   not revoked      an administrator withdrew it
 *   already started  a future-dated grant is not live yet
 *   not ended        NULL endsAt means open-ended until revoked
 */
export function liveSponsorshipFilter(now: Date) {
  return and(
    isNull(vendorSponsorships.revokedAt),
    lte(vendorSponsorships.startsAt, now),
    or(isNull(vendorSponsorships.endsAt), gt(vendorSponsorships.endsAt, now)),
  );
}

/**
 * Vendor ids with a live admin-granted sponsorship in one category.
 *
 * Returns IDS, not vendors: the caller already has a directory query with its
 * own visibility filter (active, approved, not deactivated, not a dummy), and
 * a sponsorship must never smuggle a vendor past it. A sponsored vendor who
 * has since been deactivated does not appear, because the directory query -
 * not this one - decides who is visible.
 */
export async function sponsoredVendorIds(
  db: Db,
  category: string,
  now: Date = new Date(),
): Promise<number[]> {
  const rows = await db
    .select({ vendorId: vendorSponsorships.vendorId })
    .from(vendorSponsorships)
    .where(and(
      eq(vendorSponsorships.category, category),
      eq(vendorSponsorships.kind, 'sponsored'),
      liveSponsorshipFilter(now),
    ));
  // De-duplicated: two overlapping grants for the same vendor and category is
  // an administrative untidiness, not two slots.
  return Array.from(new Set((rows as { vendorId: number }[]).map(r => r.vendorId)));
}

export type GrantOutcome =
  | { outcome: 'granted'; sponsorshipId: number }
  | { outcome: 'rejected'; reason: string };

/**
 * Grant a sponsorship.
 *
 * The vendor is re-read and re-checked here rather than trusted from the
 * request: a vendorId is a number, not a permission. A grant to a homeowner,
 * a deactivated account, or an unapproved provider would create a row that can
 * never take effect and an administrator who thinks it did.
 */
export async function grantSponsorship(params: {
  db: Db;
  vendorId: number;
  category: string;
  grantedBy: number;
  reason: string;
  priority?: number;
  startsAt?: Date;
  endsAt?: Date | null;
  now?: Date;
}): Promise<GrantOutcome> {
  const { db, vendorId, category, grantedBy } = params;
  const now = params.now ?? new Date();
  const startsAt = params.startsAt ?? now;
  const endsAt = params.endsAt ?? null;

  if (endsAt !== null && endsAt.getTime() <= startsAt.getTime()) {
    // A window that ends before it begins is never live. Refusing is better
    // than storing a row that silently does nothing.
    return { outcome: 'rejected', reason: 'The sponsorship end date must be after its start date.' };
  }

  // MariaDB's `timestamp` cannot represent a date past 2038-01-19 - the 32-bit
  // epoch. Without this an administrator typing a far-future end date got a
  // raw driver error ("Incorrect datetime value") surfaced as a 500, which
  // tells them nothing and looks like the feature is broken. Refused here with
  // a sentence instead, and the bound is stated rather than hidden.
  const EPOCH_LIMIT = new Date('2038-01-01T00:00:00Z');
  for (const [label, value] of [['start', startsAt], ['end', endsAt]] as const) {
    if (value !== null && value.getTime() >= EPOCH_LIMIT.getTime()) {
      return {
        outcome: 'rejected',
        reason: `The sponsorship ${label} date must be before 2038. Grant a shorter period and renew it.`,
      };
    }
  }

  const [vendor] = await db
    .select({ id: users.id, userRole: users.userRole, onboardingStatus: users.onboardingStatus, accountStatus: users.accountStatus })
    .from(users).where(eq(users.id, vendorId)).limit(1);
  if (!vendor) return { outcome: 'rejected', reason: 'Vendor not found.' };
  if (vendor.onboardingStatus !== 'approved' || vendor.accountStatus !== 'active') {
    return {
      outcome: 'rejected',
      reason: 'Only an approved, active provider can hold a sponsored placement.',
    };
  }

  // Already sponsored in this category, right now? Then this is a no-op rather
  // than a second slot - and saying so is better than silently stacking rows
  // an administrator would have to hunt down later.
  const existing = await db
    .select({ id: vendorSponsorships.id })
    .from(vendorSponsorships)
    .where(and(
      eq(vendorSponsorships.vendorId, vendorId),
      eq(vendorSponsorships.category, category),
      liveSponsorshipFilter(now),
    ))
    .limit(1);
  if ((existing as unknown[]).length > 0) {
    return { outcome: 'rejected', reason: 'This vendor already holds a live sponsorship in that category.' };
  }

  const written = await db.insert(vendorSponsorships).values({
    vendorId, category, kind: 'sponsored', priority: params.priority ?? 0, grantedBy, grantedReason: params.reason, startsAt, endsAt,
  });
  return { outcome: 'granted', sponsorshipId: Number(written?.[0]?.insertId) || 0 };
}

/**
 * ── ADMIN-CURATED FEATURED PLACEMENT ──────────────────────────────────────
 *
 * Featured is EDITORIAL, not paid: an administrator chooses which providers
 * the marketplace showcases, in which service category. It shares the
 * live/period/soft-removal machinery with sponsorship but carries no
 * commercial reason - and the `kind` column keeps the two states auditable as
 * separate things instead of one meaning silently sliding into the other.
 */
export async function featureVendor(params: {
  db: Db;
  vendorId: number;
  category: string;
  featuredBy: number;
  priority?: number;
  startsAt?: Date;
  endsAt?: Date | null;
  now?: Date;
}): Promise<GrantOutcome> {
  const { db, vendorId, category, featuredBy } = params;
  const now = params.now ?? new Date();
  const startsAt = params.startsAt ?? now;
  const endsAt = params.endsAt ?? null;

  if (endsAt !== null && endsAt.getTime() <= startsAt.getTime()) {
    return { outcome: 'rejected', reason: 'The featured end date must be after its start date.' };
  }
  const EPOCH_LIMIT = new Date('2038-01-01T00:00:00Z');
  for (const [label, value] of [['start', startsAt], ['end', endsAt]] as const) {
    if (value !== null && value.getTime() >= EPOCH_LIMIT.getTime()) {
      return { outcome: 'rejected', reason: `The featured ${label} date must be before 2038.` };
    }
  }

  const [vendor] = await db
    .select({ id: users.id, userRole: users.userRole, onboardingStatus: users.onboardingStatus, accountStatus: users.accountStatus })
    .from(users).where(eq(users.id, vendorId)).limit(1);
  if (!vendor) return { outcome: 'rejected', reason: 'Vendor not found.' };
  if (vendor.onboardingStatus !== 'approved' || vendor.accountStatus !== 'active') {
    return { outcome: 'rejected', reason: 'Only an approved, active provider can be featured.' };
  }

  const existing = await db
    .select({ id: vendorSponsorships.id })
    .from(vendorSponsorships)
    .where(and(
      eq(vendorSponsorships.vendorId, vendorId),
      eq(vendorSponsorships.category, category),
      eq(vendorSponsorships.kind, 'featured'),
      liveSponsorshipFilter(now),
    ))
    .limit(1);
  if ((existing as unknown[]).length > 0) {
    return { outcome: 'rejected', reason: 'This vendor is already featured in that category.' };
  }

  const written = await db.insert(vendorSponsorships).values({
    vendorId, category, kind: 'featured', priority: params.priority ?? 0, grantedBy: featuredBy, startsAt, endsAt,
  });
  return { outcome: 'granted', sponsorshipId: Number(written?.[0]?.insertId) || 0 };
}

/** Vendor ids with a live admin-curated featured placement in one category. */
export async function featuredVendorIds(
  db: Db,
  category: string,
  now: Date = new Date(),
): Promise<number[]> {
  const rows = await db
    .select({ vendorId: vendorSponsorships.vendorId })
    .from(vendorSponsorships)
    .where(and(
      eq(vendorSponsorships.category, category),
      eq(vendorSponsorships.kind, 'featured'),
      liveSponsorshipFilter(now),
    ));
  return Array.from(new Set((rows as { vendorId: number }[]).map(r => r.vendorId)));
}

/**
 * Revoke a sponsorship.
 *
 * SOFT, on purpose. The row stays so an audit can still show that the
 * sponsorship existed, who granted it, and when it was withdrawn - deleting it
 * would erase the commercial arrangement from history, which is the opposite
 * of auditable. `revokedAt` is written once: a second revocation does not
 * re-stamp the moment the decision was actually taken.
 */
export async function revokeSponsorship(
  db: Db, sponsorshipId: number, revokedBy: number, now: Date = new Date(),
): Promise<boolean> {
  const [row] = await db.select({ id: vendorSponsorships.id, revokedAt: vendorSponsorships.revokedAt })
    .from(vendorSponsorships).where(eq(vendorSponsorships.id, sponsorshipId)).limit(1);
  if (!row || row.revokedAt !== null) return false;
  await db.update(vendorSponsorships)
    .set({ revokedAt: now, revokedBy })
    .where(eq(vendorSponsorships.id, sponsorshipId));
  return true;
}

/**
 * Every sponsorship, live or not, for the Super Admin view.
 *
 * Deliberately NOT filtered to live rows: the question an administrator asks
 * is "which vendors are sponsored, in which category, for what period, and by
 * what action" - and a revoked or elapsed grant is part of that answer. `live`
 * is computed per row so the screen can say which is which rather than the
 * reader inferring it from dates.
 */
export type SponsorshipRow = {
  id: number;
  vendorId: number;
  kind: 'sponsored' | 'featured';
  /** Null only if the account was removed; the grant still happened. */
  vendorName: string | null;
  category: string;
  startsAt: Date;
  endsAt: Date | null;
  grantedBy: number | null;
  grantedReason: string | null;
  revokedAt: Date | null;
  revokedBy: number | null;
  createdAt: Date;
  /** Computed, so the screen states it rather than the reader inferring it. */
  live: boolean;
};

export async function listSponsorships(db: Db, now: Date = new Date()): Promise<SponsorshipRow[]> {
  const rows = await db
    .select({
      id: vendorSponsorships.id,
      vendorId: vendorSponsorships.vendorId,
      kind: vendorSponsorships.kind,
      vendorName: users.name,
      category: vendorSponsorships.category,
      startsAt: vendorSponsorships.startsAt,
      endsAt: vendorSponsorships.endsAt,
      grantedBy: vendorSponsorships.grantedBy,
      grantedReason: vendorSponsorships.grantedReason,
      revokedAt: vendorSponsorships.revokedAt,
      revokedBy: vendorSponsorships.revokedBy,
      createdAt: vendorSponsorships.createdAt,
    })
    .from(vendorSponsorships)
    .leftJoin(users, eq(users.id, vendorSponsorships.vendorId))
    .orderBy(sql`${vendorSponsorships.createdAt} desc`);

  return (rows as Omit<SponsorshipRow, 'live'>[]).map(row => ({
    ...row,
    live: row.revokedAt === null
      && new Date(row.startsAt).getTime() <= now.getTime()
      && (row.endsAt === null || new Date(row.endsAt).getTime() > now.getTime()),
  }));
}

/** Only admin-curated featured rows, for the featured admin surface. */
export async function listFeaturedPlacements(db: Db, now: Date = new Date()): Promise<SponsorshipRow[]> {
  const rows = await listSponsorships(db, now);
  return rows.filter(row => row.kind === 'featured');
}
