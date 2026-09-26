/**
 * ── WHAT EACH PUBLIC PAGE TELLS A CRAWLER ───────────────────────────────
 *
 * BuildHub is a single-page application served from ONE HTML shell. Every
 * route - the homepage, a product, a supplier's storefront, the admin console,
 * a private RFQ - was handed byte-identical `<head>` metadata, and three of
 * those bytes were actively harmful:
 *
 *   <link rel="canonical" href="https://buildhub.eg/">
 *
 * On every route. A canonical link is not a hint about the site, it is a
 * declaration that THIS URL is a duplicate of THAT one. So the shell told
 * every crawler that the entire catalogue - every product, every provider
 * storefront, every category - was a duplicate of the homepage, which is a
 * request to index the homepage and drop the rest. For a marketplace whose
 * discovery depends on those pages being findable, it is the single most
 * damaging line in the file.
 *
 *   <meta name="robots" content="index, follow">
 *
 * Also on every route, and unconditional. That invited indexing of `/admin`,
 * `/messages`, private RFQs, quotations, projects and account pages, which
 * CLAUDE.md §37 requires to stay out of an index - and it invited indexing of
 * the STAGING PREVIEW, which is a public copy of the product carrying test
 * data and would compete with production for its own search results.
 *
 *   <title>BuildHub — AI-Powered Construction Operating System</title>
 *
 * On every route, so no page had a unique title (§66) and every browser tab
 * and bookmark said the same thing.
 *
 * ── WHY THE TABLE IS HERE AND NOT IN THE SERVER ─────────────────────────
 *
 * Three readers need the same answer and must not disagree:
 *
 *   the HTML shell     titles/description/canonical/robots, injected per
 *                      request so a crawler that runs no JavaScript still
 *                      gets them
 *   the client         the same title, refined with the entity's own name
 *                      once the data arrives
 *   robots.txt and the sitemap, which have to agree with both about which
 *                      paths are public at all
 *
 * ── PRIVATE BY DEFAULT ──────────────────────────────────────────────────
 *
 * A path absent from this table is NOT indexable. That direction matters: a
 * new page added next month is private to crawlers until somebody writes it
 * down here, rather than being exposed because nobody remembered to exclude
 * it. Listing is an act; leaking should not be.
 *
 * ── AND ONLY PRODUCTION IS INDEXABLE ────────────────────────────────────
 *
 * Being listed here earns a page nothing outside production. `robotsDirective`
 * takes the deployment name from the build stamp, and staging, preview and
 * local all resolve to `noindex, nofollow` no matter what the table says.
 */

export type SeoRoute = {
  /** The wouter path this describes, `:param` segments included. */
  readonly path: string;
  /**
   * CAN A READER WITH NO SESSION SEE THIS PAGE?
   *
   * `session-required` is not a variation of `public` - it changes what may
   * truthfully be said about the page. The route still gets a real title and
   * description, because a signed-in reader's browser tab deserves them, but
   * it is never indexable and never appears in the sitemap: advertising a URL
   * that answers with a sign-in wall wastes a crawl and, worse, publishes a
   * claim that a page is readable when it is not.
   *
   * THE ONE ROUTE THAT CARRIES IT IS `/vendor/:id`, and that is a finding, not
   * a design: §21 and §37 both describe the provider storefront as a public
   * page, and `profile.getPublic` is a `protectedProcedure`. The code there
   * records logged-out access as an unresolved owner decision, so this field
   * states the situation truthfully rather than quietly resolving it in a
   * sitemap. When the owner decides, one word here moves the title, the meta
   * robots tag and the sitemap together.
   */
  readonly access: 'public' | 'session-required';
  readonly titleEn: string;
  readonly titleAr: string;
  readonly descriptionEn: string;
  readonly descriptionAr: string;
};

/** The suffix every page title carries, so a tab is identifiable at any width. */
export const SEO_BRAND_EN = 'BuildHub';
export const SEO_BRAND_AR = 'بيلد هَب';

/**
 * THE PUBLIC SURFACE. §37 names it: marketplace, categories, provider
 * profiles, products. Nothing that requires a session appears below, because
 * a page that needs a session cannot be crawled and should not be advertised.
 */
