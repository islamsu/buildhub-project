/**
 * ── MESSAGING: THE READS AND THE READ STATE ───────────────────────────────
 *
 * WHAT ALREADY WORKED, so the fixes are not mistaken for a rewrite: a message
 * is delivered to a real, active account and never to a guessed id; a quotation
 * reference must belong to somebody who is a party to it; an attachment must be
 * a file this sender uploaded; and the storage proxy re-derives that rule
 * rather than trusting it. None of that is touched here.
 *
 * THREE THINGS WERE WRONG, and the first was visible to every user.
 *
 *   NOTHING EVER MARKED A MESSAGE READ. `messages.read` is written `false` on
 *   insert and there was no writer for `true` anywhere in the codebase, nor any
 *   control that offered to be one - so a conversation's unread badge could
 *   only ever grow. Opening a thread, reading it and replying to it left the
 *   count exactly where it was. (The "Mark all read" button on the Messages
 *   PAGE belongs to its Notifications tab and correctly marks notifications;
 *   the messages themselves simply had no equivalent.)
 *
 *   `conversations` LOADED EVERY MESSAGE THE USER HAD EVER EXCHANGED - no
 *   limit, no aggregate - and reduced it in JavaScript to a list of peers with
 *   a last line and a count. That is the whole of somebody's correspondence
 *   pulled across the wire to render a sidebar.
 *
 *   `list` HAD NO PAGINATION, and a mode that returned the entire inbox across
 *   every thread. Nothing called that mode - the one caller always passes a
 *   thread - so requiring the thread is a tightening, not a lost capability.
 *
 * ── A READ RECEIPT IS THE RECEIVER'S TO GIVE ──────────────────────────────
 *
 * `markThreadRead` marks the messages the OTHER person sent TO the caller. It
 * cannot mark the caller's own sent messages read, because that would be
 * forging a receipt: telling the sender their message was read by somebody who
 * has not read it. The direction is the authorization, and it is why this takes
 * no message ids at all - there is no id to point at the wrong row.
 */
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { messages, users } from '../drizzle/schema';

type Db = any;

/** A sidebar is a sidebar. Pulling a thousand correspondents to draw one is not. */
export const CONVERSATION_PAGE_SIZE = 50;
/** One screenful of history, with older pages fetched on demand. */
export const THREAD_PAGE_SIZE = 50;
export const THREAD_PAGE_SIZE_MAX = 100;

/** The two people in a thread, as a SQL predicate. Used by every thread read. */
export function betweenFilter(userId: number, otherUserId: number) {
  return sql`(${messages.senderId} = ${userId} AND ${messages.receiverId} = ${otherUserId})
          OR (${messages.senderId} = ${otherUserId} AND ${messages.receiverId} = ${userId})`;
}

/** Every message touching this account, in either direction. */
export function involvingFilter(userId: number) {
  return sql`${messages.senderId} = ${userId} OR ${messages.receiverId} = ${userId}`;
}

export type ConversationSummary = {
  id: number;
  name: string;
  initials: string;
  lastMessage: string;
  lastMessageAt: Date | null;
  unread: number;
  role: string;
};

const initialsOf = (name: string) =>
  name.split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase();

/**
 * THE SIDEBAR, IN THREE BOUNDED QUERIES instead of one unbounded one.
 *
 *   1. Per correspondent: the id of the most recent message, and how many of
 *      theirs the caller has not read. Aggregated by the database, which is
 *      what a GROUP BY is for - the previous version did this in JavaScript
 *      over every message in the account's history.
 *   2. Those last messages, by id.
 *   3. Those people, by id.
 *
 * Ordered by the most recent message and capped, so a busy account renders the
 * same way a quiet one does.
 */
