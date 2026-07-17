import { describe, expect, it, vi, beforeEach } from 'vitest';
import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';

// ── Mock getDb ─────────────────────────────────────────────────────────────
vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { getDb } from './db';

function makeCtx(userId: number, role: 'user' | 'admin' = 'user'): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@test.com`,
      name: `User ${userId}`,
      loginMethod: 'manus',
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  };
}

describe('rfq.acceptQuotation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts a quotation and rejects others when caller owns the RFQ', async () => {
    const updateMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 10, requesterId: 1 }]),
      }),
    });
    const db = {
      select: selectMock,
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(makeCtx(1));
    // Should not throw
    await expect(caller.rfq.acceptQuotation({ quotationId: 5, rfqId: 10 })).resolves.toEqual({ success: true });
  });

  it('throws FORBIDDEN when caller does not own the RFQ', async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]), // empty → not owner
        }),
      }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(makeCtx(99));
    await expect(caller.rfq.acceptQuotation({ quotationId: 5, rfqId: 10 })).rejects.toThrow('You do not own this RFQ');
  });
});

describe('rfq.rejectQuotation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a quotation when caller owns the RFQ', async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: 10, requesterId: 2 }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(makeCtx(2));
    await expect(caller.rfq.rejectQuotation({ quotationId: 7, rfqId: 10 })).resolves.toEqual({ success: true });
  });

  it('throws FORBIDDEN when caller does not own the RFQ', async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(makeCtx(50));
    await expect(caller.rfq.rejectQuotation({ quotationId: 7, rfqId: 10 })).rejects.toThrow('You do not own this RFQ');
  });
});
