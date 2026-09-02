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
 *   qualifiedEnquiries  the ENTITLEMENT USAGE CONSUMPTION RECORD: this vendor
 *                       consumed one qualified-enquiry allowance unit to open
 *                       this RFQ. Unique on (userId, rfqId). It has no status
 *                       column and must not grow one - it records that an
 *                       allowance unit was used, not how the conversation went.
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
 *   - `qualifiedEnquiries` is the ENTITLEMENT CONSUMPTION LEDGER. Overloading it
 *     with workflow states would put usage history and conversation state in one
 *     row, and the first "just reset the status" would destroy the record of
 *     what a vendor's allowance was actually spent on.
 *
 * A NOTE ON WHAT THIS RECORD IS NOT. It is tempting to call a consumed enquiry
 * a "charge" or a "billing fact", and an earlier draft of this file did. That
 * would be a lie about the architecture: BuildHub collects no payment on this
 * path - there is no gateway, no invoice, no transaction - and payment is
 * deliberately owner-deferred. What actually happens is that an entitlement
 * granted by a plan is DRAWN DOWN. Describing it as financial would invite the
 * next person to build reconciliation, refunds or revenue reporting on top of a
 * table that has never seen money.
 *
 * "CREDIT" throughout this file therefore means an ALLOWANCE UNIT, in the sense
 * `rfq.enquiry.credit` already defines in shared/platformRules.ts - "one
 * qualified-enquiry credit from the vendor's monthly allowance". The word is
 * kept because it is the vocabulary the rest of the platform and the vendor's
 * own usage screen already use; it is not a unit of currency.
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
  /** The vendor opened the enquiry - an allowance unit was consumed, or an
   *  invitation exempted them from consuming one. */
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
  /** True when a qualifiedEnquiries row exists for (vendor, rfq) - one
   *  allowance unit consumed. Not a payment: see the header. */
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
/**
 * THE PRECEDENCE, WRITTEN ONCE, IN ORDER.
 *
 * It is expressed as DATA rather than as a chain of ifs for a specific reason:
 * the Admin overview has to count these states across the whole platform, and
 * counting them by loading every enquiry into Node does not survive contact
 * with a real marketplace. So the same ladder has to exist as a SQL CASE.
 *
 * Two hand-written ladders in two languages is exactly the drift this module
 * was created to prevent, so neither is hand-written: `deriveEnquiryState`
 * walks this array, and `enquiryStateSql` (server/vendorEnquiryQuery.ts) emits
 * a CASE from the very same array, in the very same order.
 */
export const ENQUIRY_STATE_RULES: {
  state: EnquiryState;
  /** The rule, over already-loaded evidence. */
  test: (evidence: EnquiryEvidence) => boolean;
  /** The identical rule, over the four evidence columns of a SQL row. */
  sql: (columns: EvidenceColumns) => string;
}[] = [
  // A submitted quotation outranks everything, and stays true after the RFQ
  // closes: an Admin looking at a closed RFQ still needs to see who answered.
  {
    state: 'RESPONDED',
    test: e => e.hasQuotation,
    sql: c => `${c.hasQuotation} = 1`,
  },
  {
    state: 'DECLINED',
    test: e => e.invitationStatus === 'declined',
    sql: c => `${c.invitationStatus} = 'declined'`,
  },
  // A closed RFQ stops progress for everyone who has not already answered.
  {
    state: 'CLOSED',
    test: e => e.rfqStatus != null && TERMINAL_RFQ_STATUSES.has(e.rfqStatus),
    sql: c => `${c.rfqStatus} IN (${Array.from(TERMINAL_RFQ_STATUSES).map(s => `'${s}'`).join(', ')})`,
  },
  {
    state: 'OPENED',
    test: e => e.creditSpent,
    sql: c => `${c.creditSpent} = 1`,
  },
  {
    state: 'OPENED',
    test: e => e.invitationStatus === 'responded',
    sql: c => `${c.invitationStatus} = 'responded'`,
  },
  {
    state: 'VIEWED',
    test: e => e.invitationStatus === 'viewed',
    sql: c => `${c.invitationStatus} = 'viewed'`,
  },
  {
    state: 'INVITED',
    test: e => e.invitationStatus === 'invited',
    sql: c => `${c.invitationStatus} = 'invited'`,
  },
];

/** The SQL expressions holding each piece of evidence, for the CASE emitter. */
export type EvidenceColumns = {
  rfqStatus: string;
  invitationStatus: string;
  creditSpent: string;
  hasQuotation: string;
};

/** The state when no rule matched. */
export const DEFAULT_ENQUIRY_STATE: EnquiryState = 'AVAILABLE';

export function deriveEnquiryState(evidence: EnquiryEvidence): EnquiryState {
  for (const rule of ENQUIRY_STATE_RULES) {
    if (rule.test(evidence)) return rule.state;
  }
  return DEFAULT_ENQUIRY_STATE;
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
 *
 * CHECKED BEFORE FINALISING THIS FORMAT - does BuildHub already have public,
 * human-safe references for the two halves? It does, and they are exactly these
 * numbers:
 *
 *   - An RFQ has NO reference column and no slug. Every screen that names one
 *     renders `RFQ #<id>` from the numeric id (RFQPage, RolePlatform, the admin
 *     investigation view), and `/rfq/:id` is the canonical route. The id IS the
 *     public reference.
 *   - A vendor has no slug either. `/vendor/:id` is the canonical provider
 *     profile route, so the numeric user id is likewise already public.
 *
 * So this composes two identifiers BuildHub already prints and puts in URLs; it
 * discloses nothing a support ticket did not already contain. The alternatives
 * were rejected on inspection rather than taste: `users.openId` is the SESSION
 * identifier and must never appear in a quotable reference, and
 * `users.username` is nullable, so a reference built from it would be missing
 * for exactly the accounts most likely to need support.
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
 * HOW AN ALLOWANCE UNIT CAME TO BE CONSUMED - or why it was not.
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
