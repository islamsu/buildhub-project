import { and, eq, sql } from 'drizzle-orm';
import {
  referrals, referralCampaigns, referralRewards, users,
} from '../drizzle/schema';
import { setEnquiryAllowance } from './billing/overrides';
import { resolveVendorEntitlements } from './billing/entitlements';
import { notifyUser } from './notifications';
import { bookPlacement } from './placementBooking';
import { recordAccountEvent } from './_core/accountAudit';

type Db = any;

type QualifyResult =
  | { outcome: 'no_referral' }
  | { outcome: 'campaign_ineligible'; reason: string }
  | { outcome: 'cap_reached' }
  | { outcome: 'already_qualified'; referralId: number }
  | { outcome: 'granted'; referralId: number; rewardId: number; rewardType: string; rewardValue: string }
  | { outcome: 'reward_pending'; referralId: number; rewardId: number; rewardType: string; rewardValue: string };

function rolesFrom(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

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

  const campaignId = referral.campaignId;
  if (!campaignId) return { outcome: 'campaign_ineligible', reason: 'no campaign' };
  const [campaign] = await db.select().from(referralCampaigns).where(eq(referralCampaigns.id, campaignId)).limit(1);
  if (!campaign || campaign.status !== 'active') return { outcome: 'campaign_ineligible', reason: 'campaign inactive' };
  if (campaign.startsAt && new Date(campaign.startsAt).getTime() > now.getTime()) return { outcome: 'campaign_ineligible', reason: 'campaign not started' };
  if (campaign.endsAt && new Date(campaign.endsAt).getTime() < now.getTime()) return { outcome: 'campaign_ineligible', reason: 'campaign ended' };
  if (campaign.qualificationType !== eventType) return { outcome: 'campaign_ineligible', reason: 'qualification mismatch' };

  if (eventKey && referral.qualificationEventKey === eventKey) return { outcome: 'already_qualified', referralId: referral.id };

  const eligibleInviterRoles = rolesFrom(campaign.eligibleInviterRoles);
  const eligibleReferredRoles = rolesFrom(campaign.eligibleReferredRoles);
  const [referrerRow, referredRow] = await Promise.all([
    db.select({ userRole: users.userRole }).from(users).where(eq(users.id, referral.referrerId)).limit(1),
    db.select({ userRole: users.userRole }).from(users).where(eq(users.id, referral.referredId)).limit(1),
  ]);
  if (!referrerRow || !eligibleInviterRoles.includes(referrerRow.userRole ?? '')) return { outcome: 'campaign_ineligible', reason: 'inviter role' };
  if (!referredRow || !eligibleReferredRoles.includes(referredRow.userRole ?? '')) return { outcome: 'campaign_ineligible', reason: 'referred role' };

  const [rewardCount] = await db.select({ count: sql<number>`count(*)` }).from(referralRewards).where(eq(referralRewards.referralId, referral.id));
  if (Number(rewardCount?.count ?? 0) > 0) return { outcome: 'already_qualified', referralId: referral.id };

  const [inviterRewards] = await db.select({ count: sql<number>`count(*)` }).from(referralRewards)
    .where(and(eq(referralRewards.campaignId, campaign.id), eq(referralRewards.recipientUserId, referral.referrerId)));
  if (Number(inviterRewards?.count ?? 0) >= campaign.perInviterCap) return { outcome: 'cap_reached' };
  if (campaign.campaignCap) {
    const [campaignRewards] = await db.select({ count: sql<number>`count(*)` }).from(referralRewards).where(eq(referralRewards.campaignId, campaign.id));
    if (Number(campaignRewards?.count ?? 0) >= campaign.campaignCap) return { outcome: 'cap_reached' };
  }

  await db.update(referrals).set({
    status: 'qualified',
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
