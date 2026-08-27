import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { User } from '../drizzle/schema';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));
vi.mock('./_core/sdk', () => ({
  sdk: { authenticateRequest: vi.fn() },
}));

import { getDb } from './db';
import { sdk } from './_core/sdk';
import { authorizeStorageKey, registerStorageProxy } from './_core/storageProxy';

function makeUser(id: number, role: 'user' | 'admin' = 'user'): User {
  return {
    id, role, openId: `u${id}`, username: null, name: null, email: null, phone: null,
    loginMethod: null, accountSource: 'self_registered', isDummy: false, createdBy: null,
    creationNote: null, deactivatedAt: null, accountStatus: 'active', frozenAt: null,
    frozenReason: null, userRole: 'homeowner', avatar: null, bio: null, location: null,
    verified: false, onboardingStatus: 'not_started', onboardingReviewNotes: null,
    onboardingReviewedAt: null, onboardingReviewedBy: null, invitationStatus: 'none',
    invitationToken: null, invitationExpiresAt: null, invitationSentAt: null,
    passwordSetAt: null, passwordHash: null, rating: '0.00', reviewCount: 0,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as User;
}

/**
 * Every scalar bound into a Drizzle predicate, in order.
 *
 * `eq(rfqs.requesterId, 7)` builds an SQL object whose `queryChunks` interleave
 * string fragments, column refs and the bound values themselves. Walking it is
 * the only way a test with a mocked driver can see WHICH id a query was scoped
 * to - and scoping is exactly the claim below.
 */
function boundValues(predicate: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (node: unknown): void => {
    if (node == null) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if ('queryChunks' in record) { walk(record.queryChunks); return; }
      if ('value' in record) { walk(record.value); return; }
      return;
    }
    if (typeof node === 'number' || typeof node === 'bigint') out.push(Number(node));
  };
  walk(predicate);
  return out;
}

