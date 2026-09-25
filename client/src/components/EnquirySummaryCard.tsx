import { Link } from 'wouter';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import { Inbox } from 'lucide-react';

/**
 * ── THE WORKSPACE SUMMARY, NOT A THIRD COPY OF THE INBOX ─────────────────
 *
 * The provider workspace rendered the FULL qualified-enquiry inbox inside
 * itself - allowance meter, row list, open action and all - while
 * `/enquiries` rendered the same thing again. CLAUDE.md §33 is explicit:
 * a dashboard summarizes the role's real work and full management belongs on
 * a dedicated page. Three renderings of one list is the same defect §71 is
 * about, one surface further out.
 *
 * So this is a summary: the counts, the allowance, and the way through. The
 * numbers come from the SAME `rfq.queue` summary the destination uses, over
 * the whole queue rather than a page, so this card and the page it links to
 * cannot disagree.
 *
 * AN OUTAGE IS NOT A QUIET MARKETPLACE (§10, §64). A failed read renders as
 * a failed read with a retry, never as four zeroes - "0 opportunities" is a
 * commercial claim, and it must be one the product actually measured.
 */
export default function EnquirySummaryCard() {
  const { lang, t } = useLanguage();
  const ar = lang === 'ar';

  // pageSize 1: this card wants the summary and the usage, not the rows. The
  // server computes the counts over the whole queue either way.
  const queue = trpc.rfq.queue.useQuery({ scope: 'all', pageSize: 1 }, { retry: false });
  const summary = queue.data?.summary;
  const usage = queue.data?.usage;

  const tiles = summary ? [
    {
      key: 'opportunities',
      label: ar ? 'فرص متاحة' : 'Opportunities',
      value: (summary.available ?? 0) + (summary.invited ?? 0),
      href: '/enquiries',
    },
    {
      key: 'opened',
      label: ar ? 'بانتظار عرضك' : 'Awaiting your quote',
      value: summary.opened ?? 0,
      href: '/enquiries',
    },
    { key: 'quoted', label: ar ? 'عروض قائمة' : 'Quoted', value: summary.quoted ?? 0, href: '/enquiries' },
    { key: 'won', label: ar ? 'فزت بها' : 'Won', value: summary.won ?? 0, href: '/enquiries' },
  ] : [];

  return (
    <Card data-testid="enquiry-summary-card">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Inbox className="h-4 w-4" />
          {t('enquiries.title')}
        </CardTitle>
        <Button asChild variant="outline" size="sm" data-testid="enquiry-summary-viewall">
          <Link href="/enquiries">{ar ? 'عرض الكل' : 'View all'}</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {queue.isError ? (
          <LoadFailed {...loadFailedCopy(ar)} onRetry={() => void queue.refetch()} />
        ) : queue.isLoading ? (
          <p className="py-4 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {tiles.map(tile => (
                <Link
                  key={tile.key}
                  href={tile.href}
                  className="rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-accent/40"
                  data-testid={`enquiry-summary-${tile.key}`}
                >
                  <p className="text-2xl font-semibold tabular-nums">{tile.value}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{tile.label}</p>
                </Link>
              ))}
            </div>
            {usage && (
              <p className="mt-3 text-xs text-muted-foreground" data-testid="enquiry-summary-allowance">
                {usage.allowance === null
                  ? `${t('enquiries.thisMonth')}: ${usage.used} · ${t('enquiries.unlimited')}`
                  : `${t('enquiries.thisMonth')}: ${usage.used} / ${usage.allowance} · ${t('enquiries.remaining')}: ${usage.remaining}`}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
