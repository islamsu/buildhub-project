// ── LIVE BROWSER: the bulk upload screen, rendered ─────────────────────────
//
// zg-categoryupload.mjs proves the SERVER resolves categories correctly. It
// cannot prove a supplier can see any of it. The reported failure was as much
// a screen problem as a validation one: dozens of identical
// "Waterproofing is not a BuildHub category" lines, one per row, with no
// summary, no indication it was ONE problem, and nowhere on the page saying
// which categories were acceptable.
//
// So this drives a real Chromium against the real bundle: it uploads real
// files through the real file input, reads what the screen actually renders,
// and does it at 375, 768 and 1440 in English and in Arabic. A source-text
// assertion about a component cannot tell you whether a supplier can read it
// on a phone.
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';

const sql = q => execSync(
  `mysql -u root --default-character-set=utf8mb4 ${DB} -N -B -e ${JSON.stringify(q.replace(/\s+/g, ' ').trim())}`,
).toString().split('\n').filter(l => !/^PAGER set to/.test(l)).join('\n').trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

const stamp = Date.now() % 100000000;
const made = { users: [] };
const files = mkdtempSync(join(tmpdir(), 'zg-csv-'));

const write = (name, rows) => {
  const path = join(files, name);
  writeFileSync(path, ['name,nameAr,category,brand,price,stock,unit,deliveryDays,description', ...rows].join('\n') + '\n');
  return path;
};

// Thirty rows of ONE mistake. The whole point of the grouped summary is that
// this must not read as thirty problems.
const BAD = write('bad.csv', [
  ...Array.from({ length: 30 }, (_, i) => `Bad Row ${stamp} ${i},,Watrproofing,X,10,1,piece,2,`),
  `Good Pool ${stamp},,Pools,X,10,1,piece,2,`,
]);
const GOOD = write('good.csv', [
  `Pool Pump ${stamp},مضخة,Pools,Hayward,12500,8,piece,10,`,
  `Membrane ${stamp},لفائف,Waterproofing,Sika,850,40,roll,5,`,
]);