export async function listConversations(
  db: Db,
  userId: number,
  limit = CONVERSATION_PAGE_SIZE,
): Promise<ConversationSummary[]> {
  const peerExpression = sql<number>`CASE WHEN ${messages.senderId} = ${userId} THEN ${messages.receiverId} ELSE ${messages.senderId} END`;
  const peers: { peerId: number; lastMessageId: number; unread: number }[] = await db
    .select({
      peerId: peerExpression,
      lastMessageId: sql<number>`MAX(${messages.id})`,
      // COUNTED IN SQL, and only in the receiving direction: a message the
      // caller SENT is not something they can leave unread.
      unread: sql<number>`SUM(CASE WHEN ${messages.receiverId} = ${userId} AND ${messages.read} = FALSE THEN 1 ELSE 0 END)`,
    })
    .from(messages)
    .where(involvingFilter(userId))
    .groupBy(peerExpression)
    .orderBy(sql`MAX(${messages.id}) DESC`)
    .limit(limit);

  if (peers.length === 0) return [];

  const [lastMessages, people] = await Promise.all([
    db.select({ id: messages.id, content: messages.content, createdAt: messages.createdAt })
      .from(messages)
      .where(inArray(messages.id, peers.map(peer => Number(peer.lastMessageId)))),
    db.select({ id: users.id, name: users.name, userRole: users.userRole })
      .from(users)
      .where(inArray(users.id, peers.map(peer => Number(peer.peerId)))),
  ]);

  type LastMessage = { id: number; content: string; createdAt: Date };
  type Person = { id: number; name: string | null; userRole: string | null };
  const messageById = new Map<number, LastMessage>(
    (lastMessages as LastMessage[]).map(row => [Number(row.id), row]));
  const personById = new Map<number, Person>(
    (people as Person[]).map(row => [Number(row.id), row]));

  return peers.flatMap(peer => {
    const person = personById.get(Number(peer.peerId));
    // A correspondent whose account has gone is not rendered as a blank row.
    if (!person) return [];
    const last = messageById.get(Number(peer.lastMessageId));
    const name = person.name || 'BuildHub user';
    return [{
      id: Number(peer.peerId),
      name,
      initials: initialsOf(name),
      lastMessage: last?.content ?? '',
      // THE DATE ITSELF, not a string formatted on the server. The previous
      // version called toLocaleDateString() in the router, which pinned every
      // reader to the SERVER's locale - an Arabic reader received an English
      // date and could do nothing about it.
      lastMessageAt: last?.createdAt ?? null,
      unread: Number(peer.unread ?? 0),
      role: person.userRole || 'Member',
    }];
  });
}

/**
 * ONE THREAD, NEWEST FIRST, ONE PAGE AT A TIME.
 *
 * Returned oldest-first for rendering, but SELECTED newest-first so the page
 * boundary is the recent end of the conversation - which is the end somebody
 * opening a thread is looking at. `before` is a message id, so paging is stable
 * while new messages arrive: an offset would skip or repeat a line every time
 * the other person replied mid-scroll.
 */
export async function listThread(
  db: Db,
  params: { userId: number; otherUserId: number; limit?: number; before?: number },
) {
  const limit = Math.min(params.limit ?? THREAD_PAGE_SIZE, THREAD_PAGE_SIZE_MAX);
  const where = params.before
    ? and(betweenFilter(params.userId, params.otherUserId), lt(messages.id, params.before))
    : betweenFilter(params.userId, params.otherUserId);
  // One more than asked for, to answer "is there an older page" without a
  // second COUNT over the same rows.
  const rows = await db.select().from(messages).where(where).orderBy(desc(messages.id)).limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    messages: [...page].reverse(),
    hasMore,
    /** The id to pass back as `before` for the previous page, or null. */
    nextBefore: hasMore && page.length > 0 ? Number(page[page.length - 1].id) : null,
  };
}

/**
 * Mark everything the other person sent to the caller as read.
 *
 * NO MESSAGE IDS, and that is the design: the caller names a correspondent, and
 * the predicate does the rest. There is no id to point at somebody else's row,
 * and the `receiverId = caller` clause means a read receipt can only ever be
 * given by the person who received the message.
 *
 * Returns how many it moved, so a caller can tell "nothing was unread" from
 * "the write did not happen" - the same distinction the Messages page's old
 * button could not make, because it was marking notifications.
 */
export async function markThreadRead(
  db: Db,
  params: { userId: number; otherUserId: number },
): Promise<{ marked: number }> {
  const result = await db.update(messages).set({ read: true }).where(and(
    eq(messages.senderId, params.otherUserId),
    eq(messages.receiverId, params.userId),
    eq(messages.read, false),
  ));
  return { marked: Number(result?.[0]?.affectedRows ?? result?.affectedRows ?? 0) };
}

/** Unread across every thread, for the one badge the navigation renders. */
export async function unreadMessageCount(db: Db, userId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(and(eq(messages.receiverId, userId), eq(messages.read, false)));
  return Number(row?.count ?? 0);
}
