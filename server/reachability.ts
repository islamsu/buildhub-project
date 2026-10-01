/**
 * PROCEDURES WITH NO CLIENT CALLER, DECLARED RATHER THAN DISCOVERED.
 *
 * A tRPC procedure nothing calls is one of three things, and the difference
 * matters: a FEATURE THAT WAS NEVER FINISHED, a SUPERSEDED READER nobody
 * deleted, or a capability that is deliberately not reachable from the UI. The
 * first two are defects; the third is a decision. Left undistinguished they
 * look identical, which is how this codebase accumulated 26 of them - including
 * a referral engine that could never fire and a dispute list users could not
 * read.
 *
 * So the third kind is written down HERE, with the reason, and
 * server/reachability.test.ts holds the list against what the source actually
 * says. A new procedure with no caller fails the suite until somebody either
 * wires it, deletes it, or writes down why it is here. A declared one that
 * gains a caller - or is removed - fails until this list is corrected, so the
 * reasons cannot quietly go stale either.
 *
 * THIS IS NOT AN ALLOWLIST FOR SKIPPING WORK. Every entry names something that
 * cannot be wired now and says what would change that.
 */
export type UncalledReason = {
  /** `namespace.procedure`, exactly as a client would call it. */
  procedure: string;
  /** Why it has no caller, and what would give it one. */
  reason: string;
};

export const UNCALLED_BY_DESIGN: readonly UncalledReason[] = [
  // ── PER-MARKET SERVICE OFFERS: THE SECOND MARKET DOES NOT EXIST YET ──────
  //
  // These are not screens somebody forgot. The feature IS a second market: one
  // service, independently priced in Oman, Saudi Arabia and the UAE. Every GCC
  // market is `enabled: false`, and `mayManageOffer` refuses a disabled market
  // outright, so `manageableMarkets` returns exactly [EG] today. A provider
  // screen built against that would be a one-row form offering a single
  // Egyptian price - which the existing service form already collects, in the
  // legacy columns, which this work exists to supersede.
  //
  // So the UI lands with the market selection it is for, as part of the
  // work-location and eligibility wiring, and not before. Declaring it here
  // rather than deleting it is deliberate: the API is what the migration
  // classified rows FOR, and the owner's GCC staging acceptance requires a
  // provider journey that configures the same service in several markets with
  // independent prices. That journey needs these procedures to already exist.
  {
    procedure: 'services.marketOffers',
    reason:
      'Reads a provider\'s per-market offers for their own service. No client '
      + 'caller yet because every market but Egypt is disabled, so the list it '
      + 'returns has exactly one row and nothing to choose between. Wired with '
      + 'the provider market-pricing UI, which is required for GCC owner '
      + 'website acceptance and cannot be exercised until a market is enabled.',
  },
  {
    procedure: 'services.setMarketOffer',
    reason:
      'Creates or replaces one market\'s offer. Same reason: with one enabled '
      + 'market it can only write the Egyptian price the legacy form already '
      + 'writes. Its authorization (ownership, market enabled, approved in THAT '
      + 'market) is tested directly in server/serviceOfferingMarkets.test.ts '
      + 'including the disabled-market and wrong-owner negatives, so the '
      + 'capability is proven rather than merely present.',
  },

  {
    procedure: 'auth.signInDummy',
    reason:
      'The QA dummy-account sign-in. Its UI entry point was deliberately removed '
      + '(see the note in client/src/pages/AuthPage.tsx) while the capability was '
      + 'kept for the seeded test accounts the live probes use. Reachable by the '
      + 'probes, not by a visitor - which is the point.',
  },

  // ── THE PAYMENT PROVIDER IS NOT CONNECTED, AND PAYMENT IS OWNER-DEFERRED ──
  //
  // These are not screens somebody forgot to build. They are the writes a
  // payment provider's webhook makes, and the reconciliation that reads what it
  // wrote. There is no provider (server/billing/provider.ts), so there are no
  // events to record and nothing to reconcile. Wiring a BUTTON to any of them
  // would let an administrator record a payment that never happened, which is
  // exactly the fabricated-revenue this project refuses to build.
  {
    procedure: 'admin.recordVendorPaymentSucceeded',
    reason: 'A payment-provider webhook write. No provider is configured, and a manual '
      + 'button for it would record revenue Rakiza never received.',
  },
  {
    procedure: 'admin.recordVendorPaymentFailed',
    reason: 'A payment-provider webhook write. Same reason as recordVendorPaymentSucceeded.',
  },
  {
    procedure: 'admin.recordVendorPaymentRecovered',
    reason: 'A payment-provider webhook write. Same reason as recordVendorPaymentSucceeded.',
  },
  {
    procedure: 'admin.reconcileVendorBilling',
    reason: 'Reconciles one vendor against the provider\'s record of them. There is no '
      + 'provider record to reconcile against until a provider is connected.',
  },
  {
    procedure: 'admin.reconcileDueBilling',
    reason: 'The sweep of every due subscription. Rakiza has no job runner '
      + '(server/billing/lifecycle.ts) and no provider, so it has nothing to sweep '
      + 'and nowhere to be called from.',
  },
  {
    procedure: 'admin.startVendorTrial',
    reason: 'Superseded for the administrator by admin.setVendorPlanManually, which is '
      + 'wired, audited and notified (SA-1..SA-4). Kept because it is the lifecycle '
      + 'engine\'s own entry point for a trial and is called by the billing tests; '
      + 'it becomes reachable again when self-serve signup meets a real provider.',
  },
  {
    procedure: 'admin.changeVendorPlan',
    reason: 'Superseded for the administrator by admin.setVendorPlanManually. Same '
      + 'standing as startVendorTrial.',
  },
];

/** The declared set as bare names, for the guard. */
export const UNCALLED_PROCEDURES: readonly string[] =
  UNCALLED_BY_DESIGN.map(entry => entry.procedure);
