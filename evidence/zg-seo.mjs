/**
 * ── THE SEO / DISCOVERABILITY RELEASE GATE, AGAINST RUNNING BUILDS ──────
 *
 * CLAUDE.md §37 and §66 are release criteria and had no evidence. What the
 * audit found in `client/index.html` was not an absence but three wrong
 * answers, served on every route of a single-page application:
 *
 *   <link rel="canonical" href="https://buildhub.eg/">   on every URL
 *   <meta name="robots" content="index, follow">          on every URL
 *   one <title> and one description                       for the whole product
 *
 * The canonical is the serious one. It does not hint, it DECLARES that the
 * current URL is a duplicate of the homepage - so every product page, every
 * directory and every storefront asked to be dropped in favour of `/`.
 *
 * ── WHY THIS PROBE RUNS TWO SERVERS ─────────────────────────────────────
 *
 * The rule that matters cannot be seen locally. Indexability is decided by the
 * DEPLOYMENT NAME from the build stamp, and the interesting case is production
 * - which local development is not. So a second process is started with
 * APP_ENV=production and APP_BASE_URL set, against the same database, and the
 * production answers are read from it directly.
 *
 * That is the honest way to test it: APP_ENV is the single input to the rule
 * (server/_core/health.ts), the probe sets exactly that input, and nothing is
 * mocked. And it verifies the case the repository most needs verified, because
 * staging and production run the same commit and must not behave the same way.
 *
 * ── AND A THIRD, POINTED AT A DATABASE THAT IS NOT THERE ────────────────
 *
 * §10 in the one document where the mistake is durable: a crawler handed a
 * valid, empty sitemap has been told in XML that BuildHub has no catalogue.
 * So the third process has a broken DATABASE_URL and must answer 503.
 */
import { execFileSync, spawn } from 'node:child_process';
import { assertBuild } from './lib/build.mjs';
import { launchBrowser } from './lib/cdp.mjs';

const LOCAL = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(LOCAL);

const PROD_PORT = Number(process.env.ZG_PROD_PORT ?? 5487);
const BROKEN_PORT = Number(process.env.ZG_BROKEN_PORT ?? 5488);
const ORIGIN = 'https://buildhub.example';

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(page, expression, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(`return (${expression});`)) return true;
    await settle(250);
  }
  return false;
}

/** Head tags, parsed out of the served HTML rather than out of a DOM. */
async function head(base, path) {
  const res = await fetch(`${base}${path}`, { redirect: 'manual' });
  const html = await res.text();
  const one = pattern => {
    const matches = [...html.matchAll(pattern)];
    return { value: matches[0]?.[1] ?? null, count: matches.length };
  };
  return {
    status: res.status,
    title: one(/<title>([\s\S]*?)<\/title>/g),
    robots: one(/<meta name="robots" content="([^"]*)"/g),
    description: one(/<meta name="description" content="([^"]*)"/g),
    canonical: one(/<link rel="canonical" href="([^"]*)"/g),
    ogUrl: one(/<meta property="og:url" content="([^"]*)"/g),
    ogTitle: one(/<meta property="og:title" content="([^"]*)"/g),
    html,
  };
}

async function text(base, path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
}

/** Start a server with an explicit environment, and wait for /version. */
async function startServer({ port, env, label }) {
  const child = spawn('pnpm', ['exec', 'tsx', 'server/_core/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/version`);
      if (res.ok) {
        const identity = await res.json();
        console.log(`BUILD  ${identity.shortCommit} (${identity.environment})  ${base}  [${label}]`);
        return { child, base, identity };
      }
    } catch { /* not listening yet */ }
    await settle(500);
  }
  child.kill('SIGKILL');
  throw new Error(`${label} did not start on ${port}`);
}

/** Real rows, so the probe asserts against the catalogue and not a fixture. */
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const sql = query =>
  execFileSync('mysql', ['-u', 'root', '--default-character-set=utf8mb4', DB, '-N', '-B'],
    { input: query, encoding: 'utf8' }).trim();

