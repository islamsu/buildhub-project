import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * ── THE PROJECT AN RFQ WAS RAISED FOR ─────────────────────────────────────
 *
 * `rfqs.projectId` has been written since the RFQ form gained its project
 * selector, and `rfq.get` has always returned it - as a bare integer that
 * nothing rendered. A buyer running four projects could link a request to one
 * of them and then open that request's own page and find no mention of which.
 *
 * The fix resolves the project to a NAME, and the only interesting question is
 * WHEN it may do so. Linking happened at creation; membership can be withdrawn
 * afterwards, and removal is supposed to revoke access. So the rule asserted
 * here is that the title is resolved through the SAME canonical access check
 * every other project read goes through - never off `projectId` alone, which
 * would turn the RFQ page into a way to keep reading the name of a project
 * somebody has been removed from.
 */

vi.mock('./db', () => ({ getDb: vi.fn() }));

const canAccessProject = vi.fn();
vi.mock('./projectMembership', async importOriginal => ({
  ...(await importOriginal<typeof import('./projectMembership')>()),
  canAccessProject: (...args: unknown[]) => canAccessProject(...args),
}));

import { appRouter } from './routers';
import { getDb } from './db';
import type { TrpcContext } from './_core/context';

const OWNER = 42;

const ctx = (id: number): TrpcContext => ({
  user: {
    id, openId: `u${id}`, email: `u${id}@t.com`, name: 'U', username: `u${id}`,
    loginMethod: 'password', role: 'user', userRole: 'homeowner',
    accountStatus: 'active', onboardingStatus: 'approved', isDummy: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as TrpcContext['user'],
  req: { protocol: 'https', headers: {} } as TrpcContext['req'],
  res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
});

/**
 * `rfq.get` reads three things in order: the RFQ, its items, then - only if it
 * gets that far - the project. Serving them by call order lets the third read
 * be observed, which is the whole point: a test that returned the same row to
 * every query could not tell a resolved title from a skipped lookup.
 */
function stubDb(rfqRow: Record<string, unknown> | null, projectRow?: Record<string, unknown>) {
  const reads: string[][] = [];
  let call = 0;
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
    select: vi.fn((projection?: Record<string, unknown>) => {
      reads.push(Object.keys(projection ?? {}));
      const which = call++;
      const rows = which === 0 ? (rfqRow ? [rfqRow] : [])
        : which === 1 ? []
        : projectRow ? [projectRow] : [];
      const thenable = () => {
        const p = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>;
        p.orderBy = () => Promise.resolve(rows);
        p.limit = () => Promise.resolve(rows);
        return p;
      };
      return { from: () => ({ where: () => thenable(), orderBy: () => thenable() }) };
    }),
  });
  return { reads, projectWasRead: () => call > 2 };
}

const LINKED = {
  id: 7, requesterId: OWNER, projectId: 9, title: 'Villa finishing',
  description: null, category: 'finishing', budget: null, location: null,
  deadline: null, productReference: null, status: 'open', createdAt: new Date(),
};
const UNLINKED = { ...LINKED, projectId: null };

beforeEach(() => { canAccessProject.mockReset(); });

describe('rfq.get resolves the linked project only through the access check', () => {
  it('names the project when the buyer can still read it', async () => {
    canAccessProject.mockResolvedValue(true);
    stubDb(LINKED, { id: 9, title: 'Marina Villa' });
    const result = await appRouter.createCaller(ctx(OWNER)).rfq.get({ id: 7 });
    expect(result.project).toEqual({ id: 9, title: 'Marina Villa' });
    expect(result.projectLinked).toBe(true);
  });

  it('asks the CANONICAL check, for read, about that project and that user', async () => {
    // Not a bespoke ownerId comparison living in the router: the same function
    // every other project read authorizes through, or the two drift apart.
    canAccessProject.mockResolvedValue(true);
    stubDb(LINKED, { id: 9, title: 'Marina Villa' });
    await appRouter.createCaller(ctx(OWNER)).rfq.get({ id: 7 });
    expect(canAccessProject).toHaveBeenCalledTimes(1);
    const [, projectId, userId, capability] = canAccessProject.mock.calls[0];
    expect(projectId).toBe(9);
    expect(userId).toBe(OWNER);
    expect(capability).toBe('read');
  });

  it('withholds the name once access is gone, and NEVER reads the row', async () => {
    // The security assertion. `project: null` is not enough on its own - if the
    // title were read and then dropped, a later edit could start returning it.
    canAccessProject.mockResolvedValue(false);
    const { projectWasRead } = stubDb(LINKED, { id: 9, title: 'Marina Villa' });
    const result = await appRouter.createCaller(ctx(OWNER)).rfq.get({ id: 7 });
    expect(result.project).toBeNull();
    expect(projectWasRead()).toBe(false);
  });

  it('but still says the link EXISTS, so the page can say so honestly', async () => {
    // The buyer created this link. Telling them it is there and no longer
    // theirs to open is the truth; rendering nothing would look like an RFQ
    // that was never linked to anything.
    canAccessProject.mockResolvedValue(false);
    stubDb(LINKED);
    const result = await appRouter.createCaller(ctx(OWNER)).rfq.get({ id: 7 });
    expect(result.projectLinked).toBe(true);
  });

  it('an unlinked RFQ asks nothing and claims no link', async () => {
    stubDb(UNLINKED);
    const result = await appRouter.createCaller(ctx(OWNER)).rfq.get({ id: 7 });
    expect(result.project).toBeNull();
    expect(result.projectLinked).toBe(false);
    expect(canAccessProject).not.toHaveBeenCalled();
  });

  it('reads only id and title - an RFQ page is not a project read', async () => {
    canAccessProject.mockResolvedValue(true);
    const { reads } = stubDb(LINKED, { id: 9, title: 'Marina Villa' });
    await appRouter.createCaller(ctx(OWNER)).rfq.get({ id: 7 });
    expect(reads[reads.length - 1].sort()).toEqual(['id', 'title']);
  });
});
