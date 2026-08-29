// ── One intent, two clicks ─────────────────────────────────────────────────
//
// Everything here was found by firing two genuinely concurrent requests at the
// running server and counting rows, not by reading code. The measurements:
//
//   rfq.create        two identical requests, each collecting its own bids
//   submitQuotation   two bids, and the customer notified twice
//   openEnquiry       charged ONCE (the unique index held) but the losing
//                     request returned HTTP 500
//
// The 500 was the most instructive. It was not a duplicate key: InnoDB
// DEADLOCKED, because both transactions take a range lock over the vendor's
// rows for the month and then insert. isDuplicateKeyError correctly said no,
// so the error was rethrown. The money was never at risk; the answer was.
//
// AND THE FIRST FIX WAS NOT ENOUGH, which is the reason these tests assert
// ordering rather than mere presence. A pre-transaction "is there a recent
// identical one?" check reads COMMITTED state, so two concurrent callers both
// see nothing and both insert. With that check in place the probe still
// measured two rows, three runs out of three. Only locking the actor's own
// users row first makes the second caller wait and then see the first.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ROUTERS = read('./routers.ts');
const ENQUIRIES = read('./billing/enquiries.ts');

function procedureBody(name: string, endMarker: string): string {
  const start = ROUTERS.indexOf(name);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const end = ROUTERS.indexOf(endMarker, start);
  return ROUTERS.slice(start, end === -1 ? start + 8000 : end);
}

