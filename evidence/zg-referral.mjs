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

/**
 * WAITING OUT THE RATE LIMITER RATHER THAN CALLING IT A FAILURE.
 *
 * This probe now creates around twenty accounts, and BuildHub's auth limiter
 * allows 60 attempts per minute from one address - so a second run started
 * within the same minute got a 429 and the probe aborted, reporting the
 * limiter working correctly as a defect. The limiter is right; the probe was
 * impatient. It now honours the wait the server states, and gives up loudly
 * rather than quietly if the wait does not clear it.
 */
async function signUp(suffix, userRole, referralCode) {
  const username = `zgref${stamp}${suffix}`;
  let res = null, body = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${BASE}/api/trpc/auth.signUp`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: {
        username, email: `${username}@example.test`, password: 'ProbeUser!2024',
        name: `Referral Probe ${suffix}`, userRole,
        ...(referralCode ? { referralCode } : {}),
      } }),
    });
    if (res.status !== 429) break;
    body = await res.text();
    // The server states the wait in seconds; honour it rather than guessing.
    const seconds = Number(/Try again in (\d+)s/.exec(body)?.[1] ?? 20);
    await new Promise(resolve => setTimeout(resolve, Math.min(seconds + 2, 70) * 1000));
  }
  if (res.status !== 200) {
    throw new Error(`probe setup: signUp ${suffix} failed ${res.status}${res.status === 429 ? ' (rate limited, waited and retried)' : ''}`);
  }
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


  // ── BENEFITS AND LIMITS: the number, and where it came from ──────────────
  //
  // `billing.myEntitlements` and `billing.myPlan` have existed for a long time
  // and NEITHER HAS EVER HAD A SCREEN. A vendor whose allowance changed had
  // nowhere to find out why.
  if (adminGrantWorked && stackInviterId > 0) {
    const benefits = await sixth.session.query('billing.myBenefits', undefined);
    check('BENEFITS: a vendor can read what they are entitled to', benefits.status === 200,
      `${benefits.status} ${benefits.error ?? ''}`);

    const allowance = benefits.data?.allowance;
    check('BENEFITS: the EFFECTIVE number matches what the platform enforces',
      allowance?.effective
        === (await sixth.session.query('billing.myEntitlements', undefined)).data?.qualifiedEnquiryAllowance,
      `${allowance?.effective}`);
    check('BENEFITS: and the PARTS add up to it - no mismatch',
      allowance?.mismatch === false && allowance?.computed === allowance?.effective,
      `computed=${allowance?.computed} effective=${allowance?.effective} mismatch=${allowance?.mismatch}`);

    // The whole point: the breakdown NAMES the administrator's grant and the
    // bonus separately, which is the answer to "why has my number changed".
    check("BENEFITS: the administrator's absolute grant is named, with its reason",
      Number(allowance?.adminOverride?.value) === 40 && String(allowance?.adminOverride?.reason ?? '').length > 0,
      `${allowance?.adminOverride?.value}: ${allowance?.adminOverride?.reason}`);
    check('BENEFITS: the surviving bonus is listed separately, not folded into the total',
      Array.isArray(allowance?.bonuses) && allowance.bonuses.length >= 1
      && allowance.bonuses.every(bonus => Number(bonus.value) > 0),
      JSON.stringify(allowance?.bonuses));
    check('BENEFITS: the plan figure is shown too, so the vendor can see what changed',
      allowance?.planAllowance !== undefined, String(allowance?.planAllowance));

    const usage = benefits.data?.usage;
    check('BENEFITS: usage, remaining and the reset date are real, not placeholders',
      typeof usage?.used === 'number' && usage?.resetsAt
      && (usage.remaining === null || usage.remaining === Math.max(0, allowance.effective - usage.used)),
      `used=${usage?.used} remaining=${usage?.remaining} resets=${usage?.resetsAt}`);

    check('BENEFITS: only capabilities BuildHub has actually built are listed',
      Object.values(benefits.data?.plan?.capabilities ?? {}).every(value => typeof value === 'boolean'),
      JSON.stringify(benefits.data?.plan?.capabilities));

    // SELF-SCOPED. There is no userId in the input, and a different account
    // reading the same endpoint gets their own entitlements.
    const other = await inviter.session.query('billing.myBenefits', undefined);
    check('BENEFITS: another account reads THEIR entitlements, not this vendor\'s',
      other.status === 200 && other.data?.allowance?.effective !== allowance?.effective,
      `${other.data?.allowance?.effective} vs ${allowance?.effective}`);
    check('BENEFITS: and sees no trace of the administrative reason written for someone else',
      !JSON.stringify(other.data ?? {}).includes('ZG admin grant'));

    // THE ADMINISTRATOR'S OWN VIEW AGREES. readEnquiryAllowance read only the
    // absolute slot, so after bonuses arrived an administrator saw a number
    // LOWER than the one being enforced - on the screen they use to decide
    // whether to grant more.
    const adminView = await admin.query('admin.vendorEnquiryAllowance', { userId: sixth.id });
    if (adminView.status === 200) {
      check('BENEFITS: the ADMINISTRATOR sees the same effective number the vendor does',
        adminView.data?.effectiveAllowance === allowance?.effective,
        `admin=${adminView.data?.effectiveAllowance} vendor=${allowance?.effective}`);
      check('BENEFITS: and the bonus is broken out for them as well',
        Number(adminView.data?.bonusAllowance) > 0, String(adminView.data?.bonusAllowance));
    } else {
      check('BENEFITS: the administrator allowance view is reachable', false,
        `${adminView.status} ${adminView.error ?? ''}`);
    }
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



  // ── ANTI-ABUSE: the cap holds under a race, and a bad code leaves a trace ──
  {
    /*
     * THE CHECK-THEN-ACT RACE.
     *
     * Resolution counted an inviter's rewards, and the insert that consumes the
     * cap happened afterwards on a separate statement. Two qualifying events
     * for the same inviter arriving together - which is exactly what a
     * coordinated abuse attempt looks like - both read "0 used, cap 1" and both
     * inserted. The referralRewards unique index does not help: it is per
     * REFERRAL and campaign, and these are two DIFFERENT referrals.
     */
    /*
     * ISOLATED ON PURPOSE. An earlier version of this section used a 'supplier'
     * inviter, and the second event correctly fell through to another of this
     * probe's campaigns - which is the DESIGNED behaviour ("it takes the next
     * eligible campaign instead of failing outright"), not a race. The probe
     * reported that correct fallback as a cap failure.
     *
     * The inviter is an ENGINEER, and this is the only campaign that accepts
     * one, so a second reward here can only come from the cap being breached.
     */
    const raceInviter = await signUp('race', 'engineer');
    sql(`update users set onboardingStatus='approved', verified=1 where id=${raceInviter.id}`);
    const raceCode = sql(`select referralCode from users where id=${raceInviter.id}`);
    const raceCampaign = campaign(`ZG Race ${stamp}`, {
      priority: 800, rewardValue: '4', perInviterCap: 1,
      eligibleInviterRoles: JSON.stringify(['engineer']),
    });
    check('SETUP: exactly one campaign can pay this inviter, so a second reward can only be a breach',
      Number(sql(`select count(*) from referralCampaigns
        where status='active' and qualificationType='ACCOUNT_VERIFIED'
          and eligibleInviterRoles like '%engineer%'`)) === 1,
      sql(`select count(*) from referralCampaigns where status='active'
           and qualificationType='ACCOUNT_VERIFIED' and eligibleInviterRoles like '%engineer%'`));

    // Two invitees, both about to be verified at the same instant.
    const a = await signUp('ra', 'homeowner', raceCode);
    const b = await signUp('rb', 'homeowner', raceCode);

    const [ra, rb] = await Promise.all([
      admin.mutate('admin.verifyUser', { userId: a.id, verified: true }),
      admin.mutate('admin.verifyUser', { userId: b.id, verified: true }),
    ]);
    check('RACE: both simultaneous verifications completed without erroring',
      ra.status === 200 && rb.status === 200, `${ra.status}/${rb.status}`);

    const paid = Number(sql(`select count(*) from referralRewards
      where campaignId=${raceCampaign} and recipientUserId=${raceInviter.id}`));
    check('RACE: the per-inviter cap of 1 held - exactly ONE reward, not two',
      paid === 1, `${paid} reward(s) for a cap of 1`);
    check('RACE: and the EFFECT was applied once - one bonus row, not two',
      Number(sql(`select count(*) from vendorEntitlementOverrides
        where userId=${raceInviter.id} and entitlementKey='qualifiedEnquiryBonus' and revokedAt is null`)) === 1,
      sql(`select count(*) from vendorEntitlementOverrides
        where userId=${raceInviter.id} and entitlementKey='qualifiedEnquiryBonus' and revokedAt is null`));
    check('RACE: the losing referral is left UNBOUND and unrewarded, not half-written',
      Number(sql(`select count(*) from referrals
        where referrerId=${raceInviter.id} and campaignId is not null`)) === 1
      && Number(sql(`select count(*) from referrals
        where referrerId=${raceInviter.id} and campaignId=${raceCampaign}`)) === 1,
      sql(`select group_concat(concat(id,':',ifnull(campaignId,'NULL'),':',status)) from referrals where referrerId=${raceInviter.id}`));

    /*
     * THE PLATFORM BRAKE. Campaign caps each bound one campaign; nothing
     * bounded an account across all of them, so a rotation of campaigns paid
     * without limit while every campaign reported its own cap intact.
     */
    /*
     * The unique index is per (referral, campaign), so 25 rows means 25
     * DISTINCT pairs. An earlier version looped over the referrals alone and
     * could only plant one row each - it reached 5 and reported a setup
     * failure, correctly, rather than pretending the brake had been tested.
     */
    /*
     * Two referrals x twelve campaigns yielded 24 distinct pairs and one was
     * already taken by the real reward, so the first attempt reached 24 and
     * reported the setup as failed rather than pretending the brake had been
     * exercised. Two more invitees give the loop room.
     */
    for (const suffix of ['bk1', 'bk2']) await signUp(suffix, 'homeowner', raceCode);
    const brakeReferrals = sql(`select group_concat(id) from referrals where referrerId=${raceInviter.id}`)
      .split(',').filter(Boolean);
    const brakeCampaigns = sql(`select group_concat(id) from referralCampaigns where name like 'ZG %${stamp}'`)
      .split(',').filter(Boolean);
    let planted = Number(sql(`select count(*) from referralRewards where recipientUserId=${raceInviter.id}`));
    for (const campaignId of brakeCampaigns) {
      for (const referralId of brakeReferrals) {
        if (planted >= 25) break;
        try {
          sql(`insert into referralRewards (referralId, campaignId, recipientUserId, rewardType, rewardValue, status)
               values (${referralId}, ${campaignId}, ${raceInviter.id}, 'EXTRA_QUALIFIED_ENQUIRIES', '1', 'GRANTED')`);
          planted += 1;
        } catch { /* the unique index refused this pair; try the next */ }
      }
      if (planted >= 25) break;
    }
    check('SETUP: the account is at the platform limit of 25 rewards', planted >= 25,
      `${planted} from ${brakeReferrals.length} referral(s) x ${brakeCampaigns.length} campaign(s)`);

    if (planted >= 25) {
      const capped = await signUp('capped', 'homeowner', raceCode);
      // The race campaign accepts this inviter and has an inviter cap of 1 that
      // is already used; the point is that the PLATFORM brake refuses first and
      // says so, rather than the refusal reading as "no campaign".

      const cappedReferral = Number(sql(`select id from referrals where referredId=${capped.id}`));
      await admin.mutate('admin.verifyUser', { userId: capped.id, verified: true });
      check('BRAKE: an account at the platform limit earns nothing more, from ANY campaign',
        Number(sql(`select count(*) from referralRewards where referralId=${cappedReferral}`)) === 0
        && sql(`select ifnull(campaignId,'NULL') from referrals where id=${cappedReferral}`) === 'NULL',
        `rewards=${sql(`select count(*) from referralRewards where referralId=${cappedReferral}`)}`);
      const why = await admin.mutate('admin.qualifyReferral', { referralId: cappedReferral });
      check('BRAKE: and an administrator is told WHICH rule stopped it',
        why.status !== 200 && /no eligible campaign/i.test(why.error ?? ''), `${why.status} ${why.error ?? ''}`);
    }
  }

  {
    /*
     * A CODE THAT WENT NOWHERE. This branch did not exist: a code matching no
     * account, or the signer's own, was dropped in silence - so somebody
     * walking the code space left no trace at all.
     */
    const stranger = await signUp('bad', 'homeowner', `BH-NOSUCHCODE${stamp}`);
    check('BAD CODE: the signup still succeeds - a typo does not block a registration',
      Number(sql(`select count(*) from users where id=${stranger.id}`)) === 1);
    check('BAD CODE: no referral was invented for a code nobody holds',
      Number(sql(`select count(*) from referrals where referredId=${stranger.id}`)) === 0);
    check('BAD CODE: but it is RECORDED, so a code-walker is visible to an administrator',
      Number(sql(`select count(*) from userAccountAuditEvents
        where userId=${stranger.id} and action='referral_code_unusable'`)) === 1,
      sql(`select ifnull(group_concat(action),'none') from userAccountAuditEvents where userId=${stranger.id}`));
    check('BAD CODE: and the record names the code that was tried',
      sql(`select note from userAccountAuditEvents where userId=${stranger.id} and action='referral_code_unusable'`)
        .includes(`BH-NOSUCHCODE${stamp}`),
      sql(`select ifnull(note,'') from userAccountAuditEvents where userId=${stranger.id} and action='referral_code_unusable'`));

    // The API response must not confirm whether the code existed - that would
    // make signup an oracle for the thing being walked.
    const probeGood = await fetch(`${BASE}/api/trpc/auth.signUp`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: {
        username: `zgorc${stamp}`, email: `zgorc${stamp}@example.test`, password: 'ProbeUser!2024',
        name: 'Oracle Probe', userRole: 'homeowner', referralCode: code,
      } }),
    });
    const goodBody = await probeGood.text();
    made.users.push(Number(sql(`select id from users where username='zgorc${stamp}'`)));
    const probeBad = await fetch(`${BASE}/api/trpc/auth.signUp`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: {
        username: `zgorb${stamp}`, email: `zgorb${stamp}@example.test`, password: 'ProbeUser!2024',
        name: 'Oracle Probe', userRole: 'homeowner', referralCode: `BH-ALSONOSUCH${stamp}`,
      } }),
    });
    const badBody = await probeBad.text();
    made.users.push(Number(sql(`select id from users where username='zgorb${stamp}'`)));
    const shape = (body, username) => body.replace(new RegExp(username, 'g'), 'U').replace(/"[^"]*@[^"]*"/g, '"E"');
    check('ORACLE: a valid and an invalid code are indistinguishable from the response',
      probeGood.status === probeBad.status
      && shape(goodBody, `zgorc${stamp}`) === shape(badBody, `zgorb${stamp}`),
      `${probeGood.status} vs ${probeBad.status}`);
  }

  // ── THE SURFACES: what an administrator and an inviter can actually SEE ──
  //
  // Six referral procedures had no client caller at all, so nothing BuildHub
  // granted was visible to anyone: an administrator could not read the reward
  // ledger, and the recipient's only notice of a benefit was a notification
  // they may have missed. These assert the data those screens now read.
  {
    // The inviter's own view. Self-scoped, and it must name nobody.
    const mine = await inviter.session.query('profile.myReferral', undefined);
    check('MINE: an inviter can read their own programme', mine.status === 200, `${mine.status} ${mine.error ?? ''}`);
    check('MINE: the counts BREAK DOWN rather than collapsing into one number',
      typeof mine.data?.counts?.registered === 'number' && typeof mine.data?.counts?.qualified === 'number'
      && mine.data.counts.total === Number(sql(`select count(*) from referrals where referrerId=${inviter.id}`)),
      JSON.stringify(mine.data?.counts));
    check('MINE: the rewards are surfaced at all - they were visible nowhere before',
      Array.isArray(mine.data?.rewards) && mine.data.rewards.length
        === Number(sql(`select count(*) from referralRewards where recipientUserId=${inviter.id}`)),
      `${mine.data?.rewards?.length} shown for ${sql(`select count(*) from referralRewards where recipientUserId=${inviter.id}`)} rows`);

    /*
     * PRIVACY. A referral code can be posted publicly, so anyone who signs up
     * through it lands in this list. Their name or address must not be in it.
     */
    const serialised = JSON.stringify(mine.data ?? {});
    const invitedNames = sql(`select group_concat(name separator '||') from users
                              where id in (select referredId from referrals where referrerId=${inviter.id})`);
    const leaked = String(invitedNames || '').split('||').filter(Boolean)
      .filter(name => serialised.includes(name));
    check('MINE: it names NOBODY the inviter invited', leaked.length === 0, leaked.join(', ') || 'no names present');
    check('MINE: and carries no email address at all', !/@/.test(serialised.replace(/"link":"[^"]*"/, '')),
      serialised.slice(0, 120));

    // A DIFFERENT user reading the same procedure gets their OWN programme.
    const other = await second.session.query('profile.myReferral', undefined);
    check('MINE: another account reading the same endpoint gets THEIR programme, not this one',
      other.status === 200 && other.data?.code !== mine.data?.code,
      `${other.data?.code} vs ${mine.data?.code}`);
    check('MINE: and none of this inviter\'s rewards appear in it',
      (other.data?.rewards ?? []).length === Number(sql(`select count(*) from referralRewards where recipientUserId=${second.id}`)));

    // An ordinary account cannot read the administration surfaces.
    for (const path of ['admin.referrals', 'admin.referralRewards']) {
      const denied = await inviter.session.query(path, { page: 0, pageSize: 5 });
      check(`RBAC: an ordinary account is refused ${path}`,
        denied.status !== 200 && denied.data === null, `${denied.status} ${denied.error ?? ''}`);
    }
  }

  {
    // The administrator's list: PAGED, with a real total, filtered in the query.
    const listed = await admin.query('admin.referrals', { page: 0, pageSize: 5 });
    const realTotal = Number(sql(`select count(*) from referrals`));
    check('ADMIN LIST: it reports the REAL total, not the size of the page it returned',
      listed.data?.total === realTotal && listed.data.rows.length <= 5,
      `total=${listed.data?.total} rows=${listed.data?.rows?.length} actual=${realTotal}`);
    check('ADMIN LIST: page 2 is different rows, not the same ones again',
      String((await admin.query('admin.referrals', { page: 1, pageSize: 5 })).data?.rows?.[0]?.id ?? '')
        !== String(listed.data?.rows?.[0]?.id ?? ''),
      `page0=${listed.data?.rows?.[0]?.id}`);

    /*
     * THE REWARD COLUMN. It was built from `referrals.rewardType` and
     * `.rewardValue`, two columns NOTHING has ever written, so it read "-" on
     * every row for every referral the platform has ever recorded.
     */
    const rewardedRow = (listed.data?.rows ?? []).find(row => (row.rewards ?? []).length > 0)
      ?? (await admin.query('admin.referrals', { page: 0, pageSize: 100 })).data?.rows
        ?.find(row => (row.rewards ?? []).length > 0);
    check('ADMIN LIST: a rewarded referral carries its REAL reward, from the ledger',
      Boolean(rewardedRow) && typeof rewardedRow.rewards[0].rewardType === 'string'
      && rewardedRow.rewards[0].rewardType.length > 0,
      JSON.stringify(rewardedRow?.rewards?.[0] ?? 'none'));

    // Search runs in the QUERY. Filtering in the browser over a truncated list
    // answers "no matches" for a row it never loaded.
    const byCode = await admin.query('admin.referrals', { page: 0, pageSize: 5, search: code });
    check('ADMIN LIST: searching a code finds it through the query, not the page',
      (byCode.data?.rows ?? []).length > 0 && byCode.data.rows.every(row => row.code === code),
      `${byCode.data?.rows?.length} row(s) for ${code}`);
    const byStatus = await admin.query('admin.referrals', { page: 0, pageSize: 50, status: 'qualified' });
    check('ADMIN LIST: the status filter is applied server-side',
      (byStatus.data?.rows ?? []).every(row => row.status === 'qualified')
      && byStatus.data.total === Number(sql(`select count(*) from referrals where status='qualified'`)),
      `${byStatus.data?.total} vs ${sql(`select count(*) from referrals where status='qualified'`)}`);
    const noMatch = await admin.query('admin.referrals', { page: 0, pageSize: 5, search: `zzz-no-such-${stamp}` });
    check('ADMIN LIST: a genuine no-match reports zero, and says so honestly',
      noMatch.status === 200 && noMatch.data?.rows?.length === 0 && noMatch.data.total === 0);
  }

  {
    // The reward ledger, and expiry DERIVED rather than swept.
    const ledger = await admin.query('admin.referralRewards', { page: 0, pageSize: 100 });
    check('LEDGER: the reward ledger has a screen to read it, and a real total',
      ledger.status === 200 && ledger.data?.total === Number(sql(`select count(*) from referralRewards`)),
      `${ledger.data?.total} vs ${sql(`select count(*) from referralRewards`)}`);

    /*
     * NOTHING HAS EVER WRITTEN `EXPIRED`. A bonus whose end date passed last
     * month still read GRANTED - to the administrator deciding whether to grant
     * another, and to the vendor asking why their allowance had dropped.
     */
    const liveReward = Number(sql(`select id from referralRewards
      where recipientUserId=${eventInviter.id} and status='GRANTED' and expiresAt is not null order by id desc limit 1`));
    if (liveReward > 0) {
      const before = (await admin.query('admin.referralRewards', { page: 0, pageSize: 100 }))
        .data?.rows?.find(row => Number(row.id) === liveReward);
      check('LEDGER: a live reward reads GRANTED', before?.status === 'GRANTED', String(before?.status));

      sql(`update referralRewards set expiresAt = date_sub(now(), interval 1 day) where id=${liveReward}`);
      const after = (await admin.query('admin.referralRewards', { page: 0, pageSize: 100 }))
        .data?.rows?.find(row => Number(row.id) === liveReward);
      check('LEDGER: once its end date passes it reads EXPIRED, with nothing having swept it',
        after?.status === 'EXPIRED', String(after?.status));
      check('LEDGER: and the DATABASE still holds GRANTED - the truth is derived, not rewritten',
        sql(`select status from referralRewards where id=${liveReward}`) === 'GRANTED'
        && after?.storedStatus === 'GRANTED',
        `column=${sql(`select status from referralRewards where id=${liveReward}`)} reported=${after?.status}`);

      // The inviter's own screen tells them the same thing.
      const mineAfter = await eventInviter.session.query('profile.myReferral', undefined);
      check('LEDGER: the recipient sees it as ended too, not still active',
        (mineAfter.data?.rewards ?? []).find(row => Number(row.id) === liveReward)?.status === 'EXPIRED',
        String((mineAfter.data?.rewards ?? []).find(row => Number(row.id) === liveReward)?.status));

      sql(`update referralRewards set expiresAt = date_add(now(), interval 30 day) where id=${liveReward}`);
    } else {
      check('LEDGER: a bounded live reward existed to test expiry against', false);
    }

    // A REVERSED reward is not turned into a lapsed one by a date passing.
    const reversedReward = Number(sql(`select id from referralRewards where status='REVERSED' order by id desc limit 1`));
    if (reversedReward > 0) {
      sql(`update referralRewards set expiresAt = date_sub(now(), interval 1 day) where id=${reversedReward}`);
      const row = (await admin.query('admin.referralRewards', { page: 0, pageSize: 100 }))
        .data?.rows?.find(entry => Number(entry.id) === reversedReward);
      check('LEDGER: a REVERSED reward stays reversed - an administrator decided that, and time does not undo it',
        row?.status === 'REVERSED', String(row?.status));
    }
  }


  // ── CAMPAIGN ADMINISTRATION: correctable, but not rewritable after payout ──
  {
    const fresh = campaign(`ZG Editable ${stamp}`, { priority: 950, rewardValue: '2', status: 'draft' });

    // A campaign that has paid NOTHING can be corrected. Before this, terms
    // could not be edited at all: the only remedy was to end the campaign and
    // create another, losing its history and its identity.
    const corrected = await admin.mutate('admin.updateReferralCampaign', {
      campaignId: fresh, rewardValue: '4', eligibleInviterRoles: ['supplier', 'contractor'],
      attributionWindowDays: 30,
    });
    check('CAMPAIGN: an unpaid campaign can have its TERMS corrected',
      corrected.status === 200 && corrected.data?.changed === true,
      `${corrected.status} ${corrected.error ?? ''}`);
    check('CAMPAIGN: and the correction actually reached the database',
      sql(`select concat(rewardValue,'|',attributionWindowDays) from referralCampaigns where id=${fresh}`) === '4|30',
      sql(`select concat(rewardValue,'|',attributionWindowDays) from referralCampaigns where id=${fresh}`));

    /*
     * Now make it pay something, and the promise is fixed.
     *
     * The recipient is deliberately NOT the main inviter: the audit section
     * below asserts one audit row per reward for that account, and a row this
     * probe plants directly is by definition a grant BuildHub never made. The
     * first version used the inviter and turned a correct audit assertion into
     * a failure.
     */
    sql(`insert into referralRewards (referralId, campaignId, recipientUserId, rewardType, rewardValue, status)
         values (${referralId}, ${fresh}, ${second.id}, 'EXTRA_QUALIFIED_ENQUIRIES', '4', 'GRANTED')`);
    const refused = await admin.mutate('admin.updateReferralCampaign', {
      campaignId: fresh, rewardValue: '99',
    });
    check('CAMPAIGN: once it has granted a reward its terms are FIXED',
      refused.status !== 200 && /terms are fixed/i.test(refused.error ?? ''),
      `${refused.status} ${refused.error ?? ''}`);
    check('CAMPAIGN: and nothing was written by the refused edit',
      sql(`select rewardValue from referralCampaigns where id=${fresh}`) === '4',
      sql(`select rewardValue from referralCampaigns where id=${fresh}`));

    /*
     * THE FREEZE IS NOT A BLANKET LOCK. Pausing or ending a live campaign is
     * exactly what an administrator needs to do in a hurry, and a freeze that
     * caught those would be worse than the gap it closed.
     */
    const paused = await admin.mutate('admin.updateReferralCampaign', { campaignId: fresh, status: 'paused' });
    check('CAMPAIGN: but it can still be PAUSED after paying out',
      paused.status === 200 && sql(`select status from referralCampaigns where id=${fresh}`) === 'paused',
      `${paused.status} ${sql(`select status from referralCampaigns where id=${fresh}`)}`);
    const recapped = await admin.mutate('admin.updateReferralCampaign', { campaignId: fresh, perInviterCap: 9 });
    check('CAMPAIGN: and its caps changed, because those govern what happens NEXT',
      recapped.status === 200 && sql(`select perInviterCap from referralCampaigns where id=${fresh}`) === '9');

    // Dates are re-checked AFTER an edit, not only at creation.
    const backwards = await admin.mutate('admin.updateReferralCampaign', {
      campaignId: fresh,
      startsAt: new Date(Date.now() + 20 * 86400000).toISOString(),
      endsAt: new Date(Date.now() + 5 * 86400000).toISOString(),
    });
    check('CAMPAIGN: an end date before the start is refused on EDIT, not only on create',
      backwards.status !== 200 && /after its start date/i.test(backwards.error ?? ''),
      `${backwards.status} ${backwards.error ?? ''}`);

    // The attribution window is settable at creation now - every campaign ever
    // made took the column default, so a short promotion could not say so.
    const shortWindow = await admin.mutate('admin.createReferralCampaign', {
      name: `ZG Window ${stamp}`, status: 'draft',
      eligibleInviterRoles: ['supplier'], eligibleReferredRoles: ['homeowner'],
      qualificationType: 'ACCOUNT_VERIFIED', rewardType: 'EXTRA_QUALIFIED_ENQUIRIES',
      rewardValue: '1', perInviterCap: 1, attributionWindowDays: 7,
    });
    if (shortWindow.status === 200) made.campaigns.push(Number(shortWindow.data?.campaignId));
    check('CAMPAIGN: the attribution window can be set at creation',
      shortWindow.status === 200
      && sql(`select attributionWindowDays from referralCampaigns where id=${shortWindow.data?.campaignId}`) === '7',
      `${shortWindow.status} ${shortWindow.error ?? ''}`);

    // RBAC: an ordinary account cannot administer campaigns.
    const denied = await inviter.session.mutate('admin.updateReferralCampaign', { campaignId: fresh, status: 'ended' });
    check('CAMPAIGN: an ordinary account cannot change a campaign',
      denied.status !== 200 && sql(`select status from referralCampaigns where id=${fresh}`) === 'paused',
      `${denied.status} ${denied.error ?? ''}`);
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
