import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';

function makeCtx(userId: number, userRole: string = 'homeowner'): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@test.com`,
      name: `User ${userId}`,
      loginMethod: 'manus',
      role: 'user',
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

function makeDb(opts: {
  project?: { id: number; ownerId: number; status: string } | null;
  reviewee?: { id: number; userRole: string } | null;
  existingReview?: { id: number } | null;
}) {
  let call = 0;
  const sequence = [
    opts.project === undefined ? [{ id: 1, ownerId: 1, status: 'completed' }] : (opts.project ? [opts.project] : []),
    opts.reviewee === undefined ? [{ id: 20, userRole: 'contractor' }] : (opts.reviewee ? [opts.reviewee] : []),
    opts.existingReview === undefined ? [] : (opts.existingReview ? [opts.existingReview] : []),
  ];
  const select = vi.fn(() => ({
    from: () => ({
      where: () => Promise.resolve(sequence[call++] ?? []),
    }),
  }));
  const values = vi.fn().mockResolvedValue([{ insertId: 1 }]);
  const insert = vi.fn().mockReturnValue({ values });
  return { select, insert, values };
}

describe('reviews.submit (live production route)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the project owner can review the provider on their completed project', async () => {
    const db = makeDb({ project: { id: 1, ownerId: 1, status: 'completed' }, reviewee: { id: 20, userRole: 'contractor' }, existingReview: null });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 20, rating: 5 })).resolves.toEqual({ success: true });
    expect(db.values).toHaveBeenCalledTimes(1);
  });

  it('an unrelated user (knows the project ID but does not own it) is rejected', async () => {
    const db = makeDb({ project: null }); // project 1 is not owned by the caller (query filters ownerId)
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(999));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 20, rating: 1, comment: 'sabotage' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.values).not.toHaveBeenCalled();
  });

  it('rejects reviews on a project that is not completed', async () => {
    const db = makeDb({ project: null }); // and(status='completed') filters this out too
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 20, rating: 5 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.values).not.toHaveBeenCalled();
  });

  it('duplicate review for the same project/reviewer/reviewee is rejected', async () => {
    const db = makeDb({ project: { id: 1, ownerId: 1, status: 'completed' }, reviewee: { id: 20, userRole: 'contractor' }, existingReview: { id: 55 } });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 20, rating: 5 })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(db.values).not.toHaveBeenCalled();
  });

  it('self-review is rejected', async () => {
    const db = makeDb({ project: { id: 1, ownerId: 1, status: 'completed' } });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 1, rating: 5 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.values).not.toHaveBeenCalled();
  });

  it('an invalid reviewee (nonexistent user) is rejected', async () => {
    const db = makeDb({ project: { id: 1, ownerId: 1, status: 'completed' }, reviewee: null });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 9999, rating: 5 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.values).not.toHaveBeenCalled();
  });

  it('an invalid reviewee (a homeowner, not a service provider) is rejected', async () => {
    const db = makeDb({ project: { id: 1, ownerId: 1, status: 'completed' }, reviewee: { id: 21, userRole: 'homeowner' } });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 21, rating: 5 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.values).not.toHaveBeenCalled();
  });

  it('there is no update/delete endpoint - unauthorized modification of an existing review is structurally impossible', () => {
    expect((appRouter._def.procedures as Record<string, unknown>)['reviews.update']).toBeUndefined();
    expect((appRouter._def.procedures as Record<string, unknown>)['reviews.delete']).toBeUndefined();
  });
});
