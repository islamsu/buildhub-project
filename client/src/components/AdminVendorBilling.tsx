import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AlertTriangle, CreditCard, Search } from 'lucide-react';

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
 * The admin lifecycle MUTATIONS (start trial, change plan, record payment
 * outcomes, reconcile) exist on the server and are intentionally not wired up
 * here. They are operational tools, and exposing them as buttons invites
 * exactly the kind of unaudited manual plan-granting the lifecycle was built to
 * prevent.
 *
 * No provider handle, price reference, or credential appears in either
 * response: `ADMIN_SUBSCRIPTION_COLUMNS` excludes every `provider*Ref` by
 * construction, and BuildHub stores no card or token data anywhere.
 */
export default function AdminVendorBilling() {
  const { lang, t } = useLanguage();
  const ar = lang === 'ar';
  const [draft, setDraft] = useState('');
  const [userId, setUserId] = useState<number | null>(null);

  const enabled = userId !== null;
  const { data: lifecycle, isLoading } = trpc.admin.vendorLifecycle.useQuery(
    { userId: userId ?? 0 }, { enabled },
  );
  const { data: billing } = trpc.admin.vendorBilling.useQuery(
    { userId: userId ?? 0 }, { enabled },
  );

  const date = (value: string | Date | null | undefined) =>
    value ? new Date(value).toLocaleString(ar ? 'ar-EG' : 'en-US') : '—';

  const submit = () => {
    const parsed = Number(draft.trim());
    setUserId(Number.isInteger(parsed) && parsed > 0 ? parsed : null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="w-5 h-5" />
          {t('adminBilling.title')}
        </CardTitle>
        <div className="flex flex-wrap items-end gap-2 pt-3">
          <div className="w-full sm:w-56">
            <label className="text-xs text-muted-foreground" htmlFor="admin-billing-user">
              {t('adminBilling.lookup')}
            </label>
            <Input
              id="admin-billing-user"
              inputMode="numeric"
              className="h-9 mt-1"
              value={draft}
              onChange={event => setDraft(event.target.value.replace(/\D/g, ''))}
              onKeyDown={event => { if (event.key === 'Enter') submit(); }}
            />
          </div>
          <Button size="sm" className="h-9 gap-1.5" onClick={submit} disabled={!draft.trim()}>
            <Search className="w-3.5 h-3.5" />{t('adminBilling.lookupCta')}
          </Button>
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
