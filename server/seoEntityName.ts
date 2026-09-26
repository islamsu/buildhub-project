/**
 * ── THE NAME OF THE RECORD A PUBLIC PAGE IS ABOUT ───────────────────────
 *
 * Read for the HTML shell's `<title>` only (server/_core/seoHead.ts), so a
 * crawler that runs no JavaScript gets "Portland Cement 50kg — BuildHub"
 * rather than the same generic title on every product in the catalogue.
 *
 * ── THREE RULES, ALL OF THEM ABOUT NOT MAKING THINGS WORSE ──────────────
 *
 * ONLY WHERE IT IS ALREADY PUBLIC. The lookup runs for the product page and
 * nothing else. `/vendor/:id` needs a session (see `access` in shared/seo.ts),
 * so its name is not read here - a page that is not indexable does not need
 * its title in the first response, and not reading is the simplest way to be
 * sure nothing is published early.
 *
 * ONLY WHAT THE CATALOGUE ITSELF WOULD SHOW. `publicProductFilter()` - the
 * same predicate the marketplace reads through. Without it a draft's or a
 * withdrawn product's name would appear in a title for a page that refuses to
 * render it.
 *
 * AND NEVER AT THE COST OF THE PAGE. Any failure returns null and the caller
 * falls back to the route's generic title. A database outage must not turn
 * every public page into an error - §10, and the page itself already has its
 * own honest error state.
 */
import { and, eq } from 'drizzle-orm';
import { products } from '../drizzle/schema';
import { getDb } from './db';
import { publicProductFilter } from './productLifecycle';
import type { SeoRoute } from '../shared/seo';

/** The route patterns this can answer for. Anything else returns null. */
export const NAMED_PUBLIC_ROUTES = ['/marketplace/products/:id'] as const;

export async function publicEntityName(route: SeoRoute | null, pathname: string): Promise<string | null> {
  if (!route || route.access !== 'public') return null;
  if (!NAMED_PUBLIC_ROUTES.includes(route.path as typeof NAMED_PUBLIC_ROUTES[number])) return null;

  const id = lastSegmentAsId(pathname);
  if (id === null) return null;

  try {
    const db = await getDb();
    if (!db) return null;
    const [row] = await db
      .select({ name: products.name })
      .from(products)
      .where(and(eq(products.id, id), publicProductFilter()))
      .limit(1);
    const name = (row?.name ?? '').trim();
    return name.length > 0 ? name : null;
  } catch {
    // The title degrades to the route's own. The page is unaffected.
    return null;
  }
}

/**
 * The id from the end of the path, or null.
 *
 * Strict on purpose: `/marketplace/products/7abc` is not product 7.
 * `Number('7abc')` is NaN, but `parseInt` would have said 7 - which is how a
 * page ends up titled with a record it is not about.
 */
export function lastSegmentAsId(pathname: string): number | null {
  const parts = pathname.split('?')[0].split('#')[0].split('/').filter(part => part.length > 0);
  const last = parts[parts.length - 1];
  if (!last || !/^\d+$/.test(last)) return null;
  const id = Number(last);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
