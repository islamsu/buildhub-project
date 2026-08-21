// ── Payment Provider Abstraction (Phase 4B.1) ──────────────────────────────
// The seam between BuildHub's billing domain and whatever payment provider
// eventually collects money. The domain (domain.ts / service.ts) depends ONLY
// on this interface and never imports a provider SDK, so adding Paymob
// (Phase 4B.5) - or replacing it with Stripe or a GCC provider later - is a new
// file implementing this interface, not a rewrite.
//
// NOTHING in this file talks to a real provider. No Paymob integration exists
// in Phase 4B.1 by design: no Paymob sandbox/test merchant account is available
// yet (see BUILDHUB_PHASE4B_FINAL_BLOCKER_AUTHORIZATION.md), and inventing
// provider behaviour without one would be guessing. The interface below is
// shaped from BuildHub's own approved commercial lifecycle, deliberately NOT
// from any single provider's API surface.

import type { BillingInterval, PlanId } from '@shared/billing';

/** Opaque, provider-issued references. Never a card number, token, or credential. */
export type ProviderCustomerRef = string;
export type ProviderSubscriptionRef = string;

export type CreateCustomerInput = {
  userId: number;
  email: string | null;
  name: string | null;
};

export type CreateCheckoutInput = {
  userId: number;
  providerCustomerRef: ProviderCustomerRef;
  planId: PlanId;
  interval: BillingInterval;
  /** Resolved server-side via shared/billing.ts resolvePrice - never client-supplied. */
  amount: number;
  currency: string;
  trialDays: number;
};

export type CheckoutSession = {
  /** Where the vendor is sent to enter payment details on the provider's own hosted page. */
  redirectUrl: string;
  providerSessionRef: string;
};

/**
 * A provider event (webhook) after signature verification, normalised into
 * BuildHub's own vocabulary. Adapters translate provider-specific payloads
 * into this shape so the domain never learns a provider's event names.
 */
export type NormalisedProviderEvent = {
  /** Provider's own event id, used for idempotent processing (Phase 4B.5). */
  eventId: string;
  type:
    | 'subscription.activated'
    | 'subscription.renewed'
    | 'subscription.canceled'
    | 'payment.failed'
    | 'payment.recovered'
    | 'unknown';
  providerSubscriptionRef: ProviderSubscriptionRef | null;
  providerCustomerRef: ProviderCustomerRef | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  occurredAt: Date;
};

export interface PaymentProvider {
  /** Stable identifier persisted on vendorSubscriptions.provider (e.g. 'paymob'). */
  readonly id: string;

  createCustomer(input: CreateCustomerInput): Promise<ProviderCustomerRef>;

  createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession>;

  /** Cancel at period end (true) or immediately (false), per the approved policy. */
  cancelSubscription(ref: ProviderSubscriptionRef, atPeriodEnd: boolean): Promise<void>;

  /** Full or partial refund. Amount omitted = full. Authorisation is the caller's job. */
  refund(ref: ProviderSubscriptionRef, amount?: number): Promise<void>;

  /**
   * Verify a webhook's authenticity from its raw body and headers, then
   * normalise it. MUST throw on an invalid signature - never return a
   * best-effort parse, and never trust an unverified payload.
   */
  verifyAndParseWebhook(rawBody: string, headers: Record<string, string | undefined>): NormalisedProviderEvent;
}

export class PaymentProviderNotConfiguredError extends Error {
  constructor(operation: string) {
    super(
      `No payment provider is configured; cannot perform "${operation}". ` +
        `Payment provider integration lands in Phase 4B.5 and requires a provider ` +
        `merchant account. This is expected in Phase 4B.1.`,
    );
    this.name = 'PaymentProviderNotConfiguredError';
  }
}

/**
 * The active provider until a real adapter is wired in Phase 4B.5. Every
 * operation fails loudly and explicitly rather than silently pretending to
 * succeed - a billing system that quietly no-ops is far more dangerous than
 * one that refuses. Read paths (plan catalogue, a vendor's own subscription
 * state) do not touch a provider at all and keep working normally.
 */
export class NullPaymentProvider implements PaymentProvider {
  readonly id = 'none';

  async createCustomer(): Promise<ProviderCustomerRef> {
    throw new PaymentProviderNotConfiguredError('createCustomer');
  }

  async createCheckoutSession(): Promise<CheckoutSession> {
    throw new PaymentProviderNotConfiguredError('createCheckoutSession');
  }

  async cancelSubscription(): Promise<void> {
    throw new PaymentProviderNotConfiguredError('cancelSubscription');
  }

  async refund(): Promise<void> {
    throw new PaymentProviderNotConfiguredError('refund');
  }

  verifyAndParseWebhook(): NormalisedProviderEvent {
    throw new PaymentProviderNotConfiguredError('verifyAndParseWebhook');
  }
}

let activeProvider: PaymentProvider = new NullPaymentProvider();

export function getPaymentProvider(): PaymentProvider {
  return activeProvider;
}

/** Registration seam for Phase 4B.5's real adapter (and for tests). */
export function setPaymentProvider(provider: PaymentProvider): void {
  activeProvider = provider;
}

export function isPaymentProviderConfigured(): boolean {
  return activeProvider.id !== 'none';
}
