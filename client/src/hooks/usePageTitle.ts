/**
 * ── THE BROWSER TAB ─────────────────────────────────────────────────────
 *
 * Every route shared one title, so every tab, every bookmark and every
 * browser-history entry said "BuildHub — AI-Powered Construction Operating
 * System". A buyer comparing four suppliers in four tabs could not tell them
 * apart, which is a small thing that is wrong on every single page.
 *
 * ── THIS IS NOT THE SEO FIX ─────────────────────────────────────────────
 *
 * server/_core/seoHead.ts already puts the route's title, description,
 * canonical and robots directive into the first response, and that is what a
 * crawler reads. This runs after React mounts and does two things that cannot
 * be done there: it uses the READER'S chosen language, and it can say the
 * name of the record on the page - "Portland Cement 50kg — BuildHub" - which
 * the server would need a database read per page view to know.
 *
 * Titles come from `shared/seo.ts`, the same table the server uses, so the two
 * cannot drift into disagreeing about what a page is called.
 */
import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useLanguage } from '../contexts/LanguageContext';
import { matchPublicSeoRoute, seoEntityTitle } from '../../../shared/seo';

/**
 * Title the current route.
 *
 * `entityName` is for a page ABOUT one record, and null or undefined means
 * "no name to show" - a listing page, or a record still loading. Both fall
 * back to the route's own title, so a page never flashes " — BuildHub" with
 * nothing in front of it while a query is in flight.
 */
export function usePageTitle(entityName?: string | null) {
  const { lang } = useLanguage();
  /*
   * The path is read here rather than passed in. A page that had to name its
   * own route would be a second copy of the routing table, and the copy that
   * goes stale is always the one nobody looks at.
   */
  const [pathname] = useLocation();

  useEffect(() => {
    const title = seoEntityTitle(entityName ?? null, matchPublicSeoRoute(pathname), lang);
    if (document.title !== title) document.title = title;
  }, [pathname, entityName, lang]);
}
