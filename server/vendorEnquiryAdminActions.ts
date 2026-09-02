/**
 * ── WHAT AN ADMINISTRATOR CAN ACTUALLY DO TO A VENDOR ENQUIRY ─────────────
 *
 * WRITTEN BEFORE THE ACTIONS, NOT AFTER, because the brief listed five verbs -
 * create, open, cancel, close, reopen - and a screen with five buttons is easy
 * to build and impossible to unbuild. Each verb is answered here with the REAL
 * DOMAIN OPERATION it maps to, or with an honest refusal.
 *
 * The rule this file enforces is the one that matters most: A VENDOR ENQUIRY IS
 * DERIVED (see vendorEnquiry.ts). It has no status column, so there is no such
 * thing as "setting" its state. Every action must change a real underlying fact
 * - an invitation, an RFQ's own status, a quotation, an entitlement - and the
 * displayed state then follows on its own. An action that cannot name such a
 * fact is not implemented, however reasonable its label sounds.
 *
 *   ┌───────────────┬──────────────────────────────────────────────────────┐
 *   │ BRIEF'S VERB  │ WHAT IT REALLY IS                                    │
 *   ├───────────────┼──────────────────────────────────────────────────────┤
 *   │ create        │ INVITE this vendor to this RFQ. Real row in          │
 *   │               │ rfqSuppliers, via the existing inviteSupplier().     │
 *   │ open          │ NOTHING HONEST. See below - and see why the          │
 *   │               │ complimentary-access problem it was meant to solve   │
 *   │               │ is already solved by `create`.                       │
 *   │ cancel        │ WITHDRAW the invitation. Needs a real status the     │
 *   │               │ enum does not have yet: a domain change, not a flag. │
 *   │ close         │ CLOSE THE RFQ. There is no per-vendor close.         │
 *   │ reopen        │ REOPEN THE RFQ. There is no per-vendor reopen, and a │
 *   │               │ vendor's own decline is not an administrator's to    │
 *   │               │ undo.                                                │
 *   └───────────────┴──────────────────────────────────────────────────────┘
 *
 * WHY "ADMIN OPENS THE ENQUIRY FOR THE VENDOR" IS NOT BUILT, AND WHY NOTHING
 * IS LOST BY THAT.
 *
 * Opening is what CONSUMES a vendor's allowance. An administrator performing it
 * on a vendor's behalf would spend that vendor's monthly allowance on a
 * decision the vendor did not make - visible to them afterwards only as a
 * missing unit. The obvious repair is a complimentary open that does not
 * decrement, which is where ADMIN_COMPLIMENTARY came from.
 *
 * BuildHub does not need it. An INVITED supplier already opens for free:
 * `openQualifiedEnquiry` returns `byInvitation`, writes no qualifiedEnquiries
 * row, and the commercial trail records "opened by invitation, exempt from the
 * allowance". So the real operation behind "give this vendor access to this
 * RFQ at no cost" already exists, is already audited, is already visible to the
 * vendor as an invitation rather than as an inexplicable act - and leaves the
 * decision to open with the vendor, where it belongs.
 *
 * Adding ADMIN_COMPLIMENTARY on top of that would mean a second exemption
 * mechanism with the same effect and none of the history, and a usageReason the
 * vendor's own screen would have to learn. It is therefore NOT MODELLED. If the
 * owner later wants an admin-granted exemption distinct from an invitation, the
 * constraints in §6 still apply and are restated in ADMIN_COMPLIMENTARY_RULES
 * below so the next person does not have to rediscover them.
 */

/** How an action is classified once its underlying operation is known. */
export type ActionSemantics =
  | {
      /** There is a real domain operation, and this names it. */
      kind: 'REAL_DOMAIN_OPERATION';
      /** The function or procedure that performs it. Reused, never re-implemented. */
      operation: string;
      /** The table whose rows actually change. */
      writes: string;
      /** What the derived enquiry state becomes as a CONSEQUENCE - never set directly. */
      derivedConsequence: string;
    }
  | {
      /** Honest refusal. The label sounds reasonable and has nothing behind it. */
      kind: 'NOT_IMPLEMENTED';
      reason: string;
    }
  | {
      /** Real, but it needs a schema change that has not been made yet. */
      kind: 'REQUIRES_DOMAIN_CHANGE';
      reason: string;
      change: string;
    };

