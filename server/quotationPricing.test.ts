/**
 * ── THE ARITHMETIC A BID DEPENDS ON ─────────────────────────────────────
 *
 * Every assertion here is about a number somebody would act on. The ordering
 * rules in particular are not stylistic: charging a percentage fee on top of
 * VAT, or overhead on top of contingency, overcharges a real customer by a real
 * amount, and both are the natural thing to write if nobody says otherwise.
 *
 * The tests are grouped by the rule they protect rather than by function, so a
 * failure names the commercial mistake and not just the line.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  PRICING_METHODS, COST_COMPONENTS, SUGGESTED_PACKAGE_TIERS,
  computeBase, computeQuotationTotals, roundToScale, packageTierLabel,
  normalizeForComparison, scopeDifferences, UnknownCurrencyScaleError,
  type QuotationPricingInput,
} from '../shared/quotationPricing';

const ROOT = join(import.meta.dirname, '..');
const code = (relative: string) => readSourceForAssertions(readFileSync(join(ROOT, relative), 'utf8'));

const EGP = 'EGP';
const base = (over: Partial<QuotationPricingInput> = {}): QuotationPricingInput =>
  ({ method: 'custom', currency: EGP, statedAmount: 100_000, ...over });

describe('the four methods, and only the base differs', () => {
  it('custom is the stated amount, exactly as before this existed', () => {
    expect(computeQuotationTotals(base()).base).toBe(100_000);
    expect(computeQuotationTotals(base()).total).toBe(100_000);
  });

  it('percentage is material cost x rate', () => {
    const totals = computeQuotationTotals(base({
      method: 'percentage', statedAmount: null,
      materialBaseAmount: 400_000, percentageRate: 12.5,
    }));
    expect(totals.base).toBe(50_000);
    expect(totals.total).toBe(50_000);
  });

  it('package is rate x quantity', () => {
    const totals = computeQuotationTotals(base({
      method: 'package', statedAmount: null, packageRate: 3_500, packageQuantity: 120,
    }));
    expect(totals.base).toBe(420_000);
  });

  it('a fixed-project package is its amount times one, so the inputs reproduce the total', () => {
    // The server writes quantity 1 for fixed_project precisely so that one
    // multiplication serves every basis and no package total is stored that its
    // own stored inputs cannot reproduce.
    const totals = computeQuotationTotals(base({
      method: 'package', statedAmount: null, packageRate: 285_000, packageQuantity: 1,
    }));
    expect(totals.base).toBe(285_000);
  });

  it('detailed is the sum of quantity x rate', () => {
    const totals = computeQuotationTotals(base({
      method: 'detailed', statedAmount: null,
      lines: [
        { quantity: 120, rate: 350 },   //  42,000
        { quantity: 85.5, rate: 220 },  //  18,810
        { quantity: 1, rate: 9_500 },   //   9,500
      ],
    }));
    expect(totals.base).toBe(70_310);
  });

  it('and a method with no inputs produces no base rather than a wrong one', () => {
    for (const method of PRICING_METHODS) {
      expect(computeQuotationTotals({ method, currency: EGP }).base).toBe(0);
    }
  });
});

describe('the order of operations, which is where the money is', () => {
  it('a discount comes off the base before anything is charged on it', () => {
    const totals = computeQuotationTotals(base({ discountAmount: 10_000 }));
    expect(totals.discount).toBe(10_000);
    expect(totals.netBeforeVat).toBe(90_000);
    expect(totals.total).toBe(90_000);
  });

  it('a discount can never exceed the base, so the net is never negative', () => {
    // A negative net is a data-entry error, not a price, and it would propagate
    // straight into the VAT figure and the payable total.
    const totals = computeQuotationTotals(base({ discountAmount: 250_000 }));
    expect(totals.discount).toBe(100_000);
    expect(totals.netBeforeVat).toBe(0);
    expect(totals.total).toBe(0);
  });

  it('CONTINGENCY AND OVERHEAD ARE BOTH ON (base − discount), never on each other', () => {
    /*
     * THE MISTAKE THIS CATCHES. Applying overhead to (base + contingency) is
     * a markup on a markup. On this input it would produce 115,500 rather than
     * 115,000 - five hundred pounds nobody agreed to, and it scales with the
     * job.
     */
    const totals = computeQuotationTotals(base({ contingencyRate: 5, overheadRate: 10 }));
    expect(totals.contingency).toBe(5_000);
    expect(totals.overhead).toBe(10_000);
    expect(totals.netBeforeVat).toBe(115_000);
  });

  it('and both are on the DISCOUNTED base, not the gross one', () => {
    const totals = computeQuotationTotals(base({
      discountAmount: 20_000, contingencyRate: 5, overheadRate: 10,
    }));
    expect(totals.contingency).toBe(4_000);   // 5% of 80,000, not of 100,000
    expect(totals.overhead).toBe(8_000);
    expect(totals.netBeforeVat).toBe(92_000);
  });

  it('VAT applies once, to the net, and never to itself', () => {
    const totals = computeQuotationTotals(base({ contingencyRate: 5, overheadRate: 10, vatRate: 14 }));
    expect(totals.netBeforeVat).toBe(115_000);
    expect(totals.vatAmount).toBe(16_100);
    expect(totals.total).toBe(131_100);
  });

  it('NO MARKUP EVER ENTERS A PERCENTAGE BASE', () => {
    /*
     * The base is the material cost the parties agreed. Charging the agreed
     * percentage on a VAT-inclusive or markup-inclusive figure is charging a fee
     * on the tax, and it is the single most likely way to get this wrong.
     */
    const withEverything = computeQuotationTotals(base({
      method: 'percentage', statedAmount: null,
      materialBaseAmount: 400_000, percentageRate: 12.5,
      discountAmount: 1_000, contingencyRate: 5, overheadRate: 10, vatRate: 14,
    }));
    // The base is STILL 400,000 x 12.5%.
    expect(withEverything.base).toBe(50_000);
    // And the material figure itself is untouched by any of them.
    const bare = computeQuotationTotals(base({
      method: 'percentage', statedAmount: null,
      materialBaseAmount: 400_000, percentageRate: 12.5,
    }));
    expect(withEverything.base).toBe(bare.base);
  });

  it('and nothing is counted twice: the total is exactly the sum of its parts', () => {
    const totals = computeQuotationTotals(base({
      discountAmount: 7_500, contingencyRate: 3.5, overheadRate: 8, vatRate: 14,
    }));
    const rebuilt = totals.base - totals.discount + totals.contingency + totals.overhead + totals.vatAmount;
    expect(rebuilt).toBeCloseTo(totals.total, 6);
    expect(totals.netBeforeVat + totals.vatAmount).toBeCloseTo(totals.total, 6);
  });
});

