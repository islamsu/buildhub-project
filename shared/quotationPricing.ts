/**
 * ── HOW A QUOTATION'S NUMBER IS ARRIVED AT ──────────────────────────────
 *
 * A BuildHub quotation carried exactly one figure: `quotations.price`. A
 * contractor typed a total and a customer read a total, and nothing in the
 * record said how the number was reached - so two bids for the same flat could
 * not be compared on anything except which was smaller, and a customer could
 * not tell whether VAT was inside one of them.
 *
 * Finishing work in this market is priced three ways, and all three were
 * unrepresentable:
 *
 *   PERCENTAGE   نسبة من تكلفة المواد - a percentage of the material cost
 *   PACKAGE      باقة تشطيب - a rate per square metre, or a fixed job price
 *   DETAILED     تسعير تفصيلي - a bill of quantities
 *
 * ── THEY ARE STRATEGIES, NOT SYSTEMS ────────────────────────────────────
 *
 * The temptation is three quotation types with three tables and three totals.
 * That is how a platform ends up with three different answers to "what will
 * this cost", and with a comparison screen that cannot put them side by side.
 *
 * So there is ONE quotation, ONE authoritative total - `quotations.price`, the
 * column that already exists and that acceptance, notifications, dashboards and
 * the comparison screen already read - and the METHOD decides only how the BASE
 * is computed. Everything after the base is identical for all four methods,
 * including `custom`, which is the existing free-form behaviour and remains the
 * default.
 *
 * ── AND THIS IS THE ONLY PLACE THE ARITHMETIC LIVES ─────────────────────
 *
 * The server calls `computeQuotationTotals` and persists what it returns. The
 * client may call the same function to preview a total the user has not
 * submitted yet, and may never send a total of its own: a client figure is
 * never read back as truth. One formula, one source, no drift.
 *
 * ── WHAT THE ORDER OF OPERATIONS PREVENTS ───────────────────────────────
 *
 * Every rule below exists because getting it wrong overcharges somebody:
 *
 *   VAT, discount, contingency and overhead NEVER enter a percentage base.
 *     The base is the material cost. Adding VAT to it and then charging a
 *     percentage of that is charging a fee on the tax.
 *
 *   Contingency and overhead are BOTH computed on (base − discount).
 *     Not on each other, and not in sequence - overhead on top of contingency
 *     is a markup on a markup that nobody agreed to.
 *
 *   VAT applies ONCE, to the net, and never to itself.
 *
 *   An unstated VAT rate is NULL, not 0. "No rate was given" and "the rate is
 *     zero" are different commercial statements about a bid.
 *
 * ── ROUNDING, SO THE PARTS ADD UP TO THE TOTAL ──────────────────────────
 *
 * Every component is rounded to the CURRENCY's own scale and the total is the
 * sum of the rounded components. Round only at the end and the displayed parts
 * visibly fail to sum to the displayed total, which is the single fastest way
 * to lose a customer's trust in a price. `fractionDigitsFor` returns null for a
 * currency BuildHub does not know rather than guessing 2, so this refuses
 * instead of silently rounding a Kuwaiti dinar to piastres.
 */

import { fractionDigitsFor } from './markets';

/**
 * How the base was arrived at.
 *
 * `custom` is the pre-existing behaviour - a stated total with no declared
 * derivation - and it stays the default so that every quotation written before
 * this existed remains exactly as truthful as it was.
 */
export const PRICING_METHODS = ['custom', 'percentage', 'package', 'detailed'] as const;
export type PricingMethod = (typeof PRICING_METHODS)[number];

export const isPricingMethod = (value: unknown): value is PricingMethod =>
  typeof value === 'string' && (PRICING_METHODS as readonly string[]).includes(value);

export const PRICING_METHOD_LABELS: Readonly<Record<PricingMethod, { en: string; ar: string }>> = {
  custom:     { en: 'Quoted total',              ar: 'إجمالي العرض' },
  percentage: { en: 'Percentage of material cost', ar: 'نسبة من تكلفة المواد' },
  package:    { en: 'Finishing package',         ar: 'باقة تشطيب' },
  detailed:   { en: 'Detailed / BOQ',            ar: 'تسعير تفصيلي' },
};

/**
 * The direct-cost components a BOQ line may represent.
 *
 * Direct costs only. Overhead and profit are not line components - they are a
 * rate applied to the whole, below, which is the only way to stop the same
 * markup being charged twice: once inside the lines and once on the total.
 */
