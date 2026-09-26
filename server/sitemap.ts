/**
 * ── THE SITEMAP, BUILT FROM THE CATALOGUE THAT ACTUALLY EXISTS ───────────
 *
 * There was no sitemap and no robots.txt. A marketplace whose whole value is
 * that buyers can find suppliers had nothing telling a crawler which of its
 * URLs were worth fetching, and the shell's `<head>` was actively telling it
 * the opposite (see shared/seo.ts).
 *
 * ── THE SAME PREDICATES THE CATALOGUE USES, NOT NEW ONES ─────────────────
 *
 * Every product URL comes from `publicProductFilter()` and every provider URL
 * from `directoryVisibilityFilter()` - the canonical predicates the marketplace
 * itself reads through. §11: one canonical rule, not a second copy that drifts.
 *
 * The drift would not be cosmetic. A sitemap built from its own idea of
 * "visible" would advertise drafts, withdrawn products, archived rows or
 * unapproved providers - pages the product refuses to render - and hand a
 * crawler a list of URLs that answer 404 or an empty state. The rule has to be
 * the same rule.
 *
 * ── AND A DATABASE FAILURE IS NOT AN EMPTY CATALOGUE ────────────────────
 *
 * §10: ERROR != EMPTY. A sitemap is the one document where that mistake is
 * durable - a crawler that fetches a valid, well-formed, EMPTY sitemap has
 * been told, in XML, that BuildHub has no products and no suppliers, and it
 * may act on that for as long as it caches. So an unreachable database throws,
 * the route answers 503, and the crawler retries later with nothing learned.
 */
import { desc, sql } from 'drizzle-orm';
import { products, users } from '../drizzle/schema';
import { requireDb } from './_core/requireDb';
import { publicProductFilter } from './productLifecycle';
import { directoryVisibilityFilter } from './vendorDirectory';
import { PUBLIC_SEO_ROUTES, canonicalUrl } from '../shared/seo';

/** How many entity URLs one sitemap carries. The spec's ceiling is 50,000. */
export const SITEMAP_URL_LIMIT = 10_000;

export type SitemapEntry = {
  readonly loc: string;
  readonly lastmod: string | null;
  /** Relative importance within THIS site only - never a ranking claim. */
  readonly priority: string;
};

/**
 * Collect every public URL.
 *
 * Entity rows are ordered by most-recently-updated and capped, so a catalogue
 * that outgrows one document loses its stalest entries rather than being
 * truncated at whatever the database happened to return first.
 */
export type SitemapCollection = {
  readonly entries: readonly SitemapEntry[];
  /**
   * How many provider storefronts this deployment WOULD publish if
   * `/vendor/:id` did not require a session. Counted through the canonical
   * directory predicate, reported rather than advertised, and stated in the
   * document so the omission is visible instead of looking like an empty
   * catalogue.
   */
  readonly withheldStorefronts: number;
};

export async function collectSitemapEntries(origin: string): Promise<SitemapCollection> {
  const db = await requireDb();
  const entries: SitemapEntry[] = [];

  for (const route of PUBLIC_SEO_ROUTES) {
    // A `:param` route is a TEMPLATE. Listing it literally would advertise
    // `/vendor/:id`, which is not a page.
    if (route.path.includes(':')) continue;
    // And a page that needs a session is not published, however good its
    // metadata is. See `access` in shared/seo.ts.
    if (route.access !== 'public') continue;
    const loc = canonicalUrl(origin, route.path);
    if (!loc) continue;
    entries.push({ loc, lastmod: null, priority: route.path === '/' ? '1.0' : '0.8' });
  }

  const productRows = await db
    .select({ id: products.id, updatedAt: products.updatedAt })
    .from(products)
    .where(publicProductFilter())
    .orderBy(desc(products.updatedAt))
    .limit(SITEMAP_URL_LIMIT);

  for (const row of productRows) {
    const loc = canonicalUrl(origin, `/marketplace/products/${row.id}`);
    if (loc) entries.push({ loc, lastmod: isoDay(row.updatedAt), priority: '0.6' });
  }

  /*
   * ── THE PROVIDER STOREFRONTS ARE NOT HERE, AND THAT IS THE FINDING ──────
   *
   * `/vendor/:id` is the marketplace's most important destination and §21 and
   * §37 both describe it as public. It is not: `profile.getPublic` is a
   * protectedProcedure, so a logged-out reader - every crawler - gets a
   * sign-in wall. Listing thousands of those URLs would publish a claim this
   * product does not honour.
   *
   * `directoryVisibilityFilter` is still read below - ONLY to count how many
   * storefronts this deployment would publish the moment that access decision
   * changes. The number is reported in the document, nothing is advertised,
   * and when `access` flips to 'public' in shared/seo.ts this count becomes
   * the loop.
   */
  const [withheld] = await db
    .select({ total: sql<number>`count(*)` })
    .from(users)
    .where(directoryVisibilityFilter());

  return { entries, withheldStorefronts: Number(withheld?.total ?? 0) };
}

/** Date only. A sitemap does not need the minute, and an invalid date is omitted. */
export function isoDay(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Serialise. Escaped even though every URL here is built from an integer id and
 * a configured origin: the escaping is a property of writing XML, not a
 * reaction to a known dangerous input, and the one day a slug appears in a URL
 * this must already be correct.
 */
export function renderSitemap(collection: SitemapCollection): string {
  const { entries, withheldStorefronts } = collection;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
  ];
  if (withheldStorefronts > 0) {
    /*
     * SAID OUT LOUD. A sitemap with no storefronts in it looks like a
     * marketplace with no suppliers, and the difference between "none exist"
     * and "none may be published yet" is the difference this project keeps
     * insisting on. A comment is the only place a sitemap can carry it.
     */
    lines.push(
      `<!-- ${withheldStorefronts} provider storefront(s) are withheld: /vendor/:id requires a session, so its URLs are not published. -->`
    );
  }
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  for (const entry of entries) {
    lines.push('  <url>');
    lines.push(`    <loc>${xml(entry.loc)}</loc>`);
    if (entry.lastmod) lines.push(`    <lastmod>${xml(entry.lastmod)}</lastmod>`);
    lines.push(`    <priority>${xml(entry.priority)}</priority>`);
    lines.push('  </url>');
  }
  lines.push('</urlset>');
  return `${lines.join('\n')}\n`;
}

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