describe('an unstated VAT rate is not a zero one', () => {
  it('omitting the rate stores NULL and charges nothing', () => {
    const totals = computeQuotationTotals(base());
    expect(totals.vatRate).toBeNull();
    expect(totals.vatAmount).toBe(0);
  });

  it('a stated 0% is a DIFFERENT statement and keeps its rate', () => {
    // "This bid is zero-rated" and "nobody said" are different commercial
    // claims, and a customer reading the bid is entitled to tell them apart.
    const totals = computeQuotationTotals(base({ vatRate: 0 }));
    expect(totals.vatRate).toBe(0);
    expect(totals.vatAmount).toBe(0);
  });

  it('and a nonsense rate is treated as unstated rather than as a charge', () => {
    for (const bad of [Number.NaN, -5, undefined]) {
      expect(computeQuotationTotals(base({ vatRate: bad as number })).vatRate).toBeNull();
    }
  });
});

describe('rounding, so the printed parts add up to the printed total', () => {
  it('rounds half up away from zero, where toFixed would not', () => {
    // 1.005 * 100 is 100.49999999999999 in binary, so a naive round gives 1.00
    // and a customer's money disappears into a floating-point detail.
    expect(roundToScale(1.005, 2)).toBe(1.01);
    expect(roundToScale(2.675, 2)).toBe(2.68);
    expect(roundToScale(-1.005, 2)).toBe(-1.01);
  });

  it('uses the CURRENCY\'s scale, not a global two', () => {
    // KWD has three minor digits. Capping at two is the defect §88 removed.
    const kwd = computeQuotationTotals({
      method: 'custom', currency: 'KWD', statedAmount: 1_000, vatRate: 5.125,
    });
    expect(kwd.scale).toBe(3);
    expect(kwd.vatAmount).toBe(51.25);
  });

  it('REFUSES a currency whose scale it does not know, rather than guessing 2', () => {
    expect(() => computeQuotationTotals({ method: 'custom', currency: 'XYZ', statedAmount: 100 }))
      .toThrow(UnknownCurrencyScaleError);
    expect(() => computeQuotationTotals({ method: 'custom', currency: '', statedAmount: 100 }))
      .toThrow(UnknownCurrencyScaleError);
  });

  it('rounds each BOQ line before summing, so the lines add up to the subtotal', () => {
    const totals = computeQuotationTotals(base({
      method: 'detailed', statedAmount: null,
      lines: [{ quantity: 3, rate: 0.335 }, { quantity: 3, rate: 0.335 }],
    }));
    // Each line rounds to 1.01, so the subtotal is 2.02 - which is what the
    // customer sees printed beside two lines of 1.01.
    expect(totals.base).toBe(2.02);
  });
});

