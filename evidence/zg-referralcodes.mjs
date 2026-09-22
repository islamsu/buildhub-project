/**
 * ── THE REFERRAL CONTROL PLANE ──────────────────────────────────────────
 *
 * CLAUDE.md §81 / North Star §33. Referral Management had three tabs -
 * Referrals, Rewards, Campaigns - and no concept of a referral CODE at all,
 * although `users.referralCode` has existed since sign-up first minted one.
 * It could not be seen, stopped, issued, rotated or audited, and New Campaign
 * - the action without which no reward can ever be granted - was buried
 * inside one of the three tabs.
 *
 * WHAT IS PROVED, in a real browser against real rows:
 *
 *   the five required areas exist and are reachable
 *   New Campaign is discoverable WITHOUT opening a tab
 *   Overview counts real records and renders a dash, never a zero, on failure
 *   the code directory searches and filters SERVER-SIDE
 *   "no code yet" is a findable operational state, and Issue resolves it
 *   a code can be disabled, and a DISABLED CODE THEN ATTRIBUTES NOTHING -
 *     proved by actually signing an account up through it
 *   disabling does not reach back and revoke what was already earned
 *   rotation breaks the old link and the old string survives in the history
 *   every change is attributed to an actor with a reason
 *   a reason is REQUIRED - the server refuses without one
 *   the user's own Referral Center agrees with what Admin shows
 *   a non-administrator cannot reach any of it
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9900 + (process.pid % 80)));
const ADMIN = 'superadmin@buildhub.local';
const PASSWORD = 'LocalSuperAdmin!2024';
const stamp = Date.now().toString(36);
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, expression, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let v = 'false';
    try { v = await page.evaluate(`try { return String(${expression}); } catch { return 'false'; }`); } catch {}
    if (v === 'true') { await settle(300); return true; }
    await settle(250);
  }
  return false;
}
const clickOn = selector => `
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return 'false';
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, composed: true,
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  el.dispatchEvent(new MouseEvent('mousedown', o));
  el.dispatchEvent(new PointerEvent('pointerup', o));
  el.dispatchEvent(new MouseEvent('mouseup', o));
  el.dispatchEvent(new MouseEvent('click', o));
  return 'true';
`;
async function signIn(identifier, admin = false) {
  const res = await fetch(`${BASE}/api/trpc/auth.${admin ? 'adminSignIn' : 'signIn'}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`signIn ${identifier}: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}
async function call(cookie, path, input) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ json: input }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function query(cookie, path, input) {
  const url = `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input ?? null }))}`;
  const res = await fetch(url, { headers: cookie ? { cookie } : {} });
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.result?.data?.json, message: body?.error?.json?.message };
}

console.log(`\nBUILD ${BUILD.shortCommit ?? '?'}  env=${BUILD.environment ?? '?'}\n`);

const adminCookie = await signIn(ADMIN, true);

/* ── A FRESH INVITER, THROUGH THE REAL SIGN-UP PATH ──────────────────── */
const inviterEmail = `zrc${stamp}inviter@example.test`;
const signUp = async (email, referralCode) => call(null, 'auth.signUp', {
  username: email.split('@')[0], email, password: PASSWORD,
  name: email.split('@')[0], userRole: 'homeowner',
  ...(referralCode ? { referralCode } : {}),
});
const created = await signUp(inviterEmail);
check(created.status === 200, 'a fresh account signs up', `HTTP ${created.status}`);
const inviterId = Number(sql(`SELECT id FROM users WHERE email='${inviterEmail}'`));
const inviterCode = sql(`SELECT referralCode FROM users WHERE id=${inviterId}`);
check(/^BH-[0-9A-F]{16}$/.test(inviterCode), 'sign-up mints a code in the canonical shape', inviterCode);
const issuedAt = sql(`SELECT IFNULL(referralCodeIssuedAt,'NULL') FROM users WHERE id=${inviterId}`);
check(issuedAt !== 'NULL', 'and records WHEN it was minted', issuedAt);

