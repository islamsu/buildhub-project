/**
 * ── THE SYSTEMATIC VISUAL / PRODUCT-QUALITY GATE (§89 item 20) ─────────
 *
 * A sweep across public, buyer, supplier and Admin surfaces, in English and
 * Arabic, at phone and desktop width, checking the things §48-§79 make
 * release criteria rather than polish:
 *
 *   the page actually RENDERED (every finding below is worthless otherwise)
 *   exactly one H1, and a heading outline that does not skip
 *   no sideways scroll at 375px
 *   no raw enum or snake_case leaking into user-facing text (§55, §72)
 *   no untranslated English fragment on an Arabic screen (§67)
 *   the document direction is genuinely RTL in Arabic
 *   every image that carries content has alt text (§57)
 *   every icon-only control has an accessible name (§62)
 *
 * NON-VACUITY IS THE WHOLE DISCIPLINE HERE. A route that redirected to
 * /auth, or rendered an error, would pass "no overflow" and "no raw enum"
 * trivially - so each route asserts it reached the page it asked for before
 * any quality finding from it is allowed to count.
 */
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies, adminSession } from './lib/session.mjs';
import { execSync } from 'node:child_process';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9600 + (process.pid % 40)));
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const PASSWORD = 'LocalSuperAdmin!2024';

let pass = 0, fail = 0, step = 1;
const findings = [];
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  if (!ok) findings.push(`${name}${detail ? ' [' + detail + ']' : ''}`);
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
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(page, expression, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(`return (${expression});`)) return true;
    await settle(200);
  }
  return false;
}

/** Everything one page can tell us, gathered in a single evaluate. */
const AUDIT = `
  const text = document.body.innerText || '';
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
    .map(h => ({ level: Number(h.tagName[1]), text: (h.innerText || '').trim() }))
    .filter(h => h.text.length > 0);

  /* A raw enum or snake_case token shown to a reader (§55, §72). Restricted */
  /* to lowercase words joined by underscores, which is what the columns look */
  /* like - so a hyphenated brand name or a URL in visible text is not a hit. */
  const rawTokens = Array.from(new Set(
    (text.match(/\\b[a-z]+(?:_[a-z]+)+\\b/g) || [])
  ));

  /* Content-bearing images with no alt. A decorative one must be alt="". */
  const imagesMissingAlt = Array.from(document.querySelectorAll('img'))
    .filter(img => img.getAttribute('alt') === null)
    .map(img => (img.getAttribute('src') || '').slice(0, 60));

  /* An icon-only control with no accessible name is unusable with a screen */
  /* reader and invisible to keyboard users trying to find it. */
  const namelessControls = Array.from(document.querySelectorAll('button,a[href]'))
    .filter(el => {
      if ((el.innerText || '').trim().length > 0) return false;
      if (el.getAttribute('aria-label')) return false;
      if (el.getAttribute('aria-labelledby')) return false;
      if (el.getAttribute('title')) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;   /* ignore hidden nodes */
    })
    .map(el => el.tagName + '.' + (el.className || '').toString().slice(0, 40));

  /*
   * UI CHROME ONLY, for the Arabic check. BuildHub writes an accessible
   * name or a nav label; a user writes their own business name. Latin text
   * in the first is always a translation gap; in the second it is correct.
   */
  const chrome = [];
  for (const el of document.querySelectorAll('[aria-label],[title],.sr-only')) {
    const value = el.getAttribute('aria-label') || el.getAttribute('title')
      || (el.classList.contains('sr-only') ? (el.textContent || '') : '');
    if (value && value.trim()) chrome.push(value.trim());
  }
  for (const el of document.querySelectorAll('nav a, nav button, header a, header button')) {
    const value = (el.innerText || '').trim();
    if (value) chrome.push(value);
  }

  return {
    chrome: Array.from(new Set(chrome)),
    rendered: text.trim().length > 200,
    path: location.pathname,
    dir: document.documentElement.getAttribute('dir'),
    h1Count: document.querySelectorAll('h1').length,
    headings,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawTokens,
    imagesMissingAlt,
    namelessControls,
    notFound: /Page Not Found/i.test(text),
    text,
  };
`;

