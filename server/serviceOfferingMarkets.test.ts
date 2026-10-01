import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  classifyLegacyOffer, freeTextCountryContradictsEgypt, offerCurrency, mayManageOffer,
  EGYPTIAN_REGISTRATION_INSTRUMENTS, MARKET_MIGRATION_STATES,
  type LegacyOfferEvidence,
} from '../shared/serviceOfferingMarkets';
import { MARKETS, fractionDigitsFor } from '../shared/markets';
import type { ProviderMarketRow } from '../shared/providerMarkets';

const ROOT = join(import.meta.dirname, '..');
const schema = readFileSync(join(ROOT, 'drizzle/schema.ts'), 'utf8');
const migration = readFileSync(join(ROOT, 'drizzle/0066_service_offering_markets.sql'), 'utf8');

const egApproved: ProviderMarketRow[] = [{ marketCode: 'EG', status: 'approved' }];

/** The evidence shape for a provider who IS provably Egyptian. */
const proven = (over: Partial<LegacyOfferEvidence> = {}): LegacyOfferEvidence => ({
  currency: 'EGP',
  hasApprovedEgyptianRegistrationDocument: true,
  providerMarkets: egApproved,
  freeTextCountry: 'Egypt',
  ...over,
});

describe('EGP NEVER MEANS EGYPT ON ITS OWN', () => {
  /*
   * The defect this classifier exists to avoid, named precisely. 0061 defaulted
   * serviceOfferings.currency to EGP reasoning that every offering "was created
   * by a provider in the one market BuildHub operates, priced in Egyptian
   * pounds". A real external user disproved it: a vendor operating in Oman
   * whose listing showed EGP because the platform had nothing else to write.
   * The column records what nobody contradicted, not what anybody chose.
   */
  it('the full evidence set proves an Egypt offer', () => {
    expect(classifyLegacyOffer(proven())).toBe('proven_eg');
  });

  it('THE OMANI VENDOR: EGP + Egyptian papers + Egypt approval, but country says Oman', () => {
    // The case that opened this workstream. Every other signal points at
    // Egypt, and the one free-text field that disagrees is enough to withhold
    // the claim - because publishing their price as an Egyptian offer would
    // relabel a commercial intent they never stated.
    expect(classifyLegacyOffer(proven({ freeTextCountry: 'Oman' }))).toBe('remediation_required');
  });

  it('EGP alone, with no other evidence, proves nothing', () => {
    expect(classifyLegacyOffer({
      currency: 'EGP',
      hasApprovedEgyptianRegistrationDocument: false,
      providerMarkets: [],
      freeTextCountry: null,
    })).toBe('remediation_required');
  });

  it('every single condition is necessary - remove one and it is unproven', () => {
    // Each line is a real failure mode, not a permutation for its own sake.
    expect(classifyLegacyOffer(proven({ currency: 'AED' }))).toBe('remediation_required');
    expect(classifyLegacyOffer(proven({ currency: null }))).toBe('remediation_required');
    expect(classifyLegacyOffer(proven({ hasApprovedEgyptianRegistrationDocument: false })))
      .toBe('remediation_required');
    expect(classifyLegacyOffer(proven({ providerMarkets: [] }))).toBe('remediation_required');
    expect(classifyLegacyOffer(proven({ providerMarkets: [{ marketCode: 'EG', status: 'under_review' }] })))
      .toBe('remediation_required');
    expect(classifyLegacyOffer(proven({ providerMarkets: [{ marketCode: 'OM', status: 'approved' }] })))
      .toBe('remediation_required');
  });

  it('a blank country does not contradict Egypt - silence is not another country', () => {
    for (const blank of [null, undefined, '', '   ']) {
      expect(classifyLegacyOffer(proven({ freeTextCountry: blank })), String(blank)).toBe('proven_eg');
    }
  });

  it('the recognised Egypt spellings do not contradict it', () => {
    for (const spelling of ['Egypt', 'egypt', 'EG', ' eg ', 'مصر', 'Arab Republic of Egypt']) {
      expect(freeTextCountryContradictsEgypt(spelling), spelling).toBe(false);
    }
  });

  it('anything else contradicts it, including an unrecognised string', () => {
    /*
     * CONSERVATIVE BY DESIGN. An unparseable country is not evidence of Egypt,
     * so it withholds the claim. Evidence here can only ever SHRINK the proven
     * set, which is what makes being wrong survivable: a false negative asks a
     * provider to confirm their own price; a false positive publishes a number
     * in a currency they never chose.
     */
    for (const other of ['Oman', 'KSA', 'United Arab Emirates', 'Cairo, Egypt', 'EGYPTX', 'xx']) {
      expect(freeTextCountryContradictsEgypt(other), other).toBe(true);
    }
  });

  it('remediation is the DEFAULT state in the schema, not an assigned one', () => {
    // A row the classifier does not positively prove is unproven, and the safe
    // value is the one a new column arrives in.
    expect(schema).toMatch(/marketMigrationState[\s\S]{0,200}default\('remediation_required'\)/);
    expect(migration).toMatch(/NOT NULL DEFAULT 'remediation_required'/);
  });

  it('the migration requires all four conditions, not just the currency', () => {
    const sql = migration;
    expect(sql).toMatch(/`currency` = 'EGP'/);
    expect(sql).toMatch(/registrationDocuments/);
    expect(sql).toMatch(/providerMarkets/);
    expect(sql).toMatch(/vendorProfiles/);
    // And the Egyptian instruments are named rather than any approved document.
    for (const instrument of EGYPTIAN_REGISTRATION_INSTRUMENTS) {
      expect(sql, `${instrument} missing`).toContain(instrument);
    }
    // The legacy documents it trusts are the unscoped ones, because the column
    // did not exist and Egypt is the only requirement set ever configured.
    expect(sql).toMatch(/`marketCode` IS NULL/);
  });

  it('only proven rows are carried into an authoritative offer', () => {
    expect(migration).toMatch(/INSERT INTO `serviceOfferingMarkets`[\s\S]*marketMigrationState` = 'proven_eg'/);
  });

  it('the migration never converts, relabels or publishes a remediation row', () => {
    /*
     * SQL COMMENTS STRIPPED AND STATEMENTS SPLIT. The migration mentions
     * `currency` legitimately - it READS it in the classifier's WHERE clause
     * and names it in an AFTER clause - so a whole-file regex cannot tell
     * reading a column from writing one. The claim is about writes.
     */
    const statements = migration.split('\n')
      .filter(line => !line.trimStart().startsWith('--')).join('\n')
      .split(';').map(part => part.trim()).filter(Boolean);
    const writes = statements.filter(statement => /^(INSERT|UPDATE)/i.test(statement));
    expect(writes.length).toBeGreaterThan(0);

    // No arithmetic on a price anywhere: no FX, no rate, no multiplication.
    for (const statement of writes) {
      expect(statement).not.toMatch(/price(Min|Max)`?\s*[*\/]/);
    }
    // The legacy currency column is never ASSIGNED. `so.currency = 'EGP'`
    // inside a WHERE is a comparison, so only SET clauses are examined.
    for (const statement of writes) {
      const setClause = /\bSET\b([\s\S]*?)(\bWHERE\b|$)/i.exec(statement)?.[1] ?? '';
      expect(setClause, 'a write assigns the legacy currency').not.toMatch(/`?currency`?\s*=/);
    }
  });

  it('there are exactly two states, so nothing can hide in a third', () => {
    expect([...MARKET_MIGRATION_STATES]).toEqual(['proven_eg', 'remediation_required']);
  });
});