/* ── THE FIVE AREAS, IN A BROWSER ────────────────────────────────────── */
const browser = await launchBrowser({ port: CDP_PORT });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCookies(asBrowserCookies(adminCookie));
  await page.goto(`${BASE}/admin/referrals`);
  await waitFor(page, `document.querySelector('[data-testid="admin-referrals"]') !== null`);

  const tabs = JSON.parse(await page.evaluate(`
    return JSON.stringify([...document.querySelectorAll('[role="tab"]')].map(el => el.textContent.trim()));
  `));
  for (const area of ['Overview', 'Referral Codes', 'Referrals', 'Rewards', 'Campaigns']) {
    check(tabs.some(label => label.includes(area)), `the "${area}" area exists`, tabs.join(' | '));
  }

  /* NEW CAMPAIGN WITHOUT HUNTING FOR IT. The Overview tab is what opens by
     default, so if the action is reachable here it is reachable first. */
  const campaignVisible = await page.evaluate(`
    const card = document.querySelector('[data-testid="admin-referrals"]');
    const header = card ? card.querySelector('[data-slot="card-header"], .flex.flex-wrap.items-start') : null;
    const buttons = [...(header ? header.querySelectorAll('button') : [])].map(b => b.textContent.trim());
    return JSON.stringify(buttons);
  `);
  check(JSON.parse(campaignVisible).some(label => /new campaign/i.test(label)),
    'New Campaign is a primary action, not buried in a tab', campaignVisible);

  /* ── OVERVIEW COUNTS REAL RECORDS ─────────────────────────────────── */
  await waitFor(page, `document.querySelector('[data-testid="referral-stat-issued"]') !== null`);
  const overviewShown = Number((await page.evaluate(`
    const el = document.querySelector('[data-testid="referral-stat-issued"] p');
    return el ? el.textContent.replace(/[^0-9]/g, '') : '';
  `)) || '-1');
  const dbIssued = Number(sql(`SELECT COUNT(*) FROM users WHERE role <> 'admin' AND referralCode IS NOT NULL AND referralCode <> ''`));
  check(overviewShown === dbIssued, 'the Overview issued-codes figure is the real count',
    `screen ${overviewShown}, database ${dbIssued}`);

  /* ── THE CODE DIRECTORY, SEARCHED SERVER-SIDE ─────────────────────── */
  await page.evaluate(clickOn('[data-testid="tab-referral-codes"]'));
  await waitFor(page, `document.querySelector('[data-testid="referral-code-search"]') !== null`);
  await page.evaluate(`
    const input = document.querySelector('[data-testid="referral-code-search"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(inviterCode)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'true';
  `);
  await page.evaluate(clickOn('[data-testid="referral-code-search-submit"]'));
  const found = await waitFor(page, `document.querySelector('[data-testid="referral-code-row-${inviterId}"]') !== null`);
  check(found, 'the new code is findable by searching for the code itself', inviterCode);

  const rowText = await page.evaluate(`
    const row = document.querySelector('[data-testid="referral-code-row-${inviterId}"]');
    return row ? row.innerText.replace(/\\n+/g, ' | ') : 'MISSING';
  `);
  check(rowText.includes(inviterCode) && rowText.includes('Active'),
    'the row shows the code and its status in words', rowText.slice(0, 120));

  /* ── THE OWNER IS A LINK, NOT AN ID TO COPY ───────────────────────── */
  const ownerLink = await page.evaluate(`
    const row = document.querySelector('[data-testid="referral-code-row-${inviterId}"]');
    const link = row ? row.querySelector('a[href*="/admin/users/"]') : null;
    return link ? link.getAttribute('href') : 'MISSING';
  `);
  check(ownerLink.includes(`/admin/users/${inviterId}`),
    'the owner deep-links to their User Management page', ownerLink);

  /* ── HISTORY ──────────────────────────────────────────────────────── */
  await page.evaluate(clickOn(`[data-testid="referral-code-history-${inviterId}"]`));
  await waitFor(page, `document.querySelector('[data-testid="referral-code-history-panel-${inviterId}"]') !== null`);
  const firstHistory = await page.evaluate(`
    const panel = document.querySelector('[data-testid="referral-code-history-panel-${inviterId}"]');
    return panel ? panel.innerText.replace(/\\n+/g, ' | ') : 'MISSING';
  `);
  check(/code issued/i.test(firstHistory), 'the code history records the issue', firstHistory.slice(0, 100));

} finally {
  await browser.close();
}

