/**
 * ── REFERRAL CODES AS A MANAGED OBJECT ──────────────────────────────────
 *
 * `users.referralCode` had been a string minted at sign-up and never governed
 * again: nothing could stop a code that had leaked, nothing could issue one to
 * an account that lacked one, nothing recorded who changed what, and no Admin
 * screen existed over any of it. The owner named Referral Codes as the missing
 * Admin concept in the referral control plane.
 *
 * WHAT THIS MODULE IS RESPONSIBLE FOR, and what it deliberately is not:
 *
 *   it OWNS the lifecycle - issue, rotate, disable, reactivate - and every
 *     one of those writes a `referralCodeEvents` row naming actor and reason
 *   it OWNS the one-active-code invariant, by keeping the code on `users`
 *     where the sign-up attribution path already reads it
 *   it does NOT create referrals. A referral arises from a real person
 *     following a real link, and a button that fabricates the relationship
 *     would be inventing the one thing the ledger exists to record.
 *
 * ROTATION BREAKS OLD LINKS, AND SAYS SO. That is the point of rotating, not
 * a side effect: the caller must pass a reason, and the history row keeps the
 * string that stopped working so "this link stopped earning on the 4th" stays
 * answerable after the column no longer holds it.
 */
import { and, count, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { randomBytes } from 'node:crypto';
import { referralCodeEvents, referralRewards, referrals, users } from '../drizzle/schema';
/**
 * THE ONE ESCAPER. A LIKE pattern assembled by hand lets a searcher's own
 * percent and underscore reach MySQL as wildcards: a lone percent then
 * matches every row in the table, which is a full scan that a search box
 * should not be able to ask for, and an underscore silently widens a search
 * nobody meant to widen.
 */
import { containsTerm } from './_core/searchTerms';

type Db = any;

/** The administrator who made the change, joined by alias off the same table. */
const codeEventActor = alias(users, 'codeEventActor');

export class ReferralCodeError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT', message: string) {
    super(message);
  }
}

export const REFERRAL_CODE_STATUSES = ['active', 'disabled'] as const;
export type ReferralCodeStatus = (typeof REFERRAL_CODE_STATUSES)[number];

export const REFERRAL_CODE_ACTIONS = ['issued', 'rotated', 'disabled', 'reactivated'] as const;
export type ReferralCodeAction = (typeof REFERRAL_CODE_ACTIONS)[number];

/**
 * THE ONE PLACE A CODE IS MINTED.
 *
 * Kept identical in shape to the sign-up path's own generator so a code issued
 * by an administrator is indistinguishable from one minted at registration -
 * there is no "admin code" concept and no way to tell the two apart later.
 */
export function mintReferralCode(): string {
  return `BH-${randomBytes(8).toString('hex').toUpperCase()}`;
}

/** The public link a code produces. One spelling, shared by Admin and the user. */
export function referralLinkFor(code: string): string {
  return `/auth?mode=signup&ref=${encodeURIComponent(code)}`;
}

/**
 * WHICH ACCOUNTS MAY HOLD A CODE.
 *
 * Everybody who can sign in can invite; there is no role gate on referral in
 * this product, and inventing one here would contradict the sign-up path,
 * which mints a code for every account regardless of role. Platform
 * administrators are the exception - an administrator inviting accounts that
 * then reward the administrator is a conflict the product should not create.
 */
export function canHoldReferralCode(user: { role?: string | null }): boolean {
  return user.role !== 'admin';
}

/**
 * ONE GROUPED QUERY PER FACT, NEVER ONE PER ROW.
 *
 * Attributed / qualified / rewarded for a page of owners. A count computed per
 * row would be twenty-five round trips for a screen that shows twenty-five
 * lines, and the page grows.
 */
