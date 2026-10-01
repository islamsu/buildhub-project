import { describe, expect, it } from 'vitest';
import {
  applicableRequirements, marketComplianceReadiness, isGovernmentObligation,
  REQUIREMENT_PROVENANCES, REQUIREMENT_APPLICABILITIES, VERIFICATION_METHODS,
  type MarketRequirement, type MarketComplianceConfig,
} from '../shared/complianceAuthority';
import { MARKET_COMPLIANCE, marketComplianceConfig } from '../shared/complianceMarkets';
import { MARKETS } from '../shared/markets';
import { getComplianceRequirements } from '../shared/compliance';

/**
 * ── A REQUIREMENT MUST SAY WHO REQUIRES IT, WHEN, AND HOW IT WAS FOUND ──
 *
 * The owner's rule: BuildHub follows each country's actual government
 * requirements, does not translate Egypt's list into GCC equivalents, does not
 * invent a common template, and never presents its own policy as a regulator's.
 */

const base = {
  type: 'x', name: 'X', nameAr: 'X', description: 'd', descriptionAr: 'd', required: false,
  authority: { name: 'A' }, verification: 'document_upload' as const,
  evidence: { state: 'verified' as const, officialSource: 'S', sourceUrl: 'https://a', verifiedOn: '2026-10-01', interpretation: 'i' },
};
const req = (over: Partial<MarketRequirement> = {}): MarketRequirement =>
  ({ ...base, provenance: 'legal_requirement', applicability: 'all_providers', ...over });
const config = (requirements: MarketRequirement[]): MarketComplianceConfig =>
  ({ marketCode: 'ZZ', requirements: { contractor: requirements } });

describe('NOTHING IS VERIFIED, AND THAT IS THE HONEST STATE', () => {
  it('every GCC market is configured and NONE is compliance-ready', () => {
    for (const code of ['SA', 'AE', 'QA', 'KW', 'BH', 'OM']) {
      const readiness = marketComplianceReadiness(marketComplianceConfig(code));
      expect(readiness.ready, `${code} reported ready`).toBe(false);
      expect(readiness.ready === false && readiness.reason).toBe('unverified_requirements');
    }
  });

  it('every requirement in every market carries an OPEN QUESTION', () => {
    /*
     * An unverified entry with a blank question is a to-do nobody can action.
     * The question is what makes this a research worksheet rather than a
     * configuration waiting to be switched on.
     */
    for (const [code, cfg] of Object.entries(MARKET_COMPLIANCE)) {
      for (const list of Object.values(cfg.requirements)) {
        for (const requirement of list ?? []) {
          expect(requirement.evidence.state, `${code}/${requirement.type} claims verified`)
            .toBe('unverified');
          if (requirement.evidence.state === 'unverified') {
            expect(requirement.evidence.openQuestion.length, `${code}/${requirement.type}`)
              .toBeGreaterThan(20);
          }
        }
      }
    }
  });

  it('no unverified requirement DEMANDS anything of a provider', () => {
    // `required` is the legacy field the onboarding UI reads. Nothing may be
    // demanded on the strength of a rule BuildHub has not read.
    for (const cfg of Object.values(MARKET_COMPLIANCE)) {
      for (const list of Object.values(cfg.requirements)) {
        for (const requirement of list ?? []) {
          if (requirement.evidence.state === 'unverified') {
            expect(requirement.required, `${requirement.type} is required but unverified`).toBe(false);
          }
        }
      }
    }
  });

  it('EGYPT is not marked verified merely because it is live', () => {
    /*
     * Egypt's list predates this architecture: a hard-coded array with no
     * authority, source or verified date - the unauditable shape being
     * replaced. Its running behaviour is untouched, and recording it as
     * verified to make the table look finished would be the exact fabrication
     * this file exists to avoid.
     */
    const egypt = marketComplianceConfig('EG')!;
    expect(egypt.note).toMatch(/PROVENANCE NOT YET RECORDED/);
    expect(marketComplianceReadiness(egypt).ready).toBe(false);
    // And the legacy path still serves Egyptian onboarding unchanged.
    expect(getComplianceRequirements('contractor', 'EG').length).toBeGreaterThan(0);
  });

  it('a market with no entry at all is unconfigured, not empty-and-ready', () => {
    expect(marketComplianceReadiness(undefined))
      .toEqual({ ready: false, reason: 'unconfigured', openQuestions: [] });
  });

  it('ONE unverified requirement is enough to block the market', () => {
    // Half-established rules cannot approve a provider: the missing half may
    // be the one that matters, and approving anyway makes BuildHub's approval
    // a statement it has no basis for.
    const mixed = config([
      req(),
      req({ evidence: { state: 'unverified', openQuestion: 'what does the ministry actually require here' } }),
    ]);
    const readiness = marketComplianceReadiness(mixed);
    expect(readiness.ready).toBe(false);
    expect(readiness.ready === false && readiness.openQuestions).toHaveLength(1);
  });

  it('all-verified is ready, so the gate can actually open', () => {
    const readiness = marketComplianceReadiness(config([req(), req()]));
    expect(readiness).toEqual({ ready: true, verifiedRequirements: 2 });
  });
});

