// ── The dispute record, and the one place its subject is written ───────────
//
// `disputes` had a reporter, an optional respondent, a project, a title, a
// description, a free-text type, a priority nothing could change, a status any
// administrator could set to any value from any state, and a notes column.
// There was no reference, no category, no assignment, no record of who resolved
// it or how, no reopen, no evidence, no messages, and no history.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DISPUTE_SUBJECT_TYPES, DISPUTE_STATUSES, DISPUTE_PRIORITIES, DISPUTE_CATEGORIES,
  DISPUTE_RESOLUTION_TYPES, DISPUTE_ADMIN_SETTABLE_STATUSES, DISPUTE_OPEN_STATUSES,
  disputeReference, parseDisputeReference, isAdminSettableStatus,
} from '@shared/disputes';
import { subjectColumns, hasSubject, NO_SUBJECT_RECORDED } from './disputeSubject';

const SCHEMA = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');
const MIGRATION = readFileSync(new URL('../drizzle/0046_dispute_lifecycle.sql', import.meta.url), 'utf8');

describe('the shared vocabulary matches the columns it describes', () => {
  // Three copies of a closed set, edited apart, is the architecture that
  // produced four disagreeing category vocabularies in this codebase.
  const columnEnum = (name: string): string[] => {
    const match = new RegExp(`${name}:\\s*mysqlEnum\\('${name}',\\s*\\[([^\\]]*)\\]\\)`).exec(SCHEMA);
    expect(match, `${name} enum not found in the schema`).toBeTruthy();
    return match![1].split(',').map(part => part.trim().replace(/^'|'$/g, '')).filter(Boolean);
  };

  it.each([
    ['subjectType', DISPUTE_SUBJECT_TYPES],
    ['category', DISPUTE_CATEGORIES],
    ['resolutionType', DISPUTE_RESOLUTION_TYPES],
  ])('%s agrees with the shared list', (name, shared) => {
    expect(columnEnum(name)).toEqual([...shared]);
  });

  it('status agrees, and carries the new withdrawn value', () => {
    const status = SCHEMA.slice(SCHEMA.indexOf('export const disputes = mysqlTable'));
    const match = /status:\s*mysqlEnum\('status',\s*\[([^\]]*)\]\)/.exec(status);
    const values = match![1].split(',').map(p => p.trim().replace(/^'|'$/g, ''));
    expect(values).toEqual([...DISPUTE_STATUSES]);
    expect(values).toContain('withdrawn');
  });

  it('priority agrees', () => {
    const table = SCHEMA.slice(SCHEMA.indexOf('export const disputes = mysqlTable'));
    const match = /priority:\s*mysqlEnum\('priority',\s*\[([^\]]*)\]\)/.exec(table);
    expect(match![1].split(',').map(p => p.trim().replace(/^'|'$/g, ''))).toEqual([...DISPUTE_PRIORITIES]);
  });

  it('an administrator cannot set withdrawn - that is the reporter\'s decision', () => {
    // Recording it as an admin action would put the platform's name on a
    // choice the reporter made.
    expect(DISPUTE_ADMIN_SETTABLE_STATUSES).not.toContain('withdrawn');
    expect(isAdminSettableStatus('withdrawn')).toBe(false);
    for (const status of DISPUTE_ADMIN_SETTABLE_STATUSES) expect(isAdminSettableStatus(status)).toBe(true);
  });

  it('the open statuses are the ones operationalHealth counts', () => {
    // A drift here would make the platform's own "open disputes" figure wrong.
    const health = readFileSync(new URL('./admin/operationalHealth.ts', import.meta.url), 'utf8');
    for (const status of DISPUTE_OPEN_STATUSES) expect(health).toContain(`'${status}'`);
  });

  it('nothing in the vocabulary promises money BuildHub does not hold', () => {
    // BuildHub takes no payments, holds no funds and issues no refunds, so a
    // refund category would describe a process that does not exist and invite a
    // user to expect one.
    const words = [...DISPUTE_CATEGORIES, ...DISPUTE_RESOLUTION_TYPES].join(' ');
    for (const forbidden of ['refund', 'chargeback', 'payment', 'compensat', 'reimburse', 'payout']) {
      expect(words, `${forbidden} promises a remedy BuildHub cannot deliver`).not.toContain(forbidden);
    }
  });
});

describe('the human reference', () => {
  it('reads as a reference somebody can quote on the phone', () => {
    expect(disputeReference(123, new Date('2026-05-01T00:00:00Z'))).toBe('DSP-2026-000123');
  });

  it('uses the ROW\'s year, not this year', () => {
    // A dispute filed in 2025 must not be referenced as a 2026 one - which is
    // exactly what the migration's backfill had to get right.
    expect(disputeReference(1, new Date('2025-03-04T00:00:00Z'))).toBe('DSP-2025-000001');
  });

  it('round-trips', () => {
    expect(parseDisputeReference(disputeReference(4321, new Date('2026-01-01T00:00:00Z')))).toBe(4321);
    expect(parseDisputeReference('  dsp-2026-000042  ')).toBe(42);
  });

  it('refuses anything that is not one, rather than guessing', () => {
    for (const bad of ['', '42', 'DSP-2026', 'DSP-26-000042', 'DSP-2026-42', 'XSP-2026-000042',
      'DSP-2026-000042-x', 'DSP-2026-000000']) {
      expect(parseDisputeReference(bad), bad).toBeNull();
    }
  });
});

