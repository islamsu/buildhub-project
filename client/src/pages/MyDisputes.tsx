import { useState } from 'react';
import { Link } from 'wouter';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import { Pager } from '@/components/Pager';
import { Button } from '@/components/ui/button';
import { ShieldQuestion } from 'lucide-react';
import { disputeLabels, statusTone } from '@/lib/disputeCopy';

/**
 * THE DISPUTES A PERSON IS IN.
 *
 * `disputes.myDisputes` existed and NO CLIENT CALLED IT; there was no
 * `/disputes` route at all. A user could raise a dispute from a project and
 * then had nowhere to read it, answer it, or find out what became of it - and
 * the notification the respondent receives links to `/disputes/:id`, which
 * resolved to nothing.
 *
 * Both sides, in one list: disputes this person raised and disputes raised
 * about them. Splitting them into two screens would let somebody miss the one
 * naming them, which is the one they most need to answer.
 */
const PAGE_SIZE = 20;

export default function MyDisputes() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const label = disputeLabels(ar);
  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('all');
  const [page, setPage] = useState(0);

  const disputes = trpc.disputes.myDisputes.useQuery(
    { page, pageSize: PAGE_SIZE, status },
    { retry: false, placeholderData: previous => previous },
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <Card data-testid="my-disputes">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldQuestion className="h-5 w-5" />
            {ar ? 'النزاعات' : 'Disputes'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(['all', 'open', 'closed'] as const).map(value => (
              <Button
                key={value} type="button" size="sm"
                variant={status === value ? 'default' : 'outline'}
                className="h-8"
                data-testid={`my-disputes-${value}`}
                onClick={() => { setStatus(value); setPage(0); }}
              >
                {value === 'all' ? (ar ? 'الكل' : 'All')
                  : value === 'open' ? (ar ? 'قيد النظر' : 'Open')
                    : (ar ? 'منتهية' : 'Closed')}
              </Button>
            ))}
          </div>

          {disputes.isError ? (
            <LoadFailed {...loadFailedCopy(ar)} onRetry={() => void disputes.refetch()} />
          ) : (disputes.data?.rows.length ?? 0) === 0 ? (
            /*
              ZERO DISPUTES IS A GOOD ANSWER, AND SAYING SO IS THE POINT. It is
              also different under a filter - "no open disputes" is not "you have
              never raised one", and a person with a resolved dispute reading the
              second would think the record had been lost.
            */
            <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground" data-testid="my-disputes-empty">
              {disputes.isLoading ? (ar ? 'جارٍ التحميل…' : 'Loading…')
                : status === 'open' ? (ar ? 'لا توجد نزاعات قيد النظر.' : 'You have no disputes under review.')
                  : status === 'closed' ? (ar ? 'لا توجد نزاعات منتهية.' : 'You have no concluded disputes.')
                    : (ar
                      ? 'لم تفتح أي نزاع ولم يُفتح أي نزاع بشأنك. يمكنك فتح نزاع من صفحة المشروع أو طلب عرض السعر أو عرض السعر المعني.'
                      : 'You have raised no disputes and none names you. You can open one from the project, RFQ or quotation it is about.')}
            </p>
          ) : (
            <ul className="space-y-2" data-testid="my-disputes-list">
              {(disputes.data?.rows ?? []).map((row: any) => (
                <li key={row.id}>
                  <Link
                    href={`/disputes/${row.id}`}
                    data-testid={`my-dispute-${row.id}`}
                    className="block rounded-xl border p-3 transition hover:bg-muted/40"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {row.reference ?? `#${row.id}`}
                      </span>
                      <span className="font-medium">{row.title}</span>
                      <Badge variant={statusTone(row.status) as any}>{label.status(row.status)}</Badge>
                      {/*
                        WHICH SIDE YOU ARE ON, said plainly. "A dispute" with no
                        indication of whether you raised it or it names you is
                        the difference between a note and something to answer.
                      */}
                      <Badge variant="outline" data-testid={`my-dispute-side-${row.id}`}>
                        {row.yourSide === 'reporter'
                          ? (ar ? 'فتحته' : 'You raised this')
                          : (ar ? 'يسمّيك' : 'Names you')}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.subjectLabel ?? (ar ? 'الموضوع غير مسجّل' : 'subject not recorded')}
                      {' · '}{label.category(row.category)}
                      {' · '}{new Date(row.createdAt).toLocaleDateString()}
                    </p>
                    {row.resolutionType && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {ar ? 'النتيجة: ' : 'Outcome: '}{label.resolution(row.resolutionType)}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <Pager
            ar={ar} page={page} total={disputes.data?.total ?? null}
            pageCount={Math.max(1, Math.ceil((disputes.data?.total ?? 0) / PAGE_SIZE))}
            onChange={setPage} testId="my-disputes-pager"
          />
        </CardContent>
      </Card>
    </div>
  );
}
