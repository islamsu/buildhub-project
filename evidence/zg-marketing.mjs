/**
 * ── THE SUPPLIER'S MARKETING CENTER (§89 item 16) ───────────────────────
 *
 * It must answer five questions with facts the database can produce, and
 * invent nothing. Two failure modes pull in opposite directions:
 *
 *   A SECOND DOMAIN, whose numbers drift from the Admin report - so a
 *   supplier and an administrator read different figures for the SAME
 *   placement, and a commercial dispute becomes unresolvable.
 *
 *   AN INVENTED NUMBER. BuildHub has no payment provider, so any spend,
 *   CPC or ROI figure would be fabricated.
 *
 * WHAT IS PROVED, against real rows and a real browser:
 *
 *   the supplier's own placement renders with its scope and expiry
 *   the figures are COUNTS OF REAL RECORDED EVENTS - proven by recording
 *     one and watching the number move by exactly one
 *   the supplier's number and the ADMIN's number for the same placement
 *     agree, because they come from one function
 *   A SUPPLIER CANNOT SEE ANOTHER SUPPLIER'S PLACEMENT (the leak)
 *   a supplier with NO products and NO placement sees NOTHING, not
 *     everything - the fail-closed scope
 *   a rate with no denominator says "Not enough data", never 0%
 *   Featured and Sponsored are counted apart, and the Showcase is labelled
 *     as the supplier's own choice rather than as promotion
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies, adminSession } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9300 + (process.pid % 80)));
const PASSWORD = 'LocalSuperAdmin!2024';
const SUPPLIER_A = 'zid6507832vnd@example.test';
const SUPPLIER_B = 'zid6507832rfr@example.test';

const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();
const num = q => Number(sql(q) || '0');

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
async function signIn(identifier) {
  const res = await fetch(`${BASE}/api/trpc/auth.signIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`signIn ${identifier}: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}
async function query(cookie, path, input) {
  const url = `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input ?? null }))}`;
  const res = await fetch(url, { headers: cookie ? { cookie } : {} });
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.result?.data?.json, message: body?.error?.json?.message };
}
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(page, expression, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(`return (${expression});`)) return true;
    await settle(250);
  }
  return false;
}

console.log(`\nBUILD ${BUILD.shortCommit ?? '?'}  env=${BUILD.environment ?? '?'}\n`);

const cookieA = await signIn(SUPPLIER_A);
const cookieB = await signIn(SUPPLIER_B);
const idA = num(`SELECT id FROM users WHERE email='${SUPPLIER_A}'`);
const idB = num(`SELECT id FROM users WHERE email='${SUPPLIER_B}'`);
check(idA > 0 && idB > 0 && idA !== idB, 'two distinct approved suppliers', `#${idA} / #${idB}`);

const made = [];
try {
  /* ══ REAL PLACEMENTS, one per supplier ════════════════════════════════ */
  sql(`INSERT INTO vendorSponsorships (vendorId, category, kind, source, package, surface, entityType, priority, startsAt, endsAt)
       VALUES (${idA}, 'Materials', 'sponsored', 'PAID_SPONSORSHIP', 'SPOTLIGHT', 'TYPE_CATEGORY_SPOTLIGHT', 'PROVIDER', 0, NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY))`);
  const placementA = num(`SELECT id FROM vendorSponsorships WHERE vendorId=${idA} ORDER BY id DESC LIMIT 1`);
  made.push(placementA);
  sql(`INSERT INTO vendorSponsorships (vendorId, category, kind, source, package, surface, entityType, priority, startsAt, endsAt)
       VALUES (${idB}, 'Materials', 'featured', 'ADMIN_EDITORIAL', 'BOOST', 'MASTER_DISCOVERY', 'PROVIDER', 0, NOW(), NULL)`);
  const placementB = num(`SELECT id FROM vendorSponsorships WHERE vendorId=${idB} ORDER BY id DESC LIMIT 1`);
  made.push(placementB);
  check(placementA > 0 && placementB > 0, 'a sponsored placement for A and a featured one for B',
    `#${placementA} / #${placementB}`);

  /* ══ 1. THE SUPPLIER SEES THEIR OWN, WITH SCOPE AND EXPIRY ════════════ */
  const viewA = await query(cookieA, 'profile.marketingOverview');
  check(viewA.status === 200, 'the Marketing Center answers', String(viewA.message ?? ''));
  const mine = (viewA.data?.placements ?? []).find(p => p.placementId === placementA);
  check(mine !== undefined, "the supplier's own placement is listed");
  check(mine?.label === 'SPONSORED', 'labelled SPONSORED, from the canonical label function', String(mine?.label));
  check(mine?.active === true, 'and reported as active while it is running');
  check(mine?.surface === 'TYPE_CATEGORY_SPOTLIGHT' && mine?.category === 'Materials',
    'with its SCOPE - surface and taxonomy', `${mine?.surface} / ${mine?.category}`);
  check(mine?.endsAt != null, 'and its EXPIRY', String(mine?.endsAt).slice(0, 10));

  /* ══ 2. THE LEAK: A CANNOT SEE B'S PLACEMENT ══════════════════════════ */
  const leaked = (viewA.data?.placements ?? []).some(p => p.placementId === placementB);
  check(leaked === false,
    "SUPPLIER A CANNOT SEE SUPPLIER B'S PLACEMENT",
    leaked ? `LEAKED #${placementB}` : 'not present');
  /* POSITIVE CONTROL: B sees their own, so the absence above is scoping
     rather than the endpoint simply returning nothing. */
  const viewB = await query(cookieB, 'profile.marketingOverview');
  const theirs = (viewB.data?.placements ?? []).find(p => p.placementId === placementB);
  check(theirs !== undefined,
    'POSITIVE CONTROL: supplier B DOES see their own placement');
  check(theirs?.label === 'FEATURED', "and B's editorial one is labelled FEATURED", String(theirs?.label));
  check((viewB.data?.placements ?? []).some(p => p.placementId === placementA) === false,
    "and B cannot see A's either - the scoping is symmetric");

  /* ══ 3. FEATURED AND SPONSORED ARE COUNTED APART ══════════════════════
   *
   * MEASURED AS A DELTA, not as an absolute. The probe's first version
   * asserted A had zero Featured placements and failed - because A really
   * does hold a pre-existing one (`source='ADMIN_GRANT'`, which the
   * canonical `placementLabel` correctly calls FEATURED, since only
   * PAID_SPONSORSHIP buys the word "Sponsored"). The product was right and
   * the assumption of a clean slate was wrong.
   */
  const aLabels = (viewA.data?.placements ?? []).filter(p => p.active);
  const aSponsored = aLabels.filter(p => p.label === 'SPONSORED').length;
  const aFeatured = aLabels.filter(p => p.label === 'FEATURED').length;
  check(Number(viewA.data?.activeSponsored ?? -1) === aSponsored
     && Number(viewA.data?.activeFeatured ?? -1) === aFeatured,
    'A: the headline counts agree with the rows they summarise',
    `S=${viewA.data?.activeSponsored}/${aSponsored} F=${viewA.data?.activeFeatured}/${aFeatured}`);
  check(aSponsored >= 1,
    'and the new Sponsored placement is counted as Sponsored', String(aSponsored));
  check(Number(viewA.data?.activeSponsored ?? 0) + Number(viewA.data?.activeFeatured ?? 0) === aLabels.length
     && Number(viewA.data?.activeSponsored ?? 0) !== aLabels.length,
    'FEATURED AND SPONSORED ARE NEVER ONE TOTAL - each headline is its own label',
    `${viewA.data?.activeSponsored} + ${viewA.data?.activeFeatured} = ${aLabels.length}`);
  check(Number(viewB.data?.activeFeatured ?? 0) >= 1 && Number(viewB.data?.activeSponsored ?? 0) === 0,
    'B: one active Featured, zero Sponsored - the two never merge', `F=${viewB.data?.activeFeatured} S=${viewB.data?.activeSponsored}`);

  /* ══ 4. THE FIGURES COUNT REAL EVENTS ═════════════════════════════════ */
  const before = Number(mine?.impressions ?? -1);
  check(before === 0, 'a placement nobody has seen reports zero impressions', String(before));
  check(mine?.ctr === null, 'and its click rate is NULL, not a decorative 0%', String(mine?.ctr));

  sql(`INSERT INTO analyticsEvents (eventType, subjectType, subjectId, occurredAt)
       VALUES ('placement.impression', 'placement', ${placementA}, NOW())`);
  const afterOne = await query(cookieA, 'profile.marketingOverview');
  const moved = (afterOne.data?.placements ?? []).find(p => p.placementId === placementA);
  check(Number(moved?.impressions ?? -1) === before + 1,
    'RECORDING ONE REAL EVENT MOVES THE NUMBER BY EXACTLY ONE',
    `${before} -> ${moved?.impressions}`);
  /*
   * 0 CLICKS OVER 1 IMPRESSION REALLY IS 0%, and the API says so - that is
   * arithmetic, not fabrication. The probe first demanded null here and
   * failed, which was the wrong demand: the data layer must stay identical
   * to the Admin report's. The protection §68 asks for is on DISPLAY, and
   * it is checked in the browser below: a rate over fewer than
   * MIN_RATE_SAMPLE impressions renders as "Not enough data".
   */
  check(moved?.ctr === 0,
    'a real zero over a real denominator is reported as zero, not hidden', String(moved?.ctr));

  sql(`INSERT INTO analyticsEvents (eventType, subjectType, subjectId, occurredAt)
       VALUES ('placement.cta_click', 'placement', ${placementA}, NOW())`);
  const afterClick = await query(cookieA, 'profile.marketingOverview');
  const clicked = (afterClick.data?.placements ?? []).find(p => p.placementId === placementA);
  check(typeof clicked?.ctr === 'number' && clicked.ctr > 0,
    'and a real click produces a real rate', `ctr=${clicked?.ctr}`);

  /* ══ 5. THE SUPPLIER'S NUMBER AND THE ADMIN'S AGREE ═══════════════════ */
  // `adminSession(identifier, password)` returns { ok, cookie } and caches
  // the cookie, so repeated runs do not trip the auth rate limiter.
  const adminAuth = await adminSession('superadmin@buildhub.local', PASSWORD);
  check(adminAuth?.ok === true, 'an administrator session is available for the comparison',
    adminAuth?.ok ? (adminAuth.reused ? 'reused' : 'fresh') : 'FAILED');
  const adminCookie = adminAuth?.cookie ?? '';
  const adminReport = await query(adminCookie, 'admin.placementPerformance');
  check(adminReport.status === 200, 'the Admin placement report answers', String(adminReport.message ?? ''));
  const adminRows = adminReport.data?.rows ?? [];
  check(Array.isArray(adminRows) && adminRows.length > 0,
    'and returns rows, so the comparison below is not vacuous', String(adminRows.length));
  const adminRow = adminRows.find(r => Number(r.placementId) === placementA);
  if (adminRow) {
    check(Number(adminRow.impressions) === Number(clicked?.impressions),
      'THE SUPPLIER AND THE ADMIN READ THE SAME IMPRESSION COUNT',
      `admin ${adminRow.impressions} vs supplier ${clicked?.impressions}`);
    check(adminRow.ctr === clicked?.ctr,
      'and the same click rate - one function, not two',
      `admin ${adminRow.ctr} vs supplier ${clicked?.ctr}`);
  } else {
    check(false, 'the admin report did not return the placement to compare against', 'SKIP');
  }

  /* ══ 6. FAIL-CLOSED: NO PLACEMENTS MEANS NONE, NOT ALL ════════════════ */
  const strangerEmail = sql(`SELECT email FROM users WHERE userRole IN ('contractor','engineer','architect') AND onboardingStatus='approved' AND id NOT IN (${idA},${idB}) LIMIT 1`);
  if (strangerEmail) {
    const strangerId = num(`SELECT id FROM users WHERE email='${strangerEmail}'`);
    const owns = num(`SELECT COUNT(*) FROM vendorSponsorships WHERE vendorId=${strangerId}`);
    const products = num(`SELECT COUNT(*) FROM products WHERE supplierId=${strangerId}`);
    if (owns === 0) {
      const strangerCookie = await signIn(strangerEmail);
      const strangerView = await query(strangerCookie, 'profile.marketingOverview');
      check(strangerView.status === 200 && (strangerView.data?.placements ?? []).length === 0,
        'A PROVIDER WITH NO PLACEMENTS SEES NONE - not every placement on the platform',
        `${(strangerView.data?.placements ?? []).length} rows, ${products} products`);
    } else {
      check(false, 'no placement-free provider available for the fail-closed test', 'SKIP');
    }
  }

  /* ══ 7. IN THE BROWSER ════════════════════════════════════════════════ */
  const browser = await launchBrowser({ port: CDP_PORT });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1200 });
    await page.setCookies(asBrowserCookies(cookieA));
    await page.goto(`${BASE}/marketing`);

    const rendered = await waitFor(page, `document.querySelector('[data-testid="marketing-center"]') !== null`);
    check(rendered, 'the Marketing Center page renders');

    const row = await waitFor(page, `document.querySelector('[data-testid="marketing-placement-${placementA}"]') !== null`);
    check(row, 'and shows the supplier their own placement');

    const rowText = await page.evaluate(`
      const el = document.querySelector('[data-testid="marketing-placement-${placementA}"]');
      return el ? el.innerText.trim() : 'MISSING';
    `);
    check(rowText !== 'MISSING' && /Sponsored/i.test(String(rowText)),
      'labelled Sponsored on screen, by the canonical badge', String(rowText).split('\n')[0]);
    check(rowText !== 'MISSING' && /Until /i.test(String(rowText)),
      'with its expiry shown', (String(rowText).match(/Until [^\n]*/) ?? [''])[0]);

    /* NO FABRICATED COMMERCIAL FIGURE ANYWHERE ON THE PAGE. */
    const pageText = await page.evaluate(`return document.body.innerText;`);
    const invented = ['CPC', 'CPM', 'ROI', 'GMV', 'Revenue', 'Spend', 'Budget'].filter(term =>
      new RegExp(`\\\\b${term}\\\\b`, 'i').test(String(pageText)));
    /* "cost-per-click" appears once in the explanatory note that says these
       figures are NOT shown; that sentence is the point, so the check is on
       a figure being PRESENTED, which is what a label followed by a number
       would be. */
    const presented = await page.evaluate(`
      const text = document.body.innerText;
      const m = text.match(/(CPC|CPM|ROI|GMV|Revenue|Spend|Budget)\\\\s*[:=]?\\\\s*[0-9]/gi);
      return m ? m.join(' | ') : 'NONE';
    `);
    check(presented === 'NONE',
      'NO BUDGET, CPC, CPM, ROI, GMV OR REVENUE FIGURE IS PRESENTED', String(presented));
    void invented;

    /* THE SHOWCASE IS NOT PRESENTED AS PROMOTION. */
    const showcaseNote = await page.evaluate(`
      const el = document.querySelector('[data-testid="marketing-showcase-note"]');
      return el ? el.innerText.trim() : 'MISSING';
    `);
    check(showcaseNote !== 'MISSING' && /does not change your marketplace ranking/i.test(String(showcaseNote)),
      'and the Showcase is labelled as the supplier\'s own choice, not as ranking',
      String(showcaseNote));

    /* A RATE WITH NO DENOMINATOR SAYS SO. Supplier B has no events at all. */
    await page.setCookies(asBrowserCookies(cookieB));
    await page.goto(`${BASE}/marketing`);
    await waitFor(page, `document.querySelector('[data-testid="marketing-placement-${placementB}"]') !== null`);
    const bRate = await page.evaluate(`
      const el = document.querySelector('[data-testid="marketing-ctr-${placementB}"]');
      return el ? el.innerText.trim() : 'MISSING';
    `);
    check(bRate !== 'MISSING' && /Not enough data/i.test(String(bRate)),
      'A RATE WITH NO DENOMINATOR SAYS "Not enough data", never 0%', String(bRate));

    const bText = await page.evaluate(`
      const el = document.querySelector('[data-testid="marketing-placement-${placementB}"]');
      return el ? el.innerText.trim() : 'MISSING';
    `);
    check(/Open-ended until revoked/i.test(String(bText)),
      'and an open-ended placement says so rather than reading as expired');

    /* AND A TRUE-BUT-MEANINGLESS RATE IS GATED TOO. Supplier A's placement
       has exactly one impression and one click - an arithmetically real
       100% that no supplier should act on (§68). */
    await page.setCookies(asBrowserCookies(cookieA));
    await page.goto(`${BASE}/marketing`);
    await waitFor(page, `document.querySelector('[data-testid="marketing-ctr-${placementA}"]') !== null`);
    const aRate = await page.evaluate(`
      const el = document.querySelector('[data-testid="marketing-ctr-${placementA}"]');
      return el ? el.innerText.trim() : 'MISSING';
    `);
    check(aRate !== 'MISSING' && /Not enough data/i.test(String(aRate)),
      'A STATISTICALLY WORTHLESS 100% IS NOT SHOWN AS A PERCENTAGE', String(aRate));
    check(!/100\.0%/.test(String(aRate)),
      'so one impression and one click cannot become a headline click rate');
  } finally {
    await browser.close().catch(() => {});
  }
} finally {
  for (const id of made) {
    sql(`DELETE FROM analyticsEvents WHERE subjectType='placement' AND subjectId=${id}`);
    sql(`DELETE FROM vendorSponsorships WHERE id=${id}`);
  }
  console.log(`\n(cleanup) probe placements remaining: ${num(`SELECT COUNT(*) FROM vendorSponsorships WHERE id IN (${made.join(',') || 0})`)}`);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
