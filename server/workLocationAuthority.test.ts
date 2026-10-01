import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';
import { marketEligibility, type MarketOfferRow } from '../shared/marketEligibility';
import { decideProjectMarketChange } from '../shared/projectMarketChange';
import { MARKETS, currencyForMarket, fractionDigitsFor, enabledMarkets } from '../shared/markets';
import { BILLING_CURRENCY, SUPPORTED_CURRENCIES } from '../shared/billing';
import type { ProviderMarketRow } from '../shared/providerMarkets';

const ROOT = join(import.meta.dirname, '..');
const ROUTERS = readSourceForAssertions(readFileSync(join(ROOT, 'server/routers.ts'), 'utf8'));

/**
 * ── WHERE THE WORK IS DECIDES THE MONEY ─────────────────────────────────
 *
 * Owner directive Phase 3. The chain, and nothing may short-circuit it:
 *
 *   work location -> BuildHub market -> RFQ currency -> quotation currency
 */

describe('the chain is server-derived, end to end', () => {
  it('an RFQ against a project takes the PROJECT market, and a conflict REFUSES', () => {
    /*
     * This used to read the project's market and silently discard a conflicting
     * one sent by the client. That is the right outcome by the wrong route: a
     * client that believes it is filing an Omani RFQ against a Cairo project
     * got a Cairo RFQ with no indication anything was overridden, and the
     * figures a supplier later quoted were in a currency the requester never
     * saw chosen.
     */
    const create = ROUTERS.slice(ROUTERS.indexOf('let marketCode: MarketCode = resolveImplicitMarket();'));
    const body = create.slice(0, 2600);
    expect(body).toContain('input.marketCode !== project.marketCode');
    expect(body).toMatch(/code: 'BAD_REQUEST'/);
    expect(body).toContain('marketCode = project.marketCode;');
  });

  it("a project in a market Rakiza no longer serves refuses, rather than becoming Egyptian", () => {
    // This fell through to the implicit market, which would have turned an
    // Omani project's RFQ into an Egyptian one the moment Oman was disabled.
    const create = ROUTERS.slice(ROUTERS.indexOf('let marketCode: MarketCode = resolveImplicitMarket();'), );
    expect(create.slice(0, 2600)).toContain('!isEnabledMarket(project.marketCode)');
  });

  it('the quotation currency comes from the RFQ, and the provider cannot send one', () => {
    const submit = ROUTERS.slice(ROUTERS.indexOf('const resolvedCurrency = rfq.currency'));
    expect(submit.slice(0, 700)).toContain('const quotationCurrency = resolvedCurrency;');
    // Not an input field at all: nothing to validate because nothing can be sent.
    const input = ROUTERS.slice(
      ROUTERS.indexOf('submitQuotation'),
      ROUTERS.indexOf('submitQuotation') + 1800,
    );
    expect(input).not.toMatch(/currency: z\./);
  });

  it('nothing in the market resolution reads IP, locale or geolocation', () => {
    const forbidden = [/req\.ip/, /x-forwarded-for/i, /geoip/i, /navigator\.language/, /acceptLanguage/i];
    const region = ROUTERS.slice(
      ROUTERS.indexOf('let marketCode: MarketCode = resolveImplicitMarket();') - 500,
      ROUTERS.indexOf('let marketCode: MarketCode = resolveImplicitMarket();') + 2600,
    );
    for (const pattern of forbidden) {
      expect(region, `${pattern} near market resolution`).not.toMatch(pattern);
    }
  });

  it('projects.update still accepts no market field - the change is its own operation', () => {
    const update = ROUTERS.slice(
      ROUTERS.indexOf('update: protectedProcedure'),
      ROUTERS.indexOf('changeMarket: protectedProcedure'),
    );
    expect(update.length).toBeGreaterThan(0);
    expect(update).not.toMatch(/marketCode: z\./);
    expect(update).not.toMatch(/currency: z\./);
  });

  it('changeMarket requires a reason and records an audit event', () => {
    const change = ROUTERS.slice(ROUTERS.indexOf('changeMarket: protectedProcedure'));
    const body = change.slice(0, 4200);
    expect(body).toMatch(/reason: z\.string\(\)\.min\(3\)/);
    expect(body).toContain("action: 'project_market_changed'");
    // The currency follows the market, or jurisdiction and money disagree.
    expect(body).toContain('requireCurrencyForMarket(decision.targetMarketCode)');
  });
});