describe('authorizeStorageKey (unit — the exact function the live route calls)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('denies unauthenticated access to every category', async () => {
    await expect(authorizeStorageKey('registration/1/x_abc.pdf', null)).resolves.toBe(false);
    await expect(authorizeStorageKey('project-documents/user-1/project-1/x_abc.pdf', null)).resolves.toBe(false);
    await expect(authorizeStorageKey('message-attachments/user-1/x_abc.pdf', null)).resolves.toBe(false);
    await expect(authorizeStorageKey('rfq-attachments/user-1/x_abc.pdf', null)).resolves.toBe(false);
  });

  it('admins are authorized without a DB lookup', async () => {
    const result = await authorizeStorageKey('registration/1/x_abc.pdf', makeUser(999, 'admin'));
    expect(result).toBe(true);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('registration/: the owner is authorized', async () => {
    const where = vi.fn().mockResolvedValue([{ userId: 5 }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: () => ({ from: () => ({ where }) }) });
    await expect(authorizeStorageKey('registration/5/1700-doc.pdf_ab12cd34', makeUser(5))).resolves.toBe(true);
  });

  it('registration/: a different customer is denied (compliance doc protected)', async () => {
    const where = vi.fn().mockResolvedValue([{ userId: 5 }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: () => ({ from: () => ({ where }) }) });
    await expect(authorizeStorageKey('registration/5/1700-doc.pdf_ab12cd34', makeUser(6))).resolves.toBe(false);
  });

  it('registration/: unknown key is denied', async () => {
    const where = vi.fn().mockResolvedValue([]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: () => ({ from: () => ({ where }) }) });
    await expect(authorizeStorageKey('registration/5/does-not-exist_zz', makeUser(5))).resolves.toBe(false);
  });

  it('project-documents/: the project owner is authorized', async () => {
    let call = 0;
    const results = [[{ projectId: 10 }], [{ id: 10 }]];
    const where = vi.fn(() => Promise.resolve(results[call++] ?? []));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: () => ({ from: () => ({ where }) }) });
    await expect(authorizeStorageKey('project-documents/user-1/project-10/plan.pdf_ab12cd34', makeUser(1))).resolves.toBe(true);
  });

  it('project-documents/: a non-owner (e.g. a competing vendor) is denied', async () => {
    let call = 0;
    const results = [[{ projectId: 10 }], []]; // document exists, but caller doesn't own project 10
    const where = vi.fn(() => Promise.resolve(results[call++] ?? []));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: () => ({ from: () => ({ where }) }) });
    await expect(authorizeStorageKey('project-documents/user-1/project-10/plan.pdf_ab12cd34', makeUser(99))).resolves.toBe(false);
  });

  it('message-attachments/: the sender is authorized', async () => {
    const where = vi.fn().mockResolvedValue([{ senderId: 1, receiverId: 2 }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: () => ({ from: () => ({ where }) }) });
    await expect(authorizeStorageKey('message-attachments/user-1/1700-x.pdf_ab12cd34', makeUser(1))).resolves.toBe(true);
  });

  it('message-attachments/: the receiver is authorized', async () => {
    const where = vi.fn().mockResolvedValue([{ senderId: 1, receiverId: 2 }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: () => ({ from: () => ({ where }) }) });
    await expect(authorizeStorageKey('message-attachments/user-1/1700-x.pdf_ab12cd34', makeUser(2))).resolves.toBe(true);
  });

  it('message-attachments/: an uninvolved third party is denied', async () => {
    const where = vi.fn().mockResolvedValue([{ senderId: 1, receiverId: 2 }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: () => ({ from: () => ({ where }) }) });
    await expect(authorizeStorageKey('message-attachments/user-1/1700-x.pdf_ab12cd34', makeUser(3))).resolves.toBe(false);
  });

  it('rfq-attachments/: the requester who uploaded it is authorized, with no query', async () => {
    // The common case, and the one that must never depend on a lookup: reading
    // your own file back while the RFQ is still being drafted, before any row
    // links to it. Asserted as "no SELECT was issued" rather than "getDb was
    // not called" - getDb hands back a cached pool and is not the round trip.
    const select = vi.fn(() => ({ from: () => ({ where: vi.fn().mockResolvedValue([]) }) }));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select });
    await expect(authorizeStorageKey('rfq-attachments/user-7/plan.pdf_ab12cd34', makeUser(7))).resolves.toBe(true);
    expect(select).not.toHaveBeenCalled();
  });

  it('rfq-attachments/: a provider who PAID to open the enquiry is authorized', async () => {
    let call = 0;
    const results = [
      [{ id: 55, attachments: JSON.stringify([{ key: 'rfq-attachments/user-7/plan.pdf_ab12cd34', url: '/manus-storage/x', name: 'plan.pdf', type: 'application/pdf', size: 10 }]) }],
      [{ id: 900 }], // qualifiedEnquiries row for (caller, rfq 55)
    ];
    const where = vi.fn(() => Promise.resolve(results[call++] ?? []));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: () => ({ from: () => ({ where }) }) });
    await expect(authorizeStorageKey('rfq-attachments/user-7/plan.pdf_ab12cd34', makeUser(42))).resolves.toBe(true);
  });

  it('rfq-attachments/: a signed-in user who has NOT opened the enquiry is denied', async () => {
    // The finding this branch exists for. Before the fix this returned true for
    // every authenticated caller, so one free sign-up bought every requester's
    // drawings and BOQs.
    let call = 0;
    const results = [
      [{ id: 55, attachments: JSON.stringify([{ key: 'rfq-attachments/user-7/plan.pdf_ab12cd34', url: '/manus-storage/x', name: 'plan.pdf', type: 'application/pdf', size: 10 }]) }],
      [], // no qualifiedEnquiries row
    ];
    const where = vi.fn(() => Promise.resolve(results[call++] ?? []));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: () => ({ from: () => ({ where }) }) });
    await expect(authorizeStorageKey('rfq-attachments/user-7/plan.pdf_ab12cd34', makeUser(42))).resolves.toBe(false);
  });

  it('rfq-attachments/: a key no RFQ references is denied even with an enquiry open', async () => {
    let call = 0;
    const results = [
      [{ id: 55, attachments: JSON.stringify([{ key: 'rfq-attachments/user-7/other.pdf_zzzzzzzz', url: '/x', name: 'other.pdf', type: 'application/pdf', size: 10 }]) }],
      [{ id: 900 }],
    ];
    const where = vi.fn(() => Promise.resolve(results[call++] ?? []));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: () => ({ from: () => ({ where }) }) });
    await expect(authorizeStorageKey('rfq-attachments/user-7/plan.pdf_ab12cd34', makeUser(42))).resolves.toBe(false);
  });

  it('rfq-attachments/: candidate RFQs are scoped to the UPLOADER, so a stolen key cannot be laundered', async () => {
    // Attack: learn someone's key, reference it from an RFQ you own, then fetch
    // it as "your own attachment". The lookup must only ever consider RFQs owned
    // by the id embedded in the key, so the attacker's own RFQ is never a
    // candidate.
    //
    // This asserts the PREDICATE, not just the outcome. An earlier version of
    // this test fed canned rows to a positional mock, which meant swapping
    // `uploaderId` for `user.id` in the query changed nothing it could see -
    // the mutation survived. Reading the bound value is what actually pins the
    // scope.
    let call = 0;
    const results = [
      [{ id: 55, attachments: JSON.stringify([{ key: 'rfq-attachments/user-7/plan.pdf_ab12cd34', url: '/x', name: 'p', type: 'application/pdf', size: 1 }]) }],
      [{ id: 900 }],
    ];
    const where = vi.fn(() => Promise.resolve(results[call++] ?? []));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: () => ({ from: () => ({ where }) }) });

    await authorizeStorageKey('rfq-attachments/user-7/plan.pdf_ab12cd34', makeUser(42));

    expect(where).toHaveBeenCalledTimes(2);
    // Query 1 finds candidate RFQs: bound to the UPLOADER (7), never the caller.
    expect(boundValues(where.mock.calls[0][0])).toContain(7);
    expect(boundValues(where.mock.calls[0][0])).not.toContain(42);
    // Query 2 finds the enquiry: bound to the CALLER (42) and to that RFQ (55).
    expect(boundValues(where.mock.calls[1][0])).toEqual(expect.arrayContaining([55, 42]));
  });

  it('rfq-attachments/: a key with no parseable uploader id is denied without touching the database', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: () => ({ from: () => ({ where: vi.fn().mockResolvedValue([{ id: 1 }]) }) }) });
    await expect(authorizeStorageKey('rfq-attachments/plan.pdf_ab12cd34', makeUser(42))).resolves.toBe(false);
    await expect(authorizeStorageKey('rfq-attachments/user-abc/plan.pdf', makeUser(42))).resolves.toBe(false);
  });

  it('rfq-attachments/: matching is exact, so a LIKE wildcard in the key cannot widen it', async () => {
    // `_` is legal in these keys (the filename sanitiser produces it) and is a
    // single-character wildcard in SQL LIKE. Matching in JS by string equality
    // is what keeps a near-miss key from resolving to a DIFFERENT file.
    let call = 0;
    const results = [
      [{ id: 55, attachments: JSON.stringify([{ key: 'rfq-attachments/user-7/planXpdf_ab12cd34', url: '/x', name: 'p', type: 'application/pdf', size: 1 }]) }],
      [{ id: 900 }],
    ];
    const where = vi.fn(() => Promise.resolve(results[call++] ?? []));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: () => ({ from: () => ({ where }) }) });
    await expect(authorizeStorageKey('rfq-attachments/user-7/plan_pdf_ab12cd34', makeUser(42))).resolves.toBe(false);
  });

  it('unclassified key prefixes fail closed', async () => {
    await expect(authorizeStorageKey('generated/1700.png', makeUser(1))).resolves.toBe(false);
    await expect(authorizeStorageKey('../../etc/passwd', makeUser(1))).resolves.toBe(false);
  });

  it('fails closed when the database is unavailable', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(authorizeStorageKey('registration/1/x_abc.pdf', makeUser(1))).resolves.toBe(false);
  });
});

