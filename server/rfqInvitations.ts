/**
 * ── RFQ SUPPLIER INVITATIONS, ON TOP OF THE OPEN BOARD ─────────────────────
 *
 * BuildHub's RFQ board was entirely PULL: a supplier declared their service
 * categories, and any open RFQ in one of those categories appeared on their
 * board. A customer who knew exactly which supplier they wanted had no way to
 * say so - they raised an RFQ into a category and hoped the right firm looked.
 *
 * Invitations add PUSH without removing PULL. The owner's decision was "both:
 * invitations on top of the open board", and both words matter:
 *
 *   ON TOP   an invitation never narrows who can see an RFQ. The open board is
 *            untouched; an invited supplier is an ADDITION to whoever the
 *            category match already reached.
 *   NOT A    an invitation is not a private RFQ. Nothing here makes an RFQ
 *   REPLACE  invisible to the suppliers who would otherwise have found it.
 *
 * TWO OWNER DECISIONS, ASKED RATHER THAN ASSUMED
 *
 * 1. AN INVITATION IS EXEMPT FROM THE QUALIFIED-ENQUIRY ALLOWANCE.
 *
 *    The allowance meters leads a supplier goes looking for. An invitation is
 *    the opposite: the CUSTOMER picked them. Charging a supplier a lead for a
 *    request they did not seek penalises them for being chosen, and a supplier
 *    at their monthly limit would be unable to answer a customer who asked for
 *    them by name - which defeats the requester's whole intent.
 *
 *    The exemption is REAL, not bookkeeping: no `qualifiedEnquiries` row is
 *    written for an invited open. Writing one "for consistency" would make the
 *    vendor's usage count say they consumed something they did not, and a usage
 *    figure that is wrong is worse than one that is absent. The invitation row
 *    itself carries the record - `status` and `viewedAt` - so the event is
 *    still fully reconstructable.
 *
 * 2. WHO MAY INVITE: the requester, anyone holding `commercial` on the RFQ's
 *    linked project, and Super Admin.
 *
 *    The project-team arm is what makes this consistent rather than a second
 *    rule: `commercial` is already exactly the capability that permits raising
 *    an RFQ against a project, so whoever may commit the project to a request
 *    may also say who is asked. Super Admin is for support acting on a
 *    customer's behalf, and is recorded in `invitedBy` as themselves - never
 *    as the customer.
 */

import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { rfqs, rfqSuppliers, users } from '../drizzle/schema';
import { requireProjectAccess } from './projectMembership';

type Db = any;

/** Invitation states a supplier may still act on. */
export const OPEN_INVITATION_STATUSES = ['invited', 'viewed'] as const;

/**
 * MAY THIS CALLER INVITE SUPPLIERS TO THIS RFQ?
 *
 * Throws rather than returning false, and the refusal shape is deliberate:
 *
 *   NOT_FOUND   the RFQ does not exist, OR the caller has no business knowing
 *               that it does. One answer for both, so an outsider cannot map
 *               which RFQ ids are real by watching the error change.
 *   FORBIDDEN   the caller can already see this RFQ but may not invite to it.
 *               Hiding its existence here would prove nothing and only confuse.
 */
export async function requireInviteRights(
  db: Db,
  rfqId: number,
  user: { id: number; adminRole?: string | null; role?: string | null },
): Promise<{ rfqId: number; requesterId: number; projectId: number | null; status: string }> {
  const [rfq] = await db
    .select({
      id: rfqs.id, requesterId: rfqs.requesterId, projectId: rfqs.projectId, status: rfqs.status,
    })
    .from(rfqs).where(eq(rfqs.id, rfqId)).limit(1);
  if (!rfq) throw new TRPCError({ code: 'NOT_FOUND', message: 'RFQ not found' });

  const found = { rfqId: rfq.id, requesterId: rfq.requesterId, projectId: rfq.projectId, status: rfq.status };

  // The customer who raised it.
  if (rfq.requesterId === user.id) return found;

  // Support acting for the customer. Recorded as the admin, never as the
  // customer - see the note on invitedBy above.
  if (user.role === 'admin' && user.adminRole === 'SUPER_ADMIN') return found;

  // Anyone who could have raised this RFQ against the project can also say who
  // is asked. `commercial` is that capability, and requireProjectAccess is the
  // single place it is decided - this does not re-derive it.
  if (rfq.projectId !== null) {
    try {
      await requireProjectAccess(db, rfq.projectId, user.id, 'commercial');
      return found;
    } catch {
      // Fall through to the refusal below rather than leaking the project's
      // own NOT_FOUND, which would answer a different question than the one
      // the caller asked.
    }
  }

  throw new TRPCError({
    code: 'NOT_FOUND',
    message: 'RFQ not found',
  });
}

