// ── LIVE BROWSER: the Super Admin category management page ────────────────
//
// zg-categoryadmin.mjs proves the SERVER administers the taxonomy correctly.
// This proves an administrator can actually do it: that the page is REACHABLE
// from the menu rather than being a URL nobody is told about, that the counts
// on the screen are the database's own, that the dependency warning appears
// before a category is hidden, that there is no Delete anywhere, and that the
// wrong administrator is told plainly rather than shown a broken screen.
//
// The reachability check is the one this project has been bitten by before:
// /admin/admins existed, worked, and had zero inbound links, so revoking a
// compromised administrator's sessions meant typing a URL nobody knew. The
// sidebar renders BUTTONS, not <a href>, so reachability is proved by CLICKING
// and watching location.pathname - not by looking for an anchor.
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const PASSWORD = 'LocalSuperAdmin!2024';

const sql = q => execSync(
  `mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`,
  { input: q.replace(/\s+/g, ' ').trim() },
).toString().split('\n').filter(l => !/^PAGER set to/.test(l)).join('\n').trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

const stamp = Date.now() % 100000000;
const made = { users: [], categories: [], products: [] };

function makeAdmin(suffix, adminRole, passwordHash) {
  const u = `zgcu${stamp}${suffix}`;
  sql(`insert into users (openId, username, email, name, role, adminRole, userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${u}', '${u}', '${u}@example.test', 'Probe ${suffix}', 'admin',
        '${adminRole}', 'admin', 'password', 'admin_created', 0, 'active', 'approved', 1,
        '${passwordHash}', now())`);
  const id = Number(sql(`select id from users where username='${u}'`));
  if (sql(`select username from users where id=${id}`) !== u) throw new Error(`probe setup: wrong row for ${u}`);
  made.users.push(id);
  return { id, username: u, email: `${u}@example.test` };
}

/** A real sign-in over HTTP, whose cookie the browser then carries. */
async function signIn(email) {
  const res = await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  const body = await res.json().catch(() => null);
  const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  return { ok: res.status === 200, role: body?.result?.data?.json?.adminRole ?? null, cookie };
}

const cookiesFor = cookie => cookie.split('; ').filter(Boolean).map(pair => {
  const at = pair.indexOf('=');
  return { name: pair.slice(0, at), value: pair.slice(at + 1), domain: '127.0.0.1', path: '/' };
});

async function waitFor(page, selector, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(`return !!document.querySelector(${JSON.stringify(selector)});`)) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}
const text = (page, selector) => page.evaluate(
  `const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.innerText : null;`);
const count = (page, selector) => page.evaluate(
  `return document.querySelectorAll(${JSON.stringify(selector)}).length;`);

const hash = sql(`select passwordHash from users where username='superadmin' and role='admin'`);
if (!hash) throw new Error('probe setup: no bootstrap hash');

const TOTAL = Number(sql(`select count(*) from productCategories`));
const browser = await launchBrowser();

