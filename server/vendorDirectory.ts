// ── Real Vendor Directory (Phase 4B.3) ─────────────────────────────────────
// Replaces the static mock vendor list that previously backed
// /marketplace/vendors with real, database-backed provider accounts.
//
// SECURITY: `users` also holds passwordHash, invitationToken, email, phone,
// frozenReason and other private fields. This module MUST always select an
// explicit column allowlist - never `select().from(users)` - so a future
// column added to the schema can never appear in a public directory response
// by accident. Same discipline as PUBLIC_PROFILE_COLUMNS (Phase 4A.6.1) and
// ADMIN_USER_LIST_COLUMNS (Phase 4A.6.7).
//
// Ranking here is ORGANIC ONLY. Nothing in this file reads a billing plan,
// subscription, or entitlement: a paying vendor is not ranked above a free one.
// Paid placement is a separate, clearly-labelled concept that arrives in a
// later phase and must never be blended into this ordering.

import { and, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { containsTerm } from './_core/searchTerms';
import { qualifiedEnquiries, reviews, users, vendorCategories, vendorSubscriptions } from '../drizzle/schema';
import { deriveBillingState } from './billing/domain';
import { getEntitlements } from '@shared/billing';
import { getDb } from './db';
import { isTestLoginEnabled } from './_core/env';

/** The only user columns a public directory response may ever contain. */
export const DIRECTORY_VENDOR_COLUMNS = {
  id: users.id,
  name: users.name,
  bio: users.bio,
  avatar: users.avatar,
  location: users.location,
  userRole: users.userRole,
  verified: users.verified,
  createdAt: users.createdAt,
} as const;

export const PROVIDER_ROLES = ['contractor', 'engineer', 'architect', 'supplier', 'project_manager'] as const;
type ProviderRole = (typeof PROVIDER_ROLES)[number];

export type DirectoryFilters = {
  category?: string;
  location?: string;
  search?: string;
  limit?: number;
};

/**
 * Which accounts may appear in a customer-facing directory:
 *  - a provider role (not homeowners or admins)
 *  - not a dummy/test account, EXCEPT on a test deployment - see below
 *  - account is active (excludes frozen)
 *  - not deactivated
 *  - onboarding approved - an unvetted applicant is not yet discoverable
 *
 * WHY THE DUMMY EXCLUSION IS CONDITIONAL.
 *
 * Hiding test accounts from a customer-facing directory is obviously right in
 * production: nobody browsing for a contractor should be shown a QA persona.
 *
 * But on staging it made the directory untestable with QA personas. A QA
 * Contractor could hold a session, quote, message and edit a profile - and
 * then not exist in the one listing that makes a provider discoverable. Half
 * their journey was unreachable, which is the "artificial dummy permission
 * level" this project set out not to have.
 *
 * So the exclusion is tied to the SAME switch that gates test-user sign-in,
 * rather than to a new concept. Production leaves TEST_LOGIN_ENABLED unset, so
 * the filter behaves exactly as before - this changes nothing there. A
 * deployment that has deliberately turned test login on is by definition a
 * test deployment, and showing its test personas is the point.
 *
 * This does not widen the blast radius of that flag: a deployment with it set
 * already accepts password-less sign-in as a QA persona, which is a far larger
 * concession than listing one.
 */
function directoryVisibilityFilter() {
  const conditions = [
    inArray(users.userRole, PROVIDER_ROLES as readonly ProviderRole[]),
    eq(users.accountStatus, 'active'),
    isNull(users.deactivatedAt),
    eq(users.onboardingStatus, 'approved'),
  ];
  if (!isTestLoginEnabled()) conditions.push(eq(users.isDummy, false));
  return and(...conditions);
}

export type DirectoryVendor = {
  id: number;
  name: string | null;
  bio: string | null;
  avatar: string | null;
  location: string | null;
  userRole: string | null;
  verified: boolean | null;
  createdAt: Date;
  categories: string[];
  averageRating: number | null;
  reviewCount: number;
};

export async function listDirectoryVendors(filters: DirectoryFilters = {}): Promise<DirectoryVendor[]> {
  const db = await getDb();
  if (!db) return [];

  const limit = Math.min(Math.max(filters.limit ?? 48, 1), 100);
  const conditions = [directoryVisibilityFilter()];

  if (filters.location) {
    conditions.push(like(users.location, containsTerm(filters.location)));
  }
  if (filters.search) {
    const term = containsTerm(filters.search);
    conditions.push(or(like(users.name, term), like(users.bio, term))!);
  }
  // Category filter is a declared-category match, using the same shared
  // taxonomy as RFQ targeting - never a separate vendor-only vocabulary.
  if (filters.category) {
    conditions.push(
      sql`${users.id} IN (SELECT ${vendorCategories.userId} FROM ${vendorCategories} WHERE ${vendorCategories.category} = ${filters.category})`,
    );
  }

  const rows = await db
    .select(DIRECTORY_VENDOR_COLUMNS)
    .from(users)
    .where(and(...conditions))
    .orderBy(desc(users.verified), desc(users.createdAt))
    .limit(limit);

  return enrichVendorRows(db, rows);
}

/**
 * Attach reputation and declared categories to a set of directory rows.
 *
 * Factored out so featured placement reuses exactly this - a featured vendor
 * must show the same rating, from the same source, as they do organically.
 * Two code paths computing reputation differently is how a vendor ends up with
 * 4.6 stars in one place and 4.8 in another.
 */
async function enrichVendorRows(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  rows: { id: number }[],
): Promise<DirectoryVendor[]> {
  if (rows.length === 0) return [];
  const ids = rows.map(row => row.id);

  // Reputation: the same live AVG/COUNT over verified reviews used everywhere
  // else since Phase 4A.6.2 - never the dead users.rating/reviewCount columns.
  // Batched into one grouped query, as established in Phase 4A.6.9.
  const reputationRows = await db
    .select({
      revieweeId: reviews.revieweeId,
      avg: sql<string | null>`avg(${reviews.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(reviews)
    .where(and(inArray(reviews.revieweeId, ids), eq(reviews.verified, true)))
    .groupBy(reviews.revieweeId);
  const reputation = new Map(reputationRows.map(row => {
    const count = Number(row.count ?? 0);
    return [row.revieweeId, {
      averageRating: count > 0 && row.avg != null ? Math.round(Number(row.avg) * 10) / 10 : null,
      reviewCount: count,
    }];
  }));

  const categoryRows = await db
    .select({ userId: vendorCategories.userId, category: vendorCategories.category })
    .from(vendorCategories)
    .where(inArray(vendorCategories.userId, ids));
  const categories = new Map<number, string[]>();
  for (const row of categoryRows) {
    const list = categories.get(row.userId) ?? [];
    list.push(row.category);
    categories.set(row.userId, list);
  }

  return rows.map(row => ({
    ...(row as Record<string, unknown>),
    categories: categories.get(row.id) ?? [],
    averageRating: reputation.get(row.id)?.averageRating ?? null,
    reviewCount: reputation.get(row.id)?.reviewCount ?? 0,
  })) as DirectoryVendor[];
}

/** Distinct declared categories among currently-visible vendors, for filter UI. */
export async function listDirectoryCategories(): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .selectDistinct({ category: vendorCategories.category })
    .from(vendorCategories)
    .innerJoin(users, eq(users.id, vendorCategories.userId))
    .where(directoryVisibilityFilter());
  return rows.map(row => row.category).sort();
}

/** Admin troubleshooting view: a vendor's declarations and enquiry consumption. */
export async function getVendorTargetingDiagnostics(userId: number) {
  const db = await getDb();
  if (!db) return { categories: [], recentEnquiries: [] };
  const categories = await db
    .select({ category: vendorCategories.category, createdAt: vendorCategories.createdAt })
    .from(vendorCategories)
    .where(eq(vendorCategories.userId, userId));
  const recentEnquiries = await db
    .select({
      rfqId: qualifiedEnquiries.rfqId,
      yearMonth: qualifiedEnquiries.yearMonth,
      planAtConsumption: qualifiedEnquiries.planAtConsumption,
      matchedCategory: qualifiedEnquiries.matchedCategory,
      createdAt: qualifiedEnquiries.createdAt,
    })
    .from(qualifiedEnquiries)
    .where(eq(qualifiedEnquiries.userId, userId))
    .orderBy(desc(qualifiedEnquiries.createdAt))
    .limit(100);
  return { categories, recentEnquiries };
}

// ── Featured placement (Slice 8) ───────────────────────────────────────────
//
// The first paid capability that affects what a customer sees. It is built as a
// SEPARATE, LABELLED STRIP rather than as a reordering of the organic list
// above, and that distinction is the whole design:
//
//  - The organic directory keeps ranking by verification and recency, exactly
//    as before. A paid plan still cannot buy a higher position there, which is
//    the constraint Phase 4B.3 §13 set and this slice does not relax.
//  - Featured vendors appear in their own section, marked as sponsored. They
//    are ALSO still present in the organic list, in their organic position -
//    removing them would be a hidden penalty for paying.
//
// What featured placement must never be allowed to mean: verification, higher
// rating, better work, or endorsement by BuildHub. It means the vendor pays for
// a premium plan. The UI labels it as such, and `verified` remains a completely
// separate badge driven by compliance review.
//
// `visibilityLevel` (boosted/top) is deliberately still NOT implemented. That
// entitlement would buy position inside the organic ranking, which is precisely
// what §13 forbids; implementing it would need an explicit owner decision to
// reverse that constraint, not an inference from a plan table.

/** How many sponsored slots the directory offers at once. */
export const FEATURED_PLACEMENT_SLOTS = 6;

/**
 * Vendors currently entitled to featured placement, as a separate labelled set.
 *
 * Eligibility is derived from the live billing state, never from the stored
 * plan column: a premium subscription whose period ended last month is not
 * featured, even if a lifecycle sweep has not run yet and the row still says
 * `premium`. Same time-derived rule that governs every other entitlement.
 *
 * When more vendors are eligible than there are slots, the set rotates by day.
 * Without that, whoever registered first would own the sponsored strip
 * permanently and every later subscriber would pay premium for nothing.
 */
export async function listFeaturedVendors(
  filters: DirectoryFilters & { now?: Date } = {},
): Promise<DirectoryVendor[]> {
  const db = await getDb();
  if (!db) return [];

  const now = filters.now ?? new Date();
  const conditions = [directoryVisibilityFilter()];
  if (filters.location) conditions.push(like(users.location, containsTerm(filters.location)));
  if (filters.category) {
    conditions.push(
      sql`${users.id} IN (SELECT ${vendorCategories.userId} FROM ${vendorCategories} WHERE ${vendorCategories.category} = ${filters.category})`,
    );
  }

  // Only vendors who HAVE a subscription row can possibly be eligible, so the
  // join bounds the work to that set rather than deriving state for everybody.
  const candidates = await db
    .select({ ...DIRECTORY_VENDOR_COLUMNS, subscription: vendorSubscriptions })
    .from(users)
    .innerJoin(vendorSubscriptions, eq(vendorSubscriptions.userId, users.id))
    .where(and(...conditions));

  const eligible = candidates.filter(row => {
    const state = deriveBillingState(row.subscription, now);
    // A malformed subscription fails closed to FREE inside deriveBillingState,
    // so it cannot buy a slot either.
    return getEntitlements(state.effectivePlan).featuredPlacementEligible;
  });
  if (eligible.length === 0) return [];

  const slots = Math.min(Math.max(filters.limit ?? FEATURED_PLACEMENT_SLOTS, 1), FEATURED_PLACEMENT_SLOTS);
  const selected = rotateFeatured(eligible, slots, now);

  return enrichVendorRows(db, selected.map(({ subscription: _subscription, ...vendor }) => vendor));
}

/**
 * Pick this day's sponsored set, fairly and deterministically.
 *
 * Deterministic so the strip does not reshuffle on every page load - a
 * directory that reorders while you read it is unusable. Keyed on the day so
 * the slots genuinely circulate rather than being owned. Vendors are ordered by
 * id, then the window starts at an offset derived from the date, wrapping
 * around; over enough days every eligible vendor gets the same exposure.
 */
export function rotateFeatured<T extends { id: number }>(eligible: T[], slots: number, now: Date): T[] {
  const ordered = [...eligible].sort((a, b) => a.id - b.id);
  if (ordered.length <= slots) return ordered;
  const dayNumber = Math.floor(now.getTime() / 86_400_000);
  const offset = ((dayNumber % ordered.length) + ordered.length) % ordered.length;
  return Array.from({ length: slots }, (_unused, index) => ordered[(offset + index) % ordered.length]);
}
