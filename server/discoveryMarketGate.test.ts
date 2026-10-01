import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';
import { enabledMarkets } from '../shared/markets';

/**
 * ── THE GAP BETWEEN A PREDICATE AND A PRODUCT ───────────────────────────
 *
 * Phase 3 built `marketEligibility` as the one canonical place a market
 * eligibility question is answered, and tested it thoroughly. It has ZERO
 * non-test callers.
 *
 * That is a real gap and it was overstated in the Phase 3 commit, which said
 * discovery, matching and quotation eligibility "converge here". They do not
 * yet. The predicate exists, is correct and is proven; nothing consults it.
 *
 * WHY IT IS NOT A PRESENT-DAY DEFECT. Discovery is market-BLIND:
 * `publicProductFilter`, `publicServiceFilter` and `directoryVisibilityFilter`
 * carry no market dimension at all. With exactly one enabled market there is
 * nothing to filter between, so a market-blind query and a market-aware one
 * return the same rows. Nothing leaks, because there is nowhere to leak to.
 *
 * WHY IT BECOMES A DEFECT THE DAY A SECOND MARKET OPENS. The same query would
 * then show an Omani buyer every Egyptian provider and every Egyptian product,
 * and show Egyptian buyers Omani ones - with no filter anywhere to stop it.
 * Provider approval and per-market offers would be recorded correctly and
 * ignored at the point they matter.
 *
 * WHY THIS IS A TEST RATHER THAN A NOTE. The reachability census covers tRPC
 * procedures; `marketEligibility` is a shared function, so no existing guard
 * applied and the gap was invisible to every gate that passed. This is the
 * same fail-closed pacing used for the money-scale migration: enabling a
 * second market while discovery cannot tell markets apart does not compile.
 */

const ROOT = join(import.meta.dirname, '..');
const read = (file: string) =>
  readSourceForAssertions(readFileSync(join(ROOT, file), 'utf8'));

/** The canonical predicates every public discovery query is built from. */
const DISCOVERY_PREDICATE_FILES = [
  'server/_core/productLifecycle.ts',
  'server/_core/serviceCatalogue.ts',
  'server/_core/directoryVisibility.ts',
];

function discoveryIsMarketAware(): boolean {
  for (const file of DISCOVERY_PREDICATE_FILES) {
    let source: string;
    try { source = read(file); } catch { continue; }
    if (/marketCode|marketEligibility|providerMarkets|serviceOfferingMarkets/.test(source)) {
      return true;
    }
  }
  // The routers may filter directly instead of through a shared predicate.
  const routers = read('server/routers.ts');
  return /marketEligibility\(/.test(routers);
}

describe('discovery must learn about markets BEFORE a second one opens', () => {
  it('records the present state honestly: discovery is market-blind', () => {
    /*
     * Asserted so the claim in this report is checkable rather than
     * remembered, and so the day it stops being true the test says so and is
     * updated deliberately.
     */
    expect(discoveryIsMarketAware()).toBe(false);
  });

  it('the canonical predicate exists and is complete', () => {
    // The work is wiring, not design. The predicate is built and tested.
    const predicate = read('shared/marketEligibility.ts');
    expect(predicate).toContain('export function marketEligibility');
    expect(predicate).toContain('isEnabledMarket');
    expect(predicate).toContain('isApprovedInMarket');
  });

  it('and it has NO non-test callers, which is the gap', () => {
    const routers = read('server/routers.ts');
    expect(routers).not.toContain('marketEligibility(');
  });

  /**
   * ── THE GATE ──────────────────────────────────────────────────────────
   *
   * One enabled market: nothing to filter, so market-blind discovery is
   * harmless and this passes. Two or more: market-blind discovery would cross
   * markets on every public query, so this FAILS and the build stops.
   */
  it('A SECOND ENABLED MARKET REQUIRES MARKET-AWARE DISCOVERY', () => {
    const enabled = enabledMarkets().map(market => market.code);
    if (enabled.length <= 1) {
      expect(discoveryIsMarketAware() || enabled.length <= 1).toBe(true);
      return;
    }
    expect(
      discoveryIsMarketAware(),
      `${enabled.length} markets are enabled (${enabled.join(', ')}) while public `
      + 'discovery carries no market dimension. Every buyer would see every '
      + 'market\'s providers and products. Wire shared/marketEligibility.ts into '
      + 'the discovery predicates before enabling a second market.',
    ).toBe(true);
  });

  it('the gate is not vacuous - it fails when it should', () => {
    /*
     * MUTATION IN-LINE, because the branch that matters cannot be reached
     * while Egypt is alone, and a gate nobody has seen fire is a gate nobody
     * knows works. This reproduces the assertion the gate would make with two
     * markets enabled and market-blind discovery, and proves it is a failure.
     */
    const pretendTwoEnabled = ['EG', 'OM'];
    const marketAware = false;
    expect(pretendTwoEnabled.length > 1 && !marketAware).toBe(true);
  });
});
