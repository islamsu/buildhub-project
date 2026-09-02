/**
 * ── WHAT COUNTS AS AN IMPRESSION, AND WHY ─────────────────────────────────
 *
 * AN API CALL IS NOT AN IMPRESSION. The server answering `masterProvider` says
 * only that a page asked the question. The page may have been a prefetch, a
 * bot, a tab restored in the background, or a React Query refetch on window
 * focus. Counting those would inflate an advertiser's numbers with events no
 * human ever saw, which is the most ordinary way commercial analytics become a
 * lie - and the advertiser is the one who pays for the lie.
 *
 * THE RULE THIS FILE DEFINES, in full:
 *
 *   An impression is recorded when a placement's rendered element has been
 *   AT LEAST HALF VISIBLE in the viewport for AT LEAST ONE CONTINUOUS SECOND,
 *   and AT MOST ONCE per placement per page view.
 *
 * Each clause earns its place:
 *
 *   RENDERED         a fetched-but-never-drawn placement is not seen.
 *   HALF VISIBLE     a sliver at the edge of the viewport is not seen. 50% is
 *                    the threshold most ad standards settle on, and picking a
 *                    published convention beats inventing a private one.
 *   ONE SECOND       a placement scrolled past at speed is not seen.
 *   ONCE PER VIEW    the defence against rerender inflation. React re-renders
 *                    for reasons that have nothing to do with the reader -
 *                    a parent state change, a refetch, a language toggle - and
 *                    every one of those would otherwise be another "view".
 *
 * WHAT THIS RULE CANNOT DO. It cannot prove a human looked. Nothing available
 * to a web page can. It is a conservative, documented, checkable approximation,
 * and it is written down here so that what BuildHub sells is a defined thing
 * rather than a number of unexplained origin.
 *
 * WHEN IntersectionObserver IS UNAVAILABLE, the client falls back to the
 * mounted-and-painted definition and records at most one impression per
 * placement per page view. That is strictly more conservative in every respect
 * except viewport position, and the fallback is stated rather than hidden.
 */

/** Fraction of the element that must be inside the viewport. */
export const IMPRESSION_VISIBLE_FRACTION = 0.5;

/** Continuous milliseconds at that visibility before an impression counts. */
export const IMPRESSION_DWELL_MS = 1000;

/**
 * The four placement events, as the client may report them.
 *
 * A closed set, because the reporting endpoint is PUBLIC - it has to be, since
 * most marketplace browsing is anonymous - and a public writer must not be able
 * to invent event types in an analytics table that an owner reads as fact.
 */
export const PLACEMENT_CLIENT_EVENTS = ['IMPRESSION', 'ENTITY_VIEW', 'CTA_CLICK'] as const;
export type PlacementClientEvent = (typeof PLACEMENT_CLIENT_EVENTS)[number];

export function isPlacementClientEvent(value: unknown): value is PlacementClientEvent {
  return typeof value === 'string' && (PLACEMENT_CLIENT_EVENTS as readonly string[]).includes(value);
}

/**
 * NOTE ON WHAT IS DELIBERATELY ABSENT.
 *
 * QUALIFIED_ENQUIRY is NOT in the client-reportable set. A browser must never
 * be able to assert that a business relationship exists - that event is written
 * server-side, from the RFQ or enquiry record itself, at the moment the real
 * relationship is created. A visitor who can POST their own conversions is a
 * visitor who can manufacture an advertiser's performance report.
 */

/**
 * The commercial metrics, with their formulas stated rather than implied.
 *
 * Written as data so the Admin screen and the tests read the SAME definition.
 * A rate computed one way in a report and another way in a test is how two
 * people end up arguing about a number that means nothing.
 */
export const PLACEMENT_METRIC_FORMULAS = {
  ctr: 'CTA actions ÷ impressions',
  viewRate: 'entity views ÷ impressions',
  conversionRate: 'attributed qualified enquiries ÷ entity views',
} as const;

/**
 * A rate, or null when the denominator is zero.
 *
 * NULL, not zero. "0%" asserts that nobody clicked; with no impressions at all
 * the truthful answer is that there is nothing to compute yet, and the screen
 * must say so rather than showing a figure that reads like failure.
 */
export function rate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}
