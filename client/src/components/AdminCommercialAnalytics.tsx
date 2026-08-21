import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, TrendingUp, Users } from 'lucide-react';

/**
 * The owner's commercial and funnel view (Slice 7).
 *
 * Two panels, deliberately kept apart because they answer to different sources
 * of truth:
 *
 *   Revenue comes from `vendorSubscriptions`, priced from shared/billing.ts.
 *   It is the financial record.
 *
 *   The funnel comes from the analytics event stream. An event stream is
 *   allowed to be lossy; a revenue figure is not. Presenting them as one number
 *   would let a dropped event look like lost money.
 *
 * Nothing here invents a value. Where there is nothing to show it says so -
 * `arpv` and the median-days figures come back as null rather than 0, and a
 * null renders as an em dash, because "zero days to verification" and "nobody
 * has been verified yet" are different facts about the business.
 */

const FUNNEL_LABEL_KEYS: Record<string, string> = {
  registered: 'kpi.funnel.registered',
  profileCompleted: 'kpi.funnel.profileCompleted',
  submittedForReview: 'kpi.funnel.submittedForReview',
  verified: 'kpi.funnel.verified',
  firstEnquiry: 'kpi.funnel.firstEnquiry',
  firstQuotation: 'kpi.funnel.firstQuotation',
  trialStarted: 'kpi.funnel.trialStarted',
  subscribed: 'kpi.funnel.subscribed',
};

export default function AdminCommercialAnalytics({ includeDummy = false }: { includeDummy?: boolean }) {
  const { lang, t } = useLanguage();
  const ar = lang === 'ar';

  const { data: kpis, isLoading: kpisLoading } = trpc.admin.commercialKpis.useQuery({ includeDummy });
  const { data: product, isLoading: productLoading } = trpc.admin.productAnalytics.useQuery({ includeDummy });

  const number = (value: number) => value.toLocaleString(ar ? 'ar-EG' : 'en-US');
  const money = (value: number) =>
    `${kpis?.currency ?? ''} ${value.toLocaleString(ar ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })}`.trim();
  const orDash = (value: number | null | undefined, format: (value: number) => string) =>
    value === null || value === undefined ? '—' : format(value);

  if (kpisLoading || productLoading) {
    return <div className="py-10 text-center text-muted-foreground">{t('common.loading')}</div>;
  }

  const top = product?.funnel?.[0]?.users ?? 0;

  return (
    <div className="space-y-6">
      {/* ── Revenue ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            {t('kpi.revenueTitle')}
          </CardTitle>
          <p className="text-xs text-muted-foreground pt-1">{t('kpi.revenueSource')}</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: t('kpi.mrr'), value: orDash(kpis?.mrr, money) },
              { label: t('kpi.arr'), value: orDash(kpis?.arr, money) },
              { label: t('kpi.arpv'), value: orDash(kpis?.arpv, money) },
              { label: t('kpi.payingVendors'), value: orDash(kpis?.payingVendors, number) },
            ].map(cell => (
              <div key={cell.label} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{cell.label}</p>
                <p className="text-lg font-semibold mt-0.5">{cell.value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-3 text-sm">
            {[
              { label: t('kpi.trialing'), value: orDash(kpis?.trialingVendors, number), note: t('kpi.trialingNote') },
              { label: t('kpi.atRisk'), value: orDash(kpis?.atRiskVendors, number), note: t('kpi.atRiskNote') },
              { label: t('kpi.scheduledToCancel'), value: orDash(kpis?.scheduledToCancel, number), note: null },
              { label: t('kpi.founderPriced'), value: orDash(kpis?.founderPricedVendors, number), note: t('kpi.founderNote') },
            ].map(cell => (
              <div key={cell.label}>
                <p className="text-xs text-muted-foreground">{cell.label}</p>
                <p className="font-medium mt-0.5">{cell.value}</p>
                {cell.note && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{cell.note}</p>}
              </div>
            ))}
          </div>

          {/* Churn is stated with its window and its denominator, because a
              percentage over two subscriptions is not the same claim as the
              same percentage over two hundred. */}
          <div className="rounded-lg border p-3 mt-3">
            <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
              <span className="text-muted-foreground">
                {t('kpi.churn')} · {t('kpi.churnWindow')} {number(kpis?.churn?.windowDays ?? 0)} {t('pricing.days')}
              </span>
              <span className="font-semibold">
                {kpis?.churn?.ratePercent === null || kpis?.churn?.ratePercent === undefined
                  ? t('kpi.noBasis')
                  : `${kpis.churn.ratePercent}% · ${number(kpis.churn.churned)} / ${number(kpis.churn.atStart)}`}
              </span>
            </div>
          </div>

          {(kpis?.dataIntegrityIssues ?? 0) > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 mt-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">
                {number(kpis!.dataIntegrityIssues)} {t('kpi.integrityIssues')}
              </p>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-start py-2 px-3 font-medium text-muted-foreground">{t('billing.currentPlan')}</th>
                  <th className="text-start py-2 px-3 font-medium text-muted-foreground">{t('kpi.payingVendors')}</th>
                  <th className="text-start py-2 px-3 font-medium text-muted-foreground">{t('kpi.trialing')}</th>
                  <th className="text-start py-2 px-3 font-medium text-muted-foreground">{t('kpi.mrr')}</th>
                </tr>
              </thead>
              <tbody>
                {(kpis?.byPlan ?? []).map(row => (
                  <tr key={row.plan} className="border-b last:border-0">
                    <td className="py-2 px-3 font-medium capitalize">{row.plan}</td>
                    <td className="py-2 px-3">{number(row.payingVendors)}</td>
                    <td className="py-2 px-3">{number(row.trialingVendors)}</td>
                    <td className="py-2 px-3">{money(row.mrr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Funnel ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4" />
            {t('kpi.funnelTitle')}
          </CardTitle>
          <p className="text-xs text-muted-foreground pt-1">{t('kpi.funnelSource')}</p>
        </CardHeader>
        <CardContent>
          {top === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
              {t('kpi.noEvents')}
            </div>
          ) : (
            <div className="space-y-3">
              {(product?.funnel ?? []).map(stage => (
                <div key={stage.stage}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span>{t(FUNNEL_LABEL_KEYS[stage.stage] ?? stage.stage)}</span>
                    <span className="font-medium">
                      {number(stage.users)}
                      <span className="text-muted-foreground font-normal ms-1.5">
                        {top > 0 ? `${Math.round((stage.users / top) * 100)}%` : ''}
                      </span>
                    </span>
                  </div>
                  <Progress value={top > 0 ? (stage.users / top) * 100 : 0} className="h-1.5 mt-1" />
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 mt-4 text-sm">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t('kpi.medianToVerified')}</p>
              <p className="font-semibold mt-0.5">
                {orDash(product?.medianDaysToVerified, value => `${number(value)} ${t('pricing.days')}`)}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t('kpi.medianToFirstQuotation')}</p>
              <p className="font-semibold mt-0.5">
                {orDash(product?.medianDaysToFirstQuotation, value => `${number(value)} ${t('pricing.days')}`)}
              </p>
            </div>
          </div>

          {(product?.eventCounts?.length ?? 0) > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                {t('kpi.recentActivity')} · {number(product?.windowDays ?? 0)} {t('pricing.days')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(product?.eventCounts ?? []).slice(0, 14).map(row => (
                  <Badge key={row.eventType} variant="outline" className="text-[11px] font-normal">
                    {row.eventType}
                    <span className="ms-1.5 font-semibold">{number(row.count)}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
