import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

vi.mock('./db', () => ({ getDb: vi.fn() }));
import { appRouter } from './routers';
import { getDb } from './db';
import { authorizeStorageKey } from './_core/storageProxy';
import type { TrpcContext } from './_core/context';
import { qualifiedEnquiries, quotations, rfqSuppliers, rfqs } from '../drizzle/schema';
import { selectByTable, withTransaction } from './testSupport/txDouble';

/**
 * A SUPPLIER COULD NOT SEND A SINGLE DOCUMENT WITH A BID.
 *
 * `quotations` had no attachments column, `submitQuotation` had no attachments
 * input, and the quote dialog offered price, timeline, warranty and free text.
 * No proposal, no technical specification, no certificate, no photograph. A
 * customer comparing two numbers with nothing behind them is not comparing
 * anything, and no real construction bid is submitted that way.
 *
 * The authorization direction is the opposite of an RFQ attachment, and that
 * is the whole point of the tests below. An RFQ attachment flows customer ->
 * provider and is what a credit BUYS. A quotation attachment flows provider ->
 * customer and is sold to nobody: the value of a sealed bid is precisely that
 * rivals cannot read it.
 */

const ctx = (id: number, userRole = 'supplier', onboardingStatus = 'approved'): TrpcContext => ({
  user: {
    id, openId: `u${id}`, email: `u${id}@t.com`, name: 'U', username: `u${id}`,
    loginMethod: 'password', role: 'user', userRole,
    accountStatus: 'active', onboardingStatus, isDummy: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as TrpcContext['user'],
  req: { protocol: 'https', headers: {} } as TrpcContext['req'],
  res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
});

const FILE = { key: '', url: '/manus-storage/x', name: 'proposal.pdf', type: 'application/pdf', size: 10 };
const VALID_UNTIL = new Date('2099-12-31T23:59:59.000Z');

function stubDb(rfqRow: Record<string, unknown> | null = { requesterId: 99, title: 'T', status: 'open' }) {
  const inserted: Record<string, unknown>[] = [];
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction({
    select: selectByTable(new Map([
      [rfqs, rfqRow ? [rfqRow] : []],
      [rfqSuppliers, []],
      [qualifiedEnquiries, [{ id: 77 }]],
      [quotations, []],
    ])),
    // Only QUOTATION inserts are counted. This procedure also writes a
    // notification, an analytics event and a commercial audit row; counting
    // every write would make the assertions below about the wrong thing.
    insert: () => ({ values: (row: Record<string, unknown>) => {
      if (row && 'providerId' in row) inserted.push(row);
      return Promise.resolve([{ insertId: 5 }]);
    } }),
  }));
  return inserted;
}

// ══ 1. A SUPPLIER MAY ONLY ATTACH THEIR OWN FILES ══════════════════════════

