/**
 * ── The analytics event catalogue (Slice 7) ────────────────────────────────
 *
 * A closed set. Every event BuildHub records must be named here, so the funnel
 * is defined in one readable place rather than discovered by grepping for
 * whatever string somebody passed at a call site.
 *
 * The stages follow the lifecycle a vendor actually goes through, which is the
 * only sequence that tells you where the business is losing people:
 *
 *   register -> complete a profile -> get verified -> receive an enquiry ->
 *   respond -> quote -> start a trial -> subscribe -> renew (or churn)
 *
 * Two rules this file exists to hold:
 *
 * 1. NO EVENT IS A MONEY RECORD. Revenue is computed from vendorSubscriptions,
 *    which is the financial source of truth. An event stream can drop a write,
 *    and MRR must never be estimated from a log. `subscription.*` events here
 *    describe that a transition happened, for funnel and cohort analysis - they
 *    are not what anyone bills from.
 *
 * 2. NO EVENT CARRIES PERSONAL DATA. Metadata is for small non-identifying
 *    facts: a plan id, a category slug, a count. Never an email address, phone
 *    number, password, token, document, or free text a user typed.
 *    server/analytics/events.ts enforces this at the boundary.
 */

export const ANALYTICS_EVENTS = {
  // ── Acquisition ──────────────────────────────────────────────────────────
  /** An account came into existence. metadata: { method, role }. */
  USER_REGISTERED: 'user.registered',
  /** A session was established. Not one per page load - one per sign-in. */
  USER_SIGNED_IN: 'user.signed_in',

  // ── Activation ───────────────────────────────────────────────────────────
  /** A vendor filled in enough of their profile to appear credible in the directory. */
  VENDOR_PROFILE_COMPLETED: 'vendor.profile_completed',
  /** Compliance documents submitted for review. */
  VENDOR_SUBMITTED_FOR_REVIEW: 'vendor.submitted_for_review',
  /** Compliance approved them. This is the gate for appearing in the directory. */
  VENDOR_VERIFIED: 'vendor.verified',
  /** Compliance rejected them, or asked for changes. metadata: { status }. */
  VENDOR_REVIEW_REJECTED: 'vendor.review_rejected',
  /** A vendor declared the categories they serve, which is what RFQ targeting matches on. */
  VENDOR_CATEGORIES_SET: 'vendor.categories_set',

  // ── Marketplace value ────────────────────────────────────────────────────
  /** A homeowner posted an RFQ. metadata: { category }. */
  RFQ_POSTED: 'rfq.posted',
  /** A vendor opened a qualified enquiry, spending one of their monthly allowance. */
  ENQUIRY_OPENED: 'enquiry.opened',
  /** A vendor hit their plan's monthly enquiry ceiling. The clearest upgrade signal there is. */
  ENQUIRY_LIMIT_REACHED: 'enquiry.limit_reached',
  /** A vendor submitted a quotation against an RFQ. */
  QUOTATION_SUBMITTED: 'quotation.submitted',
  /** A homeowner accepted a quotation - the marketplace's actual outcome. */
  QUOTATION_ACCEPTED: 'quotation.accepted',

  // ── Monetisation ─────────────────────────────────────────────────────────
  /** A paid trial began. metadata: { plan, founder }. */
  SUBSCRIPTION_TRIAL_STARTED: 'subscription.trial_started',
  /** A subscription became paid-active. */
  SUBSCRIPTION_ACTIVATED: 'subscription.activated',
  /** A renewal was recorded for an existing subscription. */
  SUBSCRIPTION_RENEWED: 'subscription.renewed',
  /** Cancellation requested; access continues to the end of the paid period. */
  SUBSCRIPTION_CANCELLATION_SCHEDULED: 'subscription.cancellation_scheduled',
  /** A scheduled cancellation was reversed before it took effect. */
  SUBSCRIPTION_RESUMED: 'subscription.resumed',
  /** Paid access actually ended - the churn event. */
  SUBSCRIPTION_LAPSED: 'subscription.lapsed',
  /** A move between paid plans. metadata: { from, to, direction }. */
  SUBSCRIPTION_PLAN_CHANGED: 'subscription.plan_changed',
  /** A renewal payment failed and the grace period started. */
  SUBSCRIPTION_PAYMENT_FAILED: 'subscription.payment_failed',
  /** Payment recovered during grace. */
  SUBSCRIPTION_PAYMENT_RECOVERED: 'subscription.payment_recovered',

  // ── Commercial placement ─────────────────────────────────────────────────
  //
  // The four facts a placement advertiser is entitled to, and NOT one step
  // further. There is deliberately no SALE, ORDER, REVENUE, GMV or COMMISSION
  // event here: BuildHub does not observe any of those, and an event type is
  // an invitation to populate it.
  //
  // subject is always ('placement', placementId), so every row can be traced
  // back to the exact booking it belongs to. metadata carries surface,
  // entityType and entityId - all structural, none of it personal.

  /**
   * A placement was RENDERED and actually seen. Not an API call: see
   * shared/placementAnalytics.ts for the visibility rule and why a fetch does
   * not qualify.
   */
  PLACEMENT_IMPRESSION: 'placement.impression',
  /** A visitor opened the provider profile or product page FROM a placement. */
  PLACEMENT_ENTITY_VIEW: 'placement.entity_view',
  /** A visitor took a real action offered by the placement - Get quote, Add to RFQ. */
  PLACEMENT_CTA_CLICK: 'placement.cta_click',
  /**
   * A placement-originated journey ended in a REAL enquiry relationship - an
   * RFQ actually submitted, or a qualified enquiry actually opened. This is an
   * attributed enquiry and nothing more; it is NOT a sale, and it must never be
   * reported as revenue.
   */
  PLACEMENT_QUALIFIED_ENQUIRY: 'placement.qualified_enquiry',
} as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

