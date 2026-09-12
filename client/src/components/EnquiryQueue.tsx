import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import { rfqCategoryLabel } from '@shared/rfqCategories';
import { Calendar, Inbox, MapPin } from 'lucide-react';

/**
 * ── THE PROVIDER'S ENQUIRY WORK QUEUE ─────────────────────────────────────
 *
 * What this replaces on `/enquiries`: a card titled "Qualified enquiries",
 * subtitled "The requests you have opened", rendering a list of requests the
 * provider COULD open - silently truncated at 50, with no total, no filter, no
 * search and no page. The request a provider had actually PAID for vanished
 * from it the moment the customer closed the RFQ, while the credit stayed
 * spent; there was no other list of it anywhere in the product.
 *
 * EVERY FILTER IS APPLIED BY THE SERVER, over the whole queue. Filtering one
 * page in the browser answers "nothing matches" when the match is on page
 * three, with exactly the confidence it answers correctly - which is the
 * defect `server/adminList.ts` exists to end, and this screen is not going to
 * reintroduce it.
 */
const RESPONSE_STATES = ['available', 'opened', 'quoted', 'declined'] as const;
type ResponseState = (typeof RESPONSE_STATES)[number];

function stateLabel(state: string, ar: boolean): string {
  switch (state) {
    case 'available': return ar ? 'متاح للفتح' : 'Available';
    case 'opened': return ar ? 'مفتوح' : 'Opened';
    case 'quoted': return ar ? 'قدّمت عرضاً' : 'Quoted';
    case 'declined': return ar ? 'اعتذرت' : 'Declined';
    default: return state;
  }
}
function rfqStatusLabel(status: string, ar: boolean): string {
  switch (status) {
    case 'open': return ar ? 'مفتوح' : 'Open';
    case 'closed': return ar ? 'مغلق' : 'Closed';
    case 'awarded': return ar ? 'تمت الترسية' : 'Awarded';
    default: return status;
  }
}

export default function EnquiryQueue({ highlightRfqId }: { highlightRfqId?: number } = {}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';

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
  const [responseState, setResponseState] = useState<ResponseState | ''>('');
  const [rfqStatus, setRfqStatus] = useState('');
  const [source, setSource] = useState('');
  const [category, setCategory] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => { setDebounced(search.trim()); setPage(0); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const queue = trpc.rfq.queue.useQuery({
    page,
    responseState: responseState || undefined,
    rfqStatus: (rfqStatus || undefined) as any,
    source: (source || undefined) as any,
    category: category || undefined,
    search: debounced || undefined,
  }, { retry: false });

  const rows = queue.data?.rows ?? [];
  const total = queue.data?.total ?? 0;
  const pageSize = queue.data?.pageSize ?? 20;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const summary = queue.data?.summary;
  const filtering = Boolean(debounced || responseState || rfqStatus || source || category);
  const when = (value: string | Date | null) =>
    value ? new Date(value).toLocaleDateString(ar ? 'ar-EG' : 'en-US') : '—';

  return (
    <Card data-testid="enquiry-queue">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Inbox className="h-4 w-4" />
          {ar ? 'قائمة العمل' : 'Work queue'}
        </CardTitle>
        {/* THE COUNTS ARE TAKEN OVER THE WHOLE QUEUE, by the same query that
            builds it - so a tile and the list it filters to cannot disagree. */}
        {summary && (
          <div className="flex flex-wrap gap-2 pt-2" data-testid="enquiry-queue-summary">
            {RESPONSE_STATES.map(state => (
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
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={ar ? 'ابحث بالعنوان أو الرقم المرجعي…' : 'Search by title or reference…'}
            className="h-9 max-w-xs"
            data-testid="enquiry-queue-search"
          />
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
                : (ar
                    ? 'لم يصلك أي طلب بعد. أعلن فئات خدمتك لتصلك الطلبات المطابقة.'
                    : 'No request has reached you yet. Declare your service categories to receive matching requests.')}
          </p>
        ) : (
          <div className="space-y-2" data-testid="enquiry-queue-rows">
            {rows.map(row => (
              <div
                key={row.rfqId}
                className={`rounded-lg border p-3 ${row.rfqId === highlightRfqId ? 'ring-2 ring-primary' : ''}`}
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
                    <Badge variant="outline" data-testid={`enquiry-queue-state-${row.rfqId}`}>
                      {stateLabel(row.responseState, ar)}
                    </Badge>
                    <Badge variant={row.rfqStatus === 'open' ? 'secondary' : 'outline'}>
                      {rfqStatusLabel(row.rfqStatus, ar)}
                    </Badge>
                    {row.source === 'invitation' && (
                      <Badge variant="secondary" data-testid={`enquiry-queue-invited-${row.rfqId}`}>
                        {ar ? 'بدعوة' : 'Invited'}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {row.category && <span>{rfqCategoryLabel(row.category, lang)}</span>}
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
    </Card>
  );
}
