/**
 * ── THE SUPPORT TICKET SERVICE ────────────────────────────────────────────
 *
 * One place where a ticket's rules live, so no procedure re-derives them.
 *
 * THE THREE RULES THIS FILE EXISTS TO HOLD:
 *
 *   1. ACCESS. A requester sees their own tickets and nobody else's. Staff see
 *      the queue. There is no third case, and no procedure re-checks it its
 *      own way - `requireTicketAccess` is the only door.
 *
 *   2. TRANSITIONS. A status moves only along an edge declared in
 *      shared/supportTickets.ts, and every move writes history. The generic
 *      "set any status from any state" mutation this project removed from
 *      disputes is not recreated here.
 *
 *   3. WHAT A REPLY MEANS. A requester replying to a ticket that was waiting
 *      on them moves it back to the queue automatically. Nobody should have to
 *      remember to change a status to make their answer visible, and a support
 *      queue whose "waiting on user" list is stale is worse than none.
 */
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import {
  supportTickets, supportTicketMessages, supportTicketAttachments,
  supportTicketStatusHistory, users,
} from '../drizzle/schema';
import {
  canTransitionSupport, supportReference, supportAwaitingParty,
  type SupportStatus,
} from '../shared/supportTickets';
import { containsTerm } from './_core/searchTerms';
import { adminPage, COUNT, allOf, enumFilter, type AdminPage } from './adminList';

type Db = any;

export type TicketAccess = {
  ticket: { id: number; requesterId: number; status: SupportStatus; reference: string | null };
  /** How this reader reached it. Not a role: an admin reading their OWN ticket is 'requester'. */
  via: 'requester' | 'support';
};

export class SupportTicketError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'BAD_REQUEST', message: string) {
    super(message);
  }
}

/**
 * The ONE door. Returns how the reader got in, so a caller can decide what to
 * show without re-deriving who they are.
 *
 * A MISSING TICKET AND AN UNAUTHORIZED ONE BOTH READ AS NOT FOUND. Anything
 * else lets a stranger enumerate ticket ids by watching which ones say
 * "forbidden" - the same rule the project applies to disputes and projects.
 */
export async function requireTicketAccess(
  db: Db, ticketId: number, userId: number, isSupportStaff: boolean,
): Promise<TicketAccess> {
  const [row] = await db.select({
    id: supportTickets.id,
    requesterId: supportTickets.requesterId,
    status: supportTickets.status,
    reference: supportTickets.reference,
  }).from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1);

  if (!row) throw new SupportTicketError('NOT_FOUND', 'Ticket not found');
  if (row.requesterId === userId) return { ticket: row, via: 'requester' };
  if (isSupportStaff) return { ticket: row, via: 'support' };
  throw new SupportTicketError('NOT_FOUND', 'Ticket not found');
}

/**
 * Move a ticket, or refuse and say why in terms of the states involved.
 *
 * Writes the history row in the same call, because a transition that is
 * recorded only when the caller remembers to is a transition that will
 * sometimes not be recorded.
 */
export async function transitionTicket(db: Db, params: {
  ticketId: number;
  from: SupportStatus;
  to: SupportStatus;
  actorId: number;
  reason?: string | null;
  /** Extra columns the specific transition owns - resolvedBy, closedAt, and so on. */
  patch?: Record<string, unknown>;
}): Promise<void> {
  if (params.from === params.to) {
    throw new SupportTicketError('BAD_REQUEST', `The ticket is already ${params.to}.`);
  }
  if (!canTransitionSupport(params.from, params.to)) {
    throw new SupportTicketError(
      'BAD_REQUEST',
      `A ${params.from} ticket cannot move to ${params.to}.`,
    );
  }
  await db.update(supportTickets)
    .set({ status: params.to, ...(params.patch ?? {}) })
    .where(eq(supportTickets.id, params.ticketId));
  await db.insert(supportTicketStatusHistory).values({
    ticketId: params.ticketId,
    fromStatus: params.from,
    toStatus: params.to,
    actorId: params.actorId,
    reason: params.reason ?? null,
  });
}

