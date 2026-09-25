import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import {
  ENQUIRY_LEAD_STATES, ENQUIRY_OPPORTUNITY_STATES,
  enquiryStateLabel, enquiryStateTone,
  type EnquiryResponseState, type EnquiryScope,
} from '@shared/enquiryStates';
import { formatMoney } from '@shared/money';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import { rfqCategoryLabel } from '@shared/rfqCategories';
import { Calendar, Coins, FileText, Inbox, Lock, MapPin, Paperclip, Target } from 'lucide-react';

/**
 * ── THE PROVIDER'S ENQUIRY QUEUE, IN TWO HALVES OF ONE SYSTEM ─────────────
 *
 * WHAT THIS REPLACED, TWICE OVER.
 *
 * First: a card titled "Qualified enquiries", subtitled "The requests you
 * have opened", rendering a list of requests the provider COULD open -
 * silently truncated at 50, with no total, no filter, no search and no page.
 * The request a provider had actually PAID for vanished from it the moment
 * the customer closed the RFQ, while the credit stayed spent.
 *
 * Then, for a while, TWO CARDS OVER THE SAME ROWS. `/enquiries` rendered the
 * eligible list above this queue, and a screenshot of a real provider's
 * screen showed the same six requests rendered twice, one above the other,
 * with two different sets of words for the same state. Two lists of one
 * thing is not two features; it is one feature the reader has to reconcile,
 * and §71 says consolidate rather than accumulate variants.
 *
 * SO THERE IS ONE COMPONENT AND ONE QUERY, rendered twice with a `scope`:
 *
 *   OPPORTUNITIES  what can still be TAKEN - an open request matching a
 *                  declared category, or an invitation not yet opened.
 *                  Opening one is what spends a credit, so the allowance
 *                  meter and the open action live here and only here.
 *   LEADS          what HAS been taken, and how it ended. The record, which
 *                  outlives the request: a lead stays here after the
 *                  customer closes the file, because the credit stayed spent.
 *
 * THE TWO CANNOT OVERLAP. The split is `ENQUIRY_OPPORTUNITY_STATES` /
 * `ENQUIRY_LEAD_STATES` in shared/, applied BY THE SERVER to the one queue -
 * not two client-side filters over two queries, which is how the duplicate
 * arose the first time. A request is in exactly one of them, and
 * `enquiryStates.test.ts` fails if a new state is ever added to neither.
 *
 * EVERY FILTER IS APPLIED BY THE SERVER, over the whole scope. Filtering one
 * page in the browser answers "nothing matches" when the match is on page
 * three, with exactly the confidence it answers correctly - which is the
 * defect `server/adminList.ts` exists to end.
 */

const stateLabel = (state: string, ar: boolean) => enquiryStateLabel(state, ar ? 'ar' : 'en');

function rfqStatusLabel(status: string, ar: boolean): string {
  switch (status) {
    case 'open': return ar ? 'مفتوح' : 'Open';
    case 'closed': return ar ? 'مغلق' : 'Closed';
    case 'awarded': return ar ? 'تمت الترسية' : 'Awarded';
    default: return status;
  }
}

/** What each half is called and what it is for, in both languages. */
function scopeCopy(scope: EnquiryScope, ar: boolean) {
  if (scope === 'opportunities') {
    return {
      title: ar ? 'مركز الفرص' : 'Opportunity Centre',
      blurb: ar
        ? 'طلبات ما زال بإمكانك أخذها — مطابقة لفئاتك أو بدعوة مباشرة. فتح الطلب هو ما يستهلك من رصيدك.'
        : 'Requests you can still take — matched to your categories, or invited directly. Opening one is what uses your allowance.',
      empty: ar
        ? 'لا توجد فرص مفتوحة الآن. أعلن فئات خدمتك لتصلك الطلبات المطابقة.'
        : 'No open opportunities right now. Declare your service categories to receive matching requests.',
      icon: Target,
    };
  }
  return {
    title: ar ? 'طلباتي' : 'My Leads',
    blurb: ar
      ? 'كل طلب أخذته — وما قدّمت فيه عرضاً ونتيجته. يبقى هنا حتى بعد إغلاق العميل للطلب.'
      : 'Every request you have taken, what you quoted and how it ended. A lead stays here after the customer closes the request.',
    empty: ar
      ? 'لم تأخذ أي طلب بعد. افتح فرصة من مركز الفرص أعلاه ليظهر هنا.'
      : 'You have not taken a request yet. Open one from the Opportunity Centre above and it appears here.',
    icon: Inbox,
  };
}

