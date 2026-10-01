/**
 * ── COUNTRY-SPECIFIC, AUTHORITY-BACKED COMPLIANCE ───────────────────────
 *
 * Owner directive: BuildHub follows each country's actual government and
 * regulatory requirements. It does not translate Egypt's list into GCC
 * equivalents, does not invent a common template, and does not impose
 * BuildHub-created requirements as though a regulator had imposed them.
 *
 * ── WHY THE EXISTING TYPE COULD NOT HOLD THIS ───────────────────────────
 *
 * `ComplianceRequirement` is `{ type, name, nameAr, description, descriptionAr,
 * required }`. Six fields, and none of them can say:
 *
 *   WHO requires it            a ministry, a municipality, a professional
 *                              council, a tender board - or BuildHub itself
 *   WHEN it applies            every provider, or only public tenders, or only
 *                              above a threshold, or only one emirate
 *   WHAT satisfies it          a verifiable licence number, or a document
 *                              upload, or a classification grade
 *   WHERE IT CAME FROM         which official source said so, and when it was
 *                              last checked
 *
 * `required: boolean` in particular collapses the single most important
 * distinction in this whole exercise. "Required by law" and "required by
 * BuildHub" are both `true`, and a provider reading the screen cannot tell
 * which - so a BuildHub trust policy would read as a legal obligation. That is
 * the specific thing the owner prohibited.
 *
 * This module is additive. `ComplianceRequirement` and every existing caller
 * are untouched; a `MarketRequirement` IS a `ComplianceRequirement` with the
 * provenance a regulator-backed rule needs.
 *
 * ── NOTHING HERE IS POPULATED FROM MEMORY ───────────────────────────────
 *
 * A requirement enters the configuration with `evidence.state: 'verified'`
 * only when an official source has been read and recorded. Until then it is
 * `unverified`, carries the open question, and keeps its market's activation
 * blocked. Recall is not a source: regulations change, and a plausible
 * requirement asserted confidently is worse than an absent one, because the
 * provider gathers the wrong papers and BuildHub looks authoritative doing it.
 */

import type { ComplianceRequirement, ComplianceRole } from './compliance';

/**
 * ── WHO SAYS SO ─────────────────────────────────────────────────────────
 *
 * The distinction the UI must never blur. A BuildHub policy is a legitimate
 * product decision; presenting it as a government requirement is not.
 */
export const REQUIREMENT_PROVENANCES = [
  /** A government or regulator requires it. BuildHub is relaying an obligation. */
  'legal_requirement',
  /** BuildHub requires it for trust or safety. No regulator asked for it. */
  'buildhub_policy',
  /** Nobody requires it. A provider may supply it to strengthen their profile. */
  'optional_credential',
] as const;
export type RequirementProvenance = (typeof REQUIREMENT_PROVENANCES)[number];

/**
 * ── WHEN IT APPLIES ────────────────────────────────────────────────────
 *
 * "Required when X" must never become "required for every BuildHub provider".
 * `public_procurement_only` exists as its own value rather than as a condition
 * string because it is the condition most likely to be wrongly generalised:
 * several GCC contractor classification schemes exist to qualify bidders for
 * government tenders, and applying one to a homeowner's bathroom RFQ would
 * exclude most of the market for no legal reason.
 */
export const REQUIREMENT_APPLICABILITIES = [
  'all_providers',
  'public_procurement_only',
  'conditional',
] as const;
export type RequirementApplicability = (typeof REQUIREMENT_APPLICABILITIES)[number];

/**
 * ── WHAT SATISFIES IT ──────────────────────────────────────────────────
 *
 * A government may demand a stack of documents in order to ISSUE a licence.
 * Once it has issued one, BuildHub verifying the resulting licence is better
 * than collecting the same stack again: it is less to ask of the provider,
 * less to store, and it checks the authoritative outcome rather than its
 * inputs. Document upload is the fallback, not the default.
 */
