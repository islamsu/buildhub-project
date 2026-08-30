import { useAuth } from '@/_core/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import Navbar from '@/components/Navbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLocation } from 'wouter';
import { Check, Clock, Info, Minus, Sparkles } from 'lucide-react';

/**
 * The public plan catalogue.
 *
 * Every commercial value on this page comes from `billing.plans` - prices,
 * intervals, founder pricing, trial length and grace period all originate in
 * shared/billing.ts and are never restated here. If a price needs to change it
 * changes there, and this page follows.
 *
 * HONESTY. Four of the nine entitlements the plans define are not built yet
 * (portfolio, promotional campaigns, branches, team members) and two more are
 * deferred (boosted visibility, featured placement). The server reports which
 * are live via `entitlementAvailability`, derived from the Phase 4B.1
 * enforcement ledger, and anything not live is badged "coming soon" rather
 * than advertised as included. A vendor being asked for EGP 499-999 a month is
 * entitled to know which of these actually works today.
 *
 * Self-service checkout does not exist until a payment provider is connected
 * (Phase 4B.5), so this page says so plainly instead of rendering a Subscribe
 * button that cannot do anything.
 */

/** Order the comparison rows so the entitlements that actually work come first. */
const ENTITLEMENT_ORDER = [
  'qualifiedEnquiriesPerMonth',
  'serviceCategoryLimit',
  'analyticsLevel',
  'visibilityLevel',
  'portfolioLevel',
  'promotionalCapability',
  'featuredPlacementEligible',
  'branchLimit',
  'teamMemberLimit',
] as const;

type EntitlementKey = (typeof ENTITLEMENT_ORDER)[number];

