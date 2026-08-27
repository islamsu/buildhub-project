/**
 * THE ROLE MATRIX - what each of the six marketplace roles can actually do.
 *
 * Six roles x nineteen resources x nine verbs is 1,026 cells. Most of them do
 * not exist as product surface, and a matrix that quietly omits them reads as
 * if they were considered. So every cell is declared, and a cell that does not
 * exist says N/A WITH THE REASON rather than being absent.
 *
 * This file is DESCRIPTIVE, not enforcing. Nothing reads it at runtime. What
 * makes it trustworthy is server/roleMatrix.test.ts, which checks it against
 * the router source: a cell claiming a procedure must name one that exists,
 * with the tier it claims, and the N/A claims that can be checked are checked.
 * If the product grows an operation, the matrix fails until it is updated.
 *
 * WHAT "N/A" MEANS HERE: the product does not implement the operation for that
 * resource AT ALL, for anybody. It is not a permission decision and must not be
 * read as one. Notably, BuildHub has almost no DELETE surface: outside
 * ai.deleteAttachment and the admin-only dummy-account cleanup, nothing in the
 * product can be deleted by anyone. That is a real gap, not a security posture.
 */

export const MATRIX_ROLES = [
  'homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager',
] as const;
export type MatrixRole = (typeof MATRIX_ROLES)[number];

/** The five roles that go through professional onboarding. */
export const PROVIDER_ROLES: readonly MatrixRole[] =
  ['contractor', 'engineer', 'architect', 'supplier', 'project_manager'];

export const MATRIX_RESOURCES = [
  'dashboard', 'project', 'rfq', 'qualifiedEnquiry', 'quotation', 'submission',
  'provider', 'product', 'service', 'message', 'conversation', 'notification',
  'document', 'attachment', 'order', 'transaction', 'report', 'activity', 'analytics',
] as const;
export type MatrixResource = (typeof MATRIX_RESOURCES)[number];

export const MATRIX_VERBS = [
  'view', 'create', 'edit', 'delete', 'submit', 'approve', 'reject', 'download', 'communicate',
] as const;
export type MatrixVerb = (typeof MATRIX_VERBS)[number];

/** The declared tier of the procedure behind a cell, as written in routers.ts. */
export type Tier =
  | 'publicProcedure' | 'protectedProcedure' | 'approvedProviderProcedure'
  | 'complianceProcedure' | 'aiChatProcedure' | 'admin' | 'none';

export type Access =
  /** Implemented, and reachable by the listed roles. */
  | { status: 'ok'; via: string; tier: Tier; roles: 'all' | readonly MatrixRole[]; scope: string }
  /** Implemented, but NOT by any of the six marketplace roles - administrators only. */
  | { status: 'admin-only'; via: string; scope: string }
  /** The product does not implement this operation for this resource, for anyone. */
  | { status: 'na'; why: string };

const na = (why: string): Access => ({ status: 'na', why });
const ALL = 'all' as const;

/** Not a record - there is nothing to create, approve or download. */
const NOT_A_RECORD = 'A dashboard is a view over other records, not a record itself.';
/** The product has no delete surface here. */
const NO_DELETE = 'BuildHub implements no delete for this resource, for any role.';
/** Nothing in the product edits this after creation. */
const NO_EDIT = 'No update procedure exists for this resource.';

