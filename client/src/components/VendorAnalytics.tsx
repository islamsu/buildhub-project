import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { FileText, CheckCircle2, Percent, Clock } from 'lucide-react';

/**
 * Self-scoped vendor analytics: quotations submitted, quotations accepted,
 * win rate, and average response time - always for the signed-in vendor
 * (trpc.analytics.myStats takes no input; there is no vendorId to pass).
 * Not reusable for viewing another vendor's stats by design.
 */
export default function VendorAnalytics() {
  const { t, lang } = useLanguage();
  const { data, isLoading, error } = trpc.analytics.myStats.useQuery();

  if (isLoading) {
    return <div className="text-sm text-muted-foreground py-4">{t('common.loading')}</div>;
  }
  if (error) {
    return <div className="text-sm text-muted-foreground py-4">{t('analytics.load_error')}</div>;
  }
  if (!data) return null;

  const winRateLabel = data.winRate != null ? `${data.winRate.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')}%` : '—';
  const responseTimeLabel = data.avgResponseTimeHours != null
    ? `${data.avgResponseTimeHours.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')} ${t('analytics.hours_unit')}`
    : '—';

  const cards = [
    { key: 'submitted', icon: FileText, label: t('analytics.submitted'), value: data.quotationsSubmitted.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US') },
    { key: 'accepted', icon: CheckCircle2, label: t('analytics.accepted'), value: data.quotationsAccepted.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US') },
    { key: 'winRate', icon: Percent, label: t('analytics.win_rate'), value: winRateLabel },
    { key: 'responseTime', icon: Clock, label: t('analytics.response_time'), value: responseTimeLabel },
  ];

  if (data.quotationsSubmitted === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground italic">{t('analytics.empty_state')}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map(card => (
        <div key={card.key} className="rounded-lg border p-3 min-w-0">
          <card.icon className="w-4 h-4 text-muted-foreground mb-1.5" />
          <p className="text-lg font-bold truncate">{card.value}</p>
          <p className="text-xs text-muted-foreground truncate">{card.label}</p>
        </div>
      ))}
    </div>
  );
}