describe('the canonical eligibility predicate', () => {
  const approved = (code: string): ProviderMarketRow[] => [{ marketCode: code, status: 'approved' }];
  const offer = (code: string, status = 'active'): MarketOfferRow[] => [{ marketCode: code, status }];
  const ask = (over: Partial<Parameters<typeof marketEligibility>[0]> = {}) => marketEligibility({
    marketCode: 'EG', providerMarkets: approved('EG'), offers: offer('EG'),
    requireOffer: true, existingRulesPass: true, ...over,
  });

  it('all four conditions met is eligible', () => {
    expect(ask()).toEqual({ eligible: true, marketCode: 'EG' });
  });

  it('A DATABASE ROW IS NOT AN ENABLED MARKET', () => {
    /*
     * The most important refusal here. Phases 1-3 gave the schema
     * providerMarkets rows and serviceOfferingMarkets offers for markets that
     * are enabled:false, because the architecture must be testable before
     * activation. None of it may make a disabled market discoverable,
     * matchable or quotable - activation stays a registry decision the owner
     * makes, not an emergent property of data.
     */
    for (const code of ['SA', 'AE', 'QA', 'KW', 'BH', 'OM']) {
      expect(ask({
        marketCode: code, providerMarkets: approved(code), offers: offer(code),
      }), code).toEqual({ eligible: false, reason: 'market_disabled' });
    }
  });

  it('enabled is checked BEFORE approval and before offers', () => {
    // So a disabled market cannot be reported as an approval problem, which
    // would invite someone to "fix" it by approving a provider.
    expect(ask({ marketCode: 'OM', providerMarkets: [], offers: [] }))
      .toEqual({ eligible: false, reason: 'market_disabled' });
  });

  it('an unknown code is a FAULT, a known-but-disabled one is a DECISION', () => {
    expect(ask({ marketCode: 'ZZ' })).toEqual({ eligible: false, reason: 'unknown_market' });
    expect(ask({ marketCode: 'OM' })).toEqual({ eligible: false, reason: 'market_disabled' });
    for (const absent of [null, undefined, '']) {
      expect(ask({ marketCode: absent }), String(absent))
        .toEqual({ eligible: false, reason: 'unknown_market' });
    }
  });

  it('approval in another market is not approval here', () => {
    expect(ask({ providerMarkets: approved('OM') }))
      .toEqual({ eligible: false, reason: 'provider_not_approved' });
  });

  it('a non-approved status in the right market is not approval', () => {
    for (const status of ['not_started', 'under_review', 'update_required', 'rejected'] as const) {
      expect(ask({ providerMarkets: [{ marketCode: 'EG', status }] }), status)
        .toEqual({ eligible: false, reason: 'provider_not_approved' });
    }
  });

  it('approved but with NO active offer is not discoverable for that service', () => {
    expect(ask({ offers: [] })).toEqual({ eligible: false, reason: 'no_active_offer' });
    for (const status of ['draft', 'inactive', 'archived']) {
      expect(ask({ offers: offer('EG', status) }), status)
        .toEqual({ eligible: false, reason: 'no_active_offer' });
    }
  });

  it('an offer in a DIFFERENT market does not satisfy this one', () => {
    expect(ask({ offers: offer('OM') })).toEqual({ eligible: false, reason: 'no_active_offer' });
  });

  it('requireOffer:false asks the provider-level question only', () => {
    // "May this business appear in this market's directory" is a different
    // question from "may this service be quoted here", and inferring one from
    // an empty offer list is how a provider with no priced service becomes
    // discoverable for it.
    expect(ask({ offers: [], requireOffer: false })).toEqual({ eligible: true, marketCode: 'EG' });
  });

  it('the existing rules still have a veto', () => {
    expect(ask({ existingRulesPass: false })).toEqual({ eligible: false, reason: 'existing_rules' });
  });

  it('MARKET INTEREST IS NOT AN INPUT, so it can never count as approval', () => {
    // Interest is informational. A provider who expressed interest in Oman has
    // exactly the eligibility of one who did not - guaranteed by the predicate
    // being unable to see it.
    const source = readSourceForAssertions(
      readFileSync(join(ROOT, 'shared/marketEligibility.ts'), 'utf8'));
    for (const forbidden of [/interest/i, /legalCountry/i, /\bip\b/i, /locale/i, /geo/i, /subscription/i, /billing/i]) {
      expect(source, `${forbidden} reachable by the predicate`).not.toMatch(forbidden);
    }
  });
});

