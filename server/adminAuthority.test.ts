/**
 * THE TWO WAYS BUILDHUB COULD LOSE ITS OWN CONTROL PLANE.
 *
 * Both were reachable before this module existed, and neither is the kind of
 * bug a feature test finds - each needs somebody to ask "what is the worst
 * sequence of individually reasonable actions?"
 *
 *   1. A USER_ADMIN freezes every Super Admin. `admin.setUserFrozen` is gated
 *      on `users.manage`, accepted any userId, and refused only the caller's
 *      own account. Afterwards nobody can create an administrator, change a
 *      role, or unfreeze the people who could - recoverable only by direct
 *      database access.
 *
 *   2. Two Super Admins demote each other. Each call is legal on its own; the
 *      self-check does not see the pair.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import {
  ADMIN_SIGN_IN_ELIGIBILITY,
  ADMIN_TARGET_MESSAGE,
  LAST_SUPER_ADMIN_MESSAGE,
  assertMayActOnAdminTarget,
  assertSuperAdminSurvives,
  assertUserDirectoryMutationAllowed,
  countUsableSuperAdmins,
} from './adminAuthority';

/**
 * A fake driver that records the WHERE it was handed and returns a count.
 *
 * The conditions are asserted, not just the number: a count query that forgot
 * `passwordHash IS NOT NULL` would return a comfortable 1 for an account that
 * cannot sign in, and the platform would lock itself out while this test
 * reported everything fine.
 */
function makeDb(total: number) {
  const seen: string[] = [];
  const render = (condition: unknown): string => {
    const out: string[] = [];
    const walk = (node: any) => {
      if (node == null) return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node === 'string') { out.push(node); return; }
      if (typeof node === 'object') {
        if (typeof node.name === 'string' && node.table) out.push(node.name);
        if (Array.isArray(node.value)) node.value.forEach((v: unknown) => {
          if (typeof v === 'string') out.push(v);
        });
        for (const key of ['queryChunks', 'conditions', 'left', 'right', 'value']) {
          if (key in node) walk(node[key]);
        }
      }
    };
    walk(condition);
    return out.join(',');
  };
  const db: any = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          seen.push(render(condition));
          return Promise.resolve([{ total }]);
        },
      }),
    }),
  };
  return { db, seen };
}

const superAdmin = { id: 7, role: 'admin', adminRole: 'SUPER_ADMIN' };
const subAdmin = { id: 8, role: 'admin', adminRole: 'USER_ADMIN' };
const ordinaryUser = { id: 9, role: 'user', adminRole: null };

// ── Invariant 1: administrators are managed in Admin Management ────────────

describe('the user directory does not administer administrators', () => {
  it('a USER_ADMIN cannot act on an administrator account', () => {
    expect(() => assertMayActOnAdminTarget('USER_ADMIN', subAdmin))
      .toThrow(ADMIN_TARGET_MESSAGE);
  });

  it('nor can MARKETPLACE_ADMIN, SUPPORT_ADMIN or BILLING_ADMIN', () => {
    for (const role of ['MARKETPLACE_ADMIN', 'SUPPORT_ADMIN', 'BILLING_ADMIN']) {
      expect(() => assertMayActOnAdminTarget(role, superAdmin), role).toThrow(TRPCError);
    }
  });

  it('a SUPER_ADMIN can, because it holds admins.manage', () => {
    expect(() => assertMayActOnAdminTarget('SUPER_ADMIN', subAdmin)).not.toThrow();
  });

  it('AN ORDINARY USER TARGET IS UNAFFECTED - this is not a blanket denial', () => {
    // The rule must not break the user directory it is protecting. Freezing a
    // fraudulent vendor is exactly what users.manage is for.
    expect(() => assertMayActOnAdminTarget('USER_ADMIN', ordinaryUser)).not.toThrow();
    expect(() => assertMayActOnAdminTarget('SUPPORT_ADMIN', ordinaryUser)).not.toThrow();
  });

  it('an unknown or absent admin role is refused against an admin target', () => {
    expect(() => assertMayActOnAdminTarget(null, superAdmin)).toThrow(TRPCError);
    expect(() => assertMayActOnAdminTarget(undefined, superAdmin)).toThrow(TRPCError);
    expect(() => assertMayActOnAdminTarget('NOT_A_ROLE', superAdmin)).toThrow(TRPCError);
  });
});

// ── Invariant 2: one usable Super Admin always remains ─────────────────────

