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

    return {
      success: true as const,
      awardedQuotationId: quotationId,
      rfqId,
      acceptedProviderId: quotation.providerId,
      rejectedProviderIds: others.map(o => o.providerId),
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
    link: '/provider',
  });
  await notifyUsers(db, result.rejectedProviderIds.map(providerId => ({
    userId: providerId,
    title: 'Quotation not selected',
    body: `Your quotation for "${result.rfqTitle}" was not selected.`,
    type: 'quotation',
    link: '/provider',
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
    return { success: true as const, providerId: quotation.providerId, rfqTitle: rfq.title };
  });

  await notifyUser(db, {
    userId: result.providerId,
    title: 'Quotation not selected',
    body: `Your quotation for "${result.rfqTitle}" was not selected.`,
    type: 'quotation',
    link: '/provider',
  });

  return { success: result.success };
}