describe('government requirement and BuildHub policy never blur', () => {
  it('only a legal_requirement is a government obligation', () => {
    expect(isGovernmentObligation(req({ provenance: 'legal_requirement' }))).toBe(true);
    expect(isGovernmentObligation(req({ provenance: 'buildhub_policy' }))).toBe(false);
    expect(isGovernmentObligation(req({ provenance: 'optional_credential' }))).toBe(false);
  });

  it('the three provenances are distinct and closed', () => {
    // `required: boolean` could not express this: "required by law" and
    // "required by BuildHub" were both `true`, and a provider reading the
    // screen could not tell which.
    expect([...REQUIREMENT_PROVENANCES])
      .toEqual(['legal_requirement', 'buildhub_policy', 'optional_credential']);
  });
});

describe('"required when X" never becomes "required for everyone"', () => {
  it('a public-procurement requirement is HIDDEN from a private-work provider', () => {
    /*
     * The most consequential filter here. Several GCC contractor schemes are
     * administered by tender boards and procurement authorities; applying one
     * to a homeowner's bathroom RFQ would exclude most of a market for no
     * legal reason.
     */
    const cfg = config([req({ applicability: 'public_procurement_only' })]);
    expect(applicableRequirements(cfg, { marketCode: 'ZZ', role: 'contractor' })).toHaveLength(0);
    expect(applicableRequirements(cfg, { marketCode: 'ZZ', role: 'contractor', publicProcurement: false })).toHaveLength(0);
  });

  it('and APPEARS once the provider is seeking public work', () => {
    // The same configured requirement, activated by context rather than
    // re-researched - which is what makes government procurement a future
    // switch instead of a second compliance engine.
    const cfg = config([req({ applicability: 'public_procurement_only' })]);
    expect(applicableRequirements(cfg, { marketCode: 'ZZ', role: 'contractor', publicProcurement: true })).toHaveLength(1);
  });

  it('every discovered tender-board scheme is scoped to procurement, not to all providers', () => {
    // QA, KW, BH and OM discovery all pointed at procurement bodies. Where
    // that is what the configuration says, it must not leak into private work.
    for (const code of ['QA', 'KW', 'BH', 'OM']) {
      const cfg = marketComplianceConfig(code)!;
      const procurementScoped = (cfg.requirements.contractor ?? [])
        .filter(r => r.applicability === 'public_procurement_only');
      expect(procurementScoped.length, `${code} has no procurement-scoped entry`).toBeGreaterThan(0);
      for (const requirement of procurementScoped) {
        expect(applicableRequirements(cfg, { marketCode: code, role: 'contractor' }))
          .not.toContain(requirement);
      }
    }
  });

  it('a conditional requirement states its condition in words', () => {
    for (const cfg of Object.values(MARKET_COMPLIANCE)) {
      for (const list of Object.values(cfg.requirements)) {
        for (const requirement of list ?? []) {
          if (requirement.applicability === 'conditional') {
            expect(requirement.applicabilityCondition, `${requirement.type} has no condition`)
              .toBeTruthy();
          }
        }
      }
    }
  });
});