/**
 * Latin text on an Arabic screen that is CORRECT rather than a gap.
 *
 *   BuildHub and RFQ        the product's own names, kept in Latin
 *   currency codes          shown as codes on purpose (shared/money.ts)
 *   English                 the LANGUAGE SWITCHER, which names the language
 *                           it switches TO - in that language. Translating
 *                           it to "الإنجليزية" would be worse: a reader who
 *                           cannot read Arabic could not find the way out.
 *   alt                     the keyboard modifier in a shortcut hint
 *
 * Everything else in an accessible name or a nav label is BuildHub's own
 * copy, so Latin text in it is a translation gap.
 */
const ALLOWED_LATIN = /^(BuildHub|RFQ|RFQs|EGP|SAR|AED|QAR|KWD|BHD|OMR|GLOBAL|ID|PDF|AI|OK|CEO|VAT|English|alt|km|m2|EN|AR|[0-9].*)$/;

console.log(`\nBUILD ${BUILD.shortCommit ?? '?'}  env=${BUILD.environment ?? '?'}\n`);

const buyer = await signIn('zid6507832req@example.test');
const supplier = await signIn('zid6507832vnd@example.test');
/*
 * THE ADMIN CONTROL PLANE WAS ABSENT FROM THIS SWEEP, which is the half of
 * the product the owner operates. §54 holds it to the same bar as the public
 * site, and §79 is explicit that a polished public site with a crude Admin
 * is not acceptable.
 */
const adminAuth = await adminSession('superadmin@buildhub.local', PASSWORD);
if (adminAuth?.ok !== true) throw new Error('no administrator session for the Admin sweep');
const admin = adminAuth.cookie;

