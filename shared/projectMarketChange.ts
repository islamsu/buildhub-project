/**
 * ── CHANGING A PROJECT'S WORK LOCATION IS A LIFECYCLE OPERATION ─────────
 *
 * Owner directive Phase 3, and the reason it is not part of `projects.update`:
 * a project's market decides the jurisdiction, the sourcing currency and the
 * compliance basis of everything hanging off it. An RFQ inherits it. Every
 * quotation against that RFQ is denominated by it. Putting that behind the
 * same mutation that edits a title means a client sending a whole project
 * object back could move a live commercial relationship between countries as a
 * side effect of renaming it.
 *
 * `projects.update` accepts no market field at all, which is asserted rather
 * than remembered. This module decides whether a DEDICATED change is allowed.
 *
 * ── THE RULE, STRONGEST BLOCKER FIRST ───────────────────────────────────
 *
 *   award / contract exists  HARD REFUSE. A won bid is a commercial agreement
 *                            in a currency. Moving the project would restate
 *                            an agreed price in a currency nobody agreed to.
 *   quotation exists         HARD REFUSE. Suppliers have priced work against a
 *                            stated market; re-denominating their numbers
 *                            without their involvement is not a cascade, it is
 *                            a rewrite of their offer.
 *   published RFQ            REFUSE, with the canonical close/recreate path.
 *                            The requirement is already in front of suppliers
 *                            under one market's rules.
 *   draft / unpublished RFQ  the dedicated cascade, where the RFQ's own market
 *                            and currency follow. Reachable only if a draft RFQ
 *                            state exists - today it does not, and the branch
 *                            says so rather than pretending to handle it.
 *   no RFQ                   ALLOWED, with audit. Nothing has inherited the
 *                            market yet, so nothing is being restated.
 *
 * The order matters: a project with an awarded RFQ also has quotations and a
 * published RFQ, and the reason a user is given should be the most specific
 * true one rather than whichever check ran first.
 */

import { isEnabledMarket, isMarketCode, type MarketCode } from './markets';

/** What hangs off the project, reduced to what the decision needs. */
export type ProjectMarketChangeState = {
  /** RFQ statuses attached to this project. `open`/`closed`/`awarded` today. */
  rfqStatuses: readonly string[];
  /** Whether ANY quotation exists against any of those RFQs. */
  hasQuotations: boolean;
  /** Whether any quotation has been accepted - an award or contract. */
  hasAcceptedQuotation: boolean;
};

export type ProjectMarketChangeRequest = {
  currentMarketCode: string | null | undefined;
  targetMarketCode: string | null | undefined;
  state: ProjectMarketChangeState;
};

export type ProjectMarketChangeDecision =
  | { allowed: true; kind: 'no_rfq' | 'draft_cascade'; targetMarketCode: MarketCode }
  | {
      allowed: false;
      reason: 'unknown_target' | 'target_disabled' | 'same_market'
        | 'award_exists' | 'quotation_exists' | 'published_rfq';
    };

/** RFQ statuses that mean the requirement is in front of suppliers. */
const PUBLISHED_RFQ_STATUSES = new Set(['open', 'closed', 'awarded']);

export function decideProjectMarketChange(
  request: ProjectMarketChangeRequest,
): ProjectMarketChangeDecision {
  const { targetMarketCode, currentMarketCode, state } = request;

  if (targetMarketCode === null || targetMarketCode === undefined || targetMarketCode === '') {
    return { allowed: false, reason: 'unknown_target' };
  }
  /*
   * THE TARGET MUST BE A MARKET BUILDHUB OPERATES IN. Not merely one the
   * registry defines - moving a project into a disabled market would give it a
   * currency nothing can quote in and an RFQ no supplier can be matched to.
   */
  /*
   * AN UNKNOWN CODE IS A FAULT; A KNOWN DISABLED ONE IS A DECISION. These were
   * collapsed into `target_disabled`, which told a caller sending 'ZZ' that
   * BuildHub does not operate in that market - inviting them to wait for a
   * launch that will never come, when what they actually have is a typo or a
   * corrupt record. The same distinction `marketEligibility` makes.
   */
  if (!isMarketCode(targetMarketCode)) {
    return { allowed: false, reason: 'unknown_target' };
  }
  if (!isEnabledMarket(targetMarketCode)) {
    return { allowed: false, reason: 'target_disabled' };
  }
  // A no-op is refused rather than quietly succeeding, so an audit trail never
  // records a jurisdiction change that did not happen.
  if (targetMarketCode === currentMarketCode) {
    return { allowed: false, reason: 'same_market' };
  }

  // ── STRONGEST BLOCKER FIRST, so the reason given is the most specific one.
  if (state.hasAcceptedQuotation) return { allowed: false, reason: 'award_exists' };
  if (state.hasQuotations) return { allowed: false, reason: 'quotation_exists' };

  const published = state.rfqStatuses.filter(status => PUBLISHED_RFQ_STATUSES.has(status));
  if (published.length > 0) return { allowed: false, reason: 'published_rfq' };

  /*
   * ANY REMAINING RFQ IS A DRAFT, and today that set is empty: `rfqs.status` is
   * open | closed | awarded, with no draft state, so every RFQ is published.
   * The branch exists because the owner specified the behaviour and a draft
   * state may arrive; it is not dead code pretending to be exercised, and the
   * test for it says exactly that.
   */
  if (state.rfqStatuses.length > 0) {
    return { allowed: true, kind: 'draft_cascade', targetMarketCode: targetMarketCode as MarketCode };
  }
  return { allowed: true, kind: 'no_rfq', targetMarketCode: targetMarketCode as MarketCode };
}
