import { describe, expect, it, vi, beforeEach } from 'vitest';
import { notifyUser, notifyUsers } from './notifications';

function makeDbSpy() {
  const values = vi.fn().mockResolvedValue([{ insertId: 1 }]);
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values } as any;
}

describe('notifyUser / notifyUsers (shared in-app notification abstraction)', () => {
  it('notifyUser writes one in-app notification row with sensible defaults', async () => {
    const db = makeDbSpy();
    await notifyUser(db, { userId: 5, title: 'Hello' });
    expect(db.values).toHaveBeenCalledWith({ userId: 5, title: 'Hello', body: null, type: 'info', link: null, messageKey: null, messageParams: null });
  });

  it('notifyUser passes through an explicit type/link/body', async () => {
    const db = makeDbSpy();
    await notifyUser(db, { userId: 5, title: 'Quotation accepted', body: 'Nice work', type: 'quotation', link: '/provider' });
    expect(db.values).toHaveBeenCalledWith({ userId: 5, title: 'Quotation accepted', body: 'Nice work', type: 'quotation', link: '/provider', messageKey: null, messageParams: null });
  });

  it('notifyUser is a no-op when the database is unavailable (never throws)', async () => {
    await expect(notifyUser(null, { userId: 5, title: 'Hello' })).resolves.toBeUndefined();
  });

  it('notifyUser swallows a failed insert rather than throwing (best-effort)', async () => {
    const db = { insert: vi.fn().mockReturnValue({ values: vi.fn().mockRejectedValue(new Error('db down')) }) };
    await expect(notifyUser(db as any, { userId: 5, title: 'Hello' })).resolves.toBeUndefined();
  });

  it('notifyUsers writes a bulk insert for multiple recipients in one call', async () => {
    const db = makeDbSpy();
    await notifyUsers(db, [
      { userId: 1, title: 'A' },
      { userId: 2, title: 'B', type: 'quotation' },
    ]);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.values).toHaveBeenCalledWith([
      { userId: 1, title: 'A', body: null, type: 'info', link: null, messageKey: null, messageParams: null },
      { userId: 2, title: 'B', body: null, type: 'quotation', link: null, messageKey: null, messageParams: null },
    ]);
  });

  it('notifyUsers is a no-op for an empty recipient list', async () => {
    const db = makeDbSpy();
    await notifyUsers(db, []);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ── rfq.submitQuotation notifies the RFQ owner (live production route) ─────────────────────
vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';

function makeCtx(userId: number, userRole: string, onboardingStatus = 'approved'): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@test.com`,
      name: `User ${userId}`,
      loginMethod: 'manus',
      role: 'user',
      userRole,
      onboardingStatus,
      accountStatus: 'active',
      isDummy: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  } as TrpcContext;
}

describe('rfq.submitQuotation notifies the RFQ owner', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a notification for the RFQ requester after a quotation is submitted', async () => {
    const insertValues = vi.fn().mockResolvedValue([{ insertId: 1 }]);
    const notifyValues = vi.fn().mockResolvedValue([{ insertId: 2 }]);
    let insertCall = 0;
    const db = {
      insert: vi.fn(() => {
        insertCall += 1;
        return { values: insertCall === 1 ? insertValues : notifyValues };
      }),
      select: vi.fn().mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ requesterId: 1, title: 'Kitchen renovation' }]) }) }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(makeCtx(20, 'contractor'));
    await caller.rfq.submitQuotation({ rfqId: 5, price: 1000 });

    expect(notifyValues).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, type: 'quotation' }));
  });

  it('does not fail the mutation if the RFQ lookup for notification purposes comes back empty', async () => {
    const insertValues = vi.fn().mockResolvedValue([{ insertId: 1 }]);
    const db = {
      insert: vi.fn().mockReturnValue({ values: insertValues }),
      select: vi.fn().mockReturnValue({ from: () => ({ where: () => Promise.resolve([]) }) }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(20, 'contractor'));
    await expect(caller.rfq.submitQuotation({ rfqId: 5, price: 1000 })).resolves.toEqual({ success: true });
  });
});

// PHASE 1B: the localisation columns are not decorative - a caller that
// supplies them must have them reach the insert, or the reader's language
// never gets a say.
describe('the translatable form reaches the row', () => {
  it('writes messageKey and messageParams when the caller supplies them', async () => {
    const db = makeDbSpy();
    await notifyUser(db as never, {
      userId: 5, title: 'New quotation received', body: 'You received a new quotation for "Slab"',
      type: 'quotation', link: '/rfq',
      messageKey: 'notif.quotation.received', messageParams: { rfqTitle: 'Slab' },
    });
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({
      messageKey: 'notif.quotation.received',
      messageParams: { rfqTitle: 'Slab' },
    }));
  });

  it('still writes the English prose alongside it', async () => {
    // The fallback is load-bearing: pre-migration rows have only prose, and a
    // client that does not know a key must still render a sentence. Writing
    // ONLY the key would leave those readers with a blank notification.
    const db = makeDbSpy();
    await notifyUser(db as never, {
      userId: 5, title: 'New quotation received', body: 'You received a new quotation for "Slab"',
      messageKey: 'notif.quotation.received', messageParams: { rfqTitle: 'Slab' },
    });
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({
      title: 'New quotation received',
      body: 'You received a new quotation for "Slab"',
    }));
  });
});