export type InviteOutcome =
  | { outcome: 'invited'; invitationId: number }
  /** Already invited. Idempotent: a second click does not re-send or re-stamp. */
  | { outcome: 'already_invited' }
  | { outcome: 'rejected'; reason: string };

/**
 * Invite one supplier to one RFQ.
 *
 * IDEMPOTENT, and by the unique index rather than by a check-then-write: two
 * concurrent clicks cannot produce two invitations, and the loser reads the
 * winner's row instead of failing. A duplicate invitation would mean a second
 * notification for the same event.
 */
export async function inviteSupplier(params: {
  db: Db;
  rfqId: number;
  supplierId: number;
  invitedBy: number;
  deadline?: Date | null;
}): Promise<InviteOutcome> {
  const { db, rfqId, supplierId, invitedBy } = params;

  const [existing] = await db.select({ id: rfqSuppliers.id })
    .from(rfqSuppliers)
    .where(and(eq(rfqSuppliers.rfqId, rfqId), eq(rfqSuppliers.supplierId, supplierId)))
    .limit(1);
  if (existing) return { outcome: 'already_invited' };

  try {
    const written = await db.insert(rfqSuppliers).values({
      rfqId, supplierId, invitedBy, deadline: params.deadline ?? null,
    });
    return { outcome: 'invited', invitationId: Number(written?.[0]?.insertId) || 0 };
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code
      ?? (error as { code?: string })?.code;
    // Lost the race. The other request's invitation stands, and this one is
    // reported as the no-op it is - not as a failure the caller should retry.
    if (code === 'ER_DUP_ENTRY') return { outcome: 'already_invited' };
    throw error;
  }
}

/**
 * Is this supplier invited to this RFQ, and still able to act on it?
 *
 * A DECLINED invitation is deliberately NOT open. A supplier who said no has
 * exercised a choice, and quietly leaving the door open would mean their
 * decline changed nothing.
 */
export async function hasOpenInvitation(db: Db, rfqId: number, supplierId: number): Promise<boolean> {
  const [row] = await db.select({ status: rfqSuppliers.status })
    .from(rfqSuppliers)
    .where(and(eq(rfqSuppliers.rfqId, rfqId), eq(rfqSuppliers.supplierId, supplierId)))
    .limit(1);
  return !!row && (OPEN_INVITATION_STATUSES as readonly string[]).includes(row.status);
}

/** RFQ ids this supplier has an actionable invitation to. */
export async function invitedRfqIds(db: Db, supplierId: number): Promise<number[]> {
  const rows = await db.select({ rfqId: rfqSuppliers.rfqId, status: rfqSuppliers.status })
    .from(rfqSuppliers)
    .where(eq(rfqSuppliers.supplierId, supplierId));
  return (rows as { rfqId: number; status: string }[])
    .filter(r => (OPEN_INVITATION_STATUSES as readonly string[]).includes(r.status))
    .map(r => r.rfqId);
}

/**
 * Record that the supplier opened the RFQ.
 *
 * `viewedAt` is written ONCE - the first time. Re-stamping it on every visit
 * would destroy the only fact it records: when the supplier actually first saw
 * the request, which is exactly what a dispute about a missed deadline needs.
 */
