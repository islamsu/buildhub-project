// ── Plan & Entitlement Engine (Phase 4B.2) ─────────────────────────────────
// THE one mechanism that answers "what is this vendor entitled to right now?".
//
// Every plan-gated decision in BuildHub must come through here. Nothing else
// may compare a plan id, read an allowance, or decide a capability - that is
// what prevents `if (plan === 'premium')` from spreading across routers and
// components, where it would inevitably drift out of agreement with itself.
//
// Provider-agnostic: no Paymob/Stripe concept appears here or anywhere it
// depends on. Server-authoritative: resolution is always keyed by an
// authenticated server-side userId, never by anything a client can submit.

import {
  ENTITLEMENT_ENFORCEMENT,
  type PlanEntitlements,
  type PlanId,
} from '@shared/billing';
import type { BillingState } from './domain';
import { getBillingState } from './service';
import { getDb } from '../db';
import { activeOverridesFor, applyOverrides } from './overrides';

/**
 * Named capabilities, so callers ask `can(resolution, 'advanced_analytics')`
 * rather than reaching into entitlement fields (or worse, plan ids) directly.
 */
export const CAPABILITIES = [
  'advanced_analytics',
  'full_portfolio',
  'promotional_campaigns',
  'featured_placement',
  'unlimited_enquiries',
  'multi_branch',
  'multi_team',
  'boosted_visibility',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Which entitlement field decides each capability, and whether a product surface exists. */
const CAPABILITY_RULES: Readonly<Record<Capability, {
  granted: (e: PlanEntitlements) => boolean;
  /** The entitlement key whose ENTITLEMENT_ENFORCEMENT entry governs availability. */
  enforcementKey: keyof PlanEntitlements;
}>> = {
  advanced_analytics: {
    granted: e => e.analyticsLevel === 'advanced',
    enforcementKey: 'analyticsLevel',
  },
  full_portfolio: {
    granted: e => e.portfolioLevel !== 'basic',
    enforcementKey: 'portfolioLevel',
  },
  promotional_campaigns: {
    granted: e => e.promotionalCapability,
    enforcementKey: 'promotionalCapability',
  },
  featured_placement: {
    granted: e => e.featuredPlacementEligible,
    enforcementKey: 'featuredPlacementEligible',
  },
  unlimited_enquiries: {
    granted: e => e.qualifiedEnquiriesPerMonth === null,
    enforcementKey: 'qualifiedEnquiriesPerMonth',
  },
  multi_branch: {
    granted: e => e.branchLimit === null || e.branchLimit > 1,
    enforcementKey: 'branchLimit',
  },
  multi_team: {
    granted: e => e.teamMemberLimit === null || e.teamMemberLimit > 1,
    enforcementKey: 'teamMemberLimit',
  },
  boosted_visibility: {
    granted: e => e.visibilityLevel !== 'standard',
    enforcementKey: 'visibilityLevel',
  },
} as const;

/**
 * A capability's honest status.
 *
 * `granted` - the vendor's plan allows it.
 * `available` - a real product surface exists for it (per the Phase 4B.1
 *   enforcement ledger). `false` means BuildHub has not built the feature yet.
 * `usable` - both. Only a `usable` capability may be presented to a vendor as
 *   something they can actually do; a granted-but-unavailable capability must
 *   never be advertised as working (Phase 4B.2 brief §10).
 */
export type CapabilityStatus = {
  granted: boolean;
  available: boolean;
  usable: boolean;
};

function capabilityStatus(capability: Capability, entitlements: PlanEntitlements): CapabilityStatus {
  const rule = CAPABILITY_RULES[capability];
  const granted = rule.granted(entitlements);
  const available = ENTITLEMENT_ENFORCEMENT[rule.enforcementKey] !== 'not-implemented';
  return { granted, available, usable: granted && available };
}

/** The calendar month an allowance applies to. UTC, so it cannot drift with server locale. */
export type AllowancePeriod = {
  /** 'YYYY-MM' - the key Phase 4B.3 will use to scope its monthly counter. */
  key: string;
  startsAt: Date;
  /** Exclusive upper bound: the instant the allowance resets. */
  resetsAt: Date;
};

export function allowancePeriodFor(now: Date = new Date()): AllowancePeriod {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const startsAt = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const resetsAt = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
  const key = `${year}-${String(month + 1).padStart(2, '0')}`;
  return { key, startsAt, resetsAt };
}

/** The complete effective commercial state of one vendor at one instant. */
export type VendorEntitlementResolution = {
  userId: number;
  resolvedAt: Date;

  // Effective plan and lifecycle
  effectivePlan: PlanId;
  storedPlan: PlanId;
  status: BillingState['status'];
  isPaid: boolean;
  inTrial: boolean;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  billingInterval: 'month' | 'year' | null;
  inGracePeriod: boolean;
  gracePeriodEndsAt: Date | null;
  awaitingRenewalSync: boolean;
  dataIntegrityIssue: string | null;

  // Founder pricing
  founderPriceActive: boolean;
  founderPriceEndsAt: Date | null;

  // Entitlement values
  entitlements: PlanEntitlements;
  /** null = unlimited. Enforcement (counting) is Phase 4B.3, not this phase. */
  qualifiedEnquiryAllowance: number | null;
  allowancePeriod: AllowancePeriod;

  // Named capabilities
  capabilities: Record<Capability, CapabilityStatus>;
};

/**
 * Resolve one vendor's effective entitlements. Server-authoritative: `userId`
 * must come from the authenticated session, never from request input.
 *
 * Fails closed - a database outage or a malformed row resolves to FREE rather
 * than granting paid access.
 */
export async function resolveVendorEntitlements(
  userId: number,
  now: Date = new Date(),
): Promise<VendorEntitlementResolution> {
  const state = await getBillingState(userId, now);
  // INDIVIDUAL OVERRIDES RESOLVE HERE, INSIDE THE ONE MECHANISM.
  //
  // Putting them anywhere else would mean two answers to "what is this vendor
  // entitled to", and the enquiry enforcement in enquiries.ts - which reads
  // resolution.qualifiedEnquiryAllowance - would keep honouring the plan while
  // an administrator believed they had raised the limit. Because the merge
  // happens before buildResolution, every existing consumer picks it up with
  // no call site changing.
  //
  // FAILS CLOSED: any problem reading or parsing an override leaves the PLAN
  // value in place. An override is never the reason someone gets more by
  // accident.
  const overridden = await withOverrides(userId, state, now);
  return buildResolution(userId, overridden, now);
}

/** The plan's entitlements with any in-force override merged over them. */
async function withOverrides(userId: number, state: BillingState, now: Date): Promise<BillingState> {
  try {
    const db = await getDb();
    if (!db) return state;
    const overrides = await activeOverridesFor(db as never, userId, now);
    if (overrides.size === 0) return state;
    const { entitlements } = applyOverrides(state.entitlements, overrides);
    return { ...state, entitlements };
  } catch {
    return state;
  }
}

/** Pure projection of a BillingState into the full resolution. Exported for testing. */
export function buildResolution(
  userId: number,
  state: BillingState,
  now: Date = new Date(),
): VendorEntitlementResolution {
  const capabilities = {} as Record<Capability, CapabilityStatus>;
  for (const capability of CAPABILITIES) {
    capabilities[capability] = capabilityStatus(capability, state.entitlements);
  }

  return {
    userId,
    resolvedAt: now,
    effectivePlan: state.effectivePlan,
    storedPlan: state.storedPlan,
    status: state.status,
    isPaid: state.isPaid,
    inTrial: state.inTrial,
    trialEndsAt: state.trialEndsAt,
    cancelAtPeriodEnd: state.cancelAtPeriodEnd,
    currentPeriodEnd: state.currentPeriodEnd,
    billingInterval: state.billingInterval,
    inGracePeriod: state.inGracePeriod,
    gracePeriodEndsAt: state.gracePeriodEndsAt,
    awaitingRenewalSync: state.awaitingRenewalSync,
    dataIntegrityIssue: state.dataIntegrityIssue,
    founderPriceActive: state.founderPriceActive,
    founderPriceEndsAt: state.founderPriceEndsAt,
    entitlements: state.entitlements,
    qualifiedEnquiryAllowance: state.entitlements.qualifiedEnquiriesPerMonth,
    allowancePeriod: allowancePeriodFor(now),
    capabilities,
  };
}

/** Does this vendor's plan grant the capability AND does the feature exist? */
export function can(resolution: VendorEntitlementResolution, capability: Capability): boolean {
  return resolution.capabilities[capability].usable;
}

/** Plan grants it, regardless of whether BuildHub has built the feature yet. */
export function isGranted(resolution: VendorEntitlementResolution, capability: Capability): boolean {
  return resolution.capabilities[capability].granted;
}

/**
 * The vendor-facing response shape. An explicit allowlist: no provider
 * reference, no stored-vs-effective internals a vendor has no use for, and
 * nothing a client could mistake for an authoritative input.
 */
export function toVendorEntitlementResponse(resolution: VendorEntitlementResolution) {
  return {
    plan: resolution.effectivePlan,
    status: resolution.status,
    isPaid: resolution.isPaid,
    inTrial: resolution.inTrial,
    trialEndsAt: resolution.trialEndsAt,
    cancelAtPeriodEnd: resolution.cancelAtPeriodEnd,
    currentPeriodEnd: resolution.currentPeriodEnd,
    billingInterval: resolution.billingInterval,
    inGracePeriod: resolution.inGracePeriod,
    gracePeriodEndsAt: resolution.gracePeriodEndsAt,
    founderPriceActive: resolution.founderPriceActive,
    founderPriceEndsAt: resolution.founderPriceEndsAt,
    entitlements: resolution.entitlements,
    qualifiedEnquiryAllowance: resolution.qualifiedEnquiryAllowance,
    allowancePeriod: resolution.allowancePeriod,
    // Only `usable` is surfaced to a vendor: a capability their plan grants but
    // which BuildHub has not built must never be shown as an available feature.
    capabilities: Object.fromEntries(
      CAPABILITIES.map(capability => [capability, resolution.capabilities[capability].usable]),
    ) as Record<Capability, boolean>,
  } as const;
}