describe('changing a project market: every lifecycle boundary', () => {
  const state = (over: Partial<Parameters<typeof decideProjectMarketChange>[0]['state']> = {}) => ({
    rfqStatuses: [] as string[], hasQuotations: false, hasAcceptedQuotation: false, ...over,
  });
  const decide = (over: Partial<Parameters<typeof decideProjectMarketChange>[0]> = {}) =>
    decideProjectMarketChange({ currentMarketCode: 'EG', targetMarketCode: 'EG', state: state(), ...over });

  it('NO RFQ: allowed, because nothing has inherited the market yet', () => {
    // Target must differ, so this uses a second market; with one enabled today
    // the same-market refusal is what a real attempt meets, asserted below.
    expect(decide({ targetMarketCode: 'OM' }).allowed).toBe(false); // disabled today
    // The rule itself, with enablement held constant by using the only enabled
    // market as the TARGET and a different current market.
    expect(decide({ currentMarketCode: 'OM', targetMarketCode: 'EG' }))
      .toEqual({ allowed: true, kind: 'no_rfq', targetMarketCode: 'EG' });
  });

  it('AWARD EXISTS: hard refusal, and it outranks every other blocker', () => {
    /*
     * An accepted quotation is a commercial agreement in a currency. Moving the
     * project would restate an agreed price in a currency nobody agreed to. It
     * is checked first so the reason given is the most specific true one - a
     * project with an award also has quotations and a published RFQ.
     */
    expect(decide({
      currentMarketCode: 'OM', targetMarketCode: 'EG',
      state: state({ rfqStatuses: ['awarded'], hasQuotations: true, hasAcceptedQuotation: true }),
    })).toEqual({ allowed: false, reason: 'award_exists' });
  });

  it('QUOTATION EXISTS: hard refusal', () => {
    // Suppliers priced work against a stated market. Re-denominating their
    // numbers without them is not a cascade, it is a rewrite of their offer.
    expect(decide({
      currentMarketCode: 'OM', targetMarketCode: 'EG',
      state: state({ rfqStatuses: ['open'], hasQuotations: true }),
    })).toEqual({ allowed: false, reason: 'quotation_exists' });
  });

  it('PUBLISHED RFQ: refusal, with the close-and-recreate path', () => {
    for (const status of ['open', 'closed', 'awarded']) {
      expect(decide({
        currentMarketCode: 'OM', targetMarketCode: 'EG',
        state: state({ rfqStatuses: [status] }),
      }), status).toEqual({ allowed: false, reason: 'published_rfq' });
    }
  });

  it('a DISABLED target refuses - a project cannot move into a market Rakiza does not serve', () => {
    for (const code of ['SA', 'AE', 'QA', 'KW', 'BH', 'OM']) {
      expect(decide({ targetMarketCode: code }), code)
        .toEqual({ allowed: false, reason: 'target_disabled' });
    }
  });

  it('an unknown target refuses', () => {
    for (const bad of ['ZZ', '', null, undefined]) {
      expect(decide({ targetMarketCode: bad }), String(bad))
        .toEqual({ allowed: false, reason: 'unknown_target' });
    }
  });

  it('a NO-OP refuses, so no audit records a change that did not happen', () => {
    expect(decide({ currentMarketCode: 'EG', targetMarketCode: 'EG' }))
      .toEqual({ allowed: false, reason: 'same_market' });
  });

  it('the draft-cascade branch exists but is UNREACHABLE today, and says so', () => {
    /*
     * rfqs.status is open | closed | awarded, with no draft state, so every RFQ
     * is published and the cascade branch cannot be reached through the
     * product. It exists because the owner specified the behaviour and a draft
     * state may arrive. Exercised here directly so it is tested code rather
     * than dead code that merely looks handled.
     */
    const schema = readFileSync(join(ROOT, 'drizzle/schema.ts'), 'utf8');
    const rfqStatus = /rfqs[\s\S]{0,4000}?mysqlEnum\('status', \[([^\]]+)\]/.exec(schema);
    expect(rfqStatus).not.toBeNull();
    expect(rfqStatus![1]).not.toContain('draft');

    expect(decide({
      currentMarketCode: 'OM', targetMarketCode: 'EG',
      state: state({ rfqStatuses: ['some_future_draft_state'] }),
    })).toEqual({ allowed: true, kind: 'draft_cascade', targetMarketCode: 'EG' });
  });
});

