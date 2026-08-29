// ── OLD → NEW → ACTOR → TIME ───────────────────────────────────────────────
//
// commercialAuditEvents records WHICH fields changed and deliberately never
// their values: "an audit row is read by more people than the record it
// describes". That was right for its audience and is untouched.
//
// But it cannot answer the question an administrator actually has when a
// customer and a supplier disagree - what was the price before it changed -
// and widening the audit row to carry values would hand a competitor's
// historical pricing to everyone who could already read the audit feed, as a
// side effect of a reporting change nobody reviewed as a disclosure.
//
// So values live in their own table with their own read path. These tests hold
// the three properties that makes it safe: the disclosure is narrower, the
// history is immutable, and no credential can ever reach it.

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  HISTORY_FIELDS, isRecordableField, recordChangedFields, recordFieldChange,
  recordFieldChanges, stringifyValue, valuesEqual,
} from './audit/fieldHistory';

const read = (p: string) => readSourceForAssertions(readFileSync(new URL(p, import.meta.url), 'utf8'));

function stubDb(behaviour: 'ok' | 'throws' = 'ok') {
  const rows: Record<string, unknown>[] = [];
  const db = {
    insert: vi.fn(() => ({
      values: (row: Record<string, unknown>) => {
        if (behaviour === 'throws') return Promise.reject(new Error('disk full'));
        rows.push(row);
        return Promise.resolve([{ insertId: 1 }]);
      },
    })),
  };
  return { db: db as unknown, rows };
}

const common = { subjectType: 'product' as const, subjectId: 5, ownerId: 2, actorId: 2 };

describe('what it records', () => {
  it('carries the old value, the new value, the actor and the subject', async () => {
    const { db, rows } = stubDb();
    await recordFieldChange(db, { ...common, field: 'price', oldValue: '1450.00', newValue: '1600.00' });
    expect(rows[0]).toMatchObject({
      subjectType: 'product', subjectId: 5, ownerId: 2, actorId: 2,
      field: 'price', oldValue: '1450.00', newValue: '1600.00',
    });
  });

  it('a decimal keeps the exact string the column holds', () => {
    // A JSON round-trip would turn "1450.00" into 1450 and lose the scale the
    // supplier actually agreed. History that quietly renumbers money is worse
    // than no history.
    expect(stringifyValue('1450.00')).toBe('1450.00');
    expect(stringifyValue(0)).toBe('0');
    expect(stringifyValue(false)).toBe('false');
  });

  it('an absent value is null, not the string "null"', () => {
    expect(stringifyValue(null)).toBeNull();
    expect(stringifyValue(undefined)).toBeNull();
  });

  // ── The phantom price change ─────────────────────────────────────────────
  //
  // Found by saving a product twice in a browser, not by any test here: a
  // DECIMAL column reads back "1720.00" while the patch supplies 1720, so a
  // save that altered nothing recorded a price moving from 1720.00 to 1720.
  // An administrator settling a dispute would read that as a real change.
  //
  // The unit tests could not have caught it, because they hand the same string
  // shape to both sides - which is exactly what the database does not do.
  it('a decimal that reads back with scale is NOT a change', async () => {
    const { db, rows } = stubDb();
    await recordFieldChange(db, { ...common, field: 'price', oldValue: '1720.00', newValue: '1720' });
    expect(rows, 'a save that changed nothing must record nothing').toHaveLength(0);
  });

  it('and neither is 0 vs 0.00, or 1e3 vs 1000', () => {
    for (const [a, b] of [['1720.00', '1720'], ['0.00', '0'], ['1000', '1e3'], ['5.50', '5.5']]) {
      expect(valuesEqual(a, b), `${a} vs ${b}`).toBe(true);
    }
  });

  it('but a REAL price change still is one', async () => {
    // POSITIVE CONTROL. A numeric comparison that returned true for everything
    // would satisfy every assertion above and silently switch the feature off.
    const { db, rows } = stubDb();
    await recordFieldChange(db, { ...common, field: 'price', oldValue: '1720.00', newValue: '1721' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ oldValue: '1720.00', newValue: '1721' });
  });

  it('an empty value is never numerically equal to zero', () => {
    // Number('') is 0, so a blank-vs-zero edit would otherwise vanish - and
    // clearing a price is exactly the kind of change worth recording.
    expect(valuesEqual('', '0')).toBe(false);
    expect(valuesEqual(' ', '0')).toBe(false);
    expect(valuesEqual(null, '0')).toBe(false);
  });

  it('non-numeric text is still compared as text', () => {
    expect(valuesEqual('pending', 'accepted')).toBe(false);
    expect(valuesEqual('pending', 'pending')).toBe(true);
    expect(valuesEqual('true', 'false')).toBe(false);
  });

  it('records nothing when the value did not move', async () => {
    // Without this every save writes a row per untouched field and the history
    // becomes unreadable exactly when somebody needs it.
    const { db, rows } = stubDb();
    await recordFieldChange(db, { ...common, field: 'price', oldValue: '1450.00', newValue: '1450.00' });
    expect(rows).toHaveLength(0);
  });

  it('only the fields that actually moved', async () => {
    const { db, rows } = stubDb();
    await recordChangedFields(db, common,
      { price: '1450.00', stock: 10, name: 'Cement' },
      { price: '1600.00', stock: 10 },
      HISTORY_FIELDS.product);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: 'price', oldValue: '1450.00', newValue: '1600.00' });
  });

  it('a field outside the named list is not recorded', async () => {
    const { db, rows } = stubDb();
    await recordChangedFields(db, common, { internalNote: 'a' }, { internalNote: 'b' }, HISTORY_FIELDS.product);
    expect(rows).toHaveLength(0);
  });

  it('POSITIVE CONTROL: the comparison does fire when something moves', async () => {
    const { db, rows } = stubDb();
    await recordChangedFields(db, common, { stock: 10 }, { stock: 3 }, HISTORY_FIELDS.product);
    expect(rows).toHaveLength(1);
  });
});