export const PUBLIC_SEO_ROUTES: readonly SeoRoute[] = [
  {
    path: '/',
    access: 'public',
    titleEn: 'Construction sourcing, quotations and projects',
    titleAr: 'توريد مواد البناء وعروض الأسعار وإدارة المشروعات',
    descriptionEn:
      'Source verified construction suppliers and professionals, request quotations, compare them side by side, and run the project from one place.',
    descriptionAr:
      'ابحث عن موردين ومهنيين موثّقين في قطاع البناء، واطلب عروض أسعار، وقارن بينها، وأدر مشروعك من مكان واحد.',
  },
  {
    path: '/marketplace',
    access: 'public',
    titleEn: 'Marketplace — suppliers, products and services',
    titleAr: 'السوق — الموردون والمنتجات والخدمات',
    descriptionEn:
      'Browse construction suppliers, materials, finishing companies and design professionals by category, specialty and service area.',
    descriptionAr:
      'استعرض موردي البناء والمواد وشركات التشطيب ومهنيي التصميم حسب الفئة والتخصص ومنطقة الخدمة.',
  },
  {
    path: '/marketplace/products',
    access: 'public',
    titleEn: 'Construction products and materials',
    titleAr: 'منتجات ومواد البناء',
    descriptionEn:
      'Search construction materials and products by category, brand, specification and supplier, and request a quotation from the supplier directly.',
    descriptionAr:
      'ابحث في مواد ومنتجات البناء حسب الفئة والعلامة التجارية والمواصفات والمورد، واطلب عرض سعر من المورد مباشرة.',
  },
  {
    path: '/marketplace/products/:id',
    access: 'public',
    /*
     * The FALLBACK title. A product page is normally titled with the product's
     * own name - server/seoEntityName.ts reads it for the first response and
     * the client refines it - and this is what is shown when that name cannot
     * be read, which is a degraded title rather than a wrong one.
     */
    titleEn: 'Product specifications and supplier',
    titleAr: 'مواصفات المنتج والمورد',
    descriptionEn:
      'Product specifications, unit, supplier and availability, with the option to request a quotation or add the product to a request for quotation.',
    descriptionAr:
      'مواصفات المنتج والوحدة والمورد والتوافر، مع إمكانية طلب عرض سعر أو إضافة المنتج إلى طلب عرض أسعار.',
  },
  {
    path: '/marketplace/vendors',
    access: 'public',
    titleEn: 'Construction suppliers',
    titleAr: 'موردو البناء',
    descriptionEn:
      'Verified construction material suppliers by category, location and service area, with their catalogues and credentials.',
    descriptionAr:
      'موردو مواد البناء الموثّقون حسب الفئة والموقع ومنطقة الخدمة، مع كتالوجاتهم ومؤهلاتهم.',
  },
  {
    path: '/marketplace/designers',
    access: 'public',
    titleEn: 'Architects and designers',
    titleAr: 'المعماريون والمصممون',
    descriptionEn:
      'Architects, interior designers and design practices, with their specialties, service areas and portfolios.',
    descriptionAr:
      'المعماريون ومصممو الديكور ومكاتب التصميم، مع تخصصاتهم ومناطق خدمتهم وأعمالهم السابقة.',
  },
  {
    path: '/marketplace/finishing',
    access: 'public',
    titleEn: 'Finishing and fit-out companies',
    titleAr: 'شركات التشطيب والتجهيز',
    descriptionEn:
      'Finishing and fit-out companies by specialty and service area, with their portfolios and verified credentials.',
    descriptionAr:
      'شركات التشطيب والتجهيز حسب التخصص ومنطقة الخدمة، مع أعمالها السابقة ومؤهلاتها الموثّقة.',
  },
  {
    path: '/vendor/:id',
    access: 'session-required',
    titleEn: 'Supplier storefront',
    titleAr: 'متجر المورد',
    descriptionEn:
      'Company profile, categories, service areas, products, services, portfolio, verified credentials and reviews — with contact and quotation requests.',
    descriptionAr:
      'ملف الشركة والفئات ومناطق الخدمة والمنتجات والخدمات والأعمال السابقة والمؤهلات الموثّقة والتقييمات — مع التواصل وطلب عروض الأسعار.',
  },
  {
    path: '/service-categories',
    access: 'public',
    titleEn: 'Service categories',
    titleAr: 'فئات الخدمات',
    descriptionEn:
      'Every construction service category on BuildHub, from structural works to finishing, with the providers who cover each one.',
    descriptionAr:
      'كل فئات خدمات البناء على بيلد هَب، من الأعمال الإنشائية إلى التشطيب، مع مقدّمي الخدمة في كل فئة.',
  },
  {
    path: '/pricing',
    access: 'public',
    titleEn: 'Plans for suppliers and professionals',
    titleAr: 'خطط الموردين والمهنيين',
    descriptionEn:
      'What each BuildHub plan includes for suppliers and professionals: qualified enquiries, catalogue capacity and marketplace visibility.',
    descriptionAr:
      'ما تتضمنه كل خطة في بيلد هَب للموردين والمهنيين: الطلبات المؤهلة وسعة الكتالوج والظهور في السوق.',
  },
];

