/**
 * ── ARABIC AS A SUPPORTED INTERFACE, NOT MIRRORED ENGLISH ────────────────
 *
 * Setting dir="rtl" is the easy half. What it does not tell you is whether a
 * person reading Arabic gets an Arabic product: whether the words are Arabic,
 * whether the layout actually moved, and whether the parts that were written
 * against the left edge came with it.
 *
 * Five things are measured, each on real pages in both languages:
 *
 *   DIRECTION      every surface reports dir=rtl, lang=ar and the Arabic
 *                  face - not just the two screens somebody happened to test.
 *   NO RAW KEYS    t() falls back to English and then to the KEY, so a string
 *                  missing from both tables renders as "admin.actions" in
 *                  front of a customer.
 *   REAL WORDS     a button or a heading whose text is byte-identical in the
 *                  two languages, and is Latin script, was never translated.
 *                  Compared per surface, so data on the page is not mistaken
 *                  for an untranslated label.
 *   THE LAYOUT MOVED  chrome that sits at the start of the line in English
 *                  has to sit at the end of it in Arabic. Measured as a
 *                  position, because dir=rtl is set on <html> whether or not
 *                  anything below it responded.
 *   STILL FITS     RTL is where a hardcoded left offset turns into a page
 *                  wider than the phone, so the widths are re-measured.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9700 + (process.pid % 90)));
const PASSWORD = 'LocalSuperAdmin!2024';
const HASH = process.env.ZG_HASH;
if (!HASH) { console.error('set ZG_HASH to an application-minted password hash'); process.exit(2); }
const stamp = Date.now().toString(36);
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 300) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, expression, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let v = 'false';
    try { v = await page.evaluate(`try { return String(${expression}); } catch { return 'false'; }`); } catch {}
    if (v === 'true') { await settle(250); return true; }
    await settle(250);
  }
  return false;
}

async function signIn(email) {
  const res = await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`adminSignIn: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

/**
 * THE CHROME OF A PAGE: the words the product supplies, as opposed to the
 * words the data supplies. Buttons, headings, tabs, nav entries and column
 * headers are written by us; a person's name in a cell is not, and comparing
 * it across languages would report every row as untranslated.
 */
const CHROME = `
  const sel = 'button, a[href], h1, h2, h3, th, label, [role="tab"], nav span';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.offsetParent === null) continue;
    const text = (el.innerText || '').trim();
    if (!text || text.length > 60) continue;
    out.push(text);
  }
  return JSON.stringify(out);
`;

/**
 * A translation key that reached the screen: dotted, lower-case, no spaces.
 *
 * AN EMAIL DOMAIN IS NOT A TRANSLATION KEY. The first version matched
 * "buildhub.local" out of superadmin@buildhub.local and reported the user
 * directory as rendering a raw key - a probe finding produced entirely by the
 * probe's own seeded account. Domains are skipped by the character BEFORE the
 * match rather than by an ever-growing list of suffixes, because the next
 * unlisted TLD would do exactly the same thing again.
 */
const RAW_KEYS = `
  const text = document.body.innerText;
  const pattern = /\\b[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*){1,4}\\b/g;
  const keep = [];
  let m;
  while ((m = pattern.exec(text)) !== null) {
    const before = m.index > 0 ? text[m.index - 1] : '';
    // Part of an address (…@buildhub.local) or of a longer dotted path.
    if (before === '@' || before === '.' || /[a-zA-Z0-9]/.test(before)) continue;
    if (/\\.(com|net|org|sa|io|test|local|dev|js|ts|tsx|png|jpg|svg|pdf)$/.test(m[0])) continue;
    keep.push(m[0]);
  }
  return JSON.stringify([...new Set(keep)].slice(0, 12));
`;

const overflow = page => page.evaluate(`
  const vw = document.documentElement.clientWidth;
  const doc = document.documentElement.scrollWidth;
  const culprits = [];
  if (doc > vw + 1) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;
      let scroller = el.parentElement, contained = false;
      while (scroller && scroller !== document.body) {
        const cs = getComputedStyle(scroller);
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowX === 'hidden') { contained = true; break; }
        scroller = scroller.parentElement;
      }
      if (contained) continue;
      culprits.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 30),
        testid: el.getAttribute('data-testid') || '' });
      if (culprits.length >= 3) break;
    }
  }
  return JSON.stringify({ vw, doc, culprits });
`);


/**
 * WHERE THE NAVIGATION SITS, as a fraction of the screen.
 *
 * dir="rtl" is set on <html> whether or not anything below it responded, so
 * reading that attribute proves only that the attribute is set. What a person
 * notices is that the chrome MOVED: the brand and the navigation start at the
 * right edge in Arabic and at the left edge in English.
 *
 * Measured as a fraction rather than a pixel count so the same assertion holds
 * at any width, and taken from the nav entries themselves rather than from a
 * container, because a full-width container has the same centre either way and
 * would report a page that never mirrored as mirrored.
 */
