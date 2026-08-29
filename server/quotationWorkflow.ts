import { TRPCError } from '@trpc/server';
import { and, eq, ne } from 'drizzle-orm';
import { getDb } from './db';
import { quotations, rfqs } from '../drizzle/schema';
import { notifyUser, notifyUsers } from './notifications';

// The only authoritative implementation of quotation acceptance. Wired directly into
// rfqRouter.acceptQuotation — do not duplicate this logic elsewhere.
//
// Runs inside one db.transaction() with SELECT ... FOR UPDATE locks on the RFQ row
// (locked first, then the quotation row) so concurrent accept attempts on the same RFQ
// serialize: the second transaction blocks until the first commits, then re-reads state
// and is rejected by the open/pending checks below instead of racing it.
export async function acceptQuotationSecure(rfqId: number, quotationId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database connection unavailable' });

  const result = await db.transaction(async (tx) => {
    const [rfq] = await tx.select().from(rfqs).where(eq(rfqs.id, rfqId)).for('update');
    if (!rfq || rfq.requesterId !== userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this RFQ' });
    }
    if (rfq.status !== 'open') {
      throw new TRPCError({ code: 'CONFLICT', message: `RFQ is not open for acceptance (status: ${rfq.status})` });
    }

    const [quotation] = await tx.select().from(quotations)
      .where(and(eq(quotations.id, quotationId), eq(quotations.rfqId, rfqId)))
      .for('update');
    if (!quotation) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Quotation not found for this RFQ' });
    }
    if (quotation.status !== 'pending') {
      throw new TRPCError({ code: 'CONFLICT', message: `Quotation cannot be accepted in state: ${quotation.status}` });
    }

    // Read who else is about to be auto-rejected (for notifications below) before the cascade
    // update runs. Safe without an extra lock: the RFQ row lock above already serializes any
    // other transaction that could touch these rows.
    const others = await tx.select({ providerId: quotations.providerId }).from(quotations).where(
      and(eq(quotations.rfqId, rfqId), ne(quotations.id, quotationId))
    );

    await tx.update(quotations).set({ status: 'accepted' }).where(eq(quotations.id, quotationId));
    await tx.update(quotations).set({ status: 'rejected' }).where(
      and(eq(quotations.rfqId, rfqId), ne(quotations.id, quotationId))
    );
    await tx.update(rfqs).set({ status: 'awarded' }).where(eq(rfqs.id, rfqId));

    // WHO IS TOLD THEY LOST, and who must not be.
    //
    // `others` is every OTHER QUOTATION on this RFQ, not every other provider,
    // and nothing prevents one provider from submitting several (see the
    // OWNER DECISION in the Phase 1B handoff). Mapping rows straight to
    // recipients therefore did two wrong things at once: a provider who bid
    // three times and WON was sent "Quotation not selected" twice, seconds
    // after "Quotation accepted"; and a provider who bid twice and lost was
    // told so twice.
    //
    // De-duplicating and excluding the winner is not a decision about whether
    // duplicates should exist - it is addressing each provider once, which is
    // correct under either answer to that question.
    // (No Set spread: this TypeScript target has no downlevelIteration.)
    const losingProviderIds = others
      .map(o => o.providerId)
      .filter((providerId, index, all) =>
        providerId !== quotation.providerId && all.indexOf(providerId) === index);

    return {
      success: true as const,
      awardedQuotationId: quotationId,
      rfqId,
      acceptedProviderId: quotation.providerId,
      rejectedProviderIds: losingProviderIds,
      rfqTitle: rfq.title,
    };
  });

  // Notifications are dispatched only after the transaction has committed, and never allowed
  // to affect its outcome - a notification failure must not undo a successful acceptance.
  await notifyUser(db, {
    userId: result.acceptedProviderId,
    title: 'Quotation accepted',
    body: `Your quotation for "${result.rfqTitle}" was accepted.`,
    type: 'quotation',
    // THE QUOTATION THAT WON, which is exactly what this notification is about
    // and is unambiguous: there is one accepted quotation per RFQ. Until the
    // quotation detail page existed this could only point at the RFQ, because a
    // quotation had no URL to point at.
    link: `/quotations/${result.awardedQuotationId}`,
    messageKey: 'notif.quotation.accepted',
    messageParams: { rfqTitle: result.rfqTitle },
  });
  await notifyUsers(db, result.rejectedProviderIds.map(providerId => ({
    userId: providerId,
    title: 'Quotation not selected',
    body: `Your quotation for "${result.rfqTitle}" was not selected.`,
    type: 'quotation',
    // THE RFQ, deliberately, and NOT a quotation - unlike the winner above.
    //
    // A provider may bid several times on one RFQ (see the OWNER DECISION in
    // the Phase 1B handoff), and this list is de-duplicated to ONE message per
    // provider precisely because sending one per losing quotation told a
    // three-bid provider twice that they lost. Linking to "their" quotation
    // would have to pick one of several arbitrarily, and picking one is what
    // reintroduces the duplicate. The RFQ is the unambiguous subject when a
    // provider holds more than one losing bid on it.
    link: `/rfq/${result.rfqId}`,
    messageKey: 'notif.quotation.notSelected',
    messageParams: { rfqTitle: result.rfqTitle },
  })));

  return { success: result.success, awardedQuotationId: result.awardedQuotationId, rfqId: result.rfqId };
}

// Mirrors acceptQuotationSecure's ownership/cross-RFQ/state checks so a reject can't
// race a concurrent accept of the same quotation.
export async function rejectQuotationSecure(rfqId: number, quotationId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database connection unavailable' });

  const result = await db.transaction(async (tx) => {
    const [rfq] = await tx.select().from(rfqs).where(eq(rfqs.id, rfqId)).for('update');
    if (!rfq || rfq.requesterId !== userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this RFQ' });
    }

    const [quotation] = await tx.select().from(quotations)
      .where(and(eq(quotations.id, quotationId), eq(quotations.rfqId, rfqId)))
      .for('update');
    if (!quotation) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Quotation not found for this RFQ' });
    }
    if (quotation.status !== 'pending') {
      throw new TRPCError({ code: 'CONFLICT', message: `Quotation cannot be rejected in state: ${quotation.status}` });
    }

    await tx.update(quotations).set({ status: 'rejected' }).where(eq(quotations.id, quotationId));
    return { success: true as const, providerId: quotation.providerId, rfqTitle: rfq.title, rfqId, quotationId };
  });

  await notifyUser(db, {
    userId: result.providerId,
    title: 'Quotation not selected',
    body: `Your quotation for "${result.rfqTitle}" was not selected.`,
    type: 'quotation',
    // THE QUOTATION, unlike the auto-rejected losers in acceptQuotationSecure.
    // This path rejects ONE named quotation, so there is nothing ambiguous to
    // choose between: the provider is told which of their bids was declined.
    link: `/quotations/${result.quotationId}`,
    messageKey: 'notif.quotation.notSelected',
    messageParams: { rfqTitle: result.rfqTitle },
  });

  return { success: result.success };
}
