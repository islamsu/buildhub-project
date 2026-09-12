/**
 * WHAT A DISPUTE IS ABOUT, WRITTEN IN ONE PLACE.
 *
 * The owner's decision is a polymorphic subject - PROJECT, RFQ or QUOTATION -
 * so `disputes.subjectType` / `subjectId` are authoritative. `projectId`
 * survives as a LEGACY MIRROR: `admin.projectDetail` counts disputes with it,
 * and migration 0046's backfill is reversible by inspection while it is there.
 *
 * IT IS DERIVED, NOT A SECOND SOURCE OF TRUTH. Every write goes through
 * `subjectColumns` below, so `projectId` can only ever be the subject restated;
 * it is never set independently. A second authoritative field is precisely the
 * shape that produced four disagreeing category vocabularies in this codebase,
 * and the guard test holds the two in agreement.
 *
 * WHEN IT IS REMOVED: once nothing reads `disputes.projectId`, one migration
 * drops the column and this function loses two lines.
 */
import { eq } from 'drizzle-orm';
import { disputes } from '../drizzle/schema';
import { disputeReference, type DisputeSubjectType } from '../shared/disputes';

/**
 * The subject columns for an insert or an update, legacy mirror included.
 *
 * `projectId` is set ONLY for a project-subject dispute. An RFQ dispute leaves
 * it null rather than pointing at the RFQ's project, which would make the
 * legacy count report disputes about a different thing.
 */
export function subjectColumns(subjectType: DisputeSubjectType, subjectId: number): {
  subjectType: DisputeSubjectType;
  subjectId: number;
  projectId: number | null;
} {
  return {
    subjectType,
    subjectId,
    projectId: subjectType === 'project' ? subjectId : null,
  };
}

/**
 * `subjectId` 0 means NO SUBJECT IS RECORDED.
 *
 * Migration 0046 backfilled the subject from `projectId`, and a pre-0046 row
 * whose project was null had nothing to backfill from. Those rows are left at 0
 * and reported as unknown rather than given an invented subject - rendering
 * them as "project 0" would be a fabricated relationship.
 */
export const NO_SUBJECT_RECORDED = 0;

export function hasSubject(dispute: { subjectId: number | null }): boolean {
  return Number(dispute.subjectId ?? 0) > NO_SUBJECT_RECORDED;
}

/**
 * Stamp the human reference, which is derived from the id and so can only be
 * written after the insert.
 *
 * Best-effort by design: a dispute that exists without a reference is a display
 * problem, and failing the whole filing over one would lose the user's account
 * of what went wrong.
 */
export async function assignDisputeReference(db: any, id: number, createdAt: Date = new Date()): Promise<string | null> {
  const reference = disputeReference(id, createdAt);
  try {
    await db.update(disputes).set({ reference }).where(eq(disputes.id, id));
    return reference;
  } catch (error) {
    console.warn('[Disputes] Could not stamp a reference:', error);
    return null;
  }
}