const navSide = page => page.evaluate(`
  const sel = '[data-testid^="nav-"], [data-testid="brand-home"], [data-testid="brand-home-nav"]';
  const els = [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null);
  if (els.length === 0) return JSON.stringify({ found: 0 });
  const vw = document.documentElement.clientWidth;
  const centres = els.map(e => { const r = e.getBoundingClientRect(); return (r.left + r.width / 2) / vw; });
  return JSON.stringify({ found: els.length, mean: centres.reduce((a, b) => a + b, 0) / centres.length });
`);

const SURFACES = [
  ['/admin', 'Admin control panel'],
  ['/admin/users', 'User management'],
  ['/admin/registrations', 'Professional registrations'],
  ['/admin/categories', 'Categories'],
  ['/admin/placements', 'Placements'],
  ['/admin/enquiries', 'Vendor enquiries'],
  ['/admin/disputes', 'Disputes'],
  ['/admin/support', 'Support'],
  ['/admin/reviews', 'Reviews'],
  ['/admin/operations', 'Operations'],
  ['/admin/billing', 'Billing & benefits'],
  ['/admin/admins', 'Administrators'],
  ['/admin/settings', 'Settings'],
];

const browser = await launchBrowser({ port: CDP_PORT });
let step = 1;

try {
  sql(`delete from users where username like 'zrtl%'`);
  const u = `zrtl${stamp}`;
  sql(`insert into users (openId, username, email, name, role, adminRole, userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${u}', '${u}', '${u}@example.test', 'Probe RTL', 'admin',
        'SUPER_ADMIN', 'admin', 'password', 'admin_created', 0, 'active', 'approved', 1,
        '${HASH}', now())`);
  check(Number(sql(`select id from users where username='${u}'`)) > 0,
    `${step}. SETUP: a real administrator exists`);
  step++;

  /*
   * TWO THINGS ARE RIGHTLY THE SAME IN BOTH LANGUAGES, and they are excluded
   * by name rather than by guesswork.
   *
   * The BRAND is a proper noun. And the PEOPLE AND BUSINESSES on the page are
   * records, not copy - a directory does not translate somebody's name, and
   * the first run of this reported every seeded account as an untranslated
   * label. They are excluded by reading the same database the page reads, so
   * the exclusion is exact instead of a pattern that might also swallow a
   * real finding.
   */
  const names = new Set(
    sql(`select name from users where name is not null and name <> ''
         union select email from users where email is not null and email <> ''`)
      .split('\n').map(v => v.trim()).filter(Boolean));
  const BRAND = new Set(['BuildHub']);
  const isData = text => BRAND.has(text) || names.has(text);

  const cookie = await signIn(`${u}@example.test`);
  const page = await browser.newPage();
  await page.setCookies(asBrowserCookies(cookie));
  await page.setViewport({ width: 1440, height: 900 });

  /* English first, and pinned - a language left over from an earlier block is
   * how a probe ends up comparing a page with itself. */
  await page.goto(`${BASE}/admin`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");

  const english = new Map();
  const englishNav = new Map();
  for (const [path, label] of SURFACES) {
    await page.goto(`${BASE}${path}`);
    await waitFor(page, `document.body.innerText.trim().length > 60`);
    await settle(400);
    english.set(path, JSON.parse(await page.evaluate(CHROME)));
    englishNav.set(path, JSON.parse(await navSide(page)));
  }
  const enTotal = [...english.values()].reduce((n, v) => n + v.length, 0);
  check(enTotal > 200, `${step}. BASELINE: the English chrome was read`,
    `${enTotal} labels across ${SURFACES.length} surfaces`);
  step++;

  await page.goto(`${BASE}/admin`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'ar'); return true;");
  await page.goto(`${BASE}/admin`);
  await waitFor(page, `document.documentElement.dir === 'rtl'`);

  const wrongDir = [];
  const rawKeys = [];
  const untranslated = [];
  const arabicShare = [];
  const navMoved = [];
  const noNav = [];
  for (const [path, label] of SURFACES) {
    await page.goto(`${BASE}${path}`);
    await waitFor(page, `document.body.innerText.trim().length > 60`);
    await settle(400);

    const meta = JSON.parse(await page.evaluate(`
      return JSON.stringify({
        dir: document.documentElement.dir,
        lang: document.documentElement.lang,
        font: getComputedStyle(document.body).fontFamily,
      });
    `));
    if (meta.dir !== 'rtl' || meta.lang !== 'ar' || !/Cairo/i.test(meta.font)) {
      wrongDir.push(`${label}: dir=${meta.dir} lang=${meta.lang} font=${meta.font.slice(0, 20)}`);
    }

    const keys = JSON.parse(await page.evaluate(RAW_KEYS));
    if (keys.length) rawKeys.push(`${label}: ${keys.join(', ').slice(0, 70)}`);

    const ar = JSON.parse(await page.evaluate(CHROME));
    const en = english.get(path) ?? [];
    /*
     * IDENTICAL AND LATIN. A label that came back the same in both languages
     * and carries no Arabic is one the Arabic table never covered. Anything
     * with an Arabic character is translated; anything that differs between
     * the two renders is data rather than chrome.
     */
    const enSet = new Set(en);
    const same = ar.filter(text => enSet.has(text)
      && /[A-Za-z]{3}/.test(text)
      && !/[\u0600-\u06FF]/.test(text)
      && !isData(text));
    if (same.length) untranslated.push(`${label}: ${[...new Set(same)].join(' | ')}`);

    const arNav = JSON.parse(await navSide(page));
    const enNav = englishNav.get(path) ?? { found: 0 };
    if (enNav.found > 0 && arNav.found > 0) {
      navMoved.push({ label, en: enNav.mean, ar: arNav.mean });
    } else {
      noNav.push(`${label}: en ${enNav.found} ar ${arNav.found}`);
    }

    const withArabic = ar.filter(text => /[؀-ۿ]/.test(text)).length;
    arabicShare.push({ label, withArabic, total: ar.length });
  }

  check(wrongDir.length === 0, `${step}. every Arabic surface is RTL, lang=ar and set in the Arabic face`,
    wrongDir.length ? `${wrongDir.length}: ${wrongDir[0]}` : `${SURFACES.length} surfaces`);
  step++;

  check(rawKeys.length === 0, `${step}. NO TRANSLATION KEY reaches the screen`,
    rawKeys.length ? `${rawKeys.length} surface(s): ${rawKeys[0]}` : `${SURFACES.length} surfaces clean`);
  step++;

  const covered = arabicShare.reduce((n, s) => n + s.withArabic, 0);
  const totalAr = arabicShare.reduce((n, s) => n + s.total, 0);
  check(untranslated.length === 0, `${step}. the words a person reads are Arabic`,
    untranslated.length
      ? `${untranslated.length} surface(s)\n      ` + untranslated.join('\n      ')
      : `${covered} of ${totalAr} labels carry Arabic script`);
  step++;

  /*
   * MIRRORED, not merely marked. English navigation sits in the left half of
   * the screen and Arabic navigation has to sit in the right half - a surface
   * where the two means are on the same side kept its layout and only changed
   * its words, which is the "mirrored English" this pass exists to catch.
   */
  const stuck = navMoved.filter(n => !(n.en < 0.5 && n.ar > 0.5))
    .map(n => `${n.label}: en ${n.en.toFixed(2)} ar ${n.ar.toFixed(2)}`);
  check(navMoved.length >= SURFACES.length - 1 && stuck.length === 0,
    `${step}. THE LAYOUT MOVED: navigation starts at the right edge in Arabic`,
    stuck.length
      ? `${stuck.length} of ${navMoved.length} did not move: ${stuck[0]}`
      : noNav.length ? `no navigation on ${noNav.length}: ${noNav.join('; ')}`
      : `${navMoved.length} surfaces, mean nav centre ${(navMoved.reduce((a, n) => a + n.en, 0) / navMoved.length).toFixed(2)} in English and ${(navMoved.reduce((a, n) => a + n.ar, 0) / navMoved.length).toFixed(2)} in Arabic`);
  step++;

  /*
   * ARABIC STILL FITS. RTL is where a left-anchored offset turns into a page
   * wider than the phone: the content moves and the hardcoded edge does not,
   * so the two pull apart. The English widths were measured elsewhere; these
   * are the same three widths with the layout mirrored.
   *
   * A table that scrolls inside its own container is not counted, the same as
   * in the English pass - that is the intended pattern, and calling it a
   * defect would push the product toward shrinking a desktop table until it
   * is unreadable.
   */
  const wide = [];
  for (const width of [375, 768, 1440]) {
    await page.setViewport({ width, height: width < 768 ? 812 : 900 });
    for (const [path, label] of SURFACES) {
      await page.goto(`${BASE}${path}`);
      await waitFor(page, `document.body.innerText.trim().length > 60`);
      await settle(350);
      const o = JSON.parse(await overflow(page));
      if (o.culprits.length) {
        wide.push(`${width}px ${label} (${o.doc}>${o.vw}): ${o.culprits.map(c => c.testid || `${c.tag}.${c.cls}`).join(' | ').slice(0, 70)}`);
      }
    }
  }
  check(wide.length === 0, `${step}. ARABIC FITS at 375, 768 and 1440`,
    wide.length ? `${wide.length}: ${wide[0]}` : `${SURFACES.length * 3} measurements, no page wider than its screen`);
  step++;
} finally {
  sql(`delete from users where username like 'zrtl%'`);
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