const activeProducts = Number(sql('select count(*) from products where status = "active"'));
const [sampleId, sampleName] = sql(
  'select id, name from products where status = "active" order by updatedAt desc limit 1'
).split('\t');
const approvedProviders = Number(sql(
  "select count(*) from users where accountStatus = 'active' and deactivatedAt is null and onboardingStatus = 'approved'"
  + " and userRole in ('supplier','contractor','engineer','designer','project_manager','vendor')"
));
console.log(`DATA   ${activeProducts} active products, sample #${sampleId} "${sampleName}", ${approvedProviders} approved providers`);
check(activeProducts > 0, 'the catalogue has public products to reason about', `${activeProducts}`);

/* ═══ PART 1. THIS DEPLOYMENT IS NOT PRODUCTION, SO NOTHING IS INDEXABLE ═══ */

console.log('\n── local (environment != production) ──');

for (const path of ['/', '/marketplace', '/marketplace/products', `/marketplace/products/${sampleId}`]) {
  const h = await head(LOCAL, path);
  check(h.robots.value === 'noindex, nofollow', `${path} is noindex outside production`, h.robots.value ?? 'absent');
}
{
  const robots = await text(LOCAL, '/robots.txt');
  check(robots.status === 200 && /^Disallow: \/$/m.test(robots.body),
    'robots.txt disallows everything outside production');
  check(!robots.body.includes('Sitemap:'), 'and advertises no sitemap');
  const sitemap = await text(LOCAL, '/sitemap.xml');
  check(sitemap.status === 503, 'sitemap refuses without a configured origin', `HTTP ${sitemap.status}`);
  check(!sitemap.body.includes('<urlset'), 'and does not answer with an empty urlset');
}

/* ═══ PART 2. PRODUCTION SEMANTICS, ON A REAL PROCESS ═══ */

console.log('\n── production semantics ──');
const prod = await startServer({
  port: PROD_PORT,
  env: { APP_ENV: 'production', APP_BASE_URL: ORIGIN, BUILD_COMMIT: BUILD.commit },
  label: 'APP_ENV=production',
});