describe('UAE sub-jurisdiction, without splitting the market', () => {
  it('an emirate-scoped requirement is hidden from a provider who has not named one', () => {
    const uae = marketComplianceConfig('AE')!;
    const engineersWithNoEmirate = applicableRequirements(uae, { marketCode: 'AE', role: 'engineer' });
    expect(engineersWithNoEmirate).toHaveLength(0);
  });

  it('a Dubai engineer gets Dubai, and an Abu Dhabi engineer gets Abu Dhabi', () => {
    /*
     * Discovery showed genuinely different authorities - Abu Dhabi through the
     * Department of Municipalities and Transport, Dubai through Dubai
     * Municipality - so a single federal list would be wrong for both.
     */
    const uae = marketComplianceConfig('AE')!;
    const dubai = applicableRequirements(uae, { marketCode: 'AE', role: 'engineer', subJurisdiction: 'AE-DU' });
    const abuDhabi = applicableRequirements(uae, { marketCode: 'AE', role: 'engineer', subJurisdiction: 'AE-AZ' });
    expect(dubai).toHaveLength(1);
    expect(abuDhabi).toHaveLength(1);
    expect(dubai[0].authority.name).toContain('Dubai');
    expect(abuDhabi[0].authority.name).toContain('Municipalities and Transport');
    expect(dubai[0].type).toBe(abuDhabi[0].type);
    expect(dubai[0]).not.toEqual(abuDhabi[0]);
  });

  it('the UAE remains ONE commercial market with one currency', () => {
    // Compliance differing by emirate is not a reason to split a currency or a
    // marketplace. There is exactly one AE row in the registry.
    const uaeRows = MARKETS.filter(market => market.code.startsWith('AE'));
    expect(uaeRows).toHaveLength(1);
    expect(uaeRows[0].currency).toBe('AED');
  });
});

describe('no country derives its rules from another', () => {
  it('no GCC market reuses Egypt\'s requirement types wholesale', () => {
    /*
     * The specific failure the owner named: translating Egypt's list into GCC
     * equivalents. Shared requirement TYPES are fine - a commercial
     * registration exists in several countries - but a GCC role whose entire
     * type set equals Egypt's is a copy, not research.
     */
    const egyptTypes = (role: 'contractor' | 'engineer' | 'supplier') =>
      getComplianceRequirements(role, 'EG').map(r => r.type).sort().join(',');
    for (const code of ['SA', 'AE', 'QA', 'KW', 'BH', 'OM']) {
      const cfg = marketComplianceConfig(code)!;
      for (const role of ['contractor', 'engineer', 'supplier'] as const) {
        const types = (cfg.requirements[role] ?? []).map(r => r.type).sort().join(',');
        if (types) expect(types, `${code}/${role} mirrors Egypt`).not.toBe(egyptTypes(role));
      }
    }
  });

  it('each market names its own authorities', () => {
    // An authority named in two countries would be a copied assumption.
    const named = new Map<string, string>();
    for (const [code, cfg] of Object.entries(MARKET_COMPLIANCE)) {
      for (const list of Object.values(cfg.requirements)) {
        for (const requirement of list ?? []) {
          const name = requirement.authority.name;
          if (name.startsWith('To be established')) continue;
          const seen = named.get(name);
          expect(seen === undefined || seen === code, `${name} appears in ${seen} and ${code}`).toBe(true);
          named.set(name, code);
        }
      }
    }
    expect(named.size).toBeGreaterThan(5);
  });

  it('a market config only answers for its own market', () => {
    const uae = marketComplianceConfig('AE')!;
    expect(applicableRequirements(uae, { marketCode: 'OM', role: 'engineer' })).toHaveLength(0);
  });
});