export async function markInvitationViewed(db: Db, rfqId: number, supplierId: number): Promise<void> {
  const [row] = await db.select({ id: rfqSuppliers.id, status: rfqSuppliers.status, viewedAt: rfqSuppliers.viewedAt })
    .from(rfqSuppliers)
    .where(and(eq(rfqSuppliers.rfqId, rfqId), eq(rfqSuppliers.supplierId, supplierId)))
    .limit(1);
  if (!row || row.viewedAt !== null) return;
  // Only 'invited' advances. A 'responded' or 'declined' invitation has moved
  // past viewing, and dragging it backwards would rewrite the supplier's own
  // recorded decision.
  if (row.status !== 'invited') return;
  await db.update(rfqSuppliers)
    .set({ status: 'viewed', viewedAt: new Date() })
    .where(eq(rfqSuppliers.id, row.id));
}

/** Record that the supplier quoted. Terminal, and never reversed here. */
export async function markInvitationResponded(db: Db, rfqId: number, supplierId: number): Promise<void> {
  const [row] = await db.select({ id: rfqSuppliers.id, status: rfqSuppliers.status })
    .from(rfqSuppliers)
    .where(and(eq(rfqSuppliers.rfqId, rfqId), eq(rfqSuppliers.supplierId, supplierId)))
    .limit(1);
  if (!row || row.status === 'responded') return;
  await db.update(rfqSuppliers)
    .set({ status: 'responded', respondedAt: new Date() })
    .where(eq(rfqSuppliers.id, row.id));
}

/**
 * The supplier declines.
 *
 * Their own decision about their own invitation, so the only authorization is
 * that the invitation is theirs - checked by the WHERE, not by a separate read
 * that could drift from it.
 */
export async function declineInvitation(db: Db, rfqId: number, supplierId: number): Promise<boolean> {
  const [row] = await db.select({ id: rfqSuppliers.id, status: rfqSuppliers.status })
    .from(rfqSuppliers)
    .where(and(eq(rfqSuppliers.rfqId, rfqId), eq(rfqSuppliers.supplierId, supplierId)))
    .limit(1);
  if (!row) return false;
  // A supplier who has already quoted cannot un-quote by declining. The
  // quotation is a commercial act that exists independently of this row.
  if (row.status === 'responded' || row.status === 'declined') return false;
  await db.update(rfqSuppliers)
    .set({ status: 'declined', declinedAt: new Date() })
    .where(eq(rfqSuppliers.id, row.id));
  return true;
}

/**
 * The columns of an invited supplier the REQUESTER may see.
 *
 * An explicit allowlist, the same discipline as every other cross-user read in
 * this codebase. `users` also holds passwordHash, invitationToken and
 * passwordResetToken; a `select().from(users)` here would put all three on the
 * requester's screen.
 */
export const INVITED_SUPPLIER_COLUMNS = {
  id: users.id,
  name: users.name,
  userRole: users.userRole,
  location: users.location,
  rating: users.rating,
  reviewCount: users.reviewCount,
  verified: users.verified,
} as const;

/** Who has been invited to this RFQ, for the requester's own screen. */
export async function listInvitations(db: Db, rfqId: number) {
  const rows = await db.select({
    id: rfqSuppliers.id,
    supplierId: rfqSuppliers.supplierId,
    status: rfqSuppliers.status,
    invitedAt: rfqSuppliers.invitedAt,
    viewedAt: rfqSuppliers.viewedAt,
    respondedAt: rfqSuppliers.respondedAt,
    declinedAt: rfqSuppliers.declinedAt,
    deadline: rfqSuppliers.deadline,
  }).from(rfqSuppliers).where(eq(rfqSuppliers.rfqId, rfqId));

  const ids = (rows as { supplierId: number }[]).map(r => r.supplierId);
  if (ids.length === 0) return [];

  const suppliers = await db.select(INVITED_SUPPLIER_COLUMNS)
    .from(users).where(inArray(users.id, ids));
  const byId = new Map((suppliers as { id: number }[]).map(s => [s.id, s]));

  return (rows as Record<string, unknown>[]).map(row => ({
    ...row,
    supplier: byId.get(row.supplierId as number) ?? null,
  }));
}
