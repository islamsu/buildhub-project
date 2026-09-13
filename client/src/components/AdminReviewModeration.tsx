import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import { Pager } from '@/components/Pager';
import { Flag, Star } from 'lucide-react';
import { REVIEW_REPORT_STATUSES, reviewLabel } from '@shared/reviews';

/**
 * ── THE REVIEW MODERATION QUEUE ───────────────────────────────────────────
 *
 * TWO DECISIONS, NOT ONE, and the screen keeps them apart because the server
 * does:
 *
 *   RESOLVING A REPORT says whether the complaint was well-founded.
 *   HIDING A REVIEW says whether the review may stand.
 *
 * A report can be upheld and the review still stand - one rude word in an
 * otherwise accurate account of the work - and a review can be hidden with no
 * report at all. Wiring "upheld" to automatically hide would take the
 * moderator's judgement out of the one place it belongs, so the two controls
 * sit side by side and each is pressed deliberately.
 *
 * HIDING REQUIRES A REASON. The service refuses without one; the button here
 * is disabled without one so the refusal is not the way an administrator finds
 * that out. Restoring does not, because restoring returns things to how they
 * were.
 *
 * The queue is ordered open-first and then oldest-first, so it is a queue
 * rather than a list, and it shows the review's own words: a moderator cannot
 * judge a report against a rating alone.
 */
const PAGE_SIZE = 20;

type ReportRow = {
  id: number;
  reviewId: number;
  reason: string;
  detail: string | null;
  status: string;
  createdAt: Date | string;
  reporterId: number;
  reporterName: string | null;
  rating: number;
  comment: string | null;
  revieweeId: number;
  revieweeName: string | null;
  reviewHidden: boolean;
};

