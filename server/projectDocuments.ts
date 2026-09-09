/**
 * ── THE PROJECT DOCUMENT LIFECYCLE ────────────────────────────────────────
 *
 * WHAT ALREADY WORKED: a member of a project could upload a document with its
 * bytes verified against the declared type, and every member who can read the
 * project could list it.
 *
 * WHAT WAS MISSING: nothing could correct or retire one. A drawing that went up
 * as the wrong revision stayed at the top of the list for the rest of the job,
 * and the only remedies a site team had were to upload a second file with a
 * confusing name or to ask somebody to delete a row from the database.
 *
 * ARCHIVE, NEVER DELETE. A contract, a BOQ or a drawing is evidence of what was
 * agreed at a moment in time, and a dispute six months later is exactly when
 * the superseded revision matters. Archiving takes a document out of the
 * working list; it stays downloadable to everyone who could already read the
 * project, and the storage object is never destroyed.
 *
 * REPLACING IS A LINK. The replacement is a NEW row and the old one is archived
 * pointing forward to it, so "which revision was current in March" has an
 * answer.
 *
 * WHO MAY RETIRE ONE is a real rule rather than a convenience: the person who
 * uploaded it, or somebody with `manage` on the project (owner or manager). A
 * contractor must not be able to remove the architect's drawing, and the
 * architect must not need an administrator to correct their own.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { documents } from '../drizzle/schema';
import { projectRoleFor } from './projectMembership';
import { projectRoleCan } from '../shared/projectAccess';
import { recordCommercialEvent } from './_core/commercialAudit';

type Db = any;

export class ProjectDocumentError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'BAD_REQUEST', message: string) {
    super(message);
  }
}

/** The working list: everything on the project that has not been retired. */
export function liveDocumentFilter() {
  return isNull(documents.archivedAt);
}

/**
 * The one door for acting on a single document.
 *
 * NOT FOUND for a document on a project the caller cannot read, and for a
 * document that does not exist - the same answer, because distinguishing them
 * would let document ids be walked across projects. Cross-project leakage is
 * refused HERE rather than at each call site, so a new operation cannot forget.
 */
export async function requireDocumentAccess(db: Db, params: {
  documentId: number; userId: number; capability: 'read' | 'report' | 'manage';
}) {
  const [document] = await db.select({
    id: documents.id,
    projectId: documents.projectId,
    uploaderId: documents.uploaderId,
    name: documents.name,
    type: documents.type,
    fileKey: documents.fileKey,
    archivedAt: documents.archivedAt,
  }).from(documents).where(eq(documents.id, params.documentId)).limit(1);
  if (!document) throw new ProjectDocumentError('NOT_FOUND', 'Document not found');

  const role = await projectRoleFor(db, document.projectId, params.userId);
  if (!role) throw new ProjectDocumentError('NOT_FOUND', 'Document not found');
  if (!projectRoleCan(role, params.capability)) {
    // On the project but not in a capacity that permits this. FORBIDDEN is
    // correct here and NOT_FOUND would be a lie - they can already see it.
    throw new ProjectDocumentError(
      'FORBIDDEN',
      `Your role on this project (${role}) does not allow this action.`,
    );
  }
  return { document, role };
}

/**
 * May this person retire this document?
 *
 * THE UPLOADER, OR SOMEBODY WHO MANAGES THE PROJECT. Uploading is a `report`
 * capability, which contractors, architects and engineers all carry - so
 * "anyone who can upload may remove anything" would let one trade delete
 * another's drawings. Owning what you put there, and the project manager
 * owning everything, is the rule a site actually runs on.
 */
export function canRetireDocument(
  role: string, uploaderId: number, userId: number,
): boolean {
  return uploaderId === userId || projectRoleCan(role as never, 'manage');
}

/** Documents on a project, newest first. Archived ones only when asked for. */
export async function listProjectDocuments(db: Db, params: {
  projectId: number; type?: string; includeArchived?: boolean;
}) {
  const conditions = [eq(documents.projectId, params.projectId)];
  if (params.type) conditions.push(eq(documents.type, params.type as never));
  if (!params.includeArchived) conditions.push(liveDocumentFilter());
  return db.select().from(documents)
    .where(and(...conditions))
    .orderBy(desc(documents.createdAt));
}

