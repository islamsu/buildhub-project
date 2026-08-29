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

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, AlertTriangle } from 'lucide-react';

export default function AdminRfqInvestigation() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [draft, setDraft] = useState('');
  const [rfqId, setRfqId] = useState<number | null>(null);

  const enabled = rfqId !== null;
  const { data, isLoading, error } = trpc.admin.rfqInvestigation.useQuery(
    { rfqId: rfqId ?? 0 }, { enabled, retry: false },
  );

  const when = (value: string | Date | null | undefined) =>
    value ? new Date(value).toLocaleString(ar ? 'ar-EG' : 'en-US') : '—';
  const partyName = (id: number | null | undefined) => {
    if (id === null || id === undefined) return '—';
    const party = data?.parties.find(p => p.id === id);
    return party ? `${party.name ?? party.username ?? '—'} (#${id})` : `#${id}`;
  };

  const lookUp = () => {
    const parsed = Number(draft.trim());
    setRfqId(Number.isInteger(parsed) && parsed > 0 ? parsed : null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="w-5 h-5" />
          {ar ? 'تحقيق في طلب' : 'Request investigation'}
        </CardTitle>
        <div className="flex flex-wrap items-end gap-2 pt-3">
          <div className="w-full sm:w-56">
            <Input
              data-testid="investigation-rfq-input"
              inputMode="numeric"
              placeholder={ar ? 'رقم الطلب' : 'Request id'}
              value={draft}
              onChange={event => setDraft(event.target.value.replace(/\D/g, ''))}
              onKeyDown={event => { if (event.key === 'Enter') lookUp(); }}
              aria-label={ar ? 'رقم الطلب' : 'Request id'}
            />
          </div>
          <Button data-testid="investigation-lookup" onClick={lookUp} disabled={!draft.trim()}>
            {ar ? 'افتح' : 'Open'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {rfqId === null && (
          <p className="text-sm text-muted-foreground" data-testid="investigation-empty">
            {ar
              ? 'أدخل رقم طلب لإعادة بناء ما حدث فيه: الأطراف، العروض، المرفقات، الرسائل، الإشعارات وسجل التغييرات.'
              : 'Enter a request id to reconstruct what happened to it: the parties, the bids, the attachments, the messages, the notifications and the change history.'}
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
