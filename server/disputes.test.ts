// ── WHO MAY RAISE, READ AND ANSWER A DISPUTE ──────────────────────────────
//
// These were source-text assertions that `disputes.create` contained three
// particular inline expressions. The rules have MOVED into
// server/disputeEligibility.ts, because the owner's decision is a polymorphic
// subject - PROJECT, RFQ or QUOTATION - and three more inline rules, each able
// to drift from the others, is the shape this codebase keeps having to undo.
//
// Restated as BEHAVIOUR against the service, which is strictly stronger: the
// old assertions could not tell whether the expression they matched was
// reached, and could not cover the two new subject types at all. The one thing
// behaviour cannot see - that the router calls the service rather than
// restating it - is still asserted from the source, at the end.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  partiesForSubject, relationToSubject, requireSubjectParty,
  validateRespondent, respondentCandidates, canReadDispute,
} from './disputeEligibility';

/** ── The cast of one small, complete marketplace situation ──────────────── */
const HOMEOWNER = 1;      // owns the project, raised the RFQ
const CONTRACTOR = 2;     // a live member of the project
const REMOVED = 3;        // was a member, is not any more
const SUPPLIER_QUOTED = 4;   // submitted a quotation on the RFQ
const SUPPLIER_INVITED = 5;  // invited, never responded
const SUPPLIER_ENQUIRED = 6; // opened it as a qualified enquiry
const COMPETITOR = 7;        // another supplier on the platform. NOT a party.
const STRANGER = 8;

const PROJECT_ID = 10;
const RFQ_ID = 20;
const QUOTATION_ID = 30;

/**
 * ── A DATABASE STAND-IN THAT READS THE FILTERS ─────────────────────────────
 *
 * The first version ignored every `where` clause and returned the table's rows
 * whatever was asked. Two mutations survived it - dropping the
 * `isNull(removedAt)` filter that excludes removed members, and widening a
 * quotation dispute to every supplier who bid on the RFQ - because a fake that
 * ignores filters cannot see a filter being removed, and a guard that cannot
 * fail is not a guard.
 *
 * Drizzle conditions carry their column references, so this walks them and
 * records which columns each query actually constrained. Tests assert on that,
 * and the live probe exercises the same rules against a real database.
 */
function columnsIn(condition: unknown): string[] {
  const names: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.name === 'string' && node.table) names.push(node.name);
    for (const key of ['queryChunks', 'chunks']) if (Array.isArray(node[key])) node[key].forEach(walk);
    if (Array.isArray(node)) node.forEach(walk);
  };
  walk(condition);
  return names;
}

function fakeDb(over: Record<string, any[]> = {}) {
  const rows: Record<string, any[]> = {
    projects: [{ id: PROJECT_ID, ownerId: HOMEOWNER, title: 'Villa slab' }],
    projectMembers: [{ userId: CONTRACTOR }],
    rfqs: [{ id: RFQ_ID, requesterId: HOMEOWNER, title: 'Roof waterproofing' }],
    rfqSuppliers: [{ userId: SUPPLIER_INVITED }],
    qualifiedEnquiries: [{ userId: SUPPLIER_ENQUIRED }],
    quotations: [{ userId: SUPPLIER_QUOTED, id: QUOTATION_ID, rfqId: RFQ_ID, providerId: SUPPLIER_QUOTED }],
    users: [
      { id: HOMEOWNER, name: 'Homeowner' }, { id: CONTRACTOR, name: 'Contractor' },
      { id: SUPPLIER_QUOTED, name: 'Quoting Supplier' }, { id: SUPPLIER_INVITED, name: 'Invited Supplier' },
      { id: SUPPLIER_ENQUIRED, name: 'Enquiring Supplier' },
    ],
    ...over,
  };
  const nameOf = (table: any) => {
    for (const key of Object.keys(rows)) {
      if (table?.[Symbol.for('drizzle:Name')] === key || table?._?.name === key) return key;
    }
    return String(table?.[Symbol.for('drizzle:Name')] ?? table?._?.name ?? 'unknown');
  };
  /** Every (table, constrained columns) pair this fake was asked for. */
  const queries: Array<{ table: string; columns: string[] }> = [];
  const result = (table: any) => {
    const name = nameOf(table);
    const chain: any = {
      where: (condition: unknown) => { queries.push({ table: name, columns: columnsIn(condition) }); return chain; },
      limit: () => chain,
      then: (resolve: (rows: any[]) => unknown) => resolve(rows[name] ?? []),
    };
    return chain;
  };
  const db: any = { select: () => ({ from: (table: any) => result(table) }) };
  db.queries = queries;
  /**
   * Which columns queries against this table constrained, ACCUMULATED across
   * every call - so a test that makes several lookups should compare the
   * distinct set rather than the list.
   */
  db.constrained = (table: string) =>
    queries.filter(query => query.table === table).flatMap(query => query.columns);
  return db;
}

