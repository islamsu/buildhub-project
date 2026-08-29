// ── One RFQ, reconstructed (Parts 41 and 52) ───────────────────────────────
//
// BuildHub could already answer every fragment of "who did what, when, to which
// record, from what value to what value" - the commercial audit here, the
// notifications there, the quotations somewhere else - and could not answer the
// question, which is what an administrator actually has in front of them when a
// customer and a supplier disagree.
//
// The two properties that matter about the answer:
//
//   IT CROSSES EVERY OWNERSHIP BOUNDARY AT ONCE. Two parties' private messages,
//   every competing bid's price, the whole audit trail. That is exactly why it
//   is Super Admin only and why widening it is a decision for the owner.
//
//   IT MUST NOT CARRY A CREDENTIAL. Part 53 forbids surfacing a password hash,
//   a live invitation token or a provider key even to a Super Admin. `users`
//   holds all three, and a bare select().from(users) has leaked them twice in
//   this file's history - which is why the allowlist is asserted here rather
//   than trusted.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));
const at = ROUTERS.indexOf('  rfqInvestigation: superAdminProcedure');
const BODY = ROUTERS.slice(at, ROUTERS.indexOf('\n  vendorEnquiryAllowance:', at));

describe('the investigation exists and is reachable only by a Super Admin', () => {
  it('is registered as a procedure', () => {
    expect(at, 'rfqInvestigation not found').toBeGreaterThan(-1);
    expect(BODY.length, 'the slice is empty - the extraction is wrong').toBeGreaterThan(500);
  });

  it('is superAdminProcedure, not a sub-admin permission', () => {
    // Part 41 names Super Admin; Part 51 warns against sub-admins acquiring
    // Super Admin reach. This read is the widest in the product.
    expect(ROUTERS).toMatch(/rfqInvestigation: superAdminProcedure/);
    expect(BODY).not.toMatch(/adminWith\(/);
    expect(BODY).not.toMatch(/protectedProcedure|publicProcedure/);
  });

  it('a request that does not exist is NOT_FOUND, not an empty timeline', () => {
    // An empty result would read as "nothing ever happened to this RFQ",
    // which is a different and much more dangerous answer than "no such RFQ".
    expect(BODY).toContain("code: 'NOT_FOUND', message: 'Request not found'");
  });
});

describe('Part 53: not one credential reaches the administrator', () => {
  it('every party goes through an explicit column allowlist', () => {
    expect(BODY).toContain('INVESTIGATION_PARTY_COLUMNS');
    expect(BODY).not.toMatch(/select\(\)\s*\n?\s*\.from\(users\)/);
  });

  it('and that allowlist contains no credential, token or secret', () => {
    const start = ROUTERS.indexOf('const INVESTIGATION_PARTY_COLUMNS = {');
    expect(start).toBeGreaterThan(-1);
    const columns = ROUTERS.slice(start, ROUTERS.indexOf('} as const;', start));
    for (const forbidden of [
      'passwordHash', 'password', 'invitationToken', 'openId', 'resetToken',
      'tokenHash', 'loginMethod',
    ]) {
      expect(columns, `${forbidden} must not be returned`).not.toContain(forbidden);
    }
    // POSITIVE CONTROL: it must actually carry enough to identify a party, or
    // the assertions above would pass on an empty object.
    for (const expected of ['id: users.id', 'name: users.name', 'userRole: users.userRole']) {
      expect(columns).toContain(expected);
    }
  });

  it('the quotation columns are named, so a later schema column is not auto-exposed', () => {
    expect(BODY).toContain('id: quotations.id');
    expect(BODY).toContain('price: quotations.price');
    expect(BODY).not.toMatch(/select\(\)\s*\n?\s*\.from\(quotations\)/);
  });

  it('the notification columns exclude the rendered body', () => {
    // messageKey and link are what an investigator needs - which event, and
    // where it pointed. The prose adds nothing and is stored per recipient.
    expect(BODY).toContain('messageKey: notifications.messageKey');
    expect(BODY).toContain('link: notifications.link');
    expect(BODY).not.toContain('body: notifications.body');
  });
});

describe('the timeline actually contains what a dispute needs', () => {
  it('the request, the parties, the bids and the enquiries opened on it', () => {
    for (const key of ['rfq,', 'parties,', 'enquiries,', 'quotations: bids,']) {
      expect(BODY, `the response must return ${key}`).toContain(key);
    }
  });

  it('the OLD and NEW values, for the request AND for every bid on it', () => {
    // The whole point of Part 42. An audit action string saying
    // "quotation_submitted" cannot answer "what was the price before".
    expect(BODY).toContain("readFieldHistory(db, 'rfq', [input.rfqId])");
    expect(BODY).toContain("readFieldHistory(db, 'quotation', bidIds)");
    expect(BODY).toContain('history: { rfq: rfqHistory, quotations: quotationHistory }');
  });

  it('the audit trail for the request and for its bids, in one ordered sequence', () => {
    expect(BODY).toContain("eq(commercialAuditEvents.subjectType, 'rfq')");
    expect(BODY).toContain("eq(commercialAuditEvents.subjectType, 'quotation')");
    expect(BODY).toContain('.sort((a, b) => a.id - b.id)');
  });

  it('the conversation between the parties, and only between the parties', () => {
    // Both ends constrained. Filtering on sender alone would pull in every
    // message those people ever sent to anyone.
    expect(BODY).toContain('inArray(messages.senderId, partyIds)');
    expect(BODY).toContain('inArray(messages.receiverId, partyIds)');
  });

  it('the notifications this request generated, scoped to it', () => {
    // Not every notification these people ever received - only the ones whose
    // deep link points at this request or at a bid on it.
    expect(BODY).toContain('inArray(notifications.userId, partyIds)');
    expect(BODY).toContain('`/rfq/${input.rfqId}`');
    expect(BODY).toContain('`/quotations/${id}`');
  });

  it('and the commercial figures, computed rather than described', () => {
    for (const field of ['budget', 'bidCount', 'lowestBid', 'highestBid', 'acceptedValue']) {
      expect(BODY, `commercial.${field}`).toContain(field);
    }
  });
});

describe('the query does not fall over on an RFQ with no bids', () => {
  it('every bid-keyed lookup is guarded against an empty id list', () => {
    // inArray with an empty array is a SQL syntax error in MySQL, and an RFQ
    // with no quotations is the NORMAL state for a request just posted - the
    // one an administrator is most likely to open first.
    expect(BODY.match(/bidIds\.length === 0 \? Promise\.resolve\(\[\]\)/g) ?? []).toHaveLength(2);
    expect(BODY).toContain('partyIds.length === 0 ? Promise.resolve([])');
    expect(BODY).toContain('partyIds.length < 2 ? Promise.resolve([])');
    expect(BODY).toContain("bidIds.length ? sql.join(");
  });
});
