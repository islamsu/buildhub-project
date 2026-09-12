import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import { Pager } from '@/components/Pager';
import { Link } from 'wouter';
import { MessageSquare, Paperclip, Search, ShieldAlert } from 'lucide-react';
import {
  DISPUTE_ADMIN_SETTABLE_STATUSES, DISPUTE_CATEGORIES, DISPUTE_PRIORITIES,
  DISPUTE_RESOLUTION_TYPES, DISPUTE_STATUSES, DISPUTE_SUBJECT_TYPES,
  type DisputeAdminStatus, type DisputeResolutionType,
} from '@shared/disputes';
// The label maps are SHARED with the user-facing dispute screens: three copies
// of a closed set's translation is how this codebase got four disagreeing
// category vocabularies.
import { disputeLabels, statusTone, type DisputeLabels } from '@/lib/disputeCopy';

/**
 * DISPUTE ADMINISTRATION.
 *
 * What this replaces was a list rendered inline in AdminDashboard from an
 * unpaged, unfiltered `admin.disputes`, and a dialog with two controls: a
 * status dropdown and a notes box. From that screen an administrator could not
 * see who a dispute was about, what evidence had been filed, what the parties
 * had said to each other, who was working it, or how any earlier dispute had
 * been decided - and could resolve one without saying how.
 *
 * Every control here is backed by a procedure that enforces its own rule
 * server-side. The status dropdown offers only DISPUTE_ADMIN_SETTABLE_STATUSES
 * because `withdrawn` is the reporter's own decision, and the state machine
 * refuses an invalid move whatever this screen offers.
 */
const PAGE_SIZE = 25;

type Filters = {
  status: string; priority: string; category: string;
  subjectType: string; assignment: 'all' | 'mine' | 'assigned' | 'unassigned';
};

const NO_FILTERS: Filters = {
  status: 'all', priority: 'all', category: 'all', subjectType: 'all', assignment: 'all',
};

