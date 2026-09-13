/**
 * ── A PRICE THAT STOPPED HOLDING ──────────────────────────────────────────
 *
 * `validUntil` is REQUIRED on every quotation, stored, rendered on the
 * comparison screen and pinned in the field history. It was enforced nowhere.
 *
 * Proven against the running product before any of this was written: a
 * quotation whose validity ended on 1 January was accepted on 12 September,
 * its status moved to `accepted`, every other bid on the request was
 * auto-rejected around it, and nothing had told the customer the price was
 * months stale. A supplier who writes "this holds until 1 October" means it.
 *
 * Three rules pinned here:
 *
 *   THE ACT REFUSES IT, inside the transaction and after the row lock, beside
 *   the status check - both are statements about the row at the moment of the
 *   decision.
 *
 *   THE SCREEN DOES NOT OFFER IT, which is the ELIG rule applied to the other
 *   commercial button: a control certain to fail costs a click and teaches
 *   distrust. Rejecting an expired bid is still offered, because clearing a
 *   stale price off the board is a reasonable thing to do.
 *
 *   AND "BEST VALUE" IS NOT AN EXPIRED BID. A ribbon recommending the one card
 *   whose accept button is missing is worse than no recommendation.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  canAcceptQuotation, isQuotationExpired, validityEndsAt, QUOTATION_EXPIRED_MESSAGE,
} from '../shared/quotationValidity';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const WORKFLOW = readSourceForAssertions(read('./quotationWorkflow.ts'));
const ROUTERS = readSourceForAssertions(read('./routers.ts'));
const COMPARISON = readSourceForAssertions(read('../client/src/components/QuotationComparison.tsx'));
const LANG = read('../client/src/contexts/LanguageContext.tsx');

function between(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  expect(start, `start marker is gone: ${startMarker}`).toBeGreaterThan(-1);
  const end = text.indexOf(endMarker, start);
  expect(end, `end marker is gone or above the start: ${endMarker}`).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe('when a price stops holding', () => {
  const noon = (iso: string) => new Date(`${iso}T12:00:00`);

  it('THE DAY IS INCLUSIVE — "valid until 1 October" covers the whole of it', () => {
    // The submission rule accepts a validity of TODAY, comparing against
    // midnight at the start of the day. A reader that expired it at 00:00
    // would refuse on the morning of a date the writer had just been allowed
    // to enter, which is the same rule disagreeing with itself.
    expect(isQuotationExpired('2026-10-01', noon('2026-10-01'))).toBe(false);
    expect(isQuotationExpired('2026-10-01', new Date('2026-10-01T23:59:59'))).toBe(false);
    expect(isQuotationExpired('2026-10-01', new Date('2026-10-02T00:00:01'))).toBe(true);
  });

  it('and the end of validity is the end of that day', () => {
    const ends = validityEndsAt('2026-10-01');
    expect(ends?.getHours()).toBe(23);
    expect(ends?.getMinutes()).toBe(59);
  });

  it('a quotation with NO validity date is not expired', () => {
    // Nothing can write one today - the field is required - but historical
    // rows predate that rule, and treating a missing date as expired would
    // retire bids nobody withdrew.
    expect(isQuotationExpired(null)).toBe(false);
    expect(isQuotationExpired(undefined)).toBe(false);
    expect(validityEndsAt(null)).toBeNull();
  });

  it('and an unparseable one is not expired either, rather than NaN-expired', () => {
    expect(isQuotationExpired('not a date')).toBe(false);
  });

  it('ACCEPTABILITY IS STATUS AND VALIDITY TOGETHER', () => {
    const live = { status: 'pending', validUntil: '2026-10-01' };
    expect(canAcceptQuotation(live, noon('2026-09-30'))).toBe(true);
    expect(canAcceptQuotation(live, noon('2026-10-02'))).toBe(false);
    expect(canAcceptQuotation({ status: 'rejected', validUntil: '2026-10-01' }, noon('2026-09-30'))).toBe(false);
    expect(canAcceptQuotation({ status: 'accepted', validUntil: '2026-10-01' }, noon('2026-09-30'))).toBe(false);
  });
});

describe('the act refuses an expired price', () => {
  it('checks validity inside the transaction, beside the status check', () => {
    const accept = between(WORKFLOW, 'export async function acceptQuotationSecure', 'export async function rejectQuotationSecure');
    expect(accept).toContain('isQuotationExpired(quotation.validUntil)');
    expect(accept).toContain('QUOTATION_EXPIRED_MESSAGE');
    // AFTER the lock and the status check, not before the row is even read.
    const lock = accept.indexOf(".for('update')");
    const check = accept.indexOf('isQuotationExpired');
    expect(lock, 'the quotation is no longer locked').toBeGreaterThan(-1);
    expect(check, 'the validity check runs before the row is locked').toBeGreaterThan(lock);
    // And before anything is written.
    const write = accept.indexOf("set({ status: 'accepted' })");
    expect(write).toBeGreaterThan(check);
  });

  it('and REJECTING one is still allowed', () => {
    // Clearing a stale bid off the board is reasonable; refusing it would
    // leave the request cluttered with prices nobody can act on.
    const reject = between(WORKFLOW, 'export async function rejectQuotationSecure', 'export async function closeRfqSecure');
    expect(reject).not.toContain('isQuotationExpired');
  });

  it('the refusal names what to do about it, not just what is wrong', () => {
    expect(QUOTATION_EXPIRED_MESSAGE).toMatch(/re-confirm/i);
  });

  it('and the rule is imported, never restated', () => {
    // A second copy of "has this expired" is how the button and the server
    // start disagreeing - the whole reason this lives in shared/.
    expect(WORKFLOW).toContain("from '../shared/quotationValidity'");
    const accept = between(WORKFLOW, 'export async function acceptQuotationSecure', 'export async function rejectQuotationSecure');
    expect(accept, 'the comparison was written out by hand').not.toMatch(/validUntil.*<.*new Date|new Date\(\).*>.*validUntil/);
  });
});

describe('every reader says whether the price still holds', () => {
  it('the customer comparison list', () => {
    const list = between(ROUTERS, 'quotations: protectedProcedure', 'inviteSupplier: protectedProcedure');
    expect(list).toContain('expired: isQuotationExpired(row.validUntil)');
    expect(list).toContain('canAccept: canAcceptQuotation(row)');
  });

  it('the supplier own list, because they are the only one who can fix it', () => {
    const mine = between(ROUTERS, 'myQuotations: approvedProviderProcedure', 'quotations: protectedProcedure');
    expect(mine).toContain('isQuotationExpired(row.validUntil)');
  });

  it('and the detail page, so it cannot disagree with the list', () => {
    const detail = between(ROUTERS, 'quotation: protectedProcedure', 'submitQuotation: approvedProviderProcedure');
    expect(detail).toContain('expired: isQuotationExpired(quotation.validUntil)');
    expect(detail).toContain('canAccept: canAcceptQuotation(quotation)');
  });

  it('derived at read time, never stored in a column', () => {
    // BuildHub has no job runner, so a stored flag would be a lie between the
    // moment the price stopped holding and the moment something wrote it down.
    expect(ROUTERS).not.toMatch(/set\(\{[^}]*expired:/);
    expect(read('../drizzle/schema.ts')).not.toMatch(/expired:\s*(boolean|timestamp)\('expired'/);
  });
});

describe('the screen does not offer what the server refuses', () => {
  it('the accept button is withheld from an expired bid', () => {
    expect(COMPARISON).toContain('const isExpired = q.expired === true');
    // Anchored on CODE, not on a comment: readSourceForAssertions strips
    // comments, so a comment marker is a slice boundary that does not exist.
    const actions = between(COMPARISON, "isOwner && !rfqAwarded && !isRejected && !isAccepted && (", "t('rfq.reject')");
    expect(actions).toContain('{!isExpired && (');
    expect(actions).toContain('quotation-accept-');
  });

  it('but REJECT is still offered, because that one still works', () => {
    const actions = between(COMPARISON, "isOwner && !rfqAwarded && !isRejected && !isAccepted && (", 'isOwner && rfqAwarded');
    const rejectAt = actions.indexOf("t('rfq.reject')");
    expect(rejectAt).toBeGreaterThan(-1);
    // The reject button is not inside the !isExpired guard: the guard closes
    // before it.
    const guardCloses = actions.indexOf(')}', actions.indexOf('{!isExpired && ('));
    expect(guardCloses, 'the reject button was withheld too').toBeLessThan(rejectAt);
  });

  it('and the reason is given where the button used to be', () => {
    expect(COMPARISON).toContain('quotation-expired-reason-');
    expect(COMPARISON).toContain("t('quotation.expiredReason')");
  });

  it('an expired card is MARKED, so a reader knows before they look for a button', () => {
    expect(COMPARISON).toContain('quotation-expired-');
    expect(COMPARISON).toContain("t('quotation.expired')");
  });

  it('BEST VALUE IS NOT AN EXPIRED BID', () => {
    // A ribbon recommending the one card whose accept button is missing.
    expect(COMPARISON).toContain("scored.filter(q => q.expired !== true)");
  });

  it('and both new strings are translated, the Arabic genuinely Arabic', () => {
    for (const key of ['quotation.expired', 'quotation.expiredReason']) {
      const hits = [...LANG.matchAll(new RegExp(`'${key.replace(/\./g, '\\.')}': '([^']+)'`, 'g'))].map(m => m[1]);
      expect(hits, key).toHaveLength(2);
      expect(hits[1], `${key} Arabic is an English fallback`).toMatch(/[؀-ۿ]/);
    }
  });
});