describe('BuildHub cannot be left without a usable Super Admin', () => {
  it('refuses when removing this one would leave zero', async () => {
    const { db } = makeDb(0);
    await expect(assertSuperAdminSurvives(db, superAdmin))
      .rejects.toThrow(LAST_SUPER_ADMIN_MESSAGE);
  });

  it('allows it when another usable Super Admin remains', async () => {
    const { db } = makeDb(1);
    await expect(assertSuperAdminSurvives(db, superAdmin)).resolves.toBeUndefined();
  });

  it('THE COUNT EXCLUDES THE TARGET, so two Super Admins cannot demote each other', async () => {
    // The pair case the self-check cannot see. Asking "is anybody left BESIDES
    // this person" is what makes the second demotion fail.
    const { db, seen } = makeDb(0);
    await expect(assertSuperAdminSurvives(db, superAdmin)).rejects.toThrow(TRPCError);
    expect(seen.join(' ')).toContain('id');
  });

  it('does not fire for a NON-Super-Admin target', async () => {
    // Demoting a USER_ADMIN cannot reduce the Super Admin count, and blocking
    // it would make the guard an obstacle rather than a protection.
    const { db, seen } = makeDb(0);
    await expect(assertSuperAdminSurvives(db, subAdmin)).resolves.toBeUndefined();
    expect(seen, 'it should not even have queried').toHaveLength(0);
  });

  it('does not fire for an ordinary user', async () => {
    const { db } = makeDb(0);
    await expect(assertSuperAdminSurvives(db, ordinaryUser)).resolves.toBeUndefined();
  });

  it('COUNTS ONLY ACCOUNTS THAT COULD ACTUALLY SIGN IN', async () => {
    // The subtle one. An invited Super Admin who never redeemed their link has
    // no password hash, and adminSignIn treats a null hash as no account. If
    // the count included them, the last WORKING Super Admin could be demoted
    // while a dormant invitation sat in the table - locked out, with the guard
    // reporting success.
    const { db, seen } = makeDb(1);
    await countUsableSuperAdmins(db, 7);
    const where = seen.join(' ');
    expect(where).toContain('passwordHash');
    expect(where).toContain('accountStatus');
    expect(where).toContain('deactivatedAt');
    expect(where).toContain('SUPER_ADMIN');
  });
});

// ── The combined guard, as the endpoints call it ───────────────────────────

describe('the user-directory guard applies both invariants in order', () => {
  it('rejects a USER_ADMIN freezing a Super Admin', async () => {
    const { db } = makeDb(5);
    await expect(assertUserDirectoryMutationAllowed({
      db, actorAdminRole: 'USER_ADMIN', target: superAdmin, removesAccess: true,
    })).rejects.toThrow(ADMIN_TARGET_MESSAGE);
  });

  it('rejects a SUPER_ADMIN freezing the LAST Super Admin', async () => {
    const { db } = makeDb(0);
    await expect(assertUserDirectoryMutationAllowed({
      db, actorAdminRole: 'SUPER_ADMIN', target: superAdmin, removesAccess: true,
    })).rejects.toThrow(LAST_SUPER_ADMIN_MESSAGE);
  });

  it('allows a SUPER_ADMIN freezing a Super Admin when others remain', async () => {
    const { db } = makeDb(2);
    await expect(assertUserDirectoryMutationAllowed({
      db, actorAdminRole: 'SUPER_ADMIN', target: superAdmin, removesAccess: true,
    })).resolves.toBeUndefined();
  });

  it('skips the survival check for an action that removes no access', async () => {
    // Verifying an administrator does not take their access away, so the
    // count is irrelevant and must not block it.
    const { db, seen } = makeDb(0);
    await expect(assertUserDirectoryMutationAllowed({
      db, actorAdminRole: 'SUPER_ADMIN', target: superAdmin, removesAccess: false,
    })).resolves.toBeUndefined();
    expect(seen).toHaveLength(0);
  });

  it('leaves ordinary user moderation completely untouched', async () => {
    const { db } = makeDb(0);
    await expect(assertUserDirectoryMutationAllowed({
      db, actorAdminRole: 'USER_ADMIN', target: ordinaryUser, removesAccess: true,
    })).resolves.toBeUndefined();
  });
});

// ── The two definitions of "usable" cannot drift ───────────────────────────

/**
 * THE DRIFT GUARD.
 *
 * `countUsableSuperAdmins` decides whether the last Super Admin may be removed,
 * and it is only as good as its agreement with `auth.adminSignIn`. Two
 * definitions of "this account can be used" WILL diverge - the first version of
 * the count already had: it omitted `isDummy`, so a QA persona with an admin
 * role and a password hash would have been counted as holding the fort while
 * adminSignIn refused it outright.
 *
 * The count and the sign-in path live in different files and cannot share a
 * drizzle condition (one gates an in-memory row, the other builds SQL), so the
 * shared thing is the LIST OF COLUMNS, asserted against both sides here.
 */
