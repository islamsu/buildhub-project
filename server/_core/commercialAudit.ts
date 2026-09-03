import { commercialAuditEvents } from '../../drizzle/schema';
import type { getDb } from '../db';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * RECORDING WHAT HAPPENED TO A COMMERCIAL RECORD.
 *
 * BuildHub audited accounts thoroughly - creation, role changes, the whole
 * password-reset lifecycle, every admin action - and audited COMMERCE not at
 * all. An RFQ could be created, quoted, awarded and closed leaving no trace of
 * who did what or when. For a marketplace that intends to carry real money,
 * that is the gap that matters: account history answers "who is this person",
 * commercial history answers "what did they agree to".
 *
 * TWO DESIGN DECISIONS WORTH STATING.
 *
 * 1. A FAILED AUDIT WRITE MUST NOT FAIL THE BUSINESS ACTION.
 *    If the audit insert throws - a full disk, a lock timeout - the supplier's
 *    quotation has already been submitted and the customer is waiting on it.
 *    Rolling that back to protect the log would be losing the thing to protect
 *    the record of the thing. So this swallows and reports rather than throws.
 *
 *    THE HONEST COST: a missing audit row is possible and would be silent to
 *    the user. That is the right trade for THIS product, where the alternative
 *    is refusing commerce when logging hiccups - but it is a trade, not a free
 *    win, which is why the failure is logged loudly for an operator even though
 *    it is invisible to the customer.
 *
 * 2. IT IS CALLED AFTER THE WRITE SUCCEEDS, NEVER BEFORE.
 *    An audit trail that records intentions rather than outcomes is worse than
 *    none: it would show quotations that were never submitted and awards that
 *    never happened, and nobody reading it later could tell which.
 */

export type CommercialSubject = 'rfq' | 'quotation' | 'product' | 'document' | 'enquiry' | 'message' | 'category';

/**
 * The vocabulary. A closed set rather than free text, so the trail can be
 * filtered and counted rather than grepped, and so a typo is a compile error
 * instead of an event that silently never matches a query.
 */
export type CommercialAction =
  // RFQ lifecycle
  | 'rfq_created' | 'rfq_updated' | 'rfq_closed' | 'rfq_awarded' | 'rfq_cancelled'
  // Quotation lifecycle
  | 'quotation_submitted' | 'quotation_accepted' | 'quotation_rejected' | 'quotation_withdrawn'
  // The paid lead
  | 'enquiry_opened'
  // Catalogue
  | 'product_created' | 'product_updated' | 'product_published' | 'product_delisted'
  | 'product_featured' | 'product_unfeatured'
  | 'product_images_changed' | 'product_question_answered'
  // Files
  | 'document_uploaded' | 'document_deleted' | 'attachment_added' | 'attachment_removed'
  // The product taxonomy. Creating a category and pointing an alias at one have
  // no prior value to contrast, so they belong here rather than in
  // fieldValueHistory - a rename or a status change, which do, go there.
  | 'category_created' | 'category_alias_added' | 'category_alias_removed';

export type CommercialEvent = {
  actorId: number | null;
  /** Who the subject belonged to when this happened. */
  ownerId: number | null;
  subjectType: CommercialSubject;
  subjectId: number;
  action: CommercialAction;
  /**
   * Short human context - a status transition, a price, a filename.
   *
   * NEVER a credential, never a token, and never the body of a private
   * document. An audit trail is read by more people than the record it
   * describes, so it must not become the widest copy of the narrowest data.
   */
  detail?: string | null;
};

/** Detail is context, not a payload. Long strings are truncated, not stored. */
const MAX_DETAIL = 500;

export async function recordCommercialEvent(db: Db | null, event: CommercialEvent): Promise<void> {
  if (!db) return;
  try {
    await db.insert(commercialAuditEvents).values({
      actorId: event.actorId,
      ownerId: event.ownerId,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      action: event.action,
      detail: event.detail ? String(event.detail).slice(0, MAX_DETAIL) : null,
    });
  } catch (error) {
    // Loud for an operator, invisible to the customer - see the note above on
    // why the business action is not rolled back for this.
    console.error(JSON.stringify({
      level: 'error',
      event: 'commercial_audit_write_failed',
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      action: event.action,
      message: error instanceof Error ? error.message : 'unknown',
    }));
  }
}
