import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';
import { withTransaction } from './testSupport/txDouble';

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

// db.select() is called, in order, for: (1) the project lookup, (2) the awarded-providers
// lookup (quotations INNER JOIN rfqs, verifying real participation via rfqs.projectId), then
// EITHER nothing more (a match was found in the awarded-providers set) OR (3) the legacy
// provider-role fallback lookup when no RFQ is linked to this project at all, then finally
// (4) the duplicate-review lookup. This chain works for both the plain `.where(...)` shape and
// the `.innerJoin(...).where(...)` shape the awarded-providers query uses.
function makeDb(opts: {
  project?: { id: number; ownerId: number; status: string } | null;
  awardedProviderIds?: number[];
  reviewee?: { id: number; userRole: string } | null;
  existingReview?: { id: number } | null;
}) {
  let call = 0;
  const sequence: unknown[][] = [];
  sequence.push(opts.project === undefined ? [{ id: 1, ownerId: 1, status: 'completed' }] : (opts.project ? [opts.project] : []));
  sequence.push((opts.awardedProviderIds ?? []).map(providerId => ({ providerId })));
  if ((opts.awardedProviderIds ?? []).length === 0) {
    sequence.push(opts.reviewee === undefined ? [{ id: 20, userRole: 'contractor' }] : (opts.reviewee ? [opts.reviewee] : []));
  }
  sequence.push(opts.existingReview === undefined ? [] : (opts.existingReview ? [opts.existingReview] : []));

  const select = vi.fn(() => ({
    from: () => {
      const rows = sequence[call++] ?? [];
      return {
        where: () => Promise.resolve(rows),
        innerJoin: () => ({ where: () => Promise.resolve(rows) }),
      };
    },
  }));
  // Two distinct inserts happen on success: the review row itself, then the reviewee's
  // in-app notification (via notifyUser). Track them separately so tests can assert on each.
  const reviewValues = vi.fn().mockResolvedValue([{ insertId: 1 }]);
  const notificationValues = vi.fn().mockResolvedValue([{ insertId: 2 }]);
  let insertCallCount = 0;
  const insert = vi.fn(() => {
    insertCallCount += 1;
    return { values: insertCallCount === 1 ? reviewValues : notificationValues };
  });
  return {
    select, insert, reviewValues, notificationValues,
    // rfq.create writes inside a transaction now; the callback runs against
    // the same recording insert so the assertions still see the rows.
    transaction: async (cb: (t: unknown) => Promise<unknown>) => cb({ insert }),
  };
}

describe('reviews.submit - baseline authorization (unlinked / legacy projects)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the project owner can review a provider-role reviewee when no RFQ is linked to the project', async () => {
    const db = makeDb({ project: { id: 1, ownerId: 1, status: 'completed' }, awardedProviderIds: [], reviewee: { id: 20, userRole: 'contractor' }, existingReview: null });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction(db));
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 20, rating: 5 })).resolves.toEqual({ success: true });
    expect(db.reviewValues).toHaveBeenCalledTimes(1);
    expect(db.notificationValues).toHaveBeenCalledTimes(1);
  });

  it('an unrelated user (knows the project ID but does not own it) is rejected', async () => {
    const db = makeDb({ project: null });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction(db));
    const caller = appRouter.createCaller(makeCtx(999));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 20, rating: 1, comment: 'sabotage' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.reviewValues).not.toHaveBeenCalled();
    expect(db.notificationValues).not.toHaveBeenCalled();
  });

  it('rejects reviews on a project that is not completed', async () => {
    const db = makeDb({ project: null }); // and(status='completed') filters this out too
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction(db));
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 20, rating: 5 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.reviewValues).not.toHaveBeenCalled();
    expect(db.notificationValues).not.toHaveBeenCalled();
  });

  it('duplicate review for the same project/reviewer/reviewee is rejected', async () => {
    const db = makeDb({ project: { id: 1, ownerId: 1, status: 'completed' }, awardedProviderIds: [], reviewee: { id: 20, userRole: 'contractor' }, existingReview: { id: 55 } });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction(db));
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 20, rating: 5 })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(db.reviewValues).not.toHaveBeenCalled();
    expect(db.notificationValues).not.toHaveBeenCalled();
  });

  it('self-review is rejected', async () => {
    const db = makeDb({ project: { id: 1, ownerId: 1, status: 'completed' }, awardedProviderIds: [] });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction(db));
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 1, rating: 5 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.reviewValues).not.toHaveBeenCalled();
    expect(db.notificationValues).not.toHaveBeenCalled();
  });

  it('an invalid reviewee (nonexistent user) is rejected', async () => {
    const db = makeDb({ project: { id: 1, ownerId: 1, status: 'completed' }, awardedProviderIds: [], reviewee: null });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction(db));
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 9999, rating: 5 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.reviewValues).not.toHaveBeenCalled();
    expect(db.notificationValues).not.toHaveBeenCalled();
  });

  it('an invalid reviewee (a homeowner, not a service provider) is rejected', async () => {
    const db = makeDb({ project: { id: 1, ownerId: 1, status: 'completed' }, awardedProviderIds: [], reviewee: { id: 21, userRole: 'homeowner' } });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction(db));
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 21, rating: 5 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.reviewValues).not.toHaveBeenCalled();
    expect(db.notificationValues).not.toHaveBeenCalled();
  });

  it('notifies the reviewee in-app when a review is successfully submitted', async () => {
    const db = makeDb({ project: { id: 1, ownerId: 1, status: 'completed' }, awardedProviderIds: [], reviewee: { id: 20, userRole: 'contractor' }, existingReview: null });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction(db));
    const caller = appRouter.createCaller(makeCtx(1));
    await caller.reviews.submit({ projectId: 1, revieweeId: 20, rating: 4 });
    expect(db.notificationValues).toHaveBeenCalledWith(expect.objectContaining({ userId: 20, type: 'review' }));
  });

  it('there is no update/delete endpoint - unauthorized modification of an existing review is structurally impossible', () => {
    expect((appRouter._def.procedures as Record<string, unknown>)['reviews.update']).toBeUndefined();
    expect((appRouter._def.procedures as Record<string, unknown>)['reviews.delete']).toBeUndefined();
  });
});