try {
  check(prod.identity.environment === 'production', 'the second process reports environment=production');

  /* ── unique, real titles ── */
  const home = await head(prod.base, '/');
  const hub = await head(prod.base, '/marketplace');
  const catalogue = await head(prod.base, '/marketplace/products');
  const suppliers = await head(prod.base, '/marketplace/vendors');
  const product = await head(prod.base, `/marketplace/products/${sampleId}`);

  const titles = [home, hub, catalogue, suppliers, product].map(h => h.title.value);
  check(new Set(titles).size === titles.length, 'five public routes, five different titles',
    `${new Set(titles).size}/${titles.length}`);
  check(titles.every(title => title && title.includes('BuildHub')), 'each one names the product');
  const descriptions = [home, hub, catalogue, suppliers].map(h => h.description.value);
  check(new Set(descriptions).size === descriptions.length, 'and four different descriptions');

  /* THE PRODUCT'S OWN NAME, from the database, in the FIRST response. */
  check(product.title.value?.startsWith(sampleName),
    'a product page is titled with the product, before any JavaScript runs',
    product.title.value ?? 'absent');
  check(product.ogTitle.value?.startsWith(sampleName), 'and og:title agrees with it');

  /* ── indexable, and exactly once ── */
  for (const [path, h] of [['/', home], ['/marketplace', hub], ['/marketplace/products', catalogue],
                           [`/marketplace/products/${sampleId}`, product]]) {
    check(h.robots.value === 'index, follow' && h.robots.count === 1,
      `${path} is indexable in production, with one directive`, `${h.robots.value} ×${h.robots.count}`);
  }

  /* ── the canonical points at ITSELF, which is the whole defect ── */
  check(home.canonical.value === `${ORIGIN}/`, 'the homepage canonical is the homepage', home.canonical.value ?? 'absent');
  check(hub.canonical.value === `${ORIGIN}/marketplace`, 'the marketplace canonical is the marketplace',
    hub.canonical.value ?? 'absent');
  check(product.canonical.value === `${ORIGIN}/marketplace/products/${sampleId}`,
    'a product canonical is that product', product.canonical.value ?? 'absent');
  check(product.canonical.count === 1, 'and there is exactly one canonical tag', `×${product.canonical.count}`);
  check(product.ogUrl.value === product.canonical.value, 'og:url agrees with the canonical');
  {
    const filtered = await head(prod.base, '/marketplace/products?cat=cement&page=3');
    check(filtered.canonical.value === `${ORIGIN}/marketplace/products`,
      'a filtered listing canonicalises to the listing, not to itself',
      filtered.canonical.value ?? 'absent');
  }
  {
    const stale = [home, hub, catalogue, product].every(h => !h.html.includes('https://buildhub.eg/'));
    check(stale, 'the hard-coded homepage canonical is gone from every route');
  }

  /* ── the authenticated product is not for an index ── */
  for (const path of ['/admin', '/admin/users/461', '/messages', '/rfq/8', '/quotations/3', '/settings',
                      '/enquiries', '/marketing', '/saved', '/projects/12', '/dashboard', '/provider',
                      '/compliance', '/catalogue', `/products/${sampleId}/edit`]) {
    const h = await head(prod.base, path);
    check(h.robots.value === 'noindex, nofollow', `${path} is noindex in production`, h.robots.value ?? 'absent');
    check(h.canonical.count === 0, `${path} publishes no canonical URL`, `×${h.canonical.count}`);
  }

  /* A path nobody listed. The default has to be the private one. */
  {
    const h = await head(prod.base, '/some-route-added-next-month');
    check(h.robots.value === 'noindex, nofollow', 'an unlisted path is noindex by default');
  }

  /* ── the storefront: session-required, so not advertised ── */
  {
    const h = await head(prod.base, '/vendor/464');
    check(h.robots.value === 'noindex, nofollow',
      '/vendor/:id is noindex because it needs a session (§21 finding)', h.robots.value ?? 'absent');
  }

  /* ── robots.txt ── */
  {
    const robots = await text(prod.base, '/robots.txt');
    check(robots.status === 200 && robots.type.startsWith('text/plain'), 'robots.txt is served as text');
    check(/^User-agent: \*$/m.test(robots.body) && /^Allow: \/$/m.test(robots.body),
      'it allows crawling in production');
    const disallowed = ['/admin', '/messages', '/projects', '/rfq', '/quotations', '/enquiries',
                        '/disputes', '/support', '/settings', '/compliance', '/marketing', '/saved'];
    const missing = disallowed.filter(prefix => !robots.body.includes(`Disallow: ${prefix}\n`));
    check(missing.length === 0, 'and names every authenticated prefix', missing.join(',') || 'all present');
    check(robots.body.includes(`Sitemap: ${ORIGIN}/sitemap.xml`), 'and points at the sitemap');
  }

  /* ── the sitemap is the catalogue ── */
  {
    const sitemap = await text(prod.base, '/sitemap.xml');
    check(sitemap.status === 200 && sitemap.type.includes('xml'), 'sitemap.xml is served as XML',
      `HTTP ${sitemap.status} ${sitemap.type}`);
    check(sitemap.body.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'it is a well-formed XML document');
    const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    check(locs.length > 0, 'it lists URLs', `${locs.length}`);
    check(locs.every(loc => loc.startsWith(`${ORIGIN}/`)), 'every URL is absolute and on this origin');
    check(new Set(locs).size === locs.length, 'and none is listed twice');

    const productLocs = locs.filter(loc => loc.includes('/marketplace/products/'));
    check(productLocs.length === activeProducts,
      'every ACTIVE product appears, and only those', `${productLocs.length} listed vs ${activeProducts} active`);
    check(locs.includes(`${ORIGIN}/marketplace/products/${sampleId}`), 'including the sample product');

    /* Draft, inactive and archived products must not be advertised. */
    const hidden = sql('select id from products where status <> "active" limit 5').split('\n').filter(Boolean);
    const leaked = hidden.filter(id => locs.includes(`${ORIGIN}/marketplace/products/${id}`));
    check(leaked.length === 0, 'and no draft, withdrawn or archived product does',
      leaked.length ? `leaked ${leaked.join(',')}` : `${hidden.length} non-active checked`);

    check(!locs.some(loc => loc.includes('/vendor/')),
      'no storefront URL is published while the page needs a session');
    check(sitemap.body.includes(`${approvedProviders} provider storefront(s) are withheld`),
      'and the document says how many are withheld instead of looking empty',
      `expected ${approvedProviders}`);

    /* Every listed URL must be one the SEO table calls public, or the sitemap
       and the meta tags are two different opinions. */
    const privatePrefixes = ['/admin', '/messages', '/rfq', '/quotations', '/settings', '/enquiries',
                             '/marketing', '/saved', '/compliance', '/projects', '/dashboard', '/provider'];
    const contradictions = locs.filter(loc => privatePrefixes.some(prefix => loc.startsWith(`${ORIGIN}${prefix}`)));
    check(contradictions.length === 0, 'and the sitemap contradicts robots.txt nowhere',
      contradictions.join(',') || 'consistent');

    /* Each listed static URL really answers, and really is indexable. */
    const staticLocs = locs.filter(loc => !loc.includes('/marketplace/products/'));
    let served = 0;
    for (const loc of staticLocs) {
      const h = await head(prod.base, loc.slice(ORIGIN.length) || '/');
      if (h.status === 200 && h.robots.value === 'index, follow') served++;
    }
    check(served === staticLocs.length, 'every listed page answers 200 and declares itself indexable',
      `${served}/${staticLocs.length}`);
  }

  /* ── the shell is still a working document ── */
  {
    const h = await head(prod.base, '/marketplace');
    check(h.html.includes('<div id="root"></div>'), 'the rewritten shell still mounts the application');
    check(h.html.includes('</html>'), 'and is a complete document');
    check(!h.html.includes('maximum-scale=1'),
      'the viewport no longer blocks pinch-zoom (WCAG 1.4.4)');
  }
} finally {
  try { process.kill(-prod.child.pid, 'SIGKILL'); } catch { /* already gone */ }
}

