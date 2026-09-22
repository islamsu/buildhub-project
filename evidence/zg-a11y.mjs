/**
 * ── ACCESSIBILITY, EXERCISED RATHER THAN SCORED ──────────────────────────
 *
 * Not a scanner run. A scanner reports that an input has no label; it cannot
 * tell you that tabbing off the last filter lands somewhere useless, that a
 * dialog drops focus back to the top of the page when it closes, or that the
 * only thing distinguishing "approved" from "rejected" is the colour of a dot.
 *
 * So this loads real pages as a real signed-in administrator and a real
 * provider, computes the accessible name of every interactive element the way
 * a screen reader would, walks the heading structure, tabs through the page,
 * opens a dialog and follows the focus.
 *
 * WHAT IT DOES NOT DO: contrast ratios and colour rendering. Those need a
 * paint-level measurement this harness does not have, and guessing at them
 * from CSS text would be a score rather than a finding.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';

/* WHICH BUILD THIS RAN AGAINST. Printed always; enforced when
   ZG_EXPECT_COMMIT names one, so a pass can never be reported against
   a build somebody did not mean to test. */
await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9500 + (process.pid % 90)));
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 250) => new Promise(r => setTimeout(r, ms));
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

const PASSWORD = 'LocalSuperAdmin!2024';
const HASH = process.env.ZG_HASH;
if (!HASH) { console.error('set ZG_HASH to an application-minted password hash'); process.exit(2); }
const stamp = Date.now() % 100000000;

/**
 * The accessible name of an element, computed the way the platform does.
 *
 * Deliberately GENEROUS - aria-label, a labelled-by target, visible text, an
 * image's alt, a title, an sr-only child. A control this cannot name is one a
 * screen reader announces as "button".
 */
const NAME_FN = `
  function accName(el) {
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    const ref = el.getAttribute('aria-labelledby');
    if (ref) {
      const text = ref.split(/\\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ').trim();
      if (text) return text;
    }
    const own = (el.innerText || '').trim();
    if (own) return own;
    const img = el.querySelector('img[alt]');
    if (img && img.getAttribute('alt').trim()) return img.getAttribute('alt').trim();
    const title = (el.getAttribute('title') || '').trim();
    if (title) return title;
    if (el.tagName === 'INPUT') {
      const id = el.getAttribute('id');
      if (id) {
        const label = document.querySelector('label[for="' + CSS.escape(id) + '"]');
        if (label && label.innerText.trim()) return label.innerText.trim();
      }
      const wrapping = el.closest('label');
      if (wrapping && wrapping.innerText.trim()) return wrapping.innerText.trim();
      const ph = (el.getAttribute('placeholder') || '').trim();
      if (ph) return ph;
    }
    return '';
  }
`;

/** Every interactive element on the page that a screen reader cannot name. */
const unnamedControls = page => page.evaluate(`
  ${NAME_FN}
  const seen = [];
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role="button"], [role="tab"], [role="link"]')) {
    if (el.offsetParent === null && el.getAttribute('aria-hidden') !== 'false') continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    if (accName(el)) continue;
    seen.push({ tag: el.tagName.toLowerCase(), testid: el.getAttribute('data-testid') || '', cls: (el.className || '').toString().slice(0, 40) });
  }
  return JSON.stringify(seen);
`);

/** The heading outline, in document order. */
const headings = page => page.evaluate(`
  return JSON.stringify([...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .filter(h => h.offsetParent !== null)
    .map(h => ({ level: Number(h.tagName[1]), text: (h.innerText || '').trim().slice(0, 50) })));
`);

