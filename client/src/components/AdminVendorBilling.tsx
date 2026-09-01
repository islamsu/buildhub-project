import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, CreditCard } from 'lucide-react';
import VendorIdentitySelect from '@/components/VendorIdentitySelect';

/**
 * Admin read-only view of one vendor's billing state.
 *
 * Deliberately NOT a billing dashboard - the Phase 4B brief §14 asks only that
 * the lifecycle state be *visible* to support, and explicitly excludes building
 * the dashboard. So this looks up one vendor and shows what support needs to
 * answer "why does this vendor not have the plan they think they have":
 * the derived lifecycle state, the stored versus effective plan, any data
 * integrity problem, and the audit trail of transitions.
 *
 * ONE MUTATION IS NOW WIRED UP: the manual plan change. An earlier version of
 * this file refused to expose any, on the grounds that buttons invite exactly
 * the unaudited manual plan-granting the lifecycle was built to prevent. That
 * objection was right about the danger and wrong about the remedy - the answer
 * to "an unaudited grant" is to make the grant auditable, not to leave the
 * administrator with no lever but a database console.
 *
 * So this one demands a reason, records three separate trails, notifies the
 * vendor in their own language, and routes through the same locked engine as
 * every automatic transition. The other lifecycle mutations (start trial,
 * record payment outcomes, reconcile) remain deliberately unexposed: each
 * asserts that a payment event happened, and a button cannot make that true.
 *
 * No provider handle, price reference, or credential appears in either
 * response: `ADMIN_SUBSCRIPTION_COLUMNS` excludes every `provider*Ref` by
 * construction, and BuildHub stores no card or token data anywhere.
 */
