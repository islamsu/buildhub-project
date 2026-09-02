import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link } from 'wouter';
import {
  Inbox, Search, RotateCcw, ChevronLeft, ChevronRight, ArrowLeft,
  Clock, Gauge, FileText, Building2, RefreshCw, StickyNote,
} from 'lucide-react';

/**
 * THE VENDOR ENQUIRIES CONTROL PLANE.
 *
 * An enquiry is the relationship between ONE VENDOR and ONE RFQ. It has no
 * table and no status column: every state on this screen is derived from rows
 * that already exist (the invitation, the allowance consumption, the
 * quotation), so what an administrator sees here and what the vendor sees on
 * their own screen cannot drift apart.
 *
 * WHAT THIS SCREEN DELIBERATELY DOES NOT SHOW:
 *
 *   - AVAILABLE as a count. It is not a record - it is every eligible vendor
 *     against every open RFQ - so counting it would produce a number that grows
 *     when a vendor signs up. The server says so explicitly and the strip
 *     renders that as a note rather than as a permanently empty tile.
 *   - Any bid price or quotation content. BuildHub reserves that for the Super
 *     Admin investigation surface, and this screen is marketplace.manage.
 *
 * Zero data renders as a real empty state - the sentence that says what would
 * appear here - never as a fabricated row or a placeholder figure.
 */

