/**
 * ── ASSIGNING AN ENQUIRY TO AN ADMINISTRATOR ──────────────────────────────
 *
 * WHY THIS ONE GETS A TABLE WHEN THE STATUS DID NOT.
 *
 * The enquiry's STATE is derived: the invitation, the allowance consumption and
 * the quotation already record everything it means, so storing it again would
 * create two sources of truth for the same fact.
 *
 * An ASSIGNMENT records nothing that already exists. No row in the domain says
 * which administrator is working an enquiry, and none can - every existing row
 * is about customers, vendors and requests, not about the platform's own
 * operators. Refusing storage here would mean inventing a derivation that does
 * not exist, or writing the assignment into a column that means something else.
 * So it is stored, append-only, and the reason is recorded here so the next
 * person does not read the two decisions as inconsistent.
 *
 * WHO MAY BE ASSIGNED. Administrators, and only administrators who could
 * actually act. Assigning an enquiry to a frozen account, to a deactivated one,
 * or to a QA persona produces a queue item nobody will ever pick up, and the
 * screen would show it as handled.
 */
import { and, desc, eq, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { enquiryAssignments, users } from '../drizzle/schema';
import { ADMIN_SIGN_IN_ELIGIBILITY } from './adminAuthority';
import { enquiryReference } from './vendorEnquiry';

export const ASSIGNEE_INELIGIBLE_MESSAGE =
  'An enquiry can only be assigned to an administrator who is able to sign in.';

export type AssignmentRow = {
  rfqId: number;
  vendorId: number;
  assigneeId: number | null;
  assigneeName: string | null;
  actorId: number | null;
  note: string | null;
  at: Date | null;
};

/**
 * Administrators an enquiry may be assigned to.
 *
 * THE SAME ELIGIBILITY RULES AS SIGNING IN, and for the same reason the Super
 * Admin survival count uses them: "an administrator who exists" and "an
 * administrator who can act" are different sets, and a queue assigned to the
 * first is a queue nobody is working. ADMIN_SIGN_IN_ELIGIBILITY names the
 * columns; the drift guard in adminAuthority.test.ts keeps them honest.
 */
export async function assignableAdmins(db: unknown): Promise<{ id: number; name: string | null; adminRole: string | null }[]> {
  return (db as { select: Function }).select({
    id: users.id, name: users.name, adminRole: users.adminRole,
  }).from(users).where(and(
    eq(users.isDummy, false),
    isNotNull(users.passwordHash),
    eq(users.role, 'admin'),
    isNotNull(users.adminRole),
    eq(users.accountStatus, 'active'),
    isNull(users.deactivatedAt),
  )).orderBy(users.name) as Promise<{ id: number; name: string | null; adminRole: string | null }[]>;
}

/** Is this account one an enquiry may be handed to? */
export async function isAssignable(db: unknown, userId: number): Promise<boolean> {
  const admins = await assignableAdmins(db);
  return admins.some(admin => admin.id === userId);
}

/**
 * The current assignment for one pair, or null if it has never been assigned.
 *
 * "The most recent row" rather than "the row": the table is append-only, and an
 * unassignment is a row with a null assigneeId, so the latest row is the answer
 * whichever kind it is.
 */
export async function currentAssignment(
  db: unknown,
  pair: { rfqId: number; vendorId: number },
): Promise<AssignmentRow | null> {
  const [row] = await (db as { select: Function }).select({
    rfqId: enquiryAssignments.rfqId,
    vendorId: enquiryAssignments.vendorId,
    assigneeId: enquiryAssignments.assigneeId,
    assigneeName: users.name,
    actorId: enquiryAssignments.actorId,
    note: enquiryAssignments.note,
    at: enquiryAssignments.createdAt,
  }).from(enquiryAssignments)
    .leftJoin(users, eq(users.id, enquiryAssignments.assigneeId))
    .where(and(
      eq(enquiryAssignments.rfqId, pair.rfqId),
      eq(enquiryAssignments.vendorId, pair.vendorId),
    ))
    .orderBy(desc(enquiryAssignments.id))
    .limit(1) as AssignmentRow[];
  return row ?? null;
}

/**
 * The current assignee for MANY pairs, in ONE query.
 *
 * The list needs this per row, and a lookup per row is the N+1 the mandate
 * forbids. The window function picks the latest row per pair in the database
 * rather than pulling the whole history into Node and sorting it there.
 */
export async function currentAssignments(
  db: unknown,
  pairs: { rfqId: number; vendorId: number }[],
): Promise<Map<string, AssignmentRow>> {
  const out = new Map<string, AssignmentRow>();
  if (pairs.length === 0) return out;

  const rfqIds = Array.from(new Set(pairs.map(p => p.rfqId)));
  const vendorIds = Array.from(new Set(pairs.map(p => p.vendorId)));

  const rows = await (db as { select: Function }).select({
    rfqId: enquiryAssignments.rfqId,
    vendorId: enquiryAssignments.vendorId,
    assigneeId: enquiryAssignments.assigneeId,
    assigneeName: users.name,
    actorId: enquiryAssignments.actorId,
    note: enquiryAssignments.note,
    at: enquiryAssignments.createdAt,
    rank: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${enquiryAssignments.rfqId}, ${enquiryAssignments.vendorId} ORDER BY ${enquiryAssignments.id} DESC)`.as('rank'),
  }).from(enquiryAssignments)
    .leftJoin(users, eq(users.id, enquiryAssignments.assigneeId))
    .where(and(
      inArray(enquiryAssignments.rfqId, rfqIds),
      inArray(enquiryAssignments.vendorId, vendorIds),
    )) as (AssignmentRow & { rank: number })[];

  for (const row of rows) {
    if (Number(row.rank) !== 1) continue;
    out.set(`${row.rfqId}:${row.vendorId}`, {
      rfqId: row.rfqId, vendorId: row.vendorId, assigneeId: row.assigneeId,
      assigneeName: row.assigneeName, actorId: row.actorId, note: row.note, at: row.at,
    });
  }
  return out;
}

/**
 * Record an assignment or an unassignment.
 *
 * `assigneeId: null` unassigns - a real event, appended like any other, so the
 * history says WHO removed it and when rather than the row simply vanishing.
 */
export async function assignEnquiry(params: {
  db: unknown;
  rfqId: number;
  vendorId: number;
  assigneeId: number | null;
  actorId: number;
  note?: string | null;
}): Promise<{ assignmentId: number; notify: { userId: number; reference: string } | null }> {
  const { db, rfqId, vendorId, assigneeId, actorId } = params;

  if (assigneeId != null && !(await isAssignable(db, assigneeId))) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: ASSIGNEE_INELIGIBLE_MESSAGE });
  }

  const previous = await currentAssignment(db, { rfqId, vendorId });
  // Assigning to whoever already holds it changes nothing and would add a row
  // that reads, in the history, as though something happened.
  if ((previous?.assigneeId ?? null) === assigneeId) {
    return { assignmentId: 0, notify: null };
  }

  const result = await (db as { insert: Function }).insert(enquiryAssignments).values({
    rfqId, vendorId, assigneeId, actorId, note: params.note ?? null,
  });

  return {
    assignmentId: Number(result?.[0]?.insertId ?? 0),
    // Only a real new assignee is told. An unassignment notifies nobody: there
    // is no one to tell, and telling the OLD assignee "you no longer have this"
    // is a message the brief did not ask for and the owner has not approved.
    notify: assigneeId == null ? null
      : { userId: assigneeId, reference: enquiryReference(rfqId, vendorId) },
  };
}

/** The eligibility rules this module shares with sign-in, for the drift guard. */
export const ASSIGNEE_ELIGIBILITY = ADMIN_SIGN_IN_ELIGIBILITY;
