import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import * as schema from '../drizzle/schema';

// Phase 3C: locks in the foreign-key + index shape added by drizzle/0012_dry_oracle.sql.
// Runs against the schema definitions only (no live database) so it stays part of the
// normal CI-safe suite, the same way the rest of this test file behaves.

type Expectation = {
  table: keyof typeof schema;
  column: string;
  onDelete: 'restrict' | 'set null';
  onUpdate: 'restrict';
};

const expectations: Expectation[] = [
  { table: 'users', column: 'createdBy', onDelete: 'set null', onUpdate: 'restrict' },
  { table: 'users', column: 'onboardingReviewedBy', onDelete: 'set null', onUpdate: 'restrict' },
  { table: 'userAccountAuditEvents', column: 'userId', onDelete: 'set null', onUpdate: 'restrict' },
  { table: 'userAccountAuditEvents', column: 'actorId', onDelete: 'set null', onUpdate: 'restrict' },
  { table: 'projects', column: 'ownerId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'milestones', column: 'projectId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'tasks', column: 'projectId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'tasks', column: 'milestoneId', onDelete: 'set null', onUpdate: 'restrict' },
  { table: 'tasks', column: 'assigneeId', onDelete: 'set null', onUpdate: 'restrict' },
  { table: 'documents', column: 'projectId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'documents', column: 'uploaderId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'registrationDocuments', column: 'userId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'registrationDocuments', column: 'reviewedBy', onDelete: 'set null', onUpdate: 'restrict' },
  { table: 'registrationDocumentSubmissions', column: 'documentId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'registrationDocumentSubmissions', column: 'userId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'registrationReviewEvents', column: 'userId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'registrationReviewEvents', column: 'documentId', onDelete: 'set null', onUpdate: 'restrict' },
  { table: 'registrationReviewEvents', column: 'actorId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'productQuestions', column: 'productId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'productQuestions', column: 'askerId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'products', column: 'supplierId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'rfqs', column: 'requesterId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'rfqs', column: 'projectId', onDelete: 'set null', onUpdate: 'restrict' },
  { table: 'quotations', column: 'rfqId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'quotations', column: 'providerId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'messages', column: 'senderId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'messages', column: 'receiverId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'messages', column: 'projectId', onDelete: 'set null', onUpdate: 'restrict' },
  { table: 'messages', column: 'quotationId', onDelete: 'set null', onUpdate: 'restrict' },
  { table: 'notifications', column: 'userId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'reviews', column: 'projectId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'reviews', column: 'reviewerId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'reviews', column: 'revieweeId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'progressReports', column: 'projectId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'progressReports', column: 'authorId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'disputes', column: 'reporterId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'disputes', column: 'respondentId', onDelete: 'set null', onUpdate: 'restrict' },
  { table: 'disputes', column: 'projectId', onDelete: 'set null', onUpdate: 'restrict' },
  { table: 'adminSettings', column: 'updatedBy', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'dailyLogs', column: 'projectId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'dailyLogs', column: 'authorId', onDelete: 'restrict', onUpdate: 'restrict' },
  { table: 'expenses', column: 'projectId', onDelete: 'restrict', onUpdate: 'restrict' },
];

describe('database integrity (Phase 3C): every FK-shaped column is indexed and constrained', () => {
  it('covers all 42 known FK-shaped relationships (fails loudly if the matrix drifts)', () => {
    expect(expectations).toHaveLength(42);
  });

  for (const { table, column, onDelete, onUpdate } of expectations) {
    it(`${String(table)}.${column} has an index and an ON DELETE ${onDelete.toUpperCase()} / ON UPDATE ${onUpdate.toUpperCase()} foreign key`, () => {
      const config = getTableConfig(schema[table] as any);

      const hasIndex = config.indexes.some(idx =>
        idx.config.columns.some((col: any) => col.name === column),
      );
      expect(hasIndex, `expected an index covering ${String(table)}.${column}`).toBe(true);

      const fk = config.foreignKeys.find(fk => fk.reference().columns.some((col: any) => col.name === column));
      expect(fk, `expected a foreign key on ${String(table)}.${column}`).toBeDefined();
      expect(fk!.onDelete).toBe(onDelete);
      expect(fk!.onUpdate).toBe(onUpdate);
    });
  }

  it('never uses CASCADE for delete or update behavior (conservative-by-design constraint)', () => {
    for (const tableKey of Object.keys(schema)) {
      const table = (schema as any)[tableKey];
      if (!table || typeof table !== 'object' || !('_' in table)) continue;
      let config;
      try {
        config = getTableConfig(table);
      } catch {
        continue;
      }
      for (const fk of config.foreignKeys) {
        expect(fk.onDelete, `${tableKey} FK must not use CASCADE on delete`).not.toBe('cascade');
        expect(fk.onUpdate, `${tableKey} FK must not use CASCADE on update`).not.toBe('cascade');
      }
    }
  });
});
