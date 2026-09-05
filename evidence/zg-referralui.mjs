// ── LIVE BROWSER: the referral screens an administrator and a vendor use ───
//
// zg-referral.mjs proves the SERVER runs the referral lifecycle correctly.
// This proves the screens exist and show the truth:
//
//   - the reward LEDGER, which had no client caller at all, so nothing
//     BuildHub granted was visible to an administrator;
//   - the Reward column on the referral list, which read two columns nothing
//     has ever written and was permanently "-" on every row;
//   - the vendor's own Benefits and Limits, since `billing.myEntitlements` and
//     `billing.myPlan` have existed for a long time with no screen at all;
//   - and the reward history in Invite & Earn, which showed one number.
//
// Rendered at 375, 768 and 1440 in both languages, because a table that fits
// on a laptop and pushes the page sideways on a phone is a real defect and a
// source-text assertion cannot see it.
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const PASSWORD = 'LocalSuperAdmin!2024';

const sql = q => execSync(
  `mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`,
  { input: q.replace(/\s+/g, ' ').trim() },
).toString().split('\n').filter(l => !/^PAGER set to/.test(l)).join('\n').trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

const stamp = Date.now() % 100000000;
const made = { users: [], campaigns: [] };

async function signUpVendor(suffix) {
  const username = `zgrui${stamp}${suffix}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${BASE}/api/trpc/auth.signUp`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: {
        username, email: `${username}@example.test`, password: 'ProbeUser!2024',
        name: `Referral UI ${suffix}`, userRole: 'supplier',
      } }),
    });
    if (res.status === 200) {
      const id = Number(sql(`select id from users where username='${username}'`));
      if (sql(`select username from users where id=${id}`) !== username) throw new Error('probe setup: wrong row');
      made.users.push(id);
      const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
      return { id, username, cookie };
    }
    if (res.status !== 429) throw new Error(`probe setup: signUp ${suffix} failed ${res.status}`);
    // BuildHub's auth limiter allows 60 attempts a minute from one address, and
    // this probe runs beside another that creates twenty accounts. Waiting is
    // correct; reporting the limiter as a failure would not be.
    const seconds = Number(/Try again in (\d+)s/.exec(await res.text())?.[1] ?? 20);
    await new Promise(resolve => setTimeout(resolve, Math.min(seconds + 2, 70) * 1000));
  }
  throw new Error(`probe setup: signUp ${suffix} rate limited after retries`);
}

async function adminSignIn() {
  const res = await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: 'superadmin@buildhub.local', password: PASSWORD } }),
  });
  return {
    ok: res.status === 200,
    cookie: (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; '),
  };
}

const cookiesFor = cookie => cookie.split('; ').filter(Boolean).map(pair => {
  const at = pair.indexOf('=');
  return { name: pair.slice(0, at), value: pair.slice(at + 1), domain: '127.0.0.1', path: '/' };
});

async function waitFor(page, selector, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(`return !!document.querySelector(${JSON.stringify(selector)});`)) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}
const text = (page, selector) => page.evaluate(
  `const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.innerText : null;`);

/**
 * A REAL POINTER, not `element.click()`.
 *
 * The tab control is a Radix trigger, and it ignores both a synthetic
 * `.click()` and a bare `.focus()` - `data-state` stayed "inactive" through
 * fifteen attempts, which reads as "the tab is broken" when it is not. A real
 * user's pointer produces mousePressed/mouseReleased at a coordinate, so that
 * is what this sends, after scrolling the control into view: the element sat at
 * y=1832 on a 900px viewport, and a click at a coordinate outside the viewport
 * lands on nothing.
 */