/**
 * Paths that exist, are reachable without a session, and are STILL not for an
 * index. Kept explicit rather than left to the default so the decision is on
 * the record instead of looking like an omission.
 */
export const DELIBERATELY_UNINDEXED: readonly { readonly path: string; readonly why: string }[] = [
  { path: '/auth', why: 'a sign-in form: no content to rank, and a search result landing on it helps nobody' },
  { path: '/auth/reset-password', why: 'reached only from a one-time token in an email' },
  { path: '/auth/setup-password', why: 'reached only from a one-time invitation token' },
  { path: '/admin/login', why: 'an administrator sign-in page must not be advertised' },
  { path: '/admin/accept-invitation', why: 'reached only from a one-time administrator invitation' },
  { path: '/404', why: 'the not-found page itself is never a destination' },
];

/**
 * Match a pathname against the table.
 *
 * Segment count must match exactly and a `:param` segment matches any single
 * non-empty segment. No prefix matching: `/marketplace/products/7/edit` is not
 * a product page and must not inherit a product page's metadata, which a
 * `startsWith` check would have handed it.
 */
export function matchPublicSeoRoute(pathname: string): SeoRoute | null {
  const actual = segments(pathname);
  for (const route of PUBLIC_SEO_ROUTES) {
    const expected = segments(route.path);
    if (expected.length !== actual.length) continue;
    const every = expected.every((part, i) => (part.startsWith(':') ? actual[i].length > 0 : part === actual[i]));
    if (every) return route;
  }
  return null;
}

function segments(pathname: string): string[] {
  const clean = pathname.split('?')[0].split('#')[0];
  return clean.split('/').filter(part => part.length > 0);
}

/** `index, follow` or `noindex, nofollow` — the exact value for the meta tag. */
export type RobotsDirective = 'index, follow' | 'noindex, nofollow';

/**
 * THE ONE PLACE THAT DECIDES INDEXABILITY.
 *
 * `environment` is the deployment name from the build stamp - the same field
 * `/version` reports - and NOT NODE_ENV, which every deployed environment sets
 * to "production" including staging. Reading NODE_ENV here would have made the
 * staging preview indexable while looking correct.
 */
export function robotsDirective(route: SeoRoute | null, environment: string): RobotsDirective {
  if (!route) return 'noindex, nofollow';
  // A page a crawler cannot read is not a page to invite it to.
  if (route.access !== 'public') return 'noindex, nofollow';
  return environment.trim().toLowerCase() === 'production' ? 'index, follow' : 'noindex, nofollow';
}

/** The full `<title>` for a route, brand suffix included. */
export function seoTitle(route: SeoRoute | null, lang: 'en' | 'ar'): string {
  const brand = lang === 'ar' ? SEO_BRAND_AR : SEO_BRAND_EN;
  if (!route) return brand;
  if (route.path === '/') return `${brand} — ${lang === 'ar' ? route.titleAr : route.titleEn}`;
  return `${lang === 'ar' ? route.titleAr : route.titleEn} — ${brand}`;
}

