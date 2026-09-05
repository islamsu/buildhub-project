import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';

import { ADMIN_DIRECTORY_COLUMNS } from './adminUserDirectory';

/**
 * A db that answers the directory's three parallel reads: the page of rows,
 * its total, and the grouped counts. Every one returns nothing, because these
 * tests are about authorization and shape, not about data.
 */
function directoryDb() {
  const chain: any = {
    from: () => chain, where: () => chain, orderBy: () => chain, groupBy: () => chain,
    limit: () => chain, offset: () => chain,
    then: (resolve: (v: any) => void) => resolve([]),
  };
  return { select: () => chain };
}

/**
 * Where `name:` is declared in the router source, whatever tier follows it.
 *
 * Anchors used to read `name: adminProcedure`. Endpoints now sit behind the
 * permission they need - `adminWith('marketplace.manage')` - so a literal anchor
 * silently matched nothing, indexOf returned -1, and slice produced ''. Every
 * `expect(block).not.toMatch(...)` on that empty string then passed vacuously.
 * This throws instead, so a moved procedure breaks the test rather than hollowing
 * it out.
 */
function declarationOf(source: string, name: string): number {
  const at = source.search(new RegExp(`\\n\\s*${name}:\\s*(?:\\w+Procedure|adminWith\\()`));
  if (at === -1) throw new Error(`procedure ${name} not found in the router source`);
  return at;
}