/**
 * Retire a document.
 *
 * The bytes are NOT deleted and the row is NOT deleted. `archivedAt` is what
 * takes it out of the working list, and a document already archived is refused
 * rather than re-stamped - the first retirement is the one that happened.
 */
export async function archiveDocument(db: Db, params: {
  documentId: number; userId: number; reason?: string | null;
}): Promise<{ ok: true }> {
  const { document, role } = await requireDocumentAccess(db, {
    documentId: params.documentId, userId: params.userId, capability: 'report',
  });
  if (document.archivedAt) {
    throw new ProjectDocumentError('BAD_REQUEST', 'That document is already archived.');
  }
  if (!canRetireDocument(role, document.uploaderId, params.userId)) {
    throw new ProjectDocumentError(
      'FORBIDDEN',
      'Only the person who uploaded this document, or someone who manages the project, can archive it.',
    );
  }

  await db.update(documents).set({
    archivedAt: new Date(),
    archivedBy: params.userId,
    archiveReason: params.reason?.trim() || null,
  }).where(eq(documents.id, params.documentId));

  await recordCommercialEvent(db, {
    actorId: params.userId, ownerId: document.uploaderId,
    subjectType: 'document', subjectId: params.documentId,
    action: 'document_archived',
    detail: params.reason ? `archived: ${params.reason}` : 'archived',
  });
  return { ok: true };
}

/**
 * Restore a document somebody archived by mistake.
 *
 * A REPLACED DOCUMENT CANNOT BE RESTORED: its replacement is the current
 * revision, and having two live rows claiming to be the same drawing is worse
 * than the mistake. Un-replacing means archiving the replacement.
 */
export async function restoreDocument(db: Db, params: {
  documentId: number; userId: number;
}): Promise<{ ok: true }> {
  const [row] = await db.select({
    id: documents.id, archivedAt: documents.archivedAt, supersededById: documents.supersededById,
    uploaderId: documents.uploaderId, projectId: documents.projectId,
  }).from(documents).where(eq(documents.id, params.documentId)).limit(1);
  if (!row) throw new ProjectDocumentError('NOT_FOUND', 'Document not found');

  const role = await projectRoleFor(db, row.projectId, params.userId);
  if (!role) throw new ProjectDocumentError('NOT_FOUND', 'Document not found');
  if (!row.archivedAt) throw new ProjectDocumentError('BAD_REQUEST', 'That document is not archived.');
  if (row.supersededById) {
    throw new ProjectDocumentError(
      'BAD_REQUEST',
      'This document was replaced by a newer revision. Archive the replacement instead of restoring this one.',
    );
  }
  if (!canRetireDocument(role, row.uploaderId, params.userId)) {
    throw new ProjectDocumentError(
      'FORBIDDEN',
      'Only the person who uploaded this document, or someone who manages the project, can restore it.',
    );
  }

  await db.update(documents).set({ archivedAt: null, archivedBy: null, archiveReason: null })
    .where(eq(documents.id, params.documentId));
  await recordCommercialEvent(db, {
    actorId: params.userId, ownerId: row.uploaderId,
    subjectType: 'document', subjectId: params.documentId, action: 'document_restored',
  });
  return { ok: true };
}

/**
 * Link a freshly uploaded row as the replacement for an older one.
 *
 * Called AFTER the new row exists, so a storage failure cannot leave the old
 * document archived with nothing to replace it - the order matters more than
 * it looks.
 */
export async function markSuperseded(db: Db, params: {
  oldDocumentId: number; newDocumentId: number; userId: number; uploaderId: number;
}): Promise<void> {
  await db.update(documents).set({
    archivedAt: new Date(),
    archivedBy: params.userId,
    archiveReason: `Replaced by document ${params.newDocumentId}`,
    supersededById: params.newDocumentId,
  }).where(eq(documents.id, params.oldDocumentId));

  await recordCommercialEvent(db, {
    actorId: params.userId, ownerId: params.uploaderId,
    subjectType: 'document', subjectId: params.oldDocumentId,
    action: 'document_replaced',
    detail: `replaced by ${params.newDocumentId}`,
  });
}