export default function AdminDisputes() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const failedCopy = loadFailedCopy(ar);
  const label = disputeLabels(ar);

  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);

  const setFilter = (patch: Partial<Filters>) => { setFilters(current => ({ ...current, ...patch })); setPage(0); };

  const queue = trpc.admin.disputes.useQuery(
    {
      page, pageSize: PAGE_SIZE,
      search: search || undefined,
      status: filters.status, priority: filters.priority,
      category: filters.category, subjectType: filters.subjectType,
      assignment: filters.assignment,
    },
    { retry: false, placeholderData: previous => previous },
  );

  const counts = queue.data?.counts;
  const filtered = search !== '' || JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  return (
    <Card data-testid="admin-disputes">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          {ar ? 'إدارة النزاعات' : 'Dispute Management'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/*
          THE QUEUE'S OWN SUMMARY, from a grouped count over the whole table -
          not from the page. A "3 open" taken from a filtered page of 25 would
          be a count of the page wearing the name of the platform.
        */}
        {counts && (
          <div className="flex flex-wrap gap-2" data-testid="dispute-counts">
            {DISPUTE_STATUSES.map(value => (
              <button
                key={value} type="button"
                data-testid={`dispute-count-${value}`}
                onClick={() => setFilter({ status: filters.status === value ? 'all' : value })}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  filters.status === value ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted'
                }`}
              >
                {label.status(value)}: {counts[value] ?? 0}
              </button>
            ))}
          </div>
        )}

        <form
          className="grid gap-2 md:grid-cols-[1fr_auto]"
          onSubmit={event => { event.preventDefault(); setSearch(typed.trim()); setPage(0); }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="ps-9" value={typed} data-testid="dispute-search"
              onChange={event => setTyped(event.target.value)}
              placeholder={ar ? 'ابحث بالمرجع أو العنوان أو الطرف…' : 'Search reference, title or party…'}
            />
          </div>
          <Button type="submit" variant="outline" className="h-9">{ar ? 'بحث' : 'Search'}</Button>
        </form>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect
            testId="dispute-filter-priority" value={filters.priority}
            onChange={value => setFilter({ priority: value })}
            allLabel={ar ? 'كل الأولويات' : 'All priorities'}
            options={DISPUTE_PRIORITIES.map(value => ({ value, label: label.priority(value) }))}
          />
          <FilterSelect
            testId="dispute-filter-category" value={filters.category}
            onChange={value => setFilter({ category: value })}
            allLabel={ar ? 'كل الفئات' : 'All categories'}
            options={DISPUTE_CATEGORIES.map(value => ({ value, label: label.category(value) }))}
          />
          <FilterSelect
            testId="dispute-filter-subject" value={filters.subjectType}
            onChange={value => setFilter({ subjectType: value })}
            allLabel={ar ? 'كل الموضوعات' : 'All subjects'}
            options={DISPUTE_SUBJECT_TYPES.map(value => ({ value, label: label.subject(value) }))}
          />
          <FilterSelect
            testId="dispute-filter-assignment" value={filters.assignment}
            onChange={value => setFilter({ assignment: value as Filters['assignment'] })}
            allLabel={ar ? 'الكل' : 'Everyone'}
            options={[
              { value: 'mine', label: ar ? 'المسندة إليّ' : 'Assigned to me' },
              { value: 'assigned', label: ar ? 'مسندة' : 'Assigned' },
              { value: 'unassigned', label: ar ? 'غير مسندة' : 'Unassigned' },
            ]}
          />
        </div>

        {queue.isError ? (
          <LoadFailed {...failedCopy} onRetry={() => void queue.refetch()} />
        ) : (queue.data?.rows.length ?? 0) === 0 ? (
          /*
            TWO DIFFERENT EMPTY STATES. "No disputes have been filed" under an
            active filter is false - there may be hundreds, none matching - and
            it is the sentence that would stop an administrator looking.
          */
          <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground" data-testid="dispute-empty">
            {queue.isLoading
              ? (ar ? 'جارٍ التحميل…' : 'Loading…')
              : filtered
                ? (ar ? 'لا توجد نزاعات مطابقة لهذا البحث.' : 'No disputes match this search.')
                : (ar ? 'لم يُسجَّل أي نزاع.' : 'No disputes have been filed.')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="p-2 text-start">{ar ? 'المرجع' : 'Reference'}</th>
                  <th className="p-2 text-start">{ar ? 'الموضوع' : 'Dispute'}</th>
                  <th className="p-2 text-start">{ar ? 'الأطراف' : 'Parties'}</th>
                  <th className="p-2 text-start">{ar ? 'الحالة' : 'Status'}</th>
                  <th className="p-2 text-start">{ar ? 'المسؤول' : 'Owner'}</th>
                  <th className="p-2 text-start">{ar ? 'التاريخ' : 'Filed'}</th>
                  <th className="p-2 text-start">{ar ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {(queue.data?.rows ?? []).map((row: any) => (
                  <tr key={row.id} className="border-b last:border-0 align-top">
                    <td className="p-2 font-mono text-xs">{row.reference ?? `#${row.id}`}</td>
                    <td className="p-2">
                      <p className="font-medium">{row.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {label.subject(row.subjectType)}
                        {Number(row.subjectId) > 0 ? ` #${row.subjectId}` : ''} · {label.category(row.category)}
                      </p>
                    </td>
                    <td className="p-2 text-xs">
                      <Link href={`/admin/users/${row.reporterId}`} className="underline-offset-2 hover:underline">
                        {row.reporterName || `#${row.reporterId}`}
                      </Link>
                      {row.respondentId ? (
                        <>
                          <span className="text-muted-foreground"> → </span>
                          <Link href={`/admin/users/${row.respondentId}`} className="underline-offset-2 hover:underline">
                            {row.respondentName || `#${row.respondentId}`}
                          </Link>
                        </>
                      ) : (
                        <span className="text-muted-foreground"> · {ar ? 'بلا طرف مُسمّى' : 'no named respondent'}</span>
                      )}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={statusTone(row.status) as any}>{label.status(row.status)}</Badge>
                        <Badge variant="outline">{label.priority(row.priority)}</Badge>
                      </div>
                    </td>
                    <td className="p-2 text-xs">
                      {row.assigneeName ?? <span className="text-muted-foreground">{ar ? 'غير مسند' : 'Unassigned'}</span>}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleDateString()}
                    </td>
                    <td className="p-2">
                      <Button
                        size="sm" variant="outline" className="h-7 text-xs"
                        data-testid={`dispute-open-${row.id}`}
                        onClick={() => setOpenId(Number(row.id))}
                      >
                        {ar ? 'فتح' : 'Open'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pager
          ar={ar} page={page} total={queue.data?.total ?? null}
          pageCount={Math.max(1, Math.ceil((queue.data?.total ?? 0) / PAGE_SIZE))}
          onChange={setPage} testId="dispute-pager"
        />
      </CardContent>

      {openId !== null && (
        <DisputeDetailDialog
          disputeId={openId} ar={ar} label={label}
          onClose={() => setOpenId(null)}
          onChanged={() => void queue.refetch()}
        />
      )}
    </Card>
  );
}

function FilterSelect({ testId, value, onChange, allLabel, options }: {
  testId: string; value: string; onChange: (value: string) => void;
  allLabel: string; options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9" data-testid={testId}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/**
 * THE WHOLE RECORD OF ONE DISPUTE.
 *
 * History, what the parties said, what they filed, and the internal notes -
 * which come from `adminNotes`, a DIFFERENT TABLE from the participants'
 * messages, so no mistake here can show a reporter what an administrator wrote
 * about them.
 */
function DisputeDetailDialog({ disputeId, ar, label, onClose, onChanged }: {
  disputeId: number; ar: boolean;
  label: DisputeLabels;
  onClose: () => void; onChanged: () => void;
}) {
  const detail = trpc.admin.disputeDetail.useQuery({ disputeId }, { retry: false });
  const assignees = trpc.admin.disputeAssignees.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const failedCopy = loadFailedCopy(ar);

  const refresh = () => { void utils.admin.disputeDetail.invalidate({ disputeId }); onChanged(); };
  const update = trpc.admin.updateDispute.useMutation({ onSuccess: refresh });
  const assign = trpc.admin.assignDispute.useMutation({ onSuccess: refresh });
  const addNote = trpc.admin.addDisputeNote.useMutation({ onSuccess: refresh });

  const dispute = detail.data?.dispute as any;
  const [status, setStatus] = useState<DisputeAdminStatus | ''>('');
  const [resolutionType, setResolutionType] = useState<DisputeResolutionType | ''>('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  const chosenStatus = (status || (dispute?.status === 'withdrawn' ? 'open' : dispute?.status)) as DisputeAdminStatus | undefined;
  const resolving = chosenStatus === 'resolved';
  const rejecting = chosenStatus === 'rejected';

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="dispute-detail">
        <DialogHeader>
          <DialogTitle className="text-base">
            {detail.data ? `${dispute.reference ?? `#${dispute.id}`} — ${dispute.title}` : (ar ? 'النزاع' : 'Dispute')}
          </DialogTitle>
        </DialogHeader>

        {detail.isError ? (
          <LoadFailed {...failedCopy} onRetry={() => void detail.refetch()} />
        ) : !detail.data ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
        ) : (
          <div className="space-y-5 text-sm">
            <section className="space-y-2">
              <div className="flex flex-wrap gap-1">
                <Badge variant={statusTone(dispute.status) as any}>{label.status(dispute.status)}</Badge>
                <Badge variant="outline">{label.priority(dispute.priority)}</Badge>
                <Badge variant="outline">{label.category(dispute.category)}</Badge>
              </div>
              <p className="whitespace-pre-wrap text-muted-foreground">{dispute.description}</p>
              <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                <Row ar={ar} en="Subject" arLabel="الموضوع"
                  value={detail.data.subjectLabel ?? (ar ? 'غير مسجّل' : 'not recorded')} />
                <Row ar={ar} en="Reporter" arLabel="مقدّم النزاع"
                  value={dispute.reporterName ?? `#${dispute.reporterId}`} />
                <Row ar={ar} en="Respondent" arLabel="الطرف الآخر"
                  value={dispute.respondentName ?? (ar ? 'بلا طرف مُسمّى' : 'no named respondent')} />
                <Row ar={ar} en="Owner" arLabel="المسؤول"
                  value={dispute.assigneeName ?? (ar ? 'غير مسند' : 'Unassigned')} />
                {dispute.resolutionType && (
                  <Row ar={ar} en="Outcome" arLabel="النتيجة"
                    value={`${label.resolution(dispute.resolutionType)}${dispute.resolvedByName ? ` — ${dispute.resolvedByName}` : ''}`} />
                )}
              </dl>
              {dispute.resolutionNotes && (
                <p className="rounded-lg bg-muted p-2 text-xs whitespace-pre-wrap">{dispute.resolutionNotes}</p>
              )}
            </section>

            {/* ── ASSIGNMENT ────────────────────────────────────────────── */}
            <section className="space-y-2 rounded-lg border p-3">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                {ar ? 'الإسناد والأولوية' : 'Assignment & priority'}
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                <Select
                  value={dispute.assignedTo ? String(dispute.assignedTo) : 'none'}
                  onValueChange={value => assign.mutate({
                    disputeId, assignedTo: value === 'none' ? null : Number(value),
                  })}
                >
                  <SelectTrigger className="h-9" data-testid="dispute-assignee"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{ar ? 'غير مسند' : 'Unassigned'}</SelectItem>
                    {(assignees.data ?? []).map(admin => (
                      <SelectItem key={admin.id} value={String(admin.id)}>{admin.name ?? `#${admin.id}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={dispute.priority}
                  onValueChange={value => assign.mutate({
                    disputeId, assignedTo: dispute.assignedTo ?? null, priority: value as any,
                  })}
                >
                  <SelectTrigger className="h-9" data-testid="dispute-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DISPUTE_PRIORITIES.map(value => (
                      <SelectItem key={value} value={value}>{label.priority(value)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {assign.isError && <p className="text-xs text-destructive" data-testid="dispute-assign-error">{assign.error.message}</p>}
            </section>

            {/* ── MOVE IT ───────────────────────────────────────────────── */}
            <section className="space-y-2 rounded-lg border p-3">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                {ar ? 'تحديث الحالة' : 'Move this dispute'}
              </h4>
              <Select value={chosenStatus ?? ''} onValueChange={value => setStatus(value as DisputeAdminStatus)}>
                <SelectTrigger className="h-9" data-testid="dispute-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DISPUTE_ADMIN_SETTABLE_STATUSES.map(value => (
                    <SelectItem key={value} value={value}>{label.status(value)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {resolving && (
                <>
                  {/*
                    HOW it was resolved, not just THAT it was. A bare status flip
                    is what the old dialog did, and it left no answer to "how did
                    we decide this" on any dispute ever closed.
                  */}
                  <Select value={resolutionType} onValueChange={value => setResolutionType(value as DisputeResolutionType)}>
                    <SelectTrigger className="h-9" data-testid="dispute-resolution-type">
                      <SelectValue placeholder={ar ? 'كيف انتهى النزاع؟' : 'How was it resolved?'} />
                    </SelectTrigger>
                    <SelectContent>
                      {DISPUTE_RESOLUTION_TYPES.map(value => (
                        <SelectItem key={value} value={value}>{label.resolution(value)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Textarea
                    rows={3} data-testid="dispute-resolution-notes"
                    placeholder={ar ? 'ملاحظات الحل — يقرؤها الطرفان' : 'Resolution notes — both parties read these'}
                    value={notes} onChange={event => setNotes(event.target.value)}
                  />
                </>
              )}
              {rejecting && (
                <Textarea
                  rows={2} data-testid="dispute-reason"
                  placeholder={ar ? 'سبب الرفض (مطلوب)' : 'Why is this being rejected? (required)'}
                  value={reason} onChange={event => setReason(event.target.value)}
                />
              )}

              <Button
                size="sm" data-testid="dispute-save"
                disabled={update.isPending || !chosenStatus || chosenStatus === dispute.status}
                onClick={() => chosenStatus && update.mutate({
                  disputeId, status: chosenStatus,
                  reason: reason.trim() || undefined,
                  resolutionType: resolving && resolutionType ? resolutionType : undefined,
                  resolutionNotes: resolving && notes.trim() ? notes.trim() : undefined,
                })}
              >
                {update.isPending ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ' : 'Save')}
              </Button>
              {/*
                The state machine refuses invalid moves, and its refusal says
                WHY. Surfacing the server's own sentence rather than a generic
                one is what tells an administrator that a resolved dispute has
                to be reopened rather than edited.
              */}
              {update.isError && <p className="text-xs text-destructive" data-testid="dispute-save-error">{update.error.message}</p>}
            </section>

            <Timeline ar={ar} label={label} history={detail.data.history as any[]} />

            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                {ar ? 'رسائل الطرفين' : 'What the parties said'}
              </h4>
              {(detail.data.messages as any[]).length === 0 ? (
                <p className="text-xs text-muted-foreground" data-testid="dispute-no-messages">
                  {ar ? 'لم يتبادل الطرفان أي رسائل.' : 'The parties have exchanged no messages.'}
                </p>
              ) : (
                <ul className="space-y-2" data-testid="dispute-messages">
                  {(detail.data.messages as any[]).map(message => (
                    <li key={message.id} className="rounded-lg border p-2">
                      <p className="text-xs font-medium">
                        {message.authorName ?? `#${message.authorId}`}
                        <span className="ms-2 font-normal text-muted-foreground">
                          {new Date(message.createdAt).toLocaleString()}
                        </span>
                      </p>
                      <p className="whitespace-pre-wrap text-xs">{message.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h4 className="flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
                <Paperclip className="h-3 w-3" />{ar ? 'الأدلة' : 'Evidence'}
              </h4>
              {(detail.data.evidence as any[]).length === 0 ? (
                <p className="text-xs text-muted-foreground" data-testid="dispute-no-evidence">
                  {ar ? 'لم تُرفَق أي أدلة.' : 'No evidence has been filed.'}
                </p>
              ) : (
                <ul className="space-y-1" data-testid="dispute-evidence">
                  {(detail.data.evidence as any[]).map(file => (
                    <li key={file.id} className="flex flex-wrap items-center gap-2 text-xs">
                      {file.url ? (
                        <a href={file.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                          {file.fileName}
                        </a>
                      ) : (
                        /* Kept, never hidden: the record shows the file existed. */
                        <span className="text-muted-foreground line-through">{file.fileName}</span>
                      )}
                      <span className="text-muted-foreground">
                        {file.uploaderName ?? `#${file.uploadedBy}`}
                        {file.removedAt ? ` · ${ar ? 'مسحوب' : 'withdrawn'}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── INTERNAL NOTES ────────────────────────────────────────── */}
            <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/50 p-3 dark:bg-amber-950/20">
              <h4 className="flex items-center gap-1 text-xs font-semibold uppercase text-amber-700 dark:text-amber-500">
                <ShieldAlert className="h-3 w-3" />
                {ar ? 'ملاحظات داخلية — لا يراها الطرفان' : 'Internal notes — the parties never see these'}
              </h4>
              {(detail.data.notes as any[]).map(row => (
                <div key={row.id} className="rounded border bg-background p-2 text-xs">
                  <p className="font-medium">
                    {row.authorName ?? `#${row.authorId}`}
                    <span className="ms-2 font-normal text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString()}
                    </span>
                  </p>
                  <p className="whitespace-pre-wrap">{row.note}</p>
                </div>
              ))}
              <Textarea
                rows={2} data-testid="dispute-note"
                placeholder={ar ? 'أضف ملاحظة داخلية…' : 'Add an internal note…'}
                value={note} onChange={event => setNote(event.target.value)}
              />
              <Button
                size="sm" variant="outline" className="h-7 text-xs" data-testid="dispute-note-save"
                disabled={addNote.isPending || !note.trim()}
                onClick={() => addNote.mutate({ disputeId, note: note.trim() }, { onSuccess: () => setNote('') })}
              >
                {ar ? 'حفظ الملاحظة' : 'Save note'}
              </Button>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ ar, en, arLabel, value }: { ar: boolean; en: string; arLabel: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{ar ? arLabel : en}:</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}

/** Every move this dispute has made, and who made it. */
function Timeline({ ar, label, history }: {
  ar: boolean; label: DisputeLabels; history: any[];
}) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase text-muted-foreground">{ar ? 'السجل' : 'History'}</h4>
      <ol className="space-y-1 text-xs" data-testid="dispute-history">
        {history.map(entry => (
          <li key={entry.id} className="flex flex-wrap gap-2">
            <span className="text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</span>
            <span>
              {entry.fromStatus === 'none'
                ? (ar ? 'فُتح النزاع' : 'Dispute raised')
                : `${label.status(entry.fromStatus)} → ${label.status(entry.toStatus)}`}
            </span>
            <span className="text-muted-foreground">{entry.actorName ?? `#${entry.actorId}`}</span>
            {entry.reason && <span className="text-muted-foreground">— {entry.reason}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
