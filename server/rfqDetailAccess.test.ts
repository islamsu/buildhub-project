import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { appRouter } from './routers';
import { getDb } from './db';
import type { TrpcContext } from './_core/context';

/**
 * WHAT A SINGLE RFQ READ MAY RETURN.
 *
 * `rfq.get` is scoped `WHERE requesterId = ctx.user.id`, so a provider could
 * not read one RFQ at all - they only ever saw RFQs as rows inside `rfq.list`.
 * That is why the product had no detail page: there was nothing to build it on.
 *
 * `rfq.summary` fills that gap, and the whole security argument is one
 * sentence: it returns EXACTLY the column allowlist `rfq.list` already gives
 * every authenticated caller, and nothing more. If that stops being true it is
 * a new exposure, so it is asserted rather than remembered.
 */

const ctx = (id: number, userRole = 'contractor'): TrpcContext => ({
  user: {
    id, openId: `u${id}`, email: `u${id}@t.com`, name: 'U', username: `u${id}`,
    loginMethod: 'password', role: 'user', userRole,
    accountStatus: 'active', onboardingStatus: 'approved', isDummy: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as TrpcContext['user'],
  req: { protocol: 'https', headers: {} } as TrpcContext['req'],
  res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
});

function stubDb(row: Record<string, unknown> | null) {
  const projections: string[][] = [];
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
    select: vi.fn((projection: Record<string, unknown>) => {
      projections.push(Object.keys(projection ?? {}));
      // `where(...)` is awaited directly in some places and CHAINED with
      // `.orderBy(...)` in others (rfq.summary now reads the RFQ's items after
      // the RFQ row). It has to be both: a thenable that also chains.
      const result = (rows: unknown[]) => {
        const thenable = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>;
        thenable.orderBy = () => Promise.resolve(rows);
        return thenable;
      };
      return {
        from: () => ({
          where: () => result(row ? [row] : []),
          orderBy: () => ({ limit: () => Promise.resolve(row ? [row] : []) }),
        }),
      };
    }),
  });
  return { projections };
}

const ROW = {
  id: 7, requesterId: 42, projectId: null, title: 'Villa finishing',
  description: 'Full finishing', category: 'finishing', budget: '500000',
  location: 'Cairo', deadline: null, productReference: null,
  status: 'open', createdAt: new Date(),
};

