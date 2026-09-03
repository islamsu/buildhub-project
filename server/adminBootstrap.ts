// ── First-administrator bootstrap ──────────────────────────────────────────
//
// A freshly migrated BuildHub database contains no administrator, and there is
// no code path in the running application that can mint one: admin.createUser
// is an adminProcedure, registration never sets role='admin', and there is no
// "first user wins" rule. That cycle has to be broken from outside, once.
//
// scripts/create-admin.mjs already does this for an operator with database
// credentials at hand, and it remains the right tool for a machine you can
// reach. It cannot help on Render, where there is no shell before first boot
// and the only channel into the container is its environment.
//
// So this runs at startup, from server-only environment variables:
//
//   ADMIN_BOOTSTRAP_EMAIL
//   ADMIN_BOOTSTRAP_USERNAME
//   ADMIN_BOOTSTRAP_PASSWORD
//
// WHY THIS IS NOT THE BACKDOOR create-admin.mjs WARNS ABOUT
//
// That file's warning is about an env var that AUTO-PROMOTES - a permanent
// privilege-escalation primitive reachable by anyone who can set an env var or
// guess an email. Three properties keep this from being that:
//
//   1. It only ever creates the FIRST administrator. If any row already has
//      role='admin', this returns immediately and touches nothing. It cannot
//      promote an existing account, cannot re-role anyone, and cannot reset a
//      password. A running platform with an admin is inert to it.
//   2. It creates a NEW account from the supplied identity. It does not look
//      for a matching user and elevate them, so setting the variable to
//      somebody else's email grants that person nothing.
//   3. It never becomes a request handler. There is no endpoint, no route and
//      no client-facing surface - the only trigger is process start.
//
// NEVER prefix these VITE_. Vite inlines VITE_-prefixed variables into the
// client bundle at build time, which would publish the bootstrap password to
// every visitor. The staging QA gate greps the delivered page for exactly this
// class of mistake.

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { getDb } from './db';
import { users } from '../drizzle/schema';
import { hashPassword } from './passwords';
import { recordAccountEvent } from './_core/accountAudit';

/** Reported to the caller so startup can log what happened without guessing. */
export type BootstrapOutcome =
  | { outcome: 'created'; username: string }
  | { outcome: 'already-exists' }
  | { outcome: 'not-configured' }
  | { outcome: 'invalid'; reason: string }
  | { outcome: 'unavailable' };

const MIN_BOOTSTRAP_PASSWORD_LENGTH = 12;

/**
 * Create the first administrator if, and only if, there is not already one.
 *
 * Idempotent by construction: the existence check is on `role = 'admin'` across
 * the whole table, so a restart, a redeploy, a crash loop, or three containers
 * booting at once all converge on "an admin exists" without ever modifying the
 * one that does. The unique indexes on username and email are the backstop if
 * two processes race past the check simultaneously - the loser's INSERT fails
 * and is reported as already-exists rather than crashing the boot.
 */
export async function bootstrapFirstAdmin(): Promise<BootstrapOutcome> {
  const email = (process.env.ADMIN_BOOTSTRAP_EMAIL ?? '').trim().toLowerCase();
  const username = (process.env.ADMIN_BOOTSTRAP_USERNAME ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? '';

  // Absent is the normal case, not an error: every deployment after the first
  // should have these unset.
  if (!email && !username && !password) return { outcome: 'not-configured' };

  if (!email || !username || !password) {
    return { outcome: 'invalid', reason: 'ADMIN_BOOTSTRAP_EMAIL, ADMIN_BOOTSTRAP_USERNAME and ADMIN_BOOTSTRAP_PASSWORD must all be set together' };
  }
  if (!/^[a-z0-9._-]{3,100}$/.test(username)) {
    return { outcome: 'invalid', reason: 'ADMIN_BOOTSTRAP_USERNAME must be 3-100 characters of letters, numbers, dots, underscores or hyphens' };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { outcome: 'invalid', reason: 'ADMIN_BOOTSTRAP_EMAIL is not a valid email address' };
  }
  // Longer than the 8 a normal account needs. This one credential can reach
  // every administrative capability on the platform.
  if (password.length < MIN_BOOTSTRAP_PASSWORD_LENGTH) {
    return { outcome: 'invalid', reason: `ADMIN_BOOTSTRAP_PASSWORD must be at least ${MIN_BOOTSTRAP_PASSWORD_LENGTH} characters` };
  }

  const db = await getDb();
  if (!db) return { outcome: 'unavailable' };

  // THE IDEMPOTENCE GATE. Any administrator at all - not one matching this
  // email - means the platform is already bootstrapped and this must do nothing.
  const [existing] = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.role, 'admin'));
  if (Number(existing?.count ?? 0) > 0) return { outcome: 'already-exists' };

  const passwordHash = await hashPassword(password);

  try {
    const result = await db.insert(users).values({
      openId: `local_${randomUUID()}`,
      username,
      email,
      name: 'BuildHub Super Admin',
      role: 'admin',
      adminRole: 'SUPER_ADMIN',
      userRole: 'admin',
      loginMethod: 'password',
      accountSource: 'admin_created',
      isDummy: false,
      accountStatus: 'active',
      // An administrator has no professional onboarding to complete.
      onboardingStatus: 'approved',
      verified: true,
      passwordHash,
      passwordSetAt: new Date(),
    });

    const userId = Number(result[0]?.insertId);
    // actorId is the account itself: nobody else was involved, and leaving it
    // null would read as "system did this for reasons unknown".
    await recordAccountEvent(db, {
      userId,
      actorId: userId,
      action: 'super_admin_bootstrapped',
      source: 'bootstrap',
      // Deliberately records WHICH identity, never the credential.
      note: `First administrator created from environment configuration as ${username}`,
    });

    return { outcome: 'created', username };
  } catch {
    // Almost certainly the unique index on username or email, which means
    // either a concurrent boot won the race or the identity is already taken.
    // Either way an administrator now exists or the operator must choose a
    // different one; neither is a reason to refuse to start.
    return { outcome: 'already-exists' };
  }
}

/**
 * Run the bootstrap and report it, without ever letting it stop the server.
 *
 * A misconfigured bootstrap must not take the whole deployment down - the rest
 * of BuildHub is perfectly serviceable without an administrator, and a boot
 * loop would be a far worse failure than a missing admin account.
 *
 * Nothing here logs the password, or any value derived from it.
 */
export async function runAdminBootstrap(): Promise<BootstrapOutcome> {
  let result: BootstrapOutcome;
  try {
    result = await bootstrapFirstAdmin();
  } catch (error) {
    console.error('[bootstrap] Administrator bootstrap failed:', (error as Error)?.message ?? error);
    return { outcome: 'unavailable' };
  }

  switch (result.outcome) {
    case 'created':
      console.log(`[bootstrap] Created the first administrator (${result.username}). Unset ADMIN_BOOTSTRAP_* now - it is inert from here on.`);
      break;
    case 'already-exists':
      console.log('[bootstrap] An administrator already exists; bootstrap did nothing.');
      break;
    case 'invalid':
      console.error(`[bootstrap] ADMIN_BOOTSTRAP_* is set but unusable: ${result.reason}`);
      break;
    case 'unavailable':
      console.error('[bootstrap] Database unavailable; skipped administrator bootstrap.');
      break;
    case 'not-configured':
      break;
  }
  return result;
}
