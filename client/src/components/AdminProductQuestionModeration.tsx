import { AdminUserLink } from '@/components/AdminEntityLink';
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
import { MessageSquareWarning, Package } from 'lucide-react';
import { CONTENT_REPORT_STATUSES, contentReportStatusLabel } from '@shared/contentModeration';
import { productQuestionLabel } from '@shared/productQuestions';

/**
 * ── THE PRODUCT Q&A MODERATION QUEUE ──────────────────────────────────────
 *
 * Public Q&A had no remedy of any kind: a question carrying abuse, a third
 * party's phone number or a competitor's contact details sat on a supplier's
 * product page and nobody could act on it. This is the queue that fixes that,
 * and it is built to the SAME shape as review moderation on purpose - a
 * moderator working both meets one decision, not two.
 *
 * TWO DECISIONS, NOT ONE, kept apart here because the server keeps them apart:
 *
 *   RESOLVING A REPORT says whether the complaint was well-founded.
 *   HIDING SAYS whether the words may stand.
 *
 * A report can be upheld and the content still stand, and content can be
 * hidden with no report at all. Wiring "upheld" to hide automatically would
 * take the moderator's judgement out of the one place it belongs.
 *
 * THE TWO HALVES ARE SEPARATE. A question and its answer are written by
 * different people: a reasonable question can get an abusive reply, and an
 * abusive question can get a patient one. Each is hidden and restored on its
 * own, so acting on one never silences the other.
 *
 * HIDING REQUIRES A REASON. The service refuses without one; the button is
 * disabled without one so the refusal is not how an administrator finds out.
 * Restoring does not, because restoring returns things to how they were.
 *
 * NOTHING HERE DELETES ANYTHING. Hiding stops public rendering and leaves the
 * row, the words and the decision fully auditable - which is the only way the
 * decision can be defended afterwards to the person whose words were removed.
 */
const PAGE_SIZE = 20;

type AnswerRevision = {
  id: number;
  answer: string;
  answeredAt: Date | string | null;
  replacedAt: Date | string;
  replacedBy: number;
  replacedByName: string | null;
};

type ReportRow = {
  id: number;
  questionId: number;
  target: string;
  reason: string;
  detail: string | null;
  status: string;
  resolutionNote: string | null;
  createdAt: Date | string;
  reporterId: number;
  reporterName: string | null;
  askerId: number;
  askerName: string | null;
  supplierId: number;
  supplierName: string | null;
  productId: number;
  productName: string | null;
  question: string;
  answer: string | null;
  questionHidden: boolean;
  answerHidden: boolean;
};