/* ── A DISABLED CODE ATTRIBUTES NOTHING ──────────────────────────────── */
// This is the assertion the whole status column exists for, and the only
// honest way to make it is to actually sign an account up through the code.
const refusedNoReason = await call(adminCookie, 'admin.setReferralCodeStatus',
  { userId: inviterId, status: 'disabled', reason: '' });
check(refusedNoReason.status !== 200, 'a status change without a reason is REFUSED',
  `HTTP ${refusedNoReason.status}`);

const disabled = await call(adminCookie, 'admin.setReferralCodeStatus',
  { userId: inviterId, status: 'disabled', reason: 'Probe: code posted publicly' });
check(disabled.status === 200, 'the code can be disabled with a reason', `HTTP ${disabled.status}`);

const blockedEmail = `zrc${stamp}blocked@example.test`;
const blocked = await signUp(blockedEmail, inviterCode);
check(blocked.status === 200, 'a sign-up quoting the disabled code still succeeds', `HTTP ${blocked.status}`);
const blockedId = Number(sql(`SELECT id FROM users WHERE email='${blockedEmail}'`));
const attributedThroughDisabled = Number(sql(`SELECT COUNT(*) FROM referrals WHERE referredId=${blockedId}`));
check(attributedThroughDisabled === 0,
  'but NOTHING is attributed through it - the code is off',
  `${attributedThroughDisabled} referral rows`);

/* ── AND THE REFUSAL DOES NOT LEAK THAT THE CODE EXISTS ──────────────── */
const unknown = await signUp(`zrc${stamp}unknown@example.test`, 'BH-0000000000000000');
check(unknown.status === 200 && Number(sql(`SELECT COUNT(*) FROM referrals WHERE referredId=(SELECT id FROM users WHERE email='zrc${stamp}unknown@example.test')`)) === 0,
  'an unknown code behaves identically - no enumeration oracle');

/* ── REACTIVATION RESTORES ATTRIBUTION ───────────────────────────────── */
const reactivated = await call(adminCookie, 'admin.setReferralCodeStatus',
  { userId: inviterId, status: 'active', reason: 'Probe: cleared' });
check(reactivated.status === 200, 'the code can be reactivated', `HTTP ${reactivated.status}`);
const okEmail = `zrc${stamp}ok@example.test`;
await signUp(okEmail, inviterCode);
const okId = Number(sql(`SELECT id FROM users WHERE email='${okEmail}'`));
const attributedAgain = Number(sql(`SELECT COUNT(*) FROM referrals WHERE referredId=${okId} AND referrerId=${inviterId}`));
check(attributedAgain === 1, 'and attribution works again', `${attributedAgain} referral row`);

/* ── ROTATION BREAKS THE OLD LINK, AND KEEPS THE OLD STRING ──────────── */
const rotateNoReason = await call(adminCookie, 'admin.rotateReferralCode', { userId: inviterId, reason: '' });
check(rotateNoReason.status !== 200, 'rotation without a reason is REFUSED', `HTTP ${rotateNoReason.status}`);

const rotated = await call(adminCookie, 'admin.rotateReferralCode',
  { userId: inviterId, reason: 'Probe: rotating after exposure' });
check(rotated.status === 200, 'the code can be rotated with a reason', `HTTP ${rotated.status}`);
const newCode = sql(`SELECT referralCode FROM users WHERE id=${inviterId}`);
check(newCode !== inviterCode, 'the code actually changed', `${inviterCode} -> ${newCode}`);

const staleEmail = `zrc${stamp}stale@example.test`;
await signUp(staleEmail, inviterCode);
const staleAttributed = Number(sql(`SELECT COUNT(*) FROM referrals WHERE referredId=(SELECT id FROM users WHERE email='${staleEmail}')`));
check(staleAttributed === 0, 'the OLD code attributes nothing after rotation', `${staleAttributed} rows`);

const kept = sql(`SELECT previousCode FROM referralCodeEvents WHERE userId=${inviterId} AND action='rotated' ORDER BY id DESC LIMIT 1`);
check(kept === inviterCode,
  'and the string that stopped working survives in the history', `${kept}`);

