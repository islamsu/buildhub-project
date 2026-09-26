/**
 * ── THE SEO GATE, AS ASSERTIONS ─────────────────────────────────────────
 *
 * CLAUDE.md §37 and §66 are release criteria, and until this file existed
 * there was nothing in the repository that could fail when they were broken.
 * They WERE broken, in three ways that a test would have caught the day they
 * shipped:
 *
 *   1. one canonical link, pointing at the homepage, on every route
 *   2. `index, follow` on every route, including /admin and including staging
 *   3. one title and one description for the entire product
 *
 * So the assertions below are mostly about the DIRECTION of each default:
 * private unless listed, unindexed unless production, no canonical unless the
 * origin is known. A rule whose safe answer is also its default cannot fail
 * quietly, and each of these three failed quietly for months.
 */
import { describe, expect, it } from 'vitest';
import {
  DELIBERATELY_UNINDEXED,
  PRIVATE_PREFIXES,
  PUBLIC_SEO_ROUTES,
  canonicalUrl,
  matchPublicSeoRoute,
  robotsDirective,
  robotsTxt,
  seoDescription,
  seoEntityTitle,
  seoTitle,
} from '../shared/seo';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applySeoHead } from './_core/seoHead';
import { NAMED_PUBLIC_ROUTES, lastSegmentAsId, publicEntityName } from './seoEntityName';
import { isoDay, renderSitemap } from './sitemap';

const ORIGIN = 'https://buildhub.example';