export default function AdminVendorBilling() {
  const { lang, t } = useLanguage();
  const ar = lang === 'ar';
  const [userId, setUserId] = useState<number | null>(null);

  // Hiding the control from an administrator who lacks `billing.manage` is a
  // courtesy, not the enforcement: the server refuses the call regardless, and
  // the tests prove that rather than trusting this line.
  const { data: adminMe } = trpc.admin.me.useQuery(undefined, { retry: false });
  const canManage = adminMe?.permissions.includes('billing.manage' as never) ?? false;

  const enabled = userId !== null;
  const { data: lifecycle, isLoading } = trpc.admin.vendorLifecycle.useQuery(
    { userId: userId ?? 0 }, { enabled },
  );
  const { data: billing } = trpc.admin.vendorBilling.useQuery(
    { userId: userId ?? 0 }, { enabled },
  );

  const date = (value: string | Date | null | undefined) =>
    value ? new Date(value).toLocaleString(ar ? 'ar-EG' : 'en-US') : '—';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="w-5 h-5" />
          {t('adminBilling.title')}
        </CardTitle>
        <div className="w-full pt-3 sm:max-w-md">
          <VendorIdentitySelect
            value={userId}
            onChange={setUserId}
            label={t('adminBilling.lookup')}
            testId="admin-billing-user"
          />
        </div>
      </CardHeader>

      <CardContent>
        {!enabled && (
          <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
            {t('adminBilling.lookup')}
          </div>
        )}

        {enabled && isLoading && (
          <div className="py-10 text-center text-muted-foreground">{t('common.loading')}</div>
        )}

        {enabled && !isLoading && !lifecycle && (
          <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
            {t('adminBilling.noResult')}
          </div>
        )}

        {enabled && lifecycle && (
          <div className="space-y-4">
            {/* Anything support must not miss, first. */}
            {lifecycle.dataIntegrityIssue && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
                <div className="text-sm">
                  <p className="font-medium text-destructive">{t('adminBilling.integrityIssue')}</p>
                  <p className="text-muted-foreground mt-0.5">{lifecycle.dataIntegrityIssue}</p>
                </div>
              </div>
            )}
            {lifecycle.reconciliationRequired && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-700" />
                <p className="text-sm text-amber-900">{t('adminBilling.needsReconcile')}</p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: t('adminBilling.lifecycle'), value: t(`billing.state.${lifecycle.lifecycleState}`) },
                { label: t('adminBilling.effectivePlan'), value: lifecycle.effectivePlan },
                { label: t('adminBilling.storedPlan'), value: lifecycle.storedPlan },
                { label: t('billing.enquiriesThisMonth'), value: lifecycle.qualifiedEnquiryAllowance === null ? t('ent.unlimited') : String(lifecycle.qualifiedEnquiryAllowance) },
              ].map(cell => (
                <div key={cell.label} className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{cell.label}</p>
                  <p className="text-sm font-semibold capitalize mt-0.5">{cell.value}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              {[
                { label: t('billing.trialEnds'), value: date(lifecycle.trialEndsAt) },
                { label: t('billing.renewsOn'), value: date(lifecycle.currentPeriodEnd) },
                { label: t('billing.graceEnds'), value: date(lifecycle.gracePeriodEndsAt) },
                { label: t('billing.founderActive'), value: date(lifecycle.founderPriceEndsAt) },
              ].map(cell => (
                <div key={cell.label}>
                  <p className="text-xs text-muted-foreground">{cell.label}</p>
                  <p className="mt-0.5">{cell.value}</p>
                </div>
              ))}
            </div>

            {canManage && <ManualPlanChange userId={userId!} storedPlan={lifecycle.storedPlan} />}

            {/* Audit trail: the existing billingEvents ledger, not a new one. */}
            <div>
              <h3 className="text-sm font-medium mb-2">{t('adminBilling.history')}</h3>
              {!billing?.events?.length ? (
                <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                  {t('adminBilling.noHistory')}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-start py-2 px-3 font-medium text-muted-foreground">{t('adminBilling.action')}</th>
                        <th className="text-start py-2 px-3 font-medium text-muted-foreground">{t('adminBilling.transition')}</th>
                        <th className="text-start py-2 px-3 font-medium text-muted-foreground">{t('adminBilling.source')}</th>
                        <th className="text-start py-2 px-3 font-medium text-muted-foreground">{t('adminBilling.when')}</th>
                        {/* The note carries the administrator's stated reason.
                            A trail that records the change but not the why is
                            the half of the record a dispute actually needs. */}
                        <th className="text-start py-2 px-3 font-medium text-muted-foreground">{t('adminBilling.note')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billing.events.map(event => (
                        <tr key={event.id} className="border-b last:border-0">
                          <td className="py-2 px-3 font-medium">{event.action}</td>
                          <td className="py-2 px-3 text-muted-foreground">
                            {event.fromStatus ?? '—'} → {event.toStatus ?? '—'}
                          </td>
                          <td className="py-2 px-3">
                            <Badge variant="outline" className="text-[10px]">{event.source ?? '—'}</Badge>
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">{date(event.createdAt)}</td>
                          <td className="py-2 px-3 text-muted-foreground">{event.note ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * MANUAL PLAN CHANGE.
 *
 * The reason field is REQUIRED and the submit button stays disabled without
 * one. That is not form politeness: the reason is what turns a manual grant
 * from an unexplained privilege into a record somebody can audit later, and it
 * is carried into billing history, the account audit trail and the field-value
 * trail. The server enforces it too - this only saves the administrator a
 * round trip.
 *
 * The interval selector appears only when it can actually matter: BuildHub
 * keeps the vendor's existing billing period through a plan CHANGE, so an
 * interval is consulted only when granting access to a vendor who has none.
 * Offering it the rest of the time would imply a control that does nothing.
 *
 * Nothing here reports a result the server did not report. The outcome line
 * distinguishes 'applied' from 'noop' verbatim, so selecting the plan a vendor
 * already holds says "no change" rather than a success message about a change
 * that never happened - and, per the same rule, the vendor is not notified.
 */
function ManualPlanChange({ userId, storedPlan }: { userId: number; storedPlan: string }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();
  const [plan, setPlan] = useState<'free' | 'professional' | 'premium'>('professional');
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  const change = trpc.admin.setVendorPlanManually.useMutation({
    onSuccess: outcome => {
      setError('');
      setReason('');
      setResult(
        outcome.outcome === 'noop'
          ? (ar ? 'لا تغيير: المزوّد على هذه الباقة بالفعل. لم يتم إرسال إشعار.' : 'No change: the vendor is already on that plan. No notification sent.')
          : outcome.cancelAtPeriodEnd && plan === 'free'
            ? (ar
              ? `لن يتم التجديد. تستمر الباقة المدفوعة حتى نهاية الفترة الحالية. الحالة: ${outcome.lifecycleState}`
              : `Set not to renew. Paid access continues to the end of the current period. State: ${outcome.lifecycleState}`)
            : (ar
              ? `تم التغيير إلى ${outcome.plan}. الحالة: ${outcome.lifecycleState}${outcome.notified ? ' · تم إشعار المزوّد' : ''}`
              : `Changed to ${outcome.plan}. State: ${outcome.lifecycleState}${outcome.notified ? ' · vendor notified' : ''}`),
      );
      // The lifecycle, billing history and allowance views all describe the row
      // that just moved. Refetching them is what stops the screen showing a
      // state the database no longer holds.
      void utils.admin.vendorLifecycle.invalidate({ userId });
      void utils.admin.vendorBilling.invalidate({ userId });
      void utils.admin.vendorEnquiryAllowance.invalidate({ userId });
    },
    // The engine's own refusal, rendered as written. It names the rule that
    // refused - "a plan change requires live paid access", "already on that
    // plan" - which is more use than a generic failure.
    onError: mutationError => { setResult(''); setError(mutationError.message); },
  });

  const granting = plan !== 'free' && storedPlan === 'free';

  return (
    <div className="rounded-lg border p-4 space-y-3" data-testid="admin-manual-plan">
      <h3 className="text-sm font-medium">{ar ? 'تغيير الباقة يدويًا' : 'Manual plan change'}</h3>
      <p className="text-xs text-muted-foreground">
        {ar
          ? 'يمر هذا التغيير عبر محرّك الاشتراكات نفسه. الاستهلاك المسجَّل هذا الشهر لا يُلغى، وسجل الباقات محفوظ.'
          : 'This runs through the same subscription engine as every automatic transition. Enquiries already used this period are not revoked, and plan history is preserved.'}
      </p>

      <div className="flex flex-wrap gap-2">
        <div>
          <label className="text-xs text-muted-foreground" htmlFor="manual-plan">{ar ? 'الباقة' : 'Plan'}</label>
          <select
            id="manual-plan"
            data-testid="manual-plan-select"
            className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm"
            value={plan}
            onChange={event => setPlan(event.target.value as typeof plan)}
          >
            <option value="free">{ar ? 'مجانية' : 'Free'}</option>
            <option value="professional">{ar ? 'احترافية' : 'Professional'}</option>
            <option value="premium">{ar ? 'بريميوم' : 'Premium'}</option>
          </select>
        </div>

        {granting && (
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="manual-interval">{ar ? 'مدة الفترة' : 'Billing period'}</label>
            <select
              id="manual-interval"
              data-testid="manual-interval-select"
              className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm"
              value={interval}
              onChange={event => setInterval(event.target.value as typeof interval)}
            >
              <option value="month">{ar ? 'شهري' : 'Monthly'}</option>
              <option value="year">{ar ? 'سنوي' : 'Annual'}</option>
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="text-xs text-muted-foreground" htmlFor="manual-reason">
          {ar ? 'السبب (مطلوب — يُحفظ في السجل)' : 'Reason (required — recorded in the audit trail)'}
        </label>
        <Textarea
          id="manual-reason"
          data-testid="manual-plan-reason"
          className="mt-1"
          rows={2}
          maxLength={500}
          value={reason}
          onChange={event => setReason(event.target.value)}
        />
      </div>

      <Button
        size="sm"
        data-testid="manual-plan-submit"
        disabled={reason.trim() === '' || change.isPending}
        onClick={() => {
          setResult(''); setError('');
          change.mutate({
            userId,
            plan,
            // Sent only when it is consulted, so the payload never implies the
            // period was chosen for a change that keeps the existing one.
            ...(granting ? { interval } : {}),
            reason: reason.trim(),
          });
        }}
      >
        {ar ? 'تطبيق' : 'Apply'}
      </Button>

      {result && <p className="text-sm text-emerald-700" data-testid="manual-plan-result">{result}</p>}
      {error && <p className="text-sm text-destructive" data-testid="manual-plan-error">{error}</p>}
    </div>
  );
}