describe('verification prefers the authoritative credential over re-collection', () => {
  it('the method vocabulary covers credentials, not only uploads', () => {
    // A government may demand a stack of documents to ISSUE a licence. Once it
    // has, verifying the licence beats collecting the stack again.
    expect(VERIFICATION_METHODS).toContain('licence_number');
    expect(VERIFICATION_METHODS).toContain('registration_number');
    expect(VERIFICATION_METHODS).toContain('classification_grade');
    expect(VERIFICATION_METHODS).toContain('professional_membership');
  });

  it('most configured entries verify a credential rather than an upload', () => {
    const all = Object.values(MARKET_COMPLIANCE)
      .flatMap(cfg => Object.values(cfg.requirements).flatMap(list => list ?? []));
    const uploads = all.filter(r => r.verification === 'document_upload');
    expect(all.length).toBeGreaterThan(20);
    expect(uploads.length, 'document_upload has become the default again').toBeLessThan(all.length / 2);
  });

  it('the applicability vocabulary is closed', () => {
    expect([...REQUIREMENT_APPLICABILITIES])
      .toEqual(['all_providers', 'public_procurement_only', 'conditional']);
  });
});

describe('every discovered source is an official domain', () => {
  it('no candidate URL is a blog or consultancy', () => {
    /*
     * The owner excluded blogs and consultants as authority where an official
     * source exists. Search results mixed ministry pages with consultancy
     * articles, so the filter is asserted rather than trusted.
     */
    const OFFICIAL = /\.gov\.|\.gov$|\.om\/|\.ae\/|\.abudhabi\/|oman\.om|bahrain\.bh|momah\.gov\.sa|dm\.gov\.ae/;
    for (const [code, cfg] of Object.entries(MARKET_COMPLIANCE)) {
      for (const list of Object.values(cfg.requirements)) {
        for (const requirement of list ?? []) {
          if (requirement.evidence.state !== 'unverified') continue;
          const url = requirement.evidence.candidateUrl;
          if (!url) continue;
          expect(url, `${code}/${requirement.type} cites a non-official URL`).toMatch(OFFICIAL);
        }
      }
    }
  });

  it('a candidate URL always comes with the source it belongs to', () => {
    for (const cfg of Object.values(MARKET_COMPLIANCE)) {
      for (const list of Object.values(cfg.requirements)) {
        for (const requirement of list ?? []) {
          if (requirement.evidence.state !== 'unverified') continue;
          if (requirement.evidence.candidateUrl) {
            expect(requirement.evidence.candidateSource).toBeTruthy();
          }
        }
      }
    }
  });
});

describe('the engine shows a provider only what applies to them', () => {
  it('an Oman contractor sees Oman contractor entries, not every GCC rule', () => {
    const oman = marketComplianceConfig('OM')!;
    const forContractor = applicableRequirements(oman, { marketCode: 'OM', role: 'contractor' });
    // The procurement-scoped classification is correctly withheld from private work.
    expect(forContractor).toHaveLength(0);
    const seekingTenders = applicableRequirements(oman, { marketCode: 'OM', role: 'contractor', publicProcurement: true });
    expect(seekingTenders).toHaveLength(1);
    expect(seekingTenders[0].authority.name).toContain('Tender Board');
  });

  it('an unconfigured role returns empty rather than another role\'s list', () => {
    const cfg: MarketComplianceConfig = { marketCode: 'ZZ', requirements: { contractor: [req()] } };
    expect(applicableRequirements(cfg, { marketCode: 'ZZ', role: 'engineer' })).toHaveLength(0);
  });

  it('an activity-scoped requirement needs the activity stated', () => {
    const cfg = config([req({ activities: ['electrical'] })]);
    expect(applicableRequirements(cfg, { marketCode: 'ZZ', role: 'contractor' })).toHaveLength(0);
    expect(applicableRequirements(cfg, { marketCode: 'ZZ', role: 'contractor', activity: 'plumbing' })).toHaveLength(0);
    expect(applicableRequirements(cfg, { marketCode: 'ZZ', role: 'contractor', activity: 'electrical' })).toHaveLength(1);
  });
});