/* ═══ PART 3. AN UNREACHABLE CATALOGUE IS NOT AN EMPTY ONE ═══ */

console.log('\n── database unavailable ──');
const broken = await startServer({
  port: BROKEN_PORT,
  env: {
    APP_ENV: 'production',
    APP_BASE_URL: ORIGIN,
    BUILD_COMMIT: BUILD.commit,
    DATABASE_URL: 'mysql://nobody:nothing@127.0.0.1:3999/absent',
  },
  label: 'DATABASE_URL points nowhere',
});

try {
  const sitemap = await text(broken.base, '/sitemap.xml');
  check(sitemap.status === 503, 'the sitemap answers 503 when the catalogue is unreachable',
    `HTTP ${sitemap.status}`);
  check(!sitemap.body.includes('<urlset'),
    'it does NOT answer with a valid empty sitemap - that would state, in XML, that BuildHub has no catalogue');
  check(/not an empty catalogue/i.test(sitemap.body), 'and it says which of the two it is');

  /* The pages themselves must still serve: a database outage degrades the
     title to the route's generic one, it does not take the site down. */
  const h = await head(broken.base, `/marketplace/products/${sampleId}`);
  check(h.status === 200, 'a product page still serves with no database', `HTTP ${h.status}`);
  check(h.title.value === 'Product specifications and supplier — BuildHub',
    'and falls back to the route title rather than failing or inventing a name', h.title.value ?? 'absent');
  const robots = await text(broken.base, '/robots.txt');
  check(robots.status === 200, 'robots.txt needs no database', `HTTP ${robots.status}`);
} finally {
  try { process.kill(-broken.child.pid, 'SIGKILL'); } catch { /* already gone */ }
}