export default function Pricing() {
  const { lang, t } = useLanguage();
  const ar = lang === 'ar';
  const [, navigate] = useLocation();

  const { isAuthenticated } = useAuth();

  const { data, isLoading } = trpc.billing.plans.useQuery();
  // ONLY for signed-in visitors. `mySubscription` is a protected procedure, and
  // an UNAUTHORIZED response anywhere in the app triggers a global redirect to
  // /auth (see client/src/main.tsx) - so calling it unconditionally made this
  // public page bounce every signed-out visitor to the login screen, which is
  // precisely the audience a pricing page exists for. Checkout availability now
  // comes from the public catalogue instead.
  const { data: mine } = trpc.billing.mySubscription.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });

  const money = (amount: number) => amount.toLocaleString(ar ? 'ar-EG' : 'en-US');

  /**
   * Render one entitlement's value for one plan. Booleans become
   * included/not-included; `null` means unlimited for the numeric limits, and
   * the string levels (basic/advanced, standard/boosted/top) are shown as-is
   * from the catalogue.
   */
  const renderValue = (key: EntitlementKey, value: unknown) => {
    if (value === null) return t('ent.unlimited');
    if (value === true) return t('ent.included');
    if (value === false) return t('ent.notIncluded');
    if (typeof value === 'number') return money(value);
    return String(value);
  };

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container max-w-6xl pt-24 pb-16">
          <div className="py-24 text-center text-muted-foreground">{t('common.loading')}</div>
        </main>
      </div>
    );
  }

  const availability = data.entitlementAvailability as Record<string, boolean>;
  const anyComingSoon = ENTITLEMENT_ORDER.some(key => !availability[key]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container max-w-6xl pt-24 pb-16">
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold">{t('pricing.title')}</h1>
          <p className="text-muted-foreground mt-3 max-w-2xl mx-auto">{t('pricing.subtitle')}</p>
          <p className="text-sm text-muted-foreground mt-2">
            {t('pricing.trialNote')} · {t('pricing.gracePeriodNote')} {data.gracePeriodDays} {t('pricing.days')}.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {data.plans.map(plan => {
            const isCurrent = mine?.plan === plan.id;
            const founderMonth = plan.founder.month;
            const saving = plan.annualSavings;

            return (
              <Card
                key={plan.id}
                className={`p-6 flex flex-col ${isCurrent ? 'border-primary ring-1 ring-primary' : ''}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h2 className="text-lg font-semibold capitalize">{plan.id}</h2>
                  {isCurrent && (
                    <Badge className="bg-primary text-primary-foreground border-0 text-[10px]">
                      {t('pricing.currentPlan')}
                    </Badge>
                  )}
                </div>

                {/* Price */}
                {!plan.paid || plan.standard.month === null ? (
                  <div className="mt-2">
                    <span className="text-3xl font-bold">{t('pricing.free')}</span>
                    <p className="text-sm text-muted-foreground mt-1">{t('pricing.freeForever')}</p>
                  </div>
                ) : (
                  <div className="mt-2">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-bold">{data.currency} {money(plan.standard.month)}</span>
                      <span className="text-sm text-muted-foreground">{t('pricing.perMonth')}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t('pricing.billedMonthly')}
                      {plan.standard.year !== null && (
                        <>
                          {' · '}{data.currency} {money(plan.standard.year)} {t('pricing.perYear')}
                          {saving !== null && saving > 0 && ` (${t('pricing.saveAnnually')} ${data.currency} ${money(saving)})`}
                        </>
                      )}
                    </p>

                    {founderMonth !== null && (
                      <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3">
                        <div className="flex items-center gap-1.5 text-amber-900 text-sm font-medium">
                          <Sparkles className="w-3.5 h-3.5" />
                          {t('pricing.founderBadge')}: {data.currency} {money(founderMonth)}{t('pricing.perMonth')}
                        </div>
                        <p className="text-xs text-amber-900/80 mt-1">
                          {t('pricing.founderNote')} ({data.founderOfferMonths}).
                        </p>
                        {/* No annual founder price is an approved product, so the
                            page must not imply one exists. */}
                        <p className="text-xs text-amber-900/60 mt-1">{t('pricing.founderMonthlyOnly')}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Entitlements */}
                <div className="mt-6 flex-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
                    {t('pricing.included')}
                  </p>
                  <ul className="space-y-2.5">
                    {ENTITLEMENT_ORDER.map(key => {
                      const value = (plan.entitlements as Record<string, unknown>)[key];
                      const live = availability[key] === true;
                      const absent = value === false;
                      return (
                        <li key={key} className="flex items-start gap-2 text-sm">
                          {absent
                            ? <Minus className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground/40" />
                            : <Check className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${live ? 'text-emerald-600' : 'text-muted-foreground/40'}`} />}
                          <span className={`flex-1 ${absent ? 'text-muted-foreground/60' : ''}`}>
                            <span className="text-muted-foreground">{t(`ent.${key}`)}: </span>
                            <span className={absent ? '' : 'font-medium'}>{renderValue(key, value)}</span>
                            {!live && !absent && (
                              <Badge variant="outline" className="ms-1.5 text-[10px] align-middle">
                                <Clock className="w-2.5 h-2.5 me-0.5" />{t('pricing.comingSoon')}
                              </Badge>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* Call to action - honest about what can actually happen today. */}
                <div className="mt-6">
                  {!plan.paid ? (
                    <Button variant="outline" className="w-full" onClick={() => navigate('/auth?mode=signup')}>
                      {t('auth.continue')}
                    </Button>
                  ) : data.checkoutAvailable ? (
                    <Button className="w-full" onClick={() => navigate('/settings#settings-billing')}>
                      {t('billing.upgradeCta')}
                    </Button>
                  ) : (
                    <div className="rounded-lg border border-dashed p-3 text-center">
                      <p className="text-sm font-medium">{t('pricing.checkoutUnavailable')}</p>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        {!data.checkoutAvailable && (
          <p className="text-sm text-muted-foreground text-center mt-6 max-w-2xl mx-auto">
            {t('pricing.checkoutUnavailableNote')}
          </p>
        )}

        {anyComingSoon && (
          <div className="mt-8 flex items-start gap-2 rounded-lg border bg-muted/40 p-4 max-w-3xl mx-auto">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('pricing.comingSoonNote')}</p>
          </div>
        )}
      </main>
    </div>
  );
}