describe('GCC SCENARIO MATRIX: all seven registered markets', () => {
  /**
   * The owner's matrix. The currency chain is exercised for every market
   * WITHOUT enabling any of them, because `currencyForMarket` and the money
   * scale are properties of the registry rather than of enablement - so the
   * derivation can be proven today and the enablement guard stays intact.
   */
  const EXPECTED: Record<string, { currency: string; digits: number }> = {
    EG: { currency: 'EGP', digits: 2 },
    SA: { currency: 'SAR', digits: 2 },
    AE: { currency: 'AED', digits: 2 },
    QA: { currency: 'QAR', digits: 2 },
    KW: { currency: 'KWD', digits: 3 },
    BH: { currency: 'BHD', digits: 3 },
    OM: { currency: 'OMR', digits: 3 },
  };

  it('every registered market is in the matrix, and vice versa', () => {
    // So a market added to the registry cannot slip past this suite.
    expect(MARKETS.map(market => market.code).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))(
    '%s: work market -> currency -> precision',
    (code, expected) => {
      expect(currencyForMarket(code)).toBe(expected.currency);
      expect(fractionDigitsFor(expected.currency)).toBe(expected.digits);
    },
  );

  it.each(['KW', 'BH', 'OM'])('%s keeps a third decimal through the whole chain', code => {
    const currency = currencyForMarket(code)!;
    expect(fractionDigitsFor(currency)).toBe(3);
    // The column that must hold it, re-derived from the schema rather than
    // remembered.
    const schema = readFileSync(join(ROOT, 'drizzle/schema.ts'), 'utf8');
    // The authoritative payable, re-derived rather than remembered. Whitespace
    // in the schema is cosmetic, so the match is on the arguments.
    expect(schema).toMatch(/decimal\('price',\s*\{\s*precision:\s*14,\s*scale:\s*3\s*\}/);
  });

  it('exactly ONE market is enabled, and it is Egypt', () => {
    // The matrix proves the architecture; this proves nothing was activated to
    // make it pass.
    expect(enabledMarkets().map(market => market.code)).toEqual(['EG']);
  });

  it('every market that is not Egypt is commercially inert', () => {
    for (const market of MARKETS.filter(m => m.code !== 'EG')) {
      expect(marketEligibility({
        marketCode: market.code,
        providerMarkets: [{ marketCode: market.code, status: 'approved' }],
        offers: [{ marketCode: market.code, status: 'active' }],
        requireOffer: true, existingRulesPass: true,
      }), market.code).toEqual({ eligible: false, reason: 'market_disabled' });
    }
  });
});

describe('billing stays a separate currency domain', () => {
  it('billing is EGP-only, and that limitation is explicit', () => {
    expect(BILLING_CURRENCY).toBe('EGP');
    expect([...SUPPORTED_CURRENCIES]).toEqual(['EGP']);
  });

  it('no transaction surface reads the billing currency', () => {
    /*
     * The coupling the owner named directly: a quotation currency taken from
     * the supplier's subscription plan. Billing is what a supplier pays
     * BuildHub; it must not follow provider market, project market, RFQ
     * currency or service-offer currency, and nothing commercial may follow it.
     */
    const quotation = ROUTERS.slice(ROUTERS.indexOf('const resolvedCurrency = rfq.currency'), );
    expect(quotation.slice(0, 1500)).not.toMatch(/BILLING_CURRENCY/);
    for (const file of ['shared/marketEligibility.ts', 'shared/serviceOfferingMarkets.ts', 'shared/projectMarketChange.ts']) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(readSourceForAssertions(source), `${file} reads billing`).not.toMatch(/BILLING_CURRENCY|vendorSubscriptions/);
    }
  });

  it('and the GCC commercial work is not blocked by it', () => {
    // Multi-market commerce exists while billing remains single-currency: the
    // two domains are independent, which is the point of keeping them apart.
    expect(currencyForMarket('OM')).toBe('OMR');
    expect(BILLING_CURRENCY).toBe('EGP');
  });
});
