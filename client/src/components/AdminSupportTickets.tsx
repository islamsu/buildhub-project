import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import { Pager } from '@/components/Pager';
import { LifeBuoy, Search } from 'lucide-react';
import {
  SUPPORT_CATEGORIES, SUPPORT_PRIORITIES, SUPPORT_STATUSES, supportLabel,
} from '@shared/supportTickets';

/**
 * ── THE SUPPORT QUEUE ─────────────────────────────────────────────────────
 *
 * Ordered by WHO IS WAITING ON US, not by id: open and in-progress first, then
 * the ones waiting on the customer, then the finished ones, and within a band
 * the person who has waited longest comes first. A support queue sorted by id
 * is a list, not a queue.
 *
 * Everything a support administrator was asked for is here and each maps to a
 * real server operation rather than a column edit: search by reference or name,
 * filter by status/category/priority/assignee, assign, reply, request more
 * information, resolve and close. The transitions go through the state
 * machine, so an undeclared move is refused and the refusal names both states.
 */
const PAGE_SIZE = 20;

export default function AdminSupportTickets() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [priority, setPriority] = useState('all');
  const [assignee, setAssignee] = useState<'all' | 'mine' | 'unassigned'>('all');
  const [openId, setOpenId] = useState<number | null>(null);
  const [reply, setReply] = useState('');
  const [resolution, setResolution] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const list = trpc.admin.supportTickets.useQuery(
    { page, pageSize: PAGE_SIZE, search: search.trim() || undefined, status, category, priority, assignee },
    { retry: false, placeholderData: previous => previous },
  );
  const assignees = trpc.admin.supportAssignees.useQuery(undefined, { retry: false });
  const detail = trpc.support.ticket.useQuery(
    { ticketId: openId ?? 0 },
    { retry: false, enabled: openId != null },
  );
  const notes = trpc.admin.supportTicketNotes.useQuery(
    { ticketId: openId ?? 0 },
    { retry: false, enabled: openId != null },
  );

  const refresh = () => {
    void utils.admin.supportTickets.invalidate();
    if (openId != null) void utils.support.ticket.invalidate({ ticketId: openId });
  };
  const onError = (e: { message: string }) => setError(e.message);

  const sendReply = trpc.support.reply.useMutation({
    onSuccess: () => { setReply(''); setError(''); refresh(); }, onError,
  });
  const assign = trpc.admin.assignSupportTicket.useMutation({ onSuccess: () => { setError(''); refresh(); }, onError });
  const setPriorityFor = trpc.admin.setSupportTicketPriority.useMutation({ onSuccess: () => { setError(''); refresh(); }, onError });
  const transition = trpc.admin.transitionSupportTicket.useMutation({
    onSuccess: () => { setResolution(''); setError(''); refresh(); }, onError,
  });
  const addNote = trpc.admin.addSupportTicketNote.useMutation({
    onSuccess: () => { setNote(''); setError(''); if (openId != null) void utils.admin.supportTicketNotes.invalidate({ ticketId: openId }); },
    onError,
  });

  const rows = list.data?.rows ?? [];
  const ticket = detail.data?.ticket;

  return (
    <Card data-testid="admin-support-tickets">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LifeBuoy className="h-5 w-5" />
          {ar ? 'تذاكر الدعم' : 'Support tickets'}
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {ar
            ? 'مرتبة حسب من ينتظر ردنا. الأقدم انتظارًا أولًا داخل كل مجموعة.'
            : 'Ordered by who is waiting on us. Within a band, whoever has waited longest comes first.'}
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground start-3" />
            <Input
              className="ps-9"
              aria-label={ar ? 'بحث' : 'Search'}
              placeholder={ar ? 'SUP-2026-000123 أو اسم' : 'SUP-2026-000123 or a name'}
              value={search}
              onChange={event => { setSearch(event.target.value); setPage(0); }}
              data-testid="admin-support-search"
            />
          </div>
          <Select value={status} onValueChange={value => { setStatus(value); setPage(0); }}>
            <SelectTrigger aria-label={ar ? 'الحالة' : 'Status'}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{ar ? 'كل الحالات' : 'All statuses'}</SelectItem>
              {SUPPORT_STATUSES.map(v => <SelectItem key={v} value={v}>{supportLabel('status', v, lang)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={value => { setCategory(value); setPage(0); }}>
            <SelectTrigger aria-label={ar ? 'الفئة' : 'Category'}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{ar ? 'كل الفئات' : 'All categories'}</SelectItem>
              {SUPPORT_CATEGORIES.map(v => <SelectItem key={v} value={v}>{supportLabel('category', v, lang)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={value => { setPriority(value); setPage(0); }}>
            <SelectTrigger aria-label={ar ? 'الأولوية' : 'Priority'}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{ar ? 'كل الأولويات' : 'All priorities'}</SelectItem>
              {SUPPORT_PRIORITIES.map(v => <SelectItem key={v} value={v}>{supportLabel('priority', v, lang)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={assignee} onValueChange={value => { setAssignee(value as never); setPage(0); }}>
            <SelectTrigger aria-label={ar ? 'المسؤول' : 'Assignee'}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{ar ? 'الجميع' : 'Anyone'}</SelectItem>
              <SelectItem value="mine">{ar ? 'المسندة إليّ' : 'Assigned to me'}</SelectItem>
              <SelectItem value="unassigned">{ar ? 'غير مسندة' : 'Unassigned'}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <p className="text-sm text-rose-600" data-testid="admin-support-error">{error}</p>}

        {list.isError && <LoadFailed {...loadFailedCopy(ar)} onRetry={() => void list.refetch()} />}
        {list.isLoading && <p className="py-8 text-center text-sm text-muted-foreground">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>}

        {!list.isLoading && !list.isError && rows.length === 0 && (
          <div className="rounded-xl border border-dashed py-10 text-center" data-testid="admin-support-empty">
            <p className="font-medium">{ar ? 'لا توجد تذاكر مطابقة' : 'No tickets match'}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {ar ? 'ستظهر التذاكر هنا فور فتح أحد المستخدمين تذكرة.' : 'Tickets appear here as soon as somebody opens one.'}
            </p>
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="admin-support-table">
              <thead>
                <tr className="border-b text-start text-muted-foreground">
                  <th className="p-2 text-start">{ar ? 'المرجع' : 'Reference'}</th>
                  <th className="p-2 text-start">{ar ? 'الموضوع' : 'Subject'}</th>
                  <th className="p-2 text-start">{ar ? 'صاحب التذكرة' : 'Requester'}</th>
                  <th className="p-2 text-start">{ar ? 'الحالة' : 'Status'}</th>
                  <th className="p-2 text-start">{ar ? 'الأولوية' : 'Priority'}</th>
                  <th className="p-2 text-start">{ar ? 'المسؤول' : 'Assignee'}</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-b last:border-0" data-testid={`admin-support-row-${row.id}`}>
                    <td className="p-2 font-mono text-xs">{row.reference}</td>
                    <td className="p-2">{row.subject}</td>
                    {/* THE PERSON, not the id - the admin human-first rule. */}
                    <td className="p-2">{row.requesterName ?? <span className="text-muted-foreground">{ar ? 'غير متاح' : 'Not available'}</span>}</td>
                    <td className="p-2">
                      <Badge variant="outline">{supportLabel('status', row.status, lang)}</Badge>
                      {row.awaitingParty === 'support' && (
                        <span className="ms-2 text-xs font-medium text-sky-700">{ar ? 'ننتظر نحن' : 'On us'}</span>
                      )}
                    </td>
                    <td className="p-2">{supportLabel('priority', row.priority, lang)}</td>
                    <td className="p-2 text-muted-foreground">
                      {row.assigneeName ?? (ar ? 'غير مسندة' : 'Unassigned')}
                    </td>
                    <td className="p-2 text-end">
                      <Button size="sm" variant="outline" onClick={() => { setOpenId(row.id); setError(''); }} data-testid={`admin-support-open-${row.id}`}>
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
          ar={ar}
          page={list.data?.page ?? 0}
          pageCount={Math.max(1, Math.ceil((list.data?.total ?? 0) / (list.data?.pageSize ?? PAGE_SIZE)))}
          total={list.data?.total ?? 0}
          onChange={setPage}
          testId="admin-support-pager"
        />

        {openId != null && ticket && (
          <div className="rounded-xl border p-4 space-y-4" data-testid="admin-support-detail">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{ticket.subject}</p>
                <p className="text-xs text-muted-foreground">{ticket.reference}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setOpenId(null)}>{ar ? 'إغلاق العرض' : 'Close panel'}</Button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                value={String(ticket.assignedTo ?? 'none')}
                onValueChange={value => assign.mutate({ ticketId: openId, assigneeId: value === 'none' ? null : Number(value) })}
              >
                <SelectTrigger aria-label={ar ? 'إسناد' : 'Assign'}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{ar ? 'غير مسندة' : 'Unassigned'}</SelectItem>
                  {(assignees.data ?? []).map((admin: { id: number; name: string | null }) => (
                    <SelectItem key={admin.id} value={String(admin.id)}>{admin.name ?? `#${admin.id}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={ticket.priority}
                onValueChange={value => setPriorityFor.mutate({ ticketId: openId, priority: value as never })}
              >
                <SelectTrigger aria-label={ar ? 'الأولوية' : 'Priority'}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUPPORT_PRIORITIES.map(v => <SelectItem key={v} value={v}>{supportLabel('priority', v, lang)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Textarea
                aria-label={ar ? 'الرد على العميل' : 'Reply to the customer'}
                placeholder={ar ? 'ردّك، وسيراه صاحب التذكرة.' : 'Your reply. The requester will see this.'}
                rows={3} value={reply} onChange={event => setReply(event.target.value)}
                data-testid="admin-support-reply"
              />
              <Button size="sm" disabled={sendReply.isPending || reply.trim().length === 0}
                onClick={() => sendReply.mutate({ ticketId: openId, body: reply })}
                data-testid="admin-support-reply-send">
                {ar ? 'إرسال الرد' : 'Send reply'}
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => transition.mutate({ ticketId: openId, to: 'in_progress' })}>
                {ar ? 'قيد المعالجة' : 'In progress'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => transition.mutate({ ticketId: openId, to: 'awaiting_user' })}
                data-testid="admin-support-request-info">
                {ar ? 'طلب معلومات' : 'Request information'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => transition.mutate({ ticketId: openId, to: 'closed' })}
                data-testid="admin-support-close">
                {ar ? 'إغلاق' : 'Close'}
              </Button>
            </div>

            <div className="space-y-2 rounded-xl border p-3">
              <p className="text-xs font-medium">{ar ? 'الحل — ما الذي تم فعله' : 'Resolution — what was done'}</p>
              <Textarea rows={2} value={resolution} onChange={event => setResolution(event.target.value)}
                aria-label={ar ? 'ملاحظات الحل' : 'Resolution notes'}
                placeholder={ar ? 'مطلوب: صف ما تم.' : 'Required: describe what was done.'}
                data-testid="admin-support-resolution" />
              <Button size="sm" disabled={transition.isPending || resolution.trim().length === 0}
                onClick={() => transition.mutate({ ticketId: openId, to: 'resolved', resolutionNotes: resolution })}
                data-testid="admin-support-resolve">
                {ar ? 'تم الحل' : 'Mark resolved'}
              </Button>
            </div>

            {/* INTERNAL. Read through a permissioned procedure the customer's
                own detail view has no path to. */}
            <div className="space-y-2 rounded-xl border border-dashed p-3" data-testid="admin-support-notes">
              <p className="text-xs font-medium">{ar ? 'ملاحظات داخلية — لا يراها العميل' : 'Internal notes — the customer never sees these'}</p>
              {(notes.data ?? []).map((row: { id: number; note: string; authorName: string | null }) => (
                <p key={row.id} className="text-sm"><span className="text-muted-foreground">{row.authorName}: </span>{row.note}</p>
              ))}
              <Textarea rows={2} value={note} onChange={event => setNote(event.target.value)}
                aria-label={ar ? 'ملاحظة داخلية' : 'Internal note'} />
              <Button size="sm" variant="outline" disabled={addNote.isPending || note.trim().length === 0}
                onClick={() => addNote.mutate({ ticketId: openId, note })}>
                {ar ? 'إضافة ملاحظة' : 'Add note'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
