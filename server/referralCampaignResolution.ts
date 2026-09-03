/**
 * WHICH CAMPAIGN REWARDS THIS REFERRAL - decided at QUALIFICATION, not at signup.
 *
 * THE DEFECT THIS EXISTS TO FIX. `server/referralEngine.ts` reads
 * `referrals.campaignId` on every qualification attempt, and NOTHING HAS EVER
 * WRITTEN IT: the signup insert omits it and no other writer exists. Every
 * referral in the product's history short-circuits at 'no campaign'. The
 * referral engine has never granted a reward, and could not have.
 *
 * THE OWNER'S DECISION IS LATE BINDING. No campaign is chosen when somebody
 * signs up with a code - at that moment nobody knows which campaign they will
 * eventually qualify under, and pinning one would either freeze a campaign that
 * later ended or exclude one that had not started. The campaign is resolved
 * when a REAL qualifying event fires, from the campaigns that are eligible AT
 * THAT MOMENT.
 *
 * THE FIVE RULES THAT MAKE IT SAFE
 *
 *   DETERMINISTIC. The same input must always select the same campaign. Every
 *   candidate is ordered by declared priority, then by id - a total order, so
 *   the answer never depends on the order a database happened to return rows
 *   in. A vendor asking "why did I get this reward and not that one" gets an
 *   answer that can be reproduced.
 *
 *   ELIGIBILITY FIRST, PRIORITY SECOND. A campaign that is exhausted, ended,
 *   not started, or does not match both roles is NOT A CANDIDATE - it cannot
 *   win on priority and then fail. Caps participate in eligibility for exactly
 *   this reason.
 *
 *   ONE REFERRAL, ONE CAMPAIGN, ONE REWARD. Once a referral has qualified it
 *   keeps the campaign it qualified under, for good. A later, better campaign
 *   does not re-bind it and a later edit does not move it.
 *
 *   AN ALREADY-SET campaignId IS HONOURED. Historical rows, and any future
 *   path that binds deliberately, are not overridden by this.
 *
 *   THE ATTRIBUTION WINDOW IS PART OF ELIGIBILITY. A signup from two years ago
 *   does not earn a reward because somebody finally verified their email.
 *
 * NOTHING HERE WRITES. It answers a question; the engine decides what to do
 * with the answer, and is the only thing that binds.
 */
import { and, eq, sql } from 'drizzle-orm';
import { referralCampaigns, referralRewards } from '../drizzle/schema';
import type { ReferralQualificationType } from '../shared/referralRewards';

export type CampaignRow = {
  id: number;
  name: string;
  status: string;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  eligibleInviterRoles: string;
  eligibleReferredRoles: string;
  qualificationType: string;
  rewardType: string;
  rewardValue: string;
  rewardDurationDays: number | null;
  perInviterCap: number;
  campaignCap: number | null;
  priority: number;
  attributionWindowDays: number;
};

/**
 * Why a campaign was not chosen.
 *
 * Recorded per candidate rather than collapsed into "no campaign", because
 * "your invite was 100 days old and the window is 90" and "no campaign is
 * running for that event" are different answers to the same question, and an
 * administrator investigating a complaint needs the first one.
 */
export type CampaignRejection =
  | 'not_active'
  | 'not_started'
  | 'ended'
  | 'qualification_mismatch'
  | 'outside_attribution_window'
  | 'inviter_role'
  | 'referred_role'
  | 'inviter_cap_reached'
  | 'campaign_cap_reached';

export type CampaignResolution =
  | { ok: true; campaign: CampaignRow; considered: number }
  | { ok: false; considered: number; rejections: { campaignId: number; name: string; reason: CampaignRejection }[] };

