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
    check('PLACEMENT: booked on a SURFACE AND SCOPE some public reader actually queries',
      sql(`select concat(surface,'@',category) from vendorSponsorships
           where vendorId=${inviter.id} and source='REFERRAL_REWARD' limit 1`) === 'SEARCH_RESULTS_BOOST@GLOBAL',
      sql(`select concat(ifnull(surface,'none'),'@',ifnull(category,'none')) from vendorSponsorships
           where vendorId=${inviter.id} and source='REFERRAL_REWARD' limit 1`));
    check('PLACEMENT: and it is not the exclusive Master slot, which is sold rather than given',
      sql(`select count(*) from vendorSponsorships
           where vendorId=${inviter.id} and source='REFERRAL_REWARD' and surface='MASTER_DISCOVERY'`) === '0');
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
  // Hoisted: the reversal section below withdraws exactly this reward and has
  // to prove the ADMINISTRATOR's grant beside it survives.
  let stackRewardId = 0, stackBonusOverrideId = 0, adminOverrideId = 0, stackInviterId = 0;
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

    stackInviterId = sixth.id;
    stackRewardId = Number(sql(`select id from referralRewards where referralId=${seventhReferral}`));
    stackBonusOverrideId = Number(sql(`select substring_index(effectRef,':',-1)
                                       from referralRewards where id=${stackRewardId}`));
    adminOverrideId = Number(sql(`select id from vendorEntitlementOverrides
                                  where userId=${sixth.id} and entitlementKey='qualifiedEnquiriesPerMonth'
                                    and revokedAt is null limit 1`));
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

  // ── ALL FIVE QUALIFICATION EVENTS, NOT JUST ONE ────────────────────────
  //
  // Only ACCOUNT_VERIFIED was hooked. The other four campaign types existed in
  // the schema, in the admin form and in the resolver, and NOTHING in the
  // product could ever fire them - so four of the five campaign types a
  // marketplace administrator can create were decorative.
  const eventInviter = await signUp('inv4', 'supplier');
  sql(`update users set onboardingStatus='approved', verified=1 where id=${eventInviter.id}`);
  const eventCode = sql(`select referralCode from users where id=${eventInviter.id}`);

  const eventCases = [
    { type: 'PROFILE_COMPLETED', role: 'homeowner', suffix: 'e1' },
    { type: 'PROVIDER_APPROVED', role: 'contractor', suffix: 'e2' },
    { type: 'FIRST_VALID_RFQ', role: 'homeowner', suffix: 'e3' },
  ];
  for (const [index, testCase] of eventCases.entries()) {
    const campaignId = campaign(`ZG ${testCase.type} ${stamp}`, {
      priority: 600 + index,
      qualificationType: testCase.type,
      eligibleReferredRoles: JSON.stringify([testCase.role]),
      rewardValue: String(2 + index),
      perInviterCap: 5,
    });
    const referred = await signUp(testCase.suffix, testCase.role, eventCode);
    const referralRow = Number(sql(`select id from referrals where referredId=${referred.id}`));

    if (testCase.type === 'PROFILE_COMPLETED') {
      // The REAL product action, through the real endpoint.
      await referred.session.mutate('auth.updateRole', { userRole: testCase.role, name: 'Profile Probe' });
    } else if (testCase.type === 'PROVIDER_APPROVED') {
      await admin.mutate('admin.updateApplicantStatus', { userId: referred.id, status: 'approved' });
    } else if (testCase.type === 'FIRST_VALID_RFQ') {
      await referred.session.mutate('rfq.create', { category: 'Materials', title: `ZG referral RFQ ${stamp}` });
    }

    check(`EVENT ${testCase.type}: the real product action qualifies the referral`,
      Number(sql(`select ifnull(campaignId,0) from referrals where id=${referralRow}`)) === campaignId,
      `bound=${sql(`select ifnull(campaignId,'NULL') from referrals where id=${referralRow}`)} expected=${campaignId}`);
    check(`EVENT ${testCase.type}: and a reward was granted for it`,
      sql(`select ifnull(status,'no row') from referralRewards where referralId=${referralRow}`) === 'GRANTED',
      sql(`select concat(ifnull(status,'none'),' ',ifnull(reversalReason,'')) from referralRewards where referralId=${referralRow}`));
  }

  // ── THE ADMIN PATH GRANTS, INSTEAD OF MOVING A WORD ────────────────────
  //
  // admin.qualifyReferral wrote `status: 'qualified'` and granted nothing: no
  // reward, no notification, no entitlement. A permanent dead end that looked
  // like it had worked.
  const manualCampaign = campaign(`ZG Manual ${stamp}`, { priority: 700, rewardValue: '9', perInviterCap: 5 });
  const manual = await signUp('m1', 'homeowner', eventCode);
  const manualReferral = Number(sql(`select id from referrals where referredId=${manual.id}`));
  const beforeManual = (await eventInviter.session.query('billing.myEntitlements', undefined)).data?.qualifiedEnquiryAllowance;
  const manualResult = await admin.mutate('admin.qualifyReferral', {
    referralId: manualReferral, qualificationType: 'ACCOUNT_VERIFIED', note: 'ZG manual qualification',
  });
  check('ADMIN: manual qualification runs the SAME engine and reports what happened',
    manualResult.status === 200 && manualResult.data?.status === 'rewarded',
    `${manualResult.status} ${JSON.stringify(manualResult.data ?? manualResult.error)}`);
  check('ADMIN: a real reward row exists, not just a status word',
    sql(`select ifnull(status,'no row') from referralRewards where referralId=${manualReferral}`) === 'GRANTED');
  const afterManual = (await eventInviter.session.query('billing.myEntitlements', undefined)).data?.qualifiedEnquiryAllowance;
  check('ADMIN: and the inviter\'s real entitlement moved',
    Number(afterManual) - Number(beforeManual) === 9, `${beforeManual} -> ${afterManual}`);
  check('ADMIN: the administrator\'s note is preserved on the referral',
    sql(`select ifnull(qualificationNote,'') from referrals where id=${manualReferral}`) === 'ZG manual qualification');

  // And when nothing is eligible, the administrator is TOLD, not shown a
  // success message over a dead end.
  const orphan = await signUp('m2', 'architect', eventCode);
  const orphanReferral = Number(sql(`select id from referrals where referredId=${orphan.id}`));
  const refused = await admin.mutate('admin.qualifyReferral', {
    referralId: orphanReferral, qualificationType: 'FIRST_VALID_QUOTATION_RESPONSE',
  });
  check('ADMIN: with no eligible campaign the administrator is refused, not congratulated',
    refused.status !== 200 && /no campaign is currently eligible/i.test(refused.error ?? ''),
    `${refused.status} ${refused.error ?? ''}`);
  check('ADMIN: and nothing was written for it',
    Number(sql(`select count(*) from referralRewards where referralId=${orphanReferral}`)) === 0
    && sql(`select status from referrals where id=${orphanReferral}`) === 'registered');


  // ── REVERSAL TAKES THE REWARD BACK, NOT JUST THE WORD ──────────────────
  //
  // `admin.reverseReferralReward` set `status: 'REVERSED'` on the ledger row
  // and stopped. The entitlement stayed granted, the Spotlight kept running,
  // the subscription kept its extra days - so the ledger an administrator
  // quotes back to a vendor disagreed with what the vendor actually had. Every
  // assertion here reads the EFFECT, through the same surfaces a real user
  // does, not the ledger word.
  if (stackRewardId > 0) {
    const beforeReversal = (await sixth.session.query('billing.myEntitlements', undefined))
      .data?.qualifiedEnquiryAllowance;

    const reversed = await admin.mutate('admin.reverseReferralReward', {
      rewardId: stackRewardId, reason: 'ZG reversal: fraudulent signup',
    });
    check('REVERSAL: the administrator\'s reversal is accepted and says what it undid',
      reversed.status === 200 && reversed.data?.changed === true && reversed.data?.effect === 'bonus_revoked',
      `${reversed.status} ${JSON.stringify(reversed.data ?? reversed.error)}`);

    const afterReversal = (await sixth.session.query('billing.myEntitlements', undefined))
      .data?.qualifiedEnquiryAllowance;
    check('REVERSAL: THE EFFECT is gone - the inviter\'s real allowance drops by the reward',
      afterReversal === beforeReversal - 6, `${beforeReversal} -> ${afterReversal}, expected -6`);

    // SURGICAL. The vendor also holds an administrator's absolute grant of 40
    // and a second, unrelated bonus of 3. Reversing a referral must remove ONE
    // ROW - the one this reward created - and leave both of those standing.
    check('REVERSAL: it revoked exactly the row this reward created',
      sql(`select revokedAt is not null from vendorEntitlementOverrides where id=${stackBonusOverrideId}`) === '1');
    check('REVERSAL: and stamped WHO withdrew it',
      Number(sql(`select ifnull(revokedBy,0) from vendorEntitlementOverrides where id=${stackBonusOverrideId}`)) === 1,
      sql(`select ifnull(revokedBy,'NULL') from vendorEntitlementOverrides where id=${stackBonusOverrideId}`));
    check('REVERSAL: the ADMINISTRATOR\'s unrelated absolute grant is untouched',
      sql(`select revokedAt is null from vendorEntitlementOverrides where id=${adminOverrideId}`) === '1');
    check('REVERSAL: and the OTHER bonus, which this reward did not create, still stands',
      afterReversal === 43, `admin 40 + surviving bonus 3 = 43, got ${afterReversal}`);

    check('REVERSAL: the ledger row now reads REVERSED, with the reason and the time',
      sql(`select concat(status,'|',reversedAt is not null,'|',ifnull(reversalReason,''))
           from referralRewards where id=${stackRewardId}`)
        === 'REVERSED|1|ZG reversal: fraudulent signup',
      sql(`select concat(status,'|',ifnull(reversalReason,'')) from referralRewards where id=${stackRewardId}`));
    check('REVERSAL: the referral stays QUALIFIED - it did qualify; the reward is what was withdrawn',
      sql(`select status from referrals where id=${sql(`select referralId from referralRewards where id=${stackRewardId}`)}`)
        === 'qualified');
    check('REVERSAL: it is audited against the vendor who lost the benefit',
      Number(sql(`select count(*) from userAccountAuditEvents
                  where userId=${stackInviterId} and action='referral_reward_reversed'`)) === 1);
    check('REVERSAL: and the vendor is TOLD, in a message a client can translate',
      sql(`select ifnull(messageKey,'') from notifications
           where userId=${stackInviterId} and type='referral' order by id desc limit 1`)
        === 'notif.referral.reversed.bonus_revoked',
      sql(`select ifnull(messageKey,'none') from notifications where userId=${stackInviterId} order by id desc limit 1`));

    // IDEMPOTENT. Pressing reverse twice must not revoke a second row, and
    // must not tell the vendor twice.
    const noticesAfterOne = Number(sql(`select count(*) from notifications
                                        where userId=${stackInviterId} and type='referral'`));
    const again = await admin.mutate('admin.reverseReferralReward', {
      rewardId: stackRewardId, reason: 'ZG reversal: pressed twice',
    });
    check('REVERSAL: pressing it again changes nothing and says so',
      again.status === 200 && again.data?.changed === false, JSON.stringify(again.data ?? again.error));
    check('REVERSAL: the second press did not re-notify the vendor',
      Number(sql(`select count(*) from notifications where userId=${stackInviterId} and type='referral'`))
        === noticesAfterOne);
    check('REVERSAL: nor overwrite the reason the FIRST reversal recorded',
      sql(`select reversalReason from referralRewards where id=${stackRewardId}`) === 'ZG reversal: fraudulent signup');
    check('REVERSAL: and the surviving allowance is unchanged by the second press',
      (await sixth.session.query('billing.myEntitlements', undefined)).data?.qualifiedEnquiryAllowance === 43);
  } else {
    check('REVERSAL: the stacking reward this section reverses was not created', false);
  }

  // ── A TAMPERED EFFECT REFERENCE CANNOT REACH ANOTHER ACCOUNT ───────────
  //
  // `effectRef` is a string in a column. If reversal followed it blindly, a
  // wrong or altered value would be a way to revoke an UNRELATED vendor's
  // entitlement - one an administrator granted for their own reasons - from a
  // referral screen. The reversal must refuse and write nothing.
  if (adminOverrideId > 0) {
    const manualRewardId = Number(sql(`select id from referralRewards where referralId=${manualReferral}`));
    const honestRef = sql(`select ifnull(effectRef,'') from referralRewards where id=${manualRewardId}`);
    sql(`update referralRewards set effectRef='OVERRIDE:${adminOverrideId}' where id=${manualRewardId}`);

    const tampered = await admin.mutate('admin.reverseReferralReward', {
      rewardId: manualRewardId, reason: 'ZG tampered effectRef',
    });
    check('TAMPER: a reference pointing at another account\'s row is REFUSED',
      tampered.status !== 200 && /different account/i.test(tampered.error ?? ''),
      `${tampered.status} ${tampered.error ?? ''}`);
    check('TAMPER: the other vendor\'s entitlement is still live',
      sql(`select revokedAt is null from vendorEntitlementOverrides where id=${adminOverrideId}`) === '1');
    check('TAMPER: and the ledger was NOT marked reversed over a refusal',
      sql(`select status from referralRewards where id=${manualRewardId}`) === 'GRANTED',
      sql(`select status from referralRewards where id=${manualRewardId}`));
    check('TAMPER: nothing was audited for an action that did not happen',
      Number(sql(`select count(*) from userAccountAuditEvents
                  where userId=${eventInviter.id} and action='referral_reward_reversed'`)) === 0);

    sql(`update referralRewards set effectRef=${honestRef ? `'${honestRef}'` : 'NULL'} where id=${manualRewardId}`);
  } else {
    check('TAMPER: no second-account override existed to attempt this with', false);
  }

  // ── REVERSING A PLACEMENT TAKES IT OFF THE PUBLIC SURFACE ──────────────
  if (placementStatus === 'GRANTED') {
    const placementRewardId = Number(sql(`select id from referralRewards where referralId=${fifthReferral}`));
    /*
     * READ THE SURFACE A VISITOR READS.
     *
     * An earlier version of this section asked `marketplace.spotlightProviders`
     * and would have reported an empty list as a reversal success - it returns
     * [] for the GLOBAL scope BY DESIGN, so it could never have shown this
     * placement before OR after. That is how the booking's real defect was
     * found: TYPE_CATEGORY_SPOTLIGHT + GLOBAL is a combination no reader
     * queries, so the reward was granted, recorded and notified while being
     * visible nowhere. It is now a root-scope BOOST, and the unfiltered vendor
     * directory is where that renders.
     */
    const directory = async () => (await session().query('marketplace.vendors', {})).data ?? [];
    const listedBefore = await directory();
    const boostedRow = listedBefore.find(row => Number(row.id) === inviter.id);
    check('SETUP: the referral placement is genuinely visible on the public directory first',
      Boolean(boostedRow) && boostedRow.boosted === true,
      `${listedBefore.length} row(s), boosted=${boostedRow?.boosted ?? 'not listed'}`);
    check('SETUP: and it is labelled FEATURED, never Sponsored - no money bought it',
      boostedRow?.label === 'FEATURED', String(boostedRow?.label));

    const off = await admin.mutate('admin.reverseReferralReward', {
      rewardId: placementRewardId, reason: 'ZG reversal: placement',
    });
    check('REVERSAL: a placement reward reports that the placement was revoked',
      off.status === 200 && off.data?.effect === 'placement_revoked',
      `${off.status} ${JSON.stringify(off.data ?? off.error)}`);
    check('REVERSAL: the sponsorship row carries a revocation, not a deletion',
      sql(`select count(*) from vendorSponsorships
           where vendorId=${inviter.id} and source='REFERRAL_REWARD' and revokedAt is not null`) === '1');

    const listedAfter = await directory();
    const afterRow = listedAfter.find(row => Number(row.id) === inviter.id);
    check('REVERSAL: THE EFFECT is gone - the vendor carries no placement any more',
      afterRow === undefined || !afterRow.boosted,
      `boosted=${afterRow?.boosted ?? 'not listed'} label=${afterRow?.label ?? 'none'}`);
    check('REVERSAL: and the vendor was not deleted from the directory, only un-placed',
      listedAfter.length === listedBefore.length, `${listedBefore.length} -> ${listedAfter.length}`);
  }

  // ── REVERSING SUBSCRIPTION TIME DOES NOT CONFISCATE IT ─────────────────
  //
  // The owner's decision: "Never shorten current/paid/manually granted
  // subscription period." Days on a period cannot be attributed to one grant -
  // the vendor may have renewed since - so reversal records the withdrawal and
  // says the time stands, rather than taking back days that were not its own.
  {
    const extRewardId = Number(sql(`select id from referralRewards where referralId=${extendedReferral}`));
    const periodBefore = sql(`select currentPeriodEnd from vendorSubscriptions where userId=${extInviter.id}`);
    const undo = await admin.mutate('admin.reverseReferralReward', {
      rewardId: extRewardId, reason: 'ZG reversal: extension',
    });
    check('REVERSAL: an extension reversal succeeds and reports that nothing was taken back',
      undo.status === 200 && undo.data?.changed === true && undo.data?.effect === 'nothing_to_undo',
      `${undo.status} ${JSON.stringify(undo.data ?? undo.error)}`);
    check('REVERSAL: and it says WHY, rather than leaving the administrator to guess',
      /does not shorten a period/i.test(String(undo.data?.detail ?? '')), String(undo.data?.detail ?? ''));
    check('REVERSAL: the subscription period is EXACTLY where it was - no time confiscated',
      sql(`select currentPeriodEnd from vendorSubscriptions where userId=${extInviter.id}`) === periodBefore,
      `${periodBefore} -> ${sql(`select currentPeriodEnd from vendorSubscriptions where userId=${extInviter.id}`)}`);
    check('REVERSAL: the ledger still records the withdrawal truthfully',
      sql(`select status from referralRewards where id=${extRewardId}`) === 'REVERSED');
  }

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
  /*
   * CLEANUP, IN DEPENDENCY ORDER, AND STATEMENT BY STATEMENT.
   *
   * Two things went wrong before this shape. The list did not keep up with the
   * tables each new section touched - registrationReviewEvents and rfqs among
   * them - and every FK in this schema is RESTRICT, so ONE blocked delete
   * aborted the whole block and left everything after it behind. The next run
   * then inherited campaigns that won its tie-break, and reported a correct
   * resolution as a determinism failure.
   *
   * Each statement now runs on its own and reports rather than throws; the
   * final checks below are what decide whether the cleanup actually worked.
   */
  const ids = made.users.join(',');
  const failures = [];
  const attempt = (statement) => {
    try { sql(statement); } catch (error) { failures.push(String(error.message).split('\n').pop()); }
  };
  if (made.users.length > 0) {
    // Children first, parents last.
    attempt(`delete from referralRewards where referralId in (select id from referrals where referrerId in (${ids}) or referredId in (${ids}))`);
    attempt(`delete from referralRewards where recipientUserId in (${ids})`);
    attempt(`delete from referrals where referrerId in (${ids}) or referredId in (${ids})`);
    attempt(`delete from vendorEntitlementOverrides where userId in (${ids})`);
    attempt(`delete from vendorSponsorships where vendorId in (${ids})`);
    attempt(`delete from billingEvents where userId in (${ids})`);
    attempt(`delete from vendorSubscriptions where userId in (${ids})`);
    attempt(`delete from quotations where providerId in (${ids})`);
    attempt(`delete from rfqItems where rfqId in (select id from rfqs where requesterId in (${ids}))`);
    attempt(`delete from rfqs where requesterId in (${ids})`);
    attempt(`delete from products where supplierId in (${ids})`);
    attempt(`delete from registrationReviewEvents where userId in (${ids}) or actorId in (${ids})`);
    attempt(`delete from analyticsEvents where userId in (${ids})`);
    attempt(`delete from notifications where userId in (${ids})`);
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
  Number(sql(`select count(*) from users where id in (${made.users.join(',')})`)) === 0
  && Number(sql(`select count(*) from referralCampaigns where name like 'ZG %${stamp}'`)) === 0);

console.log(results.join('\n'));
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
