/**
 * ── MESSAGING: THE READ STATE AND THE BOUNDED READS ───────────────────────
 *
 * Three rules this file exists to pin:
 *
 *   A READ RECEIPT IS THE RECEIVER'S TO GIVE. `markThreadRead` constrains on
 *   `receiverId = caller`, so it cannot mark the caller's OWN sent messages
 *   read on the other party's behalf - that would be telling a sender their
 *   message was read by somebody who has not read it. It takes no message ids
 *   at all, which is why there is no id to point at the wrong row.
 *
 *   THE SIDEBAR IS BOUNDED. It used to SELECT every message the account had
 *   ever exchanged and reduce it in JavaScript. It is now three bounded
 *   queries with the count done by the database.
 *
 *   PAGING IS BY ID, NOT OFFSET. An offset skips or repeats a line every time
 *   the other person replies while somebody is scrolling back through history.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  listConversations, listThread, markThreadRead, unreadMessageCount,
  CONVERSATION_PAGE_SIZE, THREAD_PAGE_SIZE, THREAD_PAGE_SIZE_MAX,
} from './messaging';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const MESSAGING = readSourceForAssertions(read('./messaging.ts'));
const ROUTERS = readSourceForAssertions(read('./routers.ts'));
const PAGE = readSourceForAssertions(read('../client/src/pages/MessagesPage.tsx'));

/**
 * A db double that answers selects in order and records every write, INCLUDING
 * the predicate handed to `where` - which is the thing under test for
 * markThreadRead, since its whole authorization is the predicate.
 */
function fakeDb(selects: unknown[][]) {
  let call = 0;
  const writes: { values: any; where: unknown }[] = [];
  const answer = () => Promise.resolve(selects[call++] ?? []);
  const chain = (): any => ({
    where: () => chain(),
    groupBy: () => chain(),
    orderBy: () => chain(),
    limit: () => answer(),
    then: (ok: any, err: any) => answer().then(ok, err),
  });
  return {
    select: () => ({ from: () => chain() }),
    update: () => ({
      set: (values: any) => ({
        where: (predicate: unknown) => {
          writes.push({ values, where: predicate });
          return Promise.resolve([{ affectedRows: 3 }]);
        },
      }),
    }),
    writes,
    get callCount() { return call; },
  } as any;
}

describe('a read receipt is the receiver’s to give', () => {
  it('marks messages FROM the other person TO the caller, and only unread ones', async () => {
    const db = fakeDb([]);
    const result = await markThreadRead(db, { userId: 5, otherUserId: 9 });
    expect(result).toEqual({ marked: 3 });
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0].values).toEqual({ read: true });
  });

  it('THE PREDICATE IS THE AUTHORIZATION, and it names all three clauses', () => {
    // Read from the source because the clauses are what stop a caller marking
    // somebody else's inbox read, and a double cannot tell one `and(...)` from
    // another.
    const fn = MESSAGING.slice(
      MESSAGING.indexOf('export async function markThreadRead'),
      MESSAGING.indexOf('export async function unreadMessageCount'),
    );
    expect(fn).toContain('eq(messages.senderId, params.otherUserId)');
    expect(fn).toContain('eq(messages.receiverId, params.userId)');
    expect(fn).toContain('eq(messages.read, false)');
  });

  it('IT CANNOT MARK THE CALLER’S OWN SENT MESSAGES READ', () => {
    // The inverse pairing - senderId = caller, receiverId = other - would be
    // forging a receipt on the other party's behalf.
    const fn = MESSAGING.slice(
      MESSAGING.indexOf('export async function markThreadRead'),
      MESSAGING.indexOf('export async function unreadMessageCount'),
    );
    expect(fn).not.toContain('eq(messages.senderId, params.userId)');
    expect(fn).not.toContain('eq(messages.receiverId, params.otherUserId)');
  });

  it('takes NO message ids, so there is no id to aim at the wrong row', () => {
    const procedure = ROUTERS.slice(
      ROUTERS.indexOf('markThreadRead: protectedProcedure'),
      ROUTERS.indexOf('unreadCount: protectedProcedure'),
    );
    expect(procedure).toContain('otherUserId: z.number().int().positive()');
    expect(procedure).not.toMatch(/messageId|ids:/);
    expect(procedure).toContain('userId: ctx.user.id');
  });

  it('reports HOW MANY it moved, so "nothing unread" differs from "no write"', async () => {
    expect((await markThreadRead(fakeDb([]), { userId: 5, otherUserId: 9 })).marked).toBe(3);
  });
});

