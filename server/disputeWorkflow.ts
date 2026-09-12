/**
 * THE DISPUTE STATE MACHINE.
 *
 * `admin.updateDispute` took a status and wrote it:
 *
 *   await db.update(disputes).set({ status, resolutionNotes })
 *
 * Any status, from any state, by any administrator with support.manage. No
 * check that the dispute existed. No record of who did it, when, or from what.
 * A resolved dispute could be moved back to open and then to resolved again
 * with different notes, and the record would show only the last write. Nothing
 * told the parties anything.
 *
 * WHAT THIS ENFORCES
 *
 *   DECLARED TRANSITIONS. A move that is not in the table below is refused,
 *   naming both states, so a client bug and an attempt look the same to the
 *   server and different to the person reading the error.
 *
 *   WHO MAY MAKE IT. Withdrawing is the REPORTER's decision about their own
 *   dispute; investigating and rejecting are the platform's. Reopening is open
 *   to either, because both have a legitimate reason to want it.
 *
 *   RESOLUTION IS NEVER A BARE STATUS FLIP. Moving to `resolved` requires a
 *   resolution TYPE and a summary. "How did this end" must be answerable across
 *   many disputes without reading prose, and the party on the losing side is
 *   entitled to a stated reason.
 *
 *   WITHDRAWN IS TERMINAL. A reporter who withdrew and wants to come back files
 *   a new dispute; reopening theirs would let a party withdraw to stop an
 *   investigation and restart it when it suited them.
 */
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { disputes, disputeStatusHistory } from '../drizzle/schema';
import {
  DISPUTE_STATUSES, type DisputeStatus, type DisputeResolutionType,
} from '../shared/disputes';

/** Who is asking. Not a role name: the same person can be both. */
export type DisputeActor = 'reporter' | 'respondent' | 'admin';

export type Transition = {
  from: DisputeStatus;
  to: DisputeStatus;
  /** Who may make this move. */
  actors: readonly DisputeActor[];
  /** A move that must say why. */
  requiresReason?: boolean;
  /** A move that must record HOW it ended. */
  requiresResolution?: boolean;
};

/**
 * Every legal move, declared. Anything absent is refused.
 *
 * `open -> open` is absent deliberately: re-opening something already open is a
 * no-op that would write a history row saying nothing happened.
 */
export const DISPUTE_TRANSITIONS: readonly Transition[] = [
  // The platform picks it up.
  { from: 'open', to: 'investigating', actors: ['admin'] },

  // The platform concludes it. Both ends need a stated outcome: the party on
  // the losing side is entitled to know why.
  { from: 'open', to: 'resolved', actors: ['admin'], requiresResolution: true },
  { from: 'investigating', to: 'resolved', actors: ['admin'], requiresResolution: true },
  { from: 'open', to: 'rejected', actors: ['admin'], requiresReason: true },
  { from: 'investigating', to: 'rejected', actors: ['admin'], requiresReason: true },

  // The reporter's own decision about their own dispute, while it is still
  // live. An administrator cannot make it for them.
  { from: 'open', to: 'withdrawn', actors: ['reporter'], requiresReason: true },
  { from: 'investigating', to: 'withdrawn', actors: ['reporter'], requiresReason: true },

  // Reopening a concluded dispute. Either side may ask; both must say why, and
  // the reason is recorded on the dispute itself, not only in the history.
  { from: 'resolved', to: 'open', actors: ['reporter', 'respondent', 'admin'], requiresReason: true },
  { from: 'rejected', to: 'open', actors: ['reporter', 'respondent', 'admin'], requiresReason: true },
];

export type TransitionRefusal = { ok: false; reason: string };
export type TransitionAllowed = { ok: true; transition: Transition };

/**
 * May this actor make this move? Pure, so the table above is testable without a
 * database and the rules cannot quietly differ between the check and the write.
 */
