import { listDirectoryVendors, PROVIDER_ROLES, type DirectoryVendor } from './vendorDirectory';

/**
 * BuildHub's provider recommendation engine.
 *
 * THE RANKING IS DETERMINISTIC AND SERVER-SIDE. The language model explains a
 * recommendation; it never chooses one. Handing an LLM an unranked list and
 * asking it to pick would make the ordering unauditable, unstable between
 * identical questions, and impossible to defend to a vendor who asks why a
 * competitor appeared above them. Every candidate below carries the reasons
 * that produced its score, and those reasons are what the model is allowed to
 * repeat.
 *
 * IT INVENTS NOTHING. Scoring uses only signals that exist as columns:
 * declared service categories, location text, approval and verification state,
 * average rating and review count. Availability, response time, years of
 * experience, portfolio relevance and price/budget fit are NOT stored by
 * BuildHub today, so they are not scored and must never be described. A
 * missing signal contributes zero - it never becomes an assumed value.
 *
 * AUTHORIZATION IS INHERITED, NOT REIMPLEMENTED. Candidates come from
 * listDirectoryVendors, which already restricts the directory to approved,
 * active, non-deactivated provider accounts and applies the dummy-account
 * rule. There is no second visibility filter here to drift out of step with
 * the first one, and no raw database access.
 */

export type RecommendationCriteria = {
  /** A provider role, when the request names one. */
  role?: string;
  /** A declared service category. */
  category?: string;
  /** Free text location, matched the way the directory matches it. */
  location?: string;
  /** Free text, matched against name and bio. */
  search?: string;
  limit?: number;
};

export type ScoredProvider = {
  vendor: DirectoryVendor;
  score: number;
  /** Why this provider scored what it did. The model may repeat these; it may not invent others. */
  reasons: string[];
};

export type RecommendationOutcome = {
  /**
   * exact      - candidates found on the criteria as asked
   * broadened  - nothing matched exactly; location or category was relaxed
   * none       - BuildHub has no suitable listed provider
   */
  matchQuality: 'exact' | 'broadened' | 'none';
  /** What was relaxed to find these, when anything was. */
  broadenedBy: string[];
  candidates: ScoredProvider[];
  /** The criteria actually used, after any broadening. */
  appliedCriteria: RecommendationCriteria;
};

export const MAX_RECOMMENDATIONS = 5;

/**
 * Weights are explicit and small on purpose. A recommendation should be
 * explainable in one sentence, which it cannot be if twelve signals each move
 * the score slightly.
 */
const WEIGHTS = {
  categoryMatch: 50,
  roleMatch: 25,
  locationMatch: 20,
  verified: 15,
  /** Rating contributes at most this much, and only with reviews behind it. */
  ratingMax: 20,
  /** Review volume is a confidence signal, deliberately capped low. */
  reviewVolumeMax: 10,
} as const;

const norm = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

export function scoreProvider(vendor: DirectoryVendor, criteria: RecommendationCriteria): ScoredProvider {
  let score = 0;
  const reasons: string[] = [];

  const wantedCategory = norm(criteria.category);
  if (wantedCategory) {
    const categories = vendor.categories.map(norm);
    if (categories.includes(wantedCategory)) {
      score += WEIGHTS.categoryMatch;
      reasons.push(`declares the service category "${criteria.category}"`);
    } else if (categories.some(c => c.includes(wantedCategory) || wantedCategory.includes(c))) {
      score += Math.round(WEIGHTS.categoryMatch / 2);
      reasons.push(`declares a related service category`);
    }
  }

  const wantedRole = norm(criteria.role);
  if (wantedRole && norm(vendor.userRole) === wantedRole) {
    score += WEIGHTS.roleMatch;
    reasons.push(`is a ${criteria.role} on BuildHub`);
  }

  const wantedLocation = norm(criteria.location);
  if (wantedLocation && norm(vendor.location).includes(wantedLocation)) {
    score += WEIGHTS.locationMatch;
    reasons.push(`is listed in ${vendor.location}`);
  }

  if (vendor.verified) {
    score += WEIGHTS.verified;
    reasons.push('is a verified BuildHub provider');
  }

  // Rating only counts when reviews exist. A 5.0 from zero reviews is not a
  // five-star provider, and treating it as one would be exactly the invented
  // attribute this engine must not produce.
  if (vendor.averageRating !== null && vendor.reviewCount > 0) {
    score += Math.round((vendor.averageRating / 5) * WEIGHTS.ratingMax);
    score += Math.min(vendor.reviewCount, 10) / 10 * WEIGHTS.reviewVolumeMax;
    reasons.push(`holds ${vendor.averageRating.toFixed(1)}/5 from ${vendor.reviewCount} review${vendor.reviewCount === 1 ? '' : 's'}`);
  }

  return { vendor, score: Math.round(score), reasons };
}

const rank = (vendors: DirectoryVendor[], criteria: RecommendationCriteria): ScoredProvider[] =>
  vendors
    .map(vendor => scoreProvider(vendor, criteria))
    .sort((a, b) =>
      b.score - a.score ||
      // Stable, explainable tiebreakers rather than whatever order the database
      // returned: more reviews first, then the longer-standing account.
      b.vendor.reviewCount - a.vendor.reviewCount ||
      a.vendor.id - b.vendor.id)
    .slice(0, criteria.limit ?? MAX_RECOMMENDATIONS);

