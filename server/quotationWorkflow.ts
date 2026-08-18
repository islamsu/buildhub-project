import { getDb } from './db';
import { quotations, rfqs } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';

export async function acceptQuotationSecure(rfqId: number, quotationId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error('Database connection unavailable');
  }

  // Verify RFQ belongs to requester or admin
  const [rfq] = await db.select().from(rfqs).where(eq(rfqs.id, rfqId));
  if (!rfq) {
    throw new Error('RFQ not found');
  }
  if (rfq.requesterId !== userId) {
    throw new Error('Unauthorized to accept quotation for this RFQ');
  }
  if (rfq.status === 'awarded') {
    throw new Error('RFQ has already been awarded');
  }

  // Verify target quotation
  const [quotation] = await db.select().from(quotations).where(and(eq(quotations.id, quotationId), eq(quotations.rfqId, rfqId)));
  if (!quotation) {
    throw new Error('Quotation not found for this RFQ');
  }
  if (quotation.status !== 'pending') {
    throw new Error(`Quotation cannot be accepted in state: ${quotation.status}`);
  }

  // Perform updates
  await db.update(quotations)
    .set({ status: 'accepted' })
    .where(eq(quotations.id, quotationId));

  // Reject other pending quotations for this RFQ
  await db.update(quotations)
    .set({ status: 'rejected' })
    .where(and(eq(quotations.rfqId, rfqId), eq(quotations.status, 'pending')));

  // Mark RFQ as awarded
  await db.update(rfqs)
    .set({ status: 'awarded' })
    .where(eq(rfqs.id, rfqId));

  return { success: true, awardedQuotationId: quotationId, rfqId };
}