async function countsForOwners(db: Db, ownerIds: number[]) {
  const empty = { attributed: 0, qualified: 0, rewarded: 0 };
  if (ownerIds.length === 0) return new Map<number, typeof empty>();

  const [referralRows, rewardRows] = await Promise.all([
    db.select({
      referrerId: referrals.referrerId,
      attributed: sql<number>`count(*)`,
      // QUALIFIED means reached qualification, which 'rewarded' also has.
      // Counting only rows whose status is literally 'qualified' would make
      // the qualified figure FALL as referrals succeeded.
      qualified: sql<number>`sum(case when ${referrals.status} in ('qualified','rewarded') then 1 else 0 end)`,
    }).from(referrals).where(inArray(referrals.referrerId, ownerIds)).groupBy(referrals.referrerId),
    db.select({
      recipientUserId: referralRewards.recipientUserId,
      rewarded: sql<number>`count(*)`,
    }).from(referralRewards)
      // A reversed or rejected grant is not a reward this code earned. The
      // ledger keeps the row; the headline count does not claim it.
      .where(and(
        inArray(referralRewards.recipientUserId, ownerIds),
        inArray(referralRewards.status, ['PENDING', 'GRANTED', 'EXPIRED'] as any),
      ))
      .groupBy(referralRewards.recipientUserId),
  ]);

  const out = new Map<number, { attributed: number; qualified: number; rewarded: number }>();
  for (const id of ownerIds) out.set(id, { ...empty });
  for (const row of referralRows) {
    const entry = out.get(Number(row.referrerId));
    if (entry) {
      entry.attributed = Number(row.attributed ?? 0);
      entry.qualified = Number(row.qualified ?? 0);
    }
  }
  for (const row of rewardRows) {
    const entry = out.get(Number(row.recipientUserId));
    if (entry) entry.rewarded = Number(row.rewarded ?? 0);
  }
  return out;
}

export type ReferralCodeFilter = 'all' | 'active' | 'disabled' | 'missing';

/**
 * THE ADMIN DIRECTORY OF CODES.
 *
 * Server-side search, filter and pagination, for the reason the referral list
 * beside it already learned the hard way: a filter applied to a truncated page
 * answers "no matches" with confidence when the match is on the next one.
 *
 * `missing` is a real operational state and the reason the Issue action
 * exists - an account that somehow has no code cannot be invited to invite.
 */
export async function listReferralCodes(db: Db, query: {
  page: number; pageSize: number; search?: string; status?: ReferralCodeFilter;
}) {
  const term = (query.search ?? '').trim();
  const status = query.status ?? 'all';

  const filters = [
    // Administrators are not in this directory at all: they cannot hold a
    // code, so listing them under a "missing code" filter would invite an
    // administrator to issue themselves one.
    sql`${users.role} <> 'admin'`,
    status === 'missing' ? sql`(${users.referralCode} is null or ${users.referralCode} = '')` : null,
    status === 'active' ? and(sql`${users.referralCode} is not null`, eq(users.referralCodeStatus, 'active')) : null,
    status === 'disabled' ? and(sql`${users.referralCode} is not null`, eq(users.referralCodeStatus, 'disabled')) : null,
    term ? or(
      like(users.referralCode, containsTerm(term)),
      like(users.name, containsTerm(term)),
      like(users.email, containsTerm(term)),
      like(users.username, containsTerm(term)),
    ) : null,
  ].filter(Boolean) as any[];
  const where = and(...filters);

  const [totalRow] = await db.select({ n: count() }).from(users).where(where);
  const rows = await db.select({
    userId: users.id,
    code: users.referralCode,
    codeStatus: users.referralCodeStatus,
    issuedAt: users.referralCodeIssuedAt,
    ownerName: users.name,
    ownerEmail: users.email,
    ownerUsername: users.username,
    ownerRole: users.userRole,
    accountStatus: users.accountStatus,
    verified: users.verified,
    joinedAt: users.createdAt,
  }).from(users)
    .where(where)
    // Codes that exist first, newest account first inside that. An account
    // with no code is an action waiting to be taken, not a row to bury - the
    // `missing` filter is how an administrator goes and finds them.
    .orderBy(desc(users.createdAt))
    .limit(query.pageSize)
    .offset(query.page * query.pageSize);

  const counts = await countsForOwners(db, rows.map((row: any) => Number(row.userId)));

  return {
    total: Number(totalRow?.n ?? 0),
    rows: rows.map((row: any) => ({
      ...row,
      // A LINK ONLY WHERE THERE IS A CODE, and only where it would work. A
      // disabled code still has a link shape, and offering it for copying
      // would hand somebody a URL that attributes nothing.
      link: row.code && row.codeStatus === 'active' ? referralLinkFor(row.code) : null,
      ...(counts.get(Number(row.userId)) ?? { attributed: 0, qualified: 0, rewarded: 0 }),
    })),
  };
}