export const COST_COMPONENTS = ['material', 'labor', 'equipment', 'subcontract', 'other'] as const;
export type CostComponent = (typeof COST_COMPONENTS)[number];

export const isCostComponent = (value: unknown): value is CostComponent =>
  typeof value === 'string' && (COST_COMPONENTS as readonly string[]).includes(value);

export const COST_COMPONENT_LABELS: Readonly<Record<CostComponent, { en: string; ar: string }>> = {
  material:    { en: 'Material',    ar: 'مواد' },
  labor:       { en: 'Labour',      ar: 'عمالة' },
  equipment:   { en: 'Equipment',   ar: 'معدات' },
  subcontract: { en: 'Subcontract', ar: 'مقاول باطن' },
  other:       { en: 'Other',       ar: 'أخرى' },
};

/**
 * SUGGESTED package tiers, deliberately NOT a closed set.
 *
 * A contractor who sells a "Hotel handover" package must be able to say so. The
 * tier is stored as given; these four exist so the common case has consistent
 * bilingual labels and so a filter has something to offer, not so the product
 * can refuse a fifth.
 */
export const SUGGESTED_PACKAGE_TIERS = ['economy', 'standard', 'premium', 'luxury'] as const;
export type SuggestedPackageTier = (typeof SUGGESTED_PACKAGE_TIERS)[number];

export const PACKAGE_TIER_LABELS: Readonly<Record<SuggestedPackageTier, { en: string; ar: string }>> = {
  economy:  { en: 'Economy',  ar: 'اقتصادي' },
  standard: { en: 'Standard', ar: 'متوسط' },
  premium:  { en: 'Premium',  ar: 'فاخر' },
  luxury:   { en: 'Luxury',   ar: 'فاخر جداً' },
};

/** A tier's bilingual label when it is one of the suggestions, else as given. */
export function packageTierLabel(tier: string | null | undefined, lang: 'en' | 'ar'): string | null {
  const value = (tier ?? '').trim();
  if (!value) return null;
  const known = (SUGGESTED_PACKAGE_TIERS as readonly string[]).includes(value)
    ? PACKAGE_TIER_LABELS[value as SuggestedPackageTier]
    : null;
  return known ? known[lang] : value;
}

/** Raised rather than guessing a scale for a currency BuildHub does not know. */
export class UnknownCurrencyScaleError extends Error {
  constructor(public readonly currency: string) {
    super(`No known fractional scale for currency ${currency}`);
    this.name = 'UnknownCurrencyScaleError';
  }
}

/**
 * Half-up away from zero, at the currency's scale.
 *
 * `toFixed` is not used: it rounds half-to-even on some values through binary
 * representation, so 1.005 at scale 2 becomes 1.00 - a customer's money
 * disappearing into a floating-point detail.
 */
export function roundToScale(value: number, scale: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** scale;
  const scaled = value * factor;
  // The epsilon corrects the binary representation of an exact decimal half
  // (1.005 * 100 === 100.49999999999999) without perturbing any other value at
  // this magnitude.
  const corrected = scaled >= 0
    ? Math.floor(scaled + 0.5 + Number.EPSILON * Math.abs(scaled))
    : Math.ceil(scaled - 0.5 - Number.EPSILON * Math.abs(scaled));
  return corrected / factor;
}

/** A BOQ line, reduced to what the arithmetic needs. */
export type PricingLine = {
  quantity: number;
  rate: number;
};

/**
 * Everything the total is computed from.
 *
 * Nullable throughout because a quotation is written by a person filling in
 * what applies: a package quotation has no material base, a percentage
 * quotation has no lines. A field that does not apply is absent, not zero.
 */
export type QuotationPricingInput = {
  method: PricingMethod;
  /** The RFQ's currency. Never the supplier's choice - see submitQuotation. */
  currency: string;

  /** `custom`: the stated total before the shared commercial fields. */
  statedAmount?: number | null;

  /** `percentage`: the material cost the percentage applies to, and the rate. */
  materialBaseAmount?: number | null;
  percentageRate?: number | null;

  /** `package`: a rate on a canonical basis, times an applicable quantity. */
  packageRate?: number | null;
  packageQuantity?: number | null;

  /** `detailed`: the BOQ lines. */
  lines?: readonly PricingLine[] | null;

  /** Shared commercial fields, identical for all four methods. */
  discountAmount?: number | null;
  /** Percent, applied to (base − discount). Never compounded with overhead. */
  contingencyRate?: number | null;
  /** Percent, applied to (base − discount). Never applied to contingency. */
  overheadRate?: number | null;
  /** Percent, applied once to the net. NULL means "not stated", not zero. */
  vatRate?: number | null;
};

