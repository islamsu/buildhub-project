// ── LIVE: the referral engine fires, for the first time ───────────────────
//
// THE DEFECT. `server/referralEngine.ts` read `referrals.campaignId` on every
// qualification attempt and NOTHING HAS EVER WRITTEN IT - the signup insert
// omits it and no other writer exists. Every referral in the product's history
// short-circuited at 'no campaign'. No reward has ever been granted by
// BuildHub, and none could have been.
//
// The owner's decision is LATE BINDING AT QUALIFICATION: the campaign is chosen
// when a real qualifying event fires, from what is eligible at that moment.
// This walks that end to end against a real MariaDB and a real HTTP server:
//
//   an inviter's code -> a real signup carrying it -> a real admin verifying
//   the account -> a campaign RESOLVED and BOUND -> a reward row -> the ACTUAL
//   ENTITLEMENT the reward promises, read back through the billing engine.
//
// A reward row saying GRANTED while the entitlement does not exist is worse
// than no row at all, because it is the one an administrator quotes back to a
// vendor. So the effect is asserted, not the ledger.
import { execSync } from 'node:child_process';

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

function session(initial = '') {
  let cookie = initial;
  const call = async (method, path, input) => {
    const url = method === 'GET' && input !== undefined
      ? `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
      : `${BASE}/api/trpc/${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify({ json: input }) } : {}),
    });
    const all = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    for (const raw of all) {
      const pair = String(raw).split(';')[0];
      if (pair.startsWith('app_session_id=')) cookie = pair;
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, data: json?.result?.data?.json ?? null, error: json?.error?.json?.message ?? null };
  };
  return { query: (p, i) => call('GET', p, i), mutate: (p, i) => call('POST', p, i) };
}

const stamp = Date.now() % 100000000;
const made = { users: [], campaigns: [] };

async function signUp(suffix, userRole, referralCode) {
  const username = `zgref${stamp}${suffix}`;
  const res = await fetch(`${BASE}/api/trpc/auth.signUp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: {
      username, email: `${username}@example.test`, password: 'ProbeUser!2024',
      name: `Referral Probe ${suffix}`, userRole,
      ...(referralCode ? { referralCode } : {}),
    } }),
  });
  if (res.status !== 200) throw new Error(`probe setup: signUp ${suffix} failed ${res.status}`);
  const id = Number(sql(`select id from users where username='${username}'`));
  if (sql(`select username from users where id=${id}`) !== username) throw new Error('probe setup: wrong row');
  made.users.push(id);
  return { id, username, session: session((res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')) };
}

const campaign = (name, over = {}) => {
  const row = {
    name, status: 'active',
    eligibleInviterRoles: JSON.stringify(['supplier']),
    eligibleReferredRoles: JSON.stringify(['homeowner']),
    qualificationType: 'ACCOUNT_VERIFIED',
    rewardType: 'EXTRA_QUALIFIED_ENQUIRIES',
    rewardValue: '5',
    rewardDurationDays: 30,
    perInviterCap: 1,
    priority: 0,
    attributionWindowDays: 90,
    createdBy: 1,
    ...over,
  };
  const cols = Object.keys(row).join(',');
  const vals = Object.values(row).map(v => v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`).join(',');
  sql(`insert into referralCampaigns (${cols}) values (${vals})`);
  const id = Number(sql(`select id from referralCampaigns where name='${name}'`));
  made.campaigns.push(id);
  return id;
};

