/**
 * ── THE PRODUCT AT THREE WIDTHS ──────────────────────────────────────────
 *
 * Not a screenshot review. Three things are measured, on real pages, because
 * all three are objective and all three are how a responsive layout actually
 * fails for somebody:
 *
 *   HORIZONTAL OVERFLOW  the page is wider than the phone. Everything drifts
 *                        sideways, the sticky header slides off, and a column
 *                        of content sits under the thumb's reach.
 *   CLIPPED DIALOGS      a modal wider than the viewport puts its own buttons
 *                        off-screen, so the thing it is asking cannot be
 *                        answered.
 *   TOUCH TARGETS        a control under 24 CSS px square is a coin toss on a
 *                        phone (WCAG 2.5.8 sets 24x24 as the minimum), with
 *                        that rule's own inline exception applied - a link in
 *                        a sentence is spanned by its line-height and cannot
 *                        be grown without pushing the text apart.
 *
 * A table wider than the screen is NOT counted as overflow when it scrolls in
 * its own container - that is the intended pattern, and calling it a defect
 * would push the product toward shrinking a desktop table until it is
 * unreadable.
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
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9600 + (process.pid % 90)));
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

const PASSWORD = 'LocalSuperAdmin!2024';
const HASH = process.env.ZG_HASH;
if (!HASH) { console.error('set ZG_HASH to an application-minted password hash'); process.exit(2); }
const stamp = Date.now() % 100000000;

const WIDTHS = [375, 768, 1440];

/** What sticks out past the viewport, and what is doing it. */
const overflow = page => page.evaluate(`
  const vw = document.documentElement.clientWidth;
  const doc = Math.ceil(document.documentElement.scrollWidth);
  const culprits = [];
  if (doc > vw + 1) {
    for (const el of document.querySelectorAll('body *')) {
      if (el.offsetParent === null) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= vw + 1) continue;
      // A container that scrolls its own content is the INTENDED pattern for a
      // wide table; only an element whose own overflow is visible is a defect.
      let scrollsItself = false;
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') { scrollsItself = true; break; }
      }
      if (scrollsItself) continue;
      culprits.push({
        tag: el.tagName.toLowerCase(),
        testid: el.getAttribute('data-testid') || '',
        cls: (el.className || '').toString().slice(0, 44),
        right: Math.round(rect.right),
      });
    }
  }
  return JSON.stringify({ vw, doc, culprits: culprits.slice(0, 5) });
`);

/**
 * Controls whose EFFECTIVE tap area is smaller than the minimum.
 *
 * Measured by hit-testing rather than by reading the element's own box, for
 * two reasons found the hard way:
 *
 *   A pseudo-element does not grow its host's rect. The checkbox and switch
 *   primitives keep their visual size and carry an invisible ::after that a
 *   thumb can land on - getBoundingClientRect cannot see that, so measuring
 *   the box reported a control as tiny when it was not.
 *
 *   WCAG 2.5.8's INLINE EXCEPTION belongs in the rule. A target spanned by the
 *   line-height of surrounding text - a link in a sentence, a name in a table
 *   cell - cannot be grown without pushing the text apart, and the guideline
 *   says so. Anything laid out as a block, inline-block or inline-flex is
 *   still measured.
 */