export const ANALYTICS_EVENT_TYPES = Object.values(ANALYTICS_EVENTS) as AnalyticsEventType[];

export function isAnalyticsEventType(value: unknown): value is AnalyticsEventType {
  return typeof value === 'string' && (ANALYTICS_EVENT_TYPES as string[]).includes(value);
}

/**
 * The vendor funnel, in order, as it is reported to the owner.
 *
 * Each stage names the event that marks reaching it. A vendor counts as having
 * reached a stage if they ever emitted that event - so the funnel is monotonic
 * and a later cancellation does not retroactively un-register somebody.
 */
export const VENDOR_FUNNEL = [
  { stage: 'registered', event: ANALYTICS_EVENTS.USER_REGISTERED },
  { stage: 'profileCompleted', event: ANALYTICS_EVENTS.VENDOR_PROFILE_COMPLETED },
  { stage: 'submittedForReview', event: ANALYTICS_EVENTS.VENDOR_SUBMITTED_FOR_REVIEW },
  { stage: 'verified', event: ANALYTICS_EVENTS.VENDOR_VERIFIED },
  { stage: 'firstEnquiry', event: ANALYTICS_EVENTS.ENQUIRY_OPENED },
  { stage: 'firstQuotation', event: ANALYTICS_EVENTS.QUOTATION_SUBMITTED },
  { stage: 'trialStarted', event: ANALYTICS_EVENTS.SUBSCRIPTION_TRIAL_STARTED },
  { stage: 'subscribed', event: ANALYTICS_EVENTS.SUBSCRIPTION_ACTIVATED },
] as const;

export type VendorFunnelStage = (typeof VENDOR_FUNNEL)[number]['stage'];

/**
 * Metadata keys that must never appear on an event, checked at the boundary.
 *
 * Not a complete list of every sensitive word in the language - it is the set
 * of names that would plausibly get passed by a developer instrumenting a call
 * site, where the value beside them is a real credential or a real identity.
 */
export const FORBIDDEN_METADATA_KEYS = [
  'password', 'passwordhash', 'token', 'secret', 'apikey', 'authorization',
  'email', 'phone', 'openid', 'sessionid', 'jti', 'cookie', 'card', 'cvv', 'iban',
] as const;
