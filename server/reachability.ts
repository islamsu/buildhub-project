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
  {
    procedure: 'auth.signInDummy',
    reason:
      'The QA dummy-account sign-in. Its UI entry point was deliberately removed '
      + '(see the note in client/src/pages/AuthPage.tsx) while the capability was '
      + 'kept for the seeded test accounts the live probes use. Reachable by the '
      + 'probes, not by a visitor - which is the point.',
  },

  {
    procedure: 'marketplace.featuredVendors',
    reason:
      'The older public reader of the paid vendor strip, which labels its rows '
      + '`sponsored: true`. The live directory reads marketplace.sponsoredVendors '
      + '(the CP-1 canonical resolver) and the hub reads marketplace.featuredProviders, '
      + 'so nothing calls this one - but featuredPlacement.test.ts §5 pins its shape as '
      + 'part of the paid-placement design, and listFeaturedVendors is a different '
      + 'function from listSponsoredVendors rather than an alias. Deciding which of the '
      + 'three public placement readers survives is placement work with its own '
      + 'commercial consequences, not a tidy-up to fold into a reachability sweep. It '
      + 'is named here so the decision is visible rather than lost among the others.',
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
      + 'button for it would record revenue BuildHub never received.',
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
    reason: 'The sweep of every due subscription. BuildHub has no job runner '
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