describe('the calculation is deterministic and re-runnable', () => {
  it('the same inputs always give the same total', () => {
    const input = base({ method: 'percentage', statedAmount: null,
      materialBaseAmount: 387_450.75, percentageRate: 11.25, vatRate: 14 });
    const first = computeQuotationTotals(input);
    for (let run = 0; run < 5; run += 1) {
      expect(computeQuotationTotals(input)).toEqual(first);
    }
  });

  it('and a changed material cost changes the total, predictably', () => {
    const at = (material: number) => computeQuotationTotals(base({
      method: 'percentage', statedAmount: null, materialBaseAmount: material, percentageRate: 10,
    })).total;
    expect(at(100_000)).toBe(10_000);
    expect(at(150_000)).toBe(15_000);
    // Linear in the material cost, which is what "percentage of material" means.
    expect(at(200_000)).toBe(2 * at(100_000));
  });

  it('computeBase is the same switch the totals use, so the two cannot drift', () => {
    const input = base({ method: 'package', statedAmount: null, packageRate: 2_750, packageQuantity: 96 });
    expect(computeBase(input, 2)).toBe(computeQuotationTotals(input).base);
  });
});

describe('comparison normalizes without inventing anything', () => {
  const quotation = (over: Record<string, unknown> = {}) => ({
    id: 1, providerId: 10, method: 'custom' as const, currency: EGP,
    totals: computeQuotationTotals(base({ statedAmount: 240_000 })),
    ...over,
  });

  it('a per-square-metre package yields a rate from its OWN quantity', () => {
    const normalized = normalizeForComparison(quotation({
      method: 'package', packageBasis: 'per_square_metre', packageQuantity: 120,
    }) as never);
    expect(normalized.areaSource).toBe('package_quantity');
    expect(normalized.areaUsed).toBe(120);
    expect(normalized.ratePerUnitArea).toBe(2_000);
  });

  it('another method uses the REQUEST\'s stated area, which is the buyer\'s own figure', () => {
    const normalized = normalizeForComparison(quotation() as never, 200);
    expect(normalized.areaSource).toBe('request_area');
    expect(normalized.ratePerUnitArea).toBe(1_200);
  });

  it('AND OMITS THE RATE WHERE NO AREA IS KNOWN', () => {
    /*
     * The rate per metre is the number a customer would actually use to choose,
     * so deriving it from an area nobody stated is the most consequential
     * fabrication this screen could make.
     */
    for (const area of [undefined, null, 0, -5]) {
      const normalized = normalizeForComparison(quotation() as never, area as number);
      expect(normalized.ratePerUnitArea).toBeNull();
      expect(normalized.areaSource).toBeNull();
    }
  });

  it('and a package priced per UNIT does not become an area', () => {
    // 40 door leaves is not 40 square metres.
    const normalized = normalizeForComparison(quotation({
      method: 'package', packageBasis: 'per_unit', packageQuantity: 40,
    }) as never);
    expect(normalized.areaSource).toBeNull();
    expect(normalized.ratePerUnitArea).toBeNull();
  });
});

