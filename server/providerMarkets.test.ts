import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isApprovedInMarket, approvedMarkets, primaryMarketIsServed, isLegalCountryCode,
  isProviderMarketStatus, PROVIDER_MARKET_STATUSES, type ProviderMarketRow,
} from '../shared/providerMarkets';
import { MARKETS } from '../shared/markets';

/**
 * ── APPROVAL IN ONE MARKET AUTHORISES NOTHING IN ANOTHER ────────────────
 *
 * The owner's Phase 1 rule, stated in both directions and tested in both.
 * Before this, approval was one global flag granted against Egypt's compliance
 * requirements - the only set configured - so every approved provider was
 * approvable everywhere the day a second market opened.
 */

const ROOT = join(import.meta.dirname, '..');
const row = (marketCode: string, status: ProviderMarketRow['status'] = 'approved'): ProviderMarketRow =>
  ({ marketCode, status });

describe('per-market approval is isolated', () => {
  it('Egypt approval does NOT imply any GCC market', () => {
    const egyptOnly = [row('EG')];
    for (const code of ['SA', 'AE', 'QA', 'KW', 'BH', 'OM']) {
      expect(isApprovedInMarket(egyptOnly, code), `EG approval leaked into ${code}`).toBe(false);
    }
    expect(isApprovedInMarket(egyptOnly, 'EG')).toBe(true);
  });

  it('and GCC approval does NOT imply Egypt', () => {
    // The reverse direction, which is the one easily forgotten: a provider
    // onboarded for Oman has met Omani requirements, not Egyptian ones.
    const omanOnly = [row('OM')];
    expect(isApprovedInMarket(omanOnly, 'EG')).toBe(false);
    expect(isApprovedInMarket(omanOnly, 'OM')).toBe(true);
  });

  it('approval in two markets is approval in exactly those two', () => {
    const rows = [row('OM'), row('SA')];
    expect(approvedMarkets(rows).sort()).toEqual(['OM', 'SA']);
    for (const code of ['EG', 'AE', 'QA', 'KW', 'BH']) {
      expect(isApprovedInMarket(rows, code), `leaked into ${code}`).toBe(false);
    }
  });

  it('a market with NO ROW is not approved - absence is the answer', () => {
    /*
     * The behaviour being removed. It would be easy to treat a missing row as
     * "fall back to the global approval", and that is exactly how an Egyptian
     * approval would come to authorise Omani work.
     */
    expect(isApprovedInMarket([], 'EG')).toBe(false);
    expect(isApprovedInMarket([], 'OM')).toBe(false);
  });

  it('every non-approved status is NOT approval', () => {
    for (const status of PROVIDER_MARKET_STATUSES.filter(s => s !== 'approved')) {
      expect(isApprovedInMarket([row('EG', status)], 'EG'), `${status} read as approved`)
        .toBe(false);
    }
  });

  it('an unknown or malformed market code is never approved', () => {
    const rows = [row('ZZ'), row('')];
    for (const code of ['ZZ', '', null, undefined, 'eg', 'EGY']) {
      expect(isApprovedInMarket(rows, code as string), `${String(code)} was approved`).toBe(false);
    }
    // And a corrupt row does not pollute `approvedMarkets` with a non-market.
    expect(approvedMarkets(rows)).toEqual([]);
  });

  it('the status vocabulary is the SAME five as the global onboarding enum', () => {
    /*
     * Asserted against the schema rather than a copied list. Two status enums
     * for the same kind of decision need a mapping between them, and mappings
     * are where "rejected" quietly becomes "pending".
     */
    const schema = readFileSync(join(ROOT, 'drizzle/schema.ts'), 'utf8');
    const onboarding = /onboardingStatus',\s*\[([^\]]+)\]/.exec(schema);
    expect(onboarding, 'users.onboardingStatus enum not found').not.toBeNull();
    const globalStates = [...onboarding![1].matchAll(/'(\w+)'/g)].map(m => m[1]).sort();
    expect([...PROVIDER_MARKET_STATUSES].sort()).toEqual(globalStates);
  });

  it('isProviderMarketStatus refuses anything outside the five', () => {
    for (const value of PROVIDER_MARKET_STATUSES) expect(isProviderMarketStatus(value)).toBe(true);
    for (const value of ['pending', 'active', 'APPROVED', '', null, 1]) {
      expect(isProviderMarketStatus(value), `${String(value)} accepted`).toBe(false);
    }
  });
});