describe('/manus-storage/* (live Express route — real HTTP requests)', () => {
  let server: ReturnType<express.Express['listen']>;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const app = express();
    registerStorageProxy(app);
    await new Promise<void>(resolve => {
      server = app.listen(0, () => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('rejects an unauthenticated request with 401', async () => {
    (sdk.authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no session'));
    const res = await fetch(`${baseUrl}/manus-storage/registration/1/x_abc.pdf`);
    expect(res.status).toBe(401);
  });

  it('rejects a logged-in but unauthorized user with 403 (cross-customer access denied)', async () => {
    (sdk.authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser(6));
    const where = vi.fn().mockResolvedValue([{ userId: 5 }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: () => ({ from: () => ({ where }) }) });
    const res = await fetch(`${baseUrl}/manus-storage/registration/5/1700-doc.pdf_ab12cd34`);
    expect(res.status).toBe(403);
  });

  it('lets an authorized owner past the auth gate (reaches the Forge-config check next)', async () => {
    (sdk.authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser(5));
    const where = vi.fn().mockResolvedValue([{ userId: 5 }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: () => ({ from: () => ({ where }) }) });
    const res = await fetch(`${baseUrl}/manus-storage/registration/5/1700-doc.pdf_ab12cd34`);
    // No object storage configured in this environment, so a request that made
    // it past auth+authorization deterministically hits this specific
    // downstream outcome - proving it was not rejected by the 401/403 gate.
    //
    // 503, not 500. Changed deliberately: nothing failed, the deployment
    // simply has no storage configured, and a 500 sends an operator hunting a
    // crash (and a monitor paging somebody) over a missing environment
    // variable. It also has to stay DISTINCT from 401 and 403 for this test to
    // mean anything, which it does.
    expect(res.status).toBe(503);
    expect([401, 403]).not.toContain(res.status);
    const body = await res.text();
    expect(body).toMatch(/not configured/i);
    // ...and says nothing about where files live.
    expect(body).not.toMatch(/bucket|s3|forge|amazonaws|http/i);
  });
});