export default function AdminReviewModeration() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();

  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('all');
  const [openId, setOpenId] = useState<number | null>(null);
  const [hideReason, setHideReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const list = trpc.admin.reviewReports.useQuery(
    { page, pageSize: PAGE_SIZE, status: status === 'all' ? undefined : status },
    { retry: false, placeholderData: previous => previous },
  );

  const refresh = () => { void utils.admin.reviewReports.invalidate(); };
  const onError = (e: { message: string }) => setError(e.message);

  const moderate = trpc.admin.moderateReview.useMutation({
    onSuccess: () => { setHideReason(''); setError(''); refresh(); }, onError,
  });
  const resolve = trpc.admin.resolveReviewReport.useMutation({
    onSuccess: () => { setNote(''); setError(''); refresh(); }, onError,
  });

  const rows = (list.data?.rows ?? []) as ReportRow[];
  const open = rows.find(row => row.id === openId) ?? null;

  return (
    <Card data-testid="admin-review-moderation">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Flag className="h-5 w-5" />
          {ar ? 'بلاغات التقييمات' : 'Reported reviews'}
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {ar
            ? 'قبول البلاغ لا يخفي التقييم تلقائيًا. القراران منفصلان.'
            : 'Upholding a report does not hide the review. They are two separate decisions.'}
        </p>
        <div className="mt-4 max-w-xs">
          <Select value={status} onValueChange={value => { setStatus(value); setPage(0); }}>
            <SelectTrigger aria-label={ar ? 'حالة البلاغ' : 'Report status'}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{ar ? 'كل البلاغات' : 'All reports'}</SelectItem>
              {REVIEW_REPORT_STATUSES.map(v => (
                <SelectItem key={v} value={v}>{reviewLabel('reportStatus', v, lang)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <p className="text-sm text-rose-600" data-testid="admin-review-error">{error}</p>}

        {list.isError && <LoadFailed {...loadFailedCopy(ar)} onRetry={() => void list.refetch()} />}
        {list.isLoading && (
          <p className="py-8 text-center text-sm text-muted-foreground">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
        )}

        {/* ZERO REPORTS IS GOOD NEWS, and says so - it is not the same
            sentence as a failed query, which LoadFailed renders above. */}
        {!list.isLoading && !list.isError && rows.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground" data-testid="admin-review-empty">
            {ar ? 'لا توجد بلاغات على التقييمات.' : 'No reviews have been reported.'}
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-start text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-2 text-start">{ar ? 'التقييم' : 'Review'}</th>
                  <th className="p-2 text-start">{ar ? 'عن' : 'About'}</th>
                  <th className="p-2 text-start">{ar ? 'المُبلِّغ' : 'Reported by'}</th>
                  <th className="p-2 text-start">{ar ? 'السبب' : 'Reason'}</th>
                  <th className="p-2 text-start">{ar ? 'الحالة' : 'Status'}</th>
                  <th className="p-2 text-start" />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-t" data-testid={`admin-review-report-${row.id}`}>
                    <td className="p-2">
                      <span className="inline-flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        {row.rating}
                      </span>
                      {row.reviewHidden && (
                        <Badge variant="outline" className="ms-2" data-testid={`admin-review-hidden-${row.id}`}>
                          {ar ? 'مخفي' : 'Hidden'}
                        </Badge>
                      )}
                    </td>
                    <td className="p-2">{row.revieweeName ?? `#${row.revieweeId}`}</td>
                    <td className="p-2">{row.reporterName ?? `#${row.reporterId}`}</td>
                    <td className="p-2">{reviewLabel('reportReason', row.reason, lang)}</td>
                    <td className="p-2">{reviewLabel('reportStatus', row.status, lang)}</td>
                    <td className="p-2 text-end">
                      <Button size="sm" variant="outline"
                        onClick={() => { setOpenId(openId === row.id ? null : row.id); setError(''); }}
                        data-testid={`admin-review-open-${row.id}`}>
                        {openId === row.id ? (ar ? 'إغلاق' : 'Close') : (ar ? 'فتح' : 'Open')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pager
          ar={ar}
          page={list.data?.page ?? 0}
          pageCount={Math.max(1, Math.ceil((list.data?.total ?? 0) / (list.data?.pageSize ?? PAGE_SIZE)))}
          total={list.data?.total ?? null}
          onChange={setPage}
          testId="admin-review-pager"
        />

        {open && (
          <div className="space-y-4 rounded-xl border p-4" data-testid="admin-review-detail">
            {/* THE WORDS THEMSELVES. A moderator judging a report against a
                star rating alone is guessing. */}
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                {ar ? `تقييم ${open.rating}/5 عن ` : `A ${open.rating}/5 review of `}
                {open.revieweeName ?? `#${open.revieweeId}`}
              </p>
              <p className="mt-1 whitespace-pre-wrap" data-testid="admin-review-comment">
                {open.comment ?? (ar ? '(بدون نص)' : '(no written comment)')}
              </p>
            </div>

            <div className="rounded-lg border border-dashed p-3">
              <p className="text-xs font-medium">
                {ar ? 'البلاغ' : 'The report'} — {reviewLabel('reportReason', open.reason, lang)}
              </p>
              {open.detail && <p className="mt-1 whitespace-pre-wrap text-sm">{open.detail}</p>}
            </div>

            {/* DECISION ONE: the review. */}
            <div className="space-y-2">
              <p className="text-xs font-medium">{ar ? 'قرار بشأن التقييم' : 'Decision on the review'}</p>
              {open.reviewHidden ? (
                <Button size="sm" variant="outline"
                  disabled={moderate.isPending}
                  onClick={() => moderate.mutate({ reviewId: open.reviewId, action: 'restore' })}
                  data-testid="admin-review-restore">
                  {ar ? 'إظهار التقييم مرة أخرى' : 'Restore this review'}
                </Button>
              ) : (
                <>
                  <Textarea rows={2} value={hideReason} onChange={event => setHideReason(event.target.value)}
                    aria-label={ar ? 'سبب الإخفاء' : 'Reason for hiding'}
                    placeholder={ar ? 'سبب الإخفاء — مطلوب' : 'Reason for hiding — required'} />
                  <Button size="sm" variant="destructive"
                    disabled={moderate.isPending || hideReason.trim().length === 0}
                    onClick={() => moderate.mutate({ reviewId: open.reviewId, action: 'hide', reason: hideReason })}
                    data-testid="admin-review-hide">
                    {ar ? 'إخفاء التقييم' : 'Hide this review'}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {ar
                      ? 'الإخفاء يزيل التقييم من الصفحة ومن المتوسط معًا.'
                      : 'Hiding removes the review from the page and from the average together.'}
                  </p>
                </>
              )}
            </div>

            {/* DECISION TWO: the report. */}
            {open.status === 'open' && (
              <div className="space-y-2">
                <p className="text-xs font-medium">{ar ? 'قرار بشأن البلاغ' : 'Decision on the report'}</p>
                <Textarea rows={2} value={note} onChange={event => setNote(event.target.value)}
                  aria-label={ar ? 'ملاحظة' : 'Note'}
                  placeholder={ar ? 'ملاحظة (اختيارية)' : 'Note (optional)'} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ reportId: open.id, status: 'upheld', note: note.trim() || undefined })}
                    data-testid="admin-review-uphold">
                    {ar ? 'قبول البلاغ' : 'Uphold report'}
                  </Button>
                  <Button size="sm" variant="outline" disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ reportId: open.id, status: 'rejected', note: note.trim() || undefined })}
                    data-testid="admin-review-reject">
                    {ar ? 'رفض البلاغ' : 'Reject report'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