describe('no credential can reach this table', () => {
  it('rejects every credential-shaped field name', () => {
    for (const field of [
      'password', 'passwordHash', 'password_hash', 'resetToken', 'tokenHash',
      'invitationToken', 'sessionSecret', 'apiKey', 'S3_SECRET', 'authorization',
    ]) {
      expect(isRecordableField(field), `${field} must never be recorded`).toBe(false);
    }
  });

  it('and still accepts the business fields it exists for', () => {
    // POSITIVE CONTROL. A blanket `return false` would pass every assertion
    // above and make the whole feature silently do nothing.
    for (const field of ['price', 'stock', 'status', 'budget', 'deadline', 'active', 'onboardingStatus']) {
      expect(isRecordableField(field), `${field} must be recordable`).toBe(true);
    }
  });

  it('a forbidden field is dropped rather than written', async () => {
    const { db, rows } = stubDb();
    await recordFieldChange(db, { ...common, subjectType: 'user', field: 'passwordHash', oldValue: 'a', newValue: 'b' });
    expect(rows).toHaveLength(0);
  });

  it('none of the named history fields is a credential', () => {
    for (const [subject, fields] of Object.entries(HISTORY_FIELDS)) {
      for (const field of fields) {
        expect(isRecordableField(field), `${subject}.${field}`).toBe(true);
      }
    }
  });
});

describe('a failed history write never fails the business action', () => {
  it('swallows a database error', async () => {
    // Same trade-off as notifyUser and recordCommercialEvent. A price change
    // that happened with no history row is a gap in the record; a price change
    // REFUSED because the history table was busy is a broken product.
    const { db } = stubDb('throws');
    await expect(recordFieldChange(db, { ...common, field: 'price', oldValue: '1', newValue: '2' }))
      .resolves.toBeUndefined();
  });

  it('a null database is a no-op, not a crash', async () => {
    await expect(recordFieldChange(null, { ...common, field: 'price', oldValue: '1', newValue: '2' }))
      .resolves.toBeUndefined();
  });
});

describe('the table is shaped for an immutable history', () => {
  const SCHEMA = read('../drizzle/schema.ts');
  const table = SCHEMA.slice(
    SCHEMA.indexOf('export const fieldValueHistory'),
    SCHEMA.indexOf('export const fieldValueHistory') + 1800,
  );

  it('outlives its actor and its owner - SET NULL, never CASCADE', () => {
    expect(table).toMatch(/ownerId[\s\S]{0,200}onDelete: 'set null'/);
    expect(table).toMatch(/actorId[\s\S]{0,200}onDelete: 'set null'/);
    expect(table).not.toMatch(/onDelete: 'cascade'/);
  });

  it('subjectId is deliberately NOT a foreign key', () => {
    // The history must survive its subject being deleted - that deletion is
    // often the very thing worth having a record of.
    const line = /subjectId:.*$/m.exec(table)?.[0] ?? '';
    expect(line).toContain('notNull');
    expect(line).not.toContain('references');
  });

  it('a migration exists and the journal names it', () => {
    const migration = readFileSync(new URL('../drizzle/0026_entitlement_overrides_and_value_history.sql', import.meta.url), 'utf8');
    expect(migration).toContain('CREATE TABLE `fieldValueHistory`');
    expect(migration).toContain('CREATE TABLE `vendorEntitlementOverrides`');
    // It must NOT re-create tables earlier migrations already made - the
    // generated draft did exactly that, because no meta snapshot exists for
    // the three hand-written migrations before it.
    expect(migration).not.toContain('CREATE TABLE `commercialAuditEvents`');
    expect(migration).not.toContain('CREATE TABLE `rfqItems`');
    const journal = read('../drizzle/meta/_journal.json');
    expect(journal).toContain('0026_entitlement_overrides_and_value_history');
  });

  it('nothing in the codebase ever UPDATEs or DELETEs a history row', () => {
    // Part 17: "historical records must remain immutable". Append-only is the
    // property; this is what would catch a later convenience edit.
    for (const file of ['./routers.ts', './quotationWorkflow.ts', './audit/fieldHistory.ts']) {
      const source = read(file);
      expect(source, `${file} must not update history`).not.toMatch(/update\(fieldValueHistory\)/);
      expect(source, `${file} must not delete history`).not.toMatch(/delete\(fieldValueHistory\)/);
    }
  });
});