export type QuotationTotals = {
  base: number;
  discount: number;
  contingency: number;
  overhead: number;
  netBeforeVat: number;
  /** Echoed so a reader can tell "0% VAT" from "VAT not stated". */
  vatRate: number | null;
  vatAmount: number;
  /** The authoritative payable. What `quotations.price` must equal. */
  total: number;
  /** The currency scale every figure above was rounded to. */
  scale: number;
};

const positive = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * THE BASE, and the only thing the method changes.
 *
 * Exported because the comparison screen states the base separately from the
 * total, and restating this switch there is how the two would drift.
 */
export function computeBase(input: QuotationPricingInput, scale: number): number {
  switch (input.method) {
    case 'percentage':
      // × rate / 100. The material cost is the base the parties agreed on; VAT
      // and markups are added AFTER, never inside it.
      return roundToScale(positive(input.materialBaseAmount) * positive(input.percentageRate) / 100, scale);
    case 'package':
      // A fixed-project package stores its amount as the rate with quantity 1,
      // so one multiplication serves every basis and the stored inputs always
      // reproduce the displayed figure.
      return roundToScale(positive(input.packageRate) * positive(input.packageQuantity), scale);
    case 'detailed':
      // Each line is rounded before summing, for the same reason the components
      // are: the printed lines must add up to the printed subtotal.
      return roundToScale(
        (input.lines ?? []).reduce(
          (sum, line) => sum + roundToScale(positive(line.quantity) * positive(line.rate), scale), 0),
        scale);
    case 'custom':
    default:
      return roundToScale(positive(input.statedAmount), scale);
  }
}

/**
 * The one implementation of the arithmetic. See the header for why each step is
 * where it is.
 */
export function computeQuotationTotals(input: QuotationPricingInput): QuotationTotals {
  const scale = fractionDigitsFor(input.currency);
  if (scale === null) throw new UnknownCurrencyScaleError(String(input.currency));

  const base = computeBase(input, scale);

  // A discount cannot exceed the base: a negative net is not a price, it is a
  // data-entry error that would otherwise propagate into VAT and the total.
  const discount = Math.min(roundToScale(positive(input.discountAmount), scale), base);
  const discountedBase = roundToScale(base - discount, scale);

  // BOTH on the discounted base, deliberately. See the header.
  const contingency = roundToScale(discountedBase * positive(input.contingencyRate) / 100, scale);
  const overhead = roundToScale(discountedBase * positive(input.overheadRate) / 100, scale);

  const netBeforeVat = roundToScale(discountedBase + contingency + overhead, scale);

  // NULL is preserved rather than coerced. Only a stated rate produces tax.
  const vatRate = typeof input.vatRate === 'number' && Number.isFinite(input.vatRate) && input.vatRate >= 0
    ? input.vatRate
    : null;
  const vatAmount = vatRate === null ? 0 : roundToScale(netBeforeVat * vatRate / 100, scale);

  // The sum of the ROUNDED components, so the parts shown add up to the total
  // shown.
  const total = roundToScale(netBeforeVat + vatAmount, scale);

  return { base, discount, contingency, overhead, netBeforeVat, vatRate, vatAmount, total, scale };
}

// ── Comparison ─────────────────────────────────────────────────────────────

/**
 * The scope statements a quotation carries, whatever its method.
 *
 * These are what make a comparison mean something. Two totals are comparable
 * arithmetic; two SCOPES are the actual commercial question, and a customer
 * choosing the cheaper bid without them is choosing the one that left more out.
 */
export type QuotationScope = {
  inclusions?: readonly string[] | null;
  exclusions?: readonly string[] | null;
  allowances?: readonly string[] | null;
  upgrades?: readonly string[] | null;
  assumptions?: readonly string[] | null;
  milestones?: readonly string[] | null;
  /** Brands or specifications the quoter committed to. */
  specifications?: readonly string[] | null;
  /** Material level / finishing standard, as stated. */
  materialLevel?: string | null;
  includedTrades?: readonly string[] | null;
  laborIncluded?: boolean | null;
};