const rolesFrom = (raw: string): string[] => {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

const time = (value: Date | string | null | undefined): number | null =>
  value == null ? null : new Date(value).getTime();

export type ResolutionInput = {
  qualificationType: ReferralQualificationType | string;
  /** When the referral was created - the start of the attribution window. */
  referredAt: Date;
  inviterRole: string | null;
  referredRole: string | null;
  referrerId: number;
  eventAt: Date;
};

/**
 * How many rewards a campaign has already handed out, and to this inviter.
 *
 * Read for the candidates only, in one query each rather than one per campaign:
 * a qualifying event is on the hot path of a real user action.
 */
async function capUsage(db: any, campaignIds: number[], referrerId: number) {
  if (campaignIds.length === 0) return { perCampaign: new Map<number, number>(), perInviter: new Map<number, number>() };

  const rows = await db.select({
    campaignId: referralRewards.campaignId,
    recipientUserId: referralRewards.recipientUserId,
    total: sql<number>`count(*)`,
  }).from(referralRewards).groupBy(referralRewards.campaignId, referralRewards.recipientUserId);

  const perCampaign = new Map<number, number>();
  const perInviter = new Map<number, number>();
  for (const row of rows as any[]) {
    const campaignId = Number(row.campaignId);
    if (!campaignIds.includes(campaignId)) continue;
    const count = Number(row.total ?? 0);
    perCampaign.set(campaignId, (perCampaign.get(campaignId) ?? 0) + count);
    if (Number(row.recipientUserId) === referrerId) {
      perInviter.set(campaignId, (perInviter.get(campaignId) ?? 0) + count);
    }
  }
  return { perCampaign, perInviter };
}

/**
 * Decide, from candidates already loaded. Pure, so the ordering and the
 * eligibility rules are testable without a database.
 */
export function chooseCampaign(
  campaigns: readonly CampaignRow[],
  input: ResolutionInput,
  usage: { perCampaign: Map<number, number>; perInviter: Map<number, number> },
): CampaignResolution {
  const now = input.eventAt.getTime();
  const rejections: { campaignId: number; name: string; reason: CampaignRejection }[] = [];

  const reject = (campaign: CampaignRow, reason: CampaignRejection) => {
    rejections.push({ campaignId: campaign.id, name: campaign.name, reason });
    return false;
  };

  const eligible = campaigns.filter(campaign => {
    if (campaign.status !== 'active') return reject(campaign, 'not_active');
    if (campaign.qualificationType !== input.qualificationType) return reject(campaign, 'qualification_mismatch');

    const startsAt = time(campaign.startsAt);
    if (startsAt !== null && startsAt > now) return reject(campaign, 'not_started');
    const endsAt = time(campaign.endsAt);
    if (endsAt !== null && endsAt < now) return reject(campaign, 'ended');

    // THE ATTRIBUTION WINDOW, measured from the referral, not from the event.
    const windowMs = campaign.attributionWindowDays * 24 * 60 * 60 * 1000;
    if (now - input.referredAt.getTime() > windowMs) return reject(campaign, 'outside_attribution_window');

    if (!rolesFrom(campaign.eligibleInviterRoles).includes(input.inviterRole ?? '')) return reject(campaign, 'inviter_role');
    if (!rolesFrom(campaign.eligibleReferredRoles).includes(input.referredRole ?? '')) return reject(campaign, 'referred_role');

    // CAPS PARTICIPATE IN ELIGIBILITY. An exhausted campaign is not a
    // candidate, so it can never win on priority and then fail to pay out -
    // which would leave the referral bound to a campaign that owes it nothing.
    if ((usage.perInviter.get(campaign.id) ?? 0) >= campaign.perInviterCap) return reject(campaign, 'inviter_cap_reached');
    if (campaign.campaignCap != null && (usage.perCampaign.get(campaign.id) ?? 0) >= campaign.campaignCap) {
      return reject(campaign, 'campaign_cap_reached');
    }
    return true;
  });

  if (eligible.length === 0) return { ok: false, considered: campaigns.length, rejections };

  // TOTAL ORDER. Priority descending, then id ascending - never the order the
  // database returned, which is not an order at all.
  const chosen = [...eligible].sort((a, b) => b.priority - a.priority || a.id - b.id)[0];
  return { ok: true, campaign: chosen, considered: campaigns.length };
}

/**
 * The live form: load the candidates and choose.
 *
 * Only campaigns matching the event's qualification type are read, which is
 * what the index added in 0044 serves.
 */
export async function resolveReferralCampaign(db: any, input: ResolutionInput): Promise<CampaignResolution> {
  const campaigns = await db.select().from(referralCampaigns)
    .where(and(
      eq(referralCampaigns.status, 'active'),
      eq(referralCampaigns.qualificationType, input.qualificationType as any),
    )) as CampaignRow[];

  const usage = await capUsage(db, campaigns.map(campaign => campaign.id), input.referrerId);
  return chooseCampaign(campaigns, input, usage);
}