describe('the subject is written in ONE place', () => {
  /*
   * `projectId` survives as a LEGACY MIRROR so `admin.projectDetail`'s count
   * keeps working. It is derived, never independent: a second authoritative
   * field is the shape that produced four disagreeing category vocabularies
   * here.
   */
  it('a project dispute sets the mirror', () => {
    expect(subjectColumns('project', 7)).toEqual({ subjectType: 'project', subjectId: 7, projectId: 7 });
  });

  it('an RFQ or quotation dispute leaves it NULL rather than pointing somewhere plausible', () => {
    // Pointing at the RFQ's project would make the legacy count report
    // disputes about a different thing.
    expect(subjectColumns('rfq', 7)).toEqual({ subjectType: 'rfq', subjectId: 7, projectId: null });
    expect(subjectColumns('quotation', 7)).toEqual({ subjectType: 'quotation', subjectId: 7, projectId: null });
  });

  it('and the router writes it through that function, not by hand', () => {
    const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const create = ROUTERS.slice(
      ROUTERS.indexOf('const disputesRouter = router({'),
      ROUTERS.indexOf('// ── Provider Portfolio'),
    );
    // The subject type is now whichever of the three the caller named, so the
    // literal 'project' is gone - but it still goes through the one writer.
    expect(create).toContain('...subjectColumns(input.subjectType, subjectId)');
    // No hand-written projectId anywhere in the dispute router.
    expect(create).not.toMatch(/projectId:\s*input\.projectId/);
  });

  it('a pre-0046 row with no project is reported as unknown, not as project zero', () => {
    // Migration 0046 backfilled the subject from projectId; a row whose project
    // was null had nothing to backfill from. Rendering those as "project 0"
    // would be a fabricated relationship.
    expect(NO_SUBJECT_RECORDED).toBe(0);
    expect(hasSubject({ subjectId: 0 })).toBe(false);
    expect(hasSubject({ subjectId: null })).toBe(false);
    expect(hasSubject({ subjectId: 3 })).toBe(true);
  });
});

describe('the migration is forward-only and keeps every existing row', () => {
  it('backfills the subject from the project rather than defaulting it away', () => {
    expect(MIGRATION).toContain('UPDATE `disputes` SET `subjectId` = `projectId` WHERE `projectId` IS NOT NULL');
  });

  it('backfills the reference from the row\'s OWN creation year', () => {
    expect(MIGRATION).toContain("CONCAT('DSP-', YEAR(`createdAt`), '-', LPAD(`id`, 6, '0'))");
    // Not NOW(): a 2025 dispute must not become a 2026 reference.
    expect(MIGRATION).not.toContain('YEAR(NOW())');
  });

  it('adds rather than drops - no existing column is removed', () => {
    expect(MIGRATION).not.toMatch(/DROP COLUMN/i);
    expect(MIGRATION).not.toMatch(/DROP TABLE/i);
  });

  it('actor columns are SET NULL, so a record outlives the administrator who touched it', () => {
    // RESTRICT would make an administrator who ever touched a dispute
    // undeletable.
    for (const fk of ['disputes_assignedTo_fk', 'disputes_assignedBy_fk',
      'disputes_resolvedBy_fk', 'disputes_reopenedBy_fk', 'disputeStatusHistory_actorId_fk']) {
      const clause = MIGRATION.slice(MIGRATION.indexOf(fk));
      expect(clause.slice(0, 200), fk).toContain('ON DELETE SET NULL');
    }
  });

  it('but the CONTENT of a dispute is RESTRICT, so it cannot be orphaned', () => {
    for (const fk of ['disputeEvidence_disputeId_fk', 'disputeMessages_disputeId_fk',
      'disputeStatusHistory_disputeId_fk', 'disputeEvidence_uploadedBy_fk', 'disputeMessages_authorId_fk']) {
      const clause = MIGRATION.slice(MIGRATION.indexOf(fk));
      expect(clause.slice(0, 200), fk).toContain('ON DELETE RESTRICT');
    }
  });

  it('indexes the columns the admin list orders and filters on', () => {
    for (const index of ['disputes_subject_idx', 'disputes_status_idx',
      'disputes_priority_idx', 'disputes_createdAt_idx', 'disputes_assignedTo_idx']) {
      expect(MIGRATION, index).toContain(index);
    }
  });

  it('is registered in the journal, so it actually runs', () => {
    const journal = readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8');
    expect(journal).toContain('0046_dispute_lifecycle');
  });
});

describe('internal notes are separated by TABLE, not by a column', () => {
  it('disputeMessages carries no visibility flag at all', () => {
    /*
     * A forgotten `where visibility = 'participants'` would show a reporter
     * what an administrator wrote about them, and a rule that can be got wrong
     * by omitting a clause eventually will be. Internal notes are not in this
     * table, so no query against it can leak one.
     */
    const table = SCHEMA.slice(
      SCHEMA.indexOf('export const disputeMessages = mysqlTable'),
      SCHEMA.indexOf('export const disputeStatusHistory = mysqlTable'),
    );
    expect(table).not.toContain('visibility');
    expect(table).not.toContain('internal');
  });

  it('and adminNotes already accepts a dispute subject', () => {
    // The enum has always allowed it and nothing has ever written one.
    expect(SCHEMA).toContain("subjectType: mysqlEnum('subjectType', ['user', 'vendor', 'project', 'rfq', 'quotation', 'dispute'])");
  });
});