async function signIn(email) {
  const res = await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`adminSignIn: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

const browser = await launchBrowser({ port: CDP_PORT });
const findings = [];

try {
  sql(`delete from users where username like 'za11y%'`);
  const u = `za11y${stamp}`;
  sql(`insert into users (openId, username, email, name, role, adminRole, userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${u}', '${u}', '${u}@example.test', 'Probe Super', 'admin',
        'SUPER_ADMIN', 'admin', 'password', 'admin_created', 0, 'active', 'approved', 1,
        '${HASH}', now())`);
  const adminId = Number(sql(`select id from users where username='${u}'`));
  check(adminId > 0, '1. SETUP: a real administrator exists', `#${adminId}`);

  const cookie = await signIn(`${u}@example.test`);
  const page = await browser.newPage();
  await page.setCookies(asBrowserCookies(cookie));
  await page.goto(`${BASE}/admin`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");

  // ── Every interactive control can be named ────────────────────────────
  const SURFACES = [
    ['/admin', 'Admin control panel'],
    ['/admin/users', 'User management'],
    ['/admin/operations', 'Operations'],
    ['/admin/disputes', 'Disputes'],
    ['/marketplace', 'Marketplace hub'],
    ['/pricing', 'Pricing'],
  ];
  let step = 2;
  for (const [path, label] of SURFACES) {
    await page.goto(`${BASE}${path}`);
    await waitFor(page, `document.body.innerText.trim().length > 120`);
    const unnamed = JSON.parse(await unnamedControls(page));
    if (unnamed.length) findings.push(`${path}: ${unnamed.length} unnamed (${unnamed.map(u => u.testid || u.tag).join(', ').slice(0, 90)})`);
    check(unnamed.length === 0,
      `${step}. ${label}: every interactive control has an accessible name`,
      unnamed.length ? `${unnamed.length} unnamed: ${unnamed.map(u => u.testid || `${u.tag}.${u.cls}`).join(' | ').slice(0, 110)}` : 'all named');
    step++;
  }

  // ── Heading structure ─────────────────────────────────────────────────
  for (const [path, label] of [['/admin/users', 'User management'], ['/marketplace', 'Marketplace hub']]) {
    await page.goto(`${BASE}${path}`);
    await waitFor(page, `document.querySelectorAll('h1,h2,h3').length > 0`);
    const outline = JSON.parse(await headings(page));
    const levels = outline.map(h => h.level);
    const skips = levels.map((l, i) => (i > 0 && l - levels[i - 1] > 1 ? `${levels[i - 1]}->${l}` : null)).filter(Boolean);
    check(skips.length === 0, `${step}. ${label}: the heading outline skips no level`,
      skips.length ? `skips: ${skips.join(', ')}` : `${levels.join(',')}`);
    step++;
  }

  // ── Keyboard: focus is visible and moves ──────────────────────────────
  await page.goto(`${BASE}/admin/users`);
  await waitFor(page, `document.body.innerText.trim().length > 200`);
  const focusWalk = JSON.parse(await page.evaluate(`
    const order = [];
    let guard = 0;
    document.body.focus();
    while (guard++ < 12) {
      const before = document.activeElement;
      // Tab is synthesised by walking the same set the browser would.
      const focusables = [...document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(el => el.offsetParent !== null);
      const at = focusables.indexOf(before);
      const next = focusables[at + 1] ?? focusables[0];
      if (!next) break;
      next.focus();
      if (document.activeElement !== next) break;
      const style = getComputedStyle(next, ':focus-visible');
      order.push({
        tag: next.tagName.toLowerCase(),
        outline: style.outlineStyle !== 'none' || style.boxShadow !== 'none',
      });
    }
    return JSON.stringify(order);
  `));
  check(focusWalk.length >= 8, `${step}. KEYBOARD: focus moves through the page`, `${focusWalk.length} stops`);
  step++;
  const unfocusable = focusWalk.filter(f => !f.outline).length;
  check(unfocusable === 0, `${step}. and every stop shows a visible focus indicator`,
    unfocusable ? `${unfocusable} of ${focusWalk.length} stops have no outline or ring` : 'all visible');
  step++;

  // ── A dialog takes focus and gives it back ────────────────────────────
  await page.goto(`${BASE}/admin/users`);
  await waitFor(page, `!!document.querySelector('[data-testid^="admin-user-link-"], table')`);
  const dialogStory = JSON.parse(await page.evaluate(`
    /*
     * A DIALOG OPENER, NOT ANY BUTTON MENTIONING AUDIT.
     *
     * The first version matched /audit/i and picked "Export Audit PDF" - which
     * downloads a file and opens nothing - so the dialog checks failed against
     * a control that was never going to open one, and the focus-restoration
     * check then PASSED because focus had never left. A probe that picks the
     * wrong element reports the product as broken and its own next assertion
     * as fine.
     */
    const opener = [...document.querySelectorAll('button[data-testid], button')]
      .filter(b => b.offsetParent !== null)
      .find(b => /^(audit|السجل)$/i.test((b.innerText || '').trim()));
    if (!opener) return JSON.stringify({ opened: false, reason: 'no audit button on this page' });
    opener.focus();
    const openerTag = (opener.getAttribute('data-testid') || opener.innerText.trim()).slice(0, 24);
    opener.click();
    return JSON.stringify({ opened: true, openerTag });
  `));
  if (!dialogStory.opened) {
    check(false, `${step}. DIALOG: an opener could be found`, dialogStory.reason);
    step++;
  } else {
    const dialogAppeared = await waitFor(page, `!!document.querySelector('[role="dialog"]')`);
    check(dialogAppeared, `${step}. DIALOG: opens from the keyboard-focused control`, dialogStory.openerTag);
    step++;
    const inside = await page.evaluate(`
      const dialog = document.querySelector('[role="dialog"]');
      return String(!!dialog && dialog.contains(document.activeElement));
    `);
    check(inside === 'true', `${step}. and focus moves INTO it`, inside === 'true' ? 'focus is inside the dialog' : 'focus stayed on the page behind');
    step++;
    await page.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    `);
    await settle(600);
    const restored = await page.evaluate(`
      const active = document.activeElement;
      return String(!!active && active.tagName === 'BUTTON' && /audit|السجل/i.test(active.innerText));
    `);
    check(restored === 'true', `${step}. and Escape closes it and RESTORES focus to the opener`,
      restored === 'true' ? 'focus returned to the opener' : 'focus was dropped');
    step++;
  }

  // ── Status is not colour alone ────────────────────────────────────────
  await page.goto(`${BASE}/admin/users`);
  await waitFor(page, `document.body.innerText.trim().length > 200`);
  const colourOnly = JSON.parse(await page.evaluate(`
    // A badge whose meaning is carried only by its background: no text at all.
    const bare = [...document.querySelectorAll('[class*="badge"], .rounded-full')]
      .filter(el => el.offsetParent !== null)
      .filter(el => !(el.innerText || '').trim())
      .filter(el => {
        const bg = getComputedStyle(el).backgroundColor;
        return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      })
      .map(el => (el.className || '').toString().slice(0, 50));
    return JSON.stringify(bare);
  `));
  check(colourOnly.length === 0, `${step}. STATUS: no badge carries its meaning in colour alone`,
    colourOnly.length ? `${colourOnly.length}: ${colourOnly.join(' | ').slice(0, 90)}` : 'every status badge has text');
  step++;

} catch (error) {
  check(false, 'PROBE ABORTED', String(error.message).slice(0, 200));
} finally {
  try { browser.close(); } catch { /* the result is already printed */ }
}

if (findings.length) {
  console.log('\nFINDINGS');
  for (const f of findings) console.log(`  ${f}`);
}
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