/**
 * What a REQUESTER's reply does to the ticket, decided here rather than at the
 * call site.
 *
 *   awaiting_user -> in_progress   they answered; it is our turn again
 *   resolved      -> in_progress   they are not satisfied; this is the reopen
 *   closed        -> refused       closed is terminal, and a reply to a closed
 *                                  ticket must not silently resurrect it
 *   anything else -> unchanged
 */
export function statusAfterUserReply(current: SupportStatus): SupportStatus | null {
  if (current === 'closed') return null;
  if (current === 'awaiting_user' || current === 'resolved') return 'in_progress';
  return null;
}

/** Interpret the admin search box: a reference, a bare id, or free text. */
export function interpretTicketSearch(raw: string | null | undefined): {
  referenceId: number | null; text: string | null;
} {
  const term = (raw ?? '').trim();
  if (!term) return { referenceId: null, text: null };
  const match = /^SUP-\d{4}-(\d+)$/i.exec(term);
  if (match) {
    const id = Number(match[1]);
    if (Number.isSafeInteger(id) && id > 0) return { referenceId: id, text: null };
  }
  if (/^\d+$/.test(term)) {
    const id = Number(term);
    if (Number.isSafeInteger(id) && id > 0) return { referenceId: id, text: null };
  }
  return { referenceId: null, text: term };
}

export type AdminTicketRow = {
  id: number; reference: string | null; subject: string;
  category: string; priority: string; status: string;
  requesterId: number; requesterName: string | null;
  assignedTo: number | null; assigneeName: string | null;
  createdAt: Date; lastUserReplyAt: Date | null;
  awaitingParty: 'user' | 'support' | 'nobody';
};

/**
 * The support queue, paged and filtered.
 *
 * ORDERED BY WHO IS WAITING ON US. `open` and `in_progress` first, then the
 * ones waiting on the customer, then the finished ones - because a support
 * queue sorted by id is a list, not a queue. Within a band, oldest first: the
 * person who has waited longest is the person to answer.
 */
export async function listSupportTickets(db: Db, input: {
  page?: number; pageSize?: number;
  status?: string; category?: string; priority?: string;
  assignee?: 'all' | 'mine' | 'unassigned';
  search?: string | null;
  actorId?: number | null;
}): Promise<AdminPage<AdminTicketRow>> {
  const requester = alias(users, 'ticketRequester');
  const assignee = alias(users, 'ticketAssignee');

  const joined = (builder: any) => builder
    .innerJoin(requester, eq(requester.id, supportTickets.requesterId))
    .leftJoin(assignee, eq(assignee.id, supportTickets.assignedTo));

  const { referenceId, text } = interpretTicketSearch(input.search);
  const filters: unknown[] = [
    enumFilter(supportTickets.status, input.status, eq),
    enumFilter(supportTickets.category, input.category, eq),
    enumFilter(supportTickets.priority, input.priority, eq),
    referenceId !== null ? eq(supportTickets.id, referenceId) : null,
    text
      ? or(
          sql`${supportTickets.subject} LIKE ${containsTerm(text)}`,
          sql`${requester.name} LIKE ${containsTerm(text)}`,
        )
      : null,
  ];

  if (input.assignee === 'unassigned') filters.push(isNull(supportTickets.assignedTo));
  if (input.assignee === 'mine') {
    // No actor means no "mine". Widening to everything would silently answer a
    // different question than the one asked.
    filters.push(input.actorId ? eq(supportTickets.assignedTo, input.actorId) : sql`1 = 0`);
  }

  const where = allOf(and, filters);

  const rows = await adminPage<any>({
    countQuery: joined(db.select(COUNT).from(supportTickets)),
    rowsQuery: joined(db.select({
      id: supportTickets.id,
      reference: supportTickets.reference,
      subject: supportTickets.subject,
      category: supportTickets.category,
      priority: supportTickets.priority,
      status: supportTickets.status,
      requesterId: supportTickets.requesterId,
      requesterName: requester.name,
      assignedTo: supportTickets.assignedTo,
      assigneeName: assignee.name,
      createdAt: supportTickets.createdAt,
      lastUserReplyAt: supportTickets.lastUserReplyAt,
    }).from(supportTickets)),
    where,
    orderBy: [
      sql`field(${supportTickets.status}, 'open', 'in_progress', 'awaiting_user', 'resolved', 'closed')`,
      sql`field(${supportTickets.priority}, 'urgent', 'high', 'medium', 'low')`,
      supportTickets.createdAt,
    ],
    page: input.page ?? 0,
    pageSize: input.pageSize ?? 20,
  });

  return {
    ...rows,
    rows: rows.rows.map(row => ({
      ...row,
      reference: row.reference ?? supportReference(row.id, row.createdAt),
      awaitingParty: supportAwaitingParty(row.status as SupportStatus),
    })) as AdminTicketRow[],
  };
}

