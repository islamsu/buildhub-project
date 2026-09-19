/**
 * ── A SUPPLIER TAKING THEIR OWN PRICE OFF THE TABLE ───────────────────────
 *
 * `quotations.status` offered pending, accepted and rejected, and all three
 * are the CUSTOMER's decision - a bid wins, or it loses because another one
 * won. The supplier had no exit. A firm whose material costs moved, or whose
 * capacity went to another job, could only revise to a number nobody would
 * accept, which is not a withdrawal: it is a worse bid, and it leaves a price
 * on the board the customer may still accept and hold them to.
 *
 * The gap was visible in the code before it was visible in the product.
 * commercialAudit has carried `quotation_withdrawn` in its action vocabulary
 * since the day it was written, and nothing could ever record it.
 *
 * THREE RULES, and each one is a decision rather than a detail.
 *
 *   ONLY THE SUPPLIER WHO BID. Not the customer - rejecting is their verb -
 *   and not an administrator, who has no standing to retract somebody's
 *   commercial offer.
 *
 *   ONLY WHILE IT IS PENDING. An accepted quotation is an agreement. Walking
 *   away from an agreement is a dispute, which this product has a whole
 *   subsystem for, and letting it happen as a quiet status change would route
 *   around every protection that subsystem provides. A rejected or already
 *   withdrawn one has nothing left to take back.
 *
 *   THE CUSTOMER IS TOLD. A price disappearing from a comparison with no
 *   explanation is the kind of thing that reads as a bug in the product
 *   rather than a decision by a supplier.
 *
 * LOCKED LIKE THE ACCEPTANCE IS, and for the same reason. Without the row
 * lock, a withdrawal and an acceptance arriving together can both read
 * `pending` and both proceed: the customer is told they have an agreement
 * while the supplier is told they are out of it. The RFQ row is locked first
 * and the quotation second, in the same order acceptQuotationSecure uses,
 * because two transactions taking the same locks in opposite orders is how a
 * deadlock is built.
 */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { quotations, rfqs } from '../drizzle/schema';
import { requireDb } from './_core/requireDb';
import { notifyUser } from './notifications';
import { recordCommercialEvent } from './_core/commercialAudit';
import { recordFieldChange } from './audit/fieldHistory';

export type WithdrawQuotationResult = {
  quotationId: number;
  rfqId: number;
  rfqTitle: string;
  requesterId: number;
};

export async function withdrawQuotationSecure(
  quotationId: number,
  userId: number,
  reason: string | null,
): Promise<WithdrawQuotationResult> {
  const db = await requireDb();

  const result = await db.transaction(async tx => {
    /*
     * The quotation is read WITHOUT a lock first, only to learn which RFQ to
     * lock. Nothing is decided on this read - every check below runs again on
     * the locked row - because taking the quotation lock before the RFQ lock
     * would reverse the order acceptQuotationSecure uses.
     */
    const [peek] = await tx.select({ rfqId: quotations.rfqId })
      .from(quotations).where(eq(quotations.id, quotationId)).limit(1);
    if (!peek) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Quotation not found' });
    }

    const [rfq] = await tx.select().from(rfqs).where(eq(rfqs.id, peek.rfqId)).for('update');
    if (!rfq) throw new TRPCError({ code: 'NOT_FOUND', message: 'Quotation not found' });

    const [quotation] = await tx.select().from(quotations)
      .where(and(eq(quotations.id, quotationId), eq(quotations.rfqId, rfq.id)))
      .for('update');
    if (!quotation) throw new TRPCError({ code: 'NOT_FOUND', message: 'Quotation not found' });

    /*
     * NOT FOUND, not FORBIDDEN, for somebody else's quotation. Answering
     * "forbidden" confirms that the id exists and belongs to a competitor,
     * which is a fact about another supplier's bidding that this caller has
     * no business learning by guessing numbers.
     */
    if (quotation.providerId !== userId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Quotation not found' });
    }

    if (quotation.status !== 'pending') {
      throw new TRPCError({
        code: 'CONFLICT',
        message: quotation.status === 'accepted'
          ? 'This quotation has been accepted. Raise a dispute rather than withdrawing it.'
          : `A ${quotation.status} quotation cannot be withdrawn.`,
      });
    }

    await tx.update(quotations).set({ status: 'withdrawn' }).where(eq(quotations.id, quotationId));

    await recordFieldChange(tx, {
      subjectType: 'quotation', subjectId: quotationId,
      ownerId: quotation.providerId, actorId: userId,
      field: 'status', oldValue: quotation.status, newValue: 'withdrawn',
      reason,
    });

    return {
      quotationId,
      rfqId: rfq.id,
      rfqTitle: rfq.title,
      requesterId: rfq.requesterId,
    };
  });

  /*
   * AFTER THE COMMIT, both of them.
   *
   * recordCommercialEvent is called once the write has succeeded, never
   * before - the module says why: a trail that records intentions rather than
   * outcomes would show withdrawals that never happened. And the customer is
   * told after the same commit, so the notification cannot describe a
   * withdrawal that was rolled back.
   */
  await recordCommercialEvent(db, {
    actorId: userId, ownerId: userId,
    subjectType: 'quotation', subjectId: result.quotationId,
    action: 'quotation_withdrawn',
    detail: reason ? reason.slice(0, 120) : `rfq ${result.rfqId}`,
  });

  /*
   * THE KEY, not only the prose. The stored sentence is written in English at
   * WRITE time and the reader's language is chosen at READ time, so a
   * notification without a messageKey is wrong for half the audience the
   * moment it is written.
   *
   * ONE key with two bodies, under the convention notificationText already
   * has: it renders `.bodyNote` when `params.note` is a non-empty string and
   * `.body` otherwise. The first version of this invented a
   * `.bodyReason` KEY instead, which the resolver would have looked up as
   * `notif.quotation.withdrawn.bodyReason.title` - missing, so every Arabic
   * reader would have fallen back to the stored English sentence and nothing
   * would have said so.
   */
  await notifyUser(db, {
    userId: result.requesterId,
    title: 'A quotation was withdrawn',
    body: reason
      ? `A supplier withdrew their quotation for "${result.rfqTitle}": ${reason}`
      : `A supplier withdrew their quotation for "${result.rfqTitle}".`,
    type: 'info',
    link: `/rfqs/${result.rfqId}`,
    messageKey: 'notif.quotation.withdrawn',
    /*
     * The reason travels as `note`, which is the param notificationText reads
     * when it chooses between `.body` and `.bodyNote`. Naming it anything else
     * renders the no-reason sentence and drops the supplier's explanation
     * silently.
     */
    messageParams: reason
      ? { rfqTitle: result.rfqTitle, note: reason }
      : { rfqTitle: result.rfqTitle },
  });

  return result;
}
