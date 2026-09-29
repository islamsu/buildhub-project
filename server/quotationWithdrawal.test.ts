// ── A SUPPLIER CAN TAKE THEIR OWN PRICE OFF THE TABLE ─────────────────────
//
// `quotations.status` offered pending, accepted and rejected, and all three
// are the CUSTOMER's decision. A supplier whose costs moved could only revise
// to a number nobody would accept - which is not a withdrawal, it is a worse
// bid, and it leaves a price the customer may still accept and hold them to.
//
// WHAT THIS FILE IS, AND IS NOT. The behaviour is proved end to end against a
// real database in evidence/zg-withdrawal.mjs: who may withdraw, what happens
// to the trail, and - the one that needed a live cascade to demonstrate - that
// accepting a competing bid does not re-label a withdrawn one as "rejected".
//
// These are the parts that can be asserted without a database, plus tripwires
// for the two rules that are easiest to delete by accident. The tripwires read
// source and say so; they claim a guard is PRESENT, not that it works.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canAcceptQuotation } from '../shared/quotationValidity';

const WITHDRAWAL = readFileSync(new URL('./quotationWithdrawal.ts', import.meta.url), 'utf8');
const WORKFLOW = readFileSync(new URL('./quotationWorkflow.ts', import.meta.url), 'utf8');

describe('a withdrawn quotation is not a live price', () => {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  it('cannot be accepted, by the same predicate the act uses', () => {
    // Not a new rule: canAcceptQuotation already refused anything that is not
    // pending, so widening the enum made the screen correct for free. Asserted
    // because that is a property worth keeping, not an accident to rely on.
    expect(canAcceptQuotation({ status: 'withdrawn', validUntil: future })).toBe(false);
  });

  it('while a pending one still can', () => {
    // POSITIVE CONTROL. Without it, a predicate that returned false for
    // everything would satisfy the assertion above.
    expect(canAcceptQuotation({ status: 'pending', validUntil: future })).toBe(true);
  });

  it('and neither can an accepted or rejected one', () => {
    expect(canAcceptQuotation({ status: 'accepted', validUntil: future })).toBe(false);
    expect(canAcceptQuotation({ status: 'rejected', validUntil: future })).toBe(false);
  });
});

describe('the rules that are easiest to delete by accident', () => {
  it('the award cascade touches PENDING quotations only, on both halves', () => {
    /*
     * The acceptance sets every other quotation on the request to rejected.
     * Without the filter, a withdrawn bid is swept into that - so a supplier
     * is told their own withdrawal was "not selected", with the losing-bid
     * notification to match, about a decision the customer never made.
     *
     * BOTH HALVES, because they fail differently and were proved separately
     * against a live database: the UPDATE decides the stored status, and the
     * SELECT above it decides who gets a history row and who is notified.
     * Removing either one alone leaves the other looking correct.
     */
    const cascade = WORKFLOW.slice(
      WORKFLOW.indexOf('const others = await tx.select'),
      WORKFLOW.indexOf('// OLD -> NEW for every quotation'),
    );
    expect(cascade.length).toBeGreaterThan(200);
    const filters = cascade.match(/eq\(quotations\.status, 'pending'\)/g) ?? [];
    expect(filters, 'the select and the update each need the filter').toHaveLength(2);
  });

  it('withdrawal takes the RFQ lock before the quotation lock', () => {
    // The same order acceptQuotationSecure uses. Two transactions taking the
    // same two locks in opposite orders is how a deadlock is built, and the
    // two operations contend for exactly these rows.
    const rfqLock = WITHDRAWAL.indexOf('.from(rfqs).where(eq(rfqs.id, peek.rfqId)).for(\'update\')');
    const quotationLock = WITHDRAWAL.indexOf('.where(and(eq(quotations.id, quotationId), eq(quotations.rfqId, rfq.id)))');
    expect(rfqLock, 'the rfq row is locked').toBeGreaterThan(-1);
    expect(quotationLock, 'the quotation row is locked').toBeGreaterThan(-1);
    expect(rfqLock).toBeLessThan(quotationLock);
  });

  it('somebody else\'s quotation is NOT FOUND rather than FORBIDDEN', () => {
    // "Forbidden" confirms the id exists and belongs to a competitor, which is
    // a fact about another supplier's bidding that a caller should not be able
    // to learn by guessing numbers.
    const ownership = WITHDRAWAL.slice(WITHDRAWAL.indexOf('if (quotation.providerId !== userId)'));
    expect(ownership.slice(0, 200)).toContain("code: 'NOT_FOUND'");
    expect(ownership.slice(0, 200)).not.toContain("code: 'FORBIDDEN'");
  });

  it('an accepted quotation is sent to the dispute process, not withdrawn', () => {
    // Walking away from an agreement as a quiet status change would route
    // around every protection the dispute subsystem provides.
    expect(WITHDRAWAL).toContain("quotation.status !== 'pending'");
    expect(WITHDRAWAL).toMatch(/accepted[\s\S]{0,200}dispute/i);
  });

  it('the trail is written after the commit, never before', () => {
    // recordCommercialEvent's own rule: a trail that records intentions rather
    // than outcomes would show withdrawals that never happened.
    const commitEnd = WITHDRAWAL.indexOf('return {\n      quotationId,');
    const auditCall = WITHDRAWAL.indexOf('await recordCommercialEvent(db, {');
    expect(commitEnd).toBeGreaterThan(-1);
    expect(auditCall).toBeGreaterThan(commitEnd);
  });
});
