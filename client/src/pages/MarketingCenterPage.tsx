import { Link } from 'wouter';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import DashboardLayout from '@/components/DashboardLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import { PlacementBadge } from '@/components/MasterPlacement';
import { rateIsMeaningful, MIN_RATE_SAMPLE } from '@shared/placementAnalytics';
import { Megaphone, Sparkles, TrendingUp } from 'lucide-react';

/**
 * ── THE SUPPLIER'S MARKETING CENTER (§89 item 16) ───────────────────────
 *
 * It answers the five questions the owner named, and nothing else:
 *
 *   how is my business being promoted?      the placement list
 *   what is active right now?               counted per LABEL, never summed
 *   what is its scope and expiry?           surface, category, dates
 *   how is it performing?                   counts of REAL recorded events
 *   what can I do next?                     actions that actually exist
 *
 * ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────
 *
 * No budget, spend, CPC, CPM, revenue, GMV, ROI, projected reach, trend line
 * or comparison against other suppliers. BuildHub has no payment provider,
 * so each of those would be a number invented to make the page look
 * commercial - and a supplier who acted on a fabricated ROI would be making
 * real decisions on something BuildHub made up (§10, §30).
 *
 * THE THREE KINDS STAY APART (§18). Featured is BuildHub's editorial pick,
 * Sponsored is a commercial placement, and the Showcase is the supplier's
 * own storefront emphasis - which is reported here as explicitly NOT
 * promotion, so it cannot be read as something they were granted.
 */
