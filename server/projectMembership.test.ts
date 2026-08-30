/**
 * THE PROJECT TEAM MODEL, TESTED BY BEHAVIOUR.
 *
 * WHY THIS FILE EXISTS. When the membership model first went in, the existing
 * suite went green and a mutation run then showed seven of eleven deliberate
 * defects surviving untouched:
 *
 *   - the capability check could be deleted entirely and nothing failed
 *   - a REMOVED member could keep full access and nothing failed
 *   - a contractor could be given the customer's finance rights and nothing failed
 *   - a viewer could be given `manage` and nothing failed
 *   - raising an RFQ against a project stopped needing `commercial`, silently
 *   - the project owner became removable from their own project, silently
 *   - ownership became grantable to anyone, silently
 *
 * The old tests only ever proved owner-versus-stranger, which the previous
 * ownership-predicate model already did. Everything the new model ADDS - that
 * being ON a project is not the same as being able to do anything to it - was
 * unverified. Each test below exists to kill one of those mutations.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';
import { requireProjectAccess, liveMembership } from './projectMembership';
import { projectRoleCan, capabilitiesFor, PROJECT_ROLES } from '../shared/projectAccess';
// The shared transaction double. rfq.create takes a SELECT ... FOR UPDATE
// on the actor's row and probes for a recent duplicate; hand-rolling that
// per suite is how six of them broke last time.
import { withTransaction } from './testSupport/txDouble';

function makeCtx(userId: number, userRole = 'homeowner'): TrpcContext {
  return {
    user: {
      id: userId, openId: `u-${userId}`, email: `u${userId}@test.com`, name: `User ${userId}`,
      loginMethod: 'manus', role: 'user', userRole, accountStatus: 'active', isDummy: false,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  };
}

/** A builder that is awaitable AND chainable, like the real one. */
function chainOf(rows: unknown[]) {
  const chain: any = {
    limit: () => chain,
    orderBy: () => chain,
    innerJoin: () => ({ where: () => chain, orderBy: () => chain }),
    then: (res: any, rej?: any) => Promise.resolve(rows).then(res, rej),
  };
  return chain;
}

/** Returns resultsByCall[n] for the n-th select(). */
function queue(resultsByCall: unknown[][]) {
  let call = 0;
  return vi.fn(() => ({
    from: () => ({
      where: () => chainOf(resultsByCall[call++] ?? []),
      innerJoin: () => ({ where: () => chainOf(resultsByCall[call++] ?? []) }),
    }),
  }));
}

// ══ 1. THE MATRIX ═════════════════════════════════════════════════════════
//
// Pure functions, asserted cell by cell. These kill "a contractor gains
// finance" and "a viewer gains manage" - both of which change only the table.

describe('what each project role may do', () => {
  it('only the owner and the manager hold manage, finance and commercial', () => {
    for (const role of PROJECT_ROLES) {
      const privileged = role === 'owner' || role === 'manager';
      expect(projectRoleCan(role, 'manage'), `${role}.manage`).toBe(privileged);
      expect(projectRoleCan(role, 'finance'), `${role}.finance`).toBe(privileged);
      expect(projectRoleCan(role, 'commercial'), `${role}.commercial`).toBe(privileged);
    }
  });

  it('a contractor works on the job but cannot read the customer’s spend', () => {
    expect(projectRoleCan('contractor', 'read')).toBe(true);
    expect(projectRoleCan('contractor', 'report')).toBe(true);
    // The point of a separate `finance` capability.
    expect(projectRoleCan('contractor', 'finance')).toBe(false);
    expect(projectRoleCan('architect', 'finance')).toBe(false);
    expect(projectRoleCan('engineer', 'finance')).toBe(false);
  });

  it('a supplier sees the job but does not file its progress', () => {
    expect(projectRoleCan('supplier', 'read')).toBe(true);
    expect(projectRoleCan('supplier', 'report')).toBe(false);
  });

  it('a viewer reads and nothing else - that is the whole role', () => {
    expect(capabilitiesFor('viewer')).toEqual(['read']);
  });

  it('every role can read, or it would not be a membership at all', () => {
    for (const role of PROJECT_ROLES) {
      expect(projectRoleCan(role, 'read'), `${role}.read`).toBe(true);
    }
  });
});

// ══ 2. THE GATE ═══════════════════════════════════════════════════════════
//
// requireProjectAccess exercised directly. Kills "the capability is never
// checked" and "a REMOVED member still counts as current".