/**
 * A title carrying the entity's OWN name, for a product or a storefront.
 *
 * An empty or whitespace name falls back to the route's generic title rather
 * than producing " — BuildHub" with nothing in front of it. A record with no
 * usable name is a data question, not something to render a gap for.
 */
export function seoEntityTitle(name: string | null | undefined, route: SeoRoute | null, lang: 'en' | 'ar'): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) return seoTitle(route, lang);
  return `${trimmed} — ${lang === 'ar' ? SEO_BRAND_AR : SEO_BRAND_EN}`;
}

export function seoDescription(route: SeoRoute | null, lang: 'en' | 'ar'): string {
  if (!route) {
    return lang === 'ar'
      ? 'بيلد هَب: سوق ومنصة عمل لقطاع البناء.'
      : 'BuildHub: a construction marketplace and workspace.';
  }
  return lang === 'ar' ? route.descriptionAr : route.descriptionEn;
}

/**
 * The absolute canonical URL, or null when this deployment does not know its
 * own public origin.
 *
 * NULL IS THE POINT. The origin comes from APP_BASE_URL, never from the
 * request's Host header - a header an attacker controls, and canonical is
 * exactly the tag you would not want them to write. With no origin configured
 * the caller omits the tag, because a canonical pointing at the wrong host is
 * worse than none at all, and that is the whole lesson of the hard-coded
 * homepage canonical this replaces.
 *
 * The query string is dropped: `/marketplace?page=2&sort=rating` is the
 * marketplace, and every filter combination pointing at itself as canonical is
 * how a catalogue becomes thousands of near-duplicate URLs.
 */
export function canonicalUrl(origin: string, pathname: string): string | null {
  const base = (origin ?? '').trim().replace(/\/+$/, '');
  if (base.length === 0) return null;
  if (!/^https?:\/\/[^/\s]+$/i.test(base)) return null;
  const parts = segments(pathname);
  return parts.length === 0 ? `${base}/` : `${base}/${parts.join('/')}`;
}

/**
 * robots.txt, which has to agree with the meta tag above or the two are just
 * two opinions.
 *
 * Outside production it is `Disallow: /`, full stop: the staging preview is a
 * real public copy of the product and must not be crawled.
 */
export function robotsTxt(origin: string, environment: string): string {
  const production = environment.trim().toLowerCase() === 'production';
  const lines = ['User-agent: *'];

  if (!production) {
    lines.push('Disallow: /');
    lines.push('');
    lines.push(`# ${environment.trim() || 'unknown'} is not production. Nothing here is for an index.`);
    return `${lines.join('\n')}\n`;
  }

  lines.push('Allow: /');
  for (const prefix of PRIVATE_PREFIXES) lines.push(`Disallow: ${prefix}`);
  const canonical = canonicalUrl(origin, '/');
  if (canonical) {
    lines.push('');
    lines.push(`Sitemap: ${canonical.replace(/\/$/, '')}/sitemap.xml`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The authenticated product, by URL prefix.
 *
 * This is belt AND braces: the meta tag already refuses every unlisted path,
 * so robots.txt naming these adds nothing for a crawler that fetches pages.
 * It is here for the crawler that reads robots.txt and nothing else, and
 * because a human checking what BuildHub excludes should be able to read it.
 *
 * Deliberately NOT a security control. §9 - frontend hiding is never
 * authorization, and neither is a text file. Every one of these paths is
 * enforced on the server.
 */
export const PRIVATE_PREFIXES: readonly string[] = [
  '/admin',
  '/messages',
  '/projects',
  '/rfq',
  '/quotations',
  '/enquiries',
  '/disputes',
  '/support',
  '/settings',
  '/compliance',
  '/marketing',
  '/saved',
  '/catalogue',
  '/products/new',
  '/dashboard',
  '/provider',
  '/platform',
  '/auth',
  '/ai',
  /*
   * The upload proxy. Every request through it is authorized individually
   * (server/_core/storageProxy.ts), so crawling it produces nothing but 403s.
   * Carried over from the static robots.txt this route replaced - it was the
   * one prefix that file knew about and this list did not.
   */
  '/manus-storage',
];
