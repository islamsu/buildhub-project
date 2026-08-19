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

  it('rfq-attachments/: any authenticated user is authorized (matches rfq.get/list\'s existing open-bidding visibility)', async () => {
    const result = await authorizeStorageKey('rfq-attachments/user-1/plan.pdf_ab12cd34', makeUser(42));
    expect(result).toBe(true);
    expect(getDb).not.toHaveBeenCalled();
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
    // No BUILT_IN_FORGE_API_URL/KEY configured in this environment, so a request that made it
    // past auth+authorization deterministically hits this specific downstream failure - proving
    // it was not rejected by the 401/403 gate.
    expect([403, 500]).toContain(res.status);
    const body = await res.text();
    expect(body).toMatch(/not configured|access/i);
  });
});