export default function MarketingCenterPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const overview = trpc.profile.marketingOverview.useQuery(undefined, { retry: false });

  const data = overview.data;
  const placements = data?.placements ?? [];
  const when = (value: string | Date | null) =>
    value ? new Date(value).toLocaleDateString(ar ? 'ar-EG' : 'en-GB') : null;

  /**
   * A rate is a percentage, or it is NOT ENOUGH DATA. Never a decorative 0.
   *
   * TWO WAYS IT CAN BE MEANINGLESS, and both say the same thing to the
   * reader. A null rate had NO denominator at all. A rate over a denominator
   * below `MIN_RATE_SAMPLE` is arithmetically true and statistically
   * worthless - "0.0% click rate" over one impression reads as "nobody
   * clicks this", which the evidence cannot support (§68).
   *
   * The underlying counts are untouched, so this supplier's figures and the
   * administrator's remain the same numbers.
   */
  const asRate = (value: number | null, sample: number) =>
    value === null || !rateIsMeaningful(sample)
      ? (ar ? 'لا توجد بيانات كافية' : 'Not enough data')
      : `${value.toFixed(1)}%`;

  return (
    <DashboardLayout>
      <div className="space-y-6" dir={ar ? 'rtl' : 'ltr'} data-testid="marketing-center">
        <div>
          <h1 className="text-xl font-bold">{ar ? 'مركز التسويق' : 'Marketing Center'}</h1>
          <p className="text-sm text-muted-foreground">
            {ar
              ? 'كيف يُعرض نشاطك على BuildHub، وما هو فعّال الآن، ونطاقه وانتهاؤه، وأداؤه من أحداث مسجّلة فعلياً.'
              : 'How your business appears across BuildHub, what is active now, its scope and expiry, and how it is performing from events BuildHub actually recorded.'}
          </p>
        </div>

        {overview.isError ? (
          /* AN OUTAGE IS NOT "NO PROMOTION" (§10, §64). Reporting zeros here
             would tell a supplier their placements are not working. */
          <Card><CardContent className="py-8">
            <LoadFailed {...loadFailedCopy(ar)} onRetry={() => void overview.refetch()} />
          </CardContent></Card>
        ) : overview.isLoading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
        ) : (
          <>
            {/* WHAT IS ACTIVE, COUNTED PER LABEL. Summing an editorial pick
                with a commercial slot would report BuildHub as selling
                inventory it gave away (§18). */}
            <div className="grid gap-3 sm:grid-cols-3">
              <Card data-testid="marketing-active-featured">
                <CardContent className="pt-6">
                  <p className="text-2xl font-semibold tabular-nums">{data?.activeFeatured ?? 0}</p>
                  <p className="mt-1 text-sm font-medium">{ar ? 'ترشيحات BuildHub الفعّالة' : 'Active Featured'}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {ar ? 'اختيار تحريري من BuildHub' : "BuildHub's editorial selection"}
                  </p>
                </CardContent>
              </Card>
              <Card data-testid="marketing-active-sponsored">
                <CardContent className="pt-6">
                  <p className="text-2xl font-semibold tabular-nums">{data?.activeSponsored ?? 0}</p>
                  <p className="mt-1 text-sm font-medium">{ar ? 'المساحات المدفوعة الفعّالة' : 'Active Sponsored'}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {ar ? 'مساحة تجارية ممنوحة إدارياً' : 'Commercial placement, granted by BuildHub'}
                  </p>
                </CardContent>
              </Card>
              <Card data-testid="marketing-showcase-count">
                <CardContent className="pt-6">
                  <p className="text-2xl font-semibold tabular-nums">{data?.showcaseCount ?? 0}</p>
                  <p className="mt-1 text-sm font-medium">{ar ? 'مختارات واجهتك' : 'Storefront highlights'}</p>
                  {/* SAID PLAINLY, so it cannot be read as promotion granted. */}
                  <p className="mt-0.5 text-xs text-muted-foreground" data-testid="marketing-showcase-note">
                    {ar
                      ? 'اختيارك أنت — لا يغيّر ترتيبك في السوق'
                      : 'Your own choice — does not change your marketplace ranking'}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* HOW IT IS PERFORMING, FROM REAL EVENTS ONLY. */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Megaphone className="h-4 w-4" />
                  {ar ? 'مساحاتك على BuildHub' : 'Your placements'}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {ar
                    ? 'كل رقم هنا هو عدّ لأحداث سجّلتها BuildHub فعلاً: ظهور، وفتح الصفحة، ونقرة إجراء، وطلب مؤهل.'
                    : 'Every figure here counts events BuildHub actually recorded: impressions, page opens, action clicks and qualified enquiries.'}
                </p>
              </CardHeader>
              <CardContent>
                {placements.length === 0 ? (
                  /* AN EMPTY STATE THAT EXPLAINS THE LEGITIMATE ROUTE, and
                     does not invent a "buy placement" button for a product
                     with no payment provider (§30, §76). */
                  <div className="rounded-lg border border-dashed py-10 text-center" data-testid="marketing-empty">
                    <p className="text-sm text-muted-foreground">
                      {ar
                        ? 'لا توجد لديك مساحات مدفوعة أو ترشيحات حالياً. الترشيح اختيار تحريري من BuildHub، والمساحة التجارية تُمنح إدارياً.'
                        : 'You have no Sponsored placements or Featured selections right now. Featured is BuildHub’s editorial choice, and Sponsored placement is granted by BuildHub.'}
                    </p>
                    <p className="mx-auto mt-2 max-w-lg text-xs text-muted-foreground">
                      {ar
                        ? 'ما يمكنك فعله الآن: أكمل ملفك، وانشر منتجاتك وخدماتك، واختر مختارات واجهتك — هذه هي العوامل التي تجعل نشاطك قابلاً للاكتشاف.'
                        : 'What you can do now: complete your profile, publish your products and services, and choose your storefront highlights — these are what make your business discoverable.'}
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <Button asChild size="sm" data-testid="marketing-empty-showcase">
                        <Link href="/settings#settings-showcase">{ar ? 'اختر مختاراتك' : 'Choose your highlights'}</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline" data-testid="marketing-empty-catalogue">
                        <Link href="/settings#settings-services">{ar ? 'حدّث كتالوج الخدمات' : 'Update your service catalogue'}</Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3" data-testid="marketing-placements">
                    {placements.map(placement => (
                      <div
                        key={placement.placementId}
                        className="rounded-lg border p-3"
                        data-testid={`marketing-placement-${placement.placementId}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {/* THE CANONICAL BADGE, the same component the
                                  marketplace renders - so Featured and
                                  Sponsored cannot start looking alike here. */}
                              <PlacementBadge label={placement.label} />
                              <span className="truncate text-sm font-medium">
                                {placement.entityName ?? `#${placement.placementId}`}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {[
                                placement.entityType === 'PRODUCT'
                                  ? (ar ? 'منتج' : 'Product')
                                  : (ar ? 'مزوّد' : 'Provider'),
                                placement.category,
                                placement.surface,
                              ].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          {/* SCOPE AND EXPIRY (§89). An open-ended placement
                              says so; it is not rendered as expired. */}
                          <div className="text-end text-xs">
                            <Badge
                              variant={placement.active ? 'secondary' : 'outline'}
                              className={placement.active ? undefined : 'text-muted-foreground'}
                              data-testid={`marketing-active-${placement.placementId}`}
                            >
                              {placement.active ? (ar ? 'فعّال' : 'Active') : (ar ? 'غير فعّال' : 'Not active')}
                            </Badge>
                            <p className="mt-1 text-muted-foreground" data-testid={`marketing-period-${placement.placementId}`}>
                              {placement.endsAt
                                ? (ar ? `حتى ${when(placement.endsAt)}` : `Until ${when(placement.endsAt)}`)
                                : (ar ? 'مفتوح حتى الإلغاء' : 'Open-ended until revoked')}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                          {[
                            { label: ar ? 'ظهور' : 'Impressions', value: placement.impressions },
                            { label: ar ? 'فتح الصفحة' : 'Page opens', value: placement.entityViews },
                            { label: ar ? 'نقرات الإجراء' : 'Action clicks', value: placement.ctaActions },
                            { label: ar ? 'طلبات مؤهلة' : 'Qualified enquiries', value: placement.qualifiedEnquiries },
                          ].map(metric => (
                            <div key={metric.label}>
                              <p className="text-base font-semibold tabular-nums">{metric.value}</p>
                              <p className="text-muted-foreground">{metric.label}</p>
                            </div>
                          ))}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                          {/* NOT ENOUGH DATA, rather than 0% (§68). A rate over
                              a zero denominator is undefined, and printing
                              "0.0%" would read as "nobody clicks this". */}
                          <span data-testid={`marketing-ctr-${placement.placementId}`}>
                            {ar ? 'نسبة النقر' : 'Click rate'}: {asRate(placement.ctr, placement.impressions)}
                          </span>
                          <span>{ar ? 'نسبة الفتح' : 'Open rate'}: {asRate(placement.viewRate, placement.impressions)}</span>
                          <span>{ar ? 'نسبة الطلبات' : 'Enquiry rate'}: {asRate(placement.conversionRate, placement.entityViews)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* WHERE THE NUMBERS COME FROM. A supplier reading a commercial
                report is entitled to know what is being counted. */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-4 w-4" />
                  {ar ? 'ماذا تعني هذه الأرقام' : 'What these figures mean'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {ar
                    ? 'الظهور: عُدّ عندما ظهرت مساحتك فعلاً على الشاشة لمدة كافية — وليس عند تحميل الصفحة.'
                    : 'An impression is counted when your placement was actually on screen long enough to be seen — not when the page loaded.'}
                </p>
                <p>
                  {ar
                    ? `النِسب تظهر فقط بعد ${MIN_RATE_SAMPLE} ظهوراً على الأقل. قبل ذلك نقول «لا توجد بيانات كافية» بدل عرض نسبة لا يمكن الاعتماد عليها.`
                    : `Rates are shown only once there have been at least ${MIN_RATE_SAMPLE} impressions. Below that we say "Not enough data" rather than a percentage you could not rely on.`}
                </p>
                <p className="flex items-start gap-1.5">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {ar
                    ? 'لا تعرض BuildHub ميزانيات أو تكلفة نقرة أو عائداً على الإنفاق، لأنه لا توجد بعد بوابة دفع — ورقم كهذا سيكون مُختلقاً.'
                    : 'BuildHub shows no budget, cost-per-click or return-on-spend figures, because there is no payment provider yet — any such number would be invented.'}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
