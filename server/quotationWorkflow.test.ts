import { describe, expect, it, vi, beforeEach } from 'vitest';
import { rfqs, quotations } from '../drizzle/schema';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';

type RfqRow = { id: number; requesterId: number; status: 'open' | 'closed' | 'awarded' };
type QuotationRow = { id: number; rfqId: number; providerId: number; status: 'pending' | 'accepted' | 'rejected' };

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

// A minimal, faithful-enough simulation of MySQL row locking for `db.transaction()` +
// `SELECT ... FOR UPDATE`: concurrent transactions are serialized on a queue (the second
// callback only starts once the first has fully resolved, mirroring the second connection
// blocking on the row lock), and each transaction re-reads live mutable state rather than
// a frozen snapshot — exactly the property the race-condition fix depends on.
function createLockedFakeDb(initial: { rfq: RfqRow; quotations: QuotationRow[] }) {
  const state = {
    rfq: { ...initial.rfq } as RfqRow | undefined,
    quotations: new Map<number, QuotationRow>(initial.quotations.map(q => [q.id, { ...q }])),
  };
  let queue: Promise<unknown> = Promise.resolve();
  const updateCalls: string[] = [];

  function makeTx(targetQuotationId: number) {
    let acceptedTargetInThisTx = false;
    return {
      select() {
        return {
          from(table: unknown) {
            return {
              where() {
                return {
                  async for() {
                    if (table === rfqs) {
                      return state.rfq ? [{ ...state.rfq }] : [];
                    }
                    if (table === quotations) {
                      const q = state.quotations.get(targetQuotationId);
                      // Faithfully mirror the real WHERE (id = target AND rfqId = rfq): a
                      // quotation that belongs to a different RFQ must not resolve here.
                      if (q && q.rfqId === state.rfq?.id) return [{ ...q }];
                      return [];
                    }
                    throw new Error('unexpected table passed to select().for()');
                  },
                };
              },
            };
          },
        };
      },
      update(table: unknown) {
        return {
          set(values: Record<string, unknown>) {
            return {
              async where() {
                if (table === quotations && values.status === 'accepted') {
                  updateCalls.push('accept-target');
                  acceptedTargetInThisTx = true;
                  const q = state.quotations.get(targetQuotationId);
                  if (q) q.status = 'accepted';
                } else if (table === quotations && values.status === 'rejected' && acceptedTargetInThisTx) {
                  // The accept-flow's cascade: reject every OTHER quotation on the RFQ.
                  updateCalls.push('reject-others');
                  for (const q of state.quotations.values()) {
                    if (q.id !== targetQuotationId) q.status = 'rejected';
                  }
                } else if (table === quotations && values.status === 'rejected') {
                  // The standalone reject-flow: reject exactly the target quotation.
                  updateCalls.push('reject-target');
                  const q = state.quotations.get(targetQuotationId);
                  if (q) q.status = 'rejected';
                } else if (table === rfqs && values.status === 'awarded') {
                  updateCalls.push('award-rfq');
                  if (state.rfq) state.rfq.status = 'awarded';
                } else {
                  throw new Error(`unexpected update: ${JSON.stringify(values)}`);
                }
                return [];
              },
            };
          },
        };
      },
    };
  }

  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    throw new Error('db.transaction called without a bound quotationId — use bindTransaction()');
  });

  function bindTransaction(targetQuotationId: number) {
    return vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const run = async () => cb(makeTx(targetQuotationId));
      const result = queue.then(run, run);
      queue = result.then(() => undefined, () => undefined);
      return result;
    });
  }

  return { state, updateCalls, transaction, bindTransaction };
}