describe('rfq.summary returns the feed allowlist and no more', () => {
  it('a provider who does not own the RFQ CAN read it', async () => {
    // The positive control, and the whole reason the procedure exists: the RFQ
    // is addressed to providers, and they already see these columns in the feed.
    const { projections } = stubDb(ROW);
    const result = await appRouter.createCaller(ctx(5)).rfq.summary({ id: 7 });
    expect(result.id).toBe(7);
    expect(result.title).toBe('Villa finishing');
    expect(projections.length).toBeGreaterThan(0);
  });

  it('NEVER selects attachments - that is what the credit pays for', async () => {
    // openQualifiedEnquiry charges a credit to reveal the full brief and its
    // files. A free single-row read that included them would make the paid
    // mechanism optional, which is the exact defect rfq.get once had.
    const { projections } = stubDb(ROW);
    await appRouter.createCaller(ctx(5)).rfq.summary({ id: 7 });
    for (const projection of projections) {
      expect(projection).not.toContain('attachments');
    }
  });

  it('returns EXACTLY the columns rfq.list returns - no drift', async () => {
    // Asserted against the other procedure's source rather than a copied list,
    // so widening one without the other is a failure rather than a silent
    // divergence.
    const source = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'))
      ;

    const columnsIn = (marker: string) => {
      const start = source.indexOf(marker);
      expect(start, `${marker} not found`).toBeGreaterThan(-1);
      const body = source.slice(start, source.indexOf('.from(rfqs)', start));
      return [...body.matchAll(/^\s*(\w+): rfqs\.\w+,/gm)].map(m => m[1]).sort();
    };

    const listColumns = columnsIn('list: protectedProcedure.query(async ({ ctx }) => {');
    const summaryColumns = columnsIn('summary: protectedProcedure');
    expect(listColumns.length).toBeGreaterThan(5);
    expect(summaryColumns).toEqual(listColumns);
  });

  it('a nonexistent RFQ is NOT_FOUND, not a crash', async () => {
    stubDb(null);
    await expect(
      appRouter.createCaller(ctx(5)).rfq.summary({ id: 4242 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a non-positive id before it reaches the database', async () => {
    const { projections } = stubDb(ROW);
    for (const id of [0, -1]) {
      await expect(
        appRouter.createCaller(ctx(5)).rfq.summary({ id }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    expect(projections).toHaveLength(0);
  });

  /**
   * THE VISIBILITY RULE CHANGED, BY OWNER DECISION.
   *
   * This test used to assert the opposite - that every role could read any
   * RFQ's brief and exact budget, "because the feed already is" open. The feed
   * WAS open, and that was the finding: one homeowner could read another
   * homeowner's brief and the figure they were willing to spend, and so could
   * a supplier with no intention of bidding.
   *
   * The owner decided discovery is for approved providers. The rule is
   * asserted here in both directions rather than removed.
   */
  it('every APPROVED PROVIDER role can read it - they are who the feed is for', async () => {
    for (const role of ['contractor', 'supplier', 'engineer', 'architect', 'project_manager']) {
      stubDb(ROW);
      await expect(appRouter.createCaller(ctx(5, role)).rfq.summary({ id: 7 }))
        .resolves.toMatchObject({ id: 7 });
    }
  });

  it('a homeowner who does not own it CANNOT read it', async () => {
    stubDb(ROW);   // ROW.requesterId is 42; this caller is 5.
    await expect(appRouter.createCaller(ctx(5, 'homeowner')).rfq.summary({ id: 7 }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('the requester always reads their own, whatever their role', async () => {
    stubDb(ROW);
    await expect(appRouter.createCaller(ctx(42, 'homeowner')).rfq.summary({ id: 7 }))
      .resolves.toMatchObject({ id: 7 });
  });

  it('an UNAPPROVED provider cannot read it either', async () => {
    // Approval is what the feed is gated on elsewhere; a pending account must
    // not get the brief by taking a different route to it.
    stubDb(ROW);
    const pending = ctx(5, 'contractor');
    (pending.user as { onboardingStatus?: string }).onboardingStatus = 'under_review';
    await expect(appRouter.createCaller(pending).rfq.summary({ id: 7 }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refusal is NOT_FOUND, so it is not an oracle for which ids exist', async () => {
    stubDb(ROW);
    const denied = await appRouter.createCaller(ctx(5, 'homeowner')).rfq.summary({ id: 7 }).catch(e => e);
    stubDb(null);
    const absent = await appRouter.createCaller(ctx(5, 'contractor')).rfq.summary({ id: 7 }).catch(e => e);
    expect(denied.code).toBe(absent.code);
  });

  it('requires authentication', async () => {
    // protectedProcedure, asserted rather than assumed - this is the one gate
    // between the open feed and the anonymous internet.
    const source = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));
    expect(source).toMatch(/summary: protectedProcedure/);
    expect(source).not.toMatch(/summary: publicProcedure/);
  });
});

describe('the owner-scoped read is unchanged', () => {
  it('rfq.get is still scoped by requesterId', async () => {
    // The detail page relies on this: it calls rfq.get only when the caller
    // owns the RFQ, and the server is what makes that true rather than the UI.
    const source = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'))
      ;
    // SCOPED TO THE RFQ ROUTER. `projects.get` has a byte-identical signature
    // and appears earlier in the file, so a bare indexOf finds that one and
    // this assertion would be about a different procedure entirely - a mistake
    // this project has made before, which is why the scoping is explicit.
    const rfqRouter = source.slice(
      source.indexOf('const rfqRouter = router({'),
      source.indexOf('const messagesRouter = router({'),
    );
    expect(rfqRouter.length).toBeGreaterThan(0);
    const start = rfqRouter.indexOf("get: protectedProcedure.input(z.object({ id: z.number() })).query");
    expect(start).toBeGreaterThan(-1);
    expect(rfqRouter.slice(start, start + 700)).toContain('eq(rfqs.requesterId, ctx.user.id)');
  });
});