describe('a PROJECT dispute', () => {
  it('names the owner and every LIVE member', async () => {
    const subject = await partiesForSubject(fakeDb(), 'project', PROJECT_ID);
    expect(subject!.principalId).toBe(HOMEOWNER);
    expect(subject!.label).toBe('Villa slab');
    expect(subject!.parties.map(p => p.userId).sort()).toEqual([HOMEOWNER, CONTRACTOR]);
    expect(subject!.parties.find(p => p.userId === HOMEOWNER)!.relation).toBe('project_owner');
  });

  it('a REMOVED member is not a party', async () => {
    /*
     * A member who was removed is no longer a party, and a dispute they raise
     * afterwards is refused.
     *
     * The exclusion happens IN THE QUERY, so the rows a fake returns cannot
     * show it - dropping `isNull(removedAt)` survived a fake that ignored
     * filters. This asserts the query actually constrained that column, and the
     * live probe exercises it against a real database with a real removed row.
     */
    const db = fakeDb();
    const subject = await partiesForSubject(db, 'project', PROJECT_ID);
    expect(subject!.parties.map(p => p.userId)).not.toContain(REMOVED);
    expect(db.constrained('projectMembers'), 'the removal filter is not in the query')
      .toContain('removedAt');
    expect(db.constrained('projectMembers')).toContain('projectId');
  });

  it('a stranger has no relation at all', async () => {
    expect(await relationToSubject(fakeDb(), 'project', PROJECT_ID, STRANGER)).toBeNull();
  });

  it('and is refused with NOT_FOUND, which reveals nothing about the project', async () => {
    // Distinguishing "no such project" from "not yours" tells a stranger the
    // project exists, which is the thing being probed for.
    await expect(requireSubjectParty(fakeDb(), 'project', PROJECT_ID, STRANGER))
      .rejects.toThrow(/not something you can raise a dispute about/i);
  });
});

describe('an RFQ dispute', () => {
  it('a supplier is a party only through an ACT, and each act is named', async () => {
    /*
     * Being able to see the RFQ on the open board is not a relationship. If it
     * were, every supplier on the platform would be a party to every dispute
     * about every RFQ.
     */
    const subject = await partiesForSubject(fakeDb(), 'rfq', RFQ_ID);
    const byUser = new Map(subject!.parties.map(p => [p.userId, p.relation]));
    expect(byUser.get(HOMEOWNER)).toBe('rfq_requester');
    expect(byUser.get(SUPPLIER_QUOTED)).toBe('rfq_quoting_supplier');
    expect(byUser.get(SUPPLIER_ENQUIRED)).toBe('rfq_enquiring_supplier');
    expect(byUser.get(SUPPLIER_INVITED)).toBe('rfq_invited_supplier');
  });

  it('a supplier who did none of the three is NOT a party', async () => {
    expect(await relationToSubject(fakeDb(), 'rfq', RFQ_ID, COMPETITOR)).toBeNull();
  });

  it('the strongest relation is the one recorded', async () => {
    // A supplier who was invited AND quoted is the one who quoted: that is the
    // relation an administrator needs to see, and the weaker one would
    // understate their involvement.
    const db = fakeDb({ rfqSuppliers: [{ userId: SUPPLIER_QUOTED }] });
    const found = await relationToSubject(db, 'rfq', RFQ_ID, SUPPLIER_QUOTED);
    expect(found!.relation).toBe('rfq_quoting_supplier');
  });
});

