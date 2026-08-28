// ── Attaching a file to a message ──────────────────────────────────────────
//
// CLOSURE PART 9/12. `messages.send` declared `fileUrl: z.string().url()`.
//
// THE FEATURE WAS BROKEN. storagePut returns a RELATIVE proxy path -
// `/manus-storage/<key>` - and MessagesPage sends exactly that back. A relative
// path is not a valid URL, so zod refused every real attachment: the upload
// succeeded and the send immediately after it failed. Attaching a file to a
// message has never worked in this product.
//
// AND IT WAS A LATENT IDOR. The storage proxy authorizes a message attachment
// by finding the message row whose fileUrl equals the requested path, then
// checking the caller is sender or receiver. A message referencing SOMEONE
// ELSE'S key would therefore have handed its sender that file. It was not
// exploitable only because the absolute URL zod demanded could never equal the
// relative path the proxy compares against - so fixing the broken feature
// WITHOUT fixing this would have opened the hole.
//
// Both halves are pinned here, because a future edit that relaxes the pattern
// re-creates the second the moment it fixes the first.

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const STORAGE = read('./storage.ts');
const PROXY = read('./_core/storageProxy.ts');

function ctxFor(id: number): TrpcContext {
  return {
    user: {
      id, openId: `u-${id}`, email: `u${id}@t.com`, name: `User ${id}`, username: `u${id}`,
      loginMethod: 'password', role: 'user', userRole: 'homeowner',
      accountStatus: 'active', onboardingStatus: 'approved', isDummy: false,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  };
}

function stubDb() {
  const values = vi.fn().mockResolvedValue([{ insertId: 7 }]);
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
    insert: vi.fn(() => ({ values })),
    // The recipient lookup must find an ACTIVE account. `messages.send` gained
    // a guard requiring the receiver to be a real active user - it previously
    // accepted any positive integer, which (with the fabricated conversation
    // list the Messages page used to render) delivered messages to whichever
    // real account held that id. This stub returns one so these tests keep
    // testing what they are about, which is ATTACHMENT authorization.
    select: vi.fn(() => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.resolve([]) }), where: () => Promise.resolve([{ id: 2, accountStatus: 'active' }]) }) })),
  });
  return values;
}

describe('the shape the product actually produces is the shape accepted', () => {
  it('storagePut returns a RELATIVE proxy path - this is the premise', () => {
    // If this ever becomes an absolute URL, the regex below must change with
    // it, so the premise is asserted rather than remembered.
    expect(STORAGE).toContain('url: `/manus-storage/${key}`');
  });

  it('REGRESSION: a real message upload path is accepted', async () => {
    const values = stubDb();
    await expect(appRouter.createCaller(ctxFor(5)).messages.send({
      receiverId: 9, content: 'contract.pdf', type: 'file',
      fileUrl: '/manus-storage/message-attachments/user-5/1700-contract_ab12cd34.pdf',
    })).resolves.toMatchObject({ id: 7 });
    expect(values).toHaveBeenCalled();
  });

  it('an absolute URL is refused - it could never match the proxy anyway', async () => {
    stubDb();
    await expect(appRouter.createCaller(ctxFor(5)).messages.send({
      receiverId: 9, content: 'x', type: 'file',
      fileUrl: 'https://example.com/manus-storage/message-attachments/user-5/f.pdf',
    })).rejects.toBeDefined();
  });
});

describe('a sender may only attach a file they uploaded', () => {
  it("REGRESSION: another user's message-attachment key is refused", async () => {
    const values = stubDb();
    await expect(appRouter.createCaller(ctxFor(5)).messages.send({
      receiverId: 9, content: 'their-contract.pdf', type: 'file',
      fileUrl: '/manus-storage/message-attachments/user-42/1700-secret_ab12cd34.pdf',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(values, 'nothing may be written').not.toHaveBeenCalled();
  });

  it('a key from a DIFFERENT storage category is refused', async () => {
    // ai-attachments and registration are the uploader's alone; a message must
    // not be able to point at one and inherit the proxy's message rule.
    const values = stubDb();
    for (const path of [
      '/manus-storage/ai-attachments/user-5/f_ab12cd34.pdf',
      '/manus-storage/registration/5/1700-licence_ab12cd34.pdf',
      '/manus-storage/project-documents/user-5/project-1/plan_ab12cd34.pdf',
    ]) {
      await expect(appRouter.createCaller(ctxFor(5)).messages.send({
        receiverId: 9, content: 'x', type: 'file', fileUrl: path,
      }), path).rejects.toBeDefined();
    }
    expect(values).not.toHaveBeenCalled();
  });

  it('a traversal attempt does not slip past the prefix check', async () => {
    stubDb();
    await expect(appRouter.createCaller(ctxFor(5)).messages.send({
      receiverId: 9, content: 'x', type: 'file',
      fileUrl: '/manus-storage/message-attachments/user-50/f_ab12cd34.pdf',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a plain text message still needs no attachment at all', async () => {
    const values = stubDb();
    await expect(appRouter.createCaller(ctxFor(5)).messages.send({ receiverId: 9, content: 'hello' }))
      .resolves.toMatchObject({ id: 7 });
    expect(values).toHaveBeenCalled();
  });
});

describe('why the ownership check has to exist here', () => {
  it('the proxy authorizes by MATCHING the stored fileUrl', () => {
    // This is the mechanism that makes an unchecked fileUrl dangerous: the row
    // the sender created is the row the proxy consults.
    const start = PROXY.indexOf("key.startsWith('message-attachments/')");
    expect(start).toBeGreaterThan(-1);
    const block = PROXY.slice(start, start + 700);
    expect(block).toContain('eq(messages.fileUrl, url)');
    expect(block).toContain('row.senderId === user.id || row.receiverId === user.id');
  });
});
