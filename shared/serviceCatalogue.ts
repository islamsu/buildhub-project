/**
 * ── THE SERVICE CATALOGUE ─────────────────────────────────────────────────
 *
 * WHAT ALREADY WORKED, so this is not mistaken for a rewrite: a provider can
 * declare which of the nine RFQ categories describe their work
 * (`profile.setMyCategories`), and that declaration is what routes requests to
 * them. It works, it is not duplicated here, and it is NOT what this file is
 * about.
 *
 * WHAT WAS MISSING: that declaration is TARGETING, not an OFFERING. A
 * contractor could say "I do Renovation" - one of nine coarse request buckets -
 * and nothing more. They could not say
 *
 *   "Bathroom waterproofing, three-coat cementitious membrane, priced per
 *    square metre, two-week lead time, five-year warranty."
 *
 * A supplier has had exactly that for their goods all along: a product with a
 * name, a description, a unit, a price and a lifecycle. The five provider roles
 * that sell WORK rather than GOODS had a badge.
 *
 * THE SCOPE WAS ALREADY THERE, UNUSED. `productCategories.scope` has carried a
 * `SERVICE` value since the taxonomy was consolidated, with a comment saying
 * "PRODUCT and BOTH are listable; SERVICE is deliberately not" - and zero rows
 * ever used it. That absence is this gap, stated in the schema.
 *
 * ── WHAT THIS DELIBERATELY REUSES RATHER THAN FORKS ───────────────────────
 *
 *   THE CATEGORY TAXONOMY. A service offering points at a `productCategories`
 *   row whose scope is SERVICE or BOTH. That is the one administrable,
 *   bilingual, alias-resolving taxonomy BuildHub has, and it already has a
 *   Super Admin screen. A second service vocabulary is precisely the defect the
 *   consolidation existed to remove.
 *
 *   THE LIFECYCLE. Draft, active, inactive, archived - and the exact same
 *   declared transitions - are imported from ./productLifecycle rather than
 *   restated. A half-written service, one withdrawn for the season and one
 *   retired for good are the same three distinctions, and two lifecycles that
 *   drift apart are worse than one that is slightly generic.
 *
 *   THE MATCHING DECLARATION STAYS SEPARATE. An offering does not re-declare an
 *   RFQ category. "What I will be sent" and "what I advertise" are different
 *   statements, the first already has a home, and merging them would silently
 *   change which requests reach a provider the moment they edited a listing.
 *
 * ── QUOTE ON REQUEST IS FIRST-CLASS, AND THE DEFAULT ──────────────────────
 *
 * Most Egyptian construction work is priced per job after a site visit. A
 * catalogue that demanded a number would be answered with invented ones, and a
 * customer would plan around a price nobody meant. So the default pricing basis
 * says plainly that a quote is required, and when it is chosen a price is
 * REFUSED rather than ignored - "quote on request, EGP 500" is not a thing a
 * provider can accidentally publish.
 *
 * NO ORDERS AND NO PAYMENTS. This is a catalogue and an enquiry surface. There
 * is no basket, no checkout and no transaction here, because BuildHub has no
 * payment provider and inventing one would be a lie about what the platform
 * can do.
 */

import { PRODUCT_STATUSES, PRODUCT_TRANSITIONS, PRODUCT_PUBLIC_STATUS } from './productLifecycle';
import type { ProductStatus } from './productLifecycle';

/** One lifecycle, imported rather than restated. See the header. */
export const SERVICE_STATUSES = PRODUCT_STATUSES;
export type ServiceStatus = ProductStatus;
export const SERVICE_TRANSITIONS = PRODUCT_TRANSITIONS;
export const SERVICE_PUBLIC_STATUS = PRODUCT_PUBLIC_STATUS;

/**
 * How the work is priced. Not a price - a BASIS, because the honest answer for
 * most construction work is "it depends on the site".
 */
export const SERVICE_PRICING_BASES = [
  'quote_on_request',
  'per_square_metre',
  'per_linear_metre',
  'per_unit',
  'per_day',
  'fixed_project',
] as const;

export type ServicePricingBasis = (typeof SERVICE_PRICING_BASES)[number];

/** The default, and the only basis that forbids a figure. */
export const DEFAULT_PRICING_BASIS: ServicePricingBasis = 'quote_on_request';

/**
 * Whether a basis may carry an indicative price.
 *
 * The one exclusion is the point: a listing that says "quote on request" and
 * also shows a number is telling the customer two different things, and they
 * will believe the number.
 */
export const basisAcceptsPrice = (basis: ServicePricingBasis): boolean =>
  basis !== 'quote_on_request';

export const SERVICE_TITLE_MAX = 120;
export const SERVICE_DESCRIPTION_MAX = 2000;
/** A guard against a typo adding three zeroes, not a business ceiling. */
export const SERVICE_PRICE_MAX = 100_000_000;
export const SERVICE_LEAD_TIME_DAYS_MAX = 365;
export const SERVICE_WARRANTY_MONTHS_MAX = 600;

type LabelPair = { en: string; ar: string };

const PRICING_BASIS_LABELS: Readonly<Record<ServicePricingBasis, LabelPair>> = {
  quote_on_request:  { en: 'Quote on request',    ar: 'عرض سعر عند الطلب' },
  per_square_metre:  { en: 'Per square metre',    ar: 'للمتر المربع' },
  per_linear_metre:  { en: 'Per linear metre',    ar: 'للمتر الطولي' },
  per_unit:          { en: 'Per unit',            ar: 'للوحدة' },
  per_day:           { en: 'Per day',             ar: 'لليوم' },
  fixed_project:     { en: 'Fixed project price', ar: 'سعر إجمالي للمشروع' },
};

const PRICING_BASIS_HELP: Readonly<Record<ServicePricingBasis, LabelPair>> = {
  quote_on_request:  { en: 'The customer contacts you and you quote the job. No price is shown.', ar: 'يتواصل معك العميل وتقدّم عرض السعر. لا يُعرض أي سعر.' },
  per_square_metre:  { en: 'An indicative rate per square metre of work.',   ar: 'سعر استرشادي للمتر المربع من العمل.' },
  per_linear_metre:  { en: 'An indicative rate per linear metre of work.',   ar: 'سعر استرشادي للمتر الطولي من العمل.' },
  per_unit:          { en: 'An indicative rate for each item or fitting.',   ar: 'سعر استرشادي لكل قطعة أو وحدة.' },
  per_day:           { en: 'An indicative day rate for the crew or service.', ar: 'سعر استرشادي لليوم للفريق أو الخدمة.' },
  fixed_project:     { en: 'An indicative total for the whole job.',          ar: 'إجمالي استرشادي للعمل بالكامل.' },
};

export function pricingBasisLabel(basis: ServicePricingBasis, lang: 'en' | 'ar'): string {
  return PRICING_BASIS_LABELS[basis][lang];
}

export function pricingBasisHelp(basis: ServicePricingBasis, lang: 'en' | 'ar'): string {
  return PRICING_BASIS_HELP[basis][lang];
}

/** i18n keys, resolved through the same t() as every other string. */
export const serviceStatusLabelKey = (status: ServiceStatus) => `serviceStatus.${status}`;
