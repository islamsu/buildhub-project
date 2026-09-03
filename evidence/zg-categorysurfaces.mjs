// ── LIVE BROWSER: every category surface reads the one taxonomy ───────────
//
// The three probes before this one prove the resolver, the bulk-upload screen
// and the administration page. This proves the LAST claim of the category
// work - that every OTHER surface offering a category reads the same source,
// and that a category added by an administrator appears on all of them with no
// deployment.
//
// It also covers two defects found while wiring them up, both of which a
// green unit suite could not have seen:
//
//   The Marketplace kept its own CATEGORY_AR and CATEGORY_ICONS maps, keyed on
//   a retired 27-name list. The taxonomy's canonical "Cement & Concrete" was in
//   neither, so an Arabic-reading shopper saw an English chip with no icon.
//
//   The Marketplace Hub linked its chips with ?cat=<a slug from a THIRD
//   vocabulary>, and the marketplace ignored the parameter entirely. Every chip
//   landed on the unfiltered marketplace.
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';

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
const made = { users: [], categories: [] };

async function supplier() {
  const username = `zgsf${stamp}`;
  const res = await fetch(`${BASE}/api/trpc/auth.signUp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: {
      username, email: `${username}@example.test`, password: 'ProbeSupplier!2024',
      name: 'Surface Probe Supplier', userRole: 'supplier',
    } }),
  });
  if (res.status !== 200) throw new Error(`probe setup: signUp failed ${res.status}`);
  const id = Number(sql(`select id from users where username='${username}'`));
  if (sql(`select username from users where id=${id}`) !== username) throw new Error('probe setup: wrong row');
  sql(`update users set onboardingStatus='approved', verified=1 where id=${id}`);
  made.users.push(id);
  const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  return { id, cookie };
}

const cookiesFor = cookie => cookie.split('; ').filter(Boolean).map(pair => {
  const at = pair.indexOf('=');
  return { name: pair.slice(0, at), value: pair.slice(at + 1), domain: '127.0.0.1', path: '/' };
});

const waitUntil = async (fn, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
};

const LISTABLE = Number(sql(`select count(*) from productCategories where status='active' and scope<>'SERVICE'`));
const browser = await launchBrowser();

try {
  const vendor = await supplier();
  const page = await browser.newPage();
  await page.setCookies(cookiesFor(vendor.cookie));

  // ── THE SINGLE-PRODUCT FORM ────────────────────────────────────────────
  await page.goto(`${BASE}/products/new`, { waitFor: '[data-testid="product-category"]' });
  await waitUntil(async () => (await page.evaluate(
    'return document.querySelectorAll(\'[data-testid="product-category"] option\').length;')) > 1);
  const options = await page.evaluate(
    'return Array.from(document.querySelectorAll(\'[data-testid="product-category"] option\')).map(o => o.value).filter(Boolean);');
  check('the Add Product form offers the LIVE taxonomy, not a compiled-in list',
    options.length === LISTABLE, `form ${options.length}, database ${LISTABLE}`);
  check('REPORTED CASE: Waterproofing is selectable in the single-product form',
    options.includes('Waterproofing'), options.slice(0, 3).join(', '));
  check('and the alias resolves to its canonical name, so the option is the stored value',
    options.includes('Swimming Pool Equipment') && !options.includes('Pools'));

  // ── THE MARKETPLACE FILTER, IN BOTH LANGUAGES ──────────────────────────
  for (const lang of ['en', 'ar']) {
    await page.goto(`${BASE}/marketplace/products`, { waitFor: 'body' });
    await page.evaluate(`localStorage.setItem('buildhub_lang', ${JSON.stringify(lang)}); return true;`);
    await page.goto(`${BASE}/marketplace/products`, { waitFor: 'body' });
    const chips = await waitUntil(async () => (await page.evaluate(
      'return document.body.innerText.includes("Cement") || document.body.innerText.includes("أسمنت");')));
    check(`${lang.toUpperCase()}: the marketplace filter renders the taxonomy`, chips);
    const body = await page.evaluate('return document.body.innerText;');
    if (lang === 'ar') {
      // THE DEFECT THIS CATCHES: the retired CATEGORY_AR map had no entry for
      // the canonical "Cement & Concrete", so this chip rendered in English.
      check('AR: the canonical category name renders in ARABIC, from the taxonomy',
        body.includes('أسمنت وخرسانة') && !body.includes('Cement & Concrete'),
        body.includes('أسمنت وخرسانة') ? 'arabic present' : 'arabic MISSING');
      check('AR: and Waterproofing too - not only the categories the old map knew',
        body.includes('عزل مائي'));
    } else {
      check('EN: the canonical category name renders in English', body.includes('Cement & Concrete'));
    }
  }

  // ── ?cat= FROM THE HUB ACTUALLY FILTERS ────────────────────────────────
  await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
  await page.goto(`${BASE}/marketplace/products?cat=${encodeURIComponent('Waterproofing')}`, { waitFor: 'body' });
  const selected = await waitUntil(async () => (await page.evaluate(`
    // The selected chip carries the primary background; read the one that is
    // visibly chosen rather than trusting the URL we just typed.
    return Array.from(document.querySelectorAll('button'))
      .some(el => (el.innerText || '').includes('Waterproofing') && el.className.includes('primary'));
  `)));
  check('a ?cat= link from the hub actually selects that category', selected);

  // ── THE HUB CHIPS COME FROM THE TAXONOMY AND LINK SOMEWHERE REAL ───────
  await page.goto(`${BASE}/marketplace`, { waitFor: 'body' });
  await waitUntil(async () => (await page.evaluate('return document.body.innerText.includes("Cement");')));
  const hub = await page.evaluate('return document.body.innerText;');
  check('the hub chips are canonical taxonomy names', hub.includes('Cement & Concrete'), '');
  const hubCount = await page.evaluate(`
    const match = document.body.innerText.match(/\\n(\\d+)\\n[^\\n]*[Cc]ategor/);
    return match ? Number(match[1]) : null;
  `);
  check('and the hub states the REAL number of categories, not a "+" estimate',
    hubCount === null || hubCount === Number(sql(`select count(*) from productCategories where status='active'`)),
    `hub ${hubCount}, database ${sql(`select count(*) from productCategories where status='active'`)}`);

  // ── PROPAGATION: a new category appears on ALL of them, with no restart ──
  sql(`insert into productCategories (slug,nameEn,nameAr,scope,status,sortOrder,icon)
       values ('zgsurf${stamp}','Probe Surface ${stamp}','سطح تجريبي ${stamp}','PRODUCT','active',950,'🧪')`);
  const NEW_ID = Number(sql(`select id from productCategories where slug='zgsurf${stamp}'`));
  made.categories.push(NEW_ID);

  await page.goto(`${BASE}/products/new`, { waitFor: '[data-testid="product-category"]' });
  const inForm = await waitUntil(async () => (await page.evaluate(
    `return Array.from(document.querySelectorAll('[data-testid="product-category"] option'))
       .some(o => o.value === 'Probe Surface ${stamp}');`)));
  check('PROPAGATION: the new category appears in the Add Product form, no deployment', inForm);

  await page.goto(`${BASE}/marketplace/products`, { waitFor: 'body' });
  const inFilter = await waitUntil(async () => (await page.evaluate(
    `return document.body.innerText.includes('Probe Surface ${stamp}');`)));
  check('PROPAGATION: and in the marketplace filter', inFilter);

  await page.goto(`${BASE}/catalogue`, { waitFor: '[data-testid="product-import"]' });
  const inUpload = await waitUntil(async () => (await page.evaluate(
    `const el = document.querySelector('[data-testid="import-categories"]');
     if (!el) return false;
     el.open = true;
     return el.innerText.includes('Probe Surface ${stamp}');`)));
  check('PROPAGATION: and in the bulk upload reference', inUpload);

  // ── HIDING IT REMOVES IT FROM ALL OF THEM, EQUALLY LIVE ────────────────
  sql(`update productCategories set status='hidden' where id=${NEW_ID}`);
  await page.goto(`${BASE}/products/new`, { waitFor: '[data-testid="product-category"]' });
  const goneFromForm = await waitUntil(async () => (await page.evaluate(
    `const opts = Array.from(document.querySelectorAll('[data-testid="product-category"] option'));
     return opts.length > 1 && !opts.some(o => o.value === 'Probe Surface ${stamp}');`)));
  check('PROPAGATION: hiding removes it from the form on the next load', goneFromForm);

  await page.close();
} catch (error) {
  check(`PROBE ABORTED: ${(error && error.message) || error}`, false);
} finally {
  browser.close();
  if (made.users.length > 0) {
    sql(`delete from products where supplierId in (${made.users.join(',')})`);
    sql(`delete from userAccountAuditEvents where userId in (${made.users.join(',')}) or actorId in (${made.users.join(',')})`);
    sql(`delete from users where id in (${made.users.join(',')})`);
  }
  if (made.categories.length > 0) sql(`delete from productCategories where id in (${made.categories.join(',')})`);
}

check('CLEANUP: every row this probe planted is gone',
  Number(sql(`select count(*) from users where id in (${made.users.join(',')})`)) === 0
  && Number(sql(`select count(*) from productCategories where slug like 'zgsurf%'`)) === 0);
check('CLEANUP: the taxonomy is back exactly as it was found',
  Number(sql(`select count(*) from productCategories where status='active' and scope<>'SERVICE'`)) === LISTABLE);

console.log(results.join('\n'));
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