export type ComparableQuotation = {
  id: number;
  providerId: number;
  providerName?: string | null;
  method: PricingMethod;
  currency: string;
  totals: QuotationTotals;
  /** Days. Null when the quoter did not state one. */
  timelineDays?: number | null;
  validUntil?: Date | string | null;
  packageTier?: string | null;
  packageBasis?: string | null;
  packageQuantity?: number | null;
  scope?: QuotationScope | null;
};

export type NormalizedQuotation = ComparableQuotation & {
  /**
   * Total ÷ area, in the quotation's own currency.
   *
   * NULL WHERE THE AREA IS NOT KNOWN, and that is the point. A rate per square
   * metre computed from an area nobody stated is a fabricated comparison, and
   * it is the exact number a customer would use to decide. Omitted, never
   * inferred.
   */
  ratePerUnitArea: number | null;
  /** Where the area came from, so a reader can judge the rate above. */
  areaSource: 'package_quantity' | 'request_area' | null;
  areaUsed: number | null;
};

/**
 * Attach a per-area rate only where an area is genuinely known.
 *
 * `requestArea` is the area the REQUEST stated, used when the quotation itself
 * is not priced per square metre - it is the buyer's own figure, so a rate
 * derived from it is a statement about their brief rather than an invention.
 */
export function normalizeForComparison(
  quotation: ComparableQuotation,
  requestArea?: number | null,
): NormalizedQuotation {
  const scale = quotation.totals.scale;
  const packageArea = quotation.packageBasis === 'per_square_metre'
    ? positive(quotation.packageQuantity)
    : 0;
  const stated = positive(requestArea);

  let areaUsed: number | null = null;
  let areaSource: NormalizedQuotation['areaSource'] = null;
  if (packageArea > 0) { areaUsed = packageArea; areaSource = 'package_quantity'; }
  else if (stated > 0) { areaUsed = stated; areaSource = 'request_area'; }

  return {
    ...quotation,
    areaUsed,
    areaSource,
    ratePerUnitArea: areaUsed === null ? null : roundToScale(quotation.totals.total / areaUsed, scale),
  };
}

/** One party's inclusion/exclusion difference against the others. */
export type ScopeDifference = {
  item: string;
  includedIn: number[];
  excludedIn: number[];
  /** Quotations that said nothing either way. NOT treated as either. */
  unstatedIn: number[];
};

const normalizeItem = (value: string) => value.trim().toLowerCase();

/**
 * The factual scope differences across a set of quotations.
 *
 * THREE STATES, NOT TWO. A quotation that never mentions kitchen cabinets has
 * not excluded them and has not included them - it is silent, and a comparison
 * that files silence under "excluded" invents a difference while one that files
 * it under "included" invents an agreement. Both are the fabricated equivalence
 * the spec forbids, so silence is reported as its own state and a reader is
 * told to ask.
 *
 * Returns only items where the quotations genuinely differ; an item every
 * quotation includes is not a difference worth a customer's attention.
 */
export function scopeDifferences(quotations: readonly ComparableQuotation[]): ScopeDifference[] {
  const byItem = new Map<string, { label: string; includedIn: number[]; excludedIn: number[] }>();

  for (const quotation of quotations) {
    for (const [list, bucket] of [
      [quotation.scope?.inclusions ?? [], 'includedIn'],
      [quotation.scope?.exclusions ?? [], 'excludedIn'],
    ] as const) {
      for (const raw of list) {
        const key = normalizeItem(String(raw));
        if (!key) continue;
        const entry = byItem.get(key) ?? { label: String(raw).trim(), includedIn: [], excludedIn: [] };
        if (!entry[bucket].includes(quotation.id)) entry[bucket].push(quotation.id);
        byItem.set(key, entry);
      }
    }
  }

  const allIds = quotations.map(quotation => quotation.id);
  const differences: ScopeDifference[] = [];
  for (const entry of Array.from(byItem.values())) {
    const unstatedIn = allIds.filter(
      id => !entry.includedIn.includes(id) && !entry.excludedIn.includes(id));
    // Every quotation agrees it is in, and none is silent: not a difference.
    if (entry.excludedIn.length === 0 && unstatedIn.length === 0) continue;
    // Every quotation agrees it is out: also not a difference.
    if (entry.includedIn.length === 0 && unstatedIn.length === 0) continue;
    differences.push({
      item: entry.label,
      includedIn: entry.includedIn,
      excludedIn: entry.excludedIn,
      unstatedIn,
    });
  }
  return differences.sort((a, b) => a.item.localeCompare(b.item));
}
