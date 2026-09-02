/**
 * ── WHO MAY ACT ON AN ADMINISTRATOR, AND WHAT MUST ALWAYS REMAIN ──────────
 *
 * Two invariants that no endpoint may break, held in one place so that adding
 * an endpoint cannot quietly break them somewhere else.
 *
 * INVARIANT 1 — ADMINISTRATORS ARE MANAGED IN ADMIN MANAGEMENT.
 *
 * `users.manage` is the permission for running the USER directory: verifying
 * accounts, freezing a fraudulent vendor, correcting a name. USER_ADMIN holds
 * it. It is NOT authority over the platform's own operators.
 *
 * The hole this closes was real and reachable: `admin.setUserFrozen` is gated
 * on `users.manage`, takes any userId, and refused only the caller's own
 * account. A USER_ADMIN could therefore freeze every Super Admin in turn and
 * leave BuildHub with no one able to create an administrator, change a role, or
 * unfreeze anybody with the authority to do so - a state recoverable only by
 * direct database access. Freezing an administrator is an ADMIN MANAGEMENT act
 * and now requires `admins.manage`, which SUPER_ADMIN alone holds.
 *
 * INVARIANT 2 — AT LEAST ONE SUPER ADMIN MUST REMAIN ABLE TO SIGN IN.
 *
 * Demotion, deactivation and freezing are each individually reasonable and
 * collectively capable of emptying the role. Every one of them is checked
 * against the same count, so the last one always fails, whichever path it
 * arrives by.
 *
 * WHY "ABLE TO SIGN IN" AND NOT SIMPLY "EXISTS".
 *
 * An invited Super Admin who has never redeemed their link has no password
 * hash, and `adminSignIn` treats a null hash as no account at all. Counting
 * them would let an administrator demote the only WORKING Super Admin while a
 * dormant invitation sat in the table, and the platform would be locked out
 * with the check reporting everything fine. The count therefore requires an
 * account that could actually be used today.
 */
import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { users } from '../drizzle/schema';
import { hasAdminPermission } from '@shared/adminRoles';

/**
 * THE ADMINISTRATOR SIGN-IN ELIGIBILITY RULES, AS ONE LIST.
 *
 * These are the conditions `auth.adminSignIn` applies before it will issue a
 * session, restated here as data so the survival count and the sign-in path
 * cannot drift apart. server/adminAuthority.test.ts compares this list against
 * the real adminSignIn source and fails if either side grows a rule the other
 * lacks.
 *
 * The drift this closes was real and mine: the first version of
 * countUsableSuperAdmins omitted `isDummy`. A QA persona carrying
 * role='admin', adminRole='SUPER_ADMIN' and a password hash would have been
 * COUNTED as a usable Super Admin while adminSignIn refused it outright - so
 * the guard would have allowed removing the last REAL Super Admin because a
 * test account appeared to be holding the fort.
 */
export const ADMIN_SIGN_IN_ELIGIBILITY = [
  'isDummy',          // QA personas can never hold administrator authority
  'passwordHash',     // a null hash is treated as no account at all
  'role',             // must be an administrator
  'adminRole',        // ...with a real role assigned
  'accountStatus',    // active
  'deactivatedAt',    // and not deactivated
] as const;

type Db = { select: (...args: never[]) => unknown } & Record<string, unknown>;

export const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

/** The message the Admin UI shows. Named so the test and the UI cannot drift. */
export const LAST_SUPER_ADMIN_MESSAGE = 'At least one active Super Admin is required.';

export const ADMIN_TARGET_MESSAGE =
  'Administrator accounts are managed in Admin Management, which requires the administrators permission.';

/**
 * Super Admins who could sign in right now.
 *
 * `excludeUserId` asks the question the caller actually has: "if I do this to
 * THIS person, is anybody left?" - answered by counting everyone else, which is
 * both simpler and safer than counting first and subtracting.
 */
export async function countUsableSuperAdmins(
  db: unknown,
  excludeUserId?: number,
): Promise<number> {
  // EVERY CONDITION adminSignIn APPLIES, in the same order as
  // ADMIN_SIGN_IN_ELIGIBILITY above. "Usable" must mean "could actually sign in
  // right now" - anything looser counts an account that cannot hold the fort.
  const conditions = [
    // A QA persona is never an administrator, however its columns read.
    eq(users.isDummy, false),
    // Never redeemed their invitation: no password hash, so adminSignIn treats
    // them as no account. A dormant invitation is not a safety net.
    isNotNull(users.passwordHash),
    eq(users.role, 'admin'),
    eq(users.adminRole, SUPER_ADMIN_ROLE),
    eq(users.accountStatus, 'active'),
    isNull(users.deactivatedAt),
  ];
  if (excludeUserId != null) conditions.push(ne(users.id, excludeUserId));

  const [row] = await (db as { select: Function }).select({ total: sql<number>`count(*)` })
    .from(users)
    .where(and(...conditions)) as { total: number }[];
  return Number(row?.total ?? 0);
}

/**
 * Refuse an action that would leave zero usable Super Admins.
 *
 * Called for DEMOTION, DEACTIVATION and FREEZING alike. The three are different
 * words for the same consequence when applied to the last one, so they share a
 * check rather than each carrying their own slightly different version of it.
 */
export async function assertSuperAdminSurvives(
  db: unknown,
  target: { id: number; role: string | null; adminRole: string | null },
): Promise<void> {
  // Only removing a Super Admin can reduce the count.
  if (target.role !== 'admin' || target.adminRole !== SUPER_ADMIN_ROLE) return;
  const remaining = await countUsableSuperAdmins(db, target.id);
  if (remaining === 0) {
    throw new TRPCError({ code: 'CONFLICT', message: LAST_SUPER_ADMIN_MESSAGE });
  }
}

/**
 * Refuse a USER-directory action aimed at an ADMINISTRATOR account.
 *
 * The caller's permissions are passed in rather than inferred, so this is
 * usable from any procedure without it having to know how tiers are wired.
 */
export function assertMayActOnAdminTarget(
  actorAdminRole: string | null | undefined,
  target: { role: string | null },
): void {
  if (target.role !== 'admin') return;   // an ordinary user: nothing to guard
  if (hasAdminPermission(actorAdminRole, 'admins.manage')) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: ADMIN_TARGET_MESSAGE });
}

/**
 * The full guard for a user-directory mutation.
 *
 * Both checks, in the order that gives the most useful error: "you may not
 * touch an administrator here" before "and that one is the last Super Admin",
 * because the first is about the caller and the second about the platform.
 */
export async function assertUserDirectoryMutationAllowed(params: {
  db: unknown;
  actorAdminRole: string | null | undefined;
  target: { id: number; role: string | null; adminRole: string | null };
  /** True when the action removes the target's ability to sign in. */
  removesAccess: boolean;
}): Promise<void> {
  assertMayActOnAdminTarget(params.actorAdminRole, params.target);
  if (params.removesAccess) await assertSuperAdminSurvives(params.db, params.target);
}