function makeCtx(userId: number, role: 'user' | 'admin' = 'user', userRole = 'homeowner'): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@test.com`,
      name: `User ${userId}`,
      loginMethod: 'manus',
      role,
      // migration 0020: an admin row must now say WHICH administrator it is.
      adminRole: role === 'admin' ? 'SUPER_ADMIN' : null,
      userRole,
      accountStatus: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: {} as TrpcContext['res'],
  };
}

function makeAnonCtx(): TrpcContext {
  return { user: null, req: { protocol: 'https', headers: {} } as TrpcContext['req'], res: {} as TrpcContext['res'] };
}

// A full, unfiltered row shape - what the real users table row looks like,
// used to prove the mock db is capable of returning every sensitive field and
// that admin.users' own query is what filters them out, not an accident of
// the test's mock shape.
const FULL_ROW = {
  id: 20,
  name: 'Target User',
  email: 'target@example.com',
  username: 'targetuser',
  role: 'user',
  userRole: 'contractor',
  accountStatus: 'frozen',
  frozenReason: 'Suspicious activity',
  verified: true,
  isDummy: true,
  accountSource: 'admin_created',
  invitationStatus: 'password_set',
  createdAt: new Date('2025-01-01'),
  // Sensitive/internal fields that a real row would also carry, and that
  // admin.users must never return:
  passwordHash: 'scrypt$deadbeef$0123456789abcdef',
  invitationToken: 'super-secret-invite-token-xyz789',
  invitationExpiresAt: new Date('2025-02-01'),
  invitationSentAt: new Date('2025-01-01'),
  passwordSetAt: new Date('2025-01-02'),
  onboardingReviewNotes: 'internal reviewer note',
  creationNote: 'internal creation note',
  createdBy: 3,
  onboardingReviewedBy: 3,
  deactivatedAt: null,
  frozenAt: new Date('2025-01-05'),
  phone: '0100000000',
  bio: 'some bio',
  location: 'Cairo',
  avatar: null,
  rating: '4.50',
  reviewCount: 2,
  openId: 'dummy_target',
  loginMethod: 'dummy',
  onboardingStatus: 'not_started',
  updatedAt: new Date('2025-01-01'),
  lastSignedIn: new Date('2025-01-01'),
};

/**
 * THE ALLOWLIST MOVED, SO THESE CHECKS FOLLOW IT - AND GET STRONGER.
 *
 * Phase 4A.6.7 introduced ADMIN_USER_LIST_COLUMNS inside routers.ts and these
 * tests read it back out of the file as TEXT. The directory has since been
 * extracted to server/adminUserDirectory.ts so that filtering, sorting, paging
 * and counting happen in the database rather than in the browser over a
 * truncated 250-row page, and the allowlist went with it as
 * ADMIN_DIRECTORY_COLUMNS.
 *
 * Asserting the exported OBJECT rather than the file's text is not a
 * relaxation. A text search for 'passwordHash' passes if the column is spelled
 * differently, passes if it arrives through a spread, and fails on a reformat
 * that changes nothing. Reading the real object catches all three.
 */
describe('admin.users - response shape (Phase 4A.6.7)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only the approved allowlist of fields', () => {
    expect(Object.keys(ADMIN_DIRECTORY_COLUMNS).sort()).toEqual(
      ['accountSource', 'accountStatus', 'createdAt', 'email', 'frozenReason', 'id', 'invitationStatus', 'isDummy', 'name', 'role', 'userRole', 'username', 'verified'].sort()
    );
  });

  it('passwordHash is absent from the allowlist', () => {
    expect(ADMIN_DIRECTORY_COLUMNS).not.toHaveProperty('passwordHash');
  });

  it('invitationToken is absent from the allowlist', () => {
    expect(ADMIN_DIRECTORY_COLUMNS).not.toHaveProperty('invitationToken');
  });

  it('other unnecessary internal/credential fields are absent from the allowlist', () => {
    for (const forbidden of ['invitationExpiresAt', 'invitationSentAt', 'passwordSetAt', 'onboardingReviewNotes',
      'creationNote', 'createdBy', 'onboardingReviewedBy', 'deactivatedAt', 'frozenAt', 'phone', 'bio', 'location',
      'avatar', 'openId', 'rating', 'reviewCount', 'loginMethod', 'onboardingStatus', 'updatedAt', 'lastSignedIn']) {
      expect(ADMIN_DIRECTORY_COLUMNS, `${forbidden} reached the admin user list`).not.toHaveProperty(forbidden);
    }
  });

  it('never uses select().from(users) with no column list for the admin user list query', () => {
    // The rule Phase 4A.6.7 wrote next to the allowlist, following it to the
    // module that now owns the query.
    const source = readFileSync(new URL('./adminUserDirectory.ts', import.meta.url), 'utf8');
    expect(source).toContain('ADMIN_DIRECTORY_COLUMNS');
    expect(source).not.toMatch(/select\(\)\.from\(users\)/);
    // And routers.ts no longer runs its own unlisted read of the table.
    const routers = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const usersProcBlock = routers.slice(declarationOf(routers, 'users'), declarationOf(routers, 'createUser'));
    expect(usersProcBlock).not.toMatch(/select\(\)\.from\(users\)/);
  });

  it('every field genuinely required by the Admin User Management UI remains available', () => {
    for (const required of ['id', 'name', 'email', 'username', 'role', 'userRole', 'accountStatus',
      'frozenReason', 'verified', 'isDummy', 'accountSource', 'invitationStatus', 'createdAt']) {
      expect(ADMIN_DIRECTORY_COLUMNS).toHaveProperty(required);
    }
  });
});

describe('admin.users - authorization (Phase 4A.6.7)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a non-admin (homeowner) is rejected with FORBIDDEN', async () => {
    const caller = appRouter.createCaller(makeCtx(1, 'user', 'homeowner'));
    await expect(caller.admin.users()).rejects.toThrow();
  });

  it('a non-admin provider is rejected with FORBIDDEN', async () => {
    const caller = appRouter.createCaller(makeCtx(1, 'user', 'contractor'));
    await expect(caller.admin.users()).rejects.toThrow();
  });

  it('an unauthenticated caller is rejected', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.admin.users()).rejects.toThrow();
  });

  /**
   * THE RULE IS "NO WAY TO TARGET ANOTHER ID", AND IT STILL HOLDS.
   *
   * This used to be enforced as "takes no input at all", which was a proxy for
   * the rule rather than the rule. The directory now accepts search, group,
   * sort, page and pageSize so that filtering and paging happen in the
   * database instead of the browser over a truncated page - none of which
   * names an account.
   *
   * The invariant is asserted directly now: no id-shaped parameter, so there
   * is still nothing to point at somebody else. Note what did NOT change - the
   * procedure is still gated on `users.read`, and it still returns only the
   * allowlisted columns for accounts that permission already covers. Paging
   * reaches rows that used to be unreachable past the 250th; it does not
   * reach rows the caller was not entitled to.
   */
  it('takes no id-shaped parameter, so it cannot become an IDOR', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const usersProcBlock = source.slice(declarationOf(source, 'users'), declarationOf(source, 'createUser'));
    for (const idShaped of ['userId', 'targetId', 'accountId', 'ownerId', 'id:']) {
      expect(usersProcBlock, `${idShaped} appeared in the directory input`).not.toContain(idShaped);
    }
  });

  it('an admin session succeeds', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(directoryDb());
    const caller = appRouter.createCaller(makeCtx(1, 'admin'));
    const page = await caller.admin.users();
    expect(page.rows).toEqual([]);
    expect(page.total).toBe(0);
    // A real empty directory reports zero, not an absent count.
    expect(page.counts.all).toBe(0);
  });
});

describe('admin user-management workflows still work unmodified (Phase 4A.6.7 regression)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('setUserFrozen, setDummyUserActive, and deleteDummyUser are untouched (still present and adminProcedure-gated)', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const adminBlock = source.slice(source.indexOf('const adminRouter = router({'), source.indexOf('// ── AI Router'));
    expect(adminBlock).toContain('setUserFrozen: adminWith(');
    expect(adminBlock).toContain('setDummyUserActive: adminWith(');
    expect(adminBlock).toContain('deleteDummyUser: adminWith(');
    expect(adminBlock).toContain("setDummyUserPassword: adminWith('qa.manage')");
  });

  it('accountAudit (the audit trail query) is untouched', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    expect(source).toContain('accountAudit: adminWith(');
  });
});

// ── Who may read the whole `users` row ─────────────────────────────────────
//
// Phase 4A.6.7 introduced ADMIN_USER_LIST_COLUMNS for admin.users and wrote the
// rule next to it: never `select().from(users)`, so a future edit cannot
// silently start returning a private column. The rule was never enforced
// anywhere, and one endpoint over, admin.fullAuditReport was doing exactly
// that - pulling every column of every user, passwordHash included, into
// memory to build an audit export. It projected an allowlist on the way out,
// so nothing leaked; the next person to write `...targetUser` would have
// shipped it.
//
// This is the enforcement. `select().from(users)` is allowed only where the
// FULL ROW is genuinely the point - authentication needs the hash, invitation
// redemption needs the token - and every such place is named with its reason.
describe('the full users row is read only where it is genuinely needed', () => {
  const ROUTERS_SOURCE = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');

  const MAY_READ_THE_WHOLE_ROW: Record<string, string> = {
    'auth.redeemTestLoginLink': 'Redemption re-checks isDummy, accountStatus and the token state on the row itself before establishing a session.',
    'auth.resetPassword': 'Password reset compares and rewrites passwordHash, which is the whole point of the row.',
    'auth.completeAdminInvitation': 'Invitation completion verifies the invitation token and sets the first password.',
    'admin.completeInvitation': 'Same flow from the administrator side.',
    'admin.reviewComplianceDocument': 'Reads the applicant row to recompute onboarding status across every requirement.',
    'admin.updateApplicantStatus': 'Same, for a whole-applicant decision.',
    'admin.bulkUpdateApplicantStatus': 'Same again across a selected set; each applicant row is re-checked for a compliance role before the bulk write.',
    'admin.setDummyUserPassword': 'Writes passwordHash on a QA persona after re-checking isDummy on the row.',
    'admin.setDummyUserActive': 'Re-checks isDummy and the freeze fields on the row before flipping them.',
    'admin.deleteDummyUser': 'Re-checks isDummy on the row before destroying it.',
    'admin.issueTestLoginLink': 'Re-checks isDummy and account state before minting a credential.',
    'admin.resendInvitation': 'Reads the invitation fields to decide whether a resend is valid.',
  };

  function procedureAt(index: number): string {
    // Walk backwards to the nearest procedure declaration, and forwards to the
    // router it sits in, so an offender is NAMED rather than just counted.
    const before = ROUTERS_SOURCE.slice(0, index);
    const routerMatch = [...before.matchAll(/const (\w+)Router = router\(\{/g)].pop();
    const procMatch = [...before.matchAll(/\n {2}(\w+): (?:(?:public|protected|admin|superAdmin|approvedProvider|compliance|aiChat)Procedure|adminWith\()/g)].pop();
    return `${routerMatch ? routerMatch[1] : '?'}.${procMatch ? procMatch[1] : '?'}`;
  }

  it('every bare select().from(users) is on the allowlist, with a reason', () => {
    const offenders: string[] = [];
    for (const match of ROUTERS_SOURCE.matchAll(/db\.select\(\)\.from\(users\)/g)) {
      const where = procedureAt(match.index!);
      if (!(where in MAY_READ_THE_WHOLE_ROW)) offenders.push(where);
    }
    expect(offenders, 'reads every user column without a stated reason').toEqual([]);
  });

  it('the scan finds the reads it is meant to police', () => {
    // A regex that stops matching would pass this suite for the wrong reason.
    const count = [...ROUTERS_SOURCE.matchAll(/db\.select\(\)\.from\(users\)/g)].length;
    expect(count).toBeGreaterThanOrEqual(5);
  });

  it('REGRESSION: admin.fullAuditReport uses a column list', () => {
    const start = ROUTERS_SOURCE.indexOf("fullAuditReport: adminWith('audit.read')");
    expect(start).toBeGreaterThan(-1);
    // Bounded at the NEXT procedure. A fixed 2000-character slice ran into
    // createDummyUser, which legitimately mentions passwordHash - the test
    // failed on its neighbour's code, not on its own.
    const end = ROUTERS_SOURCE.indexOf("\n  createDummyUser:", start);
    expect(end).toBeGreaterThan(start);
    // Comments stripped: the explanation that replaced the defect names the
    // column it was leaking, and a raw source assertion trips on its own
    // documentation. Same trap, third time - so it is worth naming here.
    const body = ROUTERS_SOURCE.slice(start, end)
      .split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    expect(body).not.toContain('db.select().from(users)');
    expect(body).toContain('accountStatus: users.accountStatus');
    expect(body).not.toContain('passwordHash');
  });

  it('every allowlist entry names a procedure that still exists', () => {
    for (const name of Object.keys(MAY_READ_THE_WHOLE_ROW)) {
      const [, procedure] = name.split('.');
      expect(ROUTERS_SOURCE, `${name} is allowlisted but gone`).toContain(`\n  ${procedure}: `);
    }
  });

  it('every allowlist reason is a reason', () => {
    for (const [name, why] of Object.entries(MAY_READ_THE_WHOLE_ROW)) {
      expect(why.length, name).toBeGreaterThan(30);
    }
  });
});