describe('the read is a NARROWER disclosure than the audit trail', () => {
  const ROUTERS = read('./routers.ts');

  it('the owner is resolved from the LIVE row, not from the history row', () => {
    // fieldValueHistory.ownerId records who owned it AT THE TIME, which is
    // right for the audit and wrong for authorization: a product sold to
    // another supplier would otherwise keep letting its previous owner read
    // changes made after they lost it.
    const at = ROUTERS.indexOf('async function resolveSubjectOwner');
    expect(at).toBeGreaterThan(-1);
    const body = ROUTERS.slice(at, at + 1600);
    for (const [subject, column] of [['rfq', 'rfqs.requesterId'], ['quotation', 'quotations.providerId'], ['product', 'products.supplierId']]) {
      expect(body, `${subject} ownership`).toContain(column);
    }
  });

  it('a stranger gets NOT_FOUND, which discloses nothing', () => {
    const at = ROUTERS.indexOf('  recordHistory: protectedProcedure');
    const body = ROUTERS.slice(at, at + 2200);
    expect(body).toContain("code: 'NOT_FOUND'");
    expect(body).not.toContain("code: 'FORBIDDEN'");
  });

  it('an administrator without a real admin role is not an administrator', () => {
    // adminRole null means no permissions everywhere else in this file, and it
    // has to mean the same here.
    const at = ROUTERS.indexOf('  recordHistory: protectedProcedure');
    const body = ROUTERS.slice(at, at + 2200);
    expect(body).toMatch(/ctx\.user\.role === 'admin'\s*\n?\s*&& isAdminRole/);
  });

  it('the read is bounded', () => {
    const at = ROUTERS.indexOf('  recordHistory: protectedProcedure');
    const body = ROUTERS.slice(at, at + 2200);
    expect(body).toMatch(/limit: z\.number\(\)\.int\(\)\.min\(1\)\.max\(200\)/);
  });
});

describe('the mutations that change these fields actually record them', () => {
  const ROUTERS = read('./routers.ts');
  const WORKFLOW = read('./quotationWorkflow.ts');

  it('a product price change captures the value it moved FROM', () => {
    // The row has to be read in full BEFORE the UPDATE. After it, the old
    // price does not exist anywhere.
    const at = ROUTERS.indexOf('  updateProduct: approvedProviderProcedure');
    const body = ROUTERS.slice(at, ROUTERS.indexOf('\n  setProductActive:', at));
    const select = body.indexOf('const [owned] = await db.select()');
    const update = body.indexOf('await db.update(products).set(patch)');
    const record = body.indexOf('recordChangedFields(db, {');
    expect(select, 'the whole row must be read').toBeGreaterThan(-1);
    expect(select).toBeLessThan(update);
    expect(record).toBeGreaterThan(update);
    // And the ownership predicate is still there - widening the select must
    // not have widened who can reach the row.
    expect(body).toContain('eq(products.supplierId, ctx.user.id)');
  });

  it('publishing and delisting is recorded as a status change', () => {
    const at = ROUTERS.indexOf('  setProductActive: approvedProviderProcedure');
    const body = ROUTERS.slice(at, at + 2000);
    expect(body).toContain("field: 'active'");
    expect(body).toContain('oldValue: String(owned.active)');
  });

  it('supplier approval records the status it moved from', () => {
    const at = ROUTERS.indexOf('  updateApplicantStatus: adminWith');
    const body = ROUTERS.slice(at, at + 2600);
    expect(body).toContain("field: 'onboardingStatus', oldValue: applicant.onboardingStatus");
    expect(body).toContain("field: 'verified'");
  });

  it('EVERY quotation the acceptance moved is recorded, not only the winner', () => {
    // The losers are rejected as a side effect of someone else winning, which
    // is exactly the transition nobody remembers making and the one a supplier
    // asks about.
    const at = WORKFLOW.indexOf('export async function acceptQuotationSecure');
    const body = WORKFLOW.slice(at, WORKFLOW.indexOf('export async function rejectQuotationSecure'));
    expect(body).toContain("newValue: 'accepted'");
    expect(body).toContain("newValue: 'rejected'");
    expect(body).toContain('for (const loser of others)');
    // The losers' previous status has to be read before the cascade update.
    expect(body).toMatch(/select\(\{ id: quotations\.id, providerId: quotations\.providerId, status: quotations\.status \}\)/);
  });

  it('the RFQ status transitions are recorded on both paths', () => {
    expect(WORKFLOW).toMatch(/newValue: 'awarded'/);
    expect(WORKFLOW).toMatch(/newValue: 'closed'/);
  });

  it('and the history write happens inside the same transaction as the change', () => {
    // Outside it, a rolled-back acceptance would leave a history row claiming
    // it happened.
    expect(WORKFLOW.match(/recordFieldChange\(tx,/g) ?? []).toHaveLength(5);
    expect(WORKFLOW).not.toMatch(/recordFieldChange\(db,/);
  });
});