async function clickReal(page, selector) {
  const box = await page.evaluate(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const rect = el.getBoundingClientRect();
    return JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  `);
  if (!box) return false;
  const { x, y } = JSON.parse(box);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  return true;
}

/** Set the viewport AND the language, then reload so the app reads both. */
async function render(page, url, { width, height = 900, lang, waitSelector }) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width < 500,
  });
  await page.goto(`${BASE}/`, { waitFor: 'body' });
  await page.evaluate(`localStorage.setItem('buildhub_lang', ${JSON.stringify(lang)}); return true;`);
  await page.goto(url, { waitFor: 'body' });
  return waitFor(page, waitSelector);
}

const browser = await launchBrowser();

try {
  const admin = await adminSignIn();
  check('SETUP: the administrator signed in for real', admin.ok);
  if (!admin.ok) throw new Error('probe setup: admin session not established');

  // A vendor with a REAL entitlement story: a plan, an administrator's grant,
  // and a referral bonus - so the breakdown has three rows to show rather than
  // being exercised only in its trivial case.
  const vendor = await signUpVendor('v');
  sql(`update users set onboardingStatus='approved', verified=1 where id=${vendor.id}`);
  const granted = await fetch(`${BASE}/api/trpc/admin.setVendorEnquiryLimit`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: admin.cookie },
    body: JSON.stringify({ json: { userId: vendor.id, limit: 40, reason: 'ZG UI probe grant' } }),
  });
  check('SETUP: an administrator granted this vendor an absolute allowance', granted.status === 200,
    `${granted.status}`);
  sql(`insert into vendorEntitlementOverrides (userId, entitlementKey, value, reason, startsAt)
       values (${vendor.id}, 'qualifiedEnquiryBonus', '7', 'ZG UI probe bonus', now())`);

  // ── THE VENDOR'S OWN BENEFITS AND LIMITS ────────────────────────────────
  const vendorPage = await browser.newPage();
  await vendorPage.setCookies(cookiesFor(vendor.cookie));

  const reached = await render(vendorPage, `${BASE}/settings`, {
    width: 1440, lang: 'en', waitSelector: '[data-testid="benefits-effective"]',
  });
  check('BENEFITS: the screen is reachable from /settings at all', reached);

  if (reached) {
    const effective = await text(vendorPage, '[data-testid="benefits-effective"]');
    /*
     * A PROMISE CHAIN, NOT `await`.
     *
     * The CDP helper wraps the expression in a plain arrow function, so an
     * `await` inside it is a syntax error and the page reports only "Uncaught".
     * The returned promise is resolved by `awaitPromise: true`.
     */
    const enforced = await vendorPage.evaluate(`
      return fetch('/api/trpc/billing.myEntitlements')
        .then(res => res.json())
        .then(body => String(body?.result?.data?.json?.qualifiedEnquiryAllowance ?? 'none'))
        .catch(error => 'error: ' + error.message);
    `);
    check('BENEFITS: the number ON THE SCREEN is the one the platform enforces',
      String(effective).trim() === String(enforced).trim(), `screen=${effective} api=${enforced}`);
    check('BENEFITS: it equals plan-replaced-by-grant plus the bonus - 40 + 7',
      String(effective).trim() === '47', `screen=${effective}`);

    const planShown = await text(vendorPage, '[data-testid="benefits-plan-allowance"]');
    const grantShown = await text(vendorPage, '[data-testid="benefits-admin-override"]');
    check('BENEFITS: the PLAN figure is shown, so the vendor can see what changed',
      planShown !== null && planShown.trim().length > 0, `${planShown}`);
    check("BENEFITS: the administrator's grant is named on screen", String(grantShown).trim() === '40', `${grantShown}`);
    const bonusShown = await vendorPage.evaluate(
      `return Array.from(document.querySelectorAll('[data-testid^="benefits-bonus-"]')).map(el => el.innerText.trim());`);
    check('BENEFITS: the bonus is a line of its own, not folded into the total',
      Array.isArray(bonusShown) && bonusShown.includes('+7'), JSON.stringify(bonusShown));

    check('BENEFITS: used, remaining and the reset date are all rendered',
      (await text(vendorPage, '[data-testid="benefits-used"]')) !== null
      && (await text(vendorPage, '[data-testid="benefits-remaining"]')) !== null
      && (await text(vendorPage, '[data-testid="benefits-reset"]')) !== null);
    check('BENEFITS: no mismatch warning, because the parts do add up',
      !(await waitFor(vendorPage, '[data-testid="benefits-mismatch"]', 800)));

    // The reward history in Invite & Earn - which showed one number before.
    check('MINE: the reward history section is on the page',
      await waitFor(vendorPage, '[data-testid="referral-rewards"]'));
    check('MINE: with no rewards yet it says so truthfully, rather than teasing one',
      /No referral reward has been granted to you yet/i.test(
        String(await text(vendorPage, '[data-testid="referral-rewards"]'))),
      String(await text(vendorPage, '[data-testid="referral-rewards"]')).slice(0, 80));
    check('MINE: registered and qualified are shown separately, not as one total',
      (await text(vendorPage, '[data-testid="referral-count-registered"]')) !== null
      && (await text(vendorPage, '[data-testid="referral-count-qualified"]')) !== null);
  }

  /*
   * ── NOW GIVE IT SOMETHING TO SHOW ──────────────────────────────────────
   *
   * Every count above was against an empty database, where "0 records" also
   * appears inside "Page 1 of 1" and the empty state is the only branch that
   * ever renders. A control exercised only in its trivial case is not
   * exercised. The engine is proved by zg-referral.mjs; this plants the rows
   * directly, because what is under test here is the SCREEN.
   */
  const invitee = await signUpVendor('i');
  const campaignId = (() => {
    sql(`insert into referralCampaigns (name, status, eligibleInviterRoles, eligibleReferredRoles,
          qualificationType, rewardType, rewardValue, rewardDurationDays, perInviterCap, priority,
          attributionWindowDays, createdBy)
         values ('ZG UI ${stamp}', 'active', '["supplier"]', '["supplier"]', 'ACCOUNT_VERIFIED',
          'EXTRA_QUALIFIED_ENQUIRIES', '11', 30, 5, 0, 90, 1)`);
    const id = Number(sql(`select id from referralCampaigns where name='ZG UI ${stamp}'`));
    made.campaigns.push(id);
    return id;
  })();
  sql(`insert into referrals (referrerId, referredId, code, status, campaignId)
       values (${vendor.id}, ${invitee.id}, 'ZGUI${stamp}', 'rewarded', ${campaignId})`);
  const referralId = Number(sql(`select id from referrals where referredId=${invitee.id}`));
  sql(`insert into referralRewards (referralId, campaignId, recipientUserId, rewardType, rewardValue,
        status, grantedAt, expiresAt)
       values (${referralId}, ${campaignId}, ${vendor.id}, 'EXTRA_QUALIFIED_ENQUIRIES', '11',
        'GRANTED', now(), date_add(now(), interval 30 day))`);
  const rewardId = Number(sql(`select id from referralRewards where referralId=${referralId}`));
  check('SETUP: a real referral and a real reward exist to render',
    referralId > 0 && rewardId > 0, `referral=${referralId} reward=${rewardId}`);

  {
    const ok = await render(vendorPage, `${BASE}/settings`, {
      width: 1440, lang: 'en', waitSelector: '[data-testid="benefits-effective"]',
    });
    const history = String(await text(vendorPage, '[data-testid="referral-rewards"]'));
    check('MINE: a granted reward is LISTED, with what it was and that it is active', ok
      && /EXTRA_QUALIFIED_ENQUIRIES: 11/.test(history) && /Active/.test(history),
      history.replace(/\n/g, ' | ').slice(0, 140));
    check('MINE: and the empty state is gone now that there IS something to show',
      !/No referral reward has been granted to you yet/i.test(history));
    check('MINE: the qualified count moved with it, not just the total',
      String(await text(vendorPage, '[data-testid="referral-count-qualified"]')).includes('1'),
      String(await text(vendorPage, '[data-testid="referral-count-qualified"]')));
  }

  // ── RESPONSIVE AND RTL, on the vendor screen ────────────────────────────
  for (const width of [375, 768, 1440]) {
    for (const lang of ['en', 'ar']) {
      /*
       * WAIT FOR THE NUMBERS, NOT THE CARD.
       *
       * The card renders while the query is still in flight, so waiting on it
       * read a loading placeholder and reported "no table" at some widths and
       * a rendered table at others - the same code, differing only in timing.
       */
      const ok = await render(vendorPage, `${BASE}/settings`, {
        width, lang, waitSelector: '[data-testid="benefits-effective"]',
      });
      if (!ok) { check(`${width}px ${lang.toUpperCase()}: Benefits rendered`, false); continue; }

      const dir = await vendorPage.evaluate('return document.documentElement.getAttribute("dir");');
      check(`${width}px ${lang.toUpperCase()}: direction matches the language`,
        dir === (lang === 'ar' ? 'rtl' : 'ltr'), `dir=${dir}`);

      const widths = await vendorPage.evaluate(
        'return [document.documentElement.scrollWidth, document.documentElement.clientWidth];');
      check(`${width}px ${lang.toUpperCase()}: the PAGE never scrolls sideways`,
        widths[0] <= widths[1] + 1, `${widths[0]} vs ${widths[1]}`);

      // A wide table must scroll INSIDE its own container, not push the page.
      const contained = await vendorPage.evaluate(`
        const card = document.querySelector('[data-testid="benefits-and-limits"]');
        if (!card) return 'no card';
        const table = card.querySelector('table');
        if (!table) return 'no table';
        const box = table.closest('div');
        return box && getComputedStyle(box).overflowX === 'auto' ? 'contained' : 'loose';
      `);
      check(`${width}px ${lang.toUpperCase()}: the breakdown table scrolls inside its own container`,
        contained === 'contained', String(contained));

      const heading = await vendorPage.evaluate(`
        const card = document.querySelector('[data-testid="benefits-and-limits"]');
        return card ? (card.innerText.split('\\n').find(line => line.trim().length > 2) ?? '') : '';
      `);
      const arabic = /[؀-ۿ]/.test(String(heading));
      check(`${width}px ${lang.toUpperCase()}: the copy is in the right language`,
        lang === 'ar' ? arabic : !arabic, String(heading).slice(0, 30));
    }
  }

  // ── THE ADMINISTRATOR'S REFERRAL SCREENS ────────────────────────────────
  const adminPage = await browser.newPage();
  await adminPage.setCookies(cookiesFor(admin.cookie));

  const adminReached = await render(adminPage, `${BASE}/admin/referrals`, {
    width: 1440, lang: 'en', waitSelector: '[data-testid="admin-referrals"]',
  });
  check('ADMIN UI: the referral screen renders', adminReached);

  if (adminReached) {
    check('ADMIN UI: a REWARDS tab exists - the ledger had no screen at all before',
      await waitFor(adminPage, '[data-testid="tab-referral-rewards"]'));
    check('ADMIN UI: and a pager that states the real record count',
      await waitFor(adminPage, '[data-testid="referral-pager"]'));

    /*
     * WAIT FOR THE COUNT, and read it from its own element.
     *
     * Reading the pager immediately caught the in-flight state, which printed a
     * confident "0 records" - both a probe race AND a real defect, since an
     * administrator glancing at the screen reads that as "no referrals". The
     * page now says "Counting..." until it knows, and this waits for it.
     */
    const countKnown = async () => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const value = String(await text(adminPage, '[data-testid="referral-pager-total"]') ?? '');
        if (value && !/Counting|جارٍ/.test(value)) return value;
        await new Promise(r => setTimeout(r, 200));
      }
      return '';
    };
    const pagerText = await countKnown();
    const realTotal = Number(sql('select count(*) from referrals'));
    // What the SCREEN's own request got back, so a disagreement between the
    // page and the database is attributed rather than guessed at.
    // PARSED, not sliced: the first version cut the response at 300 characters
    // and the field it was looking for fell past the cut, so a working endpoint
    // was reported as unreachable.
    const direct = await adminPage.evaluate(`
      return fetch('/api/trpc/admin.referrals?input=' + encodeURIComponent(JSON.stringify({ json: { page: 0, pageSize: 5 } })))
        .then(res => res.json())
        .then(body => String(body?.result?.data?.json?.total ?? 'no total'))
        .catch(error => 'error: ' + error.message);
    `);
    check('ADMIN UI: the page\'s own request reaches the referral list, and it agrees with the database',
      String(direct) === String(Number(sql('select count(*) from referrals'))),
      `${direct} vs ${sql('select count(*) from referrals')}`);
    check('ADMIN UI: the list did not fail - a failure must not render as a count',
      !(await waitFor(adminPage, '[data-testid="admin-referrals"] [data-testid="section-failed"]', 800)));
    // NOT VACUOUS: the count is real and non-zero, so "0 records" - which also
    // matches the "1" inside "Page 1 of 1" - cannot satisfy this by accident.
    check('ADMIN UI: the count on screen is the database\'s own, not the page size',
      realTotal > 0 && pagerText.trim() === `${realTotal} record${realTotal === 1 ? '' : 's'}`,
      `${pagerText.replace(/\n/g, ' ')} vs ${realTotal}`);

    // The Reward column, which read two columns nothing has ever written and
    // was permanently "-" on every row.
    const listedReward = await adminPage.evaluate(`
      const rows = Array.from(document.querySelectorAll('[data-testid="admin-referrals"] tbody tr'));
      return rows.map(row => row.innerText.replace(/\\n/g, ' | ')).join(' /// ');
    `);
    check('ADMIN UI: the Reward column shows the REAL reward, not a dash',
      /EXTRA_QUALIFIED_ENQUIRIES: 11/.test(String(listedReward)),
      String(listedReward).slice(0, 160));

    // Open the Rewards tab and read the ledger.
    /*
     * CLICK UNTIL IT TAKES. The tab is a real control whose handler is attached
     * during hydration, and a single click fired before that lands on nothing -
     * which reads as "the tab does not work" rather than "the probe was early".
     */
    let tabOpened = false;
    for (let attempt = 0; attempt < 8 && !tabOpened; attempt++) {
      await clickReal(adminPage, '[data-testid="tab-referral-rewards"]');
      tabOpened = await waitFor(adminPage, '[data-testid="reward-pager"]', 1500);
    }
    check('ADMIN UI: the Rewards tab opens and carries its own pager', tabOpened);
    check('ADMIN UI: and the tab control itself reports that it is now selected',
      (await adminPage.evaluate(
        `return document.querySelector('[data-testid="tab-referral-rewards"]')?.getAttribute('data-state');`
      )) === 'active');
    const rewardPager = String(await text(adminPage, '[data-testid="reward-pager-total"]') ?? '');
    const rewardTotal = Number(sql('select count(*) from referralRewards'));
    check('ADMIN UI: with the real reward count behind it',
      rewardTotal > 0 && rewardPager.trim() === `${rewardTotal} record${rewardTotal === 1 ? '' : 's'}`,
      `${rewardPager.replace(/\n/g, ' ')} vs ${rewardTotal}`);
    check('ADMIN UI: and a Reverse control on a granted reward - no screen could withdraw one before',
      await waitFor(adminPage, `[data-testid="reverse-reward-${rewardId}"]`),
      `reverse-reward-${rewardId}`);

    // RESPONSIVE on the admin screen too.
    for (const width of [375, 768, 1440]) {
      for (const lang of ['en', 'ar']) {
        const ok = await render(adminPage, `${BASE}/admin/referrals`, {
          width, lang, waitSelector: '[data-testid="admin-referrals"]',
        });
        if (!ok) { check(`ADMIN ${width}px ${lang.toUpperCase()}: rendered`, false); continue; }
        const dir = await adminPage.evaluate('return document.documentElement.getAttribute("dir");');
        check(`ADMIN ${width}px ${lang.toUpperCase()}: direction matches the language`,
          dir === (lang === 'ar' ? 'rtl' : 'ltr'), `dir=${dir}`);
        const widths = await adminPage.evaluate(
          'return [document.documentElement.scrollWidth, document.documentElement.clientWidth];');
        check(`ADMIN ${width}px ${lang.toUpperCase()}: the PAGE never scrolls sideways`,
          widths[0] <= widths[1] + 1, `${widths[0]} vs ${widths[1]}`);
      }
    }
  }
} catch (error) {
  check(`PROBE ABORTED: ${(error && error.message) || error}`, false);
} finally {
  browser.close();
  const ids = made.users.join(',');
  const failures = [];
  const attempt = (statement) => {
    try { sql(statement); } catch (error) { failures.push(String(error.message).split('\n').pop()); }
  };
  if (made.users.length > 0) {
    attempt(`delete from referralRewards where recipientUserId in (${ids})`);
    attempt(`delete from referrals where referrerId in (${ids}) or referredId in (${ids})`);
    attempt(`delete from vendorEntitlementOverrides where userId in (${ids})`);
    attempt(`delete from vendorSponsorships where vendorId in (${ids})`);
    attempt(`delete from billingEvents where userId in (${ids})`);
    attempt(`delete from vendorSubscriptions where userId in (${ids})`);
    attempt(`delete from notifications where userId in (${ids})`);
    attempt(`delete from analyticsEvents where userId in (${ids})`);
    attempt(`delete from userAccountAuditEvents where userId in (${ids}) or actorId in (${ids})`);
    attempt(`delete from users where id in (${ids})`);
  }
  if (made.campaigns.length > 0) {
    const campaignIds = made.campaigns.join(',');
    attempt(`delete from referralRewards where campaignId in (${campaignIds})`);
    attempt(`update referrals set campaignId = null where campaignId in (${campaignIds})`);
    attempt(`delete from referralCampaigns where id in (${campaignIds})`);
  }
  if (failures.length > 0) check(`CLEANUP: ${failures.length} statement(s) failed`, false, failures.slice(0, 2).join(' | '));
}

check('CLEANUP: every row this probe planted is gone',
  (made.users.length === 0 || Number(sql(`select count(*) from users where id in (${made.users.join(',')})`)) === 0)
  && Number(sql(`select count(*) from referralCampaigns where name like 'ZG UI %'`)) === 0);

console.log(results.join('\n'));
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
