/**
 * READING THE REFERRAL LEDGER TRUTHFULLY.
 *
 * `referralRewards.status` has an EXPIRED value and NOTHING HAS EVER WRITTEN
 * IT. A bonus whose `expiresAt` passed last month still reads GRANTED - to the
 * administrator looking at the reward list, and to the vendor asking why their
 * allowance dropped. The row said they had something the billing engine had
 * already stopped giving them.
 *
 * BuildHub has no job runner (server/billing/lifecycle.ts:640), and inventing a
 * cron to sweep these rows would contradict how the rest of the platform
 * already works: entitlement overrides and placements are BOTH derived at read
 * time from their own dates, and are correct the moment the date passes rather
 * than the next time a sweeper happens to run. Expiry here is derived the same
 * way, from the same column the effect itself is bounded by.
 *
 * WHAT IS NOT DERIVED: a decision somebody made. REVERSED and REJECTED are
 * outcomes an administrator or the engine recorded, and a date passing does not
 * turn a withdrawn reward into a lapsed one.
 */
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { containsTerm } from './_core/searchTerms';
import { referralCampaigns, referralRewards, referrals, users } from '../drizzle/schema';

export type DerivedRewardStatus = 'PENDING' | 'GRANTED' | 'EXPIRED' | 'REVERSED' | 'REJECTED';

/** A timestamp column can arrive as a Date or as a string, depending on driver. */
function asTime(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? time : null;
}

/**
 * The status a reward ACTUALLY has right now.
 *
 * Only a GRANTED reward can lapse, and only when it carries a finite end that
 * has passed. A null `expiresAt` is a reward with no end - deriving EXPIRED
 * from a missing date would retire every open-ended grant the moment it was
 * read.
 */
export function deriveRewardStatus(
  reward: { status: string; expiresAt?: Date | string | null },
  now: Date = new Date(),
): DerivedRewardStatus {
  const stored = reward.status as DerivedRewardStatus;
  if (stored !== 'GRANTED') return stored;
  const ends = asTime(reward.expiresAt);
  return ends !== null && ends <= now.getTime() ? 'EXPIRED' : 'GRANTED';
}

/** Adds the derived status beside the stored one, never in place of it. */
export function withDerivedStatus<T extends { status: string; expiresAt?: Date | string | null }>(
  reward: T,
  now: Date = new Date(),
): T & { status: DerivedRewardStatus; storedStatus: string } {
  // `status` is REPLACED for the reader and the original kept as
  // `storedStatus`: a caller that renders `status` gets the truth by default,
  // and a caller auditing the database can still see what the column holds.
  return { ...reward, status: deriveRewardStatus(reward, now), storedStatus: reward.status };
}

export type RewardPage<T> = { rows: T[]; total: number; page: number; pageSize: number };

/**
 * The administrator's reward ledger, PAGED.
 *
 * This was `.limit(250)` with no count - the same silent truncation the user
 * directory had. An administrator on a platform with more rewards than that saw
 * a subset with nothing telling them it was one.
 */
export async function listReferralRewards(
  db: any,
  query: { page: number; pageSize: number },
  now: Date = new Date(),
): Promise<RewardPage<Record<string, unknown>>> {
  const [totalRow] = await db.select({ count: sql<number>`count(*)` }).from(referralRewards);
  const rows = await db.select({
    id: referralRewards.id,
    referralId: referralRewards.referralId,
    campaignId: referralRewards.campaignId,
    recipientUserId: referralRewards.recipientUserId,
    rewardType: referralRewards.rewardType,
    rewardValue: referralRewards.rewardValue,
    status: referralRewards.status,
    effectiveFrom: referralRewards.effectiveFrom,
    expiresAt: referralRewards.expiresAt,
    grantedAt: referralRewards.grantedAt,
    reversedAt: referralRewards.reversedAt,
    reversalReason: referralRewards.reversalReason,
    effectRef: referralRewards.effectRef,
    createdAt: referralRewards.createdAt,
    campaignName: referralCampaigns.name,
    recipientName: users.name,
  }).from(referralRewards)
    .innerJoin(referralCampaigns, eq(referralCampaigns.id, referralRewards.campaignId))
    .innerJoin(users, eq(users.id, referralRewards.recipientUserId))
    .orderBy(desc(referralRewards.createdAt))
    .limit(query.pageSize)
    .offset(query.page * query.pageSize);

  return {
    rows: rows.map((row: any) => withDerivedStatus(row, now)),
    total: Number(totalRow?.count ?? 0),
    page: query.page,
    pageSize: query.pageSize,
  };
}

/**
 * What ONE inviter earned, for their own eyes.
 *
 * NO IDENTITY OF THE PEOPLE THEY INVITED. A referral code can be posted
 * publicly - on a forum, in a group - and anyone who signs up through it
 * becomes a row here. Rendering their name would hand a stranger's identity to
 * whoever posted the code, which is not something they agreed to by using a
 * link. The inviter needs to understand THEIR OWN rewards, and the date, the
 * status and what it earned say all of that without naming anybody.
 */