/** The lifecycle history of one account's code. Newest first. */
export async function referralCodeHistory(db: Db, userId: number, limit = 50) {
  return db.select({
    id: referralCodeEvents.id,
    action: referralCodeEvents.action,
    previousCode: referralCodeEvents.previousCode,
    newCode: referralCodeEvents.newCode,
    reason: referralCodeEvents.reason,
    createdAt: referralCodeEvents.createdAt,
    actorId: referralCodeEvents.actorId,
    actorName: codeEventActor.name,
  }).from(referralCodeEvents)
    .leftJoin(codeEventActor, eq(codeEventActor.id, referralCodeEvents.actorId))
    .where(eq(referralCodeEvents.userId, userId))
    .orderBy(desc(referralCodeEvents.createdAt))
    .limit(limit);
}

async function loadOwner(db: Db, userId: number) {
  const [owner] = await db.select({
    id: users.id, role: users.role, referralCode: users.referralCode,
    referralCodeStatus: users.referralCodeStatus,
  }).from(users).where(eq(users.id, userId)).limit(1);
  if (!owner) throw new ReferralCodeError('NOT_FOUND', 'Account not found');
  if (!canHoldReferralCode(owner)) {
    throw new ReferralCodeError('BAD_REQUEST',
      'Platform administrators do not hold referral codes.');
  }
  return owner;
}

/**
 * A code that no other account already holds.
 *
 * `users.referralCode` carries no unique constraint - it never has - so
 * uniqueness is checked rather than assumed. Sixteen hex characters collide
 * about as often as never, which is exactly why a silent collision would be
 * the kind of defect nobody finds for a year: two accounts sharing a code
 * means attribution picks one of them arbitrarily.
 */
async function mintUnusedCode(db: Db): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = mintReferralCode();
    const [clash] = await db.select({ id: users.id }).from(users)
      .where(eq(users.referralCode, candidate)).limit(1);
    if (!clash) return candidate;
  }
  throw new ReferralCodeError('CONFLICT', 'Could not mint an unused referral code. Try again.');
}

/** Issue a code to an account that has none. Never overwrites a working one. */
export async function issueReferralCode(db: Db, params: { userId: number; actorId: number }) {
  const owner = await loadOwner(db, params.userId);
  if (owner.referralCode) {
    // Overwriting here would silently rotate somebody's live link under a
    // label that says "issue". Rotation is its own action, with its own
    // confirmation and its own required reason.
    throw new ReferralCodeError('CONFLICT',
      'This account already has a referral code. Use rotate to replace it.');
  }
  const code = await mintUnusedCode(db);
  const now = new Date();
  await db.update(users)
    .set({ referralCode: code, referralCodeStatus: 'active', referralCodeIssuedAt: now })
    .where(eq(users.id, params.userId));
  await db.insert(referralCodeEvents).values({
    userId: params.userId, action: 'issued', newCode: code, actorId: params.actorId,
  });
  return { code, link: referralLinkFor(code), status: 'active' as const, issuedAt: now };
}

/**
 * Replace a working code with a new one.
 *
 * THE OLD LINK STOPS WORKING. That is the point, and it is why a reason is
 * required: anything already printed, posted or emailed carrying the old code
 * attributes nothing from this moment, and the history row is the only
 * remaining record of what that string was.
 */
export async function rotateReferralCode(db: Db, params: { userId: number; actorId: number; reason: string }) {
  const reason = params.reason.trim();
  if (reason.length === 0) {
    throw new ReferralCodeError('BAD_REQUEST',
      'A reason is required: rotating stops every link already carrying the old code.');
  }
  const owner = await loadOwner(db, params.userId);
  if (!owner.referralCode) {
    throw new ReferralCodeError('CONFLICT', 'This account has no referral code to rotate. Issue one instead.');
  }
  const code = await mintUnusedCode(db);
  const now = new Date();
  await db.update(users)
    .set({ referralCode: code, referralCodeStatus: 'active', referralCodeIssuedAt: now })
    .where(eq(users.id, params.userId));
  await db.insert(referralCodeEvents).values({
    userId: params.userId, action: 'rotated',
    previousCode: owner.referralCode, newCode: code, reason, actorId: params.actorId,
  });
  return { code, link: referralLinkFor(code), previousCode: owner.referralCode, status: 'active' as const, issuedAt: now };
}