export function checkTransition(args: {
  from: string;
  to: string;
  actor: DisputeActor;
  reason?: string | null;
  resolutionType?: DisputeResolutionType | null;
  resolutionSummary?: string | null;
}): TransitionAllowed | TransitionRefusal {
  if (!(DISPUTE_STATUSES as readonly string[]).includes(args.to)) {
    return { ok: false, reason: `"${args.to}" is not a dispute status.` };
  }
  if (args.from === args.to) {
    return { ok: false, reason: `This dispute is already ${args.to}.` };
  }

  const declared = DISPUTE_TRANSITIONS.filter(t => t.from === args.from && t.to === args.to);
  if (declared.length === 0) {
    // WITHDRAWN IS TERMINAL, and says so rather than reporting a generic
    // refusal: "file a new one" is the actionable answer.
    if (args.from === 'withdrawn') {
      return {
        ok: false,
        reason: 'This dispute was withdrawn by the person who raised it. A withdrawn dispute cannot be reopened - raise a new one instead.',
      };
    }
    return { ok: false, reason: `A dispute cannot go from ${args.from} to ${args.to}.` };
  }

  const permitted = declared.find(t => t.actors.includes(args.actor));
  if (!permitted) {
    const who = declared[0].actors.join(' or ');
    return { ok: false, reason: `Only the ${who} can move a dispute from ${args.from} to ${args.to}.` };
  }

  if (permitted.requiresReason && !String(args.reason ?? '').trim()) {
    return { ok: false, reason: `Moving a dispute to ${args.to} requires a reason.` };
  }
  if (permitted.requiresResolution) {
    if (!args.resolutionType) {
      return { ok: false, reason: 'Resolving a dispute requires a resolution type - a bare status change is not a resolution.' };
    }
    if (!String(args.resolutionSummary ?? '').trim()) {
      return { ok: false, reason: 'Resolving a dispute requires a summary of what was decided.' };
    }
  }
  return { ok: true, transition: permitted };
}

/** The columns a transition writes beyond `status`. */
export function transitionColumns(args: {
  to: DisputeStatus;
  actorId: number;
  now: Date;
  reason?: string | null;
  resolutionType?: DisputeResolutionType | null;
  resolutionSummary?: string | null;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = { status: args.to };
  if (args.to === 'resolved') {
    patch.resolutionType = args.resolutionType ?? null;
    patch.resolutionNotes = args.resolutionSummary ?? null;
    patch.resolvedBy = args.actorId;
    patch.resolvedAt = args.now;
  }
  if (args.to === 'rejected') {
    // The reason IS the resolution record for a rejection: a party told only
    // "rejected" has been given a verdict without grounds.
    patch.resolutionType = 'out_of_scope';
    patch.resolutionNotes = args.reason ?? null;
    patch.resolvedBy = args.actorId;
    patch.resolvedAt = args.now;
  }
  if (args.to === 'withdrawn') {
    patch.withdrawnAt = args.now;
    patch.resolutionNotes = args.reason ?? null;
  }
  if (args.to === 'open') {
    // Reopening. The previous resolution is CLEARED rather than left standing:
    // a dispute that reads "open" while still carrying "resolved by agreement"
    // tells two different stories at once.
    patch.reopenedBy = args.actorId;
    patch.reopenedAt = args.now;
    patch.reopenReason = String(args.reason ?? '').slice(0, 500);
    patch.resolutionType = null;
    patch.resolvedBy = null;
    patch.resolvedAt = null;
  }
  return patch;
}

/**
 * Apply a transition, in one transaction with the dispute row locked.
 *
 * The lock settles two administrators acting at once: the second re-reads and
 * finds the state the first left, so a dispute cannot be resolved twice with
 * different outcomes, and the history cannot record a move that started from a
 * state the dispute was no longer in.
 */
export async function applyTransition(db: any, args: {
  disputeId: number;
  to: DisputeStatus;
  actor: DisputeActor;
  actorId: number;
  reason?: string | null;
  resolutionType?: DisputeResolutionType | null;
  resolutionSummary?: string | null;
  now?: Date;
}): Promise<{ from: DisputeStatus; to: DisputeStatus; dispute: any }> {
  const now = args.now ?? new Date();
  return db.transaction(async (tx: any) => {
    const [dispute] = await tx.select().from(disputes).where(eq(disputes.id, args.disputeId)).for('update');
    // A dispute that does not exist is NOT_FOUND, which the previous version
    // never checked at all: it wrote an update matching no rows and reported
    // success.
    if (!dispute) throw new TRPCError({ code: 'NOT_FOUND', message: 'Dispute not found' });

    const check = checkTransition({
      from: String(dispute.status), to: args.to, actor: args.actor,
      reason: args.reason, resolutionType: args.resolutionType,
      resolutionSummary: args.resolutionSummary,
    });
    if (!check.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: check.reason });

    await tx.update(disputes)
      .set(transitionColumns({ ...args, now }))
      .where(eq(disputes.id, args.disputeId));

    // APPEND-ONLY, and inside the same transaction: a history that can be
    // missing for a move that happened is worse than no history, because it
    // reads as though the move did not happen.
    await tx.insert(disputeStatusHistory).values({
      disputeId: args.disputeId,
      fromStatus: String(dispute.status),
      toStatus: args.to,
      actorId: args.actorId,
      reason: String(args.reason ?? args.resolutionSummary ?? '').slice(0, 500) || null,
    });

    return { from: String(dispute.status) as DisputeStatus, to: args.to, dispute };
  });
}