describe('a QUOTATION dispute has exactly two parties', () => {
  it('the supplier who wrote it and the requester it was written for', async () => {
    const subject = await partiesForSubject(fakeDb(), 'quotation', QUOTATION_ID);
    expect(subject!.parties.map(p => p.userId).sort()).toEqual([HOMEOWNER, SUPPLIER_QUOTED].sort());
  });

  it('AND NOT the other suppliers who bid on the same RFQ', async () => {
    /*
     * THE RULE THIS WHOLE FILE EXISTS FOR. Two suppliers bidding on one RFQ are
     * commercial rivals. The one who lost must not be able to read the dispute
     * the winner is in, or the evidence attached to it. This is the narrowest
     * of the three subjects on purpose.
     *
     * The fixture gives the RFQ FOUR suppliers, so "only two parties" is a real
     * narrowing and not an artefact of there being nobody else. A version of
     * this with one quotation row could not tell the difference.
     */
    const db = fakeDb({
      quotations: [
        { id: QUOTATION_ID, rfqId: RFQ_ID, providerId: SUPPLIER_QUOTED, userId: SUPPLIER_QUOTED },
        { id: 31, rfqId: RFQ_ID, providerId: COMPETITOR, userId: COMPETITOR },
        { id: 32, rfqId: RFQ_ID, providerId: SUPPLIER_ENQUIRED, userId: SUPPLIER_ENQUIRED },
      ],
    });
    const subject = await partiesForSubject(db, 'quotation', QUOTATION_ID);
    expect(subject!.parties).toHaveLength(2);
    for (const rival of [SUPPLIER_INVITED, SUPPLIER_ENQUIRED, COMPETITOR]) {
      expect(subject!.parties.map(p => p.userId), `supplier ${rival} is a rival, not a party`).not.toContain(rival);
      expect(await relationToSubject(db, 'quotation', QUOTATION_ID, rival)).toBeNull();
    }
    /*
     * And every lookup against `quotations` constrained its OWN id and nothing
     * else. A widening to the RFQ's bids would add `rfqId` here - which is
     * exactly the mutation that survived the first version of this fake.
     */
    expect([...new Set(db.constrained('quotations'))]).toEqual(['id']);
  });

  it('a project member is not automatically a party to a quotation', async () => {
    // Different subject, different cast. Membership of the project does not
    // carry through to a bid on an RFQ.
    expect(await relationToSubject(fakeDb(), 'quotation', QUOTATION_ID, CONTRACTOR)).toBeNull();
  });
});

describe('a subject that does not exist', () => {
  it('yields no parties rather than an empty cast that looks valid', async () => {
    expect(await partiesForSubject(fakeDb({ projects: [] }), 'project', PROJECT_ID)).toBeNull();
    expect(await partiesForSubject(fakeDb({ rfqs: [] }), 'rfq', RFQ_ID)).toBeNull();
    expect(await partiesForSubject(fakeDb({ quotations: [] }), 'quotation', QUOTATION_ID)).toBeNull();
  });

  it('and a nonsense id is refused before any query runs', async () => {
    for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      expect(await partiesForSubject(fakeDb(), 'project', id), String(id)).toBeNull();
    }
  });
});

describe('the respondent is chosen from the cast, never typed in', () => {
  it('the candidates are the other parties, with their names', async () => {
    const subject = (await partiesForSubject(fakeDb(), 'rfq', RFQ_ID))!;
    const candidates = await respondentCandidates(fakeDb(), subject, HOMEOWNER);
    expect(candidates.map(c => c.userId).sort()).toEqual([SUPPLIER_QUOTED, SUPPLIER_INVITED, SUPPLIER_ENQUIRED].sort());
    expect(candidates.every(c => typeof c.name === 'string')).toBe(true);
  });

  it('and never the reporter themselves', async () => {
    const subject = (await partiesForSubject(fakeDb(), 'project', PROJECT_ID))!;
    const candidates = await respondentCandidates(fakeDb(), subject, HOMEOWNER);
    expect(candidates.map(c => c.userId)).not.toContain(HOMEOWNER);
  });

  it('a self-dispute is refused', async () => {
    const subject = (await partiesForSubject(fakeDb(), 'project', PROJECT_ID))!;
    expect(() => validateRespondent(subject, HOMEOWNER, HOMEOWNER)).toThrow(/against yourself/i);
  });

  it('a respondent outside the cast is refused', async () => {
    // The client sends this id. Checking it against the real cast is what stops
    // a dispute being filed against an uninvolved account.
    const subject = (await partiesForSubject(fakeDb(), 'project', PROJECT_ID))!;
    expect(() => validateRespondent(subject, HOMEOWNER, COMPETITOR)).toThrow(/someone involved/i);
    expect(() => validateRespondent(subject, HOMEOWNER, STRANGER)).toThrow(/someone involved/i);
  });

  it('naming nobody is allowed - a dispute can be about the situation', async () => {
    const subject = (await partiesForSubject(fakeDb(), 'project', PROJECT_ID))!;
    expect(validateRespondent(subject, HOMEOWNER, null)).toBeNull();
    expect(validateRespondent(subject, HOMEOWNER, undefined)).toBeNull();
  });

  it('a valid respondent passes', async () => {
    const subject = (await partiesForSubject(fakeDb(), 'project', PROJECT_ID))!;
    expect(validateRespondent(subject, HOMEOWNER, CONTRACTOR)).toBe(CONTRACTOR);
  });
});

