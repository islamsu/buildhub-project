/**
 * ── COMPARING BIDS THAT WERE PRICED DIFFERENTLY ─────────────────────────
 *
 * A percentage quotation, a package quotation and a bill of quantities are three
 * different commercial statements about the same job, and a customer has to
 * choose between them. The existing comparison sorts on price, timeline and
 * rating - all useful, and all silent about the one thing that decides most
 * finishing jobs:
 *
 *   THE CHEAPER BID IS USUALLY THE ONE THAT LEFT MORE OUT.
 *
 * So this panel sits above the cards and answers two questions the totals
 * cannot: how was each number reached, and what does each one actually cover.
 *
 * ── WHAT IT REFUSES TO DO ───────────────────────────────────────────────
 *
 * It does not rank and it does not name a winner - the cards above already
 * score, and a second opinion dressed as arithmetic would just be louder.
 *
 * It shows a rate per square metre ONLY where an area is genuinely known: from a
 * package priced per m², or from the area the BUYER stated in their own brief.
 * Everywhere else the cell is "—". A rate derived from an invented denominator
 * is the number a customer would actually use to choose.
 *
 * And it reports scope in THREE states. A quotation that never mentions kitchen
 * cabinets has not excluded them and has not included them; filing that silence
 * under either heading invents a difference or invents an agreement. Silence is
 * shown as "not stated" and the customer is told to ask.
 */
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Check, Minus, X } from 'lucide-react';
import { formatMoney } from '@shared/money';
import { PRICING_METHOD_LABELS, isPricingMethod } from '@shared/quotationPricing';
import { pricingBasisLabel, type ServicePricingBasis } from '@shared/serviceCatalogue';
import { pricingPreferenceLabel, isPricingPreference } from '@shared/finishing';