describe('the offer currency is derived, never stored', () => {
  it('serviceOfferingMarkets has NO currency column', () => {
    /*
     * THE STRUCTURAL GUARANTEE. A currency column beside a market column can
     * hold `OM` + `EGP`. Validating at the write closes that for paths that use
     * the validator and leaves it open to every migration, admin script and
     * future router that does not. With no column, the inconsistent state is
     * not representable.
     */
    const table = schema.slice(
      schema.indexOf("export const serviceOfferingMarkets = mysqlTable("),
      schema.indexOf('}));', schema.indexOf("export const serviceOfferingMarkets = mysqlTable(")),
    );
    expect(table.length).toBeGreaterThan(0);
    expect(readSourceForAssertions(table)).not.toMatch(/currency/i);
    /*
     * And in the migration, scoped to the CREATE TABLE. The file mentions
     * `currency` elsewhere on purpose - the classifier reads
     * `serviceOfferings.currency` - so the claim is about this table's columns,
     * not about the word appearing in the file.
     */
    const createTable = migration.slice(
      migration.indexOf('CREATE TABLE `serviceOfferingMarkets`'),
      migration.indexOf(');', migration.indexOf('CREATE TABLE `serviceOfferingMarkets`')),
    );
    expect(createTable.length).toBeGreaterThan(0);
    expect(createTable).not.toMatch(/currency/i);
  });

  it('derives the right currency for all seven registered markets', () => {
    for (const market of MARKETS) {
      expect(offerCurrency(market.code), market.code).toBe(market.currency);
    }
  });

  it('and returns null for an unknown market rather than a fallback', () => {
    for (const bad of ['ZZ', '', null, undefined]) {
      expect(offerCurrency(bad as string), String(bad)).toBeNull();
    }
  });

  it('the three-decimal markets derive a three-decimal currency', () => {
    for (const code of ['OM', 'KW', 'BH']) {
      expect(fractionDigitsFor(offerCurrency(code)), code).toBe(3);
    }
  });

  it('the client cannot send a currency - it is not an input field at all', () => {
    // Stronger than validating it: there is nothing to validate because there
    // is nothing to send.
    const routers = readSourceForAssertions(readFileSync(join(ROOT, 'server/routers.ts'), 'utf8'));
    const start = routers.indexOf('setMarketOffer: complianceProcedure');
    expect(start).toBeGreaterThan(-1);
    const input = routers.slice(start, routers.indexOf('.mutation', start));
    expect(input).not.toMatch(/currency/i);
  });
});

