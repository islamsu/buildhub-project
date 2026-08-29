import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

vi.mock('./db', () => ({ getDb: vi.fn() }));
import { appRouter } from './routers';
import { getDb } from './db';
import { RFQ_CATEGORIES } from '@shared/rfqCategories';
import type { TrpcContext } from './_core/context';

/**
 * AN RFQ THE PLATFORM CANNOT SERVE MUST NOT BE CREATABLE.
 *
 * `openQualifiedEnquiry` refuses any RFQ whose category is not a member of
 * RFQ_CATEGORIES, with reason `unclassified_rfq`. Creation accepted
 * `category: z.string().optional()`, and the form's submit button was guarded
 * only on the title.
 *
 * So a customer could post a request that:
 *   · was accepted and stored
 *   · appeared in the open feed every supplier sees
 *   · could NEVER be opened as a qualified enquiry, by anybody, ever
 *   · could therefore never receive a quotation
 *
 * The customer waited for responses that could not arrive. Suppliers saw a
 * request they were forbidden to answer. Nobody was told why. Proven live:
 * `rfq.create` with no category returned 200 and `rfq.openEnquiry` on it
 * returned 403 FORBIDDEN.
 *
 * Requiring the category is not a business decision. The rule that needs it
 * already existed; creation simply did not honour it.
 */

const ctx = (id = 1): TrpcContext => ({
  user: {
    id, openId: `u${id}`, email: `u${id}@t.com`, name: 'U', username: `u${id}`,
    loginMethod: 'password', role: 'user', userRole: 'homeowner',
    accountStatus: 'active', onboardingStatus: 'approved', isDummy: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as TrpcContext['user'],
  req: { protocol: 'https', headers: {} } as TrpcContext['req'],
  res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
});

function stubDb() {
  const inserted: Record<string, unknown>[] = [];
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
    // rfq.create writes the RFQ and its items in one transaction now. The
    // callback must run against the SAME recording insert, or the rows this
    // test inspects are written into a fake nobody reads.
    transaction: async (cb: (t: unknown) => Promise<unknown>) => cb({
      insert: () => ({ values: (row: Record<string, unknown>) => { inserted.push(row); return Promise.resolve([{ insertId: 1 }]); } }),
    }),
    insert: () => ({ values: (row: Record<string, unknown>) => { inserted.push(row); return Promise.resolve([{ insertId: 1 }]); } }),
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  });
  return inserted;
}

describe('rfq.create refuses a request no supplier could ever answer', () => {
  it('rejects an RFQ with NO category', async () => {
    const inserted = stubDb();
    await expect(
      appRouter.createCaller(ctx()).rfq.create({ title: 'Villa finishing' } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(inserted, 'nothing may be stored').toHaveLength(0);
  });

  it('rejects a category outside the taxonomy, which fails identically', async () => {
    // "Marble" is a real word and a plausible thing to type. It is not a
    // member of RFQ_CATEGORIES, so openQualifiedEnquiry rejects it exactly as
    // it rejects null - a free-text field produced the same dead end.
    const inserted = stubDb();
    for (const category of ['Marble', 'marble', 'MATERIALS', '', 'Other']) {
      await expect(
        appRouter.createCaller(ctx()).rfq.create({ title: 'Villa', category } as never),
        `category ${JSON.stringify(category)} must be refused`,
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    expect(inserted).toHaveLength(0);
  });

  it('accepts every category the eligibility rule can classify, and only those', async () => {
    // Asserted against the shared taxonomy rather than a copied list, so
    // widening one without the other is a failure rather than a divergence.
    // A DISTINCT CALLER PER CATEGORY. rfq.create is rate limited per user, and
    // nine creations in a loop trip it - correctly. Reusing one identity would
    // make this a test of the throttle rather than of the contract, and it
    // would fail for a reason that has nothing to do with categories.
    let userId = 100;
    for (const category of RFQ_CATEGORIES) {
      const inserted = stubDb();
      await expect(
        appRouter.createCaller(ctx(userId++)).rfq.create({ title: 'Villa', category }),
      ).resolves.toBeTruthy();
      expect(inserted[0]?.category, `${category} must be stored verbatim`).toBe(category);
    }
  });
});

describe('the form does not offer what the server will refuse', () => {
  const PAGE = readSourceForAssertions(readFileSync(new URL('../client/src/pages/RFQPage.tsx', import.meta.url), 'utf8'))
    ;

  it('the submit button requires a category, not only a title', () => {
    expect(PAGE).toMatch(/disabled=\{createRfq\.isPending \|\| uploading \|\| !form\.title \|\| !form\.category\}/);
  });

  it('and the customer is told WHY it is needed, in both languages', () => {
    // "Required" alone would read as bureaucracy. The reason is commercial:
    // without it, matching suppliers never see the request.
    expect(PAGE).toContain('data-testid="rfq-category-required"');
    expect(PAGE).toMatch(/matching suppliers can see your request/i);
    expect(PAGE).toMatch(/[؀-ۿ]/);
  });

  it('the options come from the shared taxonomy, not a local list', () => {
    expect(PAGE).toMatch(/from '@shared\/rfqCategories'/);
    expect(PAGE).toMatch(/CATEGORIES\.map/);
  });
});
