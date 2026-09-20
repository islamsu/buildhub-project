/**
 * ── ALL THREE REFERRAL REWARDS, ON FRESH ACCOUNTS ───────────────────────
 *
 * The engine has been tested. What had never been proved is the PRODUCT: that
 * an invitation sent by a real account, accepted through a real signup, and
 * qualified by a real event, produces a real change to what the inviter can
 * do - three different times, for three different rewards.
 *
 * Per reward type, on accounts created for this run and deleted afterwards:
 *
 *   ATTRIBUTION   B signs up through A's link; the referral is stored
 *   UNBOUND       no campaign is attached before qualification
 *   QUALIFY       a real qualifying event fires
 *   BOUND ONCE    exactly one campaign, exactly one reward row
 *   REAL EFFECT   the thing the reward promises actually changed
 *   IDEMPOTENT    firing the same event again changes nothing
 *   TOLD          the inviter is notified
 *
 * THE EFFECT IS READ FROM THE SYSTEM THAT OWNS IT, never from the reward row.
 * A ledger row saying GRANTED is the claim; the allowance resolver, the
 * placement reader and the subscription period are the facts. Checking the row
 * against itself would pass on a reward that granted nothing.
 */
import { execSync } from 'node:child_process';
import { getDb } from '../server/db.ts';
import { qualifyReferralEvent } from '../server/referralEngine.ts';
import { resolveVendorEntitlements } from '../server/billing/entitlements.ts';
import {
  reverseRewardEffect, markRewardReversed, markReferralAfterReversal,
} from '../server/referralReversal.ts';

const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};

const stamp = Date.now().toString(36);

function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zref%') as p)`;
  for (const statement of [
    `delete from referralRewards where recipientUserId in ${ids} or referralId in (select id from (select id from referrals where referrerId in ${ids} or referredId in ${ids}) as r)`,
    `delete from referrals where referrerId in ${ids} or referredId in ${ids}`,
    `delete from referralCampaigns where name like 'ZQA %${stamp}%'`,
    `delete from vendorSponsorships where vendorId in ${ids}`,
    `delete from vendorEntitlementOverrides where userId in ${ids}`,
    `delete from vendorSubscriptions where userId in ${ids}`,
    `delete from notifications where userId in ${ids}`,
    `delete from analyticsEvents where userId in ${ids}`,
    `delete from billingEvents where userId in ${ids}`,
    `delete from userAccountAuditEvents where actorId in ${ids} or userId in ${ids}`,
    `delete from commercialAuditEvents where actorId in ${ids} or ownerId in ${ids}`,
    `delete from users where username like 'zref%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 90)})`);
    }
  }
}