/**
 * Turn a code off, or back on.
 *
 * ALREADY-EARNED REFERRALS AND REWARDS ARE UNTOUCHED. Disabling stops future
 * attribution; it does not reach back and revoke what a real person already
 * did. Reversing a granted reward is a separate, separately audited action
 * with its own reason.
 */
export async function setReferralCodeStatus(db: Db, params: {
  userId: number; actorId: number; status: ReferralCodeStatus; reason: string;
}) {
  const reason = params.reason.trim();
  if (reason.length === 0) {
    throw new ReferralCodeError('BAD_REQUEST', 'A reason is required and is recorded in the code history.');
  }
  const owner = await loadOwner(db, params.userId);
  if (!owner.referralCode) {
    throw new ReferralCodeError('CONFLICT', 'This account has no referral code.');
  }
  if (owner.referralCodeStatus === params.status) {
    throw new ReferralCodeError('CONFLICT', `This code is already ${params.status}.`);
  }
  await db.update(users).set({ referralCodeStatus: params.status }).where(eq(users.id, params.userId));
  await db.insert(referralCodeEvents).values({
    userId: params.userId,
    action: params.status === 'disabled' ? 'disabled' : 'reactivated',
    previousCode: owner.referralCode, newCode: owner.referralCode,
    reason, actorId: params.actorId,
  });
  return { code: owner.referralCode, status: params.status };
}

/**
 * THE REFERRAL PROGRAMME, IN NUMBERS THAT WERE COUNTED.
 *
 * Every figure here is a COUNT(*) over a real table. There is no funnel
 * instrumentation for link visits in this product, so there is no visit or
 * click figure - an invented conversion rate would be the exact defect the
 * platform statistics work removed from the front door.
 */
export async function referralOverview(db: Db) {
  const [codeRow] = await db.select({
    issued: sql<number>`sum(case when ${users.referralCode} is not null and ${users.referralCode} <> '' then 1 else 0 end)`,
    active: sql<number>`sum(case when ${users.referralCode} is not null and ${users.referralCode} <> '' and ${users.referralCodeStatus} = 'active' then 1 else 0 end)`,
    disabled: sql<number>`sum(case when ${users.referralCode} is not null and ${users.referralCode} <> '' and ${users.referralCodeStatus} = 'disabled' then 1 else 0 end)`,
    missing: sql<number>`sum(case when ${users.referralCode} is null or ${users.referralCode} = '' then 1 else 0 end)`,
  }).from(users).where(sql`${users.role} <> 'admin'`);

  const [referralRow] = await db.select({
    attributed: sql<number>`count(*)`,
    qualified: sql<number>`sum(case when ${referrals.status} in ('qualified','rewarded') then 1 else 0 end)`,
    rewarded: sql<number>`sum(case when ${referrals.status} = 'rewarded' then 1 else 0 end)`,
  }).from(referrals);

  const rewardRows = await db.select({
    status: referralRewards.status,
    n: sql<number>`count(*)`,
  }).from(referralRewards).groupBy(referralRewards.status);

  const byStatus: Record<string, number> = {};
  for (const row of rewardRows) byStatus[String(row.status)] = Number(row.n ?? 0);

  return {
    codes: {
      issued: Number(codeRow?.issued ?? 0),
      active: Number(codeRow?.active ?? 0),
      disabled: Number(codeRow?.disabled ?? 0),
      missing: Number(codeRow?.missing ?? 0),
    },
    referrals: {
      attributed: Number(referralRow?.attributed ?? 0),
      qualified: Number(referralRow?.qualified ?? 0),
      rewarded: Number(referralRow?.rewarded ?? 0),
    },
    rewards: {
      granted: byStatus.GRANTED ?? 0,
      pending: byStatus.PENDING ?? 0,
      expired: byStatus.EXPIRED ?? 0,
      reversed: byStatus.REVERSED ?? 0,
      rejected: byStatus.REJECTED ?? 0,
    },
  };
}
