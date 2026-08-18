import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';

function makeCtx(userId: number, userRole: string = 'homeowner', role: 'user' | 'admin' = 'user'): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@test.com`,
      name: `User ${userId}`,
      loginMethod: 'manus',
      role,
      userRole,
      accountStatus: 'active',
      isDummy: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  };
}

// Builds a fake db.select() chain that returns `resultsByCall[n]` for the n-th select() call,
// supporting both the direct-await ownership check (`await db.select()...where(...)`) and the
// chained resource listing (`...where(...).orderBy(...)`) and the updateTask join
// (`...from(tasks).innerJoin(projects, ...).where(...)`) shapes used across the router.
function queueSelects(resultsByCall: unknown[][]) {
  let call = 0;
  return vi.fn(() => {
    const rows = resultsByCall[call++] ?? [];
    const chain: PromiseLike<unknown[]> & { orderBy: ReturnType<typeof vi.fn> } = {
      orderBy: vi.fn().mockResolvedValue(rows),
      then: (resolve: any, reject?: any) => Promise.resolve(rows).then(resolve, reject),
    } as any;
    return {
      from: () => ({
        where: () => chain,
        innerJoin: () => ({ where: () => chain }),
      }),
    };
  });
}

function makeInsertSpy() {
  const values = vi.fn().mockResolvedValue([{ insertId: 1 }]);
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values };
}

function makeUpdateSpy() {
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { update, set, where };
}

const OWNED_PROJECT = [{ id: 1 }];
const NOT_OWNED = [] as unknown[];

describe('projects.milestones / addMilestone', () => {
  beforeEach(() => vi.clearAllMocks());

  it('owner can read milestones', async () => {
    const select = queueSelects([OWNED_PROJECT, [{ id: 5, title: 'Foundation' }]]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select });
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.projects.milestones({ projectId: 1 })).resolves.toEqual([{ id: 5, title: 'Foundation' }]);
  });

  it('non-owner cannot read milestones', async () => {
    const select = queueSelects([NOT_OWNED]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select });
    const caller = appRouter.createCaller(makeCtx(99));
    await expect(caller.projects.milestones({ projectId: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('owner can create a milestone', async () => {
    const select = queueSelects([OWNED_PROJECT]);
    const { insert, values } = makeInsertSpy();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select, insert });
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.projects.addMilestone({ projectId: 1, title: 'Roof' })).resolves.toEqual({ success: true });
    expect(values).toHaveBeenCalledTimes(1);
  });

  it('non-owner cannot create a milestone', async () => {
    const select = queueSelects([NOT_OWNED]);
    const { insert, values } = makeInsertSpy();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select, insert });
    const caller = appRouter.createCaller(makeCtx(99));
    await expect(caller.projects.addMilestone({ projectId: 1, title: 'Roof' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(values).not.toHaveBeenCalled();
  });
});

describe('projects.tasks / addTask / updateTask', () => {
  beforeEach(() => vi.clearAllMocks());

  it('owner can read tasks', async () => {
    const select = queueSelects([OWNED_PROJECT, [{ id: 7, title: 'Wire kitchen' }]]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select });
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.projects.tasks({ projectId: 1 })).resolves.toEqual([{ id: 7, title: 'Wire kitchen' }]);
  });

  it('non-owner cannot read tasks', async () => {
    const select = queueSelects([NOT_OWNED]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select });
    const caller = appRouter.createCaller(makeCtx(99));
    await expect(caller.projects.tasks({ projectId: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('owner can create a task', async () => {
    const select = queueSelects([OWNED_PROJECT]);
    const { insert, values } = makeInsertSpy();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select, insert });
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.projects.addTask({ projectId: 1, title: 'Paint walls' })).resolves.toEqual({ success: true });
    expect(values).toHaveBeenCalledTimes(1);
  });

  it('non-owner cannot create a task', async () => {
    const select = queueSelects([NOT_OWNED]);
    const { insert, values } = makeInsertSpy();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select, insert });
    const caller = appRouter.createCaller(makeCtx(99));
    await expect(caller.projects.addTask({ projectId: 1, title: 'Paint walls' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(values).not.toHaveBeenCalled();
  });

  it('owner can update a task on their project (joined through tasks -> projects)', async () => {
    const select = queueSelects([[{ ownerId: 1 }]]);
    const { update, where } = makeUpdateSpy();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select, update });
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.projects.updateTask({ id: 42, status: 'done' })).resolves.toEqual({ success: true });
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('non-owner cannot update a task belonging to someone else\'s project', async () => {
    const select = queueSelects([[{ ownerId: 1 }]]); // task exists, owned by user 1
    const { update, where } = makeUpdateSpy();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select, update });
    const caller = appRouter.createCaller(makeCtx(99)); // attacker is user 99
    await expect(caller.projects.updateTask({ id: 42, status: 'done' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(where).not.toHaveBeenCalled();
  });

  it('cannot update a nonexistent task (no leak between not-found and forbidden)', async () => {
    const select = queueSelects([[]]); // task/project join finds nothing
    const { update, where } = makeUpdateSpy();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select, update });
    const caller = appRouter.createCaller(makeCtx(99));
    await expect(caller.projects.updateTask({ id: 9999, status: 'done' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(where).not.toHaveBeenCalled();
  });
});

describe('projects.expenses / addExpense', () => {
  beforeEach(() => vi.clearAllMocks());

  it('owner can read expenses', async () => {
    const select = queueSelects([OWNED_PROJECT, [{ id: 3, amount: '500.00' }]]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select });
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.projects.expenses({ projectId: 1 })).resolves.toEqual([{ id: 3, amount: '500.00' }]);
  });

  it('non-owner cannot read expenses (financial data)', async () => {
    const select = queueSelects([NOT_OWNED]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select });
    const caller = appRouter.createCaller(makeCtx(99));
    await expect(caller.projects.expenses({ projectId: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('owner can add an expense', async () => {
    const select = queueSelects([OWNED_PROJECT]);
    const { insert, values } = makeInsertSpy();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select, insert });
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.projects.addExpense({ projectId: 1, amount: 250 })).resolves.toEqual({ success: true });
    expect(values).toHaveBeenCalledTimes(1);
  });

  it('non-owner cannot add an expense to someone else\'s project', async () => {
    const select = queueSelects([NOT_OWNED]);
    const { insert, values } = makeInsertSpy();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select, insert });
    const caller = appRouter.createCaller(makeCtx(99));
    await expect(caller.projects.addExpense({ projectId: 1, amount: 250 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(values).not.toHaveBeenCalled();
  });
});

describe('projects.dailyLogs / addDailyLog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('owner can read daily logs', async () => {
    const select = queueSelects([OWNED_PROJECT, [{ id: 9, description: 'Poured concrete' }]]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select });
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.projects.dailyLogs({ projectId: 1 })).resolves.toEqual([{ id: 9, description: 'Poured concrete' }]);
  });

  it('non-owner cannot read daily logs', async () => {
    const select = queueSelects([NOT_OWNED]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select });
    const caller = appRouter.createCaller(makeCtx(99));
    await expect(caller.projects.dailyLogs({ projectId: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('owner can add a daily log', async () => {
    const select = queueSelects([OWNED_PROJECT]);
    const { insert, values } = makeInsertSpy();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select, insert });
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.projects.addDailyLog({ projectId: 1, description: 'Site visit' })).resolves.toEqual({ success: true });
    expect(values).toHaveBeenCalledTimes(1);
  });

  it('non-owner cannot add a daily log', async () => {
    const select = queueSelects([NOT_OWNED]);
    const { insert, values } = makeInsertSpy();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select, insert });
    const caller = appRouter.createCaller(makeCtx(99));
    await expect(caller.projects.addDailyLog({ projectId: 1, description: 'Site visit' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(values).not.toHaveBeenCalled();
  });
});

describe('no implicit admin/provider bypass on project sub-resources', () => {
  beforeEach(() => vi.clearAllMocks());

  // The codebase has no participants/engagement table and no contractorId on projects - the
  // only ownership rule that exists anywhere in this router is strict projects.ownerId
  // matching (see projects.documents/progressReports). Admins manage compliance and system
  // settings elsewhere (adminRouter) but were never granted a bypass here, so this asserts
  // that stays true rather than silently regressing into an unintended admin superpower.
  it('an admin-role user who does not own the project is still denied', async () => {
    const select = queueSelects([NOT_OWNED]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select });
    const caller = appRouter.createCaller(makeCtx(2, 'admin', 'admin'));
    await expect(caller.projects.milestones({ projectId: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a provider-role user who does not own the project is still denied', async () => {
    const select = queueSelects([NOT_OWNED]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select });
    const caller = appRouter.createCaller(makeCtx(2, 'contractor'));
    await expect(caller.projects.expenses({ projectId: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