export default function CrossMethodComparison({ rfqId, lang }: { rfqId: number; lang: 'en' | 'ar' }) {
  const ar = lang === 'ar';
  const { data, isLoading, isError } = trpc.rfq.comparison.useQuery({ rfqId });

  // ERROR IS NOT EMPTY. A failed read must not render as "no quotations".
  if (isError) {
    return (
      <Card data-testid="cross-method-error">
        <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4" />
          {ar ? 'تعذّر تحميل المقارنة التفصيلية. حدّث الصفحة.' : 'The detailed comparison could not be loaded. Refresh to try again.'}
        </CardContent>
      </Card>
    );
  }
  if (isLoading || !data) return null;
  const rows = data.quotations;
  // One quotation is not a comparison.
  if (rows.length < 2) return null;

  const currency = data.currency;
  const money = (value: number | string | null | undefined) =>
    value == null ? '—' : (formatMoney(value, currency, lang) ?? String(value));

  const methodLabel = (method: string) =>
    isPricingMethod(method) ? PRICING_METHOD_LABELS[method][lang] : method;

  return (
    <Card data-testid="cross-method-comparison">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {ar ? 'مقارنة النطاق والتسعير' : 'Scope and pricing, side by side'}
        </CardTitle>
        {data.pricingPreference && isPricingPreference(data.pricingPreference) ? (
          <p className="text-xs text-muted-foreground" data-testid="comparison-preference">
            {ar ? 'طريقة التسعير المطلوبة: ' : 'You asked to be priced by: '}
            {pricingPreferenceLabel(data.pricingPreference, lang)}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ── THE NORMALIZED NUMBERS ────────────────────────────────────── */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="comparison-table">
            <thead>
              <tr className="border-b text-start text-xs text-muted-foreground">
                <th className="py-2 pe-3 text-start font-medium">{ar ? 'المورّد' : 'Provider'}</th>
                <th className="py-2 pe-3 text-start font-medium">{ar ? 'طريقة التسعير' : 'Method'}</th>
                <th className="py-2 pe-3 text-end font-medium">{ar ? 'الأساس' : 'Base'}</th>
                <th className="py-2 pe-3 text-end font-medium">{ar ? 'ض.ق.م' : 'VAT'}</th>
                <th className="py-2 pe-3 text-end font-medium">{ar ? 'الإجمالي' : 'Total'}</th>
                <th className="py-2 pe-3 text-end font-medium">{ar ? 'للمتر²' : 'Per m²'}</th>
                <th className="py-2 text-end font-medium">{ar ? 'المدة' : 'Duration'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-b last:border-0" data-testid="comparison-row">
                  <td className="py-2 pe-3">
                    <span className="font-medium">{row.providerName ?? (ar ? 'مورّد' : 'Provider')}</span>
                  </td>
                  <td className="py-2 pe-3">
                    <Badge variant="outline" data-testid="comparison-method">{methodLabel(row.method)}</Badge>
                    {row.method === 'package' && row.packageBasis ? (
                      <span className="ms-1 text-xs text-muted-foreground">
                        {pricingBasisLabel(row.packageBasis as ServicePricingBasis, lang)}
                      </span>
                    ) : null}
                    {row.method === 'percentage' && row.percentageRate ? (
                      <span className="ms-1 text-xs text-muted-foreground">{Number(row.percentageRate)}%</span>
                    ) : null}
                  </td>
                  <td className="py-2 pe-3 text-end tabular-nums">{money(row.totals.base)}</td>
                  <td className="py-2 pe-3 text-end tabular-nums" data-testid="comparison-vat">
                    {/* UNSTATED IS NOT ZERO. Rendering a blank rate as 0 would
                        tell a customer the bid is zero-rated, which is a claim
                        the contractor did not make. */}
                    {row.totals.vatRate === null
                      ? <span className="text-xs text-muted-foreground">{ar ? 'غير محددة' : 'Not stated'}</span>
                      : money(row.totals.vatAmount)}
                  </td>
                  <td className="py-2 pe-3 text-end font-semibold tabular-nums" data-testid="comparison-total">
                    {money(row.totals.total)}
                    {/* The stored total is the agreed figure. If its stored
                        components no longer reproduce it, the TOTAL still
                        stands and the breakdown is flagged rather than quietly
                        shown as if it reconciled. */}
                    {row.reconciles === false ? (
                      <span className="ms-1 text-xs font-normal text-amber-600" data-testid="comparison-unreconciled">
                        {ar ? '(التفصيل غير مطابق)' : '(breakdown unverified)'}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pe-3 text-end tabular-nums" data-testid="comparison-rate">
                    {row.ratePerUnitArea === null
                      ? <span className="text-xs text-muted-foreground">—</span>
                      : money(row.ratePerUnitArea)}
                  </td>
                  <td className="py-2 text-end tabular-nums">
                    {row.timelineDays ? `${row.timelineDays} ${ar ? 'يوم' : 'days'}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.some(row => row.ratePerUnitArea === null) ? (
          <p className="text-xs text-muted-foreground" data-testid="comparison-rate-note">
            {ar
              ? 'سعر المتر يظهر فقط عندما تكون المساحة معروفة — من باقة مُسعّرة بالمتر أو من المساحة التي ذكرتها في طلبك.'
              : 'A per-m² rate is shown only where the area is known — from a package priced per m², or from the area you stated in your request.'}
          </p>
        ) : null}

        {/* ── WHAT EACH ONE COVERS ──────────────────────────────────────── */}
        {data.differences.length > 0 ? (
          <div data-testid="comparison-differences">
            <p className="mb-2 text-sm font-semibold">
              {ar ? 'اختلافات النطاق' : 'Where the scopes differ'}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-2 pe-3 text-start font-medium">{ar ? 'البند' : 'Item'}</th>
                    {rows.map(row => (
                      <th key={row.id} className="py-2 pe-3 text-center font-medium">
                        {row.providerName ?? `#${row.id}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.differences.map(difference => (
                    <tr key={difference.item} className="border-b last:border-0"
                      data-testid="comparison-difference">
                      <td className="py-2 pe-3">{difference.item}</td>
                      {rows.map(row => {
                        const included = difference.includedIn.includes(row.id);
                        const excluded = difference.excludedIn.includes(row.id);
                        return (
                          <td key={row.id} className="py-2 pe-3 text-center">
                            {/* THREE STATES, and not by colour alone: each has
                                its own glyph and its own accessible label. */}
                            {included ? (
                              <span className="inline-flex items-center gap-1 text-emerald-600"
                                title={ar ? 'مشمول' : 'Included'}>
                                <Check className="h-4 w-4" />
                                <span className="sr-only">{ar ? 'مشمول' : 'Included'}</span>
                              </span>
                            ) : excluded ? (
                              <span className="inline-flex items-center gap-1 text-rose-600"
                                title={ar ? 'غير مشمول' : 'Excluded'}>
                                <X className="h-4 w-4" />
                                <span className="sr-only">{ar ? 'غير مشمول' : 'Excluded'}</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-muted-foreground"
                                title={ar ? 'لم يُذكر' : 'Not stated'}>
                                <Minus className="h-4 w-4" />
                                <span className="sr-only">{ar ? 'لم يُذكر' : 'Not stated'}</span>
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground" data-testid="comparison-silence-note">
              {ar
                ? '«لم يُذكر» يعني أن العرض لم يتناول هذا البند — لا أنه مشمول ولا أنه مستثنى. اسأل المورّد قبل المقارنة على السعر.'
                : '"Not stated" means the quotation did not address that item — not that it is included, and not that it is excluded. Ask before comparing on price.'}
            </p>
          </div>
        ) : null}

        {/* ── THE PERCENTAGE BASIS, disclosed ───────────────────────────── */}
        {rows.filter(row => row.method === 'percentage' && row.percentageBasisNote).map(row => (
          <div key={row.id} className="rounded-lg border p-3 text-xs" data-testid="comparison-basis-note">
            <p className="mb-1 font-medium">
              {row.providerName ?? `#${row.id}`} · {ar ? 'أساس حساب النسبة' : 'Percentage basis'}
              {row.materialBaseAmount != null ? ` · ${money(row.materialBaseAmount)}` : ''}
            </p>
            <p className="whitespace-pre-line text-muted-foreground">{row.percentageBasisNote}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
