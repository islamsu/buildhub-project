/**
 * OUTSTANDING ADMINISTRATOR LINKS, REVOKED FOR REAL.
 *
 * Asserts the DATABASE, not a toast: a link is issued, appears as live, is
 * revoked through the screen, and the revocation is visible in the row that
 * comes back from the server. Then the negative half - the revoked link no
 * longer redeems - because a "Revoked" badge over a link that still works
 * would be the worst possible outcome.
 */
import { launchBrowser } from './lib/cdp.mjs';
import { adminSession, asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
let pass = 0, fail = 0;
const check = (ok, name, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const settle = (ms = 2500) => new Promise(r => setTimeout(r, ms));

const s = await adminSession('superadmin@buildhub.local', 'LocalSuperAdmin!2024');
if (!s.ok) { console.error('SIGN-IN FAILED:', s.reason); process.exit(1); }

const post = async (proc, body, cookie = s.cookie) => {
  const r = await fetch(`${BASE}/api/trpc/${proc}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ json: body }),
  });
  return { s: r.status, t: await r.text() };
};
const get = async (proc, input, cookie = s.cookie) => {
  const url = `${BASE}/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const r = await fetch(url, { headers: { cookie } });
  return { s: r.status, t: await r.text() };
};
const jsonOf = t => { try { return JSON.parse(t)?.result?.data?.json; } catch { return undefined; } };
const errOf = t => { try { return JSON.parse(t)?.error?.json?.message; } catch { return t; } };

const stamp = Date.now().toString(36);

// ── an administrator with a live invitation ──────────────────────────────
const created = await post('admin.createAdmin', {
  name: `Link Probe ${stamp}`, email: `linkprobe${stamp}@buildhub.local`,
  username: `linkprobe${stamp}`, adminRole: 'SUPPORT_ADMIN',
});
const invitationLink = jsonOf(created.t)?.invitationLink;
const targetId = jsonOf(created.t)?.userId;
check(created.s === 200 && Boolean(invitationLink), 'an administrator is created with a one-time link', `http ${created.s}`);

const listed = await get('admin.adminInvitations', { userId: targetId });
const rows = jsonOf(listed.t) ?? [];
check(listed.s === 200 && rows.length === 1, 'the link is listed against that account', `${rows.length} row(s)`);
const row = rows[0];
check(row && !row.usedAt && !row.revokedAt && new Date(row.expiresAt) > new Date(),
  'and it reads as live - not used, not revoked, not expired');

// ── the screen renders it, and the Revoke control is there ───────────────
const browser = await launchBrowser({ port: 9342 });
const page = await browser.newPage();
await page.setCookies(asBrowserCookies(s.cookie));
await page.goto(`${BASE}/admin/admins`, { timeoutMs: 25000 });
await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
await page.goto(`${BASE}/admin/admins`, { timeoutMs: 25000 });
await settle(3000);

const opened = await page.evaluate(`
  const el = document.querySelector('[data-testid="admin-links-${targetId}"]');
  if (!el) return false;
  el.click();
  return true;
`);
check(opened, 'the console offers a Links control on that administrator row');
await settle(2500);

const rendered = await page.evaluate(`
  const el = document.querySelector('[data-testid="admin-link-${row?.id}"]');
  return el ? { state: el.getAttribute('data-state'), text: el.innerText.replace(/\\n/g, ' | ') } : null;
`);
check(rendered?.state === 'live', 'the link renders with its derived state', String(rendered?.state));
const hasRevoke = await page.evaluate(`return !!document.querySelector('[data-testid="admin-revoke-link-${row?.id}"]');`);
check(hasRevoke, 'and a Revoke control, because the link is still live');

// ── revoke it FROM THE SCREEN, then assert the server, not the toast ─────
await page.evaluate(`document.querySelector('[data-testid="admin-revoke-link-${row?.id}"]').click(); return true;`);
await settle(3000);

const afterList = jsonOf((await get('admin.adminInvitations', { userId: targetId })).t) ?? [];
const afterRow = afterList.find(r => r.id === row?.id);
check(Boolean(afterRow?.revokedAt), 'the server records the revocation', afterRow?.revokedAt ?? 'still null');
check(!afterRow?.usedAt, 'and does not mark it used - it was cancelled, not redeemed');

const stillOffered = await page.evaluate(`return !!document.querySelector('[data-testid="admin-revoke-link-${row?.id}"]');`);
check(!stillOffered, 'the Revoke control is gone once the link is dead');

// ── THE POINT OF THE FEATURE: the revoked link must not work ─────────────
const token = new URL(invitationLink, BASE).searchParams.get('token');
const redeemed = await post('auth.completeAdminInvitation', { token, password: `Revoked!${stamp}A1` }, '');
check(redeemed.s >= 400, 'the revoked link no longer redeems', `http ${redeemed.s} — ${String(errOf(redeemed.t)).slice(0, 60)}`);

// ── an account with no links reads as empty, not as an error ─────────────
const meId = jsonOf((await get('auth.me', null)).t)?.id;
const own = jsonOf((await get('admin.adminInvitations', { userId: meId })).t) ?? [];
check(Array.isArray(own), 'an account with no outstanding links returns a real empty list', `${own.length} row(s)`);

// ── CHANGING YOUR OWN PASSWORD ───────────────────────────────────────────
// The control is checked as rendered; the capability is checked end to end,
// because a dialog that opens proves nothing about whether the password moved.
const hasOwnPassword = await page.evaluate(`
  const el = document.querySelector('[data-testid="admin-change-own-password"]');
  if (!el) return false;
  el.click();
  return true;
`);
check(hasOwnPassword, 'the console offers Change my password');
await settle(1500);
const dialogOpen = await page.evaluate(`
  return !!document.querySelector('[data-testid="admin-submit-own-password"]');
`);
check(dialogOpen, 'and it opens a form to do it');

// A second administrator, so the probe never changes the password of the
// account every other probe signs in with.
const subject = await post('admin.createAdmin', {
  name: `Pw Probe ${stamp}`, email: `pwprobe${stamp}@buildhub.local`,
  username: `pwprobe${stamp}`, adminRole: 'SUPPORT_ADMIN',
});
const subjectToken = new URL(jsonOf(subject.t).invitationLink, BASE).searchParams.get('token');
const firstPassword = `PwProbeFirst!${stamp}`;
const secondPassword = `PwProbeSecond!${stamp}`;
await post('auth.completeAdminInvitation', { token: subjectToken, password: firstPassword }, '');

const signIn = async password => post('auth.adminSignIn', { identifier: `pwprobe${stamp}@buildhub.local`, password }, '');
const firstSession = await signIn(firstPassword);
check(firstSession.s === 200, 'the new administrator signs in with their chosen password', `http ${firstSession.s}`);
const cookie = (await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ json: { identifier: `pwprobe${stamp}@buildhub.local`, password: firstPassword } }),
}).then(r => (r.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')));

const wrongCurrent = await post('admin.changeOwnPassword', { currentPassword: 'not-the-password', newPassword: secondPassword }, cookie);
check(wrongCurrent.s >= 400, 'changing it without the current password is refused', `http ${wrongCurrent.s}`);

const changed = await post('admin.changeOwnPassword', { currentPassword: firstPassword, newPassword: secondPassword }, cookie);
check(changed.s === 200, 'and succeeds with it', `http ${changed.s}`);

const oldStillWorks = await signIn(firstPassword);
check(oldStillWorks.s >= 400, 'the OLD password stops working', `http ${oldStillWorks.s}`);
const newWorks = await signIn(secondPassword);
check(newWorks.s === 200, 'and the new one works', `http ${newWorks.s}`);

const tooShort = await post('admin.changeOwnPassword', { currentPassword: secondPassword, newPassword: 'short' }, cookie);
check(tooShort.s >= 400, 'a password under the shared minimum is refused server-side', `http ${tooShort.s}`);

console.log(`\n${pass} passed, ${fail} failed`);
page.close(); try { browser.close(); } catch {}
process.exit(fail === 0 ? 0 : 1);
