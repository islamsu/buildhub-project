/**
 * ── THE INVITER'S OWN REFERRAL AREA, RENDERED ───────────────────────────
 *
 * zg-referral3 proves the engine grants three real benefits. This proves the
 * person who earned one can SEE it, in their own language, without being
 * handed a database token to interpret.
 *
 * What the owner asked for, checked on the rendered page:
 *
 *   the code, the link, a Copy action
 *   an explanation of how it works
 *   WHO accepted, and where each one got to
 *   the reward AS A SENTENCE - never EXTRA_QUALIFIED_ENQUIRIES: 7
 *   a truthful empty state before anything has happened
 *   Arabic, right to left
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
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9600 + (process.pid % 70)));
const PASSWORD = 'LocalSuperAdmin!2024';
const HASH = process.env.ZG_HASH;
if (!HASH) { console.error('set ZG_HASH to an application-minted password hash'); process.exit(2); }
const stamp = Date.now().toString(36);
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let v = 'false';
    try { v = await page.evaluate(`try { return String(${expression}); } catch { return 'false'; }`); } catch {}
    if (v === 'true') { await settle(300); return true; }
    await settle(250);
  }
  return false;
}
async function signIn(email) {
  const res = await fetch(`${BASE}/api/trpc/auth.signIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`signIn: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zrui%') as p)`;
  for (const statement of [
    `delete from referralRewards where recipientUserId in ${ids}`,
    `delete from referrals where referrerId in ${ids} or referredId in ${ids}`,
    `delete from referralCampaigns where name like 'ZUI %${stamp}%'`,
    `delete from notifications where userId in ${ids}`,
    `delete from analyticsEvents where userId in ${ids}`,
    `delete from userAccountAuditEvents where actorId in ${ids} or userId in ${ids}`,
    `delete from users where username like 'zrui%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 80)})`);
    }
  }
}

const AREA = `
  const root = document.querySelector('[data-testid="referral-invite-earn"]');
  const text = root ? root.innerText : '';
  return JSON.stringify({
    present: !!root,
    link: !!document.querySelector('[data-testid="referral-link"]'),
    copy: !!document.querySelector('[data-testid="referral-copy"]'),
    how: !!document.querySelector('[data-testid="referral-how"]'),
    referred: !!document.querySelector('[data-testid="referral-referred"]'),
    rewards: !!document.querySelector('[data-testid="referral-rewards"]'),
    rawEnum: /EXTRA_QUALIFIED_ENQUIRIES|TEMPORARY_FEATURED|SUBSCRIPTION_EXTENSION/.test(text),
    text: text.replace(/\\s+/g, ' ').slice(0, 900),
    rootHtmlLen: root ? root.innerHTML.length : 0,
  });
`;

const browser = await launchBrowser({ port: CDP_PORT });
try {
  cleanUp();
  const inviter = `zruiA${stamp}`;
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt, referralCode)
       values ('probe-${inviter}', '${inviter}', '${inviter}@example.test', 'QA Inviter', 'user',
        'supplier', 'password', 'self_registered', 0, 'active', 'approved', 1,
        '${HASH}', now(), 'ZUI${stamp}')`);
  const inviterId = Number(sql(`select id from users where username='${inviter}'`));
  check(inviterId > 0, 'SETUP: an inviter with a referral code', `id ${inviterId}`);

  const page = await browser.newPage();
  await page.setCookies(asBrowserCookies(await signIn(`${inviter}@example.test`)));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/settings`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await page.goto(`${BASE}/settings`);
  const there = await waitFor(page, `!!document.querySelector('[data-testid="referral-invite-earn"]')`);
  check(there, 'the referral area renders for a signed-in user');

  const empty = JSON.parse(await page.evaluate(AREA));
  check(empty.link && empty.copy, 'EMPTY: the code, the link and a Copy action are offered',
    `link ${empty.link}, copy ${empty.copy}`);
  check(empty.how, 'EMPTY: and it explains how referral works');
  check(empty.referred && /nobody has signed up/i.test(empty.text),
    'EMPTY: with a truthful empty state rather than a promise',
    empty.text.slice(0, 80));

  /* ── NOW GIVE THEM A REAL REFERRAL AND A REAL REWARD ──────────────────── */
  const referred = `zruiB${stamp}`;
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified)
       values ('probe-${referred}', '${referred}', '${referred}@example.test', 'QA Referred Supplier', 'user',
        'supplier', 'password', 'self_registered', 0, 'active', 'approved', 1)`);
  const referredId = Number(sql(`select id from users where username='${referred}'`));
  const admin = Number(sql(`select id from users where role='admin' order by id limit 1`));
  sql(`insert into referralCampaigns (name, status, eligibleInviterRoles, eligibleReferredRoles,
        qualificationType, rewardType, rewardValue, perInviterCap, priority, attributionWindowDays, createdBy, startsAt)
       values ('ZUI ${stamp}', 'active', '["supplier"]', '["supplier"]',
        'PROVIDER_APPROVED', 'EXTRA_QUALIFIED_ENQUIRIES', '7', 5, 50, 90, ${admin}, date_sub(now(), interval 1 day))`);
  const campaignId = Number(sql(`select id from referralCampaigns where name='ZUI ${stamp}'`));
  sql(`insert into referrals (referrerId, referredId, code, status, campaignId, qualificationType, qualifiedAt)
       values (${inviterId}, ${referredId}, 'ZUI${stamp}', 'rewarded', ${campaignId}, 'PROVIDER_APPROVED', now())`);
  const referralId = Number(sql(`select id from referrals where referredId=${referredId}`));
  sql(`insert into referralRewards (referralId, campaignId, recipientUserId, rewardType, rewardValue, status, grantedAt)
       values (${referralId}, ${campaignId}, ${inviterId}, 'EXTRA_QUALIFIED_ENQUIRIES', '7', 'GRANTED', now())`);

  await page.goto(`${BASE}/settings`);
  await waitFor(page, `!!document.querySelector('[data-testid="referral-rewards"]')`);
  await settle(1200);
  const filled = JSON.parse(await page.evaluate(AREA));

  check(/7 extra qualified enquiries/i.test(filled.text),
    'REWARD: it reads as a sentence with its unit',
    (filled.text.match(/[^.]*extra qualified[^.]*/i) ?? ['not found'])[0].slice(0, 70));
  check(!filled.rawEnum,
    'REWARD: and NO stored enum reaches the reader',
    filled.rawEnum ? 'a raw token is on the page' : 'none');

  check(/QA Referred Supplier/.test(filled.text),
    'REFERRED: a publicly listed business is named',
    /QA Referred Supplier/.test(filled.text) ? 'named' : 'absent');
  check(/Rewarded/i.test(filled.text), 'REFERRED: with where the referral got to',
    (filled.text.match(/Rewarded/i) ?? ['absent'])[0]);

  /* ── A PRIVATE ACCOUNT IS NOT NAMED ───────────────────────────────────── */
  const priv = `zruiC${stamp}`;
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified)
       values ('probe-${priv}', '${priv}', '${priv}@example.test', 'Private Person Name', 'user',
        'homeowner', 'password', 'self_registered', 0, 'active', 'approved', 1)`);
  const privId = Number(sql(`select id from users where username='${priv}'`));
  sql(`insert into referrals (referrerId, referredId, code, status)
       values (${inviterId}, ${privId}, 'ZUI${stamp}', 'registered')`);
  await page.goto(`${BASE}/settings`);
  await waitFor(page, `!!document.querySelector('[data-testid="referral-referred"]')`);
  await settle(1200);
  const withPrivate = JSON.parse(await page.evaluate(AREA));
  check(!/Private Person Name/.test(withPrivate.text),
    'PRIVACY: a homeowner who used the code is NOT named to the inviter',
    /Private Person Name/.test(withPrivate.text) ? 'their name is on the page' : 'not named');
  check(/private account/i.test(withPrivate.text),
    'PRIVACY: but the referral is still shown, so the count is explainable',
    /private account/i.test(withPrivate.text) ? 'shown without a name' : 'the row is missing entirely');

  /* ── ARABIC ───────────────────────────────────────────────────────────── */
  await page.evaluate("localStorage.setItem('buildhub_lang', 'ar'); return true;");
  await page.goto(`${BASE}/settings`);
  await waitFor(page, `document.documentElement.dir === 'rtl'`);
  await settle(1200);
  const arabic = JSON.parse(await page.evaluate(AREA));
  check(/[؀-ۿ]/.test(arabic.text), 'ARABIC: the referral area is in Arabic',
    arabic.text.slice(0, 60));
  check(!arabic.rawEnum, 'ARABIC: and still no raw enum');
  check(/طلب مؤهَّل إضافي/.test(arabic.text),
    'ARABIC: the reward reads as an Arabic sentence too',
    (arabic.text.match(/[^.]*مؤهَّل[^.]*/) ?? ['not found'])[0].slice(0, 60));
} finally {
  cleanUp();
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