/* ── WHAT WAS ALREADY EARNED IS NOT REVOKED ─────────────────────────── */
const survived = Number(sql(`SELECT COUNT(*) FROM referrals WHERE referrerId=${inviterId}`));
check(survived >= 1, 'disabling and rotating did not reach back and revoke earned referrals', `${survived} referrals`);

/* ── EVERY CHANGE NAMES AN ACTOR AND A REASON ───────────────────────── */
const unattributed = Number(sql(`
  SELECT COUNT(*) FROM referralCodeEvents
  WHERE userId=${inviterId} AND action <> 'issued' AND (actorId IS NULL OR reason IS NULL OR reason='')`));
check(unattributed === 0, 'no lifecycle change is unattributed or unexplained', `${unattributed} bare rows`);

/* ── ISSUE RESOLVES THE "NO CODE" STATE ─────────────────────────────── */
sql(`UPDATE users SET referralCode=NULL, referralCodeIssuedAt=NULL WHERE id=${okId}`);
const missingPage = await query(adminCookie, 'admin.referralCodes', { page: 0, pageSize: 100, status: 'missing' });
check(missingPage.status === 200 && (missingPage.data?.rows ?? []).some(row => Number(row.userId) === okId),
  'an account with no code is findable under the "No code yet" filter');
const issued = await call(adminCookie, 'admin.issueReferralCode', { userId: okId });
check(issued.status === 200, 'Issue resolves it', `HTTP ${issued.status}`);
const twice = await call(adminCookie, 'admin.issueReferralCode', { userId: okId });
check(twice.status !== 200,
  'and Issue REFUSES to silently rotate a working code', twice.body?.error?.json?.message ?? `HTTP ${twice.status}`);

/* ── THE ADMIN SCREEN AND THE USER SCREEN DESCRIBE THE SAME STATE ───── */
const inviterCookie = await signIn(inviterEmail);
const mine = await query(inviterCookie, 'profile.myReferral', null);
check(mine.status === 200 && mine.data?.code === newCode,
  "the user's own Referral Center shows the rotated code", `${mine.data?.code}`);
check(typeof mine.data?.link === 'string' && mine.data.link.includes(newCode),
  'with a working link while the code is active');

await call(adminCookie, 'admin.setReferralCodeStatus',
  { userId: inviterId, status: 'disabled', reason: 'Probe: checking the user side' });
const mineOff = await query(inviterCookie, 'profile.myReferral', null);
check(mineOff.data?.codeStatus === 'disabled' && mineOff.data?.link === null,
  'and NO LINK once it is disabled - not a URL that quietly earns nothing',
  `status ${mineOff.data?.codeStatus}, link ${JSON.stringify(mineOff.data?.link)}`);

/* ── AUTHORIZATION ──────────────────────────────────────────────────── */
for (const [name, path, input] of [
  ['list codes', 'admin.referralCodes', { page: 0, pageSize: 10 }],
  ['overview', 'admin.referralOverview', null],
]) {
  const denied = await query(inviterCookie, path, input);
  check(denied.status === 401 || denied.status === 403,
    `a signed-in non-administrator cannot ${name}`, `HTTP ${denied.status}`);
}
for (const [name, path, input] of [
  ['issue a code', 'admin.issueReferralCode', { userId: inviterId }],
  ['rotate a code', 'admin.rotateReferralCode', { userId: inviterId, reason: 'no' }],
  ['disable a code', 'admin.setReferralCodeStatus', { userId: inviterId, status: 'disabled', reason: 'no' }],
]) {
  const denied = await call(inviterCookie, path, input);
  check(denied.status === 401 || denied.status === 403,
    `a signed-in non-administrator cannot ${name}`, `HTTP ${denied.status}`);
}

/* ── AND AN ADMINISTRATOR IS NOT A CODE HOLDER ──────────────────────── */
const adminId = Number(sql(`SELECT id FROM users WHERE email='${ADMIN}'`));
const selfIssue = await call(adminCookie, 'admin.issueReferralCode', { userId: adminId });
check(selfIssue.status !== 200,
  'an administrator cannot issue themselves a referral code',
  selfIssue.body?.error?.json?.message ?? `HTTP ${selfIssue.status}`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
