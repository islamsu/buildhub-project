import { TRPCError } from '@trpc/server';
import { and, eq, ne } from 'drizzle-orm';
import { getDb } from './db';
import { quotations, rfqs } from '../drizzle/schema';

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

  return db.transaction(async (tx) => {
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

    await tx.update(quotations).set({ status: 'accepted' }).where(eq(quotations.id, quotationId));
    await tx.update(quotations).set({ status: 'rejected' }).where(
      and(eq(quotations.rfqId, rfqId), ne(quotations.id, quotationId))
    );
    await tx.update(rfqs).set({ status: 'awarded' }).where(eq(rfqs.id, rfqId));

    return { success: true as const, awardedQuotationId: quotationId, rfqId };
  });
}

// Mirrors acceptQuotationSecure's ownership/cross-RFQ/state checks so a reject can't
// race a concurrent accept of the same quotation.
export async function rejectQuotationSecure(rfqId: number, quotationId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database connection unavailable' });

  return db.transaction(async (tx) => {
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
    return { success: true as const };
  });
}