export const ENQUIRY_ADMIN_ACTIONS: Record<string, ActionSemantics> = {
  /**
   * "Create an enquiry" = invite the vendor. The requester's own invitation
   * path, performed by an administrator, through the same service - so the
   * invitedBy trail, the eligibility checks and the notification are the ones
   * that already exist rather than a second set that can drift.
   */
  INVITE_VENDOR: {
    kind: 'REAL_DOMAIN_OPERATION',
    operation: 'inviteSupplier',
    writes: 'rfqSuppliers',
    derivedConsequence: 'AVAILABLE -> INVITED, and the vendor may open it without consuming allowance',
  },

  /**
   * The whole point of the exercise: an administrator does not open an enquiry.
   * There is no operation here that is both honest and useful.
   */
  OPEN_ON_BEHALF: {
    kind: 'NOT_IMPLEMENTED',
    reason:
      'Opening consumes the vendor\'s own allowance for a decision they did not make. '
      + 'The legitimate need - free access to this RFQ - is served by INVITE_VENDOR, '
      + 'which the existing openQualifiedEnquiry already exempts from the allowance.',
  },

  /**
   * Withdrawing an invitation IS a real thing that happens, and it has no
   * honest representation today: the enum has no withdrawn state, and deleting
   * the row would erase the fact that the vendor was ever approached - which is
   * exactly what a support investigation needs to see.
   */
  WITHDRAW_INVITATION: {
    kind: 'REQUIRES_DOMAIN_CHANGE',
    reason:
      'rfqSuppliers.status has no withdrawn value, and deleting the row would erase the '
      + 'invitation from the investigation timeline. Reusing declined would attribute the '
      + 'platform\'s decision to the vendor.',
    change: "add 'withdrawn' to the rfqSuppliers.status enum, with withdrawnAt and withdrawnBy",
  },

  /**
   * Closing is an RFQ-level act with consequences for every vendor on it, and
   * the screen must say so rather than implying one vendor is affected.
   */
  CLOSE_RFQ: {
    kind: 'REAL_DOMAIN_OPERATION',
    operation: 'closeRfqSecure',
    writes: 'rfqs',
    derivedConsequence: 'every unanswered enquiry on that RFQ becomes CLOSED; answered ones stay RESPONDED',
  },

  /**
   * A vendor's decline is the vendor's, and an administrator reversing it would
   * make the platform's record disagree with what the vendor did.
   */
  REOPEN_FOR_VENDOR: {
    kind: 'NOT_IMPLEMENTED',
    reason:
      'There is no per-vendor reopen. A closed enquiry is closed because the RFQ is, and a '
      + 'declined one records the vendor\'s own decision, which is not an administrator\'s to rewrite. '
      + 'Reopening the RFQ is the real operation, and it reopens every enquiry on it.',
  },

  /**
   * Allowance is adjusted through the entitlement architecture that already
   * exists - a dated, reasoned, revocable override - never by writing a
   * remaining count.
   */
  ADJUST_ALLOWANCE: {
    kind: 'REAL_DOMAIN_OPERATION',
    operation: 'vendorEntitlementOverrides (existing Benefits/Override architecture)',
    writes: 'vendorEntitlementOverrides',
    derivedConsequence:
      'the vendor\'s resolved allowance changes for future opens; no qualifiedEnquiries row is '
      + 'created, altered or removed, so usage history stays true',
  },
} as const;

/**
 * The constraints an admin-granted complimentary open would have to satisfy IF
 * the owner ever asks for one that is distinct from an invitation.
 *
 * Kept as a named list because they are the interesting part of §6 and would
 * otherwise be rediscovered by whoever builds it - probably after shipping the
 * version that breaks one of them.
 */
export const ADMIN_COMPLIMENTARY_RULES = [
  'must not decrement the vendor\'s normal allowance',
  'must not be recorded as, or indistinguishable from, a VENDOR_OPEN',
  'must not rewrite or delete qualifiedEnquiries history',
  'must not create a billing event, because no payment occurs anywhere on this path',
  'must be attributable to the administrator who granted it, with a reason',
] as const;

/** Actions with something real behind them - the only ones a screen may offer. */
export function implementableActions(): string[] {
  return Object.entries(ENQUIRY_ADMIN_ACTIONS)
    .filter(([, semantics]) => semantics.kind === 'REAL_DOMAIN_OPERATION')
    .map(([name]) => name);
}
