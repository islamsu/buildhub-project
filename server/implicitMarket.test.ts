import { describe, expect, it } from 'vitest';
import {
  MARKETS, DEFAULT_MARKET, enabledMarkets, implicitMarketFrom,
  resolveImplicitMarket, resolveImplicitCurrency,
  ImplicitMarketUnavailableError, type Market,
} from '../shared/markets';

/**
 * ── THE FAIL-CLOSED RULE THAT PACES GCC ACTIVATION ──────────────────────
 *
 * Phase 0's keystone. Seven paths wrote `DEFAULT_MARKET` onto new commercial
 * records that stated no market of their own. While Egypt is the only enabled
 * market that is indistinguishable from correct. The moment a second market is
 * enabled it becomes a wrong currency on a real commercial document.
 *
 * So the rule refuses instead of guessing, and these tests assert the refusal
 * in the branch that CANNOT be reached today - which is precisely the branch
 * that will decide whether GCC enablement is safe.
 */

const market = (code: string, currency: string): Market => ({
  code: code as Market['code'], currency,
  nameEn: code, nameAr: code, timezone: 'Asia/Muscat', enabled: true,
});

describe('exactly one enabled market resolves', () => {
  it('resolves it, and that is the real registry today', () => {
    expect(enabledMarkets()).toHaveLength(1);
    expect(resolveImplicitMarket()).toBe('EG');
    expect(resolveImplicitCurrency()).toBe('EGP');
  });

  it('resolves whichever single market it is, not Egypt specifically', () => {
    // The rule is "one enabled market", NOT "Egypt". If Oman were ever the
    // only enabled market this must return Oman - otherwise the function is
    // a hard-coded EG wearing a resolver's name.
    expect(implicitMarketFrom([market('OM', 'OMR')])).toBe('OM');
    expect(implicitMarketFrom([market('SA', 'SAR')])).toBe('SA');
  });
});

describe('zero enabled markets REFUSE', () => {
  it('throws rather than returning a fallback', () => {
    expect(() => implicitMarketFrom([])).toThrow(ImplicitMarketUnavailableError);
  });

  it('and never degrades to DEFAULT_MARKET', () => {
    // The failure mode being prevented: a caller that catches nothing and
    // receives 'EG' from a platform that operates nowhere.
    let returned: unknown = 'NOT THROWN';
    try { returned = implicitMarketFrom([]); } catch { returned = 'threw'; }
    expect(returned).toBe('threw');
  });
});

describe('MORE THAN ONE enabled market REFUSES - the GCC guard', () => {
  /*
   * THE BRANCH THAT MATTERS. Unreachable while Egypt stands alone, and the
   * only thing standing between "GCC enabled" and "an Omani project carrying
   * an Egyptian budget". Asserted here because it cannot be observed in
   * production until the day it is load-bearing.
   */
  it('refuses two enabled markets', () => {
    expect(() => implicitMarketFrom([market('EG', 'EGP'), market('OM', 'OMR')]))
      .toThrow(ImplicitMarketUnavailableError);
  });

  it('refuses the full Egypt + GCC set', () => {
    const all = MARKETS.map(m => ({ ...m, enabled: true }));
    expect(() => implicitMarketFrom(all)).toThrow(ImplicitMarketUnavailableError);
  });

  it('names the enabled markets in the error, so the fault is diagnosable', () => {
    // An operator reading this in a log needs to know WHICH markets made the
    // path ambiguous, not merely that it was.
    const error = (() => {
      try { implicitMarketFrom([market('EG', 'EGP'), market('OM', 'OMR')]); return null; }
      catch (caught) { return caught as ImplicitMarketUnavailableError; }
    })();
    expect(error).toBeInstanceOf(ImplicitMarketUnavailableError);
    expect(error!.enabledCount).toBe(2);
    expect(error!.message).toContain('EG');
    expect(error!.message).toContain('OM');
  });

  it('does NOT pick the first, the last, or Egypt', () => {
    // Three plausible "helpful" fallbacks, each of which would write a wrong
    // currency onto a commercial record. All three must be refusals.
    for (const pair of [
      [market('EG', 'EGP'), market('OM', 'OMR')],
      [market('OM', 'OMR'), market('EG', 'EGP')],
      [market('SA', 'SAR'), market('AE', 'AED')],
    ]) {
      expect(() => implicitMarketFrom(pair)).toThrow(ImplicitMarketUnavailableError);
    }
  });
});

describe('the resolver is distinct from the backfill default', () => {
  it('DEFAULT_MARKET remains, because legacy rows still mean Egypt', () => {
    // Phase 0 does not delete the backfill value. A pre-markets row genuinely
    // meant Egypt and `marketFor(null)` must keep saying so; what changes is
    // that NEW commercial writes may no longer borrow it.
    expect(DEFAULT_MARKET).toBe('EG');
  });

  it('but the resolver would refuse where the default would answer', () => {
    // The two differ exactly where it counts. This is the assertion that
    // stops someone "simplifying" resolveImplicitMarket back into a constant.
    const twoMarkets = [market('EG', 'EGP'), market('OM', 'OMR')];
    expect(DEFAULT_MARKET).toBe('EG');
    expect(() => implicitMarketFrom(twoMarkets)).toThrow();
  });
});
