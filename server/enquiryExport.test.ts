/**
 * THE CSV IS WHERE CAREFUL DATA HANDLING GOES TO DIE.
 *
 * Three failures are near-certain in real data and invisible in a demo: an RFQ
 * title containing a comma shifts every later column; one containing a quote
 * mark corrupts the row; and a vendor name beginning with `=` is executed as a
 * formula the moment somebody opens the file. All three are attacker- or
 * customer-controlled text on this platform.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BULK_ASSIGN_LIMIT, ENQUIRY_EXPORT_LIMIT, iso, toCsvRow } from './vendorEnquiryQuery';

describe('a CSV row survives the text real customers type', () => {
  it('a comma inside a field does not shift the columns', () => {
    const row = toCsvRow(['ENQ-1-2', 'Rebar, grade 60, delivered']);
    expect(row).toBe('"ENQ-1-2","Rebar, grade 60, delivered"');
  });

  it('a quotation mark is escaped, not left to end the field', () => {
    expect(toCsvRow(['6" pipe'])).toBe('"6"" pipe"');
  });

  it('a newline inside a field stays inside its quotes', () => {
    expect(toCsvRow(['line one\nline two'])).toBe('"line one\nline two"');
  });

  it('FORMULA INJECTION IS DEFUSED - a vendor name is attacker-controlled text', () => {
    // Without the leading apostrophe a spreadsheet executes this on open.
    for (const dangerous of ['=1+1', '+1', '-1', '@SUM(A1)']) {
      expect(toCsvRow([dangerous]), dangerous).toBe(`"'${dangerous}"`);
    }
    // And an ordinary value is NOT mangled by the defence.
    expect(toCsvRow(['Alpha Concrete'])).toBe('"Alpha Concrete"');
  });

  it('null and undefined become empty, never the strings "null" or "undefined"', () => {
    expect(toCsvRow([null, undefined as never, 0])).toBe('"","","0"');
  });
});

describe('timestamps are stable or absent, never "Invalid Date"', () => {
  it('formats a real date as ISO', () => {
    expect(iso(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z');
  });

  it('an absent or broken date is empty', () => {
    expect(iso(null)).toBe('');
    expect(iso(undefined)).toBe('');
    expect(iso(new Date('nonsense'))).toBe('');
  });
});

describe('the limits are real and low enough to matter', () => {
  it('a bulk assignment is bounded', () => {
    expect(BULK_ASSIGN_LIMIT).toBeGreaterThan(0);
    expect(BULK_ASSIGN_LIMIT).toBeLessThanOrEqual(100);
  });

  it('an export is bounded', () => {
    expect(ENQUIRY_EXPORT_LIMIT).toBeGreaterThan(0);
    expect(ENQUIRY_EXPORT_LIMIT).toBeLessThanOrEqual(10000);
  });
});

describe('what bulk may and may not do', () => {
  const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');

  it('THE ONLY BULK ACTION IS ASSIGNMENT', () => {
    // Bulk close would close RFQs and end hundreds of other vendors' work with
    // no undo; bulk invite would notify vendors the requester never chose.
    // Assignment is reversible, append-only, and touches no customer state.
    // Scoped to ENQUIRY bulk actions. The router also has
    // bulkUpdateApplicantStatus, which is the registration queue and predates
    // this work - the first version of this assertion swept every `bulk*` in
    // the file and failed on it, which was the test being wrong about its own
    // subject rather than a finding.
    const bulk = [...ROUTERS.matchAll(/^ {2}(bulk\w*Enquir\w+): /gm)].map(m => m[1]);
    expect(bulk).toEqual(['bulkAssignEnquiries']);
    for (const forbidden of ['bulkCloseEnquiries', 'bulkInviteEnquiries', 'bulkAdjustAllowance']) {
      expect(ROUTERS, `${forbidden} must not exist`).not.toContain(`  ${forbidden}:`);
    }
  });

  it('the export carries no bid price, and says so by carrying no price column', () => {
    const start = ROUTERS.indexOf('  exportEnquiries: adminWith(');
    const rest = ROUTERS.slice(start + 1);
    const next = rest.search(/^ {2}\w+: (adminWith|superAdminProcedure|adminProcedure)/m);
    const body = next === -1 ? rest : rest.slice(0, next);
    for (const forbidden of ['price', 'currency', 'paymentTerms', 'commercialTerms']) {
      expect(body.toLowerCase(), `the export must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('and an export is recorded on the ADMINISTRATOR, not on an RFQ it is not about', () => {
    // The first version recorded it in commercialAuditEvents as
    // subjectType 'rfq' with `input?.rfqId ?? 0`. commercialAudit.test.ts
    // rejected it, correctly: that trail's rule is that subjectId always names a
    // row in the table subjectType names, and 0 names nothing. An export is
    // about no single RFQ, so it belongs on the administrator's own activity -
    // the shape userAccountAuditEvents already uses for 'admin_signed_in'.
    const start = ROUTERS.indexOf('  exportEnquiries: adminWith(');
    const body = ROUTERS.slice(start, start + 4500);
    expect(body).toContain('userAccountAuditEvents');
    expect(body).toContain("action: 'enquiries_exported'");
    expect(body).not.toContain('recordCommercialEvent');
  });
});