export const ROLE_MATRIX: Record<MatrixResource, Record<MatrixVerb, Access>> = {
  dashboard: {
    view: { status: 'ok', via: 'route:/platform/:role', tier: 'none', roles: ALL, scope: 'own role only; the route redirects to the role held in the session' },
    create: na(NOT_A_RECORD), edit: na(NOT_A_RECORD), delete: na(NOT_A_RECORD),
    submit: na(NOT_A_RECORD), approve: na(NOT_A_RECORD), reject: na(NOT_A_RECORD),
    download: na('No dashboard export exists.'),
    communicate: na(NOT_A_RECORD),
  },

  project: {
    view: { status: 'ok', via: 'projects.list', tier: 'protectedProcedure', roles: ALL, scope: 'own projects (eq ownerId, ctx.user.id); providers additionally see projects.directory, an allowlisted column set' },
    create: { status: 'ok', via: 'projects.create', tier: 'protectedProcedure', roles: ALL, scope: 'ownerId stamped from the session' },
    edit: { status: 'ok', via: 'projects.update', tier: 'protectedProcedure', roles: ALL, scope: 'owner only' },
    delete: na(NO_DELETE),
    submit: na('A project is not submitted anywhere; it is created and worked on.'),
    approve: na('No project approval workflow exists.'),
    reject: na('No project approval workflow exists.'),
    download: { status: 'ok', via: 'projects.documents', tier: 'protectedProcedure', roles: ALL, scope: 'owner only; bytes served through the storage proxy, re-checked per key' },
    communicate: { status: 'ok', via: 'messages.send', tier: 'protectedProcedure', roles: ALL, scope: 'projectId may be attached to a message between two participants' },
  },

  rfq: {
    view: { status: 'ok', via: 'rfq.myList', tier: 'protectedProcedure', roles: ALL, scope: 'own RFQs; rfq.list is the shared lead pool with the requester attachments dropped; rfq.get is requester-scoped full detail' },
    create: { status: 'ok', via: 'rfq.create', tier: 'protectedProcedure', roles: ALL, scope: 'requesterId stamped from the session' },
    edit: na(NO_EDIT + ' An RFQ cannot be amended after it is posted.'),
    delete: na(NO_DELETE),
    submit: { status: 'ok', via: 'rfq.create', tier: 'protectedProcedure', roles: ALL, scope: 'there is no draft state - creating an RFQ publishes it, so create and submit are the same act' },
    approve: na('Approval applies to quotations on an RFQ, not to the RFQ itself.'),
    reject: na('Rejection applies to quotations on an RFQ, not to the RFQ itself.'),
    download: { status: 'ok', via: 'proxy:rfq-attachments/', tier: 'none', roles: ALL, scope: 'requester, or a provider who has paid a qualified enquiry for that RFQ' },
    communicate: { status: 'ok', via: 'messages.send', tier: 'protectedProcedure', roles: ALL, scope: 'between the two parties' },
  },

  qualifiedEnquiry: {
    view: { status: 'ok', via: 'rfq.eligible', tier: 'approvedProviderProcedure', roles: PROVIDER_ROLES, scope: 'own eligibility and own consumed credits; billing.myEnquiryUsage reports the monthly allowance' },
    create: { status: 'ok', via: 'rfq.openEnquiry', tier: 'approvedProviderProcedure', roles: PROVIDER_ROLES, scope: 'consumes one credit for the calling provider; unique (userId, rfqId) makes it idempotent at the database' },
    edit: na('A consumed credit is a historical fact; it is not editable.'),
    delete: na(NO_DELETE + ' A credit is never refunded by deletion.'),
    submit: na('Opening the enquiry IS the act; nothing is submitted afterwards.'),
    approve: na('No approval step exists - eligibility is derived, not granted.'),
    reject: na('No approval step exists.'),
    download: na('An enquiry has no file of its own; the RFQ attachments are the artefact.'),
    communicate: na('Contact happens on the RFQ or by message, not on the enquiry record.'),
  },

  quotation: {
    view: { status: 'ok', via: 'rfq.myQuotations', tier: 'approvedProviderProcedure', roles: PROVIDER_ROLES, scope: 'own bids; the RFQ owner sees all bids on their RFQ via rfq.quotations, which is requester-scoped' },
    create: { status: 'ok', via: 'rfq.submitQuotation', tier: 'approvedProviderProcedure', roles: PROVIDER_ROLES, scope: 'providerId from the session; refused unless the RFQ exists and is open' },
    edit: na('No update procedure exists. Whether a provider should be able to revise a bid is an OWNER DECISION, recorded in the closure handoff.'),
    delete: na(NO_DELETE + ' A bid cannot be withdrawn.'),
    submit: { status: 'ok', via: 'rfq.submitQuotation', tier: 'approvedProviderProcedure', roles: PROVIDER_ROLES, scope: 'same act as create - there is no draft bid' },
    approve: { status: 'ok', via: 'rfq.acceptQuotation', tier: 'protectedProcedure', roles: ALL, scope: 'RFQ requester only; row-locked, awards the RFQ and auto-rejects every other bid' },
    reject: { status: 'ok', via: 'rfq.rejectQuotation', tier: 'protectedProcedure', roles: ALL, scope: 'RFQ requester only' },
    download: na('A quotation carries no file of its own.'),
    communicate: { status: 'ok', via: 'messages.send', tier: 'protectedProcedure', roles: ALL, scope: 'a quotation may be referenced in a message only by a party to it' },
  },

  submission: {
    view: { status: 'ok', via: 'registration.requirements', tier: 'complianceProcedure', roles: PROVIDER_ROLES, scope: 'own onboarding requirements and own submitted documents' },
    create: { status: 'ok', via: 'registration.uploadDocument', tier: 'complianceProcedure', roles: PROVIDER_ROLES, scope: 'own; each upload also appends to the submission history' },
    edit: { status: 'ok', via: 'registration.uploadDocument', tier: 'complianceProcedure', roles: PROVIDER_ROLES, scope: 're-uploading the same document type supersedes it and returns the account to under_review' },
    delete: na(NO_DELETE + ' A compliance submission is an audit record.'),
    submit: { status: 'ok', via: 'registration.uploadDocument', tier: 'complianceProcedure', roles: PROVIDER_ROLES, scope: 'same act as create' },
    approve: { status: 'admin-only', via: 'admin.reviewComplianceDocument', scope: 'marketplace.manage; no marketplace role can approve its own or anyone else\'s onboarding' },
    reject: { status: 'admin-only', via: 'admin.reviewComplianceDocument', scope: 'marketplace.manage' },
    download: { status: 'ok', via: 'proxy:registration/', tier: 'none', roles: PROVIDER_ROLES, scope: 'own documents only; reviewers reach them through the admin surface' },
    communicate: na('Reviewer notes travel as notifications, not as a conversation.'),
  },

  provider: {
    view: { status: 'ok', via: 'marketplace.vendors', tier: 'publicProcedure', roles: ALL, scope: 'the public directory, explicit column allowlist, organic ordering; profile.getPublic and reviews.forUser are the per-provider views' },
    create: na('A provider is a user account. It is created by signUp, not as a directory record.'),
    edit: { status: 'ok', via: 'profile.update', tier: 'protectedProcedure', roles: ALL, scope: 'own profile only' },
    delete: na(NO_DELETE),
    submit: na('Listing follows from approval; nothing is submitted to the directory.'),
    approve: { status: 'admin-only', via: 'admin.updateApplicantStatus', scope: 'marketplace.manage - verification is what puts a provider in the directory' },
    reject: { status: 'admin-only', via: 'admin.updateApplicantStatus', scope: 'marketplace.manage' },
    download: na('A directory entry has no file.'),
    communicate: { status: 'ok', via: 'messages.send', tier: 'protectedProcedure', roles: ALL, scope: 'any authenticated user may message a provider' },
  },

  product: {
    view: { status: 'ok', via: 'marketplace.list', tier: 'publicProcedure', roles: ALL, scope: 'the public catalogue, active products only; marketplace.myProducts is the supplier\'s own catalogue and is SUPPLIER-ONLY' },
    create: { status: 'ok', via: 'marketplace.create', tier: 'approvedProviderProcedure', roles: ['supplier'], scope: 'supplierId stamped from the session' },
    edit: na(NO_EDIT + ' A supplier cannot correct a listing after publishing it - see the closure handoff.'),
    delete: na(NO_DELETE),
    submit: { status: 'ok', via: 'marketplace.create', tier: 'approvedProviderProcedure', roles: ['supplier'], scope: 'same act as create - a product is public the moment it exists' },
    approve: na('No product moderation workflow exists.'),
    reject: na('No product moderation workflow exists.'),
    download: na('Product images are rendered, not offered as downloads.'),
    communicate: { status: 'ok', via: 'marketplace.askQuestion', tier: 'protectedProcedure', roles: ALL, scope: 'public Q&A on an active listing; the reply side is not implemented' },
  },

  service: {
    view: { status: 'ok', via: 'profile.myCategories', tier: 'approvedProviderProcedure', roles: PROVIDER_ROLES, scope: 'own declared service categories; marketplace.vendorCategories is the public taxonomy' },
    create: { status: 'ok', via: 'profile.setMyCategories', tier: 'approvedProviderProcedure', roles: PROVIDER_ROLES, scope: 'own; the whole set is replaced in one call' },
    edit: { status: 'ok', via: 'profile.setMyCategories', tier: 'approvedProviderProcedure', roles: PROVIDER_ROLES, scope: 'own' },
    delete: { status: 'ok', via: 'profile.setMyCategories', tier: 'approvedProviderProcedure', roles: PROVIDER_ROLES, scope: 'own; omitting a category from the set removes it - the only delete-shaped operation in the product outside AI attachments' },
    submit: na('A declaration takes effect immediately; nothing is submitted.'),
    approve: na('Categories are self-declared. This is deliberate: BuildHub does not guess what a role does.'),
    reject: na('Categories are self-declared.'),
    download: na('No export of a vendor\'s declared categories exists.'),
    communicate: na('A category declaration is not a conversational surface.'),
  },

  message: {
    view: { status: 'ok', via: 'messages.list', tier: 'protectedProcedure', roles: ALL, scope: 'sender or receiver only, enforced in the query' },
    create: { status: 'ok', via: 'messages.send', tier: 'protectedProcedure', roles: ALL, scope: 'senderId from the session' },
    edit: na(NO_EDIT),
    delete: na(NO_DELETE),
    submit: na('Sending IS the act - there is no draft or outbox.'),
    approve: na('No message moderation workflow exists.'),
    reject: na('No message moderation workflow exists.'),
    download: { status: 'ok', via: 'proxy:message-attachments/', tier: 'none', roles: ALL, scope: 'the key is resolved back to the message and the caller must be sender or receiver' },
    communicate: { status: 'ok', via: 'messages.send', tier: 'protectedProcedure', roles: ALL, scope: 'the resource IS the communication' },
  },

  conversation: {
    view: { status: 'ok', via: 'messages.conversations', tier: 'protectedProcedure', roles: ALL, scope: 'own threads only' },
    create: { status: 'ok', via: 'messages.send', tier: 'protectedProcedure', roles: ALL, scope: 'a conversation is implied by the first message; there is no conversation record to create' },
    edit: na('A conversation is derived from messages; it has no editable state.'),
    delete: na(NO_DELETE),
    submit: na('A conversation is derived; nothing is submitted.'),
    approve: na('No conversation moderation workflow exists.'),
    reject: na('No conversation moderation workflow exists.'),
    download: na('No conversation transcript export exists.'),
    communicate: { status: 'ok', via: 'messages.send', tier: 'protectedProcedure', roles: ALL, scope: 'the resource IS the communication' },
  },

  notification: {
    view: { status: 'ok', via: 'notifications.list', tier: 'protectedProcedure', roles: ALL, scope: 'own only (eq userId, ctx.user.id); unreadCount is the same scope' },
    create: na('Notifications are written by the server as a consequence of business events. No role creates one.'),
    edit: { status: 'ok', via: 'notifications.markAllRead', tier: 'protectedProcedure', roles: ALL, scope: 'own; the only mutable field is read' },
    delete: na(NO_DELETE + ' A notification cannot be dismissed permanently, only marked read.'),
    submit: na('Nothing is submitted - the server writes these.'),
    approve: na('A notification is not a proposal to approve.'),
    reject: na('A notification is not a proposal to reject.'),
    download: na('No notification export or digest exists.'),
    communicate: na('A notification is one-way; replies happen in Messages.'),
  },

  document: {
    view: { status: 'ok', via: 'projects.documents', tier: 'protectedProcedure', roles: ALL, scope: 'project owner only, joined through the project' },
    create: { status: 'ok', via: 'projects.uploadDocument', tier: 'protectedProcedure', roles: ALL, scope: 'project owner only; bytes are sniffed, not trusted from the declared content type' },
    edit: na(NO_EDIT + ' A document is replaced by uploading another, not edited.'),
    delete: na(NO_DELETE),
    submit: { status: 'ok', via: 'registration.uploadDocument', tier: 'complianceProcedure', roles: PROVIDER_ROLES, scope: 'compliance documents are the only documents submitted to anyone' },
    approve: { status: 'admin-only', via: 'admin.reviewComplianceDocument', scope: 'marketplace.manage' },
    reject: { status: 'admin-only', via: 'admin.reviewComplianceDocument', scope: 'marketplace.manage' },
    download: { status: 'ok', via: 'proxy:project-documents/', tier: 'none', roles: ALL, scope: 'the key is resolved back to its project and the caller must own it' },
    communicate: na('Comments on documents are not implemented.'),
  },

  attachment: {
    view: { status: 'ok', via: 'ai.uploadAttachment', tier: 'protectedProcedure', roles: ALL, scope: 'own AI attachments; RFQ and message attachments are viewed as part of their parent record' },
    create: { status: 'ok', via: 'rfq.uploadAttachment', tier: 'protectedProcedure', roles: ALL, scope: 'four upload paths - RFQ, message, AI, avatar - each stamping the owner from the session and verifying the bytes against the declared type' },
    edit: na(NO_EDIT + ' An attachment is replaced by uploading another.'),
    delete: { status: 'ok', via: 'ai.deleteAttachment', tier: 'protectedProcedure', roles: ALL, scope: 'own AI attachments only, soft delete. RFQ, message and project attachments cannot be deleted by anyone.' },
    submit: na('An attachment is submitted with its parent record, not on its own.'),
    approve: na('Only compliance documents are reviewed; see submission.'),
    reject: na('Only compliance documents are reviewed; see submission.'),
    download: { status: 'ok', via: 'proxy:ai-attachments/', tier: 'none', roles: ALL, scope: 'every storage key is resolved back to a row and the caller checked against it; unknown prefixes fail closed' },
    communicate: na('An attachment carries no conversation of its own.'),
  },

  order: {
    view: na('BuildHub has no order. The marketplace generates RFQs and quotations; nothing is purchased through the platform.'),
    create: na('There is no order table, no order procedure and no checkout.'),
    edit: na('There is no order record in the product to edit.'),
    delete: na('There is no order record in the product to delete.'),
    submit: na('Nothing is ordered through BuildHub; an RFQ is the closest act.'),
    approve: na('There is no order to approve - purchasing happens off-platform.'),
    reject: na('There is no order to reject - purchasing happens off-platform.'),
    download: na('No order confirmation or invoice document is produced.'),
    communicate: na('Buyer and seller talk on the RFQ or by message, not on an order.'),
  },

  transaction: {
    view: { status: 'ok', via: 'billing.mySubscription', tier: 'protectedProcedure', roles: ALL, scope: 'own subscription state and lifecycle; every role may read theirs, only providers can have one' },
    create: na('No payment is taken by BuildHub. Checkout is honestly reported unavailable and no provider integration is wired.'),
    edit: { status: 'ok', via: 'billing.cancelSubscription', tier: 'approvedProviderProcedure', roles: PROVIDER_ROLES, scope: 'own; cancel and resume are the only transitions a vendor can drive' },
    delete: na('A billing record is financial history and is never deleted.'),
    submit: na('Nothing is submitted - BuildHub has no checkout at all.'),
    approve: na('No payment approval flow exists.'),
    reject: na('No payment approval flow exists.'),
    download: na('No invoice or receipt document is produced.'),
    communicate: na('Billing questions go through support, which is not a product surface.'),
  },

  report: {
    view: { status: 'ok', via: 'projects.progressReports', tier: 'protectedProcedure', roles: ALL, scope: 'project owner only' },
    create: { status: 'ok', via: 'projects.addProgressReport', tier: 'protectedProcedure', roles: ALL, scope: 'project owner only; authorId from the session' },
    edit: na(NO_EDIT),
    delete: na(NO_DELETE),
    submit: { status: 'ok', via: 'projects.addProgressReport', tier: 'protectedProcedure', roles: ALL, scope: 'same act as create' },
    approve: na('No report approval workflow exists.'),
    reject: na('No report approval workflow exists.'),
    download: na('No report export exists - the closure handoff records this as a gap.'),
    communicate: na('Not a conversational surface.'),
  },

  activity: {
    view: { status: 'admin-only', via: 'admin.accountAudit', scope: 'users.read; the account audit trail and the full audit report are administrator surfaces. No marketplace role has an activity feed.' },
    create: na('Audit events are written by the server as a side effect of real actions.'),
    edit: na('An audit trail that could be edited would not be one.'),
    delete: na('An audit trail that could be deleted would not be one.'),
    submit: na('Nothing is submitted - audit rows are a side effect.'), approve: na('An audit row is a fact, not a proposal to approve.'), reject: na('An audit row is a fact, not a proposal to reject.'),
    download: { status: 'admin-only', via: 'admin.fullAuditReport', scope: 'audit.read' },
    communicate: na('Not a conversational surface.'),
  },

  analytics: {
    view: { status: 'ok', via: 'analytics.myStats', tier: 'approvedProviderProcedure', roles: PROVIDER_ROLES, scope: 'own performance only - views, enquiries, quotations, win rate. Platform-wide analytics are administrator-only.' },
    create: na('Analytics are derived, never authored.'),
    edit: na('Analytics are derived, never authored.'),
    delete: na('Analytics are derived, never authored.'),
    submit: na('Nothing is submitted - the figures are derived.'), approve: na('A derived figure is not a proposal to approve.'), reject: na('A derived figure is not a proposal to reject.'),
    download: na('No analytics export exists - the closure handoff records this as a gap.'),
    communicate: na('Not a conversational surface.'),
  },
};

/** Every cell for one role, flattened - what the handoff table is generated from. */
export function matrixFor(role: MatrixRole): { resource: MatrixResource; verb: MatrixVerb; allowed: boolean; detail: string }[] {
  const rows: { resource: MatrixResource; verb: MatrixVerb; allowed: boolean; detail: string }[] = [];
  for (const resource of MATRIX_RESOURCES) {
    for (const verb of MATRIX_VERBS) {
      const cell = ROLE_MATRIX[resource][verb];
      if (cell.status === 'na') { rows.push({ resource, verb, allowed: false, detail: `N/A - ${cell.why}` }); continue; }
      if (cell.status === 'admin-only') { rows.push({ resource, verb, allowed: false, detail: `ADMIN ONLY - ${cell.via}` }); continue; }
      const allowed = cell.roles === 'all' || cell.roles.includes(role);
      rows.push({ resource, verb, allowed, detail: allowed ? `${cell.via} (${cell.scope})` : `REFUSED - ${cell.via} is limited to ${(cell.roles as readonly string[]).join(', ')}` });
    }
  }
  return rows;
}