/* Real ids, so the detail routes are exercised rather than skipped. */
const sqlOne = query => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`,
  { input: query }).toString().trim().split('\n')[0];
const someSupplier = sqlOne("SELECT id FROM users WHERE userRole='supplier' ORDER BY id LIMIT 1");
const someProduct = sqlOne("SELECT id FROM products WHERE status='active' ORDER BY id LIMIT 1");
const someRfq = sqlOne("SELECT id FROM rfqs ORDER BY id DESC LIMIT 1");

const ROUTES = [
  { path: '/',                    who: null,     name: 'Home (public)' },
  { path: '/marketplace',         who: null,     name: 'Marketplace hub (public)' },
  { path: '/marketplace/vendors', who: null,     name: 'Provider directory (public)' },
  { path: '/marketplace/products',who: null,     name: 'Product catalogue (public)' },
  { path: '/saved',               who: buyer,    name: 'Saved shortlist (buyer)' },
  { path: '/rfq',                 who: buyer,    name: 'Requests (buyer)' },
  { path: '/dashboard',           who: buyer,    name: 'Projects dashboard (buyer)' },
  { path: '/enquiries',           who: supplier, name: 'Enquiries (supplier)' },
  { path: '/marketing',           who: supplier, name: 'Marketing Center (supplier)' },
  { path: '/settings',            who: supplier, name: 'Settings (supplier)' },

  /* ── CRITICAL BUYER JOURNEYS NOT YET COVERED ──────────────────────── */
  { path: `/marketplace/products/${someProduct}`, who: null,  name: 'Product detail (public)' },
  { path: `/vendor/${someSupplier}`,              who: null,  name: 'Provider storefront (public)' },
  { path: `/rfq/${someRfq}`,                      who: buyer, name: 'Request detail + quotations (buyer)' },

  /* ── THE ADMIN CONTROL PLANE (§54, §79, §84) ──────────────────────── */
  { path: '/admin',               who: admin, name: 'Admin control panel' },
  { path: '/admin/users',         who: admin, name: 'Admin User Management' },
  { path: `/admin/users/${someSupplier}`, who: admin, name: 'Admin User 360 detail' },
  { path: '/admin/registrations', who: admin, name: 'Admin Professional Registrations' },
  { path: '/admin/referrals',     who: admin, name: 'Admin Referral Management' },
  { path: '/admin/placements',    who: admin, name: 'Admin Placements / marketing' },
  { path: '/admin/categories',    who: admin, name: 'Admin Categories' },
  { path: '/admin/disputes',      who: admin, name: 'Admin Disputes' },
  { path: '/admin/support',       who: admin, name: 'Admin Support' },
  { path: '/admin/analytics',     who: admin, name: 'Admin Insights' },
];

const browser = await launchBrowser({ port: CDP_PORT });
try {
  const page = await browser.newPage();
  /*
   * A WARM-UP NAVIGATION, because a fresh tab is on about:blank and
   * `localStorage` on an opaque origin throws a SecurityError. The first
   * version set the language before ever navigating, and the whole sweep
   * died on line one with an uninformative "Uncaught".
   */
  await page.goto(`${BASE}/`);

  for (const width of [1440, 375]) {
    await page.setViewport({ width, height: width === 375 ? 800 : 1000 });
    for (const route of ROUTES) {
      if (route.who) await page.setCookies(asBrowserCookies(route.who));
      await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
      await page.goto(`${BASE}${route.path}`);
      await waitFor(page, `(document.body.innerText || '').trim().length > 200`);
      await settle(600);
      const a = await page.evaluate(AUDIT);

      const label = `${route.name} @${width}`;
      // NON-VACUITY FIRST: everything below is worthless if the page did not
      // render, or if a protected route bounced to sign-in.
      const arrived = a && a.rendered && !a.notFound && a.path === route.path;
      check(arrived, `${label}: reached and rendered`,
        arrived ? '' : `path=${a?.path} rendered=${a?.rendered} 404=${a?.notFound}`);
      if (!arrived) continue;

      if (width === 375) {
        check(a.overflow === false, `${label}: no sideways scroll`, a.overflow ? 'OVERFLOWS' : '');
      }
      check(a.h1Count === 1, `${label}: exactly one H1`, `h1=${a.h1Count}`);
      check(a.rawTokens.length === 0, `${label}: no raw enum in visible text`,
        a.rawTokens.slice(0, 4).join(', '));
      check(a.imagesMissingAlt.length === 0, `${label}: every image declares alt`,
        a.imagesMissingAlt.slice(0, 2).join(', '));
      check(a.namelessControls.length === 0, `${label}: every control has an accessible name`,
        a.namelessControls.slice(0, 3).join(', '));
    }
  }

  /* ══ ARABIC / RTL, at both widths ═════════════════════════════════════ */
  for (const width of [1440, 375]) {
    await page.setViewport({ width, height: width === 375 ? 800 : 1000 });
    for (const route of ROUTES) {
      if (route.who) await page.setCookies(asBrowserCookies(route.who));
      await page.evaluate(`localStorage.setItem('buildhub_lang', 'ar'); return true;`);
      await page.goto(`${BASE}${route.path}`);
      const rtl = await waitFor(page, `document.documentElement.getAttribute('dir') === 'rtl'`);
      await settle(600);
      const a = await page.evaluate(AUDIT);
      const label = `${route.name} @${width} AR`;

      const arrived = rtl && a && a.rendered && !a.notFound && a.path === route.path;
      check(arrived, `${label}: reached, rendered and genuinely RTL`,
        arrived ? '' : `dir=${a?.dir} path=${a?.path}`);
      if (!arrived) continue;

      if (width === 375) {
        check(a.overflow === false, `${label}: no sideways scroll`, a.overflow ? 'OVERFLOWS' : '');
      }
      /*
       * UNTRANSLATED UI CHROME on an Arabic screen (§67, §62).
       *
       * TEMPLATE, NOT DATA. An accessible name SHOULD carry the item it
       * names - "Add Gypsum Board to your wishlist" is correct, and a row
       * of twelve identical "add" buttons is the defect §62 exists to stop.
       * So a Latin word that also appears in the page's visible text is
       * DATA carried into the label (a product, a person, a business), and
       * a Latin word that appears ONLY in an accessible name is BuildHub's
       * own copy left untranslated.
       *
       * That distinction is what this sweep found: "Notifications alt+T",
       * "Toggle navigation", "wishlist" and "compare" appear in no visible
       * text anywhere, because they are chrome - and all four were English
       * on every Arabic screen.
       */
      const visible = new Set((a.text.match(/\b[A-Za-z][A-Za-z'’]{3,}\b/g) || []));
      const latin = Array.from(new Set(
        (a.chrome || []).flatMap(value => value.match(/\b[A-Za-z][A-Za-z'’]{3,}\b/g) || []),
      )).filter(word => !ALLOWED_LATIN.test(word) && !visible.has(word));
      check(latin.length === 0, `${label}: no untranslated UI chrome`,
        latin.slice(0, 5).join(', '));
      check((a.chrome || []).length > 0,
        `${label}: chrome was collected, so the check above is not vacuous`,
        String((a.chrome || []).length));
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   * THE STATE CLASSES §89 NAMES, which normal rendered pages do not show.
   *
   * A sweep of healthy screens proves the happy path only. These are the
   * states a reader meets when something is loading, when they are new,
   * when there is nothing yet, when the database is down, when a control is
   * unavailable, and when they are about to do something irreversible - and
   * §64 makes telling them apart a release requirement rather than polish.
   * ══════════════════════════════════════════════════════════════════════ */

  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);

  /* ── FIRST-TIME USER / EMPTY (§76) ─────────────────────────────────────
     A fresh buyer's shortlist. An empty state must explain where to start
     rather than saying "nothing here" and leaving them to work it out. */
  const freshBuyer = await signIn('zid6507832req@example.test');
  await page.setCookies(asBrowserCookies(freshBuyer));
  const savedBefore = sqlOne(`SELECT GROUP_CONCAT(CONCAT(itemKind,':',itemId)) FROM savedItems WHERE userId=(SELECT id FROM users WHERE email='zid6507832req@example.test')`);
  const buyerId = sqlOne("SELECT id FROM users WHERE email='zid6507832req@example.test'");
  execSync(`mysql -u root ${DB} -N -B`, { input: `DELETE FROM savedItems WHERE userId=${buyerId}` });
  try {
    await page.goto(`${BASE}/saved`);
    await waitFor(page, `document.querySelector('[data-testid="saved-empty"]') !== null`);
    const empty = await page.evaluate(`
      const el = document.querySelector('[data-testid="saved-empty"]');
      if (!el) return { found: false };
      return {
        found: true,
        text: (el.innerText || '').trim(),
        hasWayOut: el.querySelector('[data-testid="saved-browse"]') !== null,
      };
    `);
    check(empty?.found === true, 'EMPTY STATE: a fresh buyer sees an explained empty shortlist');
    check(empty?.hasWayOut === true,
      'and it offers a route out rather than dead-ending (§76)');
    check((empty?.text || '').length > 60,
      'and it explains what to do, not just that nothing is there',
      String(empty?.text || '').slice(0, 70));
  } finally {
    if (savedBefore && savedBefore !== 'NULL') {
      for (const pair of savedBefore.split(',')) {
        const [kind, itemId] = pair.split(':');
        execSync(`mysql -u root ${DB} -N -B`, { input:
          `INSERT IGNORE INTO savedItems (userId,itemKind,itemId) VALUES (${buyerId},'${kind}',${Number(itemId)})` });
      }
    }
  }

  /* ── DISABLED (§58) ───────────────────────────────────────────────────
     A disabled control must be disabled for a readable reason, never just
     inert. The showcase save button is disabled until something changes. */
  await page.setCookies(asBrowserCookies(supplier));
  await page.goto(`${BASE}/settings`);
  await waitFor(page, `document.querySelector('[data-testid="showcase-save"]') !== null`);
  const disabled = await page.evaluate(`
    const el = document.querySelector('[data-testid="showcase-save"]');
    if (!el) return { found: false };
    return { found: true, disabled: el.disabled === true, name: (el.innerText || '').trim() };
  `);
  check(disabled?.found === true, 'DISABLED STATE: the showcase save control renders');
  check(disabled?.disabled === true,
    'and is disabled until there is an actual change to save', String(disabled?.disabled));
  check((disabled?.name || '').length > 0,
    'while still carrying its own label, so it is not a mystery control', disabled?.name);

  /* ── DESTRUCTIVE-ACTION CONFIRMATION (§77) ────────────────────────────
   *
   * THE PRECONDITION IS CREATED, and the target was chosen twice.
   *
   * The first version hunted for an enabled "Reject" on the registrations
   * queue and reported a §77 failure when it found none - but Bulk reject
   * only renders once an applicant is SELECTED, and the compliance queue
   * lists applicants who have SUBMITTED DOCUMENTS, which no fixture had. The
   * control could not exist, so the probe was failing the product for the
   * data's shape.
   *
   * Revoking a placement is the better target and it found a REAL defect:
   * the button called `revoke.mutate()` straight from its onClick, so one
   * misplaced click took a supplier's live marketplace placement down
   * immediately with no statement of the consequence and no way back.
   */
  const revokeVendor = sqlOne("SELECT id FROM users WHERE userRole='supplier' ORDER BY id LIMIT 1");
  execSync(`mysql -u root ${DB} -N -B`, { input:
    `INSERT INTO vendorSponsorships (vendorId, category, kind, source, package, surface, entityType, priority, startsAt, endsAt)
     VALUES (${revokeVendor}, 'Materials', 'sponsored', 'PAID_SPONSORSHIP', 'SPOTLIGHT', 'TYPE_CATEGORY_SPOTLIGHT', 'PROVIDER', 0, NOW(), DATE_ADD(NOW(), INTERVAL 14 DAY))` });
  const revokeId = sqlOne(`SELECT id FROM vendorSponsorships WHERE vendorId=${revokeVendor} ORDER BY id DESC LIMIT 1`);
  try {
    await page.setCookies(asBrowserCookies(admin));
    await page.goto(`${BASE}/admin/placements`);
    const hasControl = await waitFor(page,
      `document.querySelector('[data-testid="sponsor-revoke-${revokeId}"]') !== null`, 20000);
    check(hasControl,
      'DESTRUCTIVE ACTIONS: a live placement offers a Revoke control', `#${revokeId}`);

    await page.evaluate(`
      const el = document.querySelector('[data-testid="sponsor-revoke-${revokeId}"]');
      if (el) el.click();
      return true;
    `);
    await settle(1200);

    const dialog = await page.evaluate(`
      const el = document.querySelector('[role="dialog"],[role="alertdialog"]');
      if (!el) return null;
      const consequence = el.querySelector('[data-testid="sponsor-revoke-consequence"]');
      return {
        text: (el.innerText || '').trim(),
        consequence: consequence ? (consequence.innerText || '').trim() : '',
        hasCancel: el.querySelector('[data-testid="sponsor-revoke-cancel"]') !== null,
      };
    `);
    check(dialog !== null,
      'A RISKY ACTION ASKS BEFORE IT ACTS rather than firing immediately (§77)');
    check(dialog !== null && dialog.consequence.length > 60,
      'and STATES THE CONSEQUENCE rather than only "are you sure"',
      String(dialog?.consequence || '').slice(0, 90));
    check(dialog !== null && /immediately|فوراً/i.test(dialog.consequence),
      'naming what happens on the marketplace, and when');
    check(dialog !== null && /cannot be undone|audit|لا يمكن التراجع|السجل/i.test(dialog.consequence),
      'and what survives it, so the decision can be made without hesitating');
    check(dialog !== null && dialog.hasCancel === true, 'with a way to back out');

    /* CANCEL MEANS CANCEL - verified in the database, not from the screen. */
    await page.evaluate(`
      const el = document.querySelector('[data-testid="sponsor-revoke-cancel"]');
      if (el) el.click();
      return true;
    `);
    await settle(1000);
    check(await page.evaluate(`return document.querySelector('[role="alertdialog"]') === null;`) === true,
      'and cancelling closes it');
    check(sqlOne(`SELECT IFNULL(revokedAt,'NOT-REVOKED') FROM vendorSponsorships WHERE id=${revokeId}`) === 'NOT-REVOKED',
      'AND NOTHING WAS REVOKED - checked in SQL, not inferred from the screen');
  } finally {
    execSync(`mysql -u root ${DB} -N -B`, { input:
      `DELETE FROM vendorSponsorships WHERE id=${revokeId}` });
  }

  /* ── ERROR, NOT EMPTY (§10, §64) ──────────────────────────────────────
     THE STRONGEST CHECK IN THIS FILE. With the database genuinely stopped,
     a data surface must say the read FAILED - never render a confident zero,
     and never present an outage as a signed-out session. */
  await page.setCookies(asBrowserCookies(supplier));
  await page.goto(`${BASE}/marketing`);
  await waitFor(page, `document.querySelector('[data-testid="marketing-center"]') !== null`);
  const healthy = await page.evaluate(`
    return document.querySelector('[data-testid="marketing-placements"],[data-testid="marketing-empty"]') !== null;
  `);
  check(healthy === true,
    'CONTROL: the Marketing Center renders normally before the database is stopped');

  execSync('service mariadb stop', { stdio: 'ignore' });
  try {
    /* Poll for the outage to actually reach the app, rather than assuming a
       fixed wait is enough - two runs disagreed on a fixed sleep before. */
    let sawFailure = false;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline && !sawFailure) {
      await page.goto(`${BASE}/marketing`);
      await settle(1500);
      sawFailure = await page.evaluate(`
        const text = document.body.innerText || '';
        return /could not|failed|try again|unavailable|تعذّر|فشل/i.test(text);
      `);
    }
    check(sawFailure,
      'OUTAGE IS REPORTED AS A FAILED READ, not as zero promotion (§10)');
    const zeros = await page.evaluate(`
      const text = document.body.innerText || '';
      return /\b0\s*(impressions|Active Featured|Active Sponsored)/i.test(text);
    `);
    check(zeros === false,
      'and no commercial figure is asserted while nothing could be measured');
    const bounced = await page.evaluate(`return location.pathname;`);
    check(bounced === '/marketing',
      'and an outage is not presented as a signed-out session (§10)', String(bounced));
  } finally {
    execSync('service mariadb start', { stdio: 'ignore' });
    /* Poll readiness rather than sleeping: a fixed wait was enough on one run
       and not the next, and the two runs then disagreed about a line that has
       nothing to do with what is being tested. */
    const ready = Date.now() + 40000;
    let up = false;
    while (Date.now() < ready && !up) {
      await settle(1500);
      try { execSync(`mysqladmin -u root status`, { stdio: 'ignore' }); up = true; } catch { /* still starting */ }
    }
    check(up, 'the database came back up for the remaining checks');
  }

  /* ── AND THE PAGE RECOVERS ───────────────────────────────────────────── */
  await page.goto(`${BASE}/marketing`);
  const recovered = await waitFor(page,
    `document.querySelector('[data-testid="marketing-placements"],[data-testid="marketing-empty"]') !== null`, 25000);
  check(recovered, 'and the surface recovers once the database returns');

} finally {
  await browser.close().catch(() => {});
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FINDINGS'}  ${pass} passed, ${fail} failed`);
if (findings.length) {
  console.log('\n── FINDINGS ──');
  for (const f of findings) console.log('  • ' + f);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
