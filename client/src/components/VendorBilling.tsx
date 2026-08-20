import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { useLocation } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, CreditCard, Sparkles } from 'lucide-react';

/**
 * Phase 4B Slice 2: the vendor's own plan and billing state.
 *
 * Until now a vendor could not see which plan they were on, when it renewed,
 * or cancel it - the entire billing engine built across 4B.1-4B.4 had no way in.
 *
 * Everything shown here is server-derived. `billing.myLifecycle` takes no input
 * at all, so there is no field a caller could populate to read another vendor's
 * billing state, and the component never computes a plan, allowance, or date
 * itself. Cancel and resume call the two existing mutations and surface the
 * server's own refusal message rather than guessing one.
 */

/** Lifecycle states that mean "something needs the vendor's attention". */
const ATTENTION_STATES = ['GRACE_PERIOD', 'PAST_DUE', 'RECONCILIATION_REQUIRED'] as const;

export default function VendorBilling() {
  const { lang, t } = useLanguage();
  const ar = lang === 'ar';
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const { data, isLoading } = trpc.billing.myLifecycle.useQuery();
  const { data: usage } = trpc.billing.myEnquiryUsage.useQuery();

  const refresh = () => {
    utils.billing.myLifecycle.invalidate();
    utils.billing.myEnquiryUsage.invalidate();
    utils.billing.mySubscription.invalidate();
  };

  // `noop` is a success, not an error: repeating a transition the vendor already
  // completed is the idempotent behaviour the lifecycle guarantees.
  const cancel = trpc.billing.cancelSubscription.useMutation({
    onSuccess: result => {
      toast.success(result.outcome === 'noop' ? t('billing.noChange') : t('billing.canceled'));
      setConfirmCancel(false);
      refresh();
    },
    onError: error => toast.error(error.message),
  });

  const resume = trpc.billing.resumeSubscription.useMutation({
    onSuccess: result => {
      toast.success(result.outcome === 'noop' ? t('billing.noChange') : t('billing.resumed'));
      refresh();
    },
    onError: error => toast.error(error.message),
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground py-4">{t('common.loading')}</div>;
  }
  if (!data) return null;

  const date = (value: string | Date | null) =>
    value ? new Date(value).toLocaleDateString(ar ? 'ar-EG' : 'en-US') : null;

  const state = data.lifecycleState;
  const needsAttention = (ATTENTION_STATES as readonly string[]).includes(state);

  // The one date that matters for the current state, rather than a wall of them.
  const primaryDate: { label: string; value: string | null } | null =
    state === 'TRIALING' ? { label: t('billing.trialEnds'), value: date(data.trialEndsAt) }
    : state === 'CANCELLATION_SCHEDULED' ? { label: t('billing.accessUntil'), value: date(data.currentPeriodEnd) }
    : state === 'GRACE_PERIOD' ? { label: t('billing.graceEnds'), value: date(data.gracePeriodEndsAt) }
    : state === 'ACTIVE' ? { label: t('billing.renewsOn'), value: date(data.currentPeriodEnd) }
    : null;

  const allowance = usage?.allowance ?? null;
  const unlimited = usage != null && allowance === null;
  const pct = usage && allowance ? Math.min(100, (usage.used / allowance) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CreditCard className="w-4 h-4" />
          {t('billing.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Plan + state */}
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs text-muted-foreground">{t('billing.currentPlan')}</p>
              <p className="text-lg font-semibold capitalize">{data.effectivePlan}</p>
            </div>
            <Badge
              variant={needsAttention ? 'destructive' : 'outline'}
              className="text-[11px]"
            >
              {t(`billing.state.${state}`)}
            </Badge>
          </div>

          {primaryDate?.value && (
            <p className="text-sm text-muted-foreground mt-2">
              {primaryDate.label}: <span className="font-medium text-foreground">{primaryDate.value}</span>
            </p>
          )}

          {data.founderPriceActive && data.founderPriceEndsAt && (
            <p className="text-sm text-amber-700 mt-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              {t('billing.founderActive')} {date(data.founderPriceEndsAt)}
            </p>
          )}
          {!data.founderPriceActive && data.founderEligible && (
            <p className="text-sm text-amber-700 mt-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 shrink-0" />{t('billing.founderEligible')}
            </p>
          )}
        </div>

        {/* State-specific notices, worded so the vendor knows access is intact. */}
        {state === 'CANCELLATION_SCHEDULED' && (
          <p className="text-sm text-muted-foreground mt-3">{t('billing.canceledNotice')}</p>
        )}
        {state === 'GRACE_PERIOD' && (
          <p className="text-sm text-amber-700 mt-3 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{t('billing.graceNotice')}
          </p>
        )}
        {state === 'RECONCILIATION_REQUIRED' && (
          <p className="text-sm text-amber-700 mt-3 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{t('billing.reconcileNotice')}
          </p>
        )}

        {/* Allowance, from the same Phase 4B.3 counter the enquiry inbox uses. */}
        {usage && (
          <div className="rounded-lg border p-3 mt-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">{t('billing.enquiriesThisMonth')}</span>
              <span className="font-semibold">
                {unlimited ? `${usage.used} · ${t('ent.unlimited')}` : `${usage.used} / ${allowance}`}
              </span>
            </div>
            {!unlimited && <Progress value={pct} className="h-1.5 mt-2" />}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Button size="sm" variant="outline" onClick={() => navigate('/pricing')}>
            {t('billing.upgradeCta')}
          </Button>

          {data.cancelAtPeriodEnd && data.isPaid && (
            <Button size="sm" disabled={resume.isPending} onClick={() => resume.mutate()}>
              {resume.isPending ? t('common.loading') : t('billing.resume')}
            </Button>
          )}

          {data.isPaid && !data.cancelAtPeriodEnd && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmCancel(true)}>
              {t('billing.cancel')}
            </Button>
          )}
        </div>

        {/* Cancelling is commercially significant, so it is confirmed - and the
            dialog states plainly that no data is deleted. */}
        <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('billing.cancelTitle')}</DialogTitle>
              <DialogDescription className="leading-relaxed pt-2">
                {t('billing.cancelBody')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={() => setConfirmCancel(false)}>
                {t('billing.keepPlan')}
              </Button>
              <Button
                variant="destructive"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                {cancel.isPending ? t('common.loading') : t('billing.cancelConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