describe('the sidebar is bounded', () => {
  it('asks the database for a capped, ordered page of correspondents', () => {
    const fn = MESSAGING.slice(
      MESSAGING.indexOf('export async function listConversations'),
      MESSAGING.indexOf('export async function listThread'),
    );
    expect(fn).toContain('.groupBy(peerExpression)');
    expect(fn).toContain('.limit(limit)');
    expect(fn).toMatch(/orderBy\(sql`MAX\(/);
  });

  it('counts unread IN SQL, in the receiving direction only', () => {
    const fn = MESSAGING.slice(
      MESSAGING.indexOf('export async function listConversations'),
      MESSAGING.indexOf('export async function listThread'),
    );
    const unread = fn.slice(fn.indexOf('unread: sql'), fn.indexOf('.from(messages)'));
    expect(unread).toMatch(/messages\.receiverId.*userId/s);
    expect(unread).toMatch(/messages\.read.*FALSE/s);
  });

  it('returns nothing, and asks nothing more, for an account with no messages', async () => {
    const db = fakeDb([[]]);
    expect(await listConversations(db, 5)).toEqual([]);
    expect(db.callCount, 'it went looking for people it had no ids for').toBe(1);
  });

  it('drops a correspondent whose account is gone rather than drawing a blank row', async () => {
    const db = fakeDb([
      [{ peerId: 9, lastMessageId: 40, unread: 2 }],
      [{ id: 40, content: 'hello', createdAt: new Date('2026-01-01') }],
      [], // the person no longer exists
    ]);
    expect(await listConversations(db, 5)).toEqual([]);
  });

  it('returns a DATE, not a string formatted in the server’s locale', async () => {
    // The old version called toLocaleDateString() in the router, which handed
    // every reader the SERVER's locale - an Arabic reader got an English date
    // and could do nothing about it.
    const db = fakeDb([
      [{ peerId: 9, lastMessageId: 40, unread: 2 }],
      [{ id: 40, content: 'hello', createdAt: new Date('2026-01-01') }],
      [{ id: 9, name: 'Mona Said', userRole: 'contractor' }],
    ]);
    const [row] = await listConversations(db, 5);
    expect(row.lastMessageAt).toBeInstanceOf(Date);
    expect(row).toMatchObject({ id: 9, name: 'Mona Said', initials: 'MS', unread: 2, lastMessage: 'hello' });
    expect(MESSAGING).not.toContain('toLocaleDateString');
  });

  it('and the page formats it in the READER’s locale', () => {
    expect(PAGE).toContain("toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB')");
  });

  it('a sidebar page is a sensible size', () => {
    expect(CONVERSATION_PAGE_SIZE).toBeGreaterThan(10);
    expect(CONVERSATION_PAGE_SIZE).toBeLessThanOrEqual(100);
  });
});

describe('a thread is read one page at a time', () => {
  const thread = (n: number) => Array.from({ length: n }, (_, index) => ({ id: 100 - index, content: `m${index}` }));

  it('asks for ONE MORE than the page, to answer "is there more" without a second query', async () => {
    const db = fakeDb([thread(THREAD_PAGE_SIZE + 1)]);
    const page = await listThread(db, { userId: 5, otherUserId: 9 });
    expect(page.messages).toHaveLength(THREAD_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
    expect(page.nextBefore).toBe(100 - (THREAD_PAGE_SIZE - 1));
  });

  it('reports no more, and no cursor, on a short page', async () => {
    const page = await listThread(fakeDb([thread(3)]), { userId: 5, otherUserId: 9 });
    expect(page).toMatchObject({ hasMore: false, nextBefore: null });
    expect(page.messages).toHaveLength(3);
  });

  it('SELECTS newest first and RETURNS oldest first', async () => {
    // Selected from the recent end, because that is the end somebody opening a
    // thread is looking at; rendered in reading order.
    const page = await listThread(fakeDb([[{ id: 100 }, { id: 99 }, { id: 98 }]]), { userId: 5, otherUserId: 9 });
    expect(page.messages.map((row: any) => row.id)).toEqual([98, 99, 100]);
    const fn = MESSAGING.slice(MESSAGING.indexOf('export async function listThread'));
    expect(fn).toContain('orderBy(desc(messages.id))');
  });

  it('PAGES BY ID, NEVER BY OFFSET', () => {
    // An offset skips or repeats a line every time the other person replies
    // while somebody is scrolling back.
    const fn = MESSAGING.slice(
      MESSAGING.indexOf('export async function listThread'),
      MESSAGING.indexOf('export async function markThreadRead'),
    );
    expect(fn).toContain('lt(messages.id, params.before)');
    expect(fn).not.toMatch(/\.offset\(/);
  });

  it('a caller cannot ask for an unbounded page', async () => {
    const db = fakeDb([thread(5)]);
    await listThread(db, { userId: 5, otherUserId: 9, limit: 100000 });
    expect(THREAD_PAGE_SIZE_MAX).toBeLessThanOrEqual(100);
    // And the schema refuses it before the function is even reached.
    const procedure = ROUTERS.slice(
      ROUTERS.indexOf('list: protectedProcedure'),
      ROUTERS.indexOf('markThreadRead: protectedProcedure'),
    );
    expect(procedure).toContain('.max(THREAD_PAGE_SIZE_MAX)');
  });

  it('THE THREAD IS REQUIRED - the whole-inbox mode is gone', () => {
    // It returned the account's entire inbox across every thread, unpaginated.
    // Nothing called it: the single caller is a thread view gated on having
    // selected somebody.
    const procedure = ROUTERS.slice(
      ROUTERS.indexOf('list: protectedProcedure'),
      ROUTERS.indexOf('markThreadRead: protectedProcedure'),
    );
    expect(procedure).toContain('otherUserId: z.number().int().positive(),');
    expect(procedure).not.toMatch(/otherUserId: z\.number\(\)\.optional\(\)/);
  });

  it('both sides of the thread are read, and nobody else’s', () => {
    const fn = MESSAGING.slice(MESSAGING.indexOf('export function betweenFilter'));
    expect(fn.slice(0, 400)).toContain('messages.senderId} = ${userId} AND ${messages.receiverId} = ${otherUserId}');
    expect(fn.slice(0, 400)).toContain('messages.senderId} = ${otherUserId} AND ${messages.receiverId} = ${userId}');
  });
});

describe('the unread badge', () => {
  it('counts only unread messages addressed TO the caller', async () => {
    const db = fakeDb([[{ count: 7 }]]);
    expect(await unreadMessageCount(db, 5)).toBe(7);
    const fn = MESSAGING.slice(MESSAGING.indexOf('export async function unreadMessageCount'));
    expect(fn).toContain('eq(messages.receiverId, userId)');
    expect(fn).toContain('eq(messages.read, false)');
  });

  it('is zero, not undefined, for an account with nothing', async () => {
    expect(await unreadMessageCount(fakeDb([[]]), 5)).toBe(0);
  });
});

describe('opening a thread is what reads it', () => {
  it('the page marks the open thread read', () => {
    expect(PAGE).toContain('trpc.messages.markThreadRead.useMutation');
    expect(PAGE).toContain('markThreadRead.mutate({ otherUserId: selectedConv })');
  });

  it('keyed on the THREAD, not on its messages', () => {
    // Re-running as messages arrive would mark a message read the moment it
    // lands, whether or not anybody is looking at it.
    const effect = PAGE.slice(PAGE.indexOf('markThreadRead.mutate({ otherUserId: selectedConv })'));
    expect(effect.slice(0, 400)).toContain('[isAuthenticated, selectedConv]');
    expect(effect.slice(0, 400)).not.toContain('persistedMessages');
  });

  it('refreshes the sidebar ONLY when something actually moved', () => {
    // Otherwise the list reloads every time somebody clicks between two
    // already-read conversations.
    const handler = PAGE.slice(PAGE.indexOf('onSuccess: ({ marked })'));
    expect(handler.slice(0, 300)).toContain('if (marked > 0)');
    expect(handler.slice(0, 300)).toContain('conversations.invalidate');
  });
});
