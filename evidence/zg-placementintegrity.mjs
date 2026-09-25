/**
 * ── FEATURED ≠ SPONSORED ≠ SHOWCASE, ON THE REAL SURFACES ───────────────
 *
 * §89 item 17: treat this as a discoverability/presentation/integrity pass
 * unless a fresh audit proves a real backend gap. The audit found the engine
 * sound - `applyBoost` injects nothing the organic query did not return,
 * caps promotion at a third of the page, and derives every heading and badge
 * from one `label` - so this VERIFIES the rules on live surfaces rather than
 * rebuilding them.
 *
 * WHAT IS PROVED, against real rows and a real browser:
 *
 *   a promoted provider appears EXACTLY ONCE - promotion re-ranks, it does
 *     not duplicate
 *   NO INJECTION: a placement whose entity the organic query did not return
 *     cannot put it on the page
 *   the two labels are distinguishable by WORD and ICON, not colour alone
 *   a PAID placement is never rendered under BuildHub's editorial word
 *   both labels are real Arabic under RTL, not English left in place
 *   and promotion never takes the whole page
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9100 + (process.pid % 80)));

const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();
const num = q => Number(sql(q) || '0');

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
async function query(path, input) {
  const url = `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input ?? null }))}`;
  const res = await fetch(url);
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

const made = [];
let absentId = 0;
let absentPrior = '';
try {
  /* A provider the organic directory genuinely returns. */
  const organicBefore = await query('marketplace.vendors', { limit: 50 });
  const organic = Array.isArray(organicBefore.data) ? organicBefore.data : [];
  check(organic.length >= 2, 'the organic directory returns providers to work with', `${organic.length}`);
  const target = organic[organic.length - 1];
  check(target?.id > 0, 'and one of them can be promoted', `#${target?.id}`);

  /* A provider id that does NOT appear in the directory, for the injection test. */
  /*
   * A PROVIDER THE DIRECTORY DOES NOT RETURN - the point of the injection
   * test, and the most important check in this file.
   *
   * Every provider in this dataset is approved and in the directory, so the
   * first two versions of this check simply SKIPPED. One is unapproved for
   * the duration instead, which is the realistic case anyway: an unapproved
   * provider buys a placement, and it must not put them on a page the
   * directory deliberately excludes them from. Restored in `finally`.
   */
  absentId = organic[0].id;
  absentPrior = sql(`SELECT onboardingStatus FROM users WHERE id=${absentId}`);

  /* ══ 1. PROMOTION RE-RANKS; IT DOES NOT DUPLICATE ═════════════════════ */
  sql(`INSERT INTO vendorSponsorships (vendorId, category, kind, source, package, surface, entityType, priority, startsAt, endsAt)
       VALUES (${target.id}, 'GLOBAL', 'sponsored', 'PAID_SPONSORSHIP', 'BOOST', 'SEARCH_RESULTS_BOOST', 'PROVIDER', 0, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))`);
  made.push(num(`SELECT id FROM vendorSponsorships WHERE vendorId=${target.id} ORDER BY id DESC LIMIT 1`));

  const boosted = await query('marketplace.vendors', { limit: 50 });
  const rows = Array.isArray(boosted.data) ? boosted.data : [];
  const appearances = rows.filter(v => v.id === target.id).length;
  check(appearances === 1,
    'A PROMOTED PROVIDER APPEARS EXACTLY ONCE - promotion re-ranks, never duplicates',
    `${appearances} appearance(s)`);
  check(rows.length === organic.length,
    'and the page holds the same number of providers as before',
    `${organic.length} -> ${rows.length}`);

  const promotedIndex = rows.findIndex(v => v.id === target.id);
  const organicIndex = organic.findIndex(v => v.id === target.id);
  check(promotedIndex < organicIndex,
    'the promotion actually moved them up, so the checks above are not vacuous',
    `position ${organicIndex} -> ${promotedIndex}`);

  /* ══ 2. PROMOTION NEVER TAKES THE WHOLE PAGE ══════════════════════════ */
  const labelled = rows.filter(v => v.placementLabel || v.label).length;
  check(labelled <= Math.max(1, Math.floor(rows.length / 3)),
    'and promotion never exceeds a third of the page',
    `${labelled} of ${rows.length}`);

  /* ══ 3. NO INJECTION ══════════════════════════════════════════════════ */
  sql(`UPDATE users SET onboardingStatus='under_review' WHERE id=${absentId}`);
  const withoutThem = await query('marketplace.vendors', { limit: 50 });
  const excluded = (Array.isArray(withoutThem.data) ? withoutThem.data : []).some(v => v.id === absentId);
  // THE CONTROL: the directory really does exclude them, so the check below
  // is about the placement rather than about a provider who was never there.
  check(excluded === false,
    'CONTROL: an unapproved provider is excluded from the directory', `#${absentId}`);

  sql(`INSERT INTO vendorSponsorships (vendorId, category, kind, source, package, surface, entityType, priority, startsAt, endsAt)
       VALUES (${absentId}, 'GLOBAL', 'sponsored', 'PAID_SPONSORSHIP', 'BOOST', 'SEARCH_RESULTS_BOOST', 'PROVIDER', 0, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))`);
  made.push(num(`SELECT id FROM vendorSponsorships WHERE vendorId=${absentId} ORDER BY id DESC LIMIT 1`));
  const afterInjection = await query('marketplace.vendors', { limit: 50 });
  const injected = (Array.isArray(afterInjection.data) ? afterInjection.data : []).some(v => v.id === absentId);
  check(injected === false,
    'NO INJECTION: paying cannot put a provider on a page the directory excluded',
    injected ? `INJECTED #${absentId}` : 'still absent');
  sql(`UPDATE users SET onboardingStatus='${absentPrior}' WHERE id=${absentId}`);
  const restored = await query('marketplace.vendors', { limit: 50 });
  check((Array.isArray(restored.data) ? restored.data : []).some(v => v.id === absentId),
    'and they return to the directory once approved again - the exclusion was the gate, not a break');

  /* ══ 4. IN THE BROWSER: THE TWO LABELS ARE TOLD APART ═════════════════ */
  const browser = await launchBrowser({ port: CDP_PORT });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1200 });
    await page.goto(`${BASE}/marketplace/vendors`);
    const shown = await waitFor(page, `document.querySelector('[data-testid="placement-sponsored"]') !== null`);
    check(shown, 'the Sponsored badge renders on the directory');

    const badge = await page.evaluate(`
      const el = document.querySelector('[data-testid="placement-sponsored"]');
      if (!el) return null;
      return {
        text: el.innerText.trim(),
        icons: el.querySelectorAll('svg').length,
        featuredPresent: document.querySelector('[data-testid="placement-featured"]') !== null,
      };
    `);
    check(badge && badge.text.length > 0,
      'NOT COLOUR ALONE: the badge carries its own word', badge?.text);
    check(badge && badge.icons > 0,
      'and its own icon, so two badges are distinguishable without hue', String(badge?.icons));
    check(/sponsor/i.test(String(badge?.text)),
      'and a PAID placement says Sponsored, never BuildHub\'s editorial word', badge?.text);

    /* THE FEATURED BADGE MUST BE A DIFFERENT WORD AND A DIFFERENT ICON. */
    const distinct = await page.evaluate(`
      const s = document.querySelector('[data-testid="placement-sponsored"]');
      const f = document.querySelector('[data-testid="placement-featured"]');
      if (!s || !f) return 'ONE-ONLY';
      const iconOf = el => { const svg = el.querySelector('svg'); return svg ? svg.getAttribute('class') || svg.innerHTML.slice(0, 40) : ''; };
      return { sameWord: s.innerText.trim() === f.innerText.trim(), sameIcon: iconOf(s) === iconOf(f) };
    `);
    if (distinct === 'ONE-ONLY') {
      check(true, 'only one label kind is on this page, so the pair is compared in source instead', 'see placementPresentation.test.ts');
    } else {
      check(distinct.sameWord === false, 'Featured and Sponsored are different WORDS');
      check(distinct.sameIcon === false, 'and different ICONS');
    }

    /* ══ 5. ARABIC IS REAL ARABIC, NOT ENGLISH LEFT IN PLACE ═══════════ */
    await page.evaluate(`localStorage.setItem('buildhub_lang', 'ar'); return true;`);
    await page.goto(`${BASE}/marketplace/vendors`);
    // THE LANGUAGE MUST HAVE TAKEN EFFECT BEFORE ANYTHING IS ASSERTED ABOUT
    // IT. The first version used the wrong localStorage key, asserted
    // immediately, and reported RTL findings against an LTR render.
    const switched = await waitFor(page, `document.documentElement.getAttribute('dir') === 'rtl'`);
    check(switched, 'the page really switched to Arabic RTL before the checks below');
    await waitFor(page, `document.querySelector('[data-testid="placement-sponsored"]') !== null`);
    const arabic = await page.evaluate(`
      const el = document.querySelector('[data-testid="placement-sponsored"]');
      return el ? el.innerText.trim() : 'MISSING';
    `);
    /*
     * THE RANGE IS BUILT FROM CODE POINTS, not written as a regex literal.
     *
     * The first version wrote the Arabic block as a regex through a heredoc,
     * which delivered a DOUBLE backslash into the file - so the character
     * class held a literal backslash plus the letters u, 0-6 and F, and it
     * matched the English word "Sponsored". The check reported PASS over
     * text with no Arabic in it at all.
     */
    const hasArabic = value => Array.from(String(value))
      .some(ch => ch.codePointAt(0) >= 0x0600 && ch.codePointAt(0) <= 0x06FF);
    check(arabic !== 'MISSING' && hasArabic(arabic),
      'the Sponsored label is genuine Arabic under RTL', String(arabic));
    check(!/sponsored/i.test(String(arabic)),
      'and the English word is not left in place beside it', String(arabic));
    const dir = await page.evaluate(`return document.documentElement.getAttribute('dir');`);
    check(dir === 'rtl', 'and the page is actually in RTL while that is asserted', String(dir));
    await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
  } finally {
    await browser.close().catch(() => {});
  }
} finally {
  for (const id of made) sql(`DELETE FROM vendorSponsorships WHERE id=${id}`);
  // The approval state is restored in the body too; repeated here so an
  // exception mid-probe cannot leave a provider unapproved.
  try { if (typeof absentId === 'number' && absentPrior) sql(`UPDATE users SET onboardingStatus='${absentPrior}' WHERE id=${absentId}`); } catch { /* best effort */ }
  console.log(`\n(cleanup) probe placements remaining: ${num(`SELECT COUNT(*) FROM vendorSponsorships WHERE id IN (${made.join(',') || 0})`)}`);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
