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
import { alias } from 'drizzle-orm/mysql-core';
import { containsTerm } from './_core/searchTerms';
import { referralCampaigns, referralRewards, referrals, users } from '../drizzle/schema';

/**
 * `users` a second time, as the REFERRED party.
 *
 * One query already joins `users` as the referrer; naming the second join is
 * what lets both identities come back in one read rather than a lookup per
 * row.
 */
const referredUser = alias(users, 'referredUser');

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
    /*
     * THE CAMPAIGN'S NAME, not just its id - the admin human-first rule this
     * project applies everywhere else. LEFT joined on purpose: a referral has
     * NO campaign until it qualifies (owner decision 2, late binding), so an
     * inner join would silently drop every referral still waiting, which is
     * most of them.
     */
    campaignName: referralCampaigns.name,
    qualificationType: referrals.qualificationType,
    qualifiedAt: referrals.qualifiedAt,
    createdAt: referrals.createdAt,
    referrerName: users.name,
    referrerEmail: users.email,
    /*
     * THE REFERRED PARTY'S NAME, for the same reason as the campaign's above -
     * and it was the one identity on this row that the rule had missed. The
     * admin ledger could only print `#4127` for the person who was referred,
     * so an administrator investigating an attribution dispute had a number
     * and no way to tell whose account it was without leaving the screen.
     *
     * LEFT joined even though `referredId` is NOT NULL and RESTRICTed: this
     * read must not silently drop a referral row because of a join, and a
     * missing name is a dash rather than a disappeared record.
     */
    referredName: referredUser.name,
    referredEmail: referredUser.email,
  }).from(referrals)
    .innerJoin(users, eq(users.id, referrals.referrerId))
    .leftJoin(referredUser, eq(referredUser.id, referrals.referredId))
    .leftJoin(referralCampaigns, eq(referralCampaigns.id, referrals.campaignId));
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

/**
 * ── WHO ACCEPTED THE INVITATION, AND WHERE IT GOT TO ──────────────────────
 *
 * The invite screen showed three counts and nothing else, so an inviter could
 * see that four people had signed up and had no way to tell which of them had
 * done anything, what any of them still needed to do, or why one had earned a
 * reward and three had not.
 *
 * A DELIBERATE PRIVACY DECISION SITS HERE, and it is narrowed rather than
 * reversed. listMyReferralRewards above refuses to name anybody at all, on the
 * grounds that a referral code can be posted publicly and a stranger who signs
 * up through it did not agree to be named to whoever posted it. That reasoning
 * is sound and the risk is real.
 *
 * The owner's requirement is that an inviter can see the people and businesses
 * they referred. Both are satisfied by disclosing only what the marketplace
 * ALREADY SHOWS about that account to anybody:
 *
 *   A PROVIDER who is live in the public directory is named, because their
 *   business name is on their public profile and in search results already.
 *   Naming them here discloses nothing new.
 *
 *   ANYBODY ELSE - a homeowner, an unapproved or hidden provider - is NOT
 *   named. They are described by what they are and when they joined, which is
 *   what the inviter needs in order to understand their own programme, and
 *   nothing that identifies a private individual to whoever posted a code.
 *
 * So the row always answers "how is my referral doing" and never turns a
 * publicly posted link into a list of strangers' names.
 */
export type MyReferredParty = {
  id: number;
  /** The business name, when it is already public. Null when it is not. */
  name: string | null;
  /** What they are, always - "Supplier", "Homeowner" - for the rows with no name. */
  role: string | null;
  status: string;
  qualificationType: string | null;
  qualifiedAt: Date | null;
  createdAt: Date;
  /** What this particular referral earned, if anything has been granted yet. */
  rewardType: string | null;
  rewardValue: string | number | null;
  rewardStatus: string | null;
  rewardExpiresAt: Date | null;
};

export async function listMyReferredParties(
  db: any,
  userId: number,
  limit = 50,
): Promise<MyReferredParty[]> {
  const referred = alias(users, 'referredParty');
  const rows = await db.select({
    id: referrals.id,
    referredId: referrals.referredId,
    name: referred.name,
    role: referred.userRole,
    accountStatus: referred.accountStatus,
    onboardingStatus: referred.onboardingStatus,
    status: referrals.status,
    qualificationType: referrals.qualificationType,
    qualifiedAt: referrals.qualifiedAt,
    createdAt: referrals.createdAt,
    /*
     * THE REWARD COMES FROM THE REWARD TABLE, not from referrals.rewardType.
     *
     * That column exists and NOTHING HAS EVER WRITTEN IT - the engine records
     * the grant in referralRewards and only moves referrals.status to
     * 'rewarded'. Reading it here compiled, typechecked and returned null for
     * every row, so the list would have shown a reward column that was always
     * empty and nobody would have known why.
     */
    rewardType: referralRewards.rewardType,
    rewardValue: referralRewards.rewardValue,
    rewardStatus: referralRewards.status,
    rewardExpiresAt: referralRewards.expiresAt,
  }).from(referrals)
    .leftJoin(referred, eq(referred.id, referrals.referredId))
    .leftJoin(referralRewards, eq(referralRewards.referralId, referrals.id))
    .where(eq(referrals.referrerId, userId))
    .orderBy(desc(referrals.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));

  return rows.map((row: any) => {
    /*
     * PUBLIC MEANS PUBLIC. The same two conditions the vendor directory uses
     * to decide whether an account appears at all: an active account and an
     * approved registration. Anything else keeps its name to itself.
     */
    const publiclyListed = PROVIDER_ROLES_FOR_DIRECTORY.includes(String(row.role))
      && row.accountStatus === 'active'
      && row.onboardingStatus === 'approved';
    return {
      id: Number(row.id),
      name: publiclyListed ? (row.name ?? null) : null,
      role: row.role ?? null,
      status: String(row.status),
      qualificationType: row.qualificationType ?? null,
      qualifiedAt: row.qualifiedAt ?? null,
      createdAt: row.createdAt,
      rewardType: row.rewardType ?? null,
      rewardValue: row.rewardValue ?? null,
      rewardStatus: row.rewardStatus ?? null,
      rewardExpiresAt: row.rewardExpiresAt ?? null,
    };
  });
}

/** The roles the public vendor directory lists. Kept beside its one use. */
const PROVIDER_ROLES_FOR_DIRECTORY = [
  'contractor', 'engineer', 'architect', 'supplier', 'project_manager',
];