export default function AdminProductQuestionModeration() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();

  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('all');
  const [openId, setOpenId] = useState<number | null>(null);
  const [hideReason, setHideReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const list = trpc.admin.productQuestionReports.useQuery(
    { page, pageSize: PAGE_SIZE, status: status === 'all' ? undefined : status },
    { retry: false, placeholderData: previous => previous },
  );

  const refresh = () => {
    void utils.admin.productQuestionReports.invalidate();
    // The badge in the sidebar counts open reports; leaving it stale after a
    // decision is how a queue comes to be distrusted.
    void utils.admin.attention.invalidate();
  };
  const onError = (e: { message: string }) => setError(e.message);

  const moderate = trpc.admin.moderateProductQuestion.useMutation({
    onSuccess: () => { setHideReason(''); setError(''); refresh(); }, onError,
  });
  const resolve = trpc.admin.resolveProductQuestionReport.useMutation({
    onSuccess: () => { setNote(''); setError(''); refresh(); }, onError,
  });

  const rows = (list.data?.rows ?? []) as ReportRow[];
  const open = rows.find(row => row.id === openId) ?? null;
  const openOnAnswer = open?.target === 'answer';
  const openHidden = open ? (openOnAnswer ? open.answerHidden : open.questionHidden) : false;

  // WHAT WAS ACTUALLY REPORTED. A moderator shown the whole exchange with no
  // indication of which half the complaint is about has to guess.
  const revisions = trpc.admin.productAnswerRevisions.useQuery(
    { questionId: open?.questionId ?? 0 },
    { enabled: !!open && openOnAnswer, retry: false },
  );

  return (
    <Card data-testid="admin-question-moderation">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareWarning className="h-5 w-5" />
          {ar ? 'بلاغات أسئلة المنتجات' : 'Reported product questions'}
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {ar
            ? 'قبول البلاغ لا يخفي المحتوى تلقائيًا. القراران منفصلان، والسؤال والإجابة يُعالجان كلٌّ على حدة.'
            : 'Upholding a report does not hide the content. They are two separate decisions, and a question and its answer are handled independently.'}
        </p>
        <div className="mt-4 max-w-xs">
          <Select value={status} onValueChange={value => { setStatus(value); setPage(0); }}>
            <SelectTrigger aria-label={ar ? 'حالة البلاغ' : 'Report status'} data-testid="admin-question-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{ar ? 'كل البلاغات' : 'All reports'}</SelectItem>
              {CONTENT_REPORT_STATUSES.map(v => (
                <SelectItem key={v} value={v}>{contentReportStatusLabel(v, lang)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <p className="text-sm text-rose-600" data-testid="admin-question-error">{error}</p>}

        {list.isError && <LoadFailed {...loadFailedCopy(ar)} onRetry={() => void list.refetch()} />}
        {list.isLoading && (
          <p className="py-8 text-center text-sm text-muted-foreground">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
        )}

        {/* ZERO REPORTS IS GOOD NEWS, and says so - a different sentence from
            a failed query, which LoadFailed renders above. */}
        {!list.isLoading && !list.isError && rows.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground" data-testid="admin-question-empty">
            {ar ? 'لا توجد بلاغات على أسئلة المنتجات.' : 'No product questions have been reported.'}
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-start text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-2 text-start">{ar ? 'المُبلَّغ عنه' : 'Reported'}</th>
                  <th className="p-2 text-start">{ar ? 'المنتج' : 'Product'}</th>
                  <th className="p-2 text-start">{ar ? 'المورّد' : 'Supplier'}</th>
                  <th className="p-2 text-start">{ar ? 'المُبلِّغ' : 'Reported by'}</th>
                  <th className="p-2 text-start">{ar ? 'السبب' : 'Reason'}</th>
                  <th className="p-2 text-start">{ar ? 'الحالة' : 'Status'}</th>
                  <th className="p-2 text-start" />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const hidden = row.target === 'answer' ? row.answerHidden : row.questionHidden;
                  return (
                    <tr key={row.id} className="border-t" data-testid={`admin-question-report-${row.id}`}>
                      <td className="p-2">
                        <Badge variant="secondary" data-testid={`admin-question-target-${row.id}`}>
                          {productQuestionLabel('reportTarget', row.target, lang)}
                        </Badge>
                        {hidden && (
                          <Badge variant="outline" className="ms-2" data-testid={`admin-question-hidden-${row.id}`}>
                            {ar ? 'مخفي' : 'Hidden'}
                          </Badge>
                        )}
                      </td>
                      {/* THE PRODUCT ITSELF, not just its id - a moderator
                          needs to see the listing the words are sitting on. */}
                      <td className="p-2">
                        <a
                          className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-primary"
                          href={`/marketplace/products/${row.productId}`}
                          data-testid={`admin-question-product-${row.id}`}
                        >
                          <Package className="h-3.5 w-3.5" />
                          <span className="max-w-[16rem] truncate">{row.productName ?? `#${row.productId}`}</span>
                        </a>
                      </td>
                      {/* BOTH PARTIES OPEN. Judging a report means looking at
                          who wrote the words and who objected to them. */}
                      <td className="p-2"><AdminUserLink id={row.supplierId} name={row.supplierName} /></td>
                      <td className="p-2"><AdminUserLink id={row.reporterId} name={row.reporterName} /></td>
                      <td className="p-2">{productQuestionLabel('reportReason', row.reason, lang)}</td>
                      <td className="p-2">{contentReportStatusLabel(row.status, lang)}</td>
                      <td className="p-2 text-end">
                        <Button size="sm" variant="outline"
                          onClick={() => { setOpenId(openId === row.id ? null : row.id); setError(''); }}
                          data-testid={`admin-question-open-${row.id}`}>
                          {openId === row.id ? (ar ? 'إغلاق' : 'Close') : (ar ? 'فتح' : 'Open')}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
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
          testId="admin-question-pager"
        />

        {open && (
          <div className="space-y-4 rounded-xl border p-4" data-testid="admin-question-detail">
            {/* THE EXCHANGE, IN FULL, with the reported half marked. Judging a
                reply without the question it answers is guessing. */}
            <div className={`rounded-lg p-3 ${openOnAnswer ? 'bg-muted/30' : 'bg-muted/60 ring-1 ring-destructive/30'}`}>
              <p className="text-xs text-muted-foreground">
                {ar ? 'السؤال — ' : 'The question — '}
                {open.askerName ?? `#${open.askerId}`}
                {open.questionHidden && ` · ${ar ? 'مخفي' : 'hidden'}`}
              </p>
              <p className="mt-1 whitespace-pre-wrap" data-testid="admin-question-text">{open.question}</p>
            </div>

            <div className={`rounded-lg p-3 ${openOnAnswer ? 'bg-muted/60 ring-1 ring-destructive/30' : 'bg-muted/30'}`}>
              <p className="text-xs text-muted-foreground">
                {ar ? 'الإجابة — ' : 'The answer — '}
                {open.supplierName ?? `#${open.supplierId}`}
                {open.answerHidden && ` · ${ar ? 'مخفية' : 'hidden'}`}
              </p>
              <p className="mt-1 whitespace-pre-wrap" data-testid="admin-question-answer">
                {open.answer ?? (ar ? '(لم يُجب بعد)' : '(not answered yet)')}
              </p>
            </div>

            {/* WHAT THE ANSWER USED TO SAY. A supplier who answered "yes, we
                ship to Alexandria", took the order and changed it to "no" is
                exactly what this history exists to make visible. */}
            {openOnAnswer && (revisions.data?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-dashed p-3" data-testid="admin-question-revisions">
                <p className="text-xs font-medium">
                  {ar ? 'إجابات سابقة' : 'Previous answers'} ({revisions.data?.length})
                </p>
                <ul className="mt-2 space-y-2">
                  {((revisions.data ?? []) as AnswerRevision[]).map(revision => (
                    <li key={revision.id} className="text-sm">
                      <p className="whitespace-pre-wrap">{revision.answer}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {ar ? 'استُبدلت في ' : 'replaced '}
                        {new Date(revision.replacedAt).toLocaleString()}
                        {revision.replacedByName ? ` · ${revision.replacedByName}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-lg border border-dashed p-3">
              <p className="text-xs font-medium">
                {ar ? 'البلاغ' : 'The report'} — {productQuestionLabel('reportReason', open.reason, lang)}
                {' · '}
                {productQuestionLabel('reportTarget', open.target, lang)}
              </p>
              {open.detail && <p className="mt-1 whitespace-pre-wrap text-sm">{open.detail}</p>}
              {open.resolutionNote && (
                <p className="mt-2 text-xs text-muted-foreground" data-testid="admin-question-resolution-note">
                  {ar ? 'ملاحظة القرار: ' : 'Resolution note: '}{open.resolutionNote}
                </p>
              )}
            </div>

            {/* DECISION ONE: the content. */}
            <div className="space-y-2">
              <p className="text-xs font-medium">
                {ar ? 'قرار بشأن المحتوى' : 'Decision on the content'}
                {' — '}
                {productQuestionLabel('reportTarget', open.target, lang)}
              </p>
              {openHidden ? (
                <Button size="sm" variant="outline"
                  disabled={moderate.isPending}
                  onClick={() => moderate.mutate({
                    questionId: open.questionId,
                    target: open.target as 'question' | 'answer',
                    action: 'restore',
                  })}
                  data-testid="admin-question-restore">
                  {ar ? 'إظهاره مرة أخرى' : 'Restore this'}
                </Button>
              ) : (
                <>
                  <Textarea rows={2} value={hideReason} onChange={event => setHideReason(event.target.value)}
                    aria-label={ar ? 'سبب الإخفاء' : 'Reason for hiding'}
                    data-testid="admin-question-hide-reason"
                    placeholder={ar ? 'سبب الإخفاء — مطلوب' : 'Reason for hiding — required'} />
                  <Button size="sm" variant="destructive"
                    disabled={moderate.isPending || hideReason.trim().length === 0}
                    onClick={() => moderate.mutate({
                      questionId: open.questionId,
                      target: open.target as 'question' | 'answer',
                      action: 'hide',
                      reason: hideReason,
                    })}
                    data-testid="admin-question-hide">
                    {ar ? 'إخفاؤه' : 'Hide this'}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {ar
                      ? 'الإخفاء يمنع الظهور العام ولا يحذف شيئًا — يظل السجل كاملًا للمراجعة.'
                      : 'Hiding stops it rendering publicly and deletes nothing — the record stays reviewable.'}
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
                  data-testid="admin-question-note"
                  placeholder={ar ? 'ملاحظة (اختيارية)' : 'Note (optional)'} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ reportId: open.id, status: 'upheld', note: note.trim() || undefined })}
                    data-testid="admin-question-uphold">
                    {ar ? 'قبول البلاغ' : 'Uphold report'}
                  </Button>
                  <Button size="sm" variant="outline" disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ reportId: open.id, status: 'rejected', note: note.trim() || undefined })}
                    data-testid="admin-question-reject">
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