describe('reviews.submit - verified provider participation (RFQ -> awarded quotation -> provider)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('succeeds when the reviewee is the provider of an accepted quotation on an RFQ linked to this project', async () => {
    const db = makeDb({ project: { id: 1, ownerId: 1, status: 'completed' }, awardedProviderIds: [20], existingReview: null });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction(db));
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 20, rating: 5 })).resolves.toEqual({ success: true });
    expect(db.reviewValues).toHaveBeenCalledTimes(1);
    expect(db.notificationValues).toHaveBeenCalledTimes(1);
  });

  it('rejects a reviewee who is NOT among the project\'s awarded providers, even though they are a real provider elsewhere', async () => {
    // Project 1 actually awarded its RFQ to provider 20; caller tries to review provider 30,
    // who never won anything on this project (e.g. a completely unrelated contractor).
    const db = makeDb({ project: { id: 1, ownerId: 1, status: 'completed' }, awardedProviderIds: [20], existingReview: null });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction(db));
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 30, rating: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.reviewValues).not.toHaveBeenCalled();
    expect(db.notificationValues).not.toHaveBeenCalled();
  });

  it('supports multiple legitimately-awarded providers on one project (e.g. separate design + build RFQs)', async () => {
    const db = makeDb({ project: { id: 1, ownerId: 1, status: 'completed' }, awardedProviderIds: [20, 21], existingReview: null });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction(db));
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 21, rating: 4 })).resolves.toEqual({ success: true });
  });

  it('falls back to the provider-role heuristic for a project with no RFQ linked at all (does not block legacy projects)', async () => {
    const db = makeDb({ project: { id: 1, ownerId: 1, status: 'completed' }, awardedProviderIds: [], reviewee: { id: 45, userRole: 'engineer' }, existingReview: null });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction(db));
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.reviews.submit({ projectId: 1, revieweeId: 45, rating: 5 })).resolves.toEqual({ success: true });
  });
});

describe('rfq.create - optional project link', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the project owner can link a new RFQ to their own project', async () => {
    const projectWhere = vi.fn().mockResolvedValue([{ id: 7 }]);
    const values = vi.fn().mockResolvedValue([{ insertId: 99 }]);
    const insert = vi.fn().mockReturnValue({ values });
    const db = {
      select: vi.fn().mockReturnValue({ from: () => ({ where: projectWhere }) }),
      insert,
      // The RFQ and its items are written in one transaction now.
      transaction: async (cb: (t: unknown) => Promise<unknown>) => cb({ insert }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction(db));
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.rfq.create({ category: 'Materials', title: 'Kitchen remodel', projectId: 7 })).resolves.toEqual({ id: 99 });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ projectId: 7, requesterId: 1 }));
  });

  it('rejects linking an RFQ to a project the caller does not own', async () => {
    const projectWhere = vi.fn().mockResolvedValue([]); // ownerId filter excludes it
    const values = vi.fn();
    const insert = vi.fn().mockReturnValue({ values });
    const db = {
      select: vi.fn().mockReturnValue({ from: () => ({ where: projectWhere }) }),
      insert,
      // The RFQ and its items are written in one transaction now.
      transaction: async (cb: (t: unknown) => Promise<unknown>) => cb({ insert }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction(db));
    const caller = appRouter.createCaller(makeCtx(999));
    await expect(caller.rfq.create({ category: 'Materials', title: 'Kitchen remodel', projectId: 7 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(values).not.toHaveBeenCalled();
  });

  it('creating an RFQ without a projectId still works (link remains optional)', async () => {
    const values = vi.fn().mockResolvedValue([{ insertId: 100 }]);
    const insert = vi.fn().mockReturnValue({ values });
    const db = {
      select: vi.fn(),
      insert,
      transaction: async (cb: (t: unknown) => Promise<unknown>) => cb({ insert }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction(db));
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.rfq.create({ category: 'Materials', title: 'Standalone RFQ' })).resolves.toEqual({ id: 100 });
    expect(db.select).not.toHaveBeenCalled();
  });
});