/* ═══ PART 4. THE FINDING, IN A BROWSER ═══════════════════════════════════
 *
 * Everything above treats `/vendor/:id` as session-required on the strength of
 * `profile.getPublic` being a protectedProcedure. That is a claim about the
 * rendered product, so it is checked in a real browser with no session: if the
 * storefront in fact renders to a signed-out reader, the sitemap is withholding
 * pages it should publish and this probe is the thing that is wrong.
 */

console.log('\n── the provider storefront, signed out ──');
{
  const supplierId = sql(
    "select id from users where onboardingStatus = 'approved' and accountStatus = 'active'"
    + " and userRole in ('supplier','vendor') order by id limit 1"
  ).trim();
  const browser = await launchBrowser({ port: Number(process.env.ZG_CDP_PORT ?? 9077) });
  try {
    const page = await browser.newPage();
    await page.goto(`${LOCAL}/vendor/${supplierId}`);
    await settle(3500);
    const seen = await page.evaluate(`
      return {
        text: (document.body.innerText || '').slice(0, 4000),
        title: document.title,
      };
    `);
    const wall = /sign in|log in|تسجيل الدخول|sign up/i.test(seen.text);
    check(wall,
      `/vendor/${supplierId} shows a sign-in wall to a signed-out reader - so it is NOT public (§21/§37 finding)`,
      seen.text.replace(/\s+/g, ' ').slice(0, 90));
    check(!/products|catalogue|portfolio|verified/i.test(seen.text) || wall,
      'the storefront content is not rendered to a signed-out reader');

    /* ── THE BROWSER TAB, which is the half the crawler does not see ──────
     *
     * The server writes an English title into the first response. The client
     * then titles the page in the READER'S language and, on a product page,
     * with the product's own name. Both are checked here because a tab that
     * says the same thing on every page is the defect a user actually meets.
     *
     * MUTATION-TESTED, and worth recording which check does the work: the
     * English and product-name titles are ALSO what the server injects, so
     * they pass with or without the client hook. The ARABIC check is the one
     * that fails when `usePageTitle` is removed - the server writes English by
     * design, so an Arabic tab can only come from the client.
     */
    await page.goto(`${LOCAL}/marketplace`);
    await waitFor(page, `document.title.includes('Marketplace')`);
    const enTitle = await page.evaluate('return document.title;');
    check(enTitle === 'Marketplace — suppliers, products and services — BuildHub',
      'the marketplace tab names the marketplace, in English', enTitle);

    await page.evaluate(`localStorage.setItem('buildhub_lang', 'ar'); return true;`);
    await page.goto(`${LOCAL}/marketplace`);
    await waitFor(page, `document.documentElement.dir === 'rtl'`);
    await waitFor(page, `/[\u0600-\u06FF]/.test(document.title)`);
    const arTitle = await page.evaluate('return document.title;');
    check(/[\u0600-\u06FF]/.test(arTitle) && !/Marketplace/.test(arTitle),
      'and in Arabic it is Arabic, not a translated brand on an English title', arTitle);

    await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
    await page.goto(`${LOCAL}/marketplace/products/${sampleId}`);
    await waitFor(page, `document.title.startsWith(${JSON.stringify(sampleName)})`);
    const productTitle = await page.evaluate('return document.title;');
    check(productTitle === `${sampleName} — BuildHub`,
      'a product tab names the product', productTitle);

    /* And two different products must not share a tab title. */
    const otherId = sql(
      `select id from products where status = 'active' and id <> ${sampleId} order by updatedAt desc limit 1`
    ).trim();
    if (otherId) {
      await page.goto(`${LOCAL}/marketplace/products/${otherId}`);
      await waitFor(page, `document.title !== ${JSON.stringify(productTitle)} && document.title.includes('BuildHub')`);
      const otherTitle = await page.evaluate('return document.title;');
      check(otherTitle !== productTitle, 'and two products do not share one title',
        `${productTitle} vs ${otherTitle}`);
    }
  } finally {
    await browser.close();
  }
}

console.log(`\nBUILD  ${BUILD.shortCommit} (${BUILD.environment})`);
console.log(`RESULT ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
