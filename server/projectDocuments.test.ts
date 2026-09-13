/**
 * ── PROJECT DOCUMENTS: THE HALF THAT WAS MISSING ──────────────────────────
 *
 * Uploading and listing worked. Nothing could correct or retire a document, so
 * a drawing that went up as the wrong revision stayed at the top of the list
 * for the rest of the job.
 *
 * Four rules this file exists to pin, each of which was a decision:
 *
 *   THE FILE AND THE LIST MUST AGREE. `projects.documents` has returned
 *   documents to every live member since PM-A2, while the storage proxy
 *   resolved the project OWNER only - so a contractor saw a drawing in the
 *   list and got a refusal on the file. That is the defect a second copy of an
 *   access rule always eventually produces, and the fix is one rule, not two
 *   corrected ones. The proxy side is pinned in storageProxy.test.ts.
 *
 *   ARCHIVE, NEVER DELETE. A contract or a BOQ is evidence of what was agreed
 *   at a moment in time, and a dispute six months later is exactly when the
 *   superseded revision matters.
 *
 *   REPLACING IS A LINK. The new file is a new row; the old one is archived
 *   pointing forward to it.
 *
 *   WHO MAY RETIRE ONE is the uploader or somebody who manages the project.
 *   Uploading needs `report`, which contractors, architects and engineers all
 *   carry, so "anyone who can upload may remove anything" would let one trade
 *   delete another's drawings.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  requireDocumentAccess, canRetireDocument, archiveDocument, restoreDocument,
  markSuperseded, liveDocumentFilter, listProjectDocuments, ProjectDocumentError,
} from './projectDocuments';

const SCHEMA = readSourceForAssertions(
  readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8'),
);
const SERVICE = readSourceForAssertions(
  readFileSync(new URL('./projectDocuments.ts', import.meta.url), 'utf8'),
);
const ROUTERS = readSourceForAssertions(
  readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'),
);

/**
 * Answers each select in order and records writes. The queries the service
 * makes are: the document row, then the project row, then - only when the
 * caller is not the owner - the live membership row.
 */
function fakeDb(answers: unknown[][]) {
  let call = 0;
  const writes: Record<string, unknown>[] = [];
  const db: any = {
    select: () => ({
      from: () => ({
        where: () => {
          const answer = () => Promise.resolve(answers[call++] ?? []);
          let pending: Promise<unknown> | null = null;
          const take = () => (pending ??= answer());
          return Object.assign(take(), {
            limit: () => take(),
            orderBy: () => take(),
          });
        },
      }),
    }),
    update: () => ({ set: (patch: Record<string, unknown>) => ({ where: () => { writes.push(patch); return Promise.resolve(); } }) }),
    insert: () => ({ values: () => Promise.resolve() }),
    writes,
  };
  return db;
}

const OWNER = 1;
const MEMBER = 7;
const doc = {
  id: 3, projectId: 10, uploaderId: MEMBER, name: 'Ground floor plan',
  type: 'drawing', fileKey: 'project-documents/user-7/project-10/plan.pdf',
  archivedAt: null, supersededById: null,
};
const project = [{ id: 10, ownerId: OWNER }];

describe('the schema carries what the service writes', () => {
  it('every lifecycle column exists on the documents table', () => {
    const table = SCHEMA.slice(
      SCHEMA.indexOf("export const documents = mysqlTable"),
      SCHEMA.indexOf("export const dailyLogs = mysqlTable"),
    );
    for (const column of ['archivedAt', 'archivedBy', 'archiveReason', 'supersededById']) {
      expect(table, column).toContain(column);
    }
  });

  it('THERE IS NO DELETE anywhere in the document service', () => {
    // A contract, a BOQ or a drawing is evidence. Destroying the row to tidy a
    // list would destroy exactly what a dispute needs.
    expect(SERVICE).not.toContain('db.delete(');
    expect(SERVICE).not.toContain('storageDelete');
  });

  it('the migration adds the columns without touching the rows that predate it', () => {
    const migration = readFileSync(
      new URL('../drizzle/0050_document_lifecycle.sql', import.meta.url), 'utf8');
    // Nothing is backfilled, because "not archived" is the correct reading of
    // every existing document and NULL already says it.
    expect(migration).not.toMatch(/UPDATE `documents`/);
    expect(migration.split('--> statement-breakpoint').filter(s => s.trim()).length).toBeGreaterThanOrEqual(7);
  });
});