describe('who may manage a market offer', () => {
  const base = { callerId: 7, serviceOwnerId: 7, providerMarkets: egApproved };

  it('the owner, approved in an enabled market, may', () => {
    const decision = mayManageOffer({ ...base, marketCode: 'EG' });
    expect(decision).toEqual({ allowed: true, marketCode: 'EG', currency: 'EGP' });
  });

  it('a DIFFERENT provider may not touch it', () => {
    expect(mayManageOffer({ ...base, callerId: 99, marketCode: 'EG' }))
      .toEqual({ allowed: false, reason: 'not_owner' });
  });

  it('ownership is checked FIRST, so it is not an oracle for competitors status', () => {
    /*
     * A caller probing another provider's service must not learn which markets
     * that provider is approved in. So the ownership failure comes before the
     * market checks, and the reason is the same whatever the market.
     */
    for (const marketCode of ['EG', 'OM', 'ZZ', '']) {
      expect(mayManageOffer({ callerId: 1, serviceOwnerId: 2, marketCode, providerMarkets: [] }).allowed)
        .toBe(false);
      expect(mayManageOffer({ callerId: 1, serviceOwnerId: 2, marketCode, providerMarkets: [] }))
        .toEqual({ allowed: false, reason: 'not_owner' });
    }
  });

  it('a DISABLED market refuses, even with an approval row in it', () => {
    /*
     * A DATABASE ROW IS NOT AN ENABLED MARKET. This is the guard that keeps
     * every GCC market commercially inert while the registry says disabled -
     * a providerMarkets row, a service offer, or both, must not make a
     * disabled market quotable.
     */
    for (const code of ['SA', 'AE', 'QA', 'KW', 'BH', 'OM']) {
      expect(mayManageOffer({
        ...base, marketCode: code,
        providerMarkets: [{ marketCode: code, status: 'approved' }],
      }), code).toEqual({ allowed: false, reason: 'market_disabled' });
    }
  });

  it('approval in ONE market is not approval in another', () => {
    // Egypt-approved provider, asked about Egypt: fine. The reverse direction
    // is covered by the disabled-market guard above and will become the
    // operative check the day a second market is enabled.
    expect(mayManageOffer({ ...base, marketCode: 'EG' }).allowed).toBe(true);
    expect(mayManageOffer({
      ...base, marketCode: 'EG',
      providerMarkets: [{ marketCode: 'OM', status: 'approved' }],
    })).toEqual({ allowed: false, reason: 'not_approved_in_market' });
  });

  it('a non-approved status in the right market still refuses', () => {
    for (const status of ['not_started', 'under_review', 'update_required', 'rejected'] as const) {
      expect(mayManageOffer({ ...base, marketCode: 'EG', providerMarkets: [{ marketCode: 'EG', status }] }), status)
        .toEqual({ allowed: false, reason: 'not_approved_in_market' });
    }
  });

  it('an unknown market code refuses before anything else is considered', () => {
    for (const bad of ['ZZ', 'eg', 'EGY', '', null, undefined]) {
      expect(mayManageOffer({ ...base, marketCode: bad as string }), String(bad))
        .toEqual({ allowed: false, reason: 'unknown_market' });
    }
  });

  it('LEGAL COUNTRY IS NOT AN INPUT - it can never be mistaken for approval', () => {
    /*
     * Where a business is registered says nothing about which markets BuildHub
     * approved it for. The decision function cannot read it, so no caller can
     * accidentally substitute one for the other.
     */
    const source = readSourceForAssertions(
      readFileSync(join(ROOT, 'shared/serviceOfferingMarkets.ts'), 'utf8'));
    const fn = source.slice(source.indexOf('export function mayManageOffer'));
    expect(fn).not.toMatch(/legalCountry/i);
    expect(fn).not.toMatch(/freeTextCountry/i);
  });
});

