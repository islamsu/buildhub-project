/**
 * ── REPORTING WHAT A READER ACTUALLY SAW ──────────────────────────────────
 *
 * The impression rule lives in shared/placementAnalytics.ts; this is its
 * implementation. Half of the element visible, for one continuous second, at
 * most once per placement per page view.
 *
 * WHY THE "ONCE" MATTERS MORE THAN IT LOOKS. React re-renders for reasons that
 * have nothing to do with the reader: a parent's state changed, a query
 * refetched on window focus, the language was toggled. Every one of those would
 * otherwise be another impression, and an advertiser would be billed for a
 * number that measures our render loop rather than their audience. The seen-set
 * below is what stops that, and it is keyed by placement id so two different
 * placements on one page each count once.
 *
 * ANALYTICS NEVER BREAKS THE PAGE. Every failure is swallowed. A visitor
 * browsing the marketplace must not see an error because a counter did not
 * increment, and a throttled report is simply dropped.
 */
import { useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import {
  IMPRESSION_DWELL_MS,
  IMPRESSION_VISIBLE_FRACTION,
  type PlacementClientEvent,
} from '@shared/placementAnalytics';

/**
 * Placements already counted in THIS page view.
 *
 * Module-level rather than component state on purpose: a component that
 * unmounts and remounts - a filter change, a route transition back - must not
 * start counting again. It is cleared on a real navigation, below.
 */
const seenThisView = new Set<number>();

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => seenThisView.clear());
}

export function usePlacementReporter() {
  const report = trpc.marketplace.recordPlacementEvent.useMutation({
    // A failed or throttled report changes nothing the reader can see.
    onError: () => undefined,
  });
  const send = (placementId: number, event: PlacementClientEvent) => {
    if (!placementId) return;
    try { report.mutate({ placementId, event }); } catch { /* never breaks the page */ }
  };
  return send;
}

/**
 * Count an impression when the element has been half visible for a second.
 *
 * Returns a ref to attach to the rendered placement. When
 * IntersectionObserver is unavailable the hook falls back to the
 * mounted-and-painted definition after the same dwell - strictly more
 * conservative in every respect except viewport position, and stated in the
 * shared rule rather than hidden here.
 */
export function useImpression(placementId: number | undefined) {
  const ref = useRef<HTMLDivElement | null>(null);
  const send = usePlacementReporter();

  useEffect(() => {
    const element = ref.current;
    if (!placementId || !element) return;
    if (seenThisView.has(placementId)) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const count = () => {
      // Re-checked at fire time, not only at schedule time: two observers for
      // the same placement could otherwise both be in flight.
      if (seenThisView.has(placementId)) return;
      seenThisView.add(placementId);
      send(placementId, 'IMPRESSION');
    };

    if (typeof IntersectionObserver === 'undefined') {
      timer = setTimeout(count, IMPRESSION_DWELL_MS);
      return () => clearTimeout(timer);
    }

    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= IMPRESSION_VISIBLE_FRACTION) {
          // Start the clock. Scrolling away before it fires cancels it, which
          // is the "scrolled past at speed is not seen" clause.
          if (timer === undefined) timer = setTimeout(count, IMPRESSION_DWELL_MS);
        } else if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
      }
    }, { threshold: [IMPRESSION_VISIBLE_FRACTION] });

    observer.observe(element);
    return () => {
      observer.disconnect();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [placementId, send]);

  return ref;
}