/**
 * Search BuildHub first, then broaden, then admit there is no match.
 *
 * The broadening ladder is deliberate and bounded: drop the location, then
 * drop the category. Each step is REPORTED, because "no verified waterproofing
 * contractor in Alexandria, but here are waterproofing contractors elsewhere"
 * is a useful answer and "here are five contractors" pretending to match the
 * question is not.
 */
export async function recommendProviders(criteria: RecommendationCriteria): Promise<RecommendationOutcome> {
  const limit = criteria.limit ?? MAX_RECOMMENDATIONS;

  const exact = await listDirectoryVendors({
    category: criteria.category,
    location: criteria.location,
    search: criteria.search,
    limit: 50,
  });
  const exactRanked = rank(exact, { ...criteria, limit });
  if (exactRanked.length > 0) {
    return { matchQuality: 'exact', broadenedBy: [], candidates: exactRanked, appliedCriteria: criteria };
  }

  if (criteria.location) {
    const withoutLocation = await listDirectoryVendors({ category: criteria.category, search: criteria.search, limit: 50 });
    const ranked = rank(withoutLocation, { ...criteria, location: undefined, limit });
    if (ranked.length > 0) {
      return {
        matchQuality: 'broadened',
        broadenedBy: [`no match in "${criteria.location}" - searched all locations`],
        candidates: ranked,
        appliedCriteria: { ...criteria, location: undefined },
      };
    }
  }

  if (criteria.category) {
    const withoutCategory = await listDirectoryVendors({ location: criteria.location, search: criteria.search, limit: 50 });
    const ranked = rank(withoutCategory, { ...criteria, category: undefined, limit });
    if (ranked.length > 0) {
      return {
        matchQuality: 'broadened',
        broadenedBy: [`no provider declaring "${criteria.category}" - searched related providers`],
        candidates: ranked,
        appliedCriteria: { ...criteria, category: undefined },
      };
    }
  }

  return { matchQuality: 'none', broadenedBy: [], candidates: [], appliedCriteria: criteria };
}

/**
 * The candidate block handed to the model.
 *
 * Only the fields BuildHub actually holds, each candidate's reasons, and an
 * explicit statement of what BuildHub does NOT know - so the model has the
 * absent signals named rather than left to imagination.
 */
export function formatCandidatesForModel(outcome: RecommendationOutcome, lang: 'en' | 'ar'): string {
  if (outcome.matchQuality === 'none') {
    return `=== BUILDHUB PROVIDER SEARCH RESULT ===
NO SUITABLE BUILDHUB-LISTED PROVIDER was found for this request, after also
searching more broadly.

Tell the person plainly that BuildHub has no listed provider matching this, and
offer to help them post an RFQ so listed providers can quote. Do NOT name any
provider. Do NOT invent one. If - and only if - they explicitly ask for
providers outside BuildHub, anything you offer must be labelled
"External recommendation - not currently listed on BuildHub", and you must not
imply BuildHub has verified or endorsed it.
=== END ===`;
  }

  const header = outcome.matchQuality === 'broadened'
    ? `MATCH QUALITY: BROADENED. ${outcome.broadenedBy.join('; ')}. Say so - do not present these as exact matches.`
    : 'MATCH QUALITY: EXACT - these match the request as asked.';

  const rows = outcome.candidates.map((candidate, index) => {
    const v = candidate.vendor;
    const facts = [
      `role: ${v.userRole ?? 'unspecified'}`,
      `location: ${v.location ?? 'not stated'}`,
      `verified: ${v.verified ? 'yes' : 'no'}`,
      v.averageRating !== null && v.reviewCount > 0
        ? `rating: ${v.averageRating.toFixed(1)}/5 from ${v.reviewCount} review(s)`
        : 'rating: no reviews yet',
      v.categories.length ? `declared categories: ${v.categories.join(', ')}` : 'declared categories: none',
    ].join(' | ');
    return `  ${index + 1}. ${v.name ?? `Provider #${v.id}`} [BuildHub score ${candidate.score}]
     ${facts}
     why ranked here: ${candidate.reasons.length ? candidate.reasons.join('; ') : 'no matching signals beyond being listed and approved'}`;
  }).join('\n');

  return `=== BUILDHUB PROVIDER SEARCH RESULT ===
${header}

These are BuildHub-listed, approved providers, ranked by BuildHub's own scoring.
Present them in THIS ORDER. You did not choose this order and you must not
re-order it.

${rows}

WHAT BUILDHUB DOES NOT KNOW about these providers: availability, response time,
years of experience, portfolio relevance, current workload, and whether their
pricing fits any budget. BuildHub does not store those. Do not state, estimate
or imply any of them.

Say your suggestion is the "best match based on the available BuildHub data".
Do not claim any provider is the best in a city or the best overall - the data
does not support that.${lang === 'ar' ? '\nAnswer in Arabic.' : ''}
=== END ===`;
}