try {
  const marketAdmin = makeAdmin('mk', 'MARKETPLACE_ADMIN', hash);
  const supportAdmin = makeAdmin('sp', 'SUPPORT_ADMIN', hash);

  /**
   * A REAL product in Waterproofing, so the dependency warning is exercised
   * with a real count.
   *
   * Without it the category is empty, the dialog correctly says "No products
   * use this category", and the check that the warning names the count passes
   * against a screen that never had to name one. A control tested only in its
   * trivial case is not tested.
   */
  const WP = Number(sql(`select id from productCategories where slug='waterproofing'`));
  const vendorId = Number(sql(`select id from users where userRole='supplier' and isDummy=0 limit 1`))
    || Number(sql(`select id from users limit 1`));
  sql(`insert into products (supplierId, name, category, categoryId, price, active)
       values (${vendorId}, 'ZG Dependency Probe ${stamp}', 'Waterproofing', ${WP}, '100', 1)`);
  made.products.push(Number(sql(`select id from products where name='ZG Dependency Probe ${stamp}'`)));

  const marketSession = await signIn(marketAdmin.email);
  check('SETUP: the marketplace administrator signed in for real',
    marketSession.ok && marketSession.role === 'MARKETPLACE_ADMIN', `${marketSession.role}`);
  if (!marketSession.ok) throw new Error('probe setup: marketplace session not established');

  const page = await browser.newPage();
  await page.setCookies(cookiesFor(marketSession.cookie));

  // ── REACHABILITY: found by clicking, not by typing a URL ────────────────
  await page.goto(`${BASE}/admin`, { waitFor: 'nav, aside, [data-testid]' });
  /**
   * POLL FOR THE ENTRY, do not read for it once.
   *
   * The admin menu is built from the viewer's real permissions, which arrive
   * from `admin.me` after the shell has already rendered. Checking immediately
   * after navigation finds an empty menu and reports a working page as broken -
   * which is exactly what the first run of this probe did.
   */
  const menuEntry = await (async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const found = await page.evaluate(`
        return Array.from(document.querySelectorAll('button, a'))
          .some(el => (el.innerText || '').trim() === 'Product categories');
      `);
      if (found) return true;
      await new Promise(r => setTimeout(r, 250));
    }
    return false;
  })();
  check('the menu offers a Product categories entry to a marketplace administrator', menuEntry);
  const reached = await page.evaluate(`
    const target = Array.from(document.querySelectorAll('button, a'))
      .find(el => (el.innerText || '').trim() === 'Product categories');
    if (!target) return { found: false, path: location.pathname };
    // The sidebar renders BUTTONS, not <a href>. Reachability is proved by
    // clicking and watching location.pathname, never by finding an anchor.
    target.click();
    return { found: true, path: location.pathname };
  `);
  // The click is asynchronous; wait for the route rather than asserting instantly.
  const landed = await (async () => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await page.evaluate('return location.pathname;') === '/admin/categories') return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  })();
  check('and clicking it actually navigates to /admin/categories', landed,
    await page.evaluate('return location.pathname;'));

  // ── THE TABLE IS THE DATABASE ──────────────────────────────────────────
  check('the taxonomy table renders', await waitFor(page, '[data-testid="category-table"]'));
  const rows = await count(page, '[data-testid="category-row"]');
  check('every category in the database is on the screen', rows === TOTAL, `screen ${rows}, database ${TOTAL}`);
  const slugs = await page.evaluate(
    'return Array.from(document.querySelectorAll(\'[data-testid="category-slug"]\')).map(el => el.innerText.trim());');
  check('REPORTED CASE: Waterproofing and Pools are both administrable rows',
    slugs.includes('waterproofing') && slugs.includes('pools'), `${slugs.length} slugs`);

  // Real counts. Compare the rendered number against the products table.
  const realCount = Number(sql(`select count(*) from products p join productCategories c on c.id=p.categoryId where c.slug='waterproofing'`));
  const shown = await page.evaluate(`
    const row = document.querySelector('[data-testid="category-row"][data-slug="waterproofing"]');
    return row ? row.querySelector('[data-testid="category-usage"]').innerText.trim() : null;
  `);
  check('the product count on the screen is the database count, not an estimate',
    shown !== null && shown.startsWith(String(realCount)), `screen "${shown}" vs database ${realCount}`);

  // ── NO DELETE, ANYWHERE ────────────────────────────────────────────────
  const destructive = await page.evaluate(`
    return Array.from(document.querySelectorAll('button'))
      .map(el => (el.innerText || '').trim().toLowerCase())
      .filter(label => label === 'delete' || label === 'remove' || label === 'حذف');
  `);
  check('there is no Delete control on the page at all', destructive.length === 0, destructive.join(', '));
  check('Archive is offered instead', await page.evaluate(
    'return !!document.querySelector(\'[data-testid="category-archive"]\');'));

  // ── THE DEPENDENCY WARNING, BEFORE ANYTHING CHANGES ────────────────────
  await page.evaluate(`
    const row = document.querySelector('[data-testid="category-row"][data-slug="waterproofing"]');
    row.querySelector('[data-testid="category-hide"]').click();
    return true;
  `);
  check('hiding opens a confirmation first', await waitFor(page, '[data-testid="category-dependency"]'));
  const warning = await text(page, '[data-testid="category-dependency"]');
  check('the confirmation states the REAL dependency count',
    realCount > 0 ? (warning ?? '').includes(String(realCount)) : /No products/i.test(warning ?? ''),
    `count=${realCount} screen="${warning ?? ''}"`);
  check('and that count is not zero, so the warning was actually exercised',
    realCount > 0, `${realCount}`);
  check('DATABASE: and nothing changed merely by opening it',
    sql(`select status from productCategories where slug='waterproofing'`) === 'active');
  // Close without confirming.
  await page.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return true;');

  // ── SEARCH AND FILTER OVER THE SAME ROWS ───────────────────────────────
  await page.evaluate(`
    const input = document.querySelector('[data-testid="category-search"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Pools');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `);
  const filtered = await (async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const n = await count(page, '[data-testid="category-row"]');
      if (n < TOTAL) return n;
      await new Promise(r => setTimeout(r, 150));
    }
    return TOTAL;
  })();
  check('searching an ALIAS finds the category that answers to it', filtered >= 1 && filtered < TOTAL, `${filtered} rows`);
  const foundSlug = await page.evaluate(
    'const row = document.querySelector(\'[data-testid="category-row"]\'); return row ? row.dataset.slug : null;');
  check('and it is the right one - "Pools" is an alias of Swimming Pool Equipment',
    foundSlug === 'pools', String(foundSlug));

  // ── RESPONSIVE, BOTH LANGUAGES ─────────────────────────────────────────
  for (const width of [375, 768, 1440]) {
    for (const lang of ['en', 'ar']) {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width, height: 900, deviceScaleFactor: 1, mobile: width < 768,
      });
      await page.evaluate(`localStorage.setItem('buildhub_lang', ${JSON.stringify(lang)}); return true;`);
      await page.goto(`${BASE}/admin/categories`, { waitFor: '[data-testid="category-table"]' });

      const dir = await page.evaluate('return document.documentElement.getAttribute("dir") || "";');
      check(`${width}px ${lang.toUpperCase()}: direction matches the language`,
        lang === 'ar' ? dir === 'rtl' : dir !== 'rtl', `dir=${dir || 'unset'}`);

      const overflow = await page.evaluate(
        'return { scroll: document.documentElement.scrollWidth, inner: window.innerWidth };');
      check(`${width}px ${lang.toUpperCase()}: the PAGE never scrolls sideways`,
        overflow.scroll <= overflow.inner + 1, `${overflow.scroll} vs ${overflow.inner}`);

      // The wide table is allowed to scroll - inside its own box, which is the
      // rule. A table that forces the page sideways is the failure.
      // Reported, never thrown: a probe that dies here loses every check after
      // it, and "the container is missing" is a finding, not a crash.
      const scroller = await page.evaluate(`
        const table = document.querySelector('[data-testid="category-table"]');
        if (!table) return { reason: 'no table' };
        const box = table.parentElement;
        if (!box) return { reason: 'no container' };
        return {
          overflowX: getComputedStyle(box).overflowX,
          boxRight: box.getBoundingClientRect().right,
          tag: box.tagName + '.' + box.className,
        };
      `);
      check(`${width}px ${lang.toUpperCase()}: the table scrolls inside its own container`,
        scroller.overflowX === 'auto' && scroller.boxRight <= overflow.inner + 1,
        scroller.reason ?? `${scroller.overflowX} right=${Math.round(scroller.boxRight ?? -1)} ${scroller.tag ?? ''}`);

      // WHOSE SESSION IS THIS? Asserted every iteration, because the failure it
      // catches - a shared cookie jar quietly swapping the acting administrator
      // - looks exactly like a broken page.
      check(`${width}px ${lang.toUpperCase()}: still acting as the marketplace administrator`,
        await page.evaluate('return !!document.querySelector(\'[data-testid="category-table"]\');'));

      const heading = await text(page, 'h1');
      check(`${width}px ${lang.toUpperCase()}: the heading is in the right language`,
        lang === 'ar' ? /فئات/.test(heading ?? '') : /Product categories/.test(heading ?? ''),
        (heading ?? '').slice(0, 30));

      if (lang === 'ar') {
        const firstRow = await text(page, '[data-testid="category-row"]');
        check(`${width}px AR: category names render in Arabic, not just the chrome`,
          /[؀-ۿ]/.test(firstRow ?? ''), (firstRow ?? '').split('\n')[0] ?? '');
      }
    }
  }

  /*
   * THE WRONG ADMINISTRATOR - RUN LAST, AND FOR A REASON.
   *
   * CDP cookies are set on the BROWSER, not on the page: opening a second page
   * with the support administrator's cookie replaces the jar for every page in
   * the browser. When this ran before the responsive sweep, the sweep silently
   * continued as the SUPPORT administrator and reported the refusal screen as a
   * missing table at every breakpoint. It runs last so nothing follows it, and
   * the sweep asserts whose session it is actually looking at.
   */
  // ── THE WRONG ADMINISTRATOR IS TOLD, NOT SHOWN A BROKEN SCREEN ─────────
  const supportSession = await signIn(supportAdmin.email);
  check('SETUP: the support administrator signed in for real',
    supportSession.ok && supportSession.role === 'SUPPORT_ADMIN', `${supportSession.role}`);
  const other = await browser.newPage();
  await other.setCookies(cookiesFor(supportSession.cookie));
  // Pin the language first. localStorage is per-ORIGIN, so this page inherits
  // whatever the responsive sweep last set - and the refusal, correctly
  // rendered in Arabic, then fails an English-worded assertion. Pinning makes
  // the read deterministic instead of order-dependent.
  await other.goto(`${BASE}/admin/categories`, { waitFor: 'h1' });
  await other.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
  await other.goto(`${BASE}/admin/categories`, { waitFor: 'h1' });
  // Same reason: the refusal screen renders only once `admin.me` says what
  // this administrator may do.
  const denied = await (async () => {
    const deadline = Date.now() + 15000;
    let body = '';
    while (Date.now() < deadline) {
      body = await other.evaluate('return document.body.innerText;');
      if (/marketplace/i.test(body) || /category-table/.test(body)) return body;
      await new Promise(r => setTimeout(r, 250));
    }
    return body;
  })();
  check('a SUPPORT_ADMIN typing the URL is told plainly why, not shown an empty table',
    /marketplace/i.test(denied) && !(await other.evaluate('return !!document.querySelector(\'[data-testid="category-table"]\');')),
    (denied ?? '').split('\n').slice(0, 3).join(' / '));
  check('and the menu does not offer them the entry at all',
    !(await other.evaluate(`
      return Array.from(document.querySelectorAll('button, a'))
        .some(el => (el.innerText || '').trim() === 'Product categories');
    `)));
  await other.close();

  await page.close();
} catch (error) {
  check(`PROBE ABORTED: ${(error && error.message) || error}`, false);
} finally {
  browser.close();
  if (made.products.length > 0) sql(`delete from products where id in (${made.products.join(',')})`);
  if (made.users.length > 0) {
    sql(`delete from userAccountAuditEvents where userId in (${made.users.join(',')}) or actorId in (${made.users.join(',')})`);
    sql(`delete from users where id in (${made.users.join(',')})`);
  }
}

check('CLEANUP: the probe accounts and the seeded product are gone',
  Number(sql(`select count(*) from users where id in (${made.users.join(',')})`)) === 0
  && Number(sql(`select count(*) from products where name like 'ZG Dependency Probe %'`)) === 0);
check('CLEANUP: the taxonomy was never modified by this probe',
  Number(sql(`select count(*) from productCategories`)) === TOTAL
  && Number(sql(`select count(*) from productCategories where status<>'active'`)) === 0);

console.log(results.join('\n'));
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