async function supplier() {
  const username = `catui${stamp}`;
  const res = await fetch(`${BASE}/api/trpc/auth.signUp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: {
      username, email: `${username}@example.test`, password: 'ProbeSupplier!2024',
      name: 'Category UI Probe', userRole: 'supplier',
    } }),
  });
  if (res.status !== 200) throw new Error(`probe setup: signUp failed ${res.status}`);
  const id = Number(sql(`select id from users where username='${username}'`));
  if (sql(`select username from users where id=${id}`) !== username) throw new Error('probe setup: wrong row');
  sql(`update users set onboardingStatus='approved', verified=1 where id=${id}`);
  made.users.push(id);
  return {
    id,
    cookie: (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; '),
  };
}

/** Put a real file into a real <input type=file> and let the app react to it. */
async function upload(page, selector, path) {
  await page.send('DOM.enable');
  const { root } = await page.send('DOM.getDocument', { depth: 1 });
  const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`probe: no file input matching ${selector}`);
  await page.send('DOM.setFileInputFiles', { nodeId, files: [path] });
}

/** Poll until the screen settles, rather than sleeping a guessed amount. */
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

const LISTABLE = Number(sql(`select count(*) from productCategories where status='active' and scope<>'SERVICE'`));

const account = await supplier();
const browser = await launchBrowser();

try {
  const page = await browser.newPage();
  await page.setCookies(asBrowserCookies(account.cookie));

  // ── the acceptable categories are ON THE PAGE ────────────────────────────
  await page.goto(`${BASE}/catalogue`, { waitFor: '[data-testid="product-import"]' });
  check('the upload screen renders for an approved supplier',
    await page.evaluate('return !!document.querySelector(\'[data-testid="product-import"]\');'));

  const reference = await waitFor(page, '[data-testid="import-categories"]');
  check('the acceptable categories are listed ON the upload page, not in a help article', reference);
  const options = await count(page, '[data-testid="import-category-option"]');
  check('and the list is the LIVE taxonomy, not a compiled-in copy',
    options === LISTABLE, `screen ${options}, database ${LISTABLE}`);
  // The disclosure has to be OPENED first: innerText on a collapsed <details>
  // returns the summary alone, so reading it shut reported an empty list as a
  // missing category. The chips are read individually rather than as one blob,
  // so an empty list cannot satisfy the check by accident.
  await page.evaluate('document.querySelector(\'[data-testid="import-categories"]\').open = true; return true;');
  const offered = await page.evaluate(
    'return Array.from(document.querySelectorAll(\'[data-testid="import-category-option"]\')).map(el => el.innerText.trim());');
  check('REPORTED CASE: Waterproofing and the Pools category are both offered',
    offered.includes('Waterproofing') && offered.includes('Swimming Pool Equipment'),
    `${offered.length} chips, e.g. ${offered.slice(0, 3).join(' / ')}`);

  // ── thirty rows of one mistake read as ONE problem ───────────────────────
  await upload(page, '[data-testid="import-file"]', BAD);
  check('the bad file produced a verdict', await waitFor(page, '[data-testid="import-blocked"]'));
  const issues = await count(page, '[data-testid="import-category-issue"]');
  check('30 identical category mistakes render as ONE grouped issue', issues === 1, `${issues}`);
  const issueText = await text(page, '[data-testid="import-category-issue"]');
  check('and the group states the affected rows as a RANGE, not thirty numbers',
    (issueText ?? '').includes('2–31'), (issueText ?? '').split('\n')[0] ?? '');
  check('the grouped issue quotes the offending value back',
    (issueText ?? '').includes('Watrproofing'));
  check('and offers the near match a person can act on',
    (issueText ?? '').includes('Waterproofing'), issueText ?? '');
  check('the per-row detail is RETAINED, behind a disclosure',
    await page.evaluate('return !!document.querySelector(\'[data-testid="import-row-errors"]\');'));
  check('and it is collapsed by default, so the summary is what leads',
    (await page.evaluate('return document.querySelector(\'[data-testid="import-row-errors"]\').open;')) === false);
  // The row errors must EXIST inside it - a disclosure hiding nothing would
  // pass the check above while having quietly lost the detail.
  await page.evaluate('document.querySelector(\'[data-testid="import-row-errors"]\').open = true; return true;');
  const rowErrors = await count(page, '[data-testid="import-error"]');
  check('the disclosure holds the real per-row errors', rowErrors === 30, `${rowErrors}`);

  // ── the clean preview says what it WILL be filed under ───────────────────
  await upload(page, '[data-testid="import-file"]', GOOD);
  check('the good file previews as ready', await waitFor(page, '[data-testid="import-ready"]'));
  const resolved = await text(page, '[data-testid="import-resolved"]');
  check('the preview shows "Pools" resolving to its canonical name BEFORE commit',
    (resolved ?? '').includes('Pools') && (resolved ?? '').includes('Swimming Pool Equipment'), resolved ?? 'absent');
  check('and does not clutter it with values that resolved to themselves',
    !(resolved ?? '').includes('Waterproofing\n'), resolved ?? '');
  check('nothing has been written yet - this is still a preview',
    Number(sql(`select count(*) from products where supplierId=${account.id}`)) === 0);

  // ── responsive, both languages ───────────────────────────────────────────
  for (const width of [375, 768, 1440]) {
    for (const lang of ['en', 'ar']) {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width, height: 900, deviceScaleFactor: 1, mobile: width < 768,
      });
      // localStorage is per-ORIGIN and the key is buildhub_lang. Set it, then
      // reload so the app reads it at mount.
      await page.evaluate(`localStorage.setItem('buildhub_lang', ${JSON.stringify(lang)}); return true;`);
      await page.goto(`${BASE}/catalogue`, { waitFor: '[data-testid="product-import"]' });
      await waitFor(page, '[data-testid="import-categories"]');

      const dir = await page.evaluate('return document.documentElement.getAttribute("dir") || document.body.getAttribute("dir") || "";');
      check(`${width}px ${lang.toUpperCase()}: the document direction matches the language`,
        lang === 'ar' ? dir === 'rtl' : dir !== 'rtl', `dir=${dir || 'unset'}`);

      const overflow = await page.evaluate(
        'return { scroll: document.documentElement.scrollWidth, inner: window.innerWidth };');
      check(`${width}px ${lang.toUpperCase()}: the page does not scroll sideways`,
        overflow.scroll <= overflow.inner + 1, `scrollWidth ${overflow.scroll} vs ${overflow.inner}`);

      const card = await page.evaluate(
        'const r = document.querySelector(\'[data-testid="product-import"]\').getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width };');
      check(`${width}px ${lang.toUpperCase()}: the upload card fits the viewport`,
        card.left >= -1 && card.right <= overflow.inner + 1 && card.width > 200,
        `left ${Math.round(card.left)} right ${Math.round(card.right)}`);

      const label = await text(page, '[data-testid="import-categories"] summary');
      check(`${width}px ${lang.toUpperCase()}: the category reference is in the right language`,
        lang === 'ar' ? /الفئات/.test(label ?? '') : /Categories you can use/.test(label ?? ''),
        (label ?? '').slice(0, 40));

      if (lang === 'ar') {
        // The names themselves must be Arabic - an Arabic label above an
        // English list is the failure this catches.
        await page.evaluate('document.querySelector(\'[data-testid="import-categories"]\').open = true; return true;');
        const chip = await text(page, '[data-testid="import-category-option"]');
        check(`${width}px AR: the category names are Arabic, not just the heading`,
          /[؀-ۿ]/.test(chip ?? ''), chip ?? '');
      }
    }
  }

  await page.close();
} finally {
  browser.close();
  sql(`delete from products where supplierId in (${made.users.join(',')})`);
  sql(`delete from userAccountAuditEvents where userId in (${made.users.join(',')}) or actorId in (${made.users.join(',')})`);
  sql(`delete from users where id in (${made.users.join(',')})`);
}

check('CLEANUP: the probe account is gone',
  Number(sql(`select count(*) from users where id in (${made.users.join(',')})`)) === 0);

console.log(results.join('\n'));
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
