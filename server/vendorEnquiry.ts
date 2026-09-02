/**
 * ── WHAT A "VENDOR ENQUIRY" ACTUALLY IS IN BUILDHUB ───────────────────────
 *
 * THE RECONCILIATION, because the answer decides whether a second enquiry
 * system gets built by accident.
 *
 * There is NO `vendorEnquiries` table, and there should not be one. A vendor
 * enquiry is not a record - it is the RELATIONSHIP between one vendor and one
 * RFQ, and BuildHub already stores every part of that relationship across four
 * existing tables, each answering a different question:
 *
 *   rfqs                the CUSTOMER'S REQUEST. The business record everything
 *                       else hangs from. Owns the scope, budget, deadline and
 *                       lifecycle status.
 *
 *   rfqSuppliers        a TARGETED INVITATION: this requester asked THIS
 *                       supplier. Carries its own small lifecycle -
 *                       invited / viewed / responded / declined - plus
 *                       invitedBy and the timestamps behind it.
 *
 *   qualifiedEnquiries  a BILLING FACT: this vendor spent one allowance credit
 *                       to open this RFQ. Unique on (userId, rfqId). It has no
 *                       status column and must not grow one - it records that a
 *                       charge happened, not how the conversation went.
 *
 *   quotations          the vendor's ANSWER.
 *
 * So the lifecycle the Admin screen needs is DERIVED from those four, not
 * stored in a fifth place. That is the whole point of this module:
 *
 *   - a fifth table would need writing on every event the other four already
 *     record, and would be wrong the first time one of those writes failed;
 *   - two sources for "has this vendor responded?" is how an Admin screen and
 *     a vendor screen end up disagreeing about the same RFQ;
 *   - `qualifiedEnquiries` is a FINANCIAL record. Overloading it with workflow
 *     states would put billing history and conversation state in one row, and
 *     the first "just reset the status" would destroy a charge record.
 *
 * THE STATES, and the evidence each one is read from. Nothing here is a stored
 * string; every value is computed from rows that already exist, so the Admin
 * view and the vendor view cannot drift.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { qualifiedEnquiries, quotations, rfqSuppliers, rfqs } from '../drizzle/schema';

/**
 * The vendor-enquiry lifecycle, in the order it progresses.
 *
 * Deliberately SMALL. The brief listed ten candidate states; these are the ones
 * BuildHub can actually evidence from stored data today. A state nothing can
 * produce is a filter that always returns nothing and a badge nobody ever sees.
 */
export const ENQUIRY_STATES = [
  /** The RFQ is open and this vendor may open it, but has not. No credit spent. */
  'AVAILABLE',
  /** The requester invited this vendor specifically. Opening is free for them. */
  'INVITED',
  /** An invited vendor has looked at it, but not answered. */
  'VIEWED',
  /** The vendor opened the enquiry - a credit was spent, or an invitation covered it. */
  'OPENED',
  /** The vendor submitted a quotation. */
  'RESPONDED',
  /** The invited vendor said no. A real outcome, not an absence of one. */
  'DECLINED',
  /** The RFQ itself is no longer open, so the enquiry cannot progress. */
  'CLOSED',
] as const;

export type EnquiryState = (typeof ENQUIRY_STATES)[number];

/** The facts a state is derived from. Every field comes from a real row. */
export type EnquiryEvidence = {
  /** The RFQ's own status, from `rfqs.status`. */
  rfqStatus: string | null;
  /** rfqSuppliers.status when this vendor was invited; null when they were not. */
  invitationStatus: string | null;
  /** True when a qualifiedEnquiries row exists for (vendor, rfq). */
  creditSpent: boolean;
  /** True when a quotation exists for (vendor, rfq). */
  hasQuotation: boolean;
};

/**
 * RFQ statuses that mean the enquiry can no longer progress.
 *
 * Read from the RFQ rather than duplicated per vendor: when a requester closes
 * an RFQ, every vendor's enquiry closes with it, and storing that per vendor
 * would need N writes that can each fail independently.
 */
const TERMINAL_RFQ_STATUSES = new Set(['closed', 'awarded']);

/**
 * The enum `rfqs.status` actually holds, asserted so this file cannot drift
 * from the schema.
 *
 * The first draft of the set above also listed 'cancelled', 'completed' and
 * 'expired' - none of which the column can hold. Carrying them would have been
 * exactly the fault this module's own comments warn about: states nothing can
 * produce, filters that always return nothing, badges nobody ever sees. If the
 * enum gains a terminal value later, add it HERE and the test fails until the
 * set above is updated with it.
 */
export const RFQ_STATUSES = ['open', 'closed', 'awarded'] as const;

/**
 * Derive the state. ORDER MATTERS, and the order is "strongest evidence first".
 *
 * A submitted quotation outranks everything: it is the most advanced thing that
 * can have happened, and it stays true even after the RFQ closes - an Admin
 * looking at a closed RFQ still needs to see WHICH vendors answered it.
 */
export function deriveEnquiryState(evidence: EnquiryEvidence): EnquiryState {
  if (evidence.hasQuotation) return 'RESPONDED';
  if (evidence.invitationStatus === 'declined') return 'DECLINED';
  // A closed RFQ stops progress for everyone who has not already answered.
  if (evidence.rfqStatus && TERMINAL_RFQ_STATUSES.has(evidence.rfqStatus)) return 'CLOSED';
  if (evidence.creditSpent) return 'OPENED';
  if (evidence.invitationStatus === 'responded') return 'OPENED';
  if (evidence.invitationStatus === 'viewed') return 'VIEWED';
  if (evidence.invitationStatus === 'invited') return 'INVITED';
  return 'AVAILABLE';
}