describe('"usable Super Admin" tracks the real adminSignIn eligibility rules', () => {
  const ROUTERS = readSource();

  /**
   * The eligibility region of adminSignIn: everything between the candidate
   * being chosen and the session being issued. Sliced deliberately narrowly -
   * after `const sessionToken` the same object is read for `openId`, `name` and
   * `id`, which are not eligibility rules and would make the reverse assertion
   * below meaningless.
   */
  const signInGate = (): string => {
    // ANCHORED ON THE DECLARATION, not on the candidate line. The first draft
    // searched for `const candidate = target && !target.isDummy` directly and
    // landed in the ORDINARY `signIn` procedure, which happens to open with the
    // same line - so it asserted the wrong function and reported adminSignIn as
    // having lost its role checks. The reverse assertion below is what caught
    // it, which is the reason that assertion exists.
    const procedure = ROUTERS.indexOf('  adminSignIn: publicProcedure');
    expect(procedure, 'the adminSignIn declaration must be findable').toBeGreaterThan(-1);
    const start = ROUTERS.indexOf('const candidate =', procedure);
    expect(start, 'the adminSignIn candidate gate must be findable').toBeGreaterThan(procedure);
    const end = ROUTERS.indexOf('const sessionToken', start);
    expect(end, 'the end of the gate must be findable').toBeGreaterThan(start);
    return ROUTERS.slice(start, end);
  };

  const countSource = (): string => {
    const source = readFileSync(new URL('./adminAuthority.ts', import.meta.url), 'utf8');
    const start = source.indexOf('export async function countUsableSuperAdmins');
    expect(start, 'countUsableSuperAdmins must be findable').toBeGreaterThan(-1);
    return source.slice(start, source.indexOf('\nexport ', start + 1));
  };

  it('every declared rule is applied by adminSignIn', () => {
    const gate = signInGate();
    for (const column of ADMIN_SIGN_IN_ELIGIBILITY) {
      expect(new RegExp(`(?:target|candidate)\\??\\.${column}\\b`).test(gate),
        `adminSignIn no longer gates on ${column} - update ADMIN_SIGN_IN_ELIGIBILITY`).toBe(true);
    }
  });

  it('every declared rule is applied by the survival count', () => {
    const count = countSource();
    for (const column of ADMIN_SIGN_IN_ELIGIBILITY) {
      expect(count.includes(`users.${column}`),
        `countUsableSuperAdmins ignores ${column}, so it would count an account that cannot sign in`)
        .toBe(true);
    }
  });

  it('AND ADMINSIGNIN GATES ON NOTHING ELSE - a new rule fails this test', () => {
    // The direction that actually catches drift. The forward checks above stay
    // green if somebody adds `candidate.lockedUntil` to the sign-in path and
    // forgets the count; this one does not.
    const found = new Set(
      [...signInGate().matchAll(/(?:target|candidate)\??\.(\w+)/g)].map(m => m[1]),
    );
    expect([...found].sort()).toEqual([...ADMIN_SIGN_IN_ELIGIBILITY].sort());
  });
});

// ── The endpoints really call it ───────────────────────────────────────────

describe('the guard is wired into the endpoints that can reach the invariant', () => {
  const SOURCE = readSource();

  /**
   * The body of one procedure, cut at DECLARATIONS rather than at bare names.
   *
   * The first version sliced on `SOURCE.indexOf('setUserFrozen:')`, which
   * matched a COMMENT inside verifyUser that mentions setUserFrozen by name -
   * so the slice ended before the code it was meant to inspect and reported a
   * correctly-guarded endpoint as unguarded. A test that dies on prose rather
   * than on behaviour proves nothing, so the boundary is now the declaration
   * pattern `name: <tier>(` at the start of a line.
   */
  const bodyOf = (name: string): string => {
    const declaration = new RegExp(`^  ${name}: (adminWith|superAdminProcedure|adminProcedure)`, 'm');
    const start = SOURCE.search(declaration);
    expect(start, `${name} declaration not found - the sweep must actually locate it`)
      .toBeGreaterThan(-1);
    const rest = SOURCE.slice(start + 1);
    const nextDeclaration = rest.search(/^  \w+: (adminWith|superAdminProcedure|adminProcedure)/m);
    return nextDeclaration === -1 ? rest : rest.slice(0, nextDeclaration);
  };

  it('setUserFrozen consults the guard BEFORE writing', () => {
    const block = bodyOf('setUserFrozen');
    expect(block).toContain('assertUserDirectoryMutationAllowed');
    expect(block.indexOf('assertUserDirectoryMutationAllowed'))
      .toBeLessThan(block.indexOf('db.update(users)'));
  });

  it('verifyUser consults it too', () => {
    const block = bodyOf('verifyUser');
    expect(block).toContain('assertUserDirectoryMutationAllowed');
    expect(block.indexOf('assertUserDirectoryMutationAllowed'))
      .toBeLessThan(block.indexOf('db.update(users)'));
  });

  it('setAdminRole refuses to empty the Super Admin role', () => {
    const block = bodyOf('setAdminRole');
    expect(block).toContain('assertSuperAdminSurvives');
    expect(block.indexOf('assertSuperAdminSurvives')).toBeLessThan(block.indexOf('db.update(users)'));
  });

  it('setAdminActive refuses to empty it either', () => {
    const block = bodyOf('setAdminActive');
    expect(block).toContain('assertSuperAdminSurvives');
    expect(block.indexOf('assertSuperAdminSurvives')).toBeLessThan(block.indexOf('db.update(users)'));
  });
});

function readSource(): string {
  return readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
}
