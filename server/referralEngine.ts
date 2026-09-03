import { and, eq, sql } from 'drizzle-orm';
import {
  referrals, referralCampaigns, referralRewards, users,
} from '../drizzle/schema';
import { resolveReferralCampaign, type CampaignRejection } from './referralCampaignResolution';
import { setEnquiryAllowance } from './billing/overrides';
import { resolveVendorEntitlements } from './billing/entitlements';
import { notifyUser } from './notifications';
import { bookPlacement } from './placementBooking';
import { recordAccountEvent } from './_core/accountAudit';

type Db = any;

type QualifyResult =
  | { outcome: 'no_referral' }
  | { outcome: 'campaign_ineligible'; reason: string; rejections?: { campaignId: number; name: string; reason: CampaignRejection }[] }
  | { outcome: 'cap_reached' }
  | { outcome: 'already_qualified'; referralId: number }
  | { outcome: 'granted'; referralId: number; rewardId: number; rewardType: string; rewardValue: string }
  | { outcome: 'reward_pending'; referralId: number; rewardId: number; rewardType: string; rewardValue: string };


export async function qualifyReferralEvent(
  db: Db,
  referredUserId: number,
  eventType: string,
  eventKey: string,
  now: Date = new Date(),
): Promise<QualifyResult> {
  const [referral] = await db.select().from(referrals).where(eq(referrals.referredId, referredUserId)).limit(1);
  if (!referral) return { outcome: 'no_referral' };
  if (referral.status === 'rewarded' && referral.qualificationEventKey) return { outcome: 'already_qualified', referralId: referral.id };

  if (eventKey && referral.qualificationEventKey === eventKey) return { outcome: 'already_qualified', referralId: referral.id };

  // A referral that already holds a reward is finished, whatever fires next.
  // ONE REFERRAL, ONE CAMPAIGN, ONE REWARD.
  const [rewardCount] = await db.select({ count: sql<number>`count(*)` }).from(referralRewards).where(eq(referralRewards.referralId, referral.id));
  if (Number(rewardCount?.count ?? 0) > 0) return { outcome: 'already_qualified', referralId: referral.id };

  /**
   * NOTE THE DOUBLE DESTRUCTURE.
   *
   * `Promise.all` of two queries yields an array of RESULT ARRAYS, so the
   * previous `const [referrerRow, referredRow] = await Promise.all([...])`
   * bound each name to a one-element array and every `referrerRow.userRole`
   * read `undefined`. Both role checks below therefore compared against '' and
   * would have refused every campaign.
   *
   * It never showed, because the function returned at 'no campaign' several
   * lines earlier - on every referral, always. Fixing the binding is what made
   * this reachable, and a live probe caught it on the first run.
   */
  const [[referrerRow], [referredRow]] = await Promise.all([
    db.select({ userRole: users.userRole }).from(users).where(eq(users.id, referral.referrerId)).limit(1),
    db.select({ userRole: users.userRole }).from(users).where(eq(users.id, referral.referredId)).limit(1),
  ]);

  /**
   * THE CAMPAIGN IS CHOSEN HERE, NOW - not at signup.
   *
   * `referrals.campaignId` was read on this line and NOTHING HAS EVER WRITTEN
   * IT: the signup insert omits it and no other writer exists, so every
   * referral in the product's history short-circuited at 'no campaign' and the
   * engine has never granted a reward.
   *
   * The owner's decision is late binding, so the campaign is resolved from
   * whatever is eligible at THIS moment. An id already on the row - a
   * historical binding, or any future path that binds deliberately - is
   * honoured rather than overridden.
   */
  let campaign: any = null;
  if (referral.campaignId) {
    const [bound] = await db.select().from(referralCampaigns).where(eq(referralCampaigns.id, referral.campaignId)).limit(1);
    if (!bound) return { outcome: 'campaign_ineligible', reason: 'bound campaign missing' };
    if (bound.status !== 'active') return { outcome: 'campaign_ineligible', reason: 'campaign inactive' };
    if (bound.qualificationType !== eventType) return { outcome: 'campaign_ineligible', reason: 'qualification mismatch' };
    campaign = bound;
  } else {
    const resolution = await resolveReferralCampaign(db, {
      qualificationType: eventType,
      referredAt: new Date(referral.createdAt),
      inviterRole: referrerRow?.userRole ?? null,
      referredRole: referredRow?.userRole ?? null,
      referrerId: referral.referrerId,
      eventAt: now,
    });
    if (!resolution.ok) {
      // The per-candidate reasons travel with the refusal. "Your invite was 100
      // days old and the window is 90" and "no campaign is running for that
      // event" are different answers, and an administrator investigating a
      // complaint needs the first one.
      return {
        outcome: 'campaign_ineligible',
        reason: resolution.considered === 0 ? 'no campaign' : 'no eligible campaign',
        rejections: resolution.rejections,
      };
    }
    campaign = resolution.campaign;
  }

  await db.update(referrals).set({
    status: 'qualified',
    // BOUND, and bound once. The row now names the campaign it qualified
    // under, and nothing above will re-resolve it: the reward-count check at
    // the top of this function returns `already_qualified` on every later
    // event, so a better campaign appearing tomorrow cannot move it.
    campaignId: campaign.id,
    qualificationType: eventType,
    qualificationEventKey: eventKey,
    qualifiedAt: now,
    qualificationNote: null,
  }).where(eq(referrals.id, referral.id));

  const rewardValues = {
    referralId: referral.id,
    campaignId: campaign.id,
    recipientUserId: referral.referrerId,
    rewardType: campaign.rewardType,
    rewardValue: campaign.rewardValue,
    source: 'REFERRAL_REWARD',
    status: 'GRANTED' as const,
    effectiveFrom: now,
    expiresAt: campaign.rewardDurationDays ? new Date(now.getTime() + campaign.rewardDurationDays * 24 * 60 * 60 * 1000) : null,
    grantedAt: now,
  };

  let rewardId = 0;
  try {
    const inserted = await db.insert(referralRewards).values(rewardValues);
    rewardId = Number(inserted?.[0]?.insertId ?? 0);
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code
      ?? (error as { code?: string })?.code;
    if (code === 'ER_DUP_ENTRY') {
      return { outcome: 'already_qualified', referralId: referral.id };
    }
    throw error;
  }

  if (campaign.rewardType === 'EXTRA_QUALIFIED_ENQUIRIES') {
    const bonus = Number(campaign.rewardValue);
    if (Number.isFinite(bonus) && bonus > 0) {
      const resolution = await resolveVendorEntitlements(referral.referrerId, now);
      const current = resolution.qualifiedEnquiryAllowance;
      const next = current === null ? null : current + bonus;
      await setEnquiryAllowance({
        db: db as never,
        userId: referral.referrerId,
        limit: next,
        reason: `Referral reward from ${campaign.name}`,
        actorId: referral.referrerId,
        endsAt: rewardValues.expiresAt,
      });
    }
  }

  if (campaign.rewardType === 'TEMPORARY_FEATURED') {
    await bookPlacement(db, {
      entityType: 'PROVIDER',
      entityId: referral.referrerId,
      package: 'SPOTLIGHT',
      surface: 'TYPE_CATEGORY_SPOTLIGHT',
      source: 'REFERRAL_REWARD',
      category: 'General',
      startsAt: now,
      endsAt: rewardValues.expiresAt,
      priority: 0,
      grantedBy: referral.referrerId,
      reason: `Referral reward from ${campaign.name}`,
    });
  }

  await db.update(referrals).set({ status: 'rewarded' }).where(eq(referrals.id, referral.id));
  await recordAccountEvent(db, {
    userId: referral.referrerId,
    actorId: null,
    action: 'referral_reward_granted',
    source: 'referral',
    note: `${eventType}: ${campaign.name} ${campaign.rewardType} ${campaign.rewardValue}`,
  });
  await notifyUser(db, {
    userId: referral.referrerId,
    title: 'Referral reward granted',
    body: `${campaign.rewardType}: ${campaign.rewardValue}`,
    type: 'referral',
    link: '/settings#settings-referral',
    // Without a key this reward notice reached an Arabic referrer in English.
    // The reward type is a stored enum rather than prose, so it is passed as a
    // value the template names - not concatenated into a sentence here.
    messageKey: 'notif.referral.reward',
    messageParams: {
      campaign: campaign.name,
      reward: `${campaign.rewardType}: ${campaign.rewardValue}`,
    },
  });

  return {
    outcome: 'granted',
    referralId: referral.id,
    rewardId,
    rewardType: campaign.rewardType,
    rewardValue: campaign.rewardValue,
  };
}