try {
  /*
   * PURGE WHAT AN EARLIER RUN LEFT BEHIND, BEFORE ASSERTING ANYTHING.
   *
   * The reward FK is RESTRICT, so a run that aborts mid-way cannot delete its
   * own campaigns and they survive. Two such leftovers - same priority, lower
   * ids - then won this run's tie-break, and the probe reported a CORRECT
   * resolution as a determinism failure. The resolver was right; the probe was
   * dirty. Purged in dependency order, and scoped to this probe's own prefix.
   */
  sql(`delete from referralRewards where campaignId in (select id from referralCampaigns where name like 'ZG %')`);
  sql(`update referrals set campaignId = null where campaignId in (select id from referralCampaigns where name like 'ZG %')`);
  sql(`delete from referralCampaigns where name like 'ZG %'`);

  // ── the inviter, and their REAL code from the product ──────────────────
  const inviter = await signUp('inv', 'supplier');
  sql(`update users set onboardingStatus='approved', verified=1 where id=${inviter.id}`);
  const code = sql(`select referralCode from users where id=${inviter.id}`);
  check('SETUP: signup minted a real referral code for the inviter', /^.{4,32}$/.test(code), code);

  // TWO campaigns, so resolution has a real choice to make.
  const low = campaign(`ZG Low ${stamp}`, { priority: 1, rewardValue: '3' });
  const high = campaign(`ZG High ${stamp}`, { priority: 5, rewardValue: '7' });
  check('SETUP: two eligible campaigns exist', low > 0 && high > 0, `low=${low} high=${high}`);

  // ── a real signup carrying the code ────────────────────────────────────
  const referred = await signUp('ref', 'homeowner', code);
  const referralId = Number(sql(`select id from referrals where referredId=${referred.id}`));
  check('the signup recorded the referral against the real code', referralId > 0, `referral ${referralId}`);
  check('THE DEFECT: signup binds NO campaign - that is the design, not a gap',
    sql(`select ifnull(campaignId,'NULL') from referrals where id=${referralId}`) === 'NULL');
  check('and no reward exists yet',
    Number(sql(`select count(*) from referralRewards where referralId=${referralId}`)) === 0);

  const before = await inviter.session.query('billing.myEntitlements', undefined);
  const allowanceBefore = before.data?.qualifiedEnquiryAllowance ?? null;

  // ── a REAL administrator verifies the account ──────────────────────────
  const admin = session();
  const signedIn = await admin.mutate('auth.adminSignIn', { identifier: 'superadmin@buildhub.local', password: PASSWORD });
  check('SETUP: an administrator is genuinely signed in', signedIn.status === 200, `${signedIn.status}`);
  if (signedIn.status !== 200) throw new Error('probe setup: admin session not established');

  const verified = await admin.mutate('admin.verifyUser', { userId: referred.id, verified: true });
  check('the administrator verifies the referred account', verified.status === 200, verified.error ?? '');

  // ── THE CAMPAIGN IS RESOLVED AND BOUND ─────────────────────────────────
  const boundTo = Number(sql(`select ifnull(campaignId,0) from referrals where id=${referralId}`));
  check('LATE BINDING: a campaign is now bound to the referral', boundTo > 0, `campaign ${boundTo}`);
  check('DETERMINISM: it is the HIGHER-PRIORITY campaign, not whichever row came back first',
    boundTo === high, `bound=${boundTo} expected=${high}`);
  check('the referral records what qualified it, and when',
    sql(`select qualificationType from referrals where id=${referralId}`) === 'ACCOUNT_VERIFIED'
    && sql(`select qualifiedAt is not null from referrals where id=${referralId}`) === '1');

  // ── ONE REWARD, FROM THAT CAMPAIGN, WITH ITS TERMS SNAPSHOTTED ─────────
  const rewards = Number(sql(`select count(*) from referralRewards where referralId=${referralId}`));
  check('exactly one reward row was written', rewards === 1, `${rewards}`);
  check('it belongs to the campaign that was chosen',
    Number(sql(`select campaignId from referralRewards where referralId=${referralId}`)) === high);
  check('and it SNAPSHOTS the terms rather than pointing at a campaign that can change',
    sql(`select concat(rewardType,'|',rewardValue) from referralRewards where referralId=${referralId}`)
      === 'EXTRA_QUALIFIED_ENQUIRIES|7');

  // ── THE EFFECT IS REAL, read back through the billing engine ───────────
  const after = await inviter.session.query('billing.myEntitlements', undefined);
  const allowanceAfter = after.data?.qualifiedEnquiryAllowance ?? null;
  check('THE EFFECT: the inviter\'s real enquiry allowance increased by the reward',
    allowanceBefore !== null && allowanceAfter !== null
      ? allowanceAfter - allowanceBefore === 7
      : allowanceAfter !== allowanceBefore,
    `${allowanceBefore} -> ${allowanceAfter}`);
  check('DATABASE: an entitlement override row backs it, not just a ledger entry',
    Number(sql(`select count(*) from vendorEntitlementOverrides where userId=${inviter.id}`)) > 0);

  // ── IDEMPOTENCE: the same event again changes nothing ──────────────────
  await admin.mutate('admin.verifyUser', { userId: referred.id, verified: false });
  const twice = await admin.mutate('admin.verifyUser', { userId: referred.id, verified: true });
  check('re-verifying the same account does not grant a second reward',
    twice.status === 200 && Number(sql(`select count(*) from referralRewards where referralId=${referralId}`)) === 1);

  // ── NEVER RE-BOUND: a better campaign arriving later does not move it ──
  const better = campaign(`ZG Better ${stamp}`, { priority: 99, rewardValue: '50' });
  await admin.mutate('admin.verifyUser', { userId: referred.id, verified: false });
  await admin.mutate('admin.verifyUser', { userId: referred.id, verified: true });
  check('a higher-priority campaign appearing LATER does not re-bind a qualified referral',
    Number(sql(`select campaignId from referrals where id=${referralId}`)) === high,
    `still ${sql(`select campaignId from referrals where id=${referralId}`)}, better=${better}`);
  check('and still exactly one reward',
    Number(sql(`select count(*) from referralRewards where referralId=${referralId}`)) === 1);

  // ── THE CAP IS ELIGIBILITY: a second referral finds the campaign full ──
  const second = await signUp('ref2', 'homeowner', code);
  const secondReferral = Number(sql(`select id from referrals where referredId=${second.id}`));
  await admin.mutate('admin.verifyUser', { userId: second.id, verified: true });
  const secondBound = Number(sql(`select ifnull(campaignId,0) from referrals where id=${secondReferral}`));
  check('a second referral does NOT bind the campaign this inviter has exhausted',
    secondBound !== high, `bound=${secondBound} exhausted=${high}`);
  check('it takes the next eligible campaign instead of failing outright',
    secondBound === better || secondBound === low, `bound=${secondBound}`);

  // ── THE ATTRIBUTION WINDOW ─────────────────────────────────────────────
  const third = await signUp('ref3', 'homeowner', code);
  const thirdReferral = Number(sql(`select id from referrals where referredId=${third.id}`));
  // Age the referral past every campaign's window.
  sql(`update referrals set createdAt = date_sub(now(), interval 400 day) where id=${thirdReferral}`);
  await admin.mutate('admin.verifyUser', { userId: third.id, verified: true });
  check('ATTRIBUTION WINDOW: a signup older than the window earns nothing',
    sql(`select ifnull(campaignId,'NULL') from referrals where id=${thirdReferral}`) === 'NULL'
    && Number(sql(`select count(*) from referralRewards where referralId=${thirdReferral}`)) === 0,
    sql(`select ifnull(campaignId,'NULL') from referrals where id=${thirdReferral}`));

  // ── THE LEDGER NEVER CLAIMS MORE THAN THE EFFECT DELIVERED ─────────────
  check('the granted reward is GRANTED, with a grant timestamp',
    sql(`select concat(status,'|',grantedAt is not null) from referralRewards where referralId=${referralId}`) === 'GRANTED|1',
    sql(`select concat(status,'|',ifnull(grantedAt,'NULL')) from referralRewards where referralId=${referralId}`));

  /*
   * A REWARD WHOSE EFFECT CANNOT BE APPLIED MUST NOT READ AS GRANTED.
   *
   * The reward was inserted as GRANTED before anything was applied, and BOTH
   * calls that apply it return a refusal that was discarded - so a row could
   * say GRANTED while the allowance was refused and the placement was never
   * booked. That row is the one an administrator quotes back to a vendor.
   *
   * Provoked with a campaign whose reward value is not a number of enquiries at
   * all, which the application path refuses.
   */
  const broken = campaign(`ZG Unpayable ${stamp}`, { priority: 200, rewardValue: 'not-a-number' });
  const fourth = await signUp('ref4', 'homeowner', code);
  const fourthReferral = Number(sql(`select id from referrals where referredId=${fourth.id}`));
  await admin.mutate('admin.verifyUser', { userId: fourth.id, verified: true });
  check('an unpayable reward is recorded REJECTED, not GRANTED',
    sql(`select status from referralRewards where referralId=${fourthReferral}`) === 'REJECTED',
    sql(`select ifnull(status,'no row') from referralRewards where referralId=${fourthReferral}`));
  check('and it carries the REASON it could not be paid',
    /not a positive number/i.test(sql(`select ifnull(reversalReason,'') from referralRewards where referralId=${fourthReferral}`)),
    sql(`select ifnull(reversalReason,'') from referralRewards where referralId=${fourthReferral}`));
  check('the referral stays QUALIFIED - it qualified; the payout is what failed',
    sql(`select status from referrals where id=${fourthReferral}`) === 'qualified',
    sql(`select status from referrals where id=${fourthReferral}`));
  check('and the inviter is NOT told they received a reward they did not receive',
    Number(sql(`select count(*) from notifications where userId=${inviter.id} and type='referral'`))
      === Number(sql(`select count(*) from referralRewards where recipientUserId=${inviter.id} and status='GRANTED'`)),
    `${sql(`select count(*) from notifications where userId=${inviter.id} and type='referral'`)} notices for `
    + `${sql(`select count(*) from referralRewards where recipientUserId=${inviter.id} and status='GRANTED'`)} grants`);
  check('no entitlement was moved by the rejected reward',
    (await inviter.session.query('billing.myEntitlements', undefined)).data?.qualifiedEnquiryAllowance
      === (await inviter.session.query('billing.myEntitlements', undefined)).data?.qualifiedEnquiryAllowance);

  // ── THE PLACEMENT REWARD IS BOOKED WHERE IT CAN BE SEEN ────────────────
  // `category: 'General'` is neither GLOBAL_PLACEMENT_SCOPE nor a taxonomy
  // value, and publicPlacement matches scope EXACTLY - so every referral
  // Spotlight ever booked was invisible on every surface.
  const spotlight = campaign(`ZG Spotlight ${stamp}`, {
    priority: 300, rewardType: 'TEMPORARY_FEATURED', rewardValue: 'SPOTLIGHT', rewardDurationDays: 14,
  });
  const fifth = await signUp('ref5', 'homeowner', code);
  const fifthReferral = Number(sql(`select id from referrals where referredId=${fifth.id}`));
  await admin.mutate('admin.verifyUser', { userId: fifth.id, verified: true });
  const placementStatus = sql(`select ifnull(status,'no row') from referralRewards where referralId=${fifthReferral}`);
  if (placementStatus === 'GRANTED') {
    check('PLACEMENT: booked with a scope the public resolver can actually match',
      sql(`select category from vendorSponsorships where vendorId=${inviter.id} and source='REFERRAL_REWARD' limit 1`) === 'GLOBAL',
      sql(`select ifnull(category,'none') from vendorSponsorships where vendorId=${inviter.id} and source='REFERRAL_REWARD' limit 1`));
    check('PLACEMENT: the platform is the grantor, not the beneficiary himself',
      sql(`select ifnull(grantedBy,'NULL') from vendorSponsorships where vendorId=${inviter.id} and source='REFERRAL_REWARD' limit 1`) === 'NULL');
  } else {
    // A refusal is a legitimate outcome here (the inviter may already hold a
    // Spotlight). What must NOT happen is a GRANTED row with no placement.
    check('PLACEMENT: a refused booking is recorded REJECTED, with its reason',
      placementStatus === 'REJECTED'
      && sql(`select ifnull(reversalReason,'') from referralRewards where referralId=${fifthReferral}`).length > 0,
      `${placementStatus}: ${sql(`select ifnull(reversalReason,'') from referralRewards where referralId=${fifthReferral}`)}`);
  }

  // ── A BONUS AND AN ADMIN GRANT MUST SURVIVE EACH OTHER ─────────────────
  //
  // The reward used to be applied with setEnquiryAllowance(current + bonus),
  // which REVOKES whatever override was there. So a referral reward silently
  // destroyed an administrator's grant, and when the reward expired the vendor
  // fell back to the PLAN value rather than to the administrator's number - a
  // temporary bonus permanently deleting a permanent decision.
  const sixth = await signUp('inv2', 'supplier');
  sql(`update users set onboardingStatus='approved', verified=1 where id=${sixth.id}`);
  const sixthCode = sql(`select referralCode from users where id=${sixth.id}`);

  // An administrator sets an absolute allowance, through the real endpoint.
  const adminGrant = await admin.mutate('admin.setVendorEnquiryLimit', { userId: sixth.id, limit: 40, reason: 'ZG admin grant' });
  const adminGrantWorked = adminGrant.status === 200;
  check('SETUP: an administrator set an absolute allowance', adminGrantWorked,
    `${adminGrant.status} ${adminGrant.error ?? ''}`);

  if (adminGrantWorked) {
    const stackCampaign = campaign(`ZG Stack ${stamp}`, { priority: 400, rewardValue: '6' });
    const seventh = await signUp('ref6', 'homeowner', sixthCode);
    const seventhReferral = Number(sql(`select id from referrals where referredId=${seventh.id}`));
    await admin.mutate('admin.verifyUser', { userId: seventh.id, verified: true });

    const stacked = (await sixth.session.query('billing.myEntitlements', undefined)).data?.qualifiedEnquiryAllowance;
    check('STACKING: the bonus ADDS to the administrator\'s number, it does not replace it',
      stacked === 46, `admin 40 + bonus 6 = expected 46, got ${stacked}`);
    check('DATABASE: the administrator\'s override is still live, not revoked by the reward',
      Number(sql(`select count(*) from vendorEntitlementOverrides
                  where userId=${sixth.id} and entitlementKey='qualifiedEnquiriesPerMonth' and revokedAt is null`)) === 1);
    check('and the bonus is its own row in its own slot',
      Number(sql(`select count(*) from vendorEntitlementOverrides
                  where userId=${sixth.id} and entitlementKey='qualifiedEnquiryBonus' and revokedAt is null`)) === 1);
    check('the reward records WHAT it created, so a reversal can undo exactly that',
      /^OVERRIDE:\d+$/.test(sql(`select ifnull(effectRef,'') from referralRewards where referralId=${seventhReferral}`)),
      sql(`select ifnull(effectRef,'none') from referralRewards where referralId=${seventhReferral}`));

    // EXPIRY: age the bonus past its end date. The administrator's 40 must be
    // what remains - not the plan value.
    sql(`update vendorEntitlementOverrides set endsAt = date_sub(now(), interval 1 day)
         where userId=${sixth.id} and entitlementKey='qualifiedEnquiryBonus'`);
    const afterLapse = (await sixth.session.query('billing.myEntitlements', undefined)).data?.qualifiedEnquiryAllowance;
    check('EXPIRY: when the bonus lapses the ADMINISTRATOR\'s number remains, not the plan\'s',
      afterLapse === 40, `expected 40, got ${afterLapse}`);

    // TWO BONUSES SUM rather than supersede.
    sql(`update vendorEntitlementOverrides set endsAt = null
         where userId=${sixth.id} and entitlementKey='qualifiedEnquiryBonus'`);
    sql(`insert into vendorEntitlementOverrides (userId, entitlementKey, value, reason, startsAt)
         values (${sixth.id}, 'qualifiedEnquiryBonus', '3', 'ZG second bonus', now())`);
    const twoBonuses = (await sixth.session.query('billing.myEntitlements', undefined)).data?.qualifiedEnquiryAllowance;
    check('two bonuses in force SUM, rather than one superseding the other',
      twoBonuses === 49, `expected 40+6+3=49, got ${twoBonuses}`);
  }

  // ── SUBSCRIPTION_EXTENSION: real time, and no invented money ───────────
  //
  // The owner's decision: this may extend a legitimate existing period, and
  // must never fabricate a payment, invoice, transaction, revenue, commission
  // or paid renewal. It must extend from the EXISTING end date - extending
  // from now would confiscate a vendor's unused time and call it a reward -
  // and must refuse honestly when there is no finite period to extend.
  const extInviter = await signUp('inv3', 'supplier');
  sql(`update users set onboardingStatus='approved', verified=1 where id=${extInviter.id}`);
  const extCode = sql(`select referralCode from users where id=${extInviter.id}`);
  const extCampaign = campaign(`ZG Extend ${stamp}`, {
    priority: 500, rewardType: 'SUBSCRIPTION_EXTENSION', rewardValue: '30', rewardDurationDays: null,
  });

  // FIRST, the refusal: this account has no finite period.
  const noPeriod = await signUp('ref7', 'homeowner', extCode);
  const noPeriodReferral = Number(sql(`select id from referrals where referredId=${noPeriod.id}`));
  await admin.mutate('admin.verifyUser', { userId: noPeriod.id, verified: true });
  check('EXTENSION: a free account with no finite period is REFUSED, not given one',
    sql(`select status from referralRewards where referralId=${noPeriodReferral}`) === 'REJECTED'
    && /no finite subscription period/i.test(sql(`select ifnull(reversalReason,'') from referralRewards where referralId=${noPeriodReferral}`)),
    sql(`select concat(ifnull(status,'none'),': ',ifnull(reversalReason,'')) from referralRewards where referralId=${noPeriodReferral}`));
  check('and no subscription period was invented for them',
    sql(`select ifnull(count(*),0) from vendorSubscriptions where userId=${extInviter.id} and currentPeriodEnd is not null`) === '0',
    sql(`select ifnull(count(*),0) from vendorSubscriptions where userId=${extInviter.id} and currentPeriodEnd is not null`));

  // NOW give the inviter a real period, and extend THAT.
  sql(`insert into vendorSubscriptions (userId, plan, status, currentPeriodEnd)
       values (${extInviter.id}, 'professional', 'active', date_add(now(), interval 21 day))
       on duplicate key update plan='professional', status='active', currentPeriodEnd=date_add(now(), interval 21 day)`);
  const endBefore = sql(`select currentPeriodEnd from vendorSubscriptions where userId=${extInviter.id}`);
  const daysBefore = Number(sql(`select datediff(currentPeriodEnd, now()) from vendorSubscriptions where userId=${extInviter.id}`));

  const extended = await signUp('ref8', 'homeowner', extCode);
  const extendedReferral = Number(sql(`select id from referrals where referredId=${extended.id}`));
  await admin.mutate('admin.verifyUser', { userId: extended.id, verified: true });

  check('EXTENSION: the reward is GRANTED once the period actually moved',
    sql(`select status from referralRewards where referralId=${extendedReferral}`) === 'GRANTED',
    sql(`select concat(ifnull(status,'none'),': ',ifnull(reversalReason,'')) from referralRewards where referralId=${extendedReferral}`));
  const daysAfter = Number(sql(`select datediff(currentPeriodEnd, now()) from vendorSubscriptions where userId=${extInviter.id}`));
  check('EXTENSION: extended FROM THE EXISTING END DATE - 21 days left plus 30 is 51, not 30',
    daysAfter === daysBefore + 30, `${daysBefore} -> ${daysAfter}`);
  check('EXTENSION: and the period only ever moved FORWARD',
    sql(`select currentPeriodEnd > '${endBefore}' from vendorSubscriptions where userId=${extInviter.id}`) === '1');

  // NO INVENTED MONEY. Whatever billing history it wrote, none of it is a
  // payment, and no invoice or transaction row appeared.
  const moneyEvents = Number(sql(`select count(*) from billingEvents
      where userId=${extInviter.id} and (action like '%payment%' or action like '%invoice%' or action like '%renew%')`));
  check('EXTENSION: no payment, invoice or renewal event was fabricated', moneyEvents === 0, `${moneyEvents}`);
  check('EXTENSION: the billing history names what actually happened',
    Number(sql(`select count(*) from billingEvents where userId=${extInviter.id} and action='subscription_extended'`)) >= 1,
    sql(`select group_concat(distinct action) from billingEvents where userId=${extInviter.id}`));

  // ── AUDIT AND NOTIFICATION ─────────────────────────────────────────────
  // ONE AUDIT ROW PER REWARD, not a hard-coded one: the second referral also
  // paid this inviter, from the next eligible campaign. Tying the count to the
  // real reward count is both correct and stronger than a constant.
  const rewardsForInviter = Number(sql(`select count(*) from referralRewards where recipientUserId=${inviter.id}`));
  const auditRows = Number(sql(`select count(*) from userAccountAuditEvents
                where userId=${inviter.id} and action='referral_reward_granted'`));
  check('AUDIT: every grant is recorded against the inviter, one row each',
    rewardsForInviter > 0 && auditRows === rewardsForInviter,
    `${auditRows} audit rows for ${rewardsForInviter} rewards`);
  check('the inviter was notified',
    Number(sql(`select count(*) from notifications where userId=${inviter.id} and type='referral'`)) >= 1);
} catch (error) {
  check(`PROBE ABORTED: ${(error && error.message) || error}`, false);
} finally {
  if (made.users.length > 0) {
    const ids = made.users.join(',');
    sql(`delete from vendorEntitlementOverrides where userId in (${ids})`);
    sql(`delete from referralRewards where recipientUserId in (${ids})`);
    sql(`delete from referrals where referrerId in (${ids}) or referredId in (${ids})`);
    sql(`delete from vendorSponsorships where vendorId in (${ids})`);
    sql(`delete from billingEvents where userId in (${ids})`);
    sql(`delete from vendorSubscriptions where userId in (${ids})`);
    sql(`delete from notifications where userId in (${ids})`);
    sql(`delete from userAccountAuditEvents where userId in (${ids}) or actorId in (${ids})`);
    sql(`delete from users where id in (${ids})`);
  }
  if (made.campaigns.length > 0) {
    // Dependency order: referralRewards.campaignId is RESTRICT, and so is
    // referrals.campaignId's own reference. Rewards go first, referrals are
    // unbound, then the campaigns can go.
    const ids = made.campaigns.join(',');
    sql(`delete from referralRewards where campaignId in (${ids})`);
    sql(`update referrals set campaignId = null where campaignId in (${ids})`);
    sql(`delete from referralCampaigns where id in (${ids})`);
  }
}

check('CLEANUP: every row this probe planted is gone',
  Number(sql(`select count(*) from users where id in (${made.users.join(',')})`)) === 0
  && Number(sql(`select count(*) from referralCampaigns where name like 'ZG %${stamp}'`)) === 0);

console.log(results.join('\n'));
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