describe('who may read an existing dispute', () => {
  const dispute = {
    id: 1, reporterId: HOMEOWNER, respondentId: SUPPLIER_QUOTED,
    subjectType: 'quotation', subjectId: QUOTATION_ID,
  };

  it('the reporter and the named respondent, always', async () => {
    expect(await canReadDispute(fakeDb(), dispute, HOMEOWNER)).toBe(true);
    expect(await canReadDispute(fakeDb(), dispute, SUPPLIER_QUOTED)).toBe(true);
  });

  it('a competitor supplier, never', async () => {
    for (const rival of [COMPETITOR, SUPPLIER_INVITED, SUPPLIER_ENQUIRED]) {
      expect(await canReadDispute(fakeDb(), dispute, rival), `supplier ${rival}`).toBe(false);
    }
  });

  it('nor an unrelated account, nor a project member', async () => {
    expect(await canReadDispute(fakeDb(), dispute, STRANGER)).toBe(false);
    expect(await canReadDispute(fakeDb(), dispute, CONTRACTOR)).toBe(false);
  });

  it('the reporter keeps access even after losing their relationship to the subject', async () => {
    // A supplier removed from a project still gets to see the dispute they
    // raised - they are a party to the RECORD, whatever happened to the
    // relationship since. They gain nothing new by it.
    const theirs = { ...dispute, reporterId: REMOVED, respondentId: null, subjectType: 'project', subjectId: PROJECT_ID };
    expect(await canReadDispute(fakeDb(), theirs, REMOVED)).toBe(true);
  });

  it('a party added to the subject LATER can see a dispute about it', async () => {
    // Access is re-derived from the subject rather than frozen on the dispute:
    // a frozen list drifts from reality the first time membership changes.
    const db = fakeDb({ projectMembers: [{ userId: CONTRACTOR }, { userId: STRANGER }] });
    const projectDispute = { ...dispute, subjectType: 'project', subjectId: PROJECT_ID, respondentId: null };
    expect(await canReadDispute(db, projectDispute, STRANGER)).toBe(true);
  });
});

describe('the router routes through the service rather than restating it', () => {
  const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));
  const body = (() => {
    const start = ROUTERS.indexOf('const disputesRouter = router({');
    const end = ROUTERS.indexOf('// ── Provider Portfolio', start);
    return ROUTERS.slice(start, end === -1 ? undefined : end);
  })();

  it('the router body was actually found', () => {
    expect(body).toContain('myDisputes');
    expect(body.length).toBeGreaterThan(500);
  });

  it('create derives eligibility and validates the respondent through the service', () => {
    expect(body).toContain('requireSubjectParty(db, input.subjectType, subjectId, ctx.user.id)');
    expect(body).toContain('validateRespondent(subject, ctx.user.id, input.respondentId ?? null)');
  });

  it('and no longer carries its own copy of the project rule', () => {
    // The inline check was correct for projects and means nothing for an RFQ or
    // a quotation subject; leaving it beside the service would be two rules.
    expect(body).not.toContain("requireProjectAccess(db, input.projectId");
    expect(body).not.toContain('The respondent must be a participant on this project');
  });

  it('reading one dispute goes through the access check', () => {
    expect(body).toContain('requireDisputeAccess(db, input.disputeId, ctx.user.id)');
  });

  /*
   * RESTATED, NOT DROPPED.
   *
   * This asserted that a particular expression appeared in the router's text.
   * The scope now lives in server/disputeMyView.ts - the procedure gained
   * pagination and stopped resolving the subject label one dispute at a time -
   * and the rule itself is asserted BEHAVIOURALLY there, by walking the
   * condition the query actually carries and checking it names both
   * `reporterId` and `respondentId` against the session's own id.
   *
   * That is strictly stronger than this was: a source match could not tell
   * whether the expression was reached, and narrowing the scope to the reporter
   * alone - which would hide from somebody the dispute that NAMES them - is
   * caught there and was not catchable here.
   *
   * What remains here is the one thing behaviour cannot see: that the router
   * delegates rather than restating the scope, and that the user id comes from
   * the session rather than from the input.
   */
  it('myDisputes delegates its scope, and takes the user from the session', () => {
    /*
     * Scoped to THIS PROCEDURE's own text. Asserting over the whole router
     * would have been satisfied - or broken - by any neighbouring procedure
     * that legitimately takes a userId, which is a test that reports on
     * something other than what it names.
     */
    const start = body.indexOf('myDisputes: protectedProcedure');
    const procedure = body.slice(start, body.indexOf('\n    }),', start));
    expect(procedure).toContain('listMyDisputes(db, ctx.user.id, input)');
    // No userId in the input means there is nothing for a caller to tamper with.
    expect(procedure).not.toContain('userId');
  });

  it('the detail view returns the subject LABEL, not its cast', () => {
    // Returning the parties would leak who else bid on an RFQ to somebody who
    // is only in a dispute about it.
    expect(body).toContain('subjectLabel: subject?.label ?? null');
    expect(body).not.toContain('parties: subject');
  });

  it('opening a dispute writes the first history row, so the record starts complete', () => {
    expect(body).toContain("fromStatus: 'none', toStatus: 'open'");
  });
});
