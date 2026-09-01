/**
 * ── One request, reconstructed (Parts 41 and 52) ───────────────────────────
 *
 * When a customer and a supplier disagree, the question an administrator has is
 * never "what does the RFQ table say". It is "who did what, when, to which
 * record, from what value to what value, who was told, and what was at stake".
 *
 * BuildHub could already answer every fragment of that separately - the audit
 * here, the notifications there, the bids somewhere else - and could not answer
 * the question. This page is the answer in one place.
 *
 * SUPER ADMIN ONLY, enforced by the server. This read crosses every ownership
 * boundary in the product at once: two parties' private messages, every
 * competing bid's price, the whole trail. A sub-admin who opens it gets the
 * server's refusal, shown as written.
 *
 * NOTHING SECRET REACHES IT. Every party comes through an explicit column
 * allowlist server-side - `users` holds a password hash and a live invitation
 * token, and a bare select has leaked them twice in this codebase's history.
 */

import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, AlertTriangle, X } from 'lucide-react';

export default function AdminRfqInvestigation() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [searchText, setSearchText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [rfqId, setRfqId] = useState<number | null>(null);
  const [selectedRfq, setSelectedRfq] = useState<{ id: number; label: string } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const enabled = rfqId !== null;
  const { data, isLoading, error } = trpc.admin.rfqInvestigation.useQuery(
    { rfqId: rfqId ?? 0 }, { enabled, retry: false },
  );
  const { data: searchData, isFetching: searchFetching } = trpc.admin.platformSearch.useQuery(
    { query: debounced || 'x' },
    { enabled: debounced.length >= 2 && rfqId === null, retry: false },
  );
  const rfqHits = searchData?.segments.find(segment => segment.key === 'rfqs')?.hits ?? [];

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(searchText.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchText]);

  const when = (value: string | Date | null | undefined) =>
    value ? new Date(value).toLocaleString(ar ? 'ar-EG' : 'en-US') : '—';
  const partyName = (id: number | null | undefined) => {
    if (id === null || id === undefined) return '—';
    const party = data?.parties.find(p => p.id === id);
    return party ? `${party.name ?? party.username ?? '—'} (#${id})` : `#${id}`;
  };

  const chooseRfq = (hit: { id: number; label: string }) => {
    setRfqId(hit.id);
    setSelectedRfq({ id: hit.id, label: hit.label });
    setSearchText('');
    setOpen(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="w-5 h-5" />
          {ar ? 'تحقيق في طلب' : 'Request investigation'}
        </CardTitle>
        <div className="relative w-full sm:max-w-md" ref={boxRef}>
          {selectedRfq ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2">
              <span className="min-w-0 truncate text-sm">{selectedRfq.label} <span className="text-muted-foreground">#{selectedRfq.id}</span></span>
              <button type="button" onClick={() => { setRfqId(null); setSelectedRfq(null); setSearchText(''); }} aria-label={ar ? 'مسح الطلب' : 'Clear request'}>
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="investigation-rfq-input"
                className="ps-9"
                placeholder={ar ? 'ابحث عن طلب بالاسم أو المرجع…' : 'Search a request by name or reference…'}
                value={searchText}
                onChange={event => { setSearchText(event.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}
                aria-label={ar ? 'ابحث عن طلب' : 'Search for a request'}
              />
            </div>
          )}
          {open && debounced.length >= 2 && rfqId === null && (
            <div className="absolute z-30 mt-1 w-full rounded-lg border bg-popover text-popover-foreground shadow-lg">
              {searchFetching ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">{ar ? 'جارٍ البحث…' : 'Searching…'}</p>
              ) : rfqHits.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">{ar ? 'لا توجد طلبات مطابقة.' : 'No matching requests.'}</p>
              ) : (
                <ul className="max-h-72 overflow-y-auto">
                  {rfqHits.map(hit => (
                    <li key={hit.id}>
                      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-muted" onClick={() => chooseRfq({ id: hit.id, label: hit.label })}>
                        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{hit.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">#{hit.id}{hit.detail ? ` · ${hit.detail}` : ''}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        {rfqId === null && (
          <Button data-testid="investigation-lookup" onClick={() => setOpen(true)} disabled={!searchText.trim()}>
            {ar ? 'ابحث' : 'Search'}
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        {rfqId === null && (
          <p className="text-sm text-muted-foreground" data-testid="investigation-empty">
            {ar
              ? 'ابحث عن طلب لإعادة بناء ما حدث فيه: الأطراف، العروض، المرفقات، الرسائل، الإشعارات وسجل التغييرات.'
              : 'Search for a request to reconstruct what happened to it: the parties, the bids, the attachments, the messages, the notifications and the change history.'}
          </p>
        )}

        {enabled && isLoading && <p className="text-sm text-muted-foreground">…</p>}

        {enabled && error && (
          <p className="flex items-start gap-2 text-sm text-destructive" data-testid="investigation-error" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error.message}</span>
          </p>
        )}

        {enabled && data && (
          <div className="space-y-6" data-testid="investigation-result">
            {/* THE REQUEST */}
            <section className="rounded-xl border p-4" data-testid="investigation-rfq">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">#{data.rfq.id}</p>
                  <p className="text-lg font-semibold">{data.rfq.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {ar ? 'مقدَّم من' : 'Raised by'} {partyName(data.rfq.requesterId)} · {when(data.rfq.createdAt)}
                  </p>
                </div>
                <Badge data-testid="investigation-status">{data.rfq.status}</Badge>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-4 text-sm">
                <Figure testid="investigation-budget" label={ar ? 'الميزانية' : 'Budget'} value={data.commercial.budget ?? '—'} />
                <Figure testid="investigation-bidcount" label={ar ? 'عدد العروض' : 'Bids'} value={String(data.commercial.bidCount)} />
                <Figure testid="investigation-lowest" label={ar ? 'أقل عرض' : 'Lowest bid'} value={data.commercial.lowestBid ?? '—'} />
                <Figure testid="investigation-accepted" label={ar ? 'العرض المقبول' : 'Accepted'} value={data.commercial.acceptedValue ?? '—'} />
              </div>
            </section>

            <Section title={ar ? 'الأطراف' : 'The parties'} testid="investigation-parties">
              {data.parties.map(party => (
                <div key={party.id} className="flex flex-wrap items-center justify-between gap-2 border-t p-2 text-sm" data-testid="investigation-party">
                  <span>{party.name ?? party.username ?? '—'} <span className="text-muted-foreground">#{party.id}</span></span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{party.userRole}</Badge>
                    <span>{party.onboardingStatus}</span>
                    <span>{party.accountStatus}</span>
                  </span>
                </div>
              ))}
            </Section>

            <Section title={ar ? 'الطلبات المؤهلة المفتوحة' : 'Qualified enquiries opened'} testid="investigation-enquiries">
              {data.enquiries.length === 0
                ? <Empty ar={ar} />
                : data.enquiries.map(entry => (
                  <div key={entry.id} className="border-t p-2 text-sm" data-testid="investigation-enquiry">
                    {partyName(entry.userId)} · {entry.matchedCategory ?? '—'} · {entry.planAtConsumption ?? '—'} · {when(entry.createdAt)}
                  </div>
                ))}
            </Section>

            <Section title={ar ? 'العروض' : 'The bids'} testid="investigation-quotations">
              {data.quotations.length === 0
                ? <Empty ar={ar} />
                : data.quotations.map(bid => (
                  <div key={bid.id} className="border-t p-2 text-sm" data-testid="investigation-quotation">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="text-muted-foreground">#{bid.id}</span> {partyName(bid.providerId)} — <span className="font-medium" data-testid="investigation-quotation-price">{bid.price}</span> {bid.currency ?? ''}
                      </span>
                      <Badge variant={bid.status === 'accepted' ? 'default' : 'secondary'}>{bid.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {when(bid.createdAt)}
                      {bid.timeline ? ` · ${bid.timeline} ${ar ? 'يوم' : 'days'}` : ''}
                      {bid.attachments ? ` · ${ar ? 'مرفقات' : 'attachments'}` : ''}
                    </p>
                  </div>
                ))}
            </Section>

            {/* OLD -> NEW. The reason this page exists at all. */}
            <Section title={ar ? 'ما الذي تغيّر' : 'What changed'} testid="investigation-history">
              {[...data.history.rfq.map(h => ({ ...h, subject: `RFQ #${h.subjectId}` })),
                ...data.history.quotations.map(h => ({ ...h, subject: `${ar ? 'عرض' : 'Bid'} #${h.subjectId}` }))]
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                .map(entry => (
                  <div key={`${entry.subject}-${entry.id}`} className="border-t p-2 text-sm" data-testid="investigation-change">
                    <span className="text-muted-foreground">{entry.subject}</span> · <span className="font-medium">{entry.field}</span>:{' '}
                    <span data-testid="investigation-change-old">{entry.oldValue ?? '—'}</span> → <span className="font-medium" data-testid="investigation-change-new">{entry.newValue ?? '—'}</span>
                    <span className="text-muted-foreground"> · {partyName(entry.actorId)} · {when(entry.createdAt)}</span>
                    {entry.reason && <span className="text-muted-foreground"> · {entry.reason}</span>}
                  </div>
                ))}
              {data.history.rfq.length + data.history.quotations.length === 0 && <Empty ar={ar} />}
            </Section>

            <Section title={ar ? 'سجل الأحداث' : 'Audit trail'} testid="investigation-audit">
              {data.audit.length === 0
                ? <Empty ar={ar} />
                : data.audit.map(event => (
                  <div key={event.id} className="border-t p-2 text-sm" data-testid="investigation-audit-row">
                    <span className="font-medium">{event.action}</span>
                    <span className="text-muted-foreground"> · {event.subjectType} #{event.subjectId} · {partyName(event.actorId)} · {when(event.createdAt)}</span>
                    {event.detail && <span className="text-muted-foreground"> · {event.detail}</span>}
                  </div>
                ))}
            </Section>

            <Section title={ar ? 'الرسائل بين الأطراف' : 'Messages between the parties'} testid="investigation-messages">
              {data.messages.length === 0
                ? <Empty ar={ar} />
                : data.messages.map(message => (
                  <div key={message.id} className="border-t p-2 text-sm" data-testid="investigation-message">
                    <span className="text-muted-foreground">{partyName(message.senderId)} → {partyName(message.receiverId)} · {when(message.createdAt)}</span>
                    <p className="mt-1">{message.content}</p>
                  </div>
                ))}
            </Section>

            <Section title={ar ? 'الإشعارات ووجهتها' : 'Notifications, and where they pointed'} testid="investigation-notifications">
              {data.notifications.length === 0
                ? <Empty ar={ar} />
                : data.notifications.map(notification => (
                  <div key={notification.id} className="flex flex-wrap items-center justify-between gap-2 border-t p-2 text-sm" data-testid="investigation-notification">
                    <span>{partyName(notification.userId)} · <span className="text-muted-foreground">{notification.messageKey ?? notification.type}</span></span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <code data-testid="investigation-notification-link">{notification.link ?? '—'}</code>
                      <Badge variant={notification.read ? 'secondary' : 'outline'}>
                        {notification.read ? (ar ? 'مقروء' : 'read') : (ar ? 'غير مقروء' : 'unread')}
                      </Badge>
                    </span>
                  </div>
                ))}
            </Section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, testid, children }: { title: string; testid: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border" data-testid={testid}>
      <p className="p-3 text-sm font-medium">{title}</p>
      <div>{children}</div>
    </section>
  );
}

function Empty({ ar }: { ar: boolean }) {
  return <p className="border-t p-2 text-sm text-muted-foreground">{ar ? 'لا شيء' : 'None'}</p>;
}

function Figure({ testid, label, value }: { testid: string; label: string; value: string }) {
  return (
    <div data-testid={testid}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold" data-testid={`${testid}-value`}>{value}</p>
    </div>
  );
}
