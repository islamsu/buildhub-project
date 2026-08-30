// ── LIVE: the supplier dashboard layout the brief specifies (§8) ───────────
//
// Ordering rules are exactly the kind of claim that reads as satisfied in
// source and is wrong on screen, so every one of these is measured from the
// RENDERED DOM in document order - not from the config array that produced it.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B -e ${JSON.stringify(q)}`).toString().trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 } });
await ctx.route('**/*', r => {
  const h = new URL(r.request().url()).hostname;
  return (h === '127.0.0.1' || h === 'localhost') ? r.continue() : r.abort();
});

const stamp = Date.now() % 100000000;
const made = [];
const p = await ctx.newPage();

async function go(u, width) {
  if (width) await p.setViewportSize({ width, height: 1200 });
  await p.goto(BASE + u, { waitUntil: 'domcontentloaded' });
  try { await p.waitForLoadState('networkidle', { timeout: 6000 }); } catch {}
  await p.waitForTimeout(900);
}

try {
  // ── A real supplier, registered through the real form ───────────────────
  await go('/auth');
  await (await p.locator('button.p-4.rounded-xl').all())[0].click();
  const u = `sux${stamp}`;
  await p.getByPlaceholder(/username|اسم/i).fill(u);
  await p.locator('input[type="email"]').fill(`${u}@example.test`);
  const pw = p.locator('input[type="password"]');
  await pw.nth(0).fill('SupplierUx!2026'); await pw.nth(1).fill('SupplierUx!2026');
  await p.getByRole('button', { name: /create account|إنشاء/i }).last().click();
  await p.waitForTimeout(2600);
  const me = await p.evaluate(async () =>
    (await (await fetch('/api/trpc/auth.me', { credentials: 'include' })).json())?.result?.data?.json ?? null);
  if (!me?.id) throw new Error('registration failed');
  made.push(me.id);
  sql(`update users set userRole='supplier', onboardingStatus='approved', verified=0 where id=${me.id}`);
  await go('/');

  await go('/platform/supplier');
  check('the supplier workspace loads', /supplier/i.test(p.url()), p.url());

  // ── §8: the SIDEBAR order, read from the rendered DOM ───────────────────
  // Read the menu by its OWN test ids, in document order. Guessing at
  // <aside>/<nav> found nothing and made five ordering checks fail for a
  // reason that had nothing to do with ordering.
  const menu = await p.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="nav-"]')]
      .map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean));
  check('SETUP: the sidebar rendered items to measure', menu.length > 3, `${menu.length} items`);

  const at = re => menu.findIndex(m => re.test(m));
  const iOverview = at(/^overview$/i);
  const iQuotations = at(/quotation/i);
  const iCatalogue = at(/catalogue|catalog/i);
  const iSettings = at(/^settings$/i);
  const iCompliance = at(/compliance/i);
  const iEnquiries = at(/^enquiries$/i);
  const iCategories = at(/service categories/i);

  check('§8 QUOTATIONS COME IMMEDIATELY AFTER THE OVERVIEW (Quick Actions)',
    iOverview >= 0 && iQuotations === iOverview + 1,
    `overview=${iOverview} quotations=${iQuotations} | ${menu.join(' · ')}`);

  check('§8 CATALOGUE APPEARS EXACTLY ONCE',
    menu.filter(m => /catalogue|catalog/i.test(m)).length === 1,
    `${menu.filter(m => /catalogue|catalog/i.test(m)).length} occurrences`);

  check('§8 LEGAL COMPLIANCE COMES IMMEDIATELY AFTER SETTINGS',
    iSettings >= 0 && iCompliance === iSettings + 1,
    `settings=${iSettings} compliance=${iCompliance}`);

  check('§8 Enquiries is offered as its own destination', iEnquiries >= 0, `index=${iEnquiries}`);
  check('§8 Service categories is offered as its own destination', iCategories >= 0, `index=${iCategories}`);

  // ── §8: the WORKSPACE section order, also from the DOM ───────────────────
  // By ID, not by tag: role-catalogue is a <div>, so a `section[id^=...]`
  // selector silently reported four of the seven sections as missing.
  const sections = await p.evaluate(() =>
    [...document.querySelectorAll('[id^="role-"]')].map(s => s.id));
  check('SETUP: the workspace rendered its sections', sections.length > 2, sections.join(' · '));
  check('§8 the QUOTATIONS SECTION follows the overview on the page itself',
    sections.indexOf('role-quotations') === sections.indexOf('role-overview') + 1,
    sections.join(' · '));
  check('the catalogue section is present exactly once',
    sections.filter(s => s === 'role-catalogue').length === 1);

  // ── The dedicated pages actually exist and are not dead links ───────────
  await go('/enquiries');
  check('the Enquiries page opens as its own page, not a workspace anchor',
    await p.locator('[data-testid="enquiries-page"]').count() > 0, p.url());
  check('and it is not a generic Home redirect', /\/enquiries/.test(p.url()), p.url());

  // The notification deep link must survive the move.
  await go('/enquiries?rfq=123');
  check('the ?rfq= deep link still lands on Enquiries - existing notifications keep working',
    await p.locator('[data-testid="enquiries-page"]').count() > 0 && /rfq=123/.test(p.url()), p.url());

  await go('/service-categories');
  check('the Service categories page opens as its own page',
    await p.locator('[data-testid="service-categories-page"]').count() > 0, p.url());

  // ── Every sidebar entry goes somewhere real ─────────────────────────────
  await go('/platform/supplier');
  // CLICKED, NOT READ. The sidebar renders SidebarMenuButton with an onClick
  // handler, not <a href>, so an href sweep found zero links and reported a
  // vacuous PASS over nothing. Clicking exercises the real handler, which is
  // what a reader actually does and what a dead control would fail.
  const navIds = await p.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="nav-"]')].map(el => el.getAttribute('data-testid') ?? ''));
  check('SETUP: the sidebar exposes controls to click', navIds.length > 3, `${navIds.length} controls`);

  const deadEnds = [];
  for (const id of navIds) {
    await go('/platform/supplier');
    const before = p.url();
    const control = p.locator(`[data-testid="${id}"]`).first();
    if (await control.count() === 0) { deadEnds.push(`${id} (vanished)`); continue; }
    const label = (await control.textContent() ?? '').trim();
    // Read BEFORE clicking: after navigation the locator is stale and the
    // attribute read hangs until timeout.
    const isCurrent = (await control.getAttribute('aria-current')) === 'page';
    await control.click().catch(() => {});
    await p.waitForTimeout(1600);
    const landed = p.url().replace(BASE, '');
    const blank = (await p.evaluate(() => document.body.innerText.trim().length)) < 40;
    // Three failures the brief names: nothing happened, it bounced to Home, or
    // it opened an empty page.
    const inert = p.url() === before && !/#/.test(p.url());
    const bounced = landed === '/';
    // A control marked aria-current="page" is not a dead control - it is where
    // the reader already is, and the UI says so. Overview behaves exactly this
    // way from the top of its own workspace. Excluding it is a correction to
    // the probe, not a weakening: anything inert WITHOUT that marking still
    // fails, which is the misleading case the brief actually names.
    if (bounced || blank) deadEnds.push(`${label || id} -> ${landed}${blank ? ' (blank)' : ''}`);
    else if (inert && !isCurrent) deadEnds.push(`${label || id} (did nothing, and is not marked current)`);
  }
  check('NO DEAD ENDS: every sidebar control does something and none bounces to Home',
    navIds.length > 3 && deadEnds.length === 0,
    `clicked=${navIds.length} | ${deadEnds.join(' | ') || 'all reachable'}`);

  // ── Responsive and Arabic ───────────────────────────────────────────────
  for (const width of [375, 768, 1440]) {
    await go('/platform/supplier', width);
    const overflow = await p.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    check(`RESPONSIVE ${width}px: the supplier dashboard does not scroll horizontally`, !overflow);
  }

  await p.evaluate(() => localStorage.setItem('buildhub_lang', 'ar'));
  await go('/platform/supplier', 1440);
  const dir = await p.evaluate(() => document.documentElement.getAttribute('dir')
    ?? getComputedStyle(document.body).direction);
  check('ARABIC: the supplier dashboard renders right-to-left', dir === 'rtl', `dir=${dir}`);
  const arMenu = await p.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="nav-"]')].map(el => (el.textContent ?? '').trim()).join(' '));
  check('SETUP: the Arabic sidebar rendered something to inspect', arMenu.trim().length > 10, `${arMenu.length} chars`);
  check('ARABIC: no untranslated key leaks into the sidebar',
    !/platform\.|settings\.|dash\./.test(arMenu),
    (arMenu.match(/[a-z]+\.[a-z_]+/i) ?? ['none'])[0]);

  await p.evaluate(() => localStorage.setItem('buildhub_lang', 'en'));
  await go('/platform/supplier');
  const enMenu = await p.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="nav-"]')].map(el => (el.textContent ?? '').trim()).join(' '));
  check('ENGLISH: no untranslated key leaks into the sidebar either',
    !/platform\.|settings\.|dash\./.test(enMenu),
    (enMenu.match(/[a-z]+\.[a-z_]+/i) ?? ['none'])[0]);

} catch (error) {
  check('the probe ran to completion', false, String(error.message).split('\n')[0].slice(0, 140));
} finally {
  for (const id of made) {
    for (const q of [
      `delete from notifications where userId=${id}`,
      `delete from qualifiedEnquiries where userId=${id}`,
      `delete from vendorCategories where userId=${id}`,
      `delete from vendorProfiles where userId=${id}`,
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
      `delete from analyticsEvents where userId=${id}`,
      `delete from billingEvents where userId=${id} or actorId=${id}`,
      `delete from vendorSubscriptions where userId=${id}`,
      `delete from users where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  await b.close();
  console.log(results.join('\n'));
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
}
