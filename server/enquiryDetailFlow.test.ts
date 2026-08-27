// ── The credit has to buy something visible ────────────────────────────────
//
// CLOSURE PART 6, the "View Details" audit. The supplier flow was:
//
//   Qualified Enquiries -> View details -> rfq.openEnquiry -> a TOAST.
//
// The server returns the full RFQ in that same response - it is the vendor's
// authorized copy, and the only one they can get, because rfq.get is scoped to
// the requester. The client discarded it. So a vendor spent a lead credit, was
// told "opened", and saw exactly what they saw before.
//
// This file pins both halves: the server still returns the record, and the
// client still renders it.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const ROUTERS = read('./routers.ts');
const COMPONENT_RAW = read('../client/src/components/QualifiedEnquiries.tsx');
/** Comments stripped: an explanation naming what was removed trips a source assertion. */
const COMPONENT = COMPONENT_RAW.split('\n').filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*')).join('\n');
const CONTEXT = read('../client/src/contexts/LanguageContext.tsx');
const STORAGE_PROXY = read('./_core/storageProxy.ts');

describe('the server hands the vendor the record they paid for', () => {
  it('openEnquiry returns the RFQ on a granted outcome', () => {
    const start = ROUTERS.indexOf('  openEnquiry: approvedProviderProcedure');
    expect(start).toBeGreaterThan(-1);
    const body = ROUTERS.slice(start, ROUTERS.indexOf('  submitQuotation:', start));
    expect(body).toContain("case 'granted':");
    expect(body).toContain('return { rfq: result.rfq');
  });

  it('and it is the ONLY way a vendor can read that detail', () => {
    // rfq.get is requester-scoped, so "just fetch it separately" is not an
    // option the client had. That is why discarding the response mattered.
    const start = ROUTERS.indexOf('\n  get: protectedProcedure', ROUTERS.indexOf('const rfqRouter = router({'));
    expect(start).toBeGreaterThan(-1);
    const body = ROUTERS.slice(start, start + 1500);
    expect(body).toMatch(/requesterId[^;]*ctx\.user\.id|ctx\.user\.id[^;]*requesterId/);
  });
});

describe('the client renders it instead of dropping it', () => {
  it('REGRESSION: the granted RFQ is kept, not discarded', () => {
    expect(COMPONENT).toContain('setDetail(result.rfq');
  });

  it('it is shown in a dialog, not only announced in a toast', () => {
    expect(COMPONENT).toContain('<Dialog');
    expect(COMPONENT).toContain('DialogTitle');
    // The toast stays - it is the confirmation that a credit was or was not
    // spent - but it is no longer the whole outcome.
    expect(COMPONENT).toContain('toast.success');
  });

  it('the dialog shows the fields a vendor needs to decide whether to bid', () => {
    for (const field of ['detail?.title', 'detail.description', 'detail.budget', 'detail.location', 'detail.deadline']) {
      expect(COMPONENT, `${field} is not rendered`).toContain(field);
    }
  });

  it('it does not try to refetch through the requester-scoped endpoint', () => {
    // Calling rfq.get here would 403 for every vendor, every time.
    expect(COMPONENT).not.toContain('rfq.get');
  });

  it('malformed attachments cannot throw inside the render', () => {
    // The column is JSON-encoded text: a driver may hand it back parsed or
    // raw, and it may be absent. A parse failure must yield no attachments,
    // not a blank screen.
    expect(COMPONENT).toContain('function parseAttachments');
    expect(COMPONENT).toContain('catch { return []; }');
    expect(COMPONENT).toContain('Array.isArray(value) ? value');
  });

  it('showing attachments is something the proxy will actually allow', () => {
    // Rendering links to files the server then refuses would be worse than
    // showing nothing. The proxy grants an RFQ attachment to a vendor with a
    // qualifiedEnquiries row for that RFQ - which this vendor now has.
    const start = STORAGE_PROXY.indexOf("key.startsWith('rfq-attachments/')");
    expect(start).toBeGreaterThan(-1);
    const block = STORAGE_PROXY.slice(start, start + 1200);
    expect(block).toContain('qualifiedEnquiries');
    expect(block).toContain('eq(qualifiedEnquiries.userId, user.id)');
  });
});

describe('the new copy exists in both languages', () => {
  for (const key of ['enquiries.attachments', 'enquiries.detailNote']) {
    it(`${key} is translated`, () => {
      const occurrences = CONTEXT.split(`'${key}':`).length - 1;
      expect(occurrences, 'expected one English and one Arabic entry').toBe(2);
    });
  }

  it('the Arabic entries are in Arabic', () => {
    for (const key of ['enquiries.attachments', 'enquiries.detailNote']) {
      const matches = CONTEXT.split(`'${key}': '`).slice(1).map(part => part.slice(0, part.indexOf("'")));
      expect(matches).toHaveLength(2);
      expect(matches[1], `${key} Arabic`).toMatch(/[؀-ۿ]/);
      expect(matches[1]).not.toBe(matches[0]);
    }
  });
});
