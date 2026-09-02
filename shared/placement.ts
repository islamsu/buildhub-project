/**
 * COMMERCIAL PLACEMENT — the vocabulary the server and the browser must agree on.
 *
 * The booking engine (server/placementBooking.ts) decides what may be sold and
 * to whom. This file holds the two facts a RENDERER also needs: what scope a
 * placement occupies, and what the public is told about why it is there.
 *
 * It is deliberately tiny and free of database imports so the client bundle can
 * hold it without pulling drizzle in.
 */

export type PlacementSource =
  | 'PAID_SPONSORSHIP'
  | 'ADMIN_EDITORIAL'
  | 'REFERRAL_REWARD'
  | 'PROMOTIONAL_COMP';

export type PlacementLabel = 'SPONSORED' | 'FEATURED';

/**
 * WHAT THE PUBLIC IS TOLD, derived from WHO PAID.
 *
 * Only money buys the word "Sponsored". Everything else - an editorial pick, a
 * referral reward, a comped promotion - is "Featured".
 *
 * The rule runs in this direction and not the other. If a new source is added
 * and nobody updates this function, an advertiser must not silently inherit the
 * editorial word, so the mapping is exhaustive on PAID and defaults the rest to
 * FEATURED only because the rest are, by construction, unpaid. A future PAID_*
 * source must be added to the paid set below, and the test in
 * server/publicPlacement.test.ts fails if a source is left unclassified.
 */
const PAID_SOURCES: readonly PlacementSource[] = ['PAID_SPONSORSHIP'];

export function placementLabel(source: string | null | undefined): PlacementLabel {
  return PAID_SOURCES.includes(source as PlacementSource) ? 'SPONSORED' : 'FEATURED';
}

/**
 * ── THE ROOT TAXONOMY SCOPE TOKEN ─────────────────────────────────────────
 *
 * Master Discovery is shown BEFORE a visitor has chosen a provider type or a
 * product category, so the placement that fills it cannot be scoped to one of
 * them. `category` on a placement row is the TAXONOMY scope, and this reserved
 * value is the scope meaning "the root of the taxonomy".
 *
 * WHAT IT MEANS, EXACTLY (owner-defined, and deliberately narrow):
 *
 *   ROOT / TAXONOMY-WIDE DISCOVERY WITHIN THE APPLICABLE GEOGRAPHIC MARKET.
 *
 * WHAT IT DOES NOT MEAN: one worldwide BuildHub placement across every
 * country, forever. The name is the only thing about it that sounds global.
 *
 * COMMERCIAL PLACEMENT HAS FOUR INDEPENDENT DIMENSIONS:
 *
 *   GEOGRAPHIC SCOPE  ·  TAXONOMY SCOPE  ·  SURFACE  ·  TIME
 *
 * This constant is a value of the TAXONOMY dimension ONLY. It says nothing
 * about geography, and it must never be read as though it did. Saudi Arabia +
 * root taxonomy + Master and Egypt + root taxonomy + Master are two DIFFERENT
 * pieces of inventory that must not compete for the same exclusive slot.
 *
 * WHY THERE IS NO MARKET COLUMN YET. BuildHub does not currently expose a
 * geographic market dimension on placements, and inventing one before the
 * business needs it would be building a feature out of a comment. So the
 * geographic dimension is carried structurally rather than physically: every
 * scope-matched query in server/publicPlacement.ts goes through ONE typed
 * `PlacementScope` value, so adding `market` later is a change to that type and
 * the queries that consume it - not an archaeology exercise across the codebase
 * hunting for places that assumed one worldwide slot.
 *
 * WHY A RESERVED VALUE RATHER THAN "no category".
 *
 * Master capacity is one per scope. If "no category selected" simply meant
 * "any Master will do", then five category Masters would produce five
 * candidates for one exclusive slot and something would have to pick between
 * them arbitrarily - which is not exclusivity, it is a lottery an advertiser
 * paid for. A named scope keeps the guarantee exact.
 *
 * It is NOT a wildcard in either direction. A root-scope placement does not
 * leak into a category view, and a category placement does not fill the root
 * slot - see server/publicPlacement.ts, which matches scope exactly.
 */
export const GLOBAL_PLACEMENT_SCOPE = 'GLOBAL';

export function isGlobalScope(category: string | null | undefined): boolean {
  return category === GLOBAL_PLACEMENT_SCOPE;
}

/**
 * The scope a placement occupies, as ONE value rather than a loose string.
 *
 * `market` is declared and currently always undefined: BuildHub sells one
 * geographic market today, so there is nothing to store and no column to read.
 * It exists here so that the day a second market opens, the compiler points at
 * every site that has to account for it. A bare `category: string` would let
 * that day arrive silently, with a Saudi Master and an Egyptian Master quietly
 * contesting one slot.
 */
export type PlacementScope = {
  /** Taxonomy scope: a category/type from the shared taxonomy, or the root. */
  taxonomy: string;
  /**
   * Geographic market. UNUSED TODAY - see above. Never persisted yet; when it
   * is, it becomes part of the uniqueness key for capacity, not a filter bolted
   * on afterwards.
   */
  market?: undefined;
};

/** The root taxonomy scope, within whatever market is applicable. */
export function rootScope(): PlacementScope {
  return { taxonomy: GLOBAL_PLACEMENT_SCOPE };
}

/** A scope for one taxonomy value, or the root when none is selected. */
export function scopeFor(taxonomy: string | null | undefined): PlacementScope {
  return { taxonomy: taxonomy || GLOBAL_PLACEMENT_SCOPE };
}

/** The label text, in both languages. Never colour alone - §20. */
export function placementLabelText(label: PlacementLabel, lang: string): string {
  const ar = lang === 'ar';
  if (label === 'SPONSORED') return ar ? 'إعلان مموّل' : 'Sponsored';
  return ar ? 'مختار' : 'Featured';
}
