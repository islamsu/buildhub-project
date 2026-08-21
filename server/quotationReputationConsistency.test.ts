import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';

// Phase 4A.6.9: rfq.quotations (the endpoint behind the homeowner's quote
// comparison screen) previously sourced providerRating/providerReviews from
// users.rating/users.reviewCount - columns nothing in the codebase ever
// writes to, so they always read '0.00'/0 regardless of a vendor's real
// reviews. Fixed to use the same dynamic AVG/COUNT-over-reviews definition
// already approved for reviews.statsForUser (Phase 4A.6.2), filtered to
// verified reviews only, computed for the distinct set of providers in the
// result in one grouped aggregate query (no N+1).
function makeCtx(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@test.com`,
      name: `User ${userId}`,
      loginMethod: 'manus',
      role: 'user',
      userRole: 'homeowner',
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

/**
 * Mocks the three-query shape rfq.quotations now issues: the ownership check
 * (Phase 4A final gate), then the quotations+users join, then a reviews
 * aggregate. `requesterId` defaults to 1 to match makeCtx()'s default caller,
 * so every reputation-focused test below - written before the ownership
 * check existed - keeps testing exactly what it always tested (reputation
 * computation), not authorization.
 */
function mockDb(quotationRows: unknown[], aggregateRows: unknown[], requesterId: number | null = 1) {
  let call = 0;
  const select = vi.fn().mockImplementation(() => {
    call++;
    if (call === 1) {
      // ownership check: .from(rfqs).where() -> [{ requesterId }] or []
      return { from: () => ({ where: () => Promise.resolve(requesterId == null ? [] : [{ requesterId }]) }) };
    }
    if (call === 2) {
      // quotations join: .from().leftJoin().where().orderBy()
      return { from: () => ({ leftJoin: () => ({ where: () => ({ orderBy: () => Promise.resolve(quotationRows) }) }) }) };
    }
    // reviews aggregate: .from().where().groupBy()
    return { from: () => ({ where: () => ({ groupBy: () => Promise.resolve(aggregateRows) }) }) };
  });
  return { select };
}

describe('rfq.quotations - dynamic reputation (Phase 4A.6.9)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a vendor with zero reviews shows null rating and 0 count, never a stale zero-that-looks-real or NaN', async () => {
    const rows = [{ id: 1, rfqId: 5, providerId: 20, price: '1000', currency: 'EGP', timeline: 10, warranty: null, paymentTerms: null, notes: null, status: 'pending', createdAt: new Date(), providerName: 'Vendor A', providerEmail: 'a@test.com', providerVerified: true, providerRole: 'contractor', providerLocation: 'Cairo' }];
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb(rows, []));
    const caller = appRouter.createCaller(makeCtx());

    const result = await caller.rfq.quotations({ rfqId: 5 });
    expect(result[0].providerRating).toBeNull();
    expect(result[0].providerReviews).toBe(0);
    expect(Number.isNaN(result[0].providerRating)).toBe(false);
  });

  it('a vendor with one review shows that exact rating and count 1', async () => {
    const rows = [{ id: 1, rfqId: 5, providerId: 20, price: '1000', currency: 'EGP', timeline: 10, warranty: null, paymentTerms: null, notes: null, status: 'pending', createdAt: new Date(), providerName: 'Vendor A', providerEmail: 'a@test.com', providerVerified: true, providerRole: 'contractor', providerLocation: 'Cairo' }];
    const aggregates = [{ revieweeId: 20, avg: '5.0000', count: 1 }];
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb(rows, aggregates));
    const caller = appRouter.createCaller(makeCtx());

    const result = await caller.rfq.quotations({ rfqId: 5 });
    expect(result[0].providerRating).toBe(5);
    expect(result[0].providerReviews).toBe(1);
  });

  it('a vendor with multiple reviews computes the correct rounded average (matches reviews.statsForUser\'s rounding: Math.round(avg*10)/10)', async () => {
    const rows = [{ id: 1, rfqId: 5, providerId: 20, price: '1000', currency: 'EGP', timeline: 10, warranty: null, paymentTerms: null, notes: null, status: 'pending', createdAt: new Date(), providerName: 'Vendor A', providerEmail: 'a@test.com', providerVerified: true, providerRole: 'contractor', providerLocation: 'Cairo' }];
    const aggregates = [{ revieweeId: 20, avg: '4.3333', count: 3 }];
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb(rows, aggregates));
    const caller = appRouter.createCaller(makeCtx());

    const result = await caller.rfq.quotations({ rfqId: 5 });
    expect(result[0].providerRating).toBe(4.3);
    expect(result[0].providerReviews).toBe(3);
  });

  it('a vendor with a perfect 5.0 average displays exactly 5, not 5.0-as-a-rounding-artifact or 4.9999', async () => {
    const rows = [{ id: 1, rfqId: 5, providerId: 20, price: '1000', currency: 'EGP', timeline: 10, warranty: null, paymentTerms: null, notes: null, status: 'pending', createdAt: new Date(), providerName: 'Vendor A', providerEmail: 'a@test.com', providerVerified: true, providerRole: 'contractor', providerLocation: 'Cairo' }];
    const aggregates = [{ revieweeId: 20, avg: '5.0000', count: 4 }];
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb(rows, aggregates));
    const caller = appRouter.createCaller(makeCtx());

    const result = await caller.rfq.quotations({ rfqId: 5 });
    expect(result[0].providerRating).toBe(5);
  });

  it('a non-integer average rounds to exactly one decimal place, consistently with reviews.statsForUser', async () => {
    const rows = [{ id: 1, rfqId: 5, providerId: 20, price: '1000', currency: 'EGP', timeline: 10, warranty: null, paymentTerms: null, notes: null, status: 'pending', createdAt: new Date(), providerName: 'Vendor A', providerEmail: 'a@test.com', providerVerified: true, providerRole: 'contractor', providerLocation: 'Cairo' }];
    const aggregates = [{ revieweeId: 20, avg: '3.666666', count: 6 }];
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb(rows, aggregates));
    const caller = appRouter.createCaller(makeCtx());

    const result = await caller.rfq.quotations({ rfqId: 5 });
    expect(result[0].providerRating).toBe(3.7);
  });

  it('only verified reviews are counted - the aggregate query filters on reviews.verified = true, matching reviews.statsForUser exactly', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf("quotations: protectedProcedure.input(z.object({ rfqId"), source.indexOf('submitQuotation: approvedProviderProcedure'));
    expect(block).toContain('reviews.verified, true');
    expect(block).toContain('groupBy(reviews.revieweeId)');
  });

  it('a vendor with no review rows at all (providerId with zero matches in the aggregate) falls back to null/0, not undefined or a crash', async () => {
    const rows = [
      { id: 1, rfqId: 5, providerId: 20, price: '1000', currency: 'EGP', timeline: 10, warranty: null, paymentTerms: null, notes: null, status: 'pending', createdAt: new Date(), providerName: 'Vendor A', providerEmail: 'a@test.com', providerVerified: true, providerRole: 'contractor', providerLocation: 'Cairo' },
      { id: 2, rfqId: 5, providerId: 21, price: '1200', currency: 'EGP', timeline: 8, warranty: null, paymentTerms: null, notes: null, status: 'pending', createdAt: new Date(), providerName: 'Vendor B', providerEmail: 'b@test.com', providerVerified: false, providerRole: 'contractor', providerLocation: 'Giza' },
    ];
    // Only vendor 20 has reviews - vendor 21 has none at all.
    const aggregates = [{ revieweeId: 20, avg: '4.0000', count: 2 }];
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb(rows, aggregates));
    const caller = appRouter.createCaller(makeCtx());

    const result = await caller.rfq.quotations({ rfqId: 5 });
    expect(result[0].providerRating).toBe(4);
    expect(result[0].providerReviews).toBe(2);
    expect(result[1].providerRating).toBeNull();
    expect(result[1].providerReviews).toBe(0);
  });

  it('never issues select().from(users) for the users.rating/reviewCount columns any more', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf("quotations: protectedProcedure.input(z.object({ rfqId"), source.indexOf('submitQuotation: approvedProviderProcedure'));
    // Column-projection usage only (e.g. `providerRating: users.rating,`) - not
    // the explanatory code comment above, which legitimately mentions these
    // column names in prose to explain why they are no longer used here.
    expect(block).not.toMatch(/:\s*users\.rating\b/);
    expect(block).not.toMatch(/:\s*users\.reviewCount\b/);
  });

  it('an unauthenticated caller is rejected (existing authorization unchanged)', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.rfq.quotations({ rfqId: 5 })).rejects.toThrow();
  });

  it('SECURITY (Phase 4A final gate): a caller who does not own the RFQ is rejected with FORBIDDEN, even though they are authenticated - closes an IDOR that exposed every bidding vendor\'s email, price, and notes to any logged-in user', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb([], [], 999)); // RFQ belongs to user 999, caller is user 1
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.rfq.quotations({ rfqId: 5 })).rejects.toThrow(/do not own/i);
  });

  it('a request for an RFQ id that does not exist is also rejected, not silently returning an empty list', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb([], [], null)); // no matching rfq row
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.rfq.quotations({ rfqId: 999999 })).rejects.toThrow(/do not own/i);
  });

  it('the RFQ owner succeeds (regression: the ownership check does not accidentally block the legitimate caller)', async () => {
    const rows = [{ id: 1, rfqId: 5, providerId: 20, price: '1000', currency: 'EGP', timeline: 10, warranty: null, paymentTerms: null, notes: null, status: 'pending', createdAt: new Date(), providerName: 'Vendor A', providerEmail: 'a@test.com', providerVerified: true, providerRole: 'contractor', providerLocation: 'Cairo' }];
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb(rows, [], 1)); // RFQ belongs to caller (id 1)
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.rfq.quotations({ rfqId: 5 })).resolves.toHaveLength(1);
  });

  it('the rfqId is taken only from validated input, never from an unvalidated client-controlled vendor/provider identity field - there is no providerId/vendorId in the input schema', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf("quotations: protectedProcedure.input(z.object({ rfqId"), source.indexOf('submitQuotation: approvedProviderProcedure'));
    const inputSchema = block.slice(0, block.indexOf(').query('));
    expect(inputSchema).not.toMatch(/providerId|vendorId/);
  });
});

describe('rfq.quotations response shape - no sensitive field exposure (Phase 4A.6.9 regression guard)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the select projection for the users join has no passwordHash/invitationToken/username, unchanged by this fix', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf("quotations: protectedProcedure.input(z.object({ rfqId"), source.indexOf('submitQuotation: approvedProviderProcedure'));
    const projection = block.slice(0, block.indexOf('.from(quotations)'));
    expect(projection).not.toContain('passwordHash');
    expect(projection).not.toContain('invitationToken');
    expect(projection).not.toContain('username');
  });
});
