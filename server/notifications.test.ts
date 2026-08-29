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
      // `status` is now part of what the procedure reads: the RFQ lookup moved
      // in front of the insert and became the state check, not just a way to
      // find out whom to notify.
      select: vi.fn().mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ requesterId: 1, title: 'Kitchen renovation', status: 'open' }]) }) }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(makeCtx(20, 'contractor'));
    await caller.rfq.submitQuotation({ rfqId: 5, price: 1000 });

    expect(notifyValues).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, type: 'quotation' }));
  });

  /**
   * THE QUOTATION IS THE PRODUCT; ITS AUDIT ID IS BOOKKEEPING.
   *
   * The procedure reads the inserted row's id so the commercial trail can
   * point at the quotation rather than at the RFQ. If that read threw, a
   * supplier's bid would be rejected because an audit id could not be
   * captured - the customer loses a quotation to protect a log entry, which is
   * the exact inversion this trail is designed to avoid elsewhere.
   *
   * A driver that resolves with nothing is the harshest form of that case.
   */
  it('a quotation is accepted even when the insert yields no id', async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const notifyValues = vi.fn().mockResolvedValue(undefined);
    let insertCall = 0;
    const db = {
      insert: vi.fn(() => {
        insertCall += 1;
        return { values: insertCall === 1 ? insertValues : notifyValues };
      }),
      select: vi.fn().mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ requesterId: 1, title: 'Kitchen renovation', status: 'open' }]) }) }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(makeCtx(20, 'contractor'));
    await expect(caller.rfq.submitQuotation({ rfqId: 5, price: 1000 })).resolves.toEqual({ success: true });
    // The bid was stored and the requester was still told about it.
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(notifyValues).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, type: 'quotation' }));
  });

  // CONTRACT CHANGED DELIBERATELY. This test used to assert that an empty RFQ
  // lookup was harmless, because the lookup existed only to address the
  // notification and ran AFTER the insert. That is no longer what the lookup
  // is: it now runs first and decides whether the quotation may exist at all.
  // A quotation against an RFQ that is not there is not a notification that
  // cannot be delivered - it is a request that should never have been
  // accepted, and it previously surfaced as a 500 from the foreign key.
  it('REFUSES the mutation when the RFQ does not exist, rather than inserting first', async () => {
    const insertValues = vi.fn().mockResolvedValue([{ insertId: 1 }]);
    const db = {
      insert: vi.fn().mockReturnValue({ values: insertValues }),
      select: vi.fn().mockReturnValue({ from: () => ({ where: () => Promise.resolve([]) }) }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeCtx(20, 'contractor'));
    await expect(caller.rfq.submitQuotation({ rfqId: 5, price: 1000 }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(insertValues, 'nothing may be written before the RFQ is verified').not.toHaveBeenCalled();
  });

  it('REFUSES a quotation on an RFQ that is closed or already awarded', async () => {
    // The client filters its pipeline to status === 'open', which is why this
    // was never hit through the UI. Frontend filtering is not a control: the
    // requester had accepted somebody and new bids still reached their inbox.
    for (const status of ['closed', 'awarded'] as const) {
      const insertValues = vi.fn().mockResolvedValue([{ insertId: 1 }]);
      const db = {
        insert: vi.fn().mockReturnValue({ values: insertValues }),
        select: vi.fn().mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ requesterId: 1, title: 'Kitchen renovation', status }]) }) }),
      };
      (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
      const caller = appRouter.createCaller(makeCtx(20, 'contractor'));
      await expect(caller.rfq.submitQuotation({ rfqId: 5, price: 1000 }), status)
        .rejects.toMatchObject({ code: 'CONFLICT' });
      expect(insertValues, `a ${status} RFQ must not receive a quotation`).not.toHaveBeenCalled();
    }
  });

  it('a nonsense price or over-long field is refused by the SCHEMA', async () => {
    // decimal(12,2) and varchar(100) would have taken these as a database
    // error or a silent truncation. A negative bid is not a bid.
    //
    // The first version of this test stubbed nothing, so getDb() returned
    // undefined and EVERY call rejected with INTERNAL_SERVER_ERROR - it passed
    // whether or not the bounds existed. A mutation that removed them survived
    // it. The db below is one that would happily accept the insert, so the
    // only remaining reason to reject is the input schema, and the code is
    // asserted rather than just "it threw".
    const workingDb = () => {
      const insertValues = vi.fn().mockResolvedValue([{ insertId: 1 }]);
      (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
        insert: vi.fn().mockReturnValue({ values: insertValues }),
        select: vi.fn().mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ requesterId: 1, title: 'T', status: 'open' }]) }) }),
      });
      return insertValues;
    };

    const rejected: [string, unknown][] = [
      ['negative price', { rfqId: 5, price: -1 }],
      ['zero price', { rfqId: 5, price: 0 }],
      ['absurd price', { rfqId: 5, price: 1e30 }],
      ['over-long warranty', { rfqId: 5, price: 100, warranty: 'x'.repeat(101) }],
      ['fractional rfqId', { rfqId: 5.5, price: 100 }],
    ];
    for (const [label, input] of rejected) {
      const insertValues = workingDb();
      const caller = appRouter.createCaller(makeCtx(20, 'contractor'));
      await expect(caller.rfq.submitQuotation(input as never), label)
        .rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(insertValues, `${label} must not reach the database`).not.toHaveBeenCalled();
    }

    // And the control: with the SAME db, a sane quotation goes through. A
    // rejection test that would also reject valid input proves nothing.
    const insertValues = workingDb();
    const caller = appRouter.createCaller(makeCtx(20, 'contractor'));
    await expect(caller.rfq.submitQuotation({ rfqId: 5, price: 100, warranty: 'x'.repeat(100) }))
      .resolves.toEqual({ success: true });
    expect(insertValues).toHaveBeenCalled();
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