/** A real signup through the public procedure, carrying the referral code. */
async function signUpThrough(code, username, role) {
  const res = await fetch(`${BASE}/api/trpc/auth.signUp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: {
      username, email: `${username}@example.test`, password: 'ZgReferral!2024',
      name: `QA ${username}`, userRole: role, referralCode: code,
    } }),
  });
  const body = await res.text();
  if (res.status !== 200) throw new Error(`signUp ${username}: ${res.status} ${body.slice(0, 200)}`);
  return Number(sql(`select id from users where username='${username}'`));
}

const db = await getDb();
if (!db) { console.error('no database'); process.exit(2); }

/**
 * One full journey for one reward type.
 *
 * @param effect reads the fact the reward is supposed to change, from the
 * system that owns it, before and after.
 */
async function journey({ label, rewardType, rewardValue, qualification, inviterRole, referredRole, effect, describe }) {
  const tag = `${label}${stamp}`;
  const inviter = `zref${tag}A`;
  const referred = `zref${tag}B`;

  // The inviter exists first and owns the code.
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified, referralCode)
       values ('probe-${inviter}', '${inviter}', '${inviter}@example.test', 'QA Inviter ${label}', 'user',
        '${inviterRole}', 'password', 'self_registered', 0, 'active', 'approved', 1, 'ZQA${tag}')`);
  const inviterId = Number(sql(`select id from users where username='${inviter}'`));
  if (rewardType === 'SUBSCRIPTION_EXTENSION') {
    /*
     * A PERIOD TO EXTEND MUST EXIST. extendSubscriptionPeriod refuses when
     * there is none rather than manufacturing one - granting paid access
     * nobody decided to give - so an inviter with no subscription is a
     * legitimate refusal, not a defect. The first run of this probe had no
     * subscription and read that refusal as a broken reward.
     */
    sql(`insert into vendorSubscriptions (userId, plan, status, currentPeriodStart, currentPeriodEnd)
         values (${inviterId}, 'professional', 'active', date_sub(now(), interval 5 day), date_add(now(), interval 25 day))`);
  }

  const admin = Number(sql(`select id from users where role='admin' order by id limit 1`));
  /*
   * EXACTLY ONE ELIGIBLE CAMPAIGN PER JOURNEY.
   *
   * The first version left all three of this probe's campaigns active at
   * once, equally eligible for supplier -> supplier on PROVIDER_APPROVED. The
   * resolver did the right thing and picked the highest-priority one every
   * time, so all three journeys granted EXTRA_QUALIFIED_ENQUIRIES and the two
   * effect checks failed. The bind check said "1 campaign" and passed, because
   * it counted campaigns rather than naming the one it expected - which is why
   * it now asserts the id.
   */
  sql(`update referralCampaigns set status='ended' where name like 'ZQA %${stamp}%' and status='active'`);
  sql(`insert into referralCampaigns (name, status, eligibleInviterRoles, eligibleReferredRoles,
        qualificationType, rewardType, rewardValue, perInviterCap, priority, attributionWindowDays, createdBy, startsAt)
       values ('ZQA ${label} ${stamp}', 'active', '["${inviterRole}"]', '["${referredRole}"]',
        '${qualification}', '${rewardType}', '${rewardValue}', 5, 100, 90, ${admin}, date_sub(now(), interval 1 day))`);

  const campaignId = Number(sql(`select id from referralCampaigns where name='ZQA ${label} ${stamp}'`));
  const referredId = await signUpThrough(`ZQA${tag}`, referred, referredRole);
  const attributed = sql(`select concat_ws('|', status, ifnull(campaignId,'NULL')) from referrals where referredId=${referredId}`);
  check(attributed.startsWith('registered|NULL'),
    `${label}: attribution is stored and NO campaign is bound yet`, attributed || 'no referral row');

  const before = await effect(inviterId);
  const outcome = await qualifyReferralEvent(db, referredId, qualification, `${qualification}:${referredId}`);
  /*
   * 'granted' is the engine's word for "qualified AND the reward landed".
   * 'reward_pending' means it qualified and the effect could not be applied
   * yet, which is a different and weaker outcome, so it is not accepted here.
   */
  check(outcome.outcome === 'granted',
    `${label}: a real qualifying event qualifies AND grants`,
    `${outcome.outcome}${outcome.outcome === 'reward_pending' ? ' - qualified but the effect did not land' : ''}`);

  /*
   * The referrals row records the CAMPAIGN it bound to and its status. It does
   * NOT record the reward: referrals.rewardType exists and nothing has ever
   * written it, so asserting on it failed here and would have passed on a
   * product that granted nothing. The reward is asserted from referralRewards
   * below, which is the table that holds it.
   */
  const bound = sql(`select concat_ws('|', status, ifnull(campaignId,'NULL')) from referrals where referredId=${referredId}`);
  check(bound === `rewarded|${campaignId}`,
    `${label}: it binds to THIS campaign, once`, `${bound} (expected rewarded|${campaignId})`);

  const grantedType = sql(`select concat_ws('|', rewardType, rewardValue) from referralRewards
                           where recipientUserId=${inviterId} order by id desc limit 1`);
  check(grantedType === `${rewardType}|${rewardValue}`,
    `${label}: and the reward granted is the one this campaign promised`,
    `${grantedType} (expected ${rewardType}|${rewardValue})`);

  const rewardRows = Number(sql(`select count(*) from referralRewards where recipientUserId=${inviterId}`));
  check(rewardRows === 1, `${label}: exactly one reward row`, `${rewardRows} rows`);

  const after = await effect(inviterId);
  const verdict = describe(before, after);
  check(verdict.changed, `${label}: AND THE REAL EFFECT HAPPENED`,
    `${verdict.detail}${verdict.changed ? '' : ` (inviter ${inviterId})`}`);

  /* The same event again must change nothing at all. */
  const retry = await qualifyReferralEvent(db, referredId, qualification, `${qualification}:${referredId}`);
  const afterRetry = await effect(inviterId);
  const rowsAfterRetry = Number(sql(`select count(*) from referralRewards where recipientUserId=${inviterId}`));
  check(retry.outcome === 'already_qualified' && rowsAfterRetry === 1
    && !describe(after, afterRetry).changed,
    `${label}: firing the same event again grants nothing further`,
    `${retry.outcome}, ${rowsAfterRetry} row(s)`);

  const told = Number(sql(`select count(*) from notifications where userId=${inviterId}`));
  check(told > 0, `${label}: and the inviter is told`, `${told} notification(s)`);

  return { inviterId, referredId, campaignId, rewardId: Number(sql(
    `select id from referralRewards where recipientUserId=${inviterId} order by id desc limit 1`)) };
}

