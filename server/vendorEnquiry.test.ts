/**
 * THE RECONCILIATION, ASSERTED.
 *
 * The decision this file protects is architectural, not cosmetic: a vendor
 * enquiry is DERIVED from rfqs + rfqSuppliers + qualifiedEnquiries + quotations,
 * not stored in a fifth table. If somebody later adds a status column, the
 * Admin view and the vendor view can disagree about the same RFQ - and the one
 * that disagrees will be the one nobody is looking at.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ENQUIRY_STATES,
  RFQ_STATUSES,
  deriveEnquiryState,
  enquiryReference,
  gatherEnquiryEvidence,
  isAwaitingVendor,
  parseEnquiryReference,
  usageReason,
  type EnquiryEvidence,
} from './vendorEnquiry';

const evidence = (over: Partial<EnquiryEvidence> = {}): EnquiryEvidence => ({
  rfqStatus: 'open', invitationStatus: null, creditSpent: false, hasQuotation: false, ...over,
});

// ── The architectural decision ─────────────────────────────────────────────

describe('a vendor enquiry is derived, never stored twice', () => {
  it('THERE IS NO vendorEnquiries TABLE, and adding one must be deliberate', () => {
    const schema = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');
    expect(schema).not.toContain("mysqlTable('vendorEnquiries'");
    // The four tables the state IS derived from must all still exist.
    for (const table of ['rfqs', 'rfqSuppliers', 'qualifiedEnquiries', 'quotations']) {
      expect(schema, `${table} is one of the four sources`).toContain(`mysqlTable('${table}'`);
    }
  });

  it('qualifiedEnquiries stays a BILLING record with no workflow status', () => {
    // Overloading it would put a charge record and a conversation state in one
    // row, and the first "just reset the status" would destroy billing history.
    const schema = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');
    const start = schema.indexOf("export const qualifiedEnquiries");
    const block = schema.slice(start, schema.indexOf('}));', start));
    expect(block).not.toMatch(/\bstatus:/);
  });

  it('the RFQ status enum has not drifted from what this module assumes', () => {
    // If the enum gains a terminal value, TERMINAL_RFQ_STATUSES must learn it,
    // or a closed enquiry will read as AVAILABLE.
    const schema = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');
    const start = schema.indexOf("export const rfqs = mysqlTable");
    const block = schema.slice(start, schema.indexOf('}));', start));
    const match = /status:\s*mysqlEnum\('status',\s*\[([^\]]+)\]/.exec(block);
    expect(match, 'the rfqs.status enum must be findable').not.toBeNull();
    const declared = match![1].split(',').map(s => s.trim().replace(/['"]/g, ''));
    expect(declared.sort()).toEqual([...RFQ_STATUSES].sort());
  });
});

// ── The derivation ─────────────────────────────────────────────────────────

describe('the state is derived from the strongest evidence available', () => {
  it('an untouched open RFQ is AVAILABLE', () => {
    expect(deriveEnquiryState(evidence())).toBe('AVAILABLE');
  });

  it('an invitation makes it INVITED', () => {
    expect(deriveEnquiryState(evidence({ invitationStatus: 'invited' }))).toBe('INVITED');
  });

  it('a viewed invitation makes it VIEWED', () => {
    expect(deriveEnquiryState(evidence({ invitationStatus: 'viewed' }))).toBe('VIEWED');
  });

  it('a spent credit makes it OPENED', () => {
    expect(deriveEnquiryState(evidence({ creditSpent: true }))).toBe('OPENED');
  });

  it('an invitation marked responded is OPENED even with no credit row', () => {
    // The invitation exemption: an invited supplier spends nothing, so the
    // absence of a qualifiedEnquiries row is expected rather than suspicious.
    expect(deriveEnquiryState(evidence({ invitationStatus: 'responded' }))).toBe('OPENED');
  });

  it('a quotation makes it RESPONDED, outranking everything', () => {
    expect(deriveEnquiryState(evidence({
      hasQuotation: true, invitationStatus: 'invited', creditSpent: true,
    }))).toBe('RESPONDED');
  });

  it('A RESPONDED ENQUIRY STAYS RESPONDED AFTER THE RFQ CLOSES', () => {
    // An administrator looking at a closed or awarded RFQ still needs to see
    // WHICH vendors answered it. Collapsing them all to CLOSED would erase the
    // most useful fact on the page.
    for (const rfqStatus of ['closed', 'awarded']) {
      expect(deriveEnquiryState(evidence({ hasQuotation: true, rfqStatus })), rfqStatus)
        .toBe('RESPONDED');
    }
  });

  it('a declined invitation is DECLINED, not merely absent', () => {
    expect(deriveEnquiryState(evidence({ invitationStatus: 'declined' }))).toBe('DECLINED');
  });

  it('a declined invitation stays DECLINED even after the RFQ closes', () => {
    expect(deriveEnquiryState(evidence({ invitationStatus: 'declined', rfqStatus: 'closed' })))
      .toBe('DECLINED');
  });

  it('a closed or awarded RFQ closes an enquiry nobody answered', () => {
    expect(deriveEnquiryState(evidence({ rfqStatus: 'closed' }))).toBe('CLOSED');
    expect(deriveEnquiryState(evidence({ rfqStatus: 'awarded' }))).toBe('CLOSED');
    // Even one that had been opened - the credit is spent, but the vendor can
    // no longer act, and showing OPENED would invite them to try.
    expect(deriveEnquiryState(evidence({ rfqStatus: 'closed', creditSpent: true }))).toBe('CLOSED');
  });

  it('every declared state is reachable from some evidence', () => {
    // A state nothing can produce is a filter that always returns nothing.
    const reached = new Set([
      deriveEnquiryState(evidence()),
      deriveEnquiryState(evidence({ invitationStatus: 'invited' })),
      deriveEnquiryState(evidence({ invitationStatus: 'viewed' })),
      deriveEnquiryState(evidence({ creditSpent: true })),
      deriveEnquiryState(evidence({ hasQuotation: true })),
      deriveEnquiryState(evidence({ invitationStatus: 'declined' })),
      deriveEnquiryState(evidence({ rfqStatus: 'closed' })),
    ]);
    expect([...reached].sort()).toEqual([...ENQUIRY_STATES].sort());
  });

  it('awaiting-vendor means the same thing everywhere it is counted', () => {
    expect(ENQUIRY_STATES.filter(isAwaitingVendor)).toEqual(['INVITED', 'VIEWED', 'OPENED']);
  });
});

// ── Usage attribution ──────────────────────────────────────────────────────

describe('why a credit was or was not spent', () => {
  it('a spent credit is a vendor open', () => {
    expect(usageReason(evidence({ creditSpent: true }))).toBe('VENDOR_OPEN');
  });

  it('an invited vendor is exempt, which is why there is no credit row', () => {
    expect(usageReason(evidence({ invitationStatus: 'invited' }))).toBe('INVITATION_EXEMPT');
  });

  it('a quotation with no credit row can only have come from an exemption', () => {
    expect(usageReason(evidence({ hasQuotation: true }))).toBe('INVITATION_EXEMPT');
  });

  it('an untouched enquiry consumed nothing', () => {
    expect(usageReason(evidence())).toBe('NOT_OPENED');
  });
});

// ── The human reference ────────────────────────────────────────────────────

describe('an enquiry has a human reference, not a database id', () => {
  it('is built from the pair it identifies', () => {
    expect(enquiryReference(501, 10)).toBe('ENQ-501-10');
  });

  it('round-trips', () => {
    expect(parseEnquiryReference(enquiryReference(501, 10))).toEqual({ rfqId: 501, vendorId: 10 });
  });

  it('tolerates surrounding whitespace and case, as pasted from a ticket', () => {
    expect(parseEnquiryReference('  enq-7-3  ')).toEqual({ rfqId: 7, vendorId: 3 });
  });

  it('rejects anything malformed rather than guessing', () => {
    for (const bad of ['', 'ENQ-', 'ENQ-1', 'ENQ-0-1', 'ENQ-1-0', 'ENQ--1-2', 'RFQ-1-2', 'ENQ-a-b']) {
      expect(parseEnquiryReference(bad), bad).toBeNull();
    }
  });
});

// ── Batching ───────────────────────────────────────────────────────────────

describe('evidence is gathered in a bounded number of queries', () => {
  function makeDb(rows: Record<string, unknown[]>) {
    let queries = 0;
    const bound: unknown[][] = [];
    /**
     * drizzle renders `inArray` as a queryChunk holding an ARRAY OF PARAM
     * OBJECTS, each with a numeric `.value` - not as a bare number[]. The first
     * version of this collector guessed the latter, found nothing, and the test
     * failed on its own instrument rather than on the code. The shape below was
     * read off a real condition, not assumed.
     */
    const collectIds = (condition: unknown): void => {
      const seenNodes = new Set<unknown>();
      const walk = (node: any) => {
        if (node == null || typeof node !== 'object') return;
        if (seenNodes.has(node)) return;
        seenNodes.add(node);
        if (Array.isArray(node)) {
          const values = node.map(entry => (entry && typeof entry === 'object' ? entry.value : undefined));
          if (values.length > 0 && values.every(v => typeof v === 'number')) {
            bound.push(values as number[]);
            return;
          }
          return node.forEach(walk);
        }
        for (const value of Object.values(node)) walk(value);
      };
      walk(condition);
    };
    const db: any = {
      select: () => ({
        from: (table: unknown) => ({
          where: (condition: unknown) => {
            queries += 1;
            collectIds(condition);
            const name = (table as { _?: { name?: string } })?._?.name ?? '';
            return Promise.resolve(rows[name] ?? []);
          },
        }),
      }),
    };
    return { db, count: () => queries, boundIdLists: () => bound };
  }

  it('issues FOUR queries for one pair and FOUR for a hundred', async () => {
    // The shape that matters at scale: one query per row is fine on a demo and
    // unopenable on a real marketplace.
    const one = makeDb({});
    await gatherEnquiryEvidence(one.db, [{ rfqId: 1, vendorId: 2 }]);
    expect(one.count()).toBe(4);

    const many = makeDb({});
    const pairs = Array.from({ length: 100 }, (_unused, i) => ({ rfqId: i + 1, vendorId: 10 }));
    await gatherEnquiryEvidence(many.db, pairs);
    expect(many.count()).toBe(4);
  });

  it('DE-DUPLICATES the ids it binds, so one vendor on fifty rows is bound once', async () => {
    // Not a correctness rule - duplicate ids in an IN list return the same
    // rows - but a real scale property: a fifty-row page about one vendor
    // should not send that vendor's id fifty times, three times over.
    const { db, boundIdLists } = makeDb({});
    const pairs = Array.from({ length: 50 }, (_unused, i) => ({ rfqId: i + 1, vendorId: 10 }));
    await gatherEnquiryEvidence(db, pairs);
    const lists = boundIdLists();
    expect(lists.length, 'the sweep must have observed some bound id lists').toBeGreaterThan(0);
    for (const list of lists) {
      expect(new Set(list).size, `bound list ${JSON.stringify(list).slice(0, 40)} has duplicates`)
        .toBe(list.length);
    }
  });

  it('issues NO query at all for an empty page', async () => {
    const none = makeDb({});
    expect(await gatherEnquiryEvidence(none.db, [])).toEqual(new Map());
    expect(none.count()).toBe(0);
  });

  it('returns honest evidence when a pair has no rows anywhere', async () => {
    const { db } = makeDb({});
    const found = await gatherEnquiryEvidence(db, [{ rfqId: 1, vendorId: 2 }]);
    expect(found.get('1:2')).toEqual({
      rfqStatus: null, invitationStatus: null, creditSpent: false, hasQuotation: false,
    });
    expect(deriveEnquiryState(found.get('1:2')!)).toBe('AVAILABLE');
  });
});
