import { and, avg, count, eq, inArray } from 'drizzle-orm';
import { projects, reviews, users } from '../drizzle/schema';

/**
 * THE NUMBERS ON THE FRONT DOOR.
 *
 * The landing page and the sign-up page both stated, as fact, that BuildHub
 * had "10K+ Registered Users", "5K+ Active Projects", "2K+ Verified Providers"
 * and a "98% Satisfaction Rate". None of the four came from anywhere. The
 * satisfaction figure is the one worth naming twice: there were no reviews in
 * the database at all, so it was not a stale number or a rounded one - there
 * was no such measurement in existence.
 *
 * This module replaces them with the real counts. The rule it follows is the
 * one this codebase already established for provider ratings in
 * marketplaceHonesty.test.ts: AN ABSENT NUMBER IS SHOWN AS ABSENT, NOT AS A
 * NUMBER. `satisfaction` is null until somebody has actually left a review,
 * and the page renders nothing rather than a placeholder.
 *
 * What the marketing copy should say when the real figures are small is an
 * OWNER DECISION. This module does not decide it - it only makes the honest
 * figure the one that is available.
 */

/** Roles that can be a "provider" in the directory sense. */
const PROVIDER_ROLES = ['contractor', 'engineer', 'architect', 'supplier', 'project_manager'] as const;

export type PlatformStats = {
  registeredUsers: number;
  activeProjects: number;
  verifiedProviders: number;
  /** Null until at least one review exists. Never a stand-in value. */
  satisfaction: { averageRating: number; reviewCount: number } | null;
};

/**
 * A public, unauthenticated endpoint backs this, so it is cached briefly.
 * Four COUNT(*)s per landing-page view is not a load anybody needs to carry,
 * and these numbers do not need to be accurate to the second.
 */
const CACHE_MS = 60_000;
let cache: { at: number; value: PlatformStats } | null = null;

/** Exposed for tests - a cached value would make them assert nothing. */
export function resetPlatformStatsCache() {
  cache = null;
}

export async function getPlatformStats(db: any): Promise<PlatformStats> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  // QA personas and seeded accounts are excluded. A public headline count that
  // includes the test users would be a fabricated number arrived at honestly,
  // which is the same thing to the person reading it.
  const [userRow] = await db.select({ n: count() }).from(users).where(eq(users.isDummy, false));
  const [projectRow] = await db.select({ n: count() }).from(projects).where(eq(projects.status, 'active'));
  const [providerRow] = await db.select({ n: count() }).from(users).where(and(
    eq(users.verified, true),
    eq(users.isDummy, false),
    inArray(users.userRole, [...PROVIDER_ROLES]),
  ));
  const [reviewRow] = await db.select({ n: count(), average: avg(reviews.rating) }).from(reviews);

  const reviewCount = Number(reviewRow?.n ?? 0);
  const value: PlatformStats = {
    registeredUsers: Number(userRow?.n ?? 0),
    activeProjects: Number(projectRow?.n ?? 0),
    verifiedProviders: Number(providerRow?.n ?? 0),
    // The whole point: no reviews means no satisfaction figure, not 0% and not 98%.
    satisfaction: reviewCount > 0
      ? { averageRating: Math.round(Number(reviewRow.average ?? 0) * 10) / 10, reviewCount }
      : null,
  };
  cache = { at: Date.now(), value };
  return value;
}