describe('the cutover: one pricing authority', () => {
  const routers = readSourceForAssertions(readFileSync(join(ROOT, 'server/routers.ts'), 'utf8'));

  it('the per-market offer is what the write path creates', () => {
    expect(routers).toMatch(/db\.insert\(serviceOfferingMarkets\)/);
  });

  it('the legacy price columns are never written by the market-offer path', () => {
    /*
     * READ-NEVER / WRITE-NEVER for authoritative commercial flows. The legacy
     * columns stay physically for one bounded rollback release - canonical
     * migration discipline wants the ballast - but nothing in the new path may
     * reach back to them, or there would be two live pricing systems and no
     * answer to which one a buyer is quoted.
     */
    const start = routers.indexOf('setMarketOffer: complianceProcedure');
    const body = routers.slice(start, routers.indexOf('});', routers.indexOf('return { marketCode', start)));
    expect(body).not.toMatch(/db\.update\(serviceOfferings\)/);
    expect(body).not.toMatch(/serviceOfferings\.price(Min|Max)/);
    expect(body).not.toMatch(/serviceOfferings\.currency/);
  });

  it('the offer read does not fall back to the legacy price', () => {
    const start = routers.indexOf('marketOffers: complianceProcedure');
    const body = routers.slice(start, routers.indexOf('setMarketOffer:', start));
    expect(body).not.toMatch(/serviceOfferings\.price(Min|Max)/);
    expect(body).not.toMatch(/serviceOfferings\.currency/);
  });

  it('the authorization is the shared decision, not re-derived inline', () => {
    // Four conditions assembled differently by a second caller is how one of
    // them goes missing. There is one function and the router calls it.
    const start = routers.indexOf('setMarketOffer: complianceProcedure');
    const body = routers.slice(start, start + 4000);
    expect(body).toContain('mayManageOffer({');
    expect(body).not.toMatch(/isEnabledMarket\(input\.marketCode\)/);
  });
});