export async function listMyReferralRewards(
  db: any,
  userId: number,
  now: Date = new Date(),
): Promise<Array<Record<string, unknown>>> {
  const rows = await db.select({
    id: referralRewards.id,
    rewardType: referralRewards.rewardType,
    rewardValue: referralRewards.rewardValue,
    status: referralRewards.status,
    grantedAt: referralRewards.grantedAt,
    expiresAt: referralRewards.expiresAt,
    createdAt: referralRewards.createdAt,
    campaignName: referralCampaigns.name,
  }).from(referralRewards)
    .innerJoin(referralCampaigns, eq(referralCampaigns.id, referralRewards.campaignId))
    .where(eq(referralRewards.recipientUserId, userId))
    .orderBy(desc(referralRewards.createdAt))
    .limit(100);
  return rows.map((row: any) => withDerivedStatus(row, now));
}

/**
 * The inviter's own invitations, counted by what became of them.
 *
 * `myReferral` reported ONE number - how many people used the code - which
 * cannot answer the only question an inviter actually has: how many of those
 * turned into anything. Registered and qualified are different facts, and
 * collapsing them into a total makes an unrewarding programme look identical to
 * a working one.
 */
export async function myReferralCounts(db: any, userId: number): Promise<{
  total: number; registered: number; qualified: number; rewarded: number;
}> {
  const rows = await db.select({ status: referrals.status, count: sql<number>`count(*)` })
    .from(referrals)
    .where(eq(referrals.referrerId, userId))
    .groupBy(referrals.status);
  const by = new Map<string, number>(rows.map((r: any) => [String(r.status), Number(r.count ?? 0)]));
  const at = (key: string) => by.get(key) ?? 0;
  return {
    total: Array.from(by.values()).reduce((sum, n) => sum + n, 0),
    registered: at('registered'),
    qualified: at('qualified'),
    rewarded: at('rewarded'),
  };
}

/** Live rewards only - what the vendor HAS, as opposed to what they once had. */
export function liveRewards<T extends { status: string; expiresAt?: Date | string | null }>(
  rewards: T[],
  now: Date = new Date(),
): T[] {
  return rewards.filter(reward => deriveRewardStatus(reward, now) === 'GRANTED');
}

/**
 * The administrator's referral list, with the REAL reward attached.
 *
 * The Reward column read `referrals.rewardType` / `.rewardValue` - two of the
 * five columns on that table that NOTHING HAS EVER WRITTEN. The column was
 * permanently "-", on every row, for every referral the platform has recorded,
 * while the actual reward sat in `referralRewards` beside it.
 *
 * TWO QUERIES, NOT A JOIN. A referral can carry more than one reward row (the
 * unique index is per referral AND campaign), and joining would multiply the
 * referral across them - turning one invitation into two lines in a list an
 * administrator counts.
 */
export async function listAdminReferrals(
  db: any,
  query: { page: number; pageSize: number; search?: string; status?: string },
  now: Date = new Date(),
): Promise<RewardPage<Record<string, unknown>>> {
  /*
   * FILTERING RUNS IN THE QUERY, NOT OVER THE PAGE.
   *
   * The previous screen filtered client-side over a `.limit(250)` result, so a
   * search told an administrator "no matching referrals" when the match was on
   * row 251. A filter applied to a truncated set is worse than no filter,
   * because it answers confidently.
   */
  const term = (query.search ?? '').trim();
  const filters = [
    query.status && query.status !== 'all' ? eq(referrals.status, query.status as any) : null,
    term ? or(
      like(users.name, containsTerm(term)),
      like(users.email, containsTerm(term)),
      like(referrals.code, containsTerm(term)),
    ) : null,
  ].filter(Boolean) as any[];
  const where = filters.length > 0 ? and(...filters) : undefined;

  const totalQuery = db.select({ count: sql<number>`count(*)` }).from(referrals)
    .innerJoin(users, eq(users.id, referrals.referrerId));
  const [totalRow] = where ? await totalQuery.where(where) : await totalQuery;

  const baseRows = db.select({
    id: referrals.id,
    referrerId: referrals.referrerId,
    referredId: referrals.referredId,
    code: referrals.code,
    status: referrals.status,
    campaignId: referrals.campaignId,
    qualificationType: referrals.qualificationType,
    qualifiedAt: referrals.qualifiedAt,
    createdAt: referrals.createdAt,
    referrerName: users.name,
    referrerEmail: users.email,
  }).from(referrals)
    .innerJoin(users, eq(users.id, referrals.referrerId));
  const rows = await (where ? baseRows.where(where) : baseRows)
    .orderBy(desc(referrals.createdAt))
    .limit(query.pageSize)
    .offset(query.page * query.pageSize);

  const ids = rows.map((row: any) => Number(row.id));
  const rewards = ids.length === 0 ? [] : await db.select({
    id: referralRewards.id,
    referralId: referralRewards.referralId,
    rewardType: referralRewards.rewardType,
    rewardValue: referralRewards.rewardValue,
    status: referralRewards.status,
    expiresAt: referralRewards.expiresAt,
    reversalReason: referralRewards.reversalReason,
    campaignName: referralCampaigns.name,
  }).from(referralRewards)
    .innerJoin(referralCampaigns, eq(referralCampaigns.id, referralRewards.campaignId))
    .where(inArray(referralRewards.referralId, ids));

  const byReferral = new Map<number, any[]>();
  for (const reward of rewards as any[]) {
    const list = byReferral.get(Number(reward.referralId)) ?? [];
    list.push(withDerivedStatus(reward, now));
    byReferral.set(Number(reward.referralId), list);
  }

  return {
    rows: rows.map((row: any) => ({ ...row, rewards: byReferral.get(Number(row.id)) ?? [] })),
    total: Number(totalRow?.count ?? 0),
    page: query.page,
    pageSize: query.pageSize,
  };
}