const smallTargets = page => page.evaluate(`
  const small = [];
  /*
   * THE CENSUS COUNTS ITS OWN WORK, because a pass that examined nothing
   * looks exactly like a pass that examined everything and found nothing.
   * Shrinking every icon button to 16x16 left this check green, and the
   * detail line said "all targets comfortable" either way - it took a
   * separate diagnostic to learn that the exceptions had cleared them. The
   * counters are now part of the result, so the reason for a pass is on the
   * page beside it.
   */
  const counts = { controls: 0, undersized: 0, inline: 0, covered: 0, uncrowded: 0 };
  for (const el of document.querySelectorAll('button, a[href], [role="button"], input[type=checkbox], input[type=radio]')) {
    if (el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    counts.controls++;
    if (r.width >= 24 && r.height >= 24) continue;
    counts.undersized++;
    if (getComputedStyle(el).display === 'inline') { counts.inline++; continue; }

    /*
     * SCROLLED INTO VIEW FIRST, INSTANTLY. elementFromPoint answers about the
     * VIEWPORT, so a control below the fold returns null for every probe point
     * - which the first version of this read as "not covered" and reported as
     * a tiny target. At 375px most of a page is below the fold, so nearly
     * every finding was that.
     *
      * An INSTANT behaviour is the second half, and it cost a second round:
      * index.css sets a smooth scroll-behavior on the page, so the default
     * scrollIntoView had not arrived by the time the next line measured, and
     * the control was still judged at its old coordinates. Two controls came
     * back unreachable at their own centre because of it. An animated scroll
     * is right for a person and wrong for a measurement.
     */
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const r2 = el.getBoundingClientRect();
    const cx = r2.left + r2.width / 2;
    const cy = r2.top + r2.height / 2;
    /*
     * WHAT ACTUALLY ACTIVATES THE CONTROL.
     *
     * The first predicate accepted any ANCESTOR - hit.contains(el) - so a
     * wrapping <div> counted as a hit, and tapping a div does nothing. Every
     * control passed, including ones with no enlarged area at all, which is
     * how a mutation that removed the enlargement stayed green.
     *
     * A point counts when it lands on the control itself (its ::after belongs
     * to it), on a descendant, or on a <label> that wraps it - which does
     * forward the activation.
     */
    const reaches = (dx, dy) => {
      const hit = document.elementFromPoint(cx + dx, cy + dy);
      if (!hit) return false;
      if (hit === el || el.contains(hit)) return true;
      const label = hit.closest('label');
      return !!label && label.contains(el);
    };
    const covered = reaches(0, -11) && reaches(0, 11) && reaches(-11, 0) && reaches(11, 0);
    if (covered) { counts.covered++; continue; }

    /*
     * THE SPACING EXCEPTION, which is the other half of WCAG 2.5.8: an
     * undersized target passes when a 24px circle centred on it does not
     * overlap the circle of any other target. A name in a table row and a
     * "Get Started" in a header are small because their TEXT is small, and
     * they are nowhere near anything else clickable - enlarging them would
     * change the type scale of the page to satisfy a number that the
     * guideline itself does not ask for here.
     */
    const others = [...document.querySelectorAll('button, a[href], [role="button"], input[type=checkbox], input[type=radio]')]
      .filter(other => other !== el && other.offsetParent !== null);
    const crowded = others.some(other => {
      const o = other.getBoundingClientRect();
      if (o.width === 0 || o.height === 0) return false;
      const ox = o.left + o.width / 2;
      const oy = o.top + o.height / 2;
      return Math.hypot(ox - cx, oy - cy) < 24;
    });
    if (!crowded) { counts.uncrowded++; continue; }

    small.push({
      tag: el.tagName.toLowerCase(),
      testid: el.getAttribute('data-testid') || (el.innerText || '').trim().slice(0, 18),
      size: Math.round(r.width) + 'x' + Math.round(r.height),
      display: getComputedStyle(el).display,
    });
  }
  return JSON.stringify({ counts, small: small.slice(0, 6) });
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
let guestBrowser = null;
const findings = [];

try {
  sql(`delete from users where username like 'zresp%'`);
  const u = `zresp${stamp}`;
  sql(`insert into users (openId, username, email, name, role, adminRole, userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${u}', '${u}', '${u}@example.test', 'Probe Super', 'admin',
        'SUPER_ADMIN', 'admin', 'password', 'admin_created', 0, 'active', 'approved', 1,
        '${HASH}', now())`);
  check(Number(sql(`select id from users where username='${u}'`)) > 0,
    '1. SETUP: a real administrator exists');

  const cookie = await signIn(`${u}@example.test`);
  const page = await browser.newPage();
  await page.setCookies(asBrowserCookies(cookie));
  await page.goto(`${BASE}/admin`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");

  const SURFACES = [
    ['/', 'Home'],
    ['/marketplace', 'Marketplace hub'],
    ['/marketplace/products', 'Products'],
    ['/marketplace/vendors', 'Vendor directory'],
    ['/pricing', 'Pricing'],
    ['/auth', 'Sign in'],
    ['/admin', 'Admin control panel'],
    ['/admin/users', 'User management'],
    ['/admin/registrations', 'Professional registrations'],
    ['/admin/categories', 'Categories'],
    ['/admin/placements', 'Placements'],
    ['/admin/referrals', 'Referrals'],
    ['/admin/enquiries', 'Vendor enquiries'],
    ['/admin/disputes', 'Disputes'],
    ['/admin/support', 'Support'],
    ['/admin/reviews', 'Reviews'],
    ['/admin/analytics', 'Analytics'],
    ['/admin/operations', 'Operations'],
    ['/admin/billing', 'Billing & benefits'],
    ['/admin/admins', 'Administrators'],
    ['/admin/settings', 'Settings'],
  ];

  /*
   * WHAT A VISITOR SEES, measured as a visitor.
   *
   * Every surface above is loaded through an administrator's session, and for
   * the public pages that is the wrong reading. The tell was /auth: listed as
   * "Sign in", it redirected to the admin dashboard and was measured twice
   * under a different name, so the sign-in form - the narrowest, most
   * phone-bound screen in the product - was never measured at all. The
   * marketing pages render a different header signed out, too.
   *
   * A SECOND BROWSER, because a CDP cookie belongs to the BROWSER and not to
   * the tab - clearing them in a new tab would sign the administrator out as
   * well, and this probe needs both sessions alive at once. The helper gives
   * each launch its own profile directory, so the guest starts with nothing.
   */
  let step = 2;
  const PUBLIC = [
    ['/', 'Home (signed out)'],
    ['/marketplace', 'Marketplace hub (signed out)'],
    ['/marketplace/products', 'Products (signed out)'],
    ['/marketplace/vendors', 'Vendor directory (signed out)'],
    ['/pricing', 'Pricing (signed out)'],
    ['/auth', 'Create account (signed out)'],
    ['/auth?mode=login', 'Sign in (signed out)'],
  ];
  guestBrowser = await launchBrowser({ port: CDP_PORT + 1 });
  const guest = await guestBrowser.newPage();
  await guest.setViewport({ width: 375, height: 812 });
  await guest.goto(`${BASE}/auth?mode=login`);
  await waitFor(guest, `document.body.innerText.trim().length > 60`);
  /*
   * PROVED SIGNED OUT, not assumed. The whole point of the guest pass is that
   * /auth was previously measured as the admin dashboard - if that happened
   * again the surface count would still read 28 and every check would still
   * be green, while the sign-in form went unmeasured a second time. So the
   * guest has to show a password field and no admin console.
   *
   * THE SIGN-IN FORM IS AT /auth?mode=login, which is the second thing this
   * found: bare /auth is the CREATE ACCOUNT role chooser and has no inputs on
   * its first step at all. Asserting a password field there failed, and the
   * failure was the assertion's, not the product's - but it meant the list
   * above had been measuring account creation under the name "Sign in", and
   * the actual sign-in form was on no list anywhere. Both are surfaces now.
   */
  const guestView = JSON.parse(await guest.evaluate(`
    return JSON.stringify({
      password: !!document.querySelector('input[type="password"]'),
      admin: /admin/i.test(location.pathname) || !!document.querySelector('[data-testid^="admin-"]'),
    });
  `));
  check(guestView.password && !guestView.admin,
    `${step}. SIGNED OUT, the sign-in form renders and the console does not`,
    `password field: ${guestView.password}, admin content: ${guestView.admin}`);
  step++;

  for (const width of WIDTHS) {
    await page.setViewport({ width, height: width < 768 ? 812 : 900 });
    const overflows = [];
    const tiny = [];
    const totals = { controls: 0, undersized: 0, inline: 0, covered: 0, uncrowded: 0 };
    for (const [path, label] of SURFACES) {
      await page.goto(`${BASE}${path}`);
      await waitFor(page, `document.body.innerText.trim().length > 60`);
      await settle(350);
      const o = JSON.parse(await overflow(page));
      if (o.culprits.length) {
        overflows.push(`${label} (${o.doc}>${o.vw}): ${o.culprits.map(c => c.testid || `${c.tag}.${c.cls}`).join(' | ').slice(0, 80)}`);
      }
      if (width === 375) {
        const { counts, small } = JSON.parse(await smallTargets(page));
        for (const k of Object.keys(totals)) totals[k] += counts[k];
        if (small.length) tiny.push(`${label}: ${small.map(t => `${t.testid}(${t.size})`).join(', ').slice(0, 90)}`);
      }
    }
    for (const [path, label] of PUBLIC) {
      await guest.setViewport({ width, height: width < 768 ? 812 : 900 });
      await guest.goto(`${BASE}${path}`);
      await waitFor(guest, `document.body.innerText.trim().length > 60`);
      await settle(350);
      const o = JSON.parse(await overflow(guest));
      if (o.culprits.length) {
        overflows.push(`${label} (${o.doc}>${o.vw}): ${o.culprits.map(c => c.testid || `${c.tag}.${c.cls}`).join(' | ').slice(0, 80)}`);
      }
      if (width === 375) {
        const { counts, small } = JSON.parse(await smallTargets(guest));
        for (const k of Object.keys(totals)) totals[k] += counts[k];
        if (small.length) tiny.push(`${label}: ${small.map(t => `${t.testid}(${t.size})`).join(', ').slice(0, 90)}`);
      }
    }
    const surfaceCount = SURFACES.length + PUBLIC.length;
    check(overflows.length === 0, `${step}. ${width}px: no page is wider than the screen`,
      overflows.length ? `${overflows.length} of ${surfaceCount}: ${overflows[0]}` : `${surfaceCount} surfaces clean, ${PUBLIC.length} of them signed out`);
    if (overflows.length) findings.push(...overflows.map(o => `${width}px overflow - ${o}`));
    step++;

    if (width === 375) {
      /*
       * The detail line carries the arithmetic, not a verdict word. A run
       * that says 0 undersized has checked nothing about the exceptions; a
       * run that says 40 undersized, 40 cleared by coverage has. Both pass,
       * and only one of them means anything.
       */
      const ledger = `${totals.controls} controls, ${totals.undersized} under 24px `
        + `(${totals.inline} inline, ${totals.covered} covered by their own hit area, `
        + `${totals.uncrowded} uncrowded)`;
      check(tiny.length === 0, `${step}. 375px: every control is at least 24x24`,
        tiny.length ? `${tiny.length} surface(s): ${tiny[0]}` : ledger);
      if (tiny.length) findings.push(...tiny.map(t => `375px small target - ${t}`));
      step++;
    }
  }

  /*
   * THE PRIMITIVES, MEASURED WITHOUT THE EXCEPTIONS AND WITHOUT THEIR LABELS.
   *
   * The check above tests CONFORMANCE, and it passes with or without the
   * enlarged hit areas on Checkbox and Switch - because WCAG's spacing
   * exception genuinely clears an uncrowded 16x16 control, and these are not
   * crowded. That was proved by removing the enlargement and watching the
   * check stay green.
   *
   * So the enlargement is an improvement BEYOND the minimum, and it needs its
   * own measurement or it is only an assertion about intent. These two hit-
   * test the primitives directly and apply no exception at all.
   *
   * A WRAPPING <label> IS NOT ACCEPTED HERE, deliberately, and that is the
   * difference between this and the census above. Where a label exists it is
   * a real tap area - a <button> is labelable, so the click forwards - and
   * the census is right to count it. But it is the CALLER's doing, not the
   * primitive's: six of the nine switches in the product sit in no label at
   * all, and a table's select-all checkbox has only itself. So the component
   * has to carry its own target. Removing the enlargement and re-running is
   * what proves this: with the label accepted, the registrations checkbox
   * stayed green on its label alone and the mutation went undetected.
   */
  await page.setViewport({ width: 375, height: 812 });
  await page.goto(`${BASE}/admin/settings`);
  await waitFor(page, `!!document.querySelector('[data-slot="switch"]')`);
  const switchArea = JSON.parse(await page.evaluate(`
    const sw = document.querySelector('[data-slot="switch"]');
    sw.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = sw.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const at = (dx, dy) => {
      const hit = document.elementFromPoint(cx + dx, cy + dy);
      return !!hit && (hit === sw || sw.contains(hit));
    };
    return JSON.stringify({ box: Math.round(r.width) + 'x' + Math.round(r.height), above: at(0, -11), below: at(0, 11) });
  `));
  check(switchArea.above && switchArea.below,
    `${step}. THE SWITCH has a 24px tap area, though it draws at 18px`,
    `${switchArea.box} box, tap 11px above: ${switchArea.above}, below: ${switchArea.below}`);
  step++;

  await page.goto(`${BASE}/admin/registrations`);
  await waitFor(page, `!!document.querySelector('[data-slot="checkbox"]')`);
  const boxArea = JSON.parse(await page.evaluate(`
    const cb = document.querySelector('[data-slot="checkbox"]');
    cb.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = cb.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const at = (dx, dy) => {
      const hit = document.elementFromPoint(cx + dx, cy + dy);
      return !!hit && (hit === cb || cb.contains(hit));
    };
    return JSON.stringify({ box: Math.round(r.width) + 'x' + Math.round(r.height), above: at(0, -11), left: at(-11, 0) });
  `));
  check(boxArea.above && boxArea.left,
    `${step}. THE CHECKBOX has a 24px tap area, though it draws at 16px`,
    `${boxArea.box} box, tap 11px above: ${boxArea.above}, left: ${boxArea.left}`);
  step++;

  // ── A dialog at phone width must fit on the phone ─────────────────────
  await page.setViewport({ width: 375, height: 812 });
  await page.goto(`${BASE}/admin/users`);
  await waitFor(page, `!!document.querySelector('[data-testid^="admin-user-audit-"]')`);
  await page.evaluate(`[...document.querySelectorAll('[data-testid^="admin-user-audit-"]')][0].click(); return true;`);
  const opened = await waitFor(page, `!!document.querySelector('[role="dialog"]')`);
  check(opened, `${step}. DIALOG at 375px: opens`);
  step++;
  const fit = JSON.parse(await page.evaluate(`
    const d = document.querySelector('[role="dialog"]');
    const r = d.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    return JSON.stringify({
      width: Math.round(r.width), vw,
      overflowsX: r.right > vw + 1 || r.left < -1,
      tallerThanScreen: r.height > vh,
      scrolls: getComputedStyle(d).overflowY === 'auto' || getComputedStyle(d).overflowY === 'scroll',
    });
  `));
  check(!fit.overflowsX, `${step}. and fits the width`, `${fit.width}px in ${fit.vw}px`);
  step++;
  check(!fit.tallerThanScreen || fit.scrolls, `${step}. and is scrollable if taller than the screen`,
    fit.tallerThanScreen ? (fit.scrolls ? 'taller, and scrolls' : 'TALLER AND CLIPPED') : 'fits vertically');
  step++;

} catch (error) {
  check(false, 'PROBE ABORTED', String(error.message).slice(0, 200));
} finally {
  await guestBrowser?.close();
  try { browser.close(); } catch { /* the result is already printed */ }
}

if (findings.length) {
  console.log('\nFINDINGS');
  for (const f of findings) console.log(`  ${f}`);
}
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