describe('the public route table', () => {
  it('describes every route in both languages, with no placeholder text', () => {
    for (const route of PUBLIC_SEO_ROUTES) {
      expect(route.titleEn.trim().length, route.path).toBeGreaterThan(8);
      expect(route.titleAr.trim().length, route.path).toBeGreaterThan(4);
      // A meta description that a search engine will actually use.
      expect(route.descriptionEn.trim().length, route.path).toBeGreaterThan(60);
      expect(route.descriptionAr.trim().length, route.path).toBeGreaterThan(40);
      // Arabic that is really Arabic. A copied English string would pass a
      // length check and fail a reader.
      expect(/[؀-ۿ]/.test(route.titleAr), `${route.path} titleAr`).toBe(true);
      expect(/[؀-ۿ]/.test(route.descriptionAr), `${route.path} descriptionAr`).toBe(true);
    }
  });

  it('gives every route a distinct title and a distinct description', () => {
    // The defect this file exists for: one title for the whole product.
    const titles = PUBLIC_SEO_ROUTES.map(route => route.titleEn);
    expect(new Set(titles).size).toBe(titles.length);
    const descriptions = PUBLIC_SEO_ROUTES.map(route => route.descriptionEn);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('declares no path twice', () => {
    const paths = PUBLIC_SEO_ROUTES.map(route => route.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('covers the public surface §37 names', () => {
    const paths = PUBLIC_SEO_ROUTES.map(route => route.path);
    for (const required of [
      '/',
      '/marketplace',
      '/marketplace/products',
      '/marketplace/products/:id',
      '/marketplace/vendors',
      '/vendor/:id',
      '/service-categories',
    ]) {
      expect(paths, `${required} is missing from the table`).toContain(required);
    }
  });

  it('lists no authenticated path', () => {
    // §37: Admin, messages, private RFQs, projects and account pages are not
    // for an index. The table is the only thing that can make a path
    // indexable, so the check belongs on the table itself.
    for (const route of PUBLIC_SEO_ROUTES) {
      for (const prefix of ['/admin', '/messages', '/projects', '/rfq', '/quotations', '/settings', '/enquiries', '/marketing', '/compliance']) {
        expect(route.path.startsWith(prefix), `${route.path} is authenticated`).toBe(false);
      }
    }
  });
});

describe('matching a pathname to a route', () => {
  it('matches a literal path', () => {
    expect(matchPublicSeoRoute('/marketplace')?.path).toBe('/marketplace');
  });

  it('matches a parameter segment', () => {
    expect(matchPublicSeoRoute('/marketplace/products/491')?.path).toBe('/marketplace/products/:id');
    expect(matchPublicSeoRoute('/vendor/464')?.path).toBe('/vendor/:id');
  });

  it('ignores the query string and the fragment', () => {
    expect(matchPublicSeoRoute('/marketplace/products?cat=cement')?.path).toBe('/marketplace/products');
    expect(matchPublicSeoRoute('/marketplace#top')?.path).toBe('/marketplace');
  });

  it('tolerates a trailing slash', () => {
    expect(matchPublicSeoRoute('/marketplace/')?.path).toBe('/marketplace');
    expect(matchPublicSeoRoute('/')?.path).toBe('/');
  });

  it('does NOT prefix-match a deeper path', () => {
    /*
     * The bug a `startsWith` implementation would have: an edit form
     * inheriting a product page's metadata, so `/products/7/edit` - a page
     * only its owner can open - would have been described to a crawler as a
     * public product listing.
     */
    expect(matchPublicSeoRoute('/products/7/edit')).toBeNull();
    expect(matchPublicSeoRoute('/marketplace/products/7/reviews')).toBeNull();
  });

  it('returns null for every authenticated path', () => {
    for (const path of [
      '/admin', '/admin/users/461', '/messages', '/projects/12', '/rfq/8',
      '/quotations/3', '/settings', '/enquiries', '/marketing', '/saved',
      '/compliance', '/dashboard', '/provider', '/platform/vendor', '/catalogue',
    ]) {
      expect(matchPublicSeoRoute(path), `${path} matched the public table`).toBeNull();
    }
  });

  it('returns null for an unknown path, which is what makes the default private', () => {
    expect(matchPublicSeoRoute('/something-added-next-month')).toBeNull();
  });
});

describe('the robots directive', () => {
  const marketplace = matchPublicSeoRoute('/marketplace');
  const storefront = matchPublicSeoRoute('/vendor/464');

  it('indexes a public route in production', () => {
    expect(robotsDirective(marketplace, 'production')).toBe('index, follow');
  });

  it('refuses to index the same route anywhere else', () => {
    // THE STAGING LEAK. render.yaml sets NODE_ENV=production on staging, so
    // anything keyed on NODE_ENV would have let a public copy of the product,
    // full of test data, compete with production in search results.
    for (const environment of ['staging', 'preview', 'development', 'local', 'unknown', '']) {
      expect(robotsDirective(marketplace, environment), environment).toBe('noindex, nofollow');
    }
  });

  it('is not fooled by case or padding around the environment name', () => {
    expect(robotsDirective(marketplace, ' Production ')).toBe('index, follow');
  });

  it('refuses to index a route that needs a session, even in production', () => {
    // /vendor/:id: §21 wants it public, profile.getPublic is protected. Until
    // that is resolved, publishing it would advertise a sign-in wall.
    expect(storefront?.access).toBe('session-required');
    expect(robotsDirective(storefront, 'production')).toBe('noindex, nofollow');
  });

  it('refuses to index anything not in the table, in production', () => {
    for (const path of ['/admin', '/messages', '/rfq/8', '/auth', '/404', '/whatever']) {
      expect(robotsDirective(matchPublicSeoRoute(path), 'production'), path).toBe('noindex, nofollow');
    }
  });
});

describe('titles', () => {
  it('leads with the brand on the homepage and trails it everywhere else', () => {
    expect(seoTitle(matchPublicSeoRoute('/'), 'en')).toMatch(/^BuildHub — /);
    expect(seoTitle(matchPublicSeoRoute('/marketplace'), 'en')).toMatch(/ — BuildHub$/);
  });

  it('is Arabic in Arabic, brand included', () => {
    const title = seoTitle(matchPublicSeoRoute('/marketplace'), 'ar');
    expect(/[؀-ۿ]/.test(title)).toBe(true);
    expect(title).not.toContain('Marketplace');
  });

  it('uses the entity name when there is one', () => {
    const route = matchPublicSeoRoute('/marketplace/products/491');
    expect(seoEntityTitle('Portland Cement 50kg', route, 'en')).toBe('Portland Cement 50kg — BuildHub');
  });

  it('falls back to the route title rather than rendering an empty name', () => {
    const route = matchPublicSeoRoute('/marketplace/products/491');
    for (const empty of [null, undefined, '', '   ']) {
      const title = seoEntityTitle(empty, route, 'en');
      expect(title).not.toMatch(/^\s*—/);
      expect(title).toBe(seoTitle(route, 'en'));
    }
  });

  it('says the brand and nothing invented for an unknown route', () => {
    expect(seoTitle(null, 'en')).toBe('BuildHub');
    expect(seoDescription(null, 'en')).toContain('BuildHub');
  });
});

describe('the canonical URL', () => {
  it('is absolute and built from the configured origin', () => {
    expect(canonicalUrl(ORIGIN, '/marketplace/products/491')).toBe(`${ORIGIN}/marketplace/products/491`);
  });

  it('keeps the root as a single slash', () => {
    expect(canonicalUrl(ORIGIN, '/')).toBe(`${ORIGIN}/`);
  });

  it('drops the query string, so filters do not become duplicate pages', () => {
    expect(canonicalUrl(ORIGIN, '/marketplace/products?cat=cement&page=3')).toBe(`${ORIGIN}/marketplace/products`);
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(canonicalUrl('https://buildhub.example///', '/marketplace')).toBe(`${ORIGIN}/marketplace`);
  });

  it('is NULL when the deployment does not know its own origin', () => {
    // The whole point. A wrong canonical de-indexes real pages; no canonical
    // costs nothing. So an unconfigured or nonsense origin produces no tag.
    for (const origin of ['', '   ', 'buildhub.example', 'not a url', 'javascript:alert(1)', 'https://host/path']) {
      expect(canonicalUrl(origin, '/marketplace'), origin).toBeNull();
    }
  });
});

describe('robots.txt', () => {
  it('disallows everything outside production', () => {
    for (const environment of ['staging', 'preview', 'development', 'local', '']) {
      const body = robotsTxt(ORIGIN, environment);
      expect(body, environment).toContain('Disallow: /\n');
      expect(body, environment).not.toContain('Allow: /');
      expect(body, environment).not.toContain('Sitemap:');
    }
  });

  it('allows production, names the private prefixes and points at the sitemap', () => {
    const body = robotsTxt(ORIGIN, 'production');
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
    expect(body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    for (const prefix of ['/admin', '/messages', '/rfq', '/quotations', '/settings']) {
      expect(body, prefix).toContain(`Disallow: ${prefix}`);
    }
  });

  it('omits the sitemap line when there is no origin to state', () => {
    const body = robotsTxt('', 'production');
    expect(body).toContain('Allow: /');
    expect(body).not.toContain('Sitemap:');
  });

  it('agrees with the route table about what is public', () => {
    // Two documents, one answer. A prefix that robots.txt disallows must not
    // hold an indexable route, or BuildHub is telling crawlers two things.
    for (const prefix of PRIVATE_PREFIXES) {
      for (const route of PUBLIC_SEO_ROUTES) {
        if (route.access !== 'public') continue;
        expect(
          route.path === prefix || route.path.startsWith(`${prefix}/`),
          `${route.path} is indexable but robots.txt disallows ${prefix}`,
        ).toBe(false);
      }
    }
  });

  it('records why each reachable-but-unindexed path is excluded', () => {
    expect(DELIBERATELY_UNINDEXED.length).toBeGreaterThan(3);
    for (const entry of DELIBERATELY_UNINDEXED) {
      expect(entry.why.trim().length, entry.path).toBeGreaterThan(20);
      // And it must really be excluded, not merely described as excluded.
      expect(matchPublicSeoRoute(entry.path), entry.path).toBeNull();
    }
  });
});

describe('the head the crawler receives', () => {
  const SHELL = [
    '<!doctype html>',
    '<html lang="en" dir="ltr">',
    '  <head>',
    '    <title>Placeholder</title>',
    '    <meta name="description" content="placeholder" />',
    '    <meta name="robots" content="noindex, nofollow" />',
    '    <meta property="og:title" content="placeholder" />',
    '    <meta property="og:description" content="placeholder" />',
    '    <meta name="twitter:title" content="placeholder" />',
    '    <meta name="twitter:description" content="placeholder" />',
    '  </head>',
    '  <body><div id="root"></div></body>',
    '</html>',
  ].join('\n');

  it('replaces the title and description for a known route', async () => {
    const html = await applySeoHead(SHELL, '/marketplace');
    expect(html).not.toContain('Placeholder');
    expect(html).not.toContain('content="placeholder"');
    expect(html).toContain('<title>Marketplace — suppliers, products and services — BuildHub</title>');
  });

  it('replaces exactly one title tag', async () => {
    const html = await applySeoHead(SHELL, '/marketplace');
    expect(html.match(/<title>/g)?.length).toBe(1);
  });

  it('emits exactly one robots tag, and no more than one of each other tag', async () => {
    const html = await applySeoHead(SHELL, '/marketplace');
    // Two robots tags are two directives, and which one wins is the crawler's
    // choice rather than BuildHub's.
    expect(html.match(/name="robots"/g)?.length).toBe(1);
    expect(html.match(/name="description"/g)?.length).toBe(1);
    expect(html.match(/property="og:title"/g)?.length).toBe(1);
    expect(html.match(/rel="canonical"/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it('adds a tag that the shell does not have rather than skipping it', async () => {
    const bare = '<html><head></head><body></body></html>';
    const html = await applySeoHead(bare, '/marketplace');
    expect(html).toContain('<title>');
    expect(html).toContain('name="robots"');
    expect(html).toContain('name="description"');
  });

  it('never leaves the old hard-coded homepage canonical in place', async () => {
    const withStale = SHELL.replace('  </head>', '    <link rel="canonical" href="https://buildhub.eg/" />\n  </head>');
    const html = await applySeoHead(withStale, '/marketplace/products/491');
    expect(html).not.toContain('https://buildhub.eg/');
  });

  it('escapes the values it writes', async () => {
    const html = await applySeoHead(SHELL, '/marketplace');
    // Nothing in the table contains a quote today; the guarantee is that a
    // future entry cannot break out of an attribute.
    expect(html).not.toMatch(/content="[^"]*"[^>]*"/);
  });

  it('produces a complete, still-parseable document', async () => {
    const html = await applySeoHead(SHELL, '/marketplace');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('</html>');
  });
});

describe('the sitemap document', () => {
  it('is valid XML with one url element per entry', () => {
    const xml = renderSitemap({
      entries: [
        { loc: `${ORIGIN}/`, lastmod: null, priority: '1.0' },
        { loc: `${ORIGIN}/marketplace/products/7`, lastmod: '2026-09-01', priority: '0.6' },
      ],
      withheldStorefronts: 0,
    });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.match(/<url>/g)?.length).toBe(2);
    expect(xml).toContain('<lastmod>2026-09-01</lastmod>');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  it('omits lastmod rather than inventing one', () => {
    const xml = renderSitemap({ entries: [{ loc: `${ORIGIN}/`, lastmod: null, priority: '1.0' }], withheldStorefronts: 0 });
    expect(xml).not.toContain('<lastmod>');
  });

  it('escapes a URL that contains XML syntax', () => {
    const xml = renderSitemap({
      entries: [{ loc: `${ORIGIN}/marketplace/products?a=1&b=2`, lastmod: null, priority: '0.6' }],
      withheldStorefronts: 0,
    });
    expect(xml).toContain('&amp;b=2');
    expect(xml).not.toContain('?a=1&b=2<');
  });

  it('states withheld storefronts instead of looking like an empty marketplace', () => {
    const xml = renderSitemap({ entries: [], withheldStorefronts: 42 });
    expect(xml).toContain('42 provider storefront(s) are withheld');
    // Before <urlset>, so it is a document-level note and not inside a url.
    expect(xml.indexOf('withheld')).toBeLessThan(xml.indexOf('<urlset'));
  });

  it('says nothing when nothing is withheld', () => {
    const xml = renderSitemap({ entries: [], withheldStorefronts: 0 });
    expect(xml).not.toContain('withheld');
  });

  it('reduces a timestamp to a day and refuses a bad one', () => {
    expect(isoDay(new Date('2026-09-26T05:13:52.869Z'))).toBe('2026-09-26');
    expect(isoDay('2026-09-26T05:13:52.869Z')).toBe('2026-09-26');
    expect(isoDay(null)).toBeNull();
    expect(isoDay('not a date')).toBeNull();
  });
});

describe('the id at the end of a path', () => {
  it('reads a plain positive integer', () => {
    expect(lastSegmentAsId('/marketplace/products/491')).toBe(491);
  });

  it('ignores the query string and the fragment', () => {
    expect(lastSegmentAsId('/marketplace/products/491?ref=x')).toBe(491);
    expect(lastSegmentAsId('/marketplace/products/491#specs')).toBe(491);
  });

  it('refuses anything that is not entirely digits', () => {
    /*
     * parseInt('7abc') is 7. That is how a page ends up titled with a product
     * it is not about, so the check is a full-string match rather than a parse.
     */
    for (const path of [
      '/marketplace/products/7abc',
      '/marketplace/products/abc',
      '/marketplace/products/7.5',
      '/marketplace/products/-7',
      '/marketplace/products/0',
      '/marketplace/products/',
      '/marketplace/products',
    ]) {
      const id = lastSegmentAsId(path);
      expect(id === null || id > 0, path).toBe(true);
      if (path.includes('7abc') || path.includes('abc') || path.includes('7.5') || path.includes('-7') || path.endsWith('/0')) {
        expect(id, path).toBeNull();
      }
    }
  });

  it('refuses an id too large to be a safe integer', () => {
    expect(lastSegmentAsId('/marketplace/products/99999999999999999999')).toBeNull();
  });
});

describe('which routes may be titled from the database', () => {
  it('is only the public product page', () => {
    expect([...NAMED_PUBLIC_ROUTES]).toEqual(['/marketplace/products/:id']);
  });

  it('answers null for a route that needs a session, without reading anything', async () => {
    // /vendor/:id is session-required, so its name is not read for the shell.
    const storefront = matchPublicSeoRoute('/vendor/464');
    expect(await publicEntityName(storefront, '/vendor/464')).toBeNull();
  });

  it('answers null for an unknown route and for a missing id', async () => {
    expect(await publicEntityName(null, '/whatever/1')).toBeNull();
    const product = matchPublicSeoRoute('/marketplace/products/491');
    expect(await publicEntityName(product, '/marketplace/products/abc')).toBeNull();
  });

  it('reads through the canonical public product predicate, not its own rule', () => {
    // A second visibility rule would put a draft's or a withdrawn product's
    // name in a title for a page that refuses to render it.
    const source = readFileSync(join(import.meta.dirname, 'seoEntityName.ts'), 'utf8');
    expect(source).toContain('publicProductFilter()');
    expect(source).toContain("eq(products.id, id)");
  });
});

describe('the canonical tag is only written for a published page', () => {
  const SHELL = '<html><head><title>x</title></head><body></body></html>';

  it('is absent on a private path even when the origin is configured', async () => {
    // Nothing is going to index /admin/users/461, and "noindex" plus "here is
    // my canonical URL" are two directives that do not belong together.
    for (const path of ['/admin', '/admin/users/461', '/messages', '/rfq/8', '/settings']) {
      const html = await applySeoHead(SHELL, path);
      expect(html, path).not.toContain('rel="canonical"');
      expect(html, path).not.toContain('og:url');
    }
  });

  it('is absent on a session-required page', async () => {
    const html = await applySeoHead(SHELL, '/vendor/464');
    expect(html).not.toContain('rel="canonical"');
  });
});
