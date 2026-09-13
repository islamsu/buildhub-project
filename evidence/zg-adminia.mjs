/**
 * ── THE SUPER ADMIN CONTROL PLANE, CLICKED ────────────────────────────────
 *
 * The unit invariants prove the DATA is right - that the menu holds every
 * required domain, that Professional Registrations sits immediately after User
 * Management, that Name Changes and Pending Verifications are no longer second
 * entry points. None of that proves a screen draws, and the defect class this
 * whole reconciliation is about was invisible to source-reading tests: a route
 * existed, a page worked, and the way in was missing.
 *
 * So this clicks. Every sidebar item a real Super Admin is offered, in a real
 * browser, against the real bundle, asserting the URL moved, the page rendered
 * its own content, and nothing refused a properly authorized administrator.
 *
 * THE EXPECTED LIST IS WRITTEN OUT HERE rather than imported from
 * adminNavigation.ts. A probe that reads the same module the unit test reads
 * proves the two agree, not that the product is right; this is an independent
 * statement of what a Super Admin should be offered.
 */
import { launchBrowser } from './lib/cdp.mjs';
import { adminSession, asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 1800) => new Promise(r => setTimeout(r, ms));

/** path -> the label the sidebar must render for it, in that order. */
const EXPECTED = [
  ['/admin', 'Admin Control Panel'],
  ['/admin/users', 'User Management'],
  ['/admin/registrations', 'Professional Registrations'],
  ['/admin/categories', 'Product categories'],
  ['/admin/placements', 'Placements'],
  ['/admin/enquiries', 'Vendor Enquiries'],
  ['/admin/referrals', 'Referrals'],
  ['/admin/disputes', 'Disputes'],
  ['/admin/support', 'Support tickets'],
  ['/admin/reviews', 'Reported reviews'],
  ['/admin/billing', 'Billing & Benefits'],
  ['/admin/analytics', 'Analytics'],
  ['/admin/operations', 'Operations'],
  ['/admin/admins', 'Administrators'],
  ['/admin/settings', 'Settings'],
];

const s = await adminSession('superadmin@buildhub.local', 'LocalSuperAdmin!2024');
if (!s.ok) { console.error('SIGN-IN FAILED:', s.reason); process.exit(1); }

// A FRESH PORT PER RUN. A fixed debugging port means a probe that is still
// winding down blocks the next one, and the second run reports the product as
// broken when the only thing wrong is the first run's browser.
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9400 + (process.pid % 400)));
const browser = await launchBrowser({ port: CDP_PORT });
const page = await browser.newPage();
await page.setCookies(asBrowserCookies(s.cookie));

const sidebarLabels = () => page.evaluate(`
  const out = [];
  for (const el of document.querySelectorAll('[data-sidebar="menu-button"], nav button, aside button')) {
    const label = (el.innerText || '').trim();
    if (label) out.push(label);
  }
  return out;
`);
const clickLabel = label => page.evaluate(`
  for (const el of document.querySelectorAll('button, a')) {
    if ((el.innerText || '').trim() === ${JSON.stringify(label)}) { el.click(); return true; }
  }
  return false;
`);
const here = () => page.evaluate('return location.pathname;');
const bodyText = () => page.evaluate("return document.body.innerText || '';");

