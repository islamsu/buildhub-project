import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import { appRouter } from './routers';
import type { TrpcContext } from './_core/trpc';
import { messages as messagesTable, notifications as notificationsTable } from '../drizzle/schema';

/**
 * MESSAGING INTEGRITY.
 *
 * The audit found a compound defect here, and the compound is the point - each
 * half looked survivable alone:
 *
 *   1. MessagesPage rendered four FABRICATED conversations to any signed-in
 *      user with no real ones, using the pattern
 *          persisted.length > 0 ? persisted : MOCK_CONVERSATIONS
 *      Their ids were 1-4 and `selectedConv` defaulted to 1.
 *
 *   2. messages.send accepted ANY positive integer as receiverId, with no
 *      check that the account existed or was active.
 *
 * Together: a new user types into a thread labelled "Ahmed Hassan (Contractor)"
 * and the text is delivered to whichever real account holds user id 1. One of
 * the fabricated threads also contained "Your verification is complete!"
 * attributed to "BuildHub Support" - a platform claim about the reader's own
 * account status, invented in the frontend.
 *
 * These tests pin both halves.
 */

const ctx = (id: number): TrpcContext => ({
  user: {
    id, openId: `u${id}`, email: `u${id}@t.com`, name: 'U',
    loginMethod: 'password', role: 'user', userRole: 'homeowner',
    accountStatus: 'active', isDummy: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  },
  req: { protocol: 'https', headers: { 'x-forwarded-for': '5.5.5.5' } } as TrpcContext['req'],
  res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
} as TrpcContext);

/**
 * A db stub that answers the recipient lookup honestly and records inserts.
 * `users` holds the accounts that exist, so "no such user" is a real absence
 * rather than a stub that forgot to model it.
 */
function stubDb(users: { id: number; accountStatus: string }[]) {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    select: (_projection?: unknown) => ({
      from: (_table: unknown) => ({
        where: (predicate: unknown) => {
          // Pull the bound id out of the (circular) drizzle predicate.
          const seen = new Set<unknown>();
          const numbers: number[] = [];
          const walk = (node: unknown) => {
            if (node === null || typeof node !== 'object' || seen.has(node)) return;
            seen.add(node);
            for (const value of Object.values(node as Record<string, unknown>)) {
              if (typeof value === 'number') numbers.push(value);
              else walk(value);
            }
          };
          walk(predicate);
          const match = users.filter(u => numbers.includes(u.id));
          return Object.assign(Promise.resolve(match), {
            orderBy: () => Promise.resolve(match),
            innerJoin: () => ({ where: () => Promise.resolve([]) }),
          });
        },
      }),
    }),
    // The TABLE is recorded, not just the row. Sending a message now also
    // writes a notification, and a stub that cannot tell the two apart turns
    // "exactly one message was stored" into "exactly one row was stored" -
    // which would have to be relaxed every time a side effect is added, and
    // would stop policing the thing it was written for.
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        inserted.push({ ...row, __table: table === messagesTable ? 'messages' : table === notificationsTable ? 'notifications' : 'other' });
        return Promise.resolve([{ insertId: 99 }]);
      },
    }),
  };
  return { db, inserted };
}

const withDb = async (db: unknown, fn: () => Promise<unknown>) => {
  const dbModule = await import('./db');
  const spy = vi.spyOn(dbModule, 'getDb').mockResolvedValue(db as never);
  try { return await fn(); } finally { spy.mockRestore(); }
};

// ══ 1. THE SERVER REFUSES A RECIPIENT THAT IS NOT REAL AND ACTIVE ══════════

