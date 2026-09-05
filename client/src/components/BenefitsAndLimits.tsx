import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';

/**
 * WHAT THIS ACCOUNT IS ENTITLED TO, AND WHY.
 *
 * `billing.myEntitlements` and `billing.myPlan` have existed for a long time
 * and NEITHER HAS EVER HAD A SCREEN. A vendor whose allowance changed - a
 * referral paid out, an administrator granted something, a bonus lapsed - had
 * nowhere to find out why. "You have 46 qualified enquiries" is not an answer
 * to "why 46", and the vendor asking that question is usually about to open a
 * support ticket.
 *
 * THE BREAKDOWN IS THE POINT. Plan, plus an administrator's grant, plus every
 * bonus in force, adding to the number the platform actually enforces - and if
 * the parts do not add up to that number, this SAYS SO rather than showing a
 * tidy sum. Being shown a breakdown that disagrees with what you are given is
 * worse than being shown none.
 *
 * NOTHING IS INVENTED. Every figure comes from the same resolver the enquiry
 * gate uses; a capability the plan grants but BuildHub has not built is not
 * listed as available.
 */
export default function BenefitsAndLimits() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const failedCopy = loadFailedCopy(ar);
  const benefits = trpc.billing.myBenefits.useQuery(undefined, { retry: false });

  if (benefits.isError) {
    return (
      <Card data-testid="benefits-and-limits">
        <CardContent className="pt-6">
          <LoadFailed {...failedCopy} onRetry={() => void benefits.refetch()} />
        </CardContent>
      </Card>
    );
  }
  if (!benefits.data) {
    /*
     * ITS OWN MARKER. Sharing `benefits-and-limits` with the loaded card made
     * the two states indistinguishable - to a reader and to anything checking
     * the screen, which could report a still-loading card as a rendered one.
     */
    return (
      <Card data-testid="benefits-loading">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          {ar ? 'جارٍ التحميل…' : 'Loading…'}
        </CardContent>
      </Card>
    );
  }

  const { plan, usage, allowance } = benefits.data;
  const unlimited = (value: number | null) => (value === null ? (ar ? 'بلا حد' : 'Unlimited') : String(value));
  const capabilities = Object.entries(plan.capabilities).filter(([, usable]) => usable);

  return (
    <Card data-testid="benefits-and-limits">
      <CardContent className="space-y-5 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" data-testid="benefits-plan">
            {ar ? 'الباقة' : 'Plan'}: {plan.plan}
          </Badge>
          <Badge variant="outline">{ar ? 'الحالة' : 'Status'}: {plan.status}</Badge>
          {plan.inTrial && <Badge variant="outline">{ar ? 'فترة تجريبية' : 'Trial'}</Badge>}
        </div>

        {/* ── Qualified enquiries: where the number comes from ───────────── */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{ar ? 'طلبات التسعير المؤهلة' : 'Qualified enquiries'}</h4>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b">
                  <td className="p-2 text-muted-foreground">{ar ? 'من الباقة' : 'From your plan'}</td>
                  <td className="p-2 text-end" data-testid="benefits-plan-allowance">{unlimited(allowance.planAllowance)}</td>
                </tr>
                {allowance.adminOverride && (
                  <tr className="border-b">
                    <td className="p-2 text-muted-foreground">
                      {ar ? 'منحة من الإدارة (تحل محل الباقة)' : 'Granted by BuildHub (replaces the plan figure)'}
                      {allowance.adminOverride.reason && (
                        <p className="text-xs">{allowance.adminOverride.reason}</p>
                      )}
                    </td>
                    <td className="p-2 text-end" data-testid="benefits-admin-override">
                      {unlimited(allowance.adminOverride.value)}
                    </td>
                  </tr>
                )}
                {allowance.bonuses.map(bonus => (
                  <tr key={bonus.id} className="border-b">
                    <td className="p-2 text-muted-foreground">
                      {ar ? 'مكافأة إضافية' : 'Bonus'}
                      {bonus.reason && <p className="text-xs">{bonus.reason}</p>}
                      {bonus.endsAt && (
                        <p className="text-xs">
                          {ar ? 'حتى' : 'until'} {new Date(bonus.endsAt as string).toLocaleDateString()}
                        </p>
                      )}
                    </td>
                    <td className="p-2 text-end" data-testid={`benefits-bonus-${bonus.id}`}>+{bonus.value ?? 0}</td>
                  </tr>
                ))}
                <tr className="border-b font-medium">
                  <td className="p-2">{ar ? 'المسموح به شهريًا' : 'Your monthly allowance'}</td>
                  <td className="p-2 text-end" data-testid="benefits-effective">{unlimited(allowance.effective)}</td>
                </tr>
                <tr className="border-b">
                  <td className="p-2 text-muted-foreground">{ar ? 'المستخدم هذا الشهر' : 'Used this month'}</td>
                  <td className="p-2 text-end" data-testid="benefits-used">{usage.used}</td>
                </tr>
                <tr>
                  <td className="p-2 text-muted-foreground">{ar ? 'المتبقي' : 'Remaining'}</td>
                  <td className="p-2 text-end" data-testid="benefits-remaining">{unlimited(usage.remaining)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="benefits-reset">
            {ar ? 'يُعاد الاحتساب في' : 'Resets on'} {new Date(usage.resetsAt).toLocaleDateString()}
          </p>

          {/*
            THE PARTS DISAGREE WITH THE TOTAL. Never hidden and never smoothed
            over: the enforced number is what the vendor gets, and them seeing a
            breakdown that does not reach it is a real problem, not a display
            detail.
          */}
          {allowance.mismatch && (
            <p className="text-xs text-destructive" data-testid="benefits-mismatch">
              {ar
                ? `المجموع أعلاه (${unlimited(allowance.computed)}) لا يطابق ما يطبّقه النظام (${unlimited(allowance.effective)}). المطبَّق فعليًا هو الرقم الثاني — يرجى التواصل مع الدعم.`
                : `The parts above add to ${unlimited(allowance.computed)}, which does not match the ${unlimited(allowance.effective)} BuildHub is enforcing. The enforced figure is what applies - please contact support.`}
            </p>
          )}
        </div>

        {/* ── What this plan can actually do ─────────────────────────────── */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{ar ? 'ما تشمله باقتك' : 'Included in your plan'}</h4>
          {capabilities.length === 0 ? (
            /* Truthful: a free account genuinely has none of the paid
               capabilities, and saying so beats an empty box. */
            <p className="rounded-lg border border-dashed py-4 text-center text-sm text-muted-foreground">
              {ar
                ? 'باقتك الحالية لا تتضمن مزايا إضافية.'
                : 'Your current plan includes no additional capabilities.'}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2" data-testid="benefits-capabilities">
              {capabilities.map(([capability]) => (
                <Badge key={capability} variant="outline">{capability}</Badge>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
