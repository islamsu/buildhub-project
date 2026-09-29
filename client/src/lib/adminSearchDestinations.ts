/**
 * WHERE A SEARCH RESULT OPENS.
 *
 * This lives apart from AdminPlatformSearch.tsx for the same reason
 * adminNavigation.ts lives apart from the sidebar: "does every destination the
 * search can emit actually exist?" has to be answerable by a test, and a test
 * cannot cheaply import a component that pulls in React, the tRPC client and
 * the icon set. Holding the map here makes that a real assertion about the
 * real map rather than a grep over a .tsx file.
 *
 * WHY IT MATTERS. The console used to recover a bid's destination by running a
 * regex over the hit's DISPLAY TEXT, so re-wording one label would have
 * unlinked every bid in the search with nothing failing. The server now names
 * the record a hit resolves against, and this is the single place that turns
 * that into a route.
 *
 * Routes stay a CLIENT concern - the server names a kind, not a URL, because
 * the server has no business knowing what the address bar looks like.
 */
import type { SearchLinkKind } from '../../../server/admin/platformSearch';

export const SEARCH_LINK_ROUTE: Readonly<Record<SearchLinkKind, (key: string) => string>> = {
  user: key => `/admin/users/${key}`,
  rfq: key => `/rfq/${key}`,
  product: key => `/marketplace/products/${key}`,
  project: key => `/admin/projects/${key}`,
  // The section catch-all serves these, and the section opens the case named
  // in the path. `/admin/disputes/12` is the dispute, not the queue.
  dispute: key => `/admin/disputes/${key}`,
  ticket: key => `/admin/support/${key}`,
  enquiry: key => `/admin/enquiries/${encodeURIComponent(key)}`,
};

/** The href for a hit, or null for a kind this build does not know. */
export function searchHitHref(link: { kind: string; key: string } | null | undefined): string | null {
  if (!link) return null;
  const route = (SEARCH_LINK_ROUTE as Record<string, ((key: string) => string) | undefined>)[link.kind];
  return route ? route(link.key) : null;
}