describe('rfq.acceptQuotation (live production route)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts a pending quotation the caller owns via the RFQ and rejects competitors', async () => {
    const harness = createLockedFakeDb({
      rfq: { id: 5, requesterId: 1, status: 'open' },
      quotations: [
        { id: 10, rfqId: 5, providerId: 20, status: 'pending' },
        { id: 11, rfqId: 5, providerId: 21, status: 'pending' },
      ],
    });
    harness.transaction.mockImplementation(harness.bindTransaction(10));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ transaction: harness.transaction });

    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.rfq.acceptQuotation({ quotationId: 10, rfqId: 5 })).resolves.toEqual({
      success: true,
      awardedQuotationId: 10,
      rfqId: 5,
    });

    expect(harness.state.quotations.get(10)?.status).toBe('accepted');
    expect(harness.state.quotations.get(11)?.status).toBe('rejected');
    expect(harness.state.rfq?.status).toBe('awarded');
  });

  it('[Test 3] FORBIDDEN when the quotation belongs to a different RFQ than the one supplied (cross-RFQ IDOR)', async () => {
    const harness = createLockedFakeDb({
      // Attacker owns RFQ 99; quotation 10 actually belongs to RFQ 5 (someone else's).
      rfq: { id: 99, requesterId: 2, status: 'open' },
      quotations: [{ id: 10, rfqId: 5, providerId: 20, status: 'pending' }],
    });
    harness.transaction.mockImplementation(harness.bindTransaction(10));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ transaction: harness.transaction });

    const caller = appRouter.createCaller(makeCtx(2));
    await expect(caller.rfq.acceptQuotation({ quotationId: 10, rfqId: 99 })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(harness.state.quotations.get(10)?.status).toBe('pending');
    expect(harness.state.rfq?.status).toBe('open');
  });

  it('[Test 4] FORBIDDEN when the caller does not own the RFQ at all (cross-customer manipulation)', async () => {
    const harness = createLockedFakeDb({
      rfq: { id: 5, requesterId: 1, status: 'open' },
      quotations: [{ id: 10, rfqId: 5, providerId: 20, status: 'pending' }],
    });
    harness.transaction.mockImplementation(harness.bindTransaction(10));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ transaction: harness.transaction });

    const caller = appRouter.createCaller(makeCtx(99));
    await expect(caller.rfq.acceptQuotation({ quotationId: 10, rfqId: 5 })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(harness.state.quotations.get(10)?.status).toBe('pending');
    expect(harness.state.rfq?.status).toBe('open');
    expect(harness.updateCalls).toHaveLength(0);
  });

  it('[Test 5] safely rejects re-accepting an already-accepted quotation (no invalid transition)', async () => {
    const harness = createLockedFakeDb({
      rfq: { id: 5, requesterId: 1, status: 'awarded' },
      quotations: [{ id: 10, rfqId: 5, providerId: 20, status: 'accepted' }],
    });
    harness.transaction.mockImplementation(harness.bindTransaction(10));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ transaction: harness.transaction });

    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.rfq.acceptQuotation({ quotationId: 10, rfqId: 5 })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(harness.updateCalls).toHaveLength(0);
  });

  it('[Test 5b] safely rejects accepting an already-rejected quotation', async () => {
    const harness = createLockedFakeDb({
      rfq: { id: 5, requesterId: 1, status: 'open' },
      quotations: [{ id: 10, rfqId: 5, providerId: 20, status: 'rejected' }],
    });
    harness.transaction.mockImplementation(harness.bindTransaction(10));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ transaction: harness.transaction });

    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.rfq.acceptQuotation({ quotationId: 10, rfqId: 5 })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(harness.updateCalls).toHaveLength(0);
  });

  it('[Test 6] safely rejects acceptance once the RFQ is already awarded', async () => {
    const harness = createLockedFakeDb({
      rfq: { id: 5, requesterId: 1, status: 'awarded' },
      quotations: [{ id: 11, rfqId: 5, providerId: 21, status: 'pending' }],
    });
    harness.transaction.mockImplementation(harness.bindTransaction(11));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ transaction: harness.transaction });

    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.rfq.acceptQuotation({ quotationId: 11, rfqId: 5 })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(harness.state.quotations.get(11)?.status).toBe('pending');
    expect(harness.updateCalls).toHaveLength(0);
  });

  it('[Test 7] FORBIDDEN when a vendor (non-owner) calls acceptQuotation directly', async () => {
    const harness = createLockedFakeDb({
      rfq: { id: 5, requesterId: 1, status: 'open' },
      quotations: [{ id: 10, rfqId: 5, providerId: 20, status: 'pending' }],
    });
    harness.transaction.mockImplementation(harness.bindTransaction(10));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ transaction: harness.transaction });

    // providerId 20 is the vendor who submitted the quotation — not the RFQ owner.
    const caller = appRouter.createCaller(makeCtx(20, 'contractor'));
    await expect(caller.rfq.acceptQuotation({ quotationId: 10, rfqId: 5 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(harness.updateCalls).toHaveLength(0);
  });

  it('[Test 1] concurrency: two simultaneous attempts to accept the SAME quotation — exactly one succeeds', async () => {
    const harness = createLockedFakeDb({
      rfq: { id: 5, requesterId: 1, status: 'open' },
      quotations: [{ id: 10, rfqId: 5, providerId: 20, status: 'pending' }],
    });
    harness.transaction
      .mockImplementationOnce(harness.bindTransaction(10))
      .mockImplementationOnce(harness.bindTransaction(10));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ transaction: harness.transaction });

    const caller = appRouter.createCaller(makeCtx(1));
    const results = await Promise.allSettled([
      caller.rfq.acceptQuotation({ quotationId: 10, rfqId: 5 }),
      caller.rfq.acceptQuotation({ quotationId: 10, rfqId: 5 }),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });
    expect(harness.state.quotations.get(10)?.status).toBe('accepted');
    expect(harness.updateCalls.filter(c => c === 'accept-target')).toHaveLength(1);
  });

  it('[Test 2] concurrency: two simultaneous attempts to accept TWO DIFFERENT quotations on the same RFQ — exactly one accepted', async () => {
    const harness = createLockedFakeDb({
      rfq: { id: 5, requesterId: 1, status: 'open' },
      quotations: [
        { id: 10, rfqId: 5, providerId: 20, status: 'pending' },
        { id: 11, rfqId: 5, providerId: 21, status: 'pending' },
      ],
    });
    harness.transaction
      .mockImplementationOnce(harness.bindTransaction(10))
      .mockImplementationOnce(harness.bindTransaction(11));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ transaction: harness.transaction });

    const caller = appRouter.createCaller(makeCtx(1));
    const results = await Promise.allSettled([
      caller.rfq.acceptQuotation({ quotationId: 10, rfqId: 5 }),
      caller.rfq.acceptQuotation({ quotationId: 11, rfqId: 5 }),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    const acceptedIds = [...harness.state.quotations.values()].filter(q => q.status === 'accepted');
    expect(acceptedIds).toHaveLength(1);
    expect(harness.state.rfq?.status).toBe('awarded');
    expect(harness.updateCalls.filter(c => c === 'accept-target')).toHaveLength(1);
  });
});