/** A requester's own tickets, newest first. Their list is small; the queue is not. */
export async function listMyTickets(db: Db, userId: number): Promise<AdminTicketRow[]> {
  const rows = await db.select({
    id: supportTickets.id,
    reference: supportTickets.reference,
    subject: supportTickets.subject,
    category: supportTickets.category,
    priority: supportTickets.priority,
    status: supportTickets.status,
    requesterId: supportTickets.requesterId,
    assignedTo: supportTickets.assignedTo,
    createdAt: supportTickets.createdAt,
    lastUserReplyAt: supportTickets.lastUserReplyAt,
  }).from(supportTickets)
    .where(eq(supportTickets.requesterId, userId))
    .orderBy(desc(supportTickets.createdAt));

  return (rows as any[]).map(row => ({
    ...row,
    requesterName: null,
    assigneeName: null,
    reference: row.reference ?? supportReference(row.id, row.createdAt),
    awaitingParty: supportAwaitingParty(row.status as SupportStatus),
  })) as AdminTicketRow[];
}

/**
 * The conversation, plus its attachments.
 *
 * NOTE WHAT IS NOT HERE: adminNotes. Internal staff discussion is fetched by a
 * separate, permissioned procedure, so there is no path by which a requester's
 * detail view could ever include it.
 */
export async function ticketThread(db: Db, ticketId: number) {
  const author = alias(users, 'ticketMessageAuthor');
  const messages = await db.select({
    id: supportTicketMessages.id,
    authorId: supportTicketMessages.authorId,
    authorSide: supportTicketMessages.authorSide,
    authorName: author.name,
    body: supportTicketMessages.body,
    createdAt: supportTicketMessages.createdAt,
  }).from(supportTicketMessages)
    .innerJoin(author, eq(author.id, supportTicketMessages.authorId))
    .where(eq(supportTicketMessages.ticketId, ticketId))
    .orderBy(supportTicketMessages.createdAt);

  const attachmentRows = await db.select({
    id: supportTicketAttachments.id,
    fileName: supportTicketAttachments.fileName,
    contentType: supportTicketAttachments.contentType,
    sizeBytes: supportTicketAttachments.sizeBytes,
    storageKey: supportTicketAttachments.storageKey,
    uploadedBy: supportTicketAttachments.uploadedBy,
    createdAt: supportTicketAttachments.createdAt,
  }).from(supportTicketAttachments)
    .where(and(
      eq(supportTicketAttachments.ticketId, ticketId),
      isNull(supportTicketAttachments.removedAt),
    ))
    .orderBy(supportTicketAttachments.createdAt);

  /**
   * THE URL IS BUILT HERE, not in the component. Every other attachment
   * surface in this codebase returns a server-built `url` and the client just
   * follows it; a page that assembles `/manus-storage/...` itself duplicates
   * the proxy's addressing scheme in a second place, and the route-integrity
   * guard is right to call that a link the client invented.
   */
  const attachments = (attachmentRows as any[]).map(file => ({
    ...file,
    url: `/manus-storage/${file.storageKey}`,
  }));

  const history = await db.select({
    id: supportTicketStatusHistory.id,
    fromStatus: supportTicketStatusHistory.fromStatus,
    toStatus: supportTicketStatusHistory.toStatus,
    actorId: supportTicketStatusHistory.actorId,
    reason: supportTicketStatusHistory.reason,
    createdAt: supportTicketStatusHistory.createdAt,
  }).from(supportTicketStatusHistory)
    .where(eq(supportTicketStatusHistory.ticketId, ticketId))
    .orderBy(supportTicketStatusHistory.createdAt);

  return { messages, attachments, history };
}