describe('the primary market must be one the provider serves', () => {
  it('a primary with a matching row is consistent', () => {
    expect(primaryMarketIsServed('OM', [row('OM'), row('SA')])).toBe(true);
  });

  it('a primary with NO row is inconsistent', () => {
    expect(primaryMarketIsServed('OM', [row('SA')])).toBe(false);
    expect(primaryMarketIsServed('OM', [])).toBe(false);
  });

  it('NOT SET is consistent, and is not backfilled from an approval', () => {
    /*
     * A provider who has not named a primary market has contradicted nothing.
     * The column is nullable on purpose: an approval for a market proves
     * BuildHub approved them there, NOT that it is where they mainly work -
     * the Omani vendor who opened this workstream is the standing proof that
     * those are different claims.
     */
    for (const absent of [null, undefined, '']) {
      expect(primaryMarketIsServed(absent, [row('EG')])).toBe(true);
    }
  });

  it('a primary market that is not APPROVED is still "served"', () => {
    // Deliberate: this invariant is about profile consistency, not authority.
    // The approval decision is read from the rows, so an under-review primary
    // grants nothing - and conflating the two checks would make a pending
    // application look like a data fault.
    expect(primaryMarketIsServed('OM', [row('OM', 'under_review')])).toBe(true);
    expect(isApprovedInMarket([row('OM', 'under_review')], 'OM')).toBe(false);
  });
});

describe('legal country is wider than the market registry', () => {
  it('accepts a country BuildHub does not operate in', () => {
    // A Jordanian contractor serving Saudi Arabia is legitimate. Validating
    // legal country against MarketCode would reject them.
    for (const code of ['JO', 'LB', 'TR', 'GB', 'IN']) {
      expect(isLegalCountryCode(code), `${code} rejected`).toBe(true);
    }
  });

  it('accepts every market code too, without the two being interchangeable', () => {
    for (const market of MARKETS) expect(isLegalCountryCode(market.code)).toBe(true);
  });

  it('refuses anything that is not two uppercase letters', () => {
    for (const bad of ['eg', 'EGY', 'E', '', '12', 'E1', null, undefined, 'EG ']) {
      expect(isLegalCountryCode(bad), `${String(bad)} accepted`).toBe(false);
    }
  });
});

describe('the migration records what an approval MEANT, and no more', () => {
  const sql = readFileSync(join(ROOT, 'drizzle/0065_provider_market_identity.sql'), 'utf8');

  /*
   * SQL COMMENTS STRIPPED, AND STATEMENTS SPLIT.
   *
   * `readSourceForAssertions` strips JS/TS comment syntax, not SQL's `--`, so
   * the first version of these guards matched the migration's own explanation
   * of what it deliberately does NOT do. And matching `UPDATE[\s\S]*column`
   * across a whole file is not an assertion about a statement - it fires when
   * the two words appear anywhere, in either order of relevance. So: comments
   * out, then one statement at a time.
   */
  const statements = sql
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean);

  const writesTo = (column: string) => statements.filter(statement =>
    /^(INSERT|UPDATE)/i.test(statement) && statement.includes(column));

  it('backfills only globally-approved providers, and only into Egypt', () => {
    expect(sql).toMatch(/INSERT INTO `providerMarkets`/);
    expect(sql).toMatch(/onboardingStatus` = 'approved'/);
    expect(sql).toMatch(/'EG', 'approved'/);
  });

  it('restricts the backfill to provider roles', () => {
    // An approved HOMEOWNER is not a provider and must not acquire a market
    // approval row; verified against a real database as well as asserted here.
    expect(sql).toMatch(/userRole` IN \('contractor','supplier','engineer','architect','project_manager'\)/);
  });

  it('does NOT backfill primaryMarketCode from the approval', () => {
    expect(writesTo('primaryMarketCode')).toEqual([]);
  });

  it('does NOT parse the free-text country column into legalCountryCode', () => {
    /*
     * `vendorProfiles.country` holds "Egypt", "EG", "Cairo, Egypt" and blanks.
     * Guessing a legal jurisdiction from a display string is how a compliance
     * decision gets made by a regex.
     */
    expect(writesTo('legalCountryCode')).toEqual([]);
    // And nothing reads the display column at all.
    expect(statements.filter(statement => statement.includes('`country`')
      && /^(INSERT|UPDATE)/i.test(statement))).toEqual([]);
  });

  it('adds nothing NOT NULL without a default, so the deploy stays backward compatible', () => {
    // The migration runs BEFORE the new code is live, so the old release runs
    // against the new schema. A NOT NULL column with no default would break
    // every insert the previous release makes.
    const added = [...statements.join(';').matchAll(/ADD COLUMN `(\w+)`([^;]*)/g)];
    expect(added.length).toBeGreaterThan(0);
    for (const [, name, rest] of added) {
      if (/NOT NULL/i.test(rest)) {
        expect(rest, `${name} is NOT NULL with no default`).toMatch(/DEFAULT/i);
      }
    }
  });
});