describe('scope differences have THREE states, because silence is not exclusion', () => {
  const q = (id: number, inclusions: string[], exclusions: string[] = []) => ({
    id, providerId: id, method: 'custom' as const, currency: EGP,
    totals: computeQuotationTotals(base()),
    scope: { inclusions, exclusions },
  });

  it('reports an item one quotation includes and another excludes', () => {
    const differences = scopeDifferences([
      q(1, ['Flooring'], ['Kitchen cabinets']),
      q(2, ['Flooring', 'Kitchen cabinets']),
    ]);
    const cabinets = differences.find(d => /cabinet/i.test(d.item));
    expect(cabinets).toBeDefined();
    expect(cabinets!.includedIn).toEqual([2]);
    expect(cabinets!.excludedIn).toEqual([1]);
    expect(cabinets!.unstatedIn).toEqual([]);
  });

  it('SILENCE IS ITS OWN STATE, neither included nor excluded', () => {
    /*
     * A quotation that never mentions cabinets has not excluded them and has not
     * included them. Filing silence under "excluded" invents a difference;
     * filing it under "included" invents an agreement. Both are the fabricated
     * equivalence the spec forbids.
     */
    const differences = scopeDifferences([
      q(1, ['Kitchen cabinets']),
      q(2, ['Flooring']),
    ]);
    const cabinets = differences.find(d => /cabinet/i.test(d.item))!;
    expect(cabinets.includedIn).toEqual([1]);
    expect(cabinets.excludedIn).toEqual([]);
    expect(cabinets.unstatedIn).toEqual([2]);
  });

  it('an item every quotation includes is not reported as a difference', () => {
    const differences = scopeDifferences([q(1, ['Flooring']), q(2, ['Flooring'])]);
    expect(differences.find(d => /flooring/i.test(d.item))).toBeUndefined();
  });

  it('nor is one every quotation excludes', () => {
    const differences = scopeDifferences([q(1, [], ['Furniture']), q(2, [], ['Furniture'])]);
    expect(differences).toEqual([]);
  });

  it('and matching is case and whitespace insensitive, so one item is one row', () => {
    const differences = scopeDifferences([
      q(1, ['  Kitchen Cabinets ']),
      q(2, [], ['kitchen cabinets']),
    ]);
    expect(differences).toHaveLength(1);
    expect(differences[0].includedIn).toEqual([1]);
    expect(differences[0].excludedIn).toEqual([2]);
  });

  it('comparing nothing is empty rather than an error', () => {
    expect(scopeDifferences([])).toEqual([]);
  });
});

describe('the vocabularies stay open where they must and closed where they must', () => {
  it('a contractor-defined package tier survives verbatim', () => {
    // The four suggestions are labels, not a closed set: a contractor selling a
    // "Hotel handover" package must be able to say so.
    expect(packageTierLabel('Hotel handover', 'en')).toBe('Hotel handover');
    expect(packageTierLabel('premium', 'ar')).toBe('فاخر');
    expect(packageTierLabel('', 'en')).toBeNull();
    expect(packageTierLabel(null, 'ar')).toBeNull();
  });

  it('the suggested tiers all have both languages', () => {
    for (const tier of SUGGESTED_PACKAGE_TIERS) {
      expect(packageTierLabel(tier, 'en')).toBeTruthy();
      expect(packageTierLabel(tier, 'ar')).toBeTruthy();
      expect(packageTierLabel(tier, 'ar')).not.toBe(tier);
    }
  });

  it('cost components are DIRECT costs only - overhead and profit are not lines', () => {
    /*
     * A markup inside the lines and again as a rate on the total is the same
     * markup charged twice. Keeping them out of this list is what prevents it.
     */
    expect([...COST_COMPONENTS]).toEqual(['material', 'labor', 'equipment', 'subcontract', 'other']);
    for (const forbidden of ['overhead', 'profit', 'markup', 'vat', 'contingency']) {
      expect([...COST_COMPONENTS]).not.toContain(forbidden);
    }
  });
});

describe('there is ONE implementation of this arithmetic', () => {
  const pricing = code('shared/quotationPricing.ts');

  it('and the server calls it rather than restating it', () => {
    const routers = code('server/routers.ts');
    expect(routers).toContain('computeQuotationTotals(');
    // The server must not compute a VAT figure of its own anywhere.
    expect(routers).not.toMatch(/vatAmount\s*=\s*[^;]*\*\s*[^;]*\/\s*100/);
  });

  it('the total is derived, never taken from the submitted payload', () => {
    const routers = code('server/routers.ts');
    // `price` is written from the server's own figure on every path.
    expect(routers).toContain('price: String(totals.total)');
    expect(routers).not.toContain('price: String(input.price)');
  });

  it('and a client total for a derived method is REFUSED, not ignored', () => {
    const routers = code('server/routers.ts');
    expect(routers).toContain('The total is calculated from the pricing inputs and must not be submitted.');
  });

  it('the module states its own rounding rule rather than relying on toFixed', () => {
    expect(pricing).toContain('export function roundToScale');
    expect(pricing).not.toMatch(/\.toFixed\(/);
  });
});
