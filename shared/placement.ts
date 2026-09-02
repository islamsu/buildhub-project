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
 * THE PLATFORM-WIDE SCOPE TOKEN.
 *
 * Master Discovery is shown BEFORE a visitor has chosen a provider type or a
 * product category, so the placement that fills it cannot be scoped to one of
 * them. `category` on a placement row is the scope, and this reserved value is
 * the scope that means "the whole marketplace".
 *
 * WHY A RESERVED VALUE RATHER THAN "no category".
 *
 * Master capacity is one per scope. If "no category selected" simply meant
 * "any Master will do", then five category Masters would produce five
 * candidates for one exclusive slot and something would have to pick between
 * them arbitrarily - which is not exclusivity, it is a lottery an advertiser
 * paid for. A named scope keeps the guarantee exact: one live GLOBAL Master
 * provider, one live GLOBAL Master product, enforced by the same overlap check
 * that guards every other scope.
 *
 * It is NOT a wildcard. A GLOBAL placement does not leak into a category view,
 * and a category placement does not fill the global slot - see
 * server/publicPlacement.ts, which matches scope exactly.
 */
export const GLOBAL_PLACEMENT_SCOPE = 'GLOBAL';

export function isGlobalScope(category: string | null | undefined): boolean {
  return category === GLOBAL_PLACEMENT_SCOPE;
}

/** The label text, in both languages. Never colour alone - §20. */
export function placementLabelText(label: PlacementLabel, lang: string): string {
  const ar = lang === 'ar';
  if (label === 'SPONSORED') return ar ? 'إعلان مموّل' : 'Sponsored';
  return ar ? 'مختار' : 'Featured';
}