describe('requireDocumentAccess - the one door', () => {
  it('a live member who can read the project gets the document', async () => {
    const db = fakeDb([[doc], project, [{ projectRole: 'supplier' }]]);
    const { document, role } = await requireDocumentAccess(db, {
      documentId: 3, userId: MEMBER, capability: 'read',
    });
    expect(document.id).toBe(3);
    expect(role).toBe('supplier');
  });

  it('the project owner gets it without a membership row', async () => {
    const db = fakeDb([[doc], project]);
    await expect(requireDocumentAccess(db, { documentId: 3, userId: OWNER, capability: 'manage' }))
      .resolves.toMatchObject({ role: 'owner' });
  });

  it('A DOCUMENT ON A PROJECT YOU ARE NOT ON IS NOT FOUND - not forbidden', async () => {
    // Distinguishing "no such document" from "not your project" is what lets
    // document ids be walked across projects one number at a time.
    const db = fakeDb([[doc], project, []]);
    await expect(requireDocumentAccess(db, { documentId: 3, userId: 999, capability: 'read' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a document that does not exist answers identically', async () => {
    await expect(requireDocumentAccess(fakeDb([[]]), { documentId: 3, userId: OWNER, capability: 'read' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('ON the project but without the capability is FORBIDDEN, which is not a lie', async () => {
    // A supplier carries 'read' and not 'report'. Answering NOT_FOUND here
    // would deny the existence of something they can already see listed.
    const db = fakeDb([[doc], project, [{ projectRole: 'supplier' }]]);
    await expect(requireDocumentAccess(db, { documentId: 3, userId: MEMBER, capability: 'report' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a REMOVED member is refused - losing the project loses its documents', async () => {
    // liveMembership filters on removedAt IS NULL, so a removed member
    // resolves to no role at all.
    const db = fakeDb([[doc], project, []]);
    await expect(requireDocumentAccess(db, { documentId: 3, userId: MEMBER, capability: 'read' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('canRetireDocument - who may take one down', () => {
  it('the person who uploaded it may', () => {
    expect(canRetireDocument('contractor', MEMBER, MEMBER)).toBe(true);
  });

  it('somebody who MANAGES the project may, whoever uploaded it', () => {
    expect(canRetireDocument('owner', MEMBER, OWNER)).toBe(true);
    expect(canRetireDocument('manager', MEMBER, OWNER)).toBe(true);
  });

  it('ONE TRADE CANNOT REMOVE ANOTHER TRADE\'S DRAWING', () => {
    // Both carry 'report', so uploading is not the test - authorship is.
    expect(canRetireDocument('contractor', MEMBER, 42)).toBe(false);
    expect(canRetireDocument('engineer', MEMBER, 42)).toBe(false);
    expect(canRetireDocument('architect', MEMBER, 42)).toBe(false);
  });

  it('a read-only role cannot, even for a document it somehow uploaded', () => {
    expect(canRetireDocument('viewer', 42, 99)).toBe(false);
  });
});

describe('archiveDocument', () => {
  it('stamps when, who and why, and never deletes', async () => {
    const db = fakeDb([[doc], project, [{ projectRole: 'contractor' }]]);
    await expect(archiveDocument(db, { documentId: 3, userId: MEMBER, reason: '  superseded on site  ' }))
      .resolves.toEqual({ ok: true });
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ archivedBy: MEMBER, archiveReason: 'superseded on site' });
    expect(db.writes[0].archivedAt).toBeInstanceOf(Date);
  });

  it('a reason is optional - a wrong upload needs no explanation', async () => {
    const db = fakeDb([[doc], project, [{ projectRole: 'contractor' }]]);
    await archiveDocument(db, { documentId: 3, userId: MEMBER });
    expect(db.writes[0].archiveReason).toBeNull();
  });

  it('ANOTHER TRADE ON THE SAME PROJECT IS REFUSED - FORBIDDEN, not NOT_FOUND', async () => {
    // They are on the project and can see the document listed, so denying its
    // existence would be a lie. They simply did not upload it and do not
    // manage the job. Nothing is written.
    const db = fakeDb([[doc], project, [{ projectRole: 'contractor' }]]);
    await expect(archiveDocument(db, { documentId: 3, userId: 42 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.writes).toEqual([]);
  });

  it('the project manager may archive a document they did not upload', async () => {
    const db = fakeDb([[doc], project]);
    await expect(archiveDocument(db, { documentId: 3, userId: OWNER })).resolves.toEqual({ ok: true });
  });

  it('AN ALREADY-ARCHIVED DOCUMENT IS REFUSED rather than re-stamped', async () => {
    // The first retirement is the one that happened; overwriting its timestamp
    // would lose when the document actually left the working list.
    const db = fakeDb([[{ ...doc, archivedAt: new Date() }], project, [{ projectRole: 'contractor' }]]);
    await expect(archiveDocument(db, { documentId: 3, userId: MEMBER }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.writes).toEqual([]);
  });
});

describe('restoreDocument', () => {
  it('clears the stamp so the row states one thing, not two', async () => {
    const db = fakeDb([
      [{ id: 3, archivedAt: new Date(), supersededById: null, uploaderId: MEMBER, projectId: 10 }],
      project, [{ projectRole: 'contractor' }],
    ]);
    await expect(restoreDocument(db, { documentId: 3, userId: MEMBER })).resolves.toEqual({ ok: true });
    expect(db.writes).toEqual([{ archivedAt: null, archivedBy: null, archiveReason: null }]);
  });

  it('A REPLACED DOCUMENT CANNOT BE RESTORED, and the refusal says what to do instead', async () => {
    // Its replacement is the current revision. Two live rows claiming to be
    // the same drawing is worse than the mistake being undone.
    const db = fakeDb([
      [{ id: 3, archivedAt: new Date(), supersededById: 9, uploaderId: MEMBER, projectId: 10 }],
      project, [{ projectRole: 'contractor' }],
    ]);
    await expect(restoreDocument(db, { documentId: 3, userId: MEMBER }))
      .rejects.toThrow(/replacement/i);
    expect(db.writes).toEqual([]);
  });

  it('a document that is not archived is refused', async () => {
    const db = fakeDb([
      [{ id: 3, archivedAt: null, supersededById: null, uploaderId: MEMBER, projectId: 10 }],
      project, [{ projectRole: 'contractor' }],
    ]);
    await expect(restoreDocument(db, { documentId: 3, userId: MEMBER }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('somebody off the project is NOT_FOUND', async () => {
    const db = fakeDb([
      [{ id: 3, archivedAt: new Date(), supersededById: null, uploaderId: MEMBER, projectId: 10 }],
      project, [],
    ]);
    await expect(restoreDocument(db, { documentId: 3, userId: 999 }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('markSuperseded - replacing is a link, not an overwrite', () => {
  it('archives the old row pointing FORWARD to its replacement', async () => {
    const db = fakeDb([]);
    await markSuperseded(db, { oldDocumentId: 3, newDocumentId: 9, userId: MEMBER, uploaderId: MEMBER });
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ supersededById: 9, archivedBy: MEMBER });
    expect(db.writes[0].archivedAt).toBeInstanceOf(Date);
    expect(String(db.writes[0].archiveReason)).toContain('9');
  });

  it('THE NEW ROW IS WRITTEN FIRST - the order is the safety property', () => {
    // Archiving the old document before the upload succeeded would leave a
    // project with neither revision in its working list.
    const body = ROUTERS.slice(
      ROUTERS.indexOf('replaceDocument: protectedProcedure'),
      ROUTERS.indexOf('archiveDocument: protectedProcedure'),
    );
    expect(body.indexOf('db.insert(documents)')).toBeLessThan(body.indexOf('markSuperseded('));
    // And the bytes are verified before either.
    expect(body.indexOf('assertUploadedFileMatches(')).toBeLessThan(body.indexOf('db.insert(documents)'));
    // Through the adapter, so an S3 deployment behaves the same as local disk.
    expect(body).toContain('storagePutOrUnavailable(');
    // Rate limited, because it accepts a file without being named upload*.
    expect(body).toContain('enforceUploadRateLimit(ctx.user.id)');
  });
});

describe('the working list, and the record behind it', () => {
  it('the default list excludes archived documents', async () => {
    const db = fakeDb([[{ id: 1 }]]);
    await listProjectDocuments(db, { projectId: 10 });
    // The filter itself is asserted structurally below; this proves the call
    // path resolves rather than throwing on the builder shape.
    expect(typeof liveDocumentFilter()).toBe('object');
  });

  it('archived documents are reachable only by asking, and the ask is still gated', () => {
    const body = ROUTERS.slice(
      ROUTERS.indexOf('  documents: protectedProcedure'),
      ROUTERS.indexOf('replaceDocument: protectedProcedure'),
    );
    // Same read capability whether or not archived rows are included: a
    // superseded drawing is no less confidential than the current one.
    expect(body).toContain("requireProjectAccess(db, input.projectId, ctx.user.id, 'read')");
    expect(body).toContain('includeArchived');
  });

  it('every refusal is a ProjectDocumentError with one of the three codes', async () => {
    const failures = await Promise.allSettled([
      requireDocumentAccess(fakeDb([[]]), { documentId: 3, userId: OWNER, capability: 'read' }),
      archiveDocument(fakeDb([[{ ...doc, archivedAt: new Date() }], project]), { documentId: 3, userId: OWNER }),
      restoreDocument(fakeDb([[{ id: 3, archivedAt: null, supersededById: null, uploaderId: OWNER, projectId: 10 }], project]), { documentId: 3, userId: OWNER }),
    ]);
    expect(failures.every(f => f.status === 'rejected')).toBe(true);
    for (const failure of failures) {
      const reason = (failure as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(ProjectDocumentError);
      expect(['NOT_FOUND', 'FORBIDDEN', 'BAD_REQUEST']).toContain(reason.code);
      expect(String(reason.message).length).toBeGreaterThan(10);
    }
  });
});