try {
  cleanUp();

  /* ── 1. EXTRA QUALIFIED ENQUIRIES ─────────────────────────────────────── */
  const enq = await journey({
    label: 'ENQ', rewardType: 'EXTRA_QUALIFIED_ENQUIRIES', rewardValue: '7',
    qualification: 'PROVIDER_APPROVED', inviterRole: 'supplier', referredRole: 'supplier',
    effect: async id => (await resolveVendorEntitlements(id)).qualifiedEnquiryAllowance,
    describe: (b, a) => ({ changed: a !== null && b !== null && a === b + 7, detail: `allowance ${b} -> ${a}` }),
  });

  /* ── 2. TEMPORARY FEATURED ────────────────────────────────────────────── */
  await journey({
    label: 'FEAT', rewardType: 'TEMPORARY_FEATURED', rewardValue: '14',
    qualification: 'PROVIDER_APPROVED', inviterRole: 'supplier', referredRole: 'supplier',
    effect: async id => Number(sql(`select count(*) from vendorSponsorships
                                    where vendorId=${id} and revokedAt is null`)),
    describe: (b, a) => ({ changed: a === b + 1, detail: `live placements ${b} -> ${a}` }),
  });

  /* ── 3. SUBSCRIPTION EXTENSION ────────────────────────────────────────── */
  const extTag = `EXT${stamp}`;
  await journey({
    label: 'EXT', rewardType: 'SUBSCRIPTION_EXTENSION', rewardValue: '30',
    qualification: 'PROVIDER_APPROVED', inviterRole: 'supplier', referredRole: 'supplier',
    effect: async id => sql(`select ifnull(max(currentPeriodEnd),'none') from vendorSubscriptions where userId=${id}`),
    describe: (b, a) => ({ changed: b !== a, detail: `period end ${b} -> ${a}` }),
  });
  /* ── REVERSAL: the benefit is taken back, not merely relabelled ───────── */
  const admin = Number(sql(`select id from users where role='admin' order by id limit 1`));
  const beforeReversal = (await resolveVendorEntitlements(enq.inviterId)).qualifiedEnquiryAllowance;
  const reward = sql(`select concat_ws('|', id, rewardType, rewardValue, ifnull(effectRef,''), recipientUserId)
                      from referralRewards where id=${enq.rewardId}`).split('|');
  const undone = await reverseRewardEffect(db, {
    id: Number(reward[0]), rewardType: reward[1], rewardValue: reward[2],
    effectRef: reward[3] || null, recipientUserId: Number(reward[4]),
  }, admin);
  check(undone.ok === true, 'REVERSAL: the effect is undone',
    undone.ok ? 'undone' : String(undone.reason));

  await markRewardReversed(db, Number(reward[0]), 'QA reversal');
  await markReferralAfterReversal(db, Number(sql(
    `select referralId from referralRewards where id=${enq.rewardId}`)));

  const afterReversal = (await resolveVendorEntitlements(enq.inviterId)).qualifiedEnquiryAllowance;
  check(afterReversal === beforeReversal - 7,
    'REVERSAL: AND THE ALLOWANCE GOES BACK - the benefit is really taken back',
    `allowance ${beforeReversal} -> ${afterReversal}`);

  const rewardState = sql(`select status from referralRewards where id=${enq.rewardId}`);
  check(rewardState === 'REVERSED', 'REVERSAL: and the ledger says so', rewardState);
} finally {
  if (process.env.ZG_KEEP !== '1') cleanUp();
  else console.log('\n(ZG_KEEP=1: probe data left in place for inspection)');
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