export const VERIFICATION_METHODS = [
  'registration_number',
  'licence_number',
  'classification_grade',
  'professional_membership',
  'certificate',
  'document_upload',
  'manual_review',
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export type RequirementAuthority = {
  name: string;
  nameAr?: string;
  /**
   * Set only where the authority is NOT market-wide - a Dubai or Abu Dhabi
   * body rather than a federal one. Uses ISO 3166-2 style (`AE-DU`, `AE-AZ`).
   */
  jurisdiction?: string;
};

/**
 * ── PROVENANCE, AND THE HONEST ABSENCE OF IT ────────────────────────────
 *
 * Two states, and the unverified one carries the open question rather than a
 * blank. An array of requirements whose origin nobody can reconstruct is
 * exactly what this replaces: when a regulation changes, the first question is
 * "where did we get this, and when" and a configuration that cannot answer it
 * has to be re-researched from scratch.
 */
export type RequirementEvidence =
  | {
      state: 'verified';
      /** The body or instrument relied on, named as it names itself. */
      officialSource: string;
      sourceUrl: string;
      /** ISO date the source was read. Not when the rule was made. */
      verifiedOn: string;
      /** How BuildHub read the source into this requirement. */
      interpretation: string;
    }
  | {
      state: 'unverified';
      /** Where to look. Discovery, not authority. */
      candidateSource?: string;
      candidateUrl?: string;
      /** What must be established before this can be relied on. */
      openQuestion: string;
    };

/** A requirement with everything a regulator-backed rule needs behind it. */
export type MarketRequirement = ComplianceRequirement & {
  provenance: RequirementProvenance;
  authority: RequirementAuthority;
  applicability: RequirementApplicability;
  /** Required when `applicability` is `conditional`; the condition in words. */
  applicabilityCondition?: string;
  /**
   * Sub-jurisdictions this applies in. ABSENT means market-wide, which is the
   * common case; a non-empty list narrows it. The commercial market stays `AE`
   * either way - compliance differing by emirate is not a reason to split a
   * currency or a marketplace.
   */
  subJurisdictions?: readonly string[];
  verification: VerificationMethod;
  evidence: RequirementEvidence;
  /** The activity this applies to, where the country's rules distinguish. */
  activities?: readonly string[];
};

/** What BuildHub knows about one market's requirements, per role. */
export type MarketComplianceConfig = {
  marketCode: string;
  /**
   * Set when the whole market is awaiting research, so the reason is visible
   * without inspecting an empty object.
   */
  note?: string;
  requirements: Partial<Record<ComplianceRole, readonly MarketRequirement[]>>;
};

/**
 * ── WHAT A PROVIDER IS ACTUALLY ASKED FOR ───────────────────────────────
 *
 * The context a provider establishes during onboarding. An Oman contractor
 * gets Oman contractor requirements; a Dubai engineer gets the federal ones
 * plus Dubai's; nobody is shown every GCC requirement.
 */
export type ComplianceContext = {
  marketCode: string;
  role: ComplianceRole;
  /** Where in the market they operate, e.g. `AE-DU`. */
  subJurisdiction?: string | null;
  /**
   * Whether they are seeking PUBLIC-SECTOR work.
   *
   * Defaults to false, deliberately. BuildHub today serves private buyers, so
   * assuming otherwise would impose a tender-board classification on a
   * homeowner's RFQ. When BuildHub supports government procurement this flag
   * turns the same configured requirements on, without re-researching them.
   */
  publicProcurement?: boolean;
  /** The licensed activity, where the country's rules distinguish by it. */
  activity?: string | null;
};

/**
 * The requirements that actually apply to this provider.
 *
 * An unconfigured market returns EMPTY, never another market's list. An empty
 * list is a visible gap that stops an onboarding; a borrowed list sends a
 * professional to the wrong ministry with the wrong papers.
 */
export function applicableRequirements(
  config: MarketComplianceConfig | undefined,
  context: ComplianceContext,
): MarketRequirement[] {
  if (!config || config.marketCode !== context.marketCode) return [];
  const forRole = config.requirements[context.role];
  if (!forRole) return [];

  return forRole.filter(requirement => {
    // PUBLIC PROCUREMENT IS OPT-IN. See `publicProcurement` above.
    if (requirement.applicability === 'public_procurement_only'
      && context.publicProcurement !== true) return false;

    // SUB-JURISDICTION. Absent means market-wide and always applies; a list
    // narrows it, and a provider who has not stated where they operate is not
    // shown a requirement that may not apply to them.
    if (requirement.subJurisdictions && requirement.subJurisdictions.length > 0) {
      if (!context.subJurisdiction) return false;
      if (!requirement.subJurisdictions.includes(context.subJurisdiction)) return false;
    }

    // ACTIVITY, same rule: a narrowing list only narrows.
    if (requirement.activities && requirement.activities.length > 0) {
      if (!context.activity) return false;
      if (!requirement.activities.includes(context.activity)) return false;
    }
    return true;
  });
}

export type MarketComplianceReadiness =
  | { ready: true; verifiedRequirements: number }
  | {
      ready: false;
      reason: 'unconfigured' | 'unverified_requirements';
      /** The open questions, so the gap is actionable rather than a count. */
      openQuestions: string[];
    };

/**
 * Whether a market's compliance configuration is fit to gate an activation.
 *
 * ── UNVERIFIED BLOCKS, AND IT BLOCKS LOUDLY ─────────────────────────────
 *
 * One unverified requirement is enough. A market whose rules are half
 * established cannot approve a provider against them, because the half that is
 * missing may be the one that matters - and approving anyway would make
 * BuildHub's approval a statement it has no basis for.
 *
 * This gates ACTIVATION, not a running market: a market already operating
 * keeps operating while its provenance is being recorded. That is a deliberate
 * asymmetry, and the honest reading of it is that Egypt's own configuration
 * predates this architecture and has not yet been evidenced either.
 */
export function marketComplianceReadiness(
  config: MarketComplianceConfig | undefined,
): MarketComplianceReadiness {
  if (!config) return { ready: false, reason: 'unconfigured', openQuestions: [] };

  const all = Object.values(config.requirements).flatMap(list => list ?? []);
  if (all.length === 0) {
    return {
      ready: false, reason: 'unconfigured',
      openQuestions: config.note ? [config.note] : [],
    };
  }
  const unverified = all.filter(requirement => requirement.evidence.state === 'unverified');
  if (unverified.length > 0) {
    return {
      ready: false,
      reason: 'unverified_requirements',
      openQuestions: unverified.map(requirement =>
        `${requirement.type} (${requirement.authority.name}): `
        + (requirement.evidence.state === 'unverified' ? requirement.evidence.openQuestion : '')),
    };
  }
  return { ready: true, verifiedRequirements: all.length };
}

/**
 * Whether a requirement may be presented to a provider as a legal obligation.
 *
 * Exists so the UI asks this question rather than reading `required`, which
 * cannot distinguish a ministry's rule from BuildHub's own.
 */
export function isGovernmentObligation(requirement: MarketRequirement): boolean {
  return requirement.provenance === 'legal_requirement';
}