try {
  await page.goto(`${BASE}/admin`, { timeoutMs: 25000 });
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await page.goto(`${BASE}/admin`, { timeoutMs: 25000 });
  await settle(3000);

  const labels = await sidebarLabels();
  check(labels.length >= 10, '0. the Super Admin sidebar renders its destinations', `${labels.length} items`);

  const userIdx = labels.findIndex(l => /^User Management$/i.test(l));
  const regIdx = labels.findIndex(l => /^Professional Registrations$/i.test(l));
  check(userIdx >= 0 && regIdx === userIdx + 1,
    '1. PROFESSIONAL REGISTRATIONS IS THE VERY NEXT ITEM AFTER USER MANAGEMENT',
    `users@${userIdx} registrations@${regIdx}`);

  check(!labels.some(l => /^Name Changes$/i.test(l)),
    '2. Name Changes is no longer a top-level sidebar destination');
  check(!labels.some(l => /^Pending Verifications$/i.test(l)),
    '3. Pending Verifications is no longer a second entry point to registrations');

  let clickedOk = 0;
  for (const [path, label] of EXPECTED) {
    const match = labels.find(l => l === label) ?? labels.find(l => l.startsWith(label));
    if (!match) {
      check(false, `4. ${path} is offered as "${label}"`, `sidebar has: ${labels.slice(0, 16).join(' | ')}`);
      continue;
    }
    await page.goto(`${BASE}/admin`, { timeoutMs: 25000 });
    await settle(1100);
    const did = await clickLabel(match);
    await settle(1500);
    const landed = await here();
    const text = await bodyText();
    const ok = Boolean(did) && landed.startsWith(path)
      && !/Access Denied/i.test(text) && text.trim().length > 80;
    if (ok) clickedOk++;
    check(ok, `4. clicking "${match}" lands on ${path} and renders`,
      `clicked=${did} at=${landed} chars=${text.trim().length}`);
  }
  check(clickedOk === EXPECTED.length, '5. EVERY sidebar destination is reachable by clicking it',
    `${clickedOk}/${EXPECTED.length}`);

  await page.goto(`${BASE}/admin/registrations`, { timeoutMs: 25000 });
  await settle(2200);
  const regText = await bodyText();
  for (const [name, needle] of [
    ['the applicant search', /Search applicants/i],
    ['the professional category filter', /Professional category/i],
    ['the submission date range', /Submission date from/i],
    ['the status bands as tabs', /Under review/i],
    ['bulk selection', /Select pending applications/i],
  ]) {
    check(needle.test(regText), `6. Professional Registrations renders ${name}`);
  }

  await page.goto(`${BASE}/admin`, { timeoutMs: 25000 });
  await settle(2000);
  const dashText = await bodyText();
  check(/Professional Registrations/i.test(dashText) && /Review registrations/i.test(dashText),
    '7. /admin shows a registration PREVIEW with a way through to the page');
  check(!/Select pending applications/i.test(dashText) && !/Bulk approve/i.test(dashText),
    '8. and no longer carries bulk approval - a dashboard is not a console');

  await page.goto(`${BASE}/admin/compliance`, { timeoutMs: 25000 });
  await settle(2000);
  check(/Search applicants/i.test(await bodyText()),
    '9. the old /admin/compliance bookmark lands on the registration workflow');

  await page.goto(`${BASE}/admin/name-changes`, { timeoutMs: 25000 });
  await settle(2000);
  check(/Name Change/i.test(await bodyText()),
    '10. the old /admin/name-changes bookmark lands on the name-change queue');

  await page.goto(`${BASE}/admin/users`, { timeoutMs: 25000 });
  await settle(2000);
  check(/Name Change/i.test(await bodyText()),
    '11. User Management offers Name Change Requests as a tab');

  await page.evaluate("localStorage.setItem('buildhub_lang', 'ar'); return true;");
  await page.goto(`${BASE}/admin/registrations`, { timeoutMs: 25000 });
  await settle(2500);
  const arLabels = await sidebarLabels();
  const arText = await bodyText();
  const dir = await page.evaluate("return document.documentElement.getAttribute('dir');");
  check(arLabels.some(l => l.includes('تسجيلات')),
    '12. the Arabic sidebar names Professional Registrations in Arabic',
    arLabels.slice(0, 5).join(' | '));
  check(!arText.includes('admin.registrations') && !arText.includes('adminNav.'),
    '13. no raw translation key falls through to the screen');
  check(dir === 'rtl', '14. the page is laid out right-to-left in Arabic', String(dir));

  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  for (const width of [375, 768, 1440]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${BASE}/admin/registrations`, { timeoutMs: 25000 });
    await settle(1800);
    const overflow = await page.evaluate('return document.documentElement.scrollWidth - document.documentElement.clientWidth;');
    check(overflow <= 2, `15. no horizontal overflow at ${width}px`, `overflow=${overflow}px`);
  }
} catch (error) {
  check(false, 'PROBE COMPLETED', String(error && error.message ? error.message : error).slice(0, 200));
} finally {
  try { browser.close(); } catch {}
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
}
