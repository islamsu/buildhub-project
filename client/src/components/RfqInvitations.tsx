import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search, UserPlus } from 'lucide-react';

/**
 * WHO A CUSTOMER ASKED, AND WHERE EACH OF THEM GOT TO.
 *
 * THE GATE COMES FROM THE SERVER, NOT FROM A RULE COPIED HERE. The right to
 * invite belongs to the requester, anyone holding `commercial` on the linked
 * project, and Super Admin - three conditions this component deliberately does
 * not re-derive. It asks `rfq.invitations`; if that query is refused, the
 * caller may not invite and the panel does not render. A second copy of an
 * authorization rule is a second chance for the two to disagree, and the
 * screen would be the copy that is wrong.
 *
 * NOTHING ABOUT A SUPPLIER IS INVENTED HERE. Names, ratings and locations come
 * from the server's explicit column allowlist; there is no fabricated
 * "response time", "match score" or "recommended" badge. An invitation that
 * has not been answered says so rather than being dressed up as progress.
 */
export default function RfqInvitations({ rfqId, isOpen }: { rfqId: number; isOpen: boolean }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const invitations = trpc.rfq.invitations.useQuery({ rfqId }, { retry: false });

  // A refusal is the answer, not a failure to render around: the caller simply
  // may not invite on this RFQ.
  const mayInvite = !invitations.isError;

  const directory = trpc.marketplace.vendors.useQuery(
    { search: submitted || undefined, limit: 10 },
    { enabled: mayInvite && submitted !== '', retry: false },
  );

  const invite = trpc.rfq.inviteSupplier.useMutation({
    onSuccess: result => {
      setError('');
      setNotice(result.outcome === 'already_invited'
        ? (ar ? 'هذا المورّد مدعو بالفعل.' : 'That supplier is already invited.')
        : (ar ? 'تم إرسال الدعوة.' : 'Invitation sent.'));
      void utils.rfq.invitations.invalidate({ rfqId });
    },
    // The server's own refusal, rendered as written.
    onError: e => { setNotice(''); setError(e.message); },
  });

  if (!mayInvite) return null;

  const rows = invitations.data ?? [];
  const invitedIds = new Set(rows.map(r => r.supplierId));

  const statusLabel = (status: string) => ({
    invited:   ar ? 'بانتظار الرد' : 'Awaiting response',
    viewed:    ar ? 'اطّلع على الطلب' : 'Opened the request',
    responded: ar ? 'قدّم عرض سعر' : 'Submitted a quotation',
    declined:  ar ? 'اعتذر' : 'Declined',
  } as Record<string, string>)[status] ?? status;

  const statusTone = (status: string) =>
    status === 'responded' ? 'default' : status === 'declined' ? 'destructive' : 'outline';

  return (
    <Card className="mt-6" data-testid="rfq-invitations">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="h-4 w-4" />
          {ar ? 'الموردون المدعوون' : 'Invited suppliers'}
        </CardTitle>
        <p className="pt-1 text-xs text-muted-foreground">
          {ar
            ? 'الدعوة تُضاف إلى اللوحة المفتوحة ولا تحل محلها — الموردون المطابقون للفئة يرون الطلب على أي حال. فتح الطلب لا يستهلك من طلبات المورّد المؤهلة.'
            : 'An invitation is added to the open board, not a replacement for it — suppliers matching the category see this request anyway. Opening an invited request does not use one of their monthly qualified enquiries.'}
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Who has already been asked ─────────────────────────────── */}
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground"
             data-testid="rfq-invitations-empty">
            {ar ? 'لم تتم دعوة أي مورّد بعد.' : 'No suppliers invited yet.'}
          </p>
        ) : (
          <ul className="space-y-2" data-testid="rfq-invitations-list">
            {rows.map(row => {
              const supplier = row.supplier;
              return (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {supplier?.name ?? (ar ? 'مورّد' : 'Supplier')}
                    </p>
                    {supplier?.location && (
                      <p className="truncate text-xs text-muted-foreground">{supplier.location}</p>
                    )}
                  </div>
                  <Badge variant={statusTone(row.status) as never} className="text-[11px]">
                    {statusLabel(row.status)}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}

        {/* ── Inviting someone new ───────────────────────────────────── */}
        {isOpen ? (
          <div className="space-y-2 border-t pt-4">
            <label className="text-xs text-muted-foreground" htmlFor="rfq-invite-search">
              {ar ? 'ابحث عن مورّد لدعوته' : 'Find a supplier to invite'}
            </label>
            <div className="flex gap-2">
              <Input
                id="rfq-invite-search"
                data-testid="rfq-invite-search"
                className="h-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { setSubmitted(search.trim()); setNotice(''); setError(''); } }}
              />
              <Button
                size="sm" variant="outline" className="h-9 gap-1.5"
                data-testid="rfq-invite-search-go"
                disabled={search.trim() === ''}
                onClick={() => { setSubmitted(search.trim()); setNotice(''); setError(''); }}
              >
                <Search className="h-3.5 w-3.5" />{ar ? 'بحث' : 'Search'}
              </Button>
            </div>

            {submitted !== '' && directory.data && directory.data.length === 0 && (
              <p className="py-3 text-sm text-muted-foreground" data-testid="rfq-invite-no-results">
                {ar ? 'لا يوجد مورّد بهذا الاسم.' : 'No supplier found with that name.'}
              </p>
            )}

            <ul className="space-y-2">
              {(directory.data ?? []).map(vendor => (
                <li key={vendor.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{vendor.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[vendor.userRole, vendor.location].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    data-testid={`rfq-invite-${vendor.id}`}
                    disabled={invitedIds.has(vendor.id) || invite.isPending}
                    onClick={() => invite.mutate({ rfqId, supplierId: vendor.id })}
                  >
                    {invitedIds.has(vendor.id)
                      ? (ar ? 'مدعو' : 'Invited')
                      : (ar ? 'دعوة' : 'Invite')}
                  </Button>
                </li>
              ))}
            </ul>

            {notice && <p className="text-sm text-emerald-700" data-testid="rfq-invite-notice">{notice}</p>}
            {error && <p className="text-sm text-destructive" data-testid="rfq-invite-error">{error}</p>}
          </div>
        ) : (
          <p className="border-t pt-4 text-sm text-muted-foreground" data-testid="rfq-invite-closed">
            {ar
              ? 'هذا الطلب لم يعد مفتوحاً، فلا يمكن دعوة موردين إليه.'
              : 'This request is no longer open, so suppliers cannot be invited to it.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
