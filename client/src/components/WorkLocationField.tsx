/**
 * ── WHERE IS THE WORK REQUIRED? ─────────────────────────────────────────
 *
 * The user-facing face of the project/RFQ market. Owner directive Phase 3.
 *
 * The copy deliberately says "work location" and never "commercial market" or
 * "market code": the customer is answering a question about their building
 * site, not configuring a platform concept. The currency consequence is stated
 * plainly underneath, because that is the part that affects them - every
 * quotation they receive will be in it.
 *
 * ── WHY IT RENDERS NOTHING WHILE ONE MARKET IS ENABLED ──────────────────
 *
 * With a single enabled market a selector is one option: a dead choice that
 * adds a step and decides nothing. The owner's instruction is to preserve
 * low-friction compatibility while Egypt is alone WITHOUT reintroducing Egypt
 * as hidden permanent authority - and those two halves live in different
 * places. Here, the field stays out of the way. On the server,
 * `resolveImplicitMarket()` resolves the single market and REFUSES the moment
 * a second one is enabled, so the quiet path cannot outlive the condition that
 * justifies it. The field appears the day there is something to choose.
 *
 * ── CROSS-BORDER IS CONFIRMED, NOT WARNED ───────────────────────────────
 *
 * A requester whose account country differs from the work location is doing
 * something legitimate: an Egyptian developer building in Oman is a customer,
 * not an anomaly. So the confirmation states the three facts and offers two
 * ways forward. It carries no warning icon, no amber, no "are you sure" - the
 * tone is a receipt, not a challenge.
 */

import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { enabledMarkets, marketName, currencyForMarket } from '@shared/markets';

export type WorkLocationValue = string | undefined;

/** True when there is a genuine choice to present. */
export function workLocationIsSelectable(): boolean {
  return enabledMarkets().length > 1;
}

export function WorkLocationField({
  value, onChange, accountCountryCode,
}: {
  value: WorkLocationValue;
  onChange: (marketCode: string) => void;
  /**
   * The requester's own country, used ONLY to decide whether to show the
   * cross-border confirmation. It never becomes the work location: that is the
   * substitution the whole market architecture exists to prevent, and it is
   * why this is a separate prop rather than a default for `value`.
   */
  accountCountryCode?: string | null;
}) {
  const { t, lang } = useLanguage();
  const [confirmed, setConfirmed] = useState(false);
  const markets = enabledMarkets();

  // See the header: nothing to choose, so nothing to ask.
  if (markets.length <= 1) return null;

  const currency = currencyForMarket(value);
  const crossBorder = Boolean(
    value && accountCountryCode && accountCountryCode !== value,
  );

  return (
    <div className="space-y-2" data-testid="work-location-field">
      <Label htmlFor="work-location">{t('market.workLocation.label')}</Label>
      <Select
        value={value ?? ''}
        onValueChange={next => { setConfirmed(false); onChange(next); }}
      >
        <SelectTrigger id="work-location" data-testid="work-location-select">
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

      {/* THE CURRENCY CONSEQUENCE, stated as soon as a location is chosen.
          It is the part of this decision the customer actually feels. */}
      {currency && (
        <p className="text-sm text-muted-foreground" data-testid="work-location-currency">
          {t('market.workLocation.currency').replace('{currency}', currency)}
        </p>
      )}

      {crossBorder && !confirmed && (
        /* NEUTRAL BY CONSTRUCTION: default border, muted surface, no warning
           colour and no alert role. This is a confirmation of an ordinary
           choice, and styling it as a problem would tell the customer their
           legitimate project looks suspicious. */
        <div
          className="rounded-lg border bg-muted/40 p-3 space-y-2"
          data-testid="cross-border-confirm"
        >
          <p className="text-sm font-medium">{t('market.crossBorder.title')}</p>
          <p className="text-sm text-muted-foreground">
            {t('market.crossBorder.body')
              .replace('{work}', marketName(value, lang === 'ar' ? 'ar' : 'en') ?? '')
              .replace('{currency}', currency ?? '')
              .replace('{account}', marketName(accountCountryCode, lang === 'ar' ? 'ar' : 'en') ?? accountCountryCode ?? '')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button" size="sm" onClick={() => setConfirmed(true)}
              data-testid="cross-border-continue"
            >
              {t('market.crossBorder.continue')}
            </Button>
            <Button
              type="button" size="sm" variant="outline"
              onClick={() => { setConfirmed(false); onChange(''); }}
              data-testid="cross-border-change"
            >
              {t('market.crossBorder.change')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