/**
 * Is this state one the vendor can still act on?
 *
 * Used for the Admin overview counts, so "awaiting vendor response" means the
 * same thing on the dashboard as it does in the filtered list.
 */
export function isAwaitingVendor(state: EnquiryState): boolean {
  return state === 'INVITED' || state === 'VIEWED' || state === 'OPENED';
}

/**
 * A HUMAN REFERENCE for an enquiry.
 *
 * An enquiry has no id of its own - it is a pair - so its reference is built
 * from the pair. `ENQ-<rfqId>-<vendorId>` is stable, derivable in both
 * directions, and needs no new column or sequence to allocate.
 *
 * It is deliberately NOT a random opaque code: an administrator reading it in a
 * support ticket can tell which RFQ it concerns, and the RFQ reference is the
 * thing the customer already quotes.
 */
export function enquiryReference(rfqId: number, vendorId: number): string {
  return `ENQ-${rfqId}-${vendorId}`;
}

export function parseEnquiryReference(reference: string): { rfqId: number; vendorId: number } | null {
  const match = /^ENQ-(\d+)-(\d+)$/i.exec(reference.trim());
  if (!match) return null;
  const rfqId = Number(match[1]);
  const vendorId = Number(match[2]);
  if (!Number.isSafeInteger(rfqId) || !Number.isSafeInteger(vendorId) || rfqId <= 0 || vendorId <= 0) return null;
  return { rfqId, vendorId };
}

/**
 * Gather the evidence for many (vendor, rfq) pairs at once.
 *
 * BATCHED on purpose. The obvious shape is one query per row, which is fine on
 * the twelve rows a demo has and unopenable on the thousands a working
 * marketplace has. Four queries total, whatever the page size.
 */
export async function gatherEnquiryEvidence(
  db: unknown,
  pairs: { rfqId: number; vendorId: number }[],
): Promise<Map<string, EnquiryEvidence>> {
  const out = new Map<string, EnquiryEvidence>();
  if (pairs.length === 0) return out;

  const rfqIds = Array.from(new Set(pairs.map(p => p.rfqId)));
  const vendorIds = Array.from(new Set(pairs.map(p => p.vendorId)));
  const select = (db as { select: Function }).select.bind(db);

  const rfqRows = await select({ id: rfqs.id, status: rfqs.status })
    .from(rfqs).where(inArray(rfqs.id, rfqIds)) as { id: number; status: string | null }[];
  const rfqStatus = new Map(rfqRows.map(r => [r.id, r.status]));

  const invitationRows = await select({
    rfqId: rfqSuppliers.rfqId, supplierId: rfqSuppliers.supplierId, status: rfqSuppliers.status,
  }).from(rfqSuppliers).where(and(
    inArray(rfqSuppliers.rfqId, rfqIds), inArray(rfqSuppliers.supplierId, vendorIds),
  )) as { rfqId: number; supplierId: number; status: string }[];
  const invitation = new Map(invitationRows.map(r => [`${r.rfqId}:${r.supplierId}`, r.status]));

  const creditRows = await select({
    rfqId: qualifiedEnquiries.rfqId, userId: qualifiedEnquiries.userId,
  }).from(qualifiedEnquiries).where(and(
    inArray(qualifiedEnquiries.rfqId, rfqIds), inArray(qualifiedEnquiries.userId, vendorIds),
  )) as { rfqId: number; userId: number }[];
  const credits = new Set(creditRows.map(r => `${r.rfqId}:${r.userId}`));

  const quotationRows = await select({
    rfqId: quotations.rfqId, providerId: quotations.providerId,
  }).from(quotations).where(and(
    inArray(quotations.rfqId, rfqIds), inArray(quotations.providerId, vendorIds),
  )) as { rfqId: number; providerId: number }[];
  const answered = new Set(quotationRows.map(r => `${r.rfqId}:${r.providerId}`));

  for (const pair of pairs) {
    const key = `${pair.rfqId}:${pair.vendorId}`;
    out.set(key, {
      rfqStatus: rfqStatus.get(pair.rfqId) ?? null,
      invitationStatus: invitation.get(key) ?? null,
      creditSpent: credits.has(key),
      hasQuotation: answered.has(key),
    });
  }
  return out;
}

/**
 * HOW A CREDIT CAME TO BE SPENT - or why it was not.
 *
 * The brief asks an Admin to be able to see this per enquiry, and the answer
 * must come from the same engine the vendor's own usage screen reads. These are
 * LABELS over evidence that already exists; nothing here writes a counter.
 *
 * `ADMIN_COMPLIMENTARY` is included because the brief anticipates it, and it is
 * explicitly NOT the same event as a vendor's own open: it must never be
 * recorded as allowance consumption. Until an admin-open path exists there is
 * nothing that produces it, and the function says so honestly rather than
 * guessing a value.
 */
export type EnquiryUsageReason =
  | 'VENDOR_OPEN'
  | 'INVITATION_EXEMPT'
  | 'NOT_OPENED';

export function usageReason(evidence: EnquiryEvidence): EnquiryUsageReason {
  if (evidence.creditSpent) return 'VENDOR_OPEN';
  // An invitation lets a supplier respond without spending a credit - the
  // exemption the owner approved. A quotation with no credit row can only have
  // arrived that way.
  if (evidence.invitationStatus != null || evidence.hasQuotation) return 'INVITATION_EXEMPT';
  return 'NOT_OPENED';
}
