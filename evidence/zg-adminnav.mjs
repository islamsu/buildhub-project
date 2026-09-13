/**
 * THE ADMIN MENU, AS RENDERED AND AS CLICKED.
 *
 * The unit test proves the DATA is right. This proves the SCREEN draws it and
 * the click goes somewhere: that a real Super Admin, in a real browser, is
 * offered "Administrators" in the sidebar and that clicking it lands on the
 * authority console. The defect being fixed was invisible to every test that
 * read source, because the route existed and the page worked - only the way in
 * was missing.
 *
 * THE SIDEBAR IS BUILT FROM BUTTONS, NOT LINKS. The first version of this probe
 * looked for `a[href="/admin/admins"]` and reported a working menu as broken.
 * wouter navigates programmatically here, so the honest check is to click the
 * control and watch the address bar - which is also what a user does.
 */
import { launchBrowser } from './lib/cdp.mjs';
import { adminSession, asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
let pass = 0, fail = 0;
const check = (ok, name, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const settle = (ms = 2500) => new Promise(r => setTimeout(r, ms));

const s = await adminSession('superadmin@buildhub.local', 'LocalSuperAdmin!2024');
if (!s.ok) { console.error('SIGN-IN FAILED:', s.reason); process.exit(1); }

const browser = await launchBrowser({ port: 9340 });
const page = await browser.newPage();
await page.setCookies(asBrowserCookies(s.cookie));

const sidebarLabels = () => page.evaluate(`
  const out = [];
  for (const el of document.querySelectorAll('[data-sidebar="menu-button"], nav button, aside button')) {
    const label = (el.innerText || '').trim();
    if (label) out.push(label);
  }
  return out.length ? out : [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).filter(Boolean);
`);

const clickLabel = label => page.evaluate(`
  for (const el of document.querySelectorAll('button, a')) {
    if ((el.innerText || '').trim() === ${JSON.stringify(label)}) { el.click(); return true; }
  }
  return false;
`);

// ── English ──────────────────────────────────────────────────────────────
// Navigate BEFORE touching localStorage: on about:blank Chromium refuses the
// accessor outright, and the first version of this probe died there rather
// than reporting anything about the product.
await page.goto(`${BASE}/admin`, { timeoutMs: 25000 });
await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
await page.goto(`${BASE}/admin`, { timeoutMs: 25000 });
await settle(3000);

const labels = await sidebarLabels();
check(labels.includes('Administrators'), 'the sidebar offers Administrators',
  `${labels.length} controls: ${labels.slice(0, 14).join(', ')}`);
// The entry must sit in the admin menu, not be some other control that happens
// to say the same word: the console's own page heading says "Administrators"
// too, which is why this is checked from /admin, not from /admin/admins.
check(labels.includes('Operations') && labels.includes('Settings'),
  'and it is read from the admin sidebar, alongside the other sections');

const clicked = await clickLabel('Administrators');
check(clicked, 'the entry is a real control that can be clicked');
await settle(3000);
const landed = await page.evaluate('return location.pathname;');
check(landed === '/admin/admins', 'clicking it navigates to the authority console', landed);

const text = await page.evaluate('return document.body.innerText;');
check(text.includes('Administrators'), 'the console renders the administrator surface');
check(!text.includes('Super Admin only'), 'a real Super Admin is not shown the Super-Admin-only refusal');
check(!/scrypt\$|passwordHash|tokenHash/.test(text), 'the console carries no credential material');

// ── Arabic ───────────────────────────────────────────────────────────────
// A destination that exists only in one language is half a destination.
await page.evaluate(`localStorage.setItem('buildhub_lang', 'ar'); return true;`);
await page.goto(`${BASE}/admin`, { timeoutMs: 25000 });
await settle(3000);
const arLabels = await sidebarLabels();
check(arLabels.includes('المشرفون'), 'the Arabic sidebar offers the same destination, in Arabic',
  arLabels.slice(0, 14).join(', '));
check(!arLabels.includes('admin.admins'), 'the label is translated, not the raw key falling through');

await clickLabel('المشرفون');
await settle(3000);
const arLanded = await page.evaluate('return location.pathname;');
check(arLanded === '/admin/admins', 'and the Arabic entry navigates to the same console', arLanded);
const dir = await page.evaluate('return document.documentElement.getAttribute("dir");');
check(dir === 'rtl', 'the console is laid out right-to-left in Arabic', String(dir));

// ── THE NEGATIVE CONTROL, WITH A REAL SUB-ADMIN ──────────────────────────
// A menu that shows everything to everybody would pass every check above. So
// a genuine MARKETPLACE_ADMIN is created through the real invitation flow,
// signed in, and must be offered NEITHER the authority console nor Disputes -
// two screens their permissions cannot open.
const stamp = Date.now().toString(36);
const api = async (proc, body, cookie) => {
  const r = await fetch(`${BASE}/api/trpc/${proc}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ json: body }),
  });
  return { s: r.status, t: await r.text(), c: (r.headers.getSetCookie?.() ?? []).map(x => x.split(';')[0]).join('; ') };
};
const jsonOf = t => { try { return JSON.parse(t)?.result?.data?.json; } catch { return undefined; } };

const created = await api('admin.createAdmin', {
  name: `Nav Probe ${stamp}`, email: `navprobe${stamp}@buildhub.local`,
  username: `navprobe${stamp}`, adminRole: 'MARKETPLACE_ADMIN',
}, s.cookie);
const invitationLink = jsonOf(created.t)?.invitationLink;
check(created.s === 200 && Boolean(invitationLink), 'a MARKETPLACE_ADMIN can be created for the negative control',
  `http ${created.s}`);

if (invitationLink) {
  const token = new URL(invitationLink, BASE).searchParams.get('token');
  const subPassword = `NavProbe!${stamp}A1`;
  const completed = await api('auth.completeAdminInvitation', { token, password: subPassword });
  check(completed.s === 200, 'and completes their invitation', `http ${completed.s}`);

  const signedIn = await api('auth.adminSignIn', { identifier: `navprobe${stamp}@buildhub.local`, password: subPassword });
  check(signedIn.s === 200 && Boolean(signedIn.c), 'and signs in as a real administrator', `http ${signedIn.s}`);

  if (signedIn.c) {
    const subPage = await browser.newPage();
    await subPage.setCookies(asBrowserCookies(signedIn.c));
    // localStorage is per-ORIGIN, so this page inherits whatever language the
    // Arabic pass left behind. Pin it before reading English labels - the first
    // version of this check read Arabic labels and reported a working menu as
    // broken.
    await subPage.goto(`${BASE}/admin`, { timeoutMs: 25000 });
    await subPage.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
    await subPage.goto(`${BASE}/admin`, { timeoutMs: 25000 });
    await settle(3000);
    const subLabels = await subPage.evaluate(`
      const out = [];
      for (const el of document.querySelectorAll('[data-sidebar="menu-button"], nav button, aside button')) {
        const label = (el.innerText || '').trim();
        if (label) out.push(label);
      }
      return out.length ? out : [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).filter(Boolean);
    `);
    // Positive half first: a menu that rendered NOTHING would satisfy the two
    // negatives below while being just as broken.
    check(subLabels.includes('Placements'),
      'the sub-admin is still offered the screens they CAN open', subLabels.slice(0, 12).join(', '));
    check(!subLabels.includes('Administrators'),
      'the sub-admin is NOT offered the Super Admin authority console');
    check(!subLabels.includes('Disputes'),
      'nor Disputes, which their permissions cannot open');

    // Frontend hiding is not authorization: the server must refuse too.
    const forbidden = await fetch(`${BASE}/api/trpc/admin.admins`, { headers: { cookie: signedIn.c } });
    const forbiddenBody = await forbidden.text();
    check(forbidden.status === 403 || forbidden.status === 401,
      'and the server refuses admin.admins to them regardless of the menu', `http ${forbidden.status}`);
    check(/FORBIDDEN|UNAUTHORIZED/.test(forbiddenBody),
      'with an authorization refusal, not a transport error', forbiddenBody.slice(0, 60));
    subPage.close();
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
page.close(); try { browser.close(); } catch {}
process.exit(fail === 0 ? 0 : 1);