describe('requireProjectAccess', () => {
  const OTHERS = [{ id: 1, ownerId: 999 }];

  it('lets the owner through for every capability', async () => {
    for (const capability of ['read', 'report', 'finance', 'manage', 'commercial'] as const) {
      const db = { select: queue([[{ id: 1, ownerId: 42 }]]) };
      await expect(requireProjectAccess(db, 1, 42, capability)).resolves.toMatchObject({ projectRole: 'owner' });
    }
  });

  it('REFUSES a member whose role lacks the capability, and says which role', async () => {
    // A contractor is genuinely on the project - `read` succeeds - and is
    // still refused `finance`. Without this, deleting the capability check
    // changes nothing observable.
    const readDb = { select: queue([OTHERS, [{ projectRole: 'contractor' }]]) };
    await expect(requireProjectAccess(readDb, 1, 42, 'read'))
      .resolves.toMatchObject({ projectRole: 'contractor' });

    const financeDb = { select: queue([OTHERS, [{ projectRole: 'contractor' }]]) };
    await expect(requireProjectAccess(financeDb, 1, 42, 'finance'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a viewer anything beyond reading', async () => {
    for (const capability of ['report', 'finance', 'manage', 'commercial'] as const) {
      const db = { select: queue([OTHERS, [{ projectRole: 'viewer' }]]) };
      await expect(requireProjectAccess(db, 1, 42, capability), capability)
        .rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('a REMOVED member is not a member - refused, and told nothing', async () => {
    // liveMembership filters on removedAt IS NULL, so the membership lookup
    // finds nothing for someone who was taken off the job.
    const db = { select: queue([OTHERS, []]) };
    await expect(requireProjectAccess(db, 1, 42, 'read'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  /**
   * THE ONE RULE A DOUBLE CANNOT PROVE, AND WHAT IS DONE ABOUT IT.
   *
   * `removedAt IS NULL` lives in the WHERE clause, so whether it is there
   * changes which rows the DATABASE returns - not what the helper does with
   * them. A mock hands back whatever the fixture says regardless, so deleting
   * the filter is invisible to any test built on one. A mutation run proved
   * exactly that: this was the single survivor of eleven.
   *
   * Two responses, because neither alone is enough:
   *
   *   HERE, the clause is pinned in both functions that need it. This is a
   *   source assertion and is honestly weaker than behaviour - it proves the
   *   wiring, not the effect.
   *
   *   IN THE LIVE SUITE, against real MariaDB, a member is added, removed, and
   *   then shown to be refused. That is the real proof and it is the one that
   *   would catch a WHERE clause that was present but wrong.
   */
  it('both membership lookups exclude members who were removed', () => {
    const source = readFileSync(new URL('./projectMembership.ts', import.meta.url), 'utf8');

    const live = source.slice(source.indexOf('export async function liveMembership'));
    const liveBody = live.slice(0, live.indexOf('\n}'));
    expect(liveBody, 'liveMembership must not treat a removed member as current')
      .toContain('isNull(projectMembers.removedAt)');

    const readable = source.slice(source.indexOf('export async function readableProjectIds'));
    const readableBody = readable.slice(0, readable.indexOf('\n}'));
    expect(readableBody, 'a removed member must not keep the project in their list')
      .toContain('isNull(projectMembers.removedAt)');
  });

  it('a stranger and a missing project are answered identically', async () => {
    const missing = { select: queue([[]]) };
    const notMine = { select: queue([OTHERS, []]) };
    const a = await requireProjectAccess(missing, 1, 42, 'read').catch(e => e.code);
    const b = await requireProjectAccess(notMine, 1, 42, 'read').catch(e => e.code);
    expect(a).toBe('NOT_FOUND');
    expect(b).toBe('NOT_FOUND');
    expect(a, 'guessing ids must not distinguish the two').toBe(b);
  });
});

// ══ 3. THE TEAM PROCEDURES ════════════════════════════════════════════════
//
// Kills "the owner can be removed" and "ownership becomes grantable".

describe('managing the team', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ownership cannot be granted to anyone', async () => {
    const db = {
      select: queue([[{ id: 1, ownerId: 42 }]]),
      insert: () => ({ values: vi.fn() }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    await expect(
      appRouter.createCaller(makeCtx(42)).projects.addMember({ projectId: 1, userId: 7, projectRole: 'owner' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('the owner cannot be removed from their own project', async () => {
    const update = vi.fn().mockReturnValue({ set: () => ({ where: vi.fn().mockResolvedValue([]) }) });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
      select: queue([[{ id: 1, ownerId: 42 }]]),
      update,
    });
    await expect(
      appRouter.createCaller(makeCtx(42)).projects.removeMember({ projectId: 1, userId: 42 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(update, 'nothing may be written on a refused removal').not.toHaveBeenCalled();
  });

  it('a member without manage cannot add anyone', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
      select: queue([[{ id: 1, ownerId: 999 }], [{ projectRole: 'contractor' }]]),
      insert: () => ({ values: vi.fn() }),
    });
    await expect(
      appRouter.createCaller(makeCtx(42)).projects.addMember({ projectId: 1, userId: 7, projectRole: 'engineer' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// ══ 4. THE COMMERCIAL GATE ════════════════════════════════════════════════
//
// Kills "linking an RFQ to a project no longer needs commercial".

describe('raising an RFQ against a project', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a contractor on the job cannot commit it to spend', async () => {
    const values = vi.fn();
    const insert = vi.fn().mockReturnValue({ values });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction({
      select: queue([[{ id: 7, ownerId: 999 }], [{ projectRole: 'contractor' }]]),
      insert,
    }));
    await expect(
      appRouter.createCaller(makeCtx(42, 'contractor'))
        .rfq.create({ category: 'Materials', title: 'Cement', projectId: 7 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(values, 'no RFQ may be written on a refusal').not.toHaveBeenCalled();
  });

  it('a project manager on the job CAN - the positive control', async () => {
    const values = vi.fn().mockResolvedValue([{ insertId: 55 }]);
    const insert = vi.fn().mockReturnValue({ values });
    // The transaction handle needs the same surface as the connection: the
    // RFQ body reads inside the transaction as well as writing.
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction({
      select: queue([[{ id: 7, ownerId: 999 }], [{ projectRole: 'manager' }]]),
      insert,
    }));
    await expect(
      appRouter.createCaller(makeCtx(42, 'project_manager'))
        .rfq.create({ category: 'Materials', title: 'Cement', projectId: 7 }),
    ).resolves.toEqual({ id: 55 });
  });
});