describe('rfq.rejectQuotation (live production route)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a pending quotation the caller owns via the RFQ', async () => {
    const harness = createLockedFakeDb({
      rfq: { id: 5, requesterId: 2, status: 'open' },
      quotations: [{ id: 7, rfqId: 5, providerId: 20, status: 'pending' }],
    });
    harness.transaction.mockImplementation(harness.bindTransaction(7));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ transaction: harness.transaction });

    const caller = appRouter.createCaller(makeCtx(2));
    await expect(caller.rfq.rejectQuotation({ quotationId: 7, rfqId: 5 })).resolves.toEqual({ success: true });
    expect(harness.state.quotations.get(7)?.status).toBe('rejected');
  });

  it('FORBIDDEN when the quotation belongs to a different RFQ than the one supplied (cross-RFQ IDOR)', async () => {
    const harness = createLockedFakeDb({
      rfq: { id: 99, requesterId: 2, status: 'open' },
      quotations: [{ id: 7, rfqId: 5, providerId: 20, status: 'pending' }],
    });
    harness.transaction.mockImplementation(harness.bindTransaction(7));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ transaction: harness.transaction });

    const caller = appRouter.createCaller(makeCtx(2));
    await expect(caller.rfq.rejectQuotation({ quotationId: 7, rfqId: 99 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(harness.state.quotations.get(7)?.status).toBe('pending');
  });

  it('FORBIDDEN when the caller does not own the RFQ', async () => {
    const harness = createLockedFakeDb({
      rfq: { id: 5, requesterId: 2, status: 'open' },
      quotations: [{ id: 7, rfqId: 5, providerId: 20, status: 'pending' }],
    });
    harness.transaction.mockImplementation(harness.bindTransaction(7));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ transaction: harness.transaction });

    const caller = appRouter.createCaller(makeCtx(50));
    await expect(caller.rfq.rejectQuotation({ quotationId: 7, rfqId: 5 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(harness.state.quotations.get(7)?.status).toBe('pending');
  });

  it('safely rejects an invalid transition on an already-accepted quotation', async () => {
    const harness = createLockedFakeDb({
      rfq: { id: 5, requesterId: 2, status: 'awarded' },
      quotations: [{ id: 7, rfqId: 5, providerId: 20, status: 'accepted' }],
    });
    harness.transaction.mockImplementation(harness.bindTransaction(7));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ transaction: harness.transaction });

    const caller = appRouter.createCaller(makeCtx(2));
    await expect(caller.rfq.rejectQuotation({ quotationId: 7, rfqId: 5 })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(harness.state.quotations.get(7)?.status).toBe('accepted');
  });
});

describe('database unavailable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects acceptQuotation with INTERNAL_SERVER_ERROR when the database is unavailable', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.rfq.acceptQuotation({ quotationId: 9999, rfqId: 9999 })).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });
});
