/**
 * ── CHANGING A PROJECT'S WORK LOCATION, AFTER IT EXISTS ─────────────────
 *
 * The rendered face of `projects.changeMarket`, which is a dedicated mutation
 * rather than a field on `projects.update` for the reason the server states: a
 * project's market decides the jurisdiction, sourcing currency and compliance
 * basis of everything raised against it, so it must not move as a side effect
 * of editing a title.
 *
 * The control carries that weight in three ways. It asks for a reason, because
 * a jurisdiction change with no stated reason is not auditable. It states the
 * currency consequence before the submit, not after. And it surfaces the
 * server's refusal verbatim: the server knows whether a quotation exists or a
 * request is open to suppliers, and those messages name the obstacle and the
 * way forward rather than saying the change failed.
 *
 * Hidden while one market is enabled, for the same reason as the create field:
 * the only reachable target would be the project's current market, which the
 * server refuses as `same_market`. A control whose every use is refused is not
 * a control.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { enabledMarkets, marketName, currencyForMarket } from '@shared/markets';

export function ChangeWorkLocation({
  projectId, currentMarketCode, onChanged,
}: {
  projectId: number;
  currentMarketCode: string | null | undefined;
  onChanged: () => void;
}) {
  const { t, lang } = useLanguage();
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const change = trpc.projects.changeMarket.useMutation({
    onSuccess: result => {
      toast.success(`${marketName(result.marketCode, lang === 'ar' ? 'ar' : 'en')} · ${result.currency}`);
      setTarget(''); setReason('');
      onChanged();
    },
    // VERBATIM. The server's message names the actual obstacle - an accepted
    // quotation, an open request - and replacing it with a generic failure
    // would leave the customer with a project in the wrong country and no idea
    // what to do next.
    onError: (error: { message: string }) => toast.error(error.message),
  });

  const markets = enabledMarkets().filter(market => market.code !== currentMarketCode);
  if (markets.length === 0) return null;

  const targetCurrency = currencyForMarket(target);

  return (
    <div className="space-y-3" data-testid="change-work-location">
      <Label htmlFor="change-market">{t('market.changeLocation')}</Label>
      <Select value={target} onValueChange={setTarget}>
        <SelectTrigger id="change-market" data-testid="change-market-select">
          <SelectValue placeholder={t('market.workLocation.placeholder')} />
        </SelectTrigger>
        <SelectContent>
          {markets.map(market => (
            <SelectItem key={market.code} value={market.code}>
              {marketName(market.code, lang === 'ar' ? 'ar' : 'en')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {targetCurrency && (
        <p className="text-sm text-muted-foreground" data-testid="change-market-currency">
          {t('market.workLocation.currency').replace('{currency}', targetCurrency)}
        </p>
      )}
      <Input
        data-testid="change-market-reason"
        placeholder={t('market.changeLocation.reason')}
        value={reason}
        onChange={event => setReason(event.target.value)}
      />
      <Button
        type="button"
        data-testid="change-market-submit"
        // A reason is REQUIRED by the server, so the button states that rather
        // than letting the request go and reporting a validation error.
        disabled={change.isPending || !target || reason.trim().length < 3}
        onClick={() => change.mutate({ id: projectId, marketCode: target, reason: reason.trim() })}
      >
        {change.isPending ? t('common.loading') : t('market.changeLocation.submit')}
      </Button>
    </div>
  );
}