describe('submitQuotation refuses a file the supplier did not upload', () => {
  it('rejects another supplier\'s key', async () => {
    // Without this a supplier names a rival's key, the file becomes an
    // attachment of THEIR quotation, and the proxy is then asked to authorise
    // it against that quotation - which is how a file crosses an ownership
    // boundary by being referenced rather than by being read.
    const inserted = stubDb();
    await expect(
      appRouter.createCaller(ctx(3)).rfq.submitQuotation({
        rfqId: 1, price: 100, validUntil: VALID_UNTIL,
        attachments: [{ ...FILE, key: 'quotation-attachments/user-4/proposal_a1b2c3d4.pdf' }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(inserted, 'nothing may be stored').toHaveLength(0);
  });

  it('rejects a path that traverses out of the supplier\'s own prefix', async () => {
    // `.../user-3/../user-4/x.pdf` starts with the right prefix and is not the
    // right file. The prefix check alone would pass it.
    const inserted = stubDb();
    for (const key of [
      'quotation-attachments/user-3/../user-4/proposal.pdf',
      'quotation-attachments/user-3/./../../rfq-attachments/user-99/boq.pdf',
      'quotation-attachments/user-3/',
      'quotation-attachments/user-3//x.pdf',
      'rfq-attachments/user-99/boq.pdf',
      'avatars/3/photo.png',
    ]) {
      await expect(
        appRouter.createCaller(ctx(3)).rfq.submitQuotation({
          rfqId: 1, price: 100, validUntil: VALID_UNTIL, attachments: [{ ...FILE, key }],
        }),
        `key ${key} must be refused`,
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(inserted).toHaveLength(0);
  });

  it('accepts the supplier\'s own file - the positive control', async () => {
    const inserted = stubDb();
    await expect(
      appRouter.createCaller(ctx(3)).rfq.submitQuotation({
        rfqId: 1, price: 100, validUntil: VALID_UNTIL,
        attachments: [{ ...FILE, key: 'quotation-attachments/user-3/proposal_a1b2c3d4.pdf' }],
      }),
    ).resolves.toEqual({ success: true, quotationId: 5 });
    expect(inserted).toHaveLength(1);
    expect(String(inserted[0].attachments)).toContain('proposal.pdf');
  });

  it('a quotation with no attachments stores null, not an empty array', async () => {
    const inserted = stubDb();
    await appRouter.createCaller(ctx(3)).rfq.submitQuotation({ rfqId: 1, price: 100, validUntil: VALID_UNTIL });
    expect(inserted[0].attachments).toBeNull();
  });
});

// ══ 2. WHO MAY READ THE BYTES ══════════════════════════════════════════════

describe('the storage proxy on a quotation attachment', () => {
  const KEY = 'quotation-attachments/user-3/proposal_a1b2c3d4.pdf';
  const user = (id: number, role: 'user' | 'admin' = 'user') => ({ id, role } as never);

  function proxyDb(opts: { quotationRows?: unknown[]; rfqRequesterId?: number } = {}) {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction({
      select: (projection: Record<string, unknown>) => ({
        from: () => ({
          where: () => Promise.resolve(
            projection && 'requesterId' in projection
              ? (opts.rfqRequesterId ? [{ requesterId: opts.rfqRequesterId }] : [])
              : (opts.quotationRows ?? []),
          ),
        }),
      }),
    }));
  }

  it('the uploading supplier may read it', async () => {
    proxyDb();
    expect(await authorizeStorageKey(KEY, user(3))).toBe(true);
  });

  it('the customer whose RFQ it answers may read it', async () => {
    proxyDb({
      quotationRows: [{ rfqId: 7, attachments: JSON.stringify([{ key: KEY, url: 'u', name: 'n', type: 'application/pdf', size: 10 }]) }],
      rfqRequesterId: 99,
    });
    expect(await authorizeStorageKey(KEY, user(99))).toBe(true);
  });

  it('A RIVAL SUPPLIER MAY NOT - the assertion this category exists for', async () => {
    proxyDb({
      quotationRows: [{ rfqId: 7, attachments: JSON.stringify([{ key: KEY, url: 'u', name: 'n', type: 'application/pdf', size: 10 }]) }],
      rfqRequesterId: 99,
    });
    expect(await authorizeStorageKey(KEY, user(4))).toBe(false);
  });

  it('an unrelated customer may not', async () => {
    proxyDb({
      quotationRows: [{ rfqId: 7, attachments: JSON.stringify([{ key: KEY, url: 'u', name: 'n', type: 'application/pdf', size: 10 }]) }],
      rfqRequesterId: 99,
    });
    expect(await authorizeStorageKey(KEY, user(55))).toBe(false);
  });

  it('candidate quotations are scoped to the uploader named in the key', async () => {
    // A caller who learns a key must not be able to reference it from a
    // quotation of their OWN and be authorised for it. The lookup only ever
    // considers quotations belonging to the uploader the key names, so the
    // attacker's own row is never a candidate.
    const proxySource = readSourceForAssertions(
      readFileSync(new URL('./_core/storageProxy.ts', import.meta.url), 'utf8'),
    );
    const category = proxySource.slice(
      proxySource.indexOf('key.startsWith("quotation-attachments/")'),
      proxySource.indexOf('key.startsWith("ai-attachments/")'),
    );
    expect(category).toContain('eq(quotations.providerId, uploaderId)');
  });

  it('nobody may read a key no quotation actually references', async () => {
    // An attacker who learns a key cannot reference it from a quotation of
    // their own: candidate quotations are scoped to the ACTUAL uploader.
    proxyDb({ quotationRows: [], rfqRequesterId: 99 });
    expect(await authorizeStorageKey(KEY, user(99))).toBe(false);
  });

  it('an anonymous caller may not', async () => {
    proxyDb();
    expect(await authorizeStorageKey(KEY, null)).toBe(false);
  });

  it('a malformed key is refused before any query', async () => {
    proxyDb();
    for (const key of [
      'quotation-attachments/user-abc/x.pdf',
      'quotation-attachments/../secret.pdf',
      'quotation-attachments/user-3/../../etc/passwd',
    ]) {
      expect(await authorizeStorageKey(key, user(3)), key).toBe(false);
    }
  });
});

// ══ 3. THE SURFACES ════════════════════════════════════════════════════════

describe('both sides of the exchange are wired', () => {
  const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));
  const FORM = readSourceForAssertions(readFileSync(new URL('../client/src/pages/RFQRespondPage.tsx', import.meta.url), 'utf8'));
  const REVIEW = readSourceForAssertions(readFileSync(new URL('../client/src/components/QuotationComparison.tsx', import.meta.url), 'utf8'));

  it('the upload sits behind the same gate as submitting a quotation', () => {
    // A vendor who may not quote may not stage files for a quotation either.
    expect(ROUTERS).toMatch(/uploadQuotationAttachment: approvedProviderProcedure/);
  });

  it('it byte-sniffs like every other upload', () => {
    const block = ROUTERS.slice(
      ROUTERS.indexOf('uploadQuotationAttachment:'),
      ROUTERS.indexOf('submitQuotation:'),
    );
    expect(block).toContain('assertUploadedFileMatches');
    expect(block).toContain('enforceUploadRateLimit');
    expect(block).toContain('storagePutOrUnavailable');
  });

  it('it writes its OWN prefix, not the RFQ one', () => {
    // Sharing `rfq-attachments/` would inherit that category's rule - "the
    // requester, plus any provider who PAID for the enquiry" - which would
    // publish a supplier's sealed bid to every rival who bought the lead.
    //
    // SCOPED TO THE UPLOAD PROCEDURE. Asserted against the whole file, this
    // passed even with the write changed to `rfq-attachments/`, because
    // submitQuotation's prefix CHECK contains the same string. The assertion
    // was being satisfied by the guard rather than by the thing guarded.
    const upload = ROUTERS.slice(
      ROUTERS.indexOf('uploadQuotationAttachment:'),
      ROUTERS.indexOf('submitQuotation:'),
    );
    expect(upload).toMatch(/storagePutOrUnavailable\(\s*`quotation-attachments\/user-\$\{ctx\.user\.id\}\//);
    expect(upload, 'the quotation upload must not write into the RFQ category')
      .not.toContain('rfq-attachments/');
  });

  it('the supplier form can attach, list and remove files', () => {
    expect(FORM).toContain('data-testid="respond-attach"');
    expect(FORM).toContain('data-testid="respond-attachments"');
    expect(FORM).toContain('data-testid="respond-remove-attachment"');
    expect(FORM).toMatch(/attachments: files\.length \? files : undefined/);
  });

  it('and it tells the supplier who will be able to see them', () => {
    expect(FORM).toMatch(/Only the requester can see them/i);
    expect(FORM).toMatch(/[؀-ۿ]/);
  });

  it('the customer surface renders them', () => {
    expect(REVIEW).toContain('data-testid="quotation-attachments"');
    expect(REVIEW).toContain('parseQuotationAttachments');
  });

  it('and parses a malformed column without breaking the comparison', () => {
    expect(REVIEW).toMatch(/catch \{\s*return \[\];/);
  });

  it('the owner-scoped read is what exposes them - not a wider one', () => {
    // `rfq.quotations` already refuses anybody but the RFQ's requester. The
    // attachments column rides on that existing scope rather than a new rule.
    const block = ROUTERS.slice(ROUTERS.indexOf('quotations: protectedProcedure'));
    expect(block.slice(0, 600)).toContain("requesterId !== ctx.user.id");
    expect(block.slice(0, 2000)).toContain('attachments:      quotations.attachments');
  });
});