const STATE_LABELS: Record<string, { en: string; ar: string; className: string }> = {
  AVAILABLE: { en: 'Available', ar: 'متاح', className: 'border-slate-200 bg-slate-50 text-slate-700' },
  INVITED:   { en: 'Invited', ar: 'مدعو', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  VIEWED:    { en: 'Viewed', ar: 'تمت المشاهدة', className: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
  OPENED:    { en: 'Opened', ar: 'تم الفتح', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  RESPONDED: { en: 'Responded', ar: 'تم الرد', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  DECLINED:  { en: 'Declined', ar: 'مرفوض', className: 'border-rose-200 bg-rose-50 text-rose-700' },
  CLOSED:    { en: 'Closed', ar: 'مغلق', className: 'border-slate-200 bg-slate-100 text-slate-600' },
};

const USAGE_LABELS: Record<string, { en: string; ar: string }> = {
  VENDOR_OPEN: {
    en: 'One allowance unit consumed by the vendor',
    ar: 'تم استهلاك وحدة واحدة من الرصيد بواسطة المورد',
  },
  INVITATION_EXEMPT: {
    en: 'Invited - exempt from the allowance',
    ar: 'مدعو - معفى من الرصيد',
  },
  NOT_OPENED: { en: 'Nothing consumed', ar: 'لم يتم استهلاك أي رصيد' },
};

const TIMELINE_LABELS: Record<string, { en: string; ar: string }> = {
  INVITED: { en: 'Invited', ar: 'تمت الدعوة' },
  VIEWED: { en: 'Viewed', ar: 'تمت المشاهدة' },
  ALLOWANCE_CONSUMED: { en: 'Allowance unit consumed', ar: 'تم استهلاك وحدة رصيد' },
  RESPONDED: { en: 'Quotation submitted', ar: 'تم تقديم عرض السعر' },
  DECLINED: { en: 'Declined', ar: 'تم الرفض' },
};

const PAGE_SIZE = 25;

function StateBadge({ state, ar }: { state: string; ar: boolean }) {
  const label = STATE_LABELS[state];
  if (!label) return <Badge variant="outline">{state}</Badge>;
  return <Badge className={label.className}>{ar ? label.ar : label.en}</Badge>;
}

function when(value: string | null | undefined, ar: boolean): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(ar ? 'ar-EG' : 'en-GB',
    { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function AdminVendorEnquiries() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';

  const [search, setSearch] = useState('');
  const [state, setState] = useState('all');
  const [sort, setSort] = useState<'activity' | 'rfq' | 'vendor' | 'state'>('activity');
  const [page, setPage] = useState(0);
  const [openReference, setOpenReference] = useState<string | null>(null);
  const [noteScope, setNoteScope] = useState<'rfq' | 'vendor'>('rfq');
  const [noteText, setNoteText] = useState('');
  const [noteError, setNoteError] = useState('');

  const overview = trpc.admin.enquiryOverview.useQuery();
  const list = trpc.admin.enquiryList.useQuery({
    ...(state === 'all' ? {} : { state: state as any }),
    ...(search.trim() ? { search: search.trim() } : {}),
    sort, limit: PAGE_SIZE, offset: page * PAGE_SIZE,
  }, { enabled: openReference === null });
  const detail = trpc.admin.enquiryDetail.useQuery(
    { reference: openReference ?? '' },
    { enabled: openReference !== null },
  );
  const pair = detail.data
    ? { rfqId: detail.data.rfq.id, vendorId: detail.data.vendor.id }
    : null;
  const notes = trpc.admin.enquiryNotes.useQuery(pair ?? { rfqId: 0, vendorId: 0 }, { enabled: !!pair });
  const addNote = trpc.admin.addEnquiryNote.useMutation({
    onSuccess: () => { setNoteText(''); setNoteError(''); notes.refetch(); },
    onError: error => setNoteError(error.message),
  });

  const counted = overview.data;
  // AVAILABLE is excluded by the server; the strip must not render it as a
  // tile that is permanently zero, which would read as a broken metric.
  const excluded: readonly string[] = counted?.excludedFromCounts ?? [];
  const tiles = useMemo(
    () => (counted?.states ?? []).filter(s => !excluded.includes(s)),
    [counted, excluded],
  );

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const reset = () => { setSearch(''); setState('all'); setSort('activity'); setPage(0); };

  // ── The detail view ─────────────────────────────────────────────────────

  if (openReference !== null) {
    const data = detail.data;
    return (
      <Card data-testid="admin-enquiry-detail">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Button variant="ghost" size="sm" className="mb-2 h-8 gap-1 px-2"
              onClick={() => setOpenReference(null)} data-testid="enquiry-detail-back">
              <ArrowLeft className="h-3.5 w-3.5" />{ar ? 'رجوع إلى القائمة' : 'Back to the list'}
            </Button>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-primary" />
              <span className="font-mono">{openReference}</span>
            </CardTitle>
          </div>
          {data && <StateBadge state={data.enquiry.state} ar={ar} />}
        </CardHeader>
        <CardContent>
          {detail.isLoading ? (
            <div className="py-10 text-center text-muted-foreground">
              <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />
              {ar ? 'جاري التحميل…' : 'Loading…'}
            </div>
          ) : !data ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {ar
                ? 'لا يوجد استفسار بين هذا المورد وهذا الطلب.'
                : 'No enquiry exists between that vendor and that request.'}
            </p>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border p-4">
                  <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    {ar ? 'الطلب' : 'The request'}
                  </p>
                  <Link href={`/rfq/${data.rfq.id}`}
                    className="font-mono text-sm text-primary underline-offset-2 hover:underline">
                    RFQ #{data.rfq.id}
                  </Link>
                  <p className="mt-1 text-sm">{data.rfq.title ?? '—'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {data.rfq.category ?? '—'} · {ar ? 'الحالة' : 'Status'}: {data.rfq.status ?? '—'}
                    {' · '}{when(data.rfq.createdAt as any, ar)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {ar ? 'صاحب الطلب' : 'Requester'}: {data.rfq.requesterName ?? '—'}
                  </p>
                </div>
                <div className="rounded-xl border p-4">
                  <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    {ar ? 'المورد' : 'The vendor'}
                  </p>
                  <Link href={`/vendor/${data.vendor.id}`}
                    className="text-sm text-primary underline-offset-2 hover:underline">
                    {data.vendor.company || data.vendor.name || `#${data.vendor.id}`}
                  </Link>
                  {data.vendor.company && data.vendor.name && (
                    <p className="mt-1 text-xs text-muted-foreground">{data.vendor.name}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {ar ? 'حالة الحساب' : 'Account'}: {data.vendor.accountStatus ?? '—'}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Gauge className="h-4 w-4 text-muted-foreground" />
                  {ar ? 'رصيد الاستفسارات المؤهلة' : 'Qualified-enquiry allowance'}
                </p>
                {!data.entitlement ? (
                  <p className="text-sm text-muted-foreground">
                    {ar ? 'غير متاح.' : 'Not available.'}
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <p className="text-2xl font-bold">{data.entitlement.used}</p>
                      <p className="text-xs text-muted-foreground">{ar ? 'مستهلك هذا الشهر' : 'Used this month'}</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold">
                        {data.entitlement.allowance === null
                          ? (ar ? 'غير محدود' : 'Unlimited')
                          : data.entitlement.allowance}
                      </p>
                      <p className="text-xs text-muted-foreground">{ar ? 'المخصص' : 'Allowance'}</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold">
                        {data.entitlement.remaining === null
                          ? (ar ? 'غير محدود' : 'Unlimited')
                          : data.entitlement.remaining}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {ar ? 'المتبقي' : 'Remaining'} · {data.entitlement.periodKey}
                      </p>
                    </div>
                  </div>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  {ar
                    ? 'الرصيد هو استحقاق ضمن الباقة. لا يتم تحصيل أي مبلغ عند فتح الاستفسار.'
                    : 'This is a plan entitlement being drawn down. No payment is taken when an enquiry is opened.'}
                </p>
              </div>

              <div className="rounded-xl border p-4">
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  {ar ? 'التسلسل الزمني' : 'Timeline'}
                </p>
                {data.timeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {ar
                      ? 'لم يُسجَّل أي حدث بتاريخ محدد لهذا الاستفسار بعد.'
                      : 'No event with a recorded time has happened on this enquiry yet.'}
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {data.timeline.map((event, index) => (
                      <li key={`${event.event}-${index}`} className="flex gap-3">
                        <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {ar ? TIMELINE_LABELS[event.event]?.ar ?? event.event
                                : TIMELINE_LABELS[event.event]?.en ?? event.event}
                          </p>
                          <p className="text-xs text-muted-foreground">{when(event.at as any, ar)}</p>
                          {event.detail && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{event.detail}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="rounded-xl border p-4" data-testid="enquiry-notes">
                <p className="mb-1 flex items-center gap-2 text-sm font-semibold">
                  <StickyNote className="h-4 w-4 text-muted-foreground" />
                  {ar ? 'ملاحظات داخلية' : 'Internal notes'}
                </p>
                <p className="mb-3 text-xs text-muted-foreground">
                  {ar
                    ? 'الاستفسار علاقة بين مورد وطلب، لذا تُحفظ الملاحظة على الطلب أو على المورد - اختر النطاق.'
                    : 'An enquiry is a relationship between a vendor and a request, so a note is filed against one or the other. Choose the scope.'}
                </p>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {ar ? 'على الطلب' : 'On the request'}
                    </p>
                    {(notes.data?.rfq.length ?? 0) === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {ar ? 'لا توجد ملاحظات على هذا الطلب.' : 'No notes on this request.'}
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {notes.data!.rfq.map(note => (
                          <li key={note.id} className="rounded-lg border bg-muted/20 p-2.5">
                            <p className="text-sm whitespace-pre-wrap">{note.note}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {note.authorName} · {when(note.createdAt as any, ar)}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {ar ? 'على المورد' : 'On the vendor'}
                    </p>
                    {notes.data && !notes.data.vendorNotesVisible ? (
                      // Says WHY they are absent. "No notes" and "you may not
                      // see these" are different facts and must not look alike.
                      <p className="text-xs text-muted-foreground" data-testid="vendor-notes-forbidden">
                        {ar
                          ? 'لا تملك صلاحية عرض ملاحظات المستخدمين.'
                          : 'You do not have permission to view notes on a person.'}
                      </p>
                    ) : (notes.data?.vendor.length ?? 0) === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {ar ? 'لا توجد ملاحظات على هذا المورد.' : 'No notes on this vendor.'}
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {notes.data!.vendor.map(note => (
                          <li key={note.id} className="rounded-lg border bg-muted/20 p-2.5">
                            <p className="text-sm whitespace-pre-wrap">{note.note}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {note.authorName} · {when(note.createdAt as any, ar)}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{ar ? 'النطاق' : 'Scope'}</span>
                    <Select value={noteScope} onValueChange={value => setNoteScope(value as 'rfq' | 'vendor')}>
                      <SelectTrigger className="h-8 w-44" data-testid="note-scope"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rfq">{ar ? 'الطلب' : 'The request'}</SelectItem>
                        <SelectItem value="vendor">{ar ? 'المورد' : 'The vendor'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    data-testid="note-input"
                    value={noteText}
                    onChange={event => { setNoteText(event.target.value); setNoteError(''); }}
                    placeholder={ar ? 'اكتب ملاحظة داخلية…' : 'Write an internal note…'}
                    className="h-9"
                  />
                  {noteError && <p className="text-xs text-rose-600" data-testid="note-error">{noteError}</p>}
                  <Button
                    type="button" size="sm" className="h-8 gap-1"
                    data-testid="note-save"
                    disabled={!noteText.trim() || addNote.isPending || !pair}
                    onClick={() => pair && addNote.mutate({ ...pair, scope: noteScope, note: noteText.trim() })}
                  >
                    <StickyNote className="h-3.5 w-3.5" />{ar ? 'حفظ الملاحظة' : 'Save note'}
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {ar
                  ? 'محتوى عرض السعر (السعر والشروط) غير معروض هنا: مراجعته تتم عبر شاشة التحقيق المخصصة لمدير النظام الأعلى.'
                  : 'Quotation contents (price and terms) are not shown here. Reviewing a bid is done through the Super Admin investigation surface.'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── The overview and the list ───────────────────────────────────────────

  return (
    <div className="space-y-6" data-testid="admin-vendor-enquiries">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-5 w-5 text-primary" />
            {ar ? 'استفسارات الموردين' : 'Vendor enquiries'}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {ar
              ? 'حالة كل استفسار مشتقة من الدعوات والاستهلاك وعروض الأسعار المسجَّلة - لا يوجد جدول منفصل ولا عمود حالة.'
              : 'Every state here is derived from the recorded invitations, allowance consumption and quotations - there is no separate table and no status column.'}
          </p>
        </CardHeader>
        <CardContent>
          {overview.isLoading ? (
            <div className="py-8 text-center text-muted-foreground">
              <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />
              {ar ? 'جاري التحميل…' : 'Loading…'}
            </div>
          ) : !counted || counted.total === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground" data-testid="enquiry-overview-empty">
              {ar
                ? 'لا توجد استفسارات بعد. سيظهر هنا كل مورد تمت دعوته إلى طلب، أو فتح طلبًا، أو قدّم عرض سعر.'
                : 'No enquiries yet. Every vendor invited to a request, who opens one, or who answers one will appear here.'}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                {tiles.map(name => (
                  <button
                    key={name}
                    type="button"
                    data-testid={`enquiry-kpi-${name}`}
                    onClick={() => { setState(name); setPage(0); }}
                    className="rounded-xl border p-3 text-start transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <p className="text-2xl font-bold">{counted.byState[name] ?? 0}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ar ? STATE_LABELS[name]?.ar ?? name : STATE_LABELS[name]?.en ?? name}
                    </p>
                  </button>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>{ar ? 'إجمالي الاستفسارات' : 'Total enquiries'}: <strong>{counted.total}</strong></span>
                <span>{ar ? 'الموردون' : 'Vendors'}: <strong>{counted.vendors}</strong></span>
                <span>{ar ? 'الطلبات' : 'Requests'}: <strong>{counted.rfqs}</strong></span>
                <span>
                  {ar ? 'وحدات الرصيد المستهلكة' : 'Allowance units consumed'}:{' '}
                  <strong>{counted.consumedAllowanceUnits}</strong>
                </span>
              </div>
              {excluded.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {ar
                    ? 'لا تُحتسب حالة "متاح": فهي كل مورد مؤهل مقابل كل طلب مفتوح، وليست سجلًا.'
                    : '"Available" is not counted: it is every eligible vendor against every open request, not a record.'}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,2fr)_minmax(150px,1fr)_minmax(150px,1fr)_auto] lg:items-end">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="enquiry-search">
                {ar ? 'بحث' : 'Search'}
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="enquiry-search"
                  data-testid="enquiry-search"
                  value={search}
                  onChange={event => { setSearch(event.target.value); setPage(0); }}
                  placeholder={ar ? 'اسم المورد، عنوان الطلب، أو ENQ-…' : 'Vendor, request title, or ENQ-…'}
                  className="h-9 bg-background pl-9"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {ar ? 'الحالة' : 'State'}
              </label>
              <Select value={state} onValueChange={value => { setState(value); setPage(0); }}>
                <SelectTrigger className="h-9 bg-background" data-testid="enquiry-state-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{ar ? 'كل الحالات' : 'All states'}</SelectItem>
                  {(counted?.states ?? []).filter(s => !excluded.includes(s)).map(name => (
                    <SelectItem key={name} value={name}>
                      {ar ? STATE_LABELS[name]?.ar ?? name : STATE_LABELS[name]?.en ?? name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {ar ? 'الترتيب' : 'Sort'}
              </label>
              <Select value={sort} onValueChange={value => { setSort(value as any); setPage(0); }}>
                <SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="activity">{ar ? 'آخر نشاط' : 'Latest activity'}</SelectItem>
                  <SelectItem value="rfq">{ar ? 'الطلب' : 'Request'}</SelectItem>
                  <SelectItem value="vendor">{ar ? 'المورد' : 'Vendor'}</SelectItem>
                  <SelectItem value="state">{ar ? 'الحالة' : 'State'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="ghost" className="h-9 gap-1" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" />{ar ? 'مسح' : 'Clear'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <div className="py-10 text-center text-muted-foreground">
              <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />
              {ar ? 'جاري التحميل…' : 'Loading…'}
            </div>
          ) : (list.data?.rows.length ?? 0) === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground" data-testid="enquiry-list-empty">
              {ar ? 'لا توجد استفسارات مطابقة للفلاتر الحالية.' : 'No enquiries match the current filters.'}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b text-start text-xs text-muted-foreground">
                      <th className="py-2 text-start font-medium">{ar ? 'المرجع' : 'Reference'}</th>
                      <th className="py-2 text-start font-medium">{ar ? 'الطلب' : 'Request'}</th>
                      <th className="py-2 text-start font-medium">{ar ? 'المورد' : 'Vendor'}</th>
                      <th className="py-2 text-start font-medium">{ar ? 'الحالة' : 'State'}</th>
                      <th className="py-2 text-start font-medium">{ar ? 'الرصيد' : 'Allowance'}</th>
                      <th className="py-2 text-start font-medium">{ar ? 'آخر نشاط' : 'Last activity'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data!.rows.map(row => {
                      const last = row.respondedAt ?? row.declinedAt ?? row.consumedAt
                        ?? row.viewedAt ?? row.invitedAt;
                      return (
                        <tr
                          key={row.reference}
                          role="button"
                          tabIndex={0}
                          data-testid={`enquiry-row-${row.reference}`}
                          className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          onClick={() => setOpenReference(row.reference)}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setOpenReference(row.reference);
                            }
                          }}
                        >
                          <td className="py-2.5 font-mono text-xs">{row.reference}</td>
                          <td className="max-w-[220px] py-2.5">
                            <span className="block truncate">{row.rfqTitle ?? `RFQ #${row.rfqId}`}</span>
                            <span className="block text-xs text-muted-foreground">RFQ #{row.rfqId}</span>
                          </td>
                          <td className="max-w-[200px] py-2.5">
                            <span className="block truncate">
                              {row.vendorCompany || row.vendorName || `#${row.vendorId}`}
                            </span>
                          </td>
                          <td className="py-2.5"><StateBadge state={row.state} ar={ar} /></td>
                          <td className="py-2.5 text-xs text-muted-foreground">
                            {ar ? USAGE_LABELS[row.usageReason]?.ar ?? row.usageReason
                                : USAGE_LABELS[row.usageReason]?.en ?? row.usageReason}
                          </td>
                          <td className="py-2.5 text-xs text-muted-foreground">{when(last as any, ar)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {ar
                    ? `عرض ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} من ${total}`
                    : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
                </p>
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" variant="outline" className="h-8 gap-1"
                    disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
                    <ChevronLeft className="h-3.5 w-3.5" />{ar ? 'السابق' : 'Previous'}
                  </Button>
                  <span className="text-xs text-muted-foreground">{page + 1} / {pages}</span>
                  <Button type="button" size="sm" variant="outline" className="h-8 gap-1"
                    disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>
                    {ar ? 'التالي' : 'Next'}<ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
