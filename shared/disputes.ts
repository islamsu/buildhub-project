/**
 * THE DISPUTE VOCABULARY.
 *
 * Every closed set below was about to be written out three times - once as a
 * mysqlEnum, once as a `z.enum([...])` in a router, once as a label map in a
 * component. Three copies of a closed set, edited apart, is the architecture
 * that produced four disagreeing category vocabularies in this codebase. The
 * schema's enums still declare their own values because a Drizzle column has
 * to; everything else reads from here, and a test holds the two in agreement.
 */

/**
 * ── WHAT A DISPUTE IS ABOUT ────────────────────────────────────────────────
 *
 * The owner's decision: one dispute architecture with a POLYMORPHIC SUBJECT,
 * not three parallel dispute systems. A dispute names the thing it is about -
 * a project, an RFQ, or a quotation - and eligibility is derived from the real
 * BuildHub relationship to that thing.
 *
 * `disputes` previously had `projectId` alone, so a supplier who received a
 * quotation they disagreed with had nothing to dispute against.
 */
export const DISPUTE_SUBJECT_TYPES = ['project', 'rfq', 'quotation'] as const;
export type DisputeSubjectType = (typeof DISPUTE_SUBJECT_TYPES)[number];

/**
 * ── THE LIFECYCLE ──────────────────────────────────────────────────────────
 *
 * `withdrawn` is new and is the reporter's own decision: a dispute they no
 * longer wish to pursue is not the same outcome as one an administrator
 * rejected, and recording both as `rejected` would blame the platform for a
 * choice the reporter made.
 *
 * There is no `reopened` status. A reopened dispute is `open` again, with
 * `reopenedBy` / `reopenedAt` / `reopenReason` recording who did it and why -
 * a status that means "open, but the second time" would need a third for the
 * third time, and the status history already holds the sequence.
 */
export const DISPUTE_STATUSES = ['open', 'investigating', 'resolved', 'rejected', 'withdrawn'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/** Statuses that mean the dispute is still being worked on. */
export const DISPUTE_OPEN_STATUSES: readonly DisputeStatus[] = ['open', 'investigating'];

/**
 * What an ADMINISTRATOR may move a dispute to.
 *
 * `withdrawn` is absent deliberately: withdrawing is the REPORTER's decision
 * about their own dispute, and an administrator recording it would put the
 * platform's name on a choice it did not make. Kept here rather than as a
 * fourth hand-written list in the router and a fifth in the component.
 */
export const DISPUTE_ADMIN_SETTABLE_STATUSES = ['open', 'investigating', 'resolved', 'rejected'] as const;
export type DisputeAdminStatus = (typeof DISPUTE_ADMIN_SETTABLE_STATUSES)[number];

/** Whether an administrator may set this status at all. */
export function isAdminSettableStatus(status: string): status is DisputeAdminStatus {
  return (DISPUTE_ADMIN_SETTABLE_STATUSES as readonly string[]).includes(status);
}

export const DISPUTE_PRIORITIES = ['low', 'medium', 'high'] as const;
export type DisputePriority = (typeof DISPUTE_PRIORITIES)[number];

/**
 * ── WHAT PEOPLE ACTUALLY DISPUTE ON A CONSTRUCTION MARKETPLACE ─────────────
 *
 * NOTHING HERE IS ABOUT MONEY CHANGING HANDS. BuildHub takes no payments, holds
 * no funds and issues no refunds, so a "refund" or "chargeback" category would
 * describe a process that does not exist and invite a user to expect one.
 * `pricing` is a disagreement about a quoted price, which is a real thing that
 * happens between two parties on this platform - it is not a payment claim.
 */
export const DISPUTE_CATEGORIES = [
  'quality',        // workmanship or product quality
  'delivery',       // late, partial or missing delivery
  'quantity',       // short, over, or wrong quantity supplied
  'specification',  // delivered or built to the wrong specification
  'communication',  // an unresponsive counterparty
  'conduct',        // unprofessional conduct
  'pricing',        // a disagreement about a quoted price
  'other',
] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];

/**
 * ── HOW A DISPUTE ENDED ────────────────────────────────────────────────────
 *
 * Recorded as a TYPE beside the summary, so "how did this end" is answerable
 * across many disputes without reading prose. A bare status flip - which is all
 * `admin.updateDispute` ever did - cannot answer it.
 *
 * Again no money: `no_action_required` and `out_of_scope` are the honest
 * outcomes for something BuildHub cannot adjudicate, and neither promises a
 * remedy the platform has no mechanism to deliver.
 */
export const DISPUTE_RESOLUTION_TYPES = [
  'resolved_by_agreement',   // the parties agreed between themselves
  'resolved_by_platform',    // BuildHub made a determination
  'no_action_required',      // examined, nothing to do
  'insufficient_evidence',   // not enough to determine anything
  'out_of_scope',            // not something BuildHub can adjudicate
] as const;
export type DisputeResolutionType = (typeof DISPUTE_RESOLUTION_TYPES)[number];

/**
 * ── THE HUMAN REFERENCE ────────────────────────────────────────────────────
 *
 * `DSP-2026-000123`. A dispute is discussed in email, on the phone and in
 * support tickets, and "dispute 123" is ambiguous the moment a second system
 * has its own 123. The year makes it readable at a glance; the id keeps it
 * unique without a second sequence to keep in step.
 */
export function disputeReference(id: number, createdAt: Date = new Date()): string {
  return `DSP-${createdAt.getUTCFullYear()}-${String(id).padStart(6, '0')}`;
}

/** Parses one back, or null. Used by search, which must not guess. */
export function parseDisputeReference(raw: string): number | null {
  const match = /^DSP-(\d{4})-(\d{6,})$/.exec(raw.trim().toUpperCase());
  if (!match) return null;
  const id = Number(match[2]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * ── EVIDENCE ───────────────────────────────────────────────────────────────
 *
 * The content types a participant may attach to make their case.
 *
 * NARROWED TO WHAT THE SERVER CAN ACTUALLY VERIFY, following the correction
 * already made to project documents: that list once accepted `text/*` and any
 * `image/*` while the byte sniffer immediately afterwards accepted only the
 * formats with a magic number, so a .txt passed validation and came back
 * rejected. A declared type nothing can verify is not a capability, and the
 * refusal arriving after the user has picked the file is the worst moment for
 * it. A test holds this against the sniffer's own list.
 */
export const DISPUTE_EVIDENCE_CONTENT_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
] as const;

export function isAllowedDisputeEvidenceType(contentType: string): boolean {
  return (DISPUTE_EVIDENCE_CONTENT_TYPES as readonly string[]).includes(contentType);
}

/**
 * 10MB, matching registration documents.
 *
 * Evidence is a photograph of a delivery or a page of a specification, not a
 * drawing set; a limit that invites a 100MB upload over a Cairo mobile
 * connection is a limit that produces failed uploads rather than evidence.
 */
export const MAX_DISPUTE_EVIDENCE_SIZE = 10 * 1024 * 1024;

/** How many files one dispute may carry, so it cannot be used as free storage. */
export const MAX_DISPUTE_EVIDENCE_FILES = 20;

/** How long a participant message may be. Long enough to explain, bounded. */
export const MAX_DISPUTE_MESSAGE_LENGTH = 5000;