describe('the deadlock is classified, not swallowed and not rethrown blindly', () => {
  it('a serialization failure is recognised separately from a duplicate key', () => {
    expect(ENQUIRIES).toContain('ER_LOCK_DEADLOCK');
    expect(ENQUIRIES).toContain('ER_LOCK_WAIT_TIMEOUT');
    // Still distinct predicates: conflating them would make a real duplicate
    // take the retry path and a deadlock take the "already consumed" path.
    expect(ENQUIRIES).toContain('function isDuplicateKeyError');
    expect(ENQUIRIES).toContain('function isSerializationFailure');
  });

  it('an unrecognised error is still rethrown', () => {
    // The failure mode to avoid is a catch-all that turns a genuine fault into
    // a cheerful "granted" and a lead nobody was charged for.
    expect(ENQUIRIES).toMatch(/\}\s*else\s*\{\s*\n\s*throw error;/);
  });

  it('after a deadlock it LOOKS rather than assumes', () => {
    // The two outcomes - the other transaction committed, or both rolled back -
    // are distinguished by re-reading, because they need opposite responses.
    const at = ENQUIRIES.indexOf('isSerializationFailure(error)');
    const body = ENQUIRIES.slice(at, at + 2500);
    expect(body).toContain('.select({ id: qualifiedEnquiries.id })');
    expect(body).toMatch(/if \(raced\)/);
  });

  it('and retries at most once, not in a loop', () => {
    const at = ENQUIRIES.indexOf('isSerializationFailure(error)');
    const body = ENQUIRIES.slice(at, at + 3000);
    // Exactly one nested transaction in the recovery path.
    expect([...body.matchAll(/db\.transaction\(/g)]).toHaveLength(1);
  });
});

describe('the duplicate window is narrow and shared', () => {
  it('is defined once, and is seconds rather than minutes', () => {
    const match = ROUTERS.match(/const DUPLICATE_SUBMIT_WINDOW_MS = ([\d_]+);/);
    expect(match, 'the window constant is missing').toBeTruthy();
    const ms = Number(match![1].replace(/_/g, ''));
    expect(ms).toBeGreaterThan(0);
    // Long enough for a double-click or a retry; far too short to swallow a
    // customer deliberately posting a similar request later.
    expect(ms).toBeLessThanOrEqual(30_000);
  });
});

describe('rfq.create cannot lose the race', () => {
  const body = procedureBody('  create: protectedProcedure', '  uploadAttachment:');

  it('takes the requester\'s own users row lock', () => {
    expect(body).toMatch(/select\(\{ id: users\.id \}\)\.from\(users\)\.where\(eq\(users\.id, ctx\.user\.id\)\)\.for\('update'\)/);
  });

  it('and takes it BEFORE reading for a recent identical request', () => {
    // The ordering IS the fix. Reading first is what measured two rows.
    const lock = body.indexOf(".for('update')");
    const check = body.indexOf('recentIdentical');
    expect(lock).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(-1);
    expect(lock, 'the lock must precede the duplicate check').toBeLessThan(check);
  });

  it('and the check and the insert are in the SAME transaction', () => {
    const tx = body.indexOf('db.transaction');
    const lock = body.indexOf(".for('update')");
    const insert = body.indexOf('insert(rfqs)');
    expect(tx).toBeLessThan(lock);
    expect(lock).toBeLessThan(insert);
  });

  it('a de-duplicated create returns the same shape as a real one', () => {
    // So no caller has to learn a second response type, and a double-click
    // looks to the customer like the single success it was.
    expect(body).toMatch(/if \(recentIdentical\) return recentIdentical\.id;/);
  });
});

describe('submitQuotation cannot lose the race either', () => {
  const body = procedureBody('  submitQuotation: approvedProviderProcedure', '  acceptQuotation:');

  it('takes the SAME lock on the SAME table as rfq.create', () => {
    // Consistent lock ordering across the two paths. The enquiry path
    // deadlocked precisely because overlapping locks were taken in different
    // orders, and repeating that here would trade one bug for another.
    expect(body).toMatch(/select\(\{ id: users\.id \}\)\.from\(users\)\.where\(eq\(users\.id, ctx\.user\.id\)\)\.for\('update'\)/);
  });

  it('takes it before the duplicate check, inside the transaction', () => {
    const tx = body.indexOf('db.transaction');
    const lock = body.indexOf(".for('update')");
    const check = body.indexOf('recentIdentical');
    const insert = body.indexOf('insert(quotations)');
    expect(tx).toBeLessThan(lock);
    expect(lock).toBeLessThan(check);
    expect(check).toBeLessThan(insert);
  });

  it('matches on PRICE, so a revised bid is not mistaken for a double-click', () => {
    // The open OWNER DECISION - may a supplier hold several bids on one RFQ,
    // and is a second one a revision? - is untouched. A bid with different
    // terms still goes through. Only the same offer twice in seconds is caught,
    // and nobody revises a bid to the number it already was.
    expect(body).toContain('eq(quotations.price, String(input.price))');
    expect(body).toContain('eq(quotations.rfqId, input.rfqId)');
    expect(body).toContain('eq(quotations.providerId, ctx.user.id)');
  });

  it('a de-duplicated submission notifies nobody and audits nothing', () => {
    // The failure this prevents: the customer told twice about one bid, and the
    // funnel counting one offer as two.
    const guard = body.indexOf('if (submission.deduplicated) return');
    const notify = body.indexOf('notifyUser(db,');
    // THE CALL, not the identifier. Searching for the bare name matched the
    // comment "See the note beside recordCommercialEvent below" and reported
    // the audit write as happening before the guard - asserting against prose,
    // which is the anti-pattern the comment stripping in this suite exists to
    // prevent.
    const audit = body.indexOf('recordCommercialEvent(db,');
    expect(guard).toBeGreaterThan(-1);
    expect(guard, 'the early return must come before the notification').toBeLessThan(notify);
    expect(guard, 'and before the audit write').toBeLessThan(audit);
  });
});

describe('the paths that were already safe stayed safe', () => {
  it('accept and close serialize on the RFQ row, not the user row', () => {
    const workflow = read('./quotationWorkflow.ts');
    // Their contention is per-request, not per-person: two people accepting on
    // one RFQ is the race, and the RFQ row is the right thing to lock.
    for (const fn of ['acceptQuotationSecure', 'rejectQuotationSecure', 'closeRfqSecure']) {
      const at = workflow.indexOf(`export async function ${fn}`);
      const body = workflow.slice(at, at + 1200);
      expect(body, `${fn} must lock the RFQ row`).toMatch(/from\(rfqs\)[\s\S]*?\.for\('update'\)/);
    }
  });
});