describe('messages.send validates the recipient', () => {
  it('REFUSES a receiverId that belongs to no account', async () => {
    const { db, inserted } = stubDb([{ id: 5, accountStatus: 'active' }]);
    await withDb(db, async () => {
      await expect(
        appRouter.createCaller(ctx(5)).messages.send({ receiverId: 1, content: 'hello' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
    // The refusal must happen BEFORE the write, or the guard is decorative.
    expect(inserted).toHaveLength(0);
  });

  it('REFUSES a recipient whose account is not active', async () => {
    const { db, inserted } = stubDb([
      { id: 5, accountStatus: 'active' },
      { id: 7, accountStatus: 'suspended' },
    ]);
    await withDb(db, async () => {
      await expect(
        appRouter.createCaller(ctx(5)).messages.send({ receiverId: 7, content: 'hello' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
    expect(inserted).toHaveLength(0);
  });

  it('gives the SAME answer for "no such user" and "not active"', async () => {
    // Otherwise the endpoint is a directory of which account ids exist.
    const { db } = stubDb([
      { id: 5, accountStatus: 'active' },
      { id: 7, accountStatus: 'suspended' },
    ]);
    const messages: string[] = [];
    await withDb(db, async () => {
      for (const receiverId of [7, 4242]) {
        await appRouter.createCaller(ctx(5)).messages
          .send({ receiverId, content: 'x' })
          .catch((error: { code: string; message: string }) => {
            messages.push(`${error.code}:${error.message}`);
          });
      }
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe(messages[1]);
  });

  it('REFUSES a message addressed to yourself', async () => {
    const { db, inserted } = stubDb([{ id: 5, accountStatus: 'active' }]);
    await withDb(db, async () => {
      await expect(
        appRouter.createCaller(ctx(5)).messages.send({ receiverId: 5, content: 'hello' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
    expect(inserted).toHaveLength(0);
  });

  it('ACCEPTS a real active recipient - the positive control', async () => {
    // Without this, a build that refused every message would pass everything
    // above and the product would simply be broken in the other direction.
    const { db, inserted } = stubDb([
      { id: 5, accountStatus: 'active' },
      { id: 8, accountStatus: 'active' },
    ]);
    await withDb(db, async () => {
      const sent = await appRouter.createCaller(ctx(5)).messages
        .send({ receiverId: 8, content: 'hello' });
      expect(sent).toMatchObject({ senderId: 5, receiverId: 8, content: 'hello' });
    });
    const messageRows = inserted.filter(row => row.__table === 'messages');
    expect(messageRows).toHaveLength(1);
    expect(messageRows[0]).toMatchObject({ senderId: 5, receiverId: 8 });
  });

  it('TELLS THE RECIPIENT, and points them at the thread', async () => {
    // Nothing notified anyone about a message, so the one contact channel
    // BuildHub operates was silent until the other person happened to open
    // /messages. The link must open the conversation with the SENDER.
    const { db, inserted } = stubDb([
      { id: 5, accountStatus: 'active' },
      { id: 8, accountStatus: 'active' },
    ]);
    await withDb(db, async () => {
      await appRouter.createCaller(ctx(5)).messages.send({ receiverId: 8, content: 'hello' });
    });
    const notes = inserted.filter(row => row.__table === 'notifications');
    expect(notes, 'the recipient must be notified').toHaveLength(1);
    expect(notes[0]).toMatchObject({ userId: 8, type: 'message', link: '/messages?to=5', messageKey: 'notif.message.received' });
  });

  it('and a refused message notifies nobody', async () => {
    // A notification for a message that was never stored would be worse than
    // no notification at all.
    const { db, inserted } = stubDb([{ id: 5, accountStatus: 'active' }]);
    await withDb(db, async () => {
      await appRouter.createCaller(ctx(5)).messages.send({ receiverId: 4242, content: 'x' }).catch(() => undefined);
    });
    expect(inserted.filter(row => row.__table === 'notifications')).toHaveLength(0);
  });

  it('stamps senderId from the SESSION, never from the input', async () => {
    const { db, inserted } = stubDb([
      { id: 5, accountStatus: 'active' },
      { id: 8, accountStatus: 'active' },
    ]);
    await withDb(db, async () => {
      await appRouter.createCaller(ctx(5)).messages.send({
        receiverId: 8, content: 'hello',
        // @ts-expect-error - not in the schema; zod strips it before the handler
        senderId: 999,
      });
    });
    expect(inserted[0].senderId).toBe(5);
  });
});

// ══ 2. THE PAGE CARRIES NO FABRICATED PEOPLE, THREADS OR PRESENCE ══════════

describe('the Messages page shows only real data', () => {
  const PAGE = readSourceForAssertions(readFileSync(new URL('../client/src/pages/MessagesPage.tsx', import.meta.url), 'utf8'));
  // Strip comments FIRST. The file now explains what was removed and why, and
  // an assertion that matched its own explanation would pass on a file that
  // documented the fix while keeping the fabricated data.
  const CODE = PAGE
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  it('defines no mock conversation or message fixture', () => {
    expect(CODE).not.toMatch(/const MOCK_[A-Z_]+\s*[:=]/);
  });

  it('carries none of the invented identities', () => {
    for (const invented of ['Ahmed Hassan', 'Sara Khalil', 'Mohamed Supplier', 'BuildHub Support']) {
      expect(CODE).not.toContain(invented);
    }
  });

  it('makes no platform claim about the reader\'s account', () => {
    // The specific sentence that could have been read as BuildHub telling a
    // waiting supplier they had been approved.
    expect(CODE).not.toMatch(/verification is complete/i);
  });

  it('never falls back from real data to a fixture', () => {
    // The exact shape of the defect: `real.length > 0 ? real : FAKE`.
    expect(CODE).not.toMatch(/\.length > 0 \?\s*\w+\s*:\s*MOCK_/);
  });

  it('does not default the composer at a real user id', () => {
    // `useState<number | null>(1)` aimed the message box at account 1.
    expect(CODE).toMatch(/useState<number \| null>\(null\)/);
    expect(CODE).not.toMatch(/useState<number \| null>\(1\)/);
  });

  it('renders no presence indicator, because there is no presence system', () => {
    expect(CODE).not.toMatch(/conv\.online|activeConv\.online/);
    expect(CODE).not.toMatch(/Online now/);
  });

  it('offers no control that does nothing', () => {
    expect(CODE).not.toMatch(/Coming soon/i);
    expect(CODE).not.toMatch(/قريباً/);
  });

  it('shows a DIFFERENT empty state when there is nothing to select', () => {
    // "Select a conversation to start" was shown even with zero conversations,
    // which instructs the reader to do something the screen cannot do.
    expect(CODE).toMatch(/conversations\.length === 0/);
    expect(CODE).toMatch(/No messages yet/);
    // ...and it must say what to do next, not merely that it is empty.
    expect(CODE).toMatch(/messages-empty-browse/);
  });

  it('does not show a sent message the server refused', () => {
    // appendLocalMessage ran unconditionally, so a rejected send still appeared
    // in the thread as though it had been delivered.
    expect(CODE).not.toContain('appendLocalMessage');
  });
});

// ══ 3. THE UNREAD COUNT IS REAL ════════════════════════════════════════════

describe('conversation metadata is computed, not hard-coded', () => {
  const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'))
    ;

  it('unread is derived from the messages, not pinned to zero', () => {
    expect(ROUTERS).not.toMatch(/unread: 0, online: false/);
    expect(ROUTERS).toMatch(/const unread = rows\.filter/);
    // It must count only messages TO this user, FROM that person, unread.
    expect(ROUTERS).toMatch(/row\.senderId === person\.id/);
    expect(ROUTERS).toMatch(/row\.receiverId === ctx\.user\.id/);
    expect(ROUTERS).toMatch(/!row\.read/);
  });

  it('the `online` field is gone rather than shipped permanently false', () => {
    const conversations = ROUTERS.slice(
      ROUTERS.indexOf('conversations: protectedProcedure'),
      ROUTERS.indexOf('list: protectedProcedure.input(z.object({ otherUserId'),
    );
    expect(conversations.length).toBeGreaterThan(0);
    expect(conversations).not.toMatch(/online:/);
  });
});