export default function EnquiryQueue({
  scope = 'leads',
  highlightRfqId,
}: { scope?: EnquiryScope; highlightRfqId?: number } = {}) {
  const { lang, t } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();
  const opportunities = scope === 'opportunities';
  const copy = scopeCopy(scope, ar);
  const ScopeIcon = copy.icon;

  /** The chips this half offers. Never the whole vocabulary: filtering My
   *  Leads by "Available" would always return nothing, and a control that
   *  cannot succeed is a dead control (§13). */
  const states: readonly EnquiryResponseState[] = opportunities
    ? ENQUIRY_OPPORTUNITY_STATES
    : ENQUIRY_LEAD_STATES;

  const [page, setPage] = useState(0);
  /**
   * A DEEP LINK PRESELECTS THE SEARCH, rather than hoping the row is on page 1.
   *
   * `?rfq=` is where a notification lands. The old screen scrolled to the row
   * if it happened to be in the 50 it had loaded, and did nothing at all if it
   * was not - a silent failure on the one journey the parameter exists for.
   * Searching for the reference finds it wherever it is.
   */
  const [search, setSearch] = useState(highlightRfqId ? `#${highlightRfqId}` : '');
  const [debounced, setDebounced] = useState(search);
  const [responseState, setResponseState] = useState<EnquiryResponseState | ''>('');
  const [rfqStatus, setRfqStatus] = useState('');
  const [source, setSource] = useState('');
  const [category, setCategory] = useState('');

  // The RFQ the server returned when the credit was spent. Held here rather
  // than refetched: rfq.get is requester-scoped, so a provider cannot read the
  // detail through it, and this response IS the provider's authorized copy.
  const [detail, setDetail] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => { setDebounced(search.trim()); setPage(0); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const queue = trpc.rfq.queue.useQuery({
    page,
    scope,
    responseState: responseState || undefined,
    rfqStatus: (rfqStatus || undefined) as any,
    source: (source || undefined) as any,
    category: category || undefined,
    search: debounced || undefined,
  }, { retry: false });

  const open = trpc.rfq.openEnquiry.useMutation({
    onSuccess: result => {
      toast.success(t(result.alreadyConsumed ? 'enquiries.reopenedToast' : 'enquiries.openedToast'));
      setDetail(result.rfq as Record<string, any>);
      // BOTH HALVES MOVE. Opening a request takes it OUT of this list and puts
      // it into My Leads, so invalidating only the list in front of the
      // provider would leave the other one asserting the old state.
      utils.rfq.queue.invalidate();
      utils.rfq.eligible.invalidate();
      utils.billing.myEnquiryUsage.invalidate();
    },
    // The server owns the refusal reason - limit reached, not eligible, or not
    // found. We show its message rather than guessing one client-side.
    onError: error => toast.error(error.message),
  });

  // Bring the row the provider came for into view once the list has loaded.
  const highlightRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (highlightRfqId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightRfqId, queue.isLoading]);

  const rows = queue.data?.rows ?? [];
  const total = queue.data?.total ?? 0;
  const pageSize = queue.data?.pageSize ?? 20;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const summary = queue.data?.summary;
  const usage = queue.data?.usage;
  const filtering = Boolean(debounced || responseState || rfqStatus || source || category);
  const when = (value: string | Date | null) =>
    value ? new Date(value).toLocaleDateString(ar ? 'ar-EG' : 'en-US') : '—';

  const allowance = usage?.allowance ?? null;
  const unlimited = allowance === null;
  const pct = useMemo(() => (
    !usage || allowance === null || allowance === 0 ? 0 : Math.min(100, (usage.used / allowance) * 100)
  ), [usage, allowance]);

  return (
    <Card data-testid={`enquiry-queue-${scope}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ScopeIcon className="h-4 w-4" />
          {copy.title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{copy.blurb}</p>
        {/* THE COUNTS ARE TAKEN OVER THE WHOLE QUEUE, by the same query that
            builds it - so a tile and the list it filters to cannot disagree. */}
        {summary && (
          <div className="flex flex-wrap gap-2 pt-2" data-testid="enquiry-queue-summary">
            {states.map(state => (
              <button
                key={state}
                type="button"
                onClick={() => { setResponseState(responseState === state ? '' : state); setPage(0); }}
                className={`rounded-md border px-2.5 py-1 text-xs ${responseState === state ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
                data-testid={`enquiry-queue-tile-${state}`}
              >
                {stateLabel(state, ar)} · {summary[state] ?? 0}
              </button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {/* THE ALLOWANCE, IN THE ONLY PLACE IT CAN BE SPENT. It used to sit
            above a list that mixed requests a credit had already been spent
            on with requests it had not, so the meter appeared to be counting
            the wrong things. */}
        {opportunities && usage && (
          <div className="rounded-lg border p-3 mb-4" data-testid="enquiry-allowance">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Coins className="h-3.5 w-3.5" />{t('enquiries.thisMonth')}
              </span>
              <span className="font-semibold">
                {unlimited ? `${usage.used} · ${t('enquiries.unlimited')}` : `${usage.used} / ${allowance}`}
              </span>
            </div>
            {!unlimited && <Progress value={pct} className="h-1.5 mt-2" />}
            <p className="text-xs text-muted-foreground mt-2">
              {unlimited
                ? t('enquiries.unlimitedNote')
                : usage.limitReached
                  ? `${t('enquiries.limitReachedNote')} ${t('enquiries.resetsOn')} ${new Date(usage.resetsAt).toLocaleDateString(ar ? 'ar-EG' : 'en-US')}`
                  : `${t('enquiries.remaining')}: ${usage.remaining} · ${t('enquiries.resetsOn')} ${new Date(usage.resetsAt).toLocaleDateString(ar ? 'ar-EG' : 'en-US')}`}
            </p>
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={ar ? 'ابحث بالعنوان أو الرقم المرجعي…' : 'Search by title or reference…'}
            className="h-9 max-w-xs"
            data-testid="enquiry-queue-search"
          />
          {/* Offered only where it can change the answer: an opportunity is an
              open request by definition, so a status filter over it would have
              one working value and two dead ones. */}
          {!opportunities && (
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={rfqStatus}
              onChange={event => { setRfqStatus(event.target.value); setPage(0); }}
              data-testid="enquiry-queue-status-filter"
            >
              <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
              {['open', 'closed', 'awarded'].map(status => (
                <option key={status} value={status}>{rfqStatusLabel(status, ar)}</option>
              ))}
            </select>
          )}
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={source}
            onChange={event => { setSource(event.target.value); setPage(0); }}
            data-testid="enquiry-queue-source-filter"
          >
            <option value="">{ar ? 'كل المصادر' : 'All sources'}</option>
            <option value="invitation">{ar ? 'بدعوة' : 'By invitation'}</option>
            <option value="category">{ar ? 'مطابقة الفئة' : 'Category match'}</option>
          </select>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={category}
            onChange={event => { setCategory(event.target.value); setPage(0); }}
            data-testid="enquiry-queue-category-filter"
          >
            <option value="">{ar ? 'كل الفئات' : 'All categories'}</option>
            {(queue.data?.categories ?? []).map(value => (
              <option key={value} value={value}>{rfqCategoryLabel(value, lang)}</option>
            ))}
          </select>
          {/* The REAL total, which is the number that tells a provider whether
              their filter found everything. */}
          <span className="text-xs text-muted-foreground" data-testid="enquiry-queue-total">
            {ar ? `${total} طلب` : `${total} request${total === 1 ? '' : 's'}`}
          </span>
        </div>

        {queue.isError ? (
          <LoadFailed {...loadFailedCopy(ar)} onRetry={() => void queue.refetch()} />
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground" data-testid="enquiry-queue-empty">
            {queue.isLoading
              ? (ar ? 'جارٍ التحميل…' : 'Loading…')
              : filtering
                /* "Nothing matches your filter" and "nothing has reached you"
                   are different facts, and a provider who cannot tell them
                   apart reads a narrow filter as a quiet marketplace. */
                ? (ar ? 'لا يوجد طلب يطابق هذه التصفية.' : 'No request matches this filter.')
                : copy.empty}
          </p>
        ) : (
          <div className="space-y-2" data-testid="enquiry-queue-rows">
            {rows.map(row => (
              <div
                key={row.rfqId}
                ref={row.rfqId === highlightRfqId ? highlightRef : undefined}
                className={`rounded-lg border p-3 ${row.rfqId === highlightRfqId ? 'border-primary ring-2 ring-primary/20' : ''}`}
                data-testid={`enquiry-queue-row-${row.rfqId}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/rfq/${row.rfqId}`} className="font-medium hover:underline">
                      {row.title}
                    </Link>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">#{row.rfqId}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* EMPHASIS, NEVER COLOUR ALONE (§56). Every state
                        carries its own word; the tone only decides which one
                        a supplier's eye lands on first when scanning a
                        pipeline, and that is Won. */}
                    <Badge
                      variant={enquiryStateTone(row.responseState) === 'positive' ? 'default' : 'outline'}
                      className={enquiryStateTone(row.responseState) === 'muted' ? 'text-muted-foreground' : undefined}
                      data-testid={`enquiry-queue-state-${row.rfqId}`}
                    >
                      {stateLabel(row.responseState, ar)}
                    </Badge>
                    {!opportunities && (
                      <Badge variant={row.rfqStatus === 'open' ? 'secondary' : 'outline'}>
                        {rfqStatusLabel(row.rfqStatus, ar)}
                      </Badge>
                    )}
                    {row.source === 'invitation' && (
                      <Badge variant="secondary" data-testid={`enquiry-queue-invited-${row.rfqId}`}>
                        {ar ? 'بدعوة' : 'Invited'}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {row.category && <span>{rfqCategoryLabel(row.category, lang)}</span>}
                  {/* THE BUDGET IN ITS OWN CURRENCY. This read `EGP {budget}`
                      off a translation key, which would have put an Egyptian
                      label on a Saudi request - a wrong number in front of
                      somebody deciding what to bid (CLAUDE.md §87). */}
                  {formatMoney(row.budget, row.currency, lang) && (
                    <span data-testid={`enquiry-queue-budget-${row.rfqId}`}>
                      {formatMoney(row.budget, row.currency, lang)}
                    </span>
                  )}
                  {row.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{row.location}</span>}
                  <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{when(row.createdAt)}</span>
                  {/* THE RECEIPT. This is the fact the old screen destroyed: a
                      lead the provider paid for, still here after the customer
                      closed the request. */}
                  {row.openedAt && (
                    <span data-testid={`enquiry-queue-opened-${row.rfqId}`}>
                      {ar ? `فُتح في ${when(row.openedAt)}` : `Opened ${when(row.openedAt)}`}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {opportunities ? (
                    <>
                      <Button
                        size="sm"
                        className="gap-1.5"
                        // Only a genuinely-blocking state disables the control:
                        // an invitation is exempt from the allowance, so the
                        // limit must not lock the provider out of a request the
                        // customer named them for.
                        disabled={open.isPending || (usage?.limitReached === true && !row.free)}
                        onClick={() => open.mutate({ rfqId: row.rfqId })}
                        data-testid={`enquiry-queue-open-${row.rfqId}`}
                      >
                        {usage?.limitReached && !row.free
                          ? <><Lock className="h-3.5 w-3.5" />{t('enquiries.limitReached')}</>
                          : t('enquiries.viewDetails')}
                      </Button>
                      {/* SAY WHAT IT COSTS BEFORE IT IS SPENT, not after. */}
                      <span className="self-center text-xs text-muted-foreground" data-testid={`enquiry-queue-cost-${row.rfqId}`}>
                        {row.free
                          ? (ar ? 'بدعوة — لا يُخصم من رصيدك' : 'Invited — free, no allowance used')
                          : (ar ? 'يُخصم طلب واحد من رصيدك' : 'Uses one of your enquiries')}
                      </span>
                    </>
                  ) : (
                    <>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/rfq/${row.rfqId}`}>{ar ? 'عرض الطلب' : 'View request'}</Link>
                      </Button>
                      {/* Offered ONLY while the request can still be answered. A
                          button onto the respond page for a closed request is the
                          dead control ELIG removed from the page it points at. */}
                      {row.rfqStatus === 'open' && row.responseState !== 'declined' && (
                        <Button asChild size="sm" data-testid={`enquiry-queue-respond-${row.rfqId}`}>
                          <Link href={`/rfq/${row.rfqId}/respond`}>
                            {row.responseState === 'quoted'
                              ? (ar ? 'مراجعة عرضك' : 'Review your quote')
                              : (ar ? 'الرد على الطلب' : 'Respond')}
                          </Link>
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {total > pageSize && (
          <div className="mt-3 flex items-center justify-between gap-2" data-testid="enquiry-queue-pager">
            <Button
              variant="outline" size="sm" disabled={page === 0}
              onClick={() => setPage(current => Math.max(0, current - 1))}
              data-testid="enquiry-queue-prev"
            >{ar ? 'السابق' : 'Previous'}</Button>
            <span className="text-xs text-muted-foreground" data-testid="enquiry-queue-page-label">
              {ar ? `صفحة ${page + 1} من ${pages}` : `Page ${page + 1} of ${pages}`}
            </span>
            <Button
              variant="outline" size="sm" disabled={page + 1 >= pages}
              onClick={() => setPage(current => current + 1)}
              data-testid="enquiry-queue-next"
            >{ar ? 'التالي' : 'Next'}</Button>
          </div>
        )}
      </CardContent>

      {/* THE DETAIL THE CREDIT BOUGHT. "View details" used to end in a TOAST:
          the provider spent a credit, the server returned the full RFQ in the
          same response, and the client threw it away. */}
      <Dialog open={detail !== null} onOpenChange={openState => !openState && setDetail(null)}>
        <DialogContent className="max-w-lg" dir={ar ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="text-start">{detail?.title ?? ''}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-start">
              <div className="flex flex-wrap gap-2">
                {detail.category && <Badge variant="secondary">{rfqCategoryLabel(detail.category, lang)}</Badge>}
                {detail.status && <Badge variant="outline">{rfqStatusLabel(String(detail.status), ar)}</Badge>}
              </div>
              {detail.description && (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{detail.description}</p>
              )}
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                {/* THE CURRENCY COMES FROM THE RECORD (CLAUDE.md §87). */}
                {formatMoney(detail.budget, detail.currency, lang) && (
                  <span className="flex items-center gap-1.5" data-testid="enquiry-detail-budget">
                    <Coins className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {formatMoney(detail.budget, detail.currency, lang)}
                  </span>
                )}
                {detail.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{detail.location}
                  </span>
                )}
                {detail.deadline && (
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {new Date(detail.deadline).toLocaleDateString(ar ? 'ar-EG' : 'en-GB')}
                  </span>
                )}
              </div>
              {/* Attachments are authorized for a provider who has consumed the
                  enquiry - the storage proxy resolves the key back to the RFQ
                  and looks for that provider's qualifiedEnquiries row. */}
              {parseAttachments(detail.attachments).length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Paperclip className="h-3.5 w-3.5" />{t('enquiries.attachments')}
                  </p>
                  {parseAttachments(detail.attachments).map((file, index) => (
                    <a
                      key={file.key ?? index}
                      href={file.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 text-sm text-primary underline underline-offset-2"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0" />{file.name ?? file.key}
                    </a>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">{t('enquiries.detailNote')}</p>
              {/* WHERE IT WENT. Opening a request moves it out of this list
                  and into My Leads, and saying so is the difference between a
                  journey that continues and a dialog that just closes. */}
              <Button asChild size="sm" className="w-full" data-testid="enquiry-detail-respond">
                <Link href={`/rfq/${detail.id}/respond`}>{ar ? 'الرد على الطلب' : 'Respond to this request'}</Link>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * `rfqs.attachments` is a JSON-encoded text column, so it can arrive as a
 * string or already parsed depending on the driver, and it may be absent
 * entirely. Anything that is not an array of objects yields nothing rather
 * than throwing inside a render.
 */
function parseAttachments(raw: unknown): { key?: string; url?: string; name?: string }[] {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
}
