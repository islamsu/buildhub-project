import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import { recordCommercialEvent } from './_core/commercialAudit';

/**
 * THE COMMERCIAL AUDIT TRAIL.
 *
 * BuildHub audited ACCOUNTS thoroughly - creation, role changes, the whole
 * password-reset lifecycle, every admin action, 22 distinct actions from 29
 * call sites - and audited COMMERCE not at all. An RFQ could be created,
 * quoted, awarded and closed leaving no record of who did what or when.
 *
 * For a marketplace that intends to carry real money that is the gap that
 * matters: account history answers "who is this person", commercial history
 * answers "what did they agree to".
 */

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
  return { db: db as never, rows };
}

// ══ 1. THE TRADE-OFF THAT DEFINES THIS MODULE ══════════════════════════════

describe('a failed audit write never fails the business action', () => {
  it('swallows a database error instead of throwing', async () => {
    // If the audit insert throws, the supplier's quotation has ALREADY been
    // submitted and the customer is waiting on it. Rolling that back to protect
    // the log would be losing the thing in order to protect the record of the
    // thing.
    const { db } = stubDb('throws');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      recordCommercialEvent(db, {
        actorId: 1, ownerId: 2, subjectType: 'quotation', subjectId: 5,
        action: 'quotation_submitted',
      }),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('but it is LOUD for an operator - silence would hide a broken trail', async () => {
    // The honest cost of the decision above is that a missing audit row is
    // invisible to the user. It must not also be invisible to whoever runs
    // this.
    const { db } = stubDb('throws');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await recordCommercialEvent(db, {
      actorId: 1, ownerId: 2, subjectType: 'quotation', subjectId: 5,
      action: 'quotation_submitted',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.event).toBe('commercial_audit_write_failed');
    expect(logged.subjectId).toBe(5);
    expect(logged.action).toBe('quotation_submitted');
    spy.mockRestore();
  });

  it('a null database is a no-op, not a crash', async () => {
    await expect(
      recordCommercialEvent(null, {
        actorId: 1, ownerId: 2, subjectType: 'rfq', subjectId: 1, action: 'rfq_created',
      }),
    ).resolves.toBeUndefined();
  });
});

// ══ 2. WHAT IT RECORDS ═════════════════════════════════════════════════════

describe('the row it writes', () => {
  it('carries actor, owner, subject and action', async () => {
    const { db, rows } = stubDb();
    await recordCommercialEvent(db, {
      actorId: 10, ownerId: 20, subjectType: 'quotation', subjectId: 77,
      action: 'quotation_accepted', detail: 'rfq 5',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: 10, ownerId: 20, subjectType: 'quotation',
      subjectId: 77, action: 'quotation_accepted', detail: 'rfq 5',
    });
  });

  it('truncates an over-long detail rather than storing a payload', async () => {
    // Detail is CONTEXT - a status transition, a price, a filename. An audit
    // trail is read by more people than the record it describes, so it must
    // not become the widest copy of the narrowest data.
    const { db, rows } = stubDb();
    await recordCommercialEvent(db, {
      actorId: 1, ownerId: 2, subjectType: 'document', subjectId: 1,
      action: 'document_uploaded', detail: 'x'.repeat(5000),
    });
    expect(String(rows[0].detail).length).toBeLessThanOrEqual(500);
  });

  it('stores null rather than an empty string when there is no detail', async () => {
    const { db, rows } = stubDb();
    await recordCommercialEvent(db, {
      actorId: 1, ownerId: 2, subjectType: 'rfq', subjectId: 1, action: 'rfq_created',
    });
    expect(rows[0].detail).toBeNull();
  });

  it('accepts a null actor - a system action still gets recorded', async () => {
    const { db, rows } = stubDb();
    await recordCommercialEvent(db, {
      actorId: null, ownerId: 2, subjectType: 'rfq', subjectId: 1, action: 'rfq_closed',
    });
    expect(rows[0].actorId).toBeNull();
  });
});

// ══ 3. THE SCHEMA DECISIONS ════════════════════════════════════════════════

describe('the table is shaped for an audit trail, not for convenience', () => {
  const SCHEMA = readSourceForAssertions(readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8'));
  const table = SCHEMA.slice(
    SCHEMA.indexOf('export const commercialAuditEvents'),
    SCHEMA.indexOf('export const commercialAuditEvents') + 2200,
  );

  it('the trail OUTLIVES its actor - SET NULL, never RESTRICT', () => {
    // RESTRICT would make a user undeletable by virtue of having done work,
    // and CASCADE would delete the evidence along with the person. Verified
    // against a real MariaDB: deleting the actor nulls the reference and the
    // row survives.
    expect(table).toMatch(/actorId[\s\S]{0,200}onDelete: 'set null'/);
    expect(table).toMatch(/ownerId[\s\S]{0,200}onDelete: 'set null'/);
    expect(table).not.toMatch(/onDelete: 'cascade'/);
  });

  it('subjectId is deliberately NOT a foreign key', () => {
    // An audit row must survive its subject being deleted - that deletion is
    // often the very thing worth auditing - and a FK would either block it or
    // cascade the evidence away.
    const subjectLine = /subjectId:.*$/m.exec(table)?.[0] ?? '';
    expect(subjectLine).toContain('notNull');
    expect(subjectLine).not.toContain('references');
  });

  it('ownerId is denormalised, which is what makes the read scopable', () => {
    // Resolving ownership at read time would mean a different join per subject
    // type, four of them, each able to drift. Recording who it belonged to AT
    // THE TIME is also more truthful for an audit trail.
    expect(table).toContain('ownerId');
    expect(table).toMatch(/commercialAuditEvents_ownerId_idx/);
  });

  it('is indexed for the queries it will actually receive', () => {
    for (const index of ['subject_idx', 'actorId_idx', 'ownerId_idx', 'createdAt_idx']) {
      expect(table).toContain(index);
    }
  });

  it('a migration exists for it', () => {
    const migration = readFileSync(
      new URL('../drizzle/0023_commercial_audit_events.sql', import.meta.url), 'utf8',
    );
    expect(migration).toContain('CREATE TABLE `commercialAuditEvents`');
    expect(migration).toContain('ON DELETE set null');
    const journal = readSourceForAssertions(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
    expect(journal).toContain('0023_commercial_audit_events');
  });
});

// ══ 4. THE COMMERCIAL PATHS ARE ACTUALLY INSTRUMENTED ══════════════════════

describe('the events that matter are recorded', () => {
  const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'))
    // Comments stripped first: this file explains at length what it records,
    // and an assertion matching its own prose would pass on a router that
    // described the trail without writing to it.
    ;

  it.each([
    'rfq_created',
    'quotation_submitted',
    'quotation_accepted',
    'quotation_rejected',
    'enquiry_opened',
    'product_updated',
    'product_published',
    'product_delisted',
    'product_images_changed',
    'product_question_answered',
  ])('%s is written from a real call site', action => {
    expect(ROUTERS).toContain(`'${action}'`);
  });

  it('the award is recorded - the single event most worth keeping', () => {
    const accept = ROUTERS.slice(
      ROUTERS.indexOf('acceptQuotation: protectedProcedure'),
      ROUTERS.indexOf('acceptQuotation: protectedProcedure') + 1200,
    );
    expect(accept).toContain('recordCommercialEvent');
    expect(accept).toContain('quotation_accepted');
  });

  it('the paid lead distinguishes a fresh charge from a free re-open', () => {
    // Otherwise a billing dispute has no way to tell them apart.
    expect(ROUTERS).toContain('credit charged');
    expect(ROUTERS).toContain('reopened, no credit charged');
  });

  it('records WHICH product fields changed, never their values', () => {
    expect(ROUTERS).toMatch(/changed: \$\{Object\.keys\(patch\)/);
  });

  /**
   * THE INVARIANT THIS TRAIL IS EASIEST TO BREAK.
   *
   * `subjectId` must name a row in the table `subjectType` names. Three call
   * sites got this wrong on the first pass and none of them looked wrong:
   *
   *   quotation_submitted   recorded the RFQ id under subjectType 'quotation'
   *   enquiry_opened        recorded the RFQ id under subjectType 'enquiry'
   *   product_question_...  recorded the QUESTION id under subjectType 'product'
   *
   * Each one produces a query that returns confident, wrong answers rather
   * than an error: `WHERE subjectType='quotation' AND subjectId=5` would mix
   * quotation 5 with whatever happened on RFQ 5. An audit trail that is
   * plausibly wrong is worse than one that is obviously missing, because
   * somebody will settle a dispute with it.
   *
   * So every call site is enumerated here. Adding one means adding a line,
   * which is the point: it forces the question "is that id from that table?"
   * at the moment somebody would otherwise not ask it.
   */
  it('every call site records an id from the table its subjectType names', () => {
    const sites = [...ROUTERS.matchAll(
      /recordCommercialEvent\([\s\S]{0,600}?\}\);/g,
    )].map(match => {
      const body = match[0];
      return {
        subjectType: /subjectType: '(\w+)'/.exec(body)?.[1] ?? null,
        subjectId: /subjectId: ([^,\n]+)/.exec(body)?.[1]?.trim() ?? null,
      };
    }).filter(site => site.subjectType);

    // Nine instrumented events. If this number moves, the list below must too.
    expect(sites).toHaveLength(9);

    // The id expression each subjectType is allowed to carry. `input.rfqId` is
    // absent from 'quotation' and 'enquiry' deliberately - that was the defect.
    const ALLOWED: Record<string, string[]> = {
      product:   ['id', 'input.id', 'row.productId'],
      rfq:       ['rfqId'],
      quotation: ['quotationId', 'input.quotationId'],
      enquiry:   ['result.enquiryId ?? 0'],
    };

    for (const site of sites) {
      const allowed = ALLOWED[site.subjectType!] ?? [];
      expect(
        allowed,
        `subjectType '${site.subjectType}' records subjectId '${site.subjectId}', `
        + `which is not one of ${JSON.stringify(allowed)} - is that id really `
        + `a ${site.subjectType} row?`,
      ).toContain(site.subjectId);
    }
  });

  it('the RFQ behind a quotation or enquiry is kept, as CONTEXT not as identity', () => {
    // Losing it entirely would be the opposite mistake: a quotation audit row
    // that cannot be traced back to what was quoted on.
    expect(ROUTERS).toMatch(/detail: `rfq \$\{input\.rfqId\}, price/);
    expect(ROUTERS).toMatch(/detail: `rfq \$\{input\.rfqId\}, \$\{result\.alreadyConsumed/);
  });

  it('a missing enquiry id still records the charge', () => {
    // The credit was spent either way. A row saying so with the id absent
    // beats no record that money changed hands.
    expect(ROUTERS).toContain('subjectId: result.enquiryId ?? 0');
  });
});

// ══ 5. READING THE TRAIL IS ITSELF SCOPED ══════════════════════════════════

describe('audit records are permission-scoped, like the records they describe', () => {
  const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'))
    ;
  const auditRouter = ROUTERS.slice(
    ROUTERS.indexOf('const auditRouter = router({'),
    ROUTERS.indexOf('const billingRouter = router({'),
  );

  it('the router exists and is registered', () => {
    expect(auditRouter.length).toBeGreaterThan(0);
    expect(ROUTERS).toMatch(/audit: auditRouter/);
  });

  it('`mine` is scoped to the caller as actor OR owner, and nothing else', () => {
    const mine = auditRouter.slice(auditRouter.indexOf('mine:'), auditRouter.indexOf('all:'));
    expect(mine).toContain('actorId} = ${ctx.user.id}');
    expect(mine).toContain('ownerId} = ${ctx.user.id}');
  });

  it('`mine` does NOT return actorId - whose account touched a record is not public', () => {
    // A trail that named the actor on every row would be a way to learn which
    // accounts touched which records.
    const mine = auditRouter.slice(auditRouter.indexOf('mine:'), auditRouter.indexOf('all:'));
    const projection = mine.slice(mine.indexOf('.select({'), mine.indexOf('.from('));
    expect(projection).toContain('subjectType');
    expect(projection).not.toContain('actorId:');
  });

  it('`all` is administrator-only, on the real audit permission', () => {
    expect(auditRouter).toMatch(/all: adminWith\('audit\.read'\)/);
  });

  it('there is no unscoped read of the whole trail', () => {
    expect(auditRouter).not.toMatch(/publicProcedure/);
    // Exactly two reads. A third would need its own authorization rule, which
    // is the thing most likely to be got wrong later.
    const procedures = auditRouter.match(/^\s{2}\w+:/gm) ?? [];
    expect(procedures).toHaveLength(2);
  });

  it('both reads are bounded - an audit table only ever grows', () => {
    expect(auditRouter.match(/\.limit\(/g) ?? []).toHaveLength(2);
  });
});
