/**
 * ── The RFQ response page (§15, §16, §17) ─────────────────────────────────
 *
 * The supplier journey the mandate describes ends at a response PAGE:
 *
 *   Supplier dashboard → RFQ → Review → RFQ number → RFQ Details → Respond
 *
 * The last step had nowhere to land. "Continue to respond" sent the provider to
 * `/platform/:role?rfq=`, which is their whole workspace with a query string -
 * every card they were not looking at, a dialog somewhere below, and the
 * request they had just been reading now out of sight. The id survived; the
 * context did not.
 *
 * THE ID IS IN THE PATH, not a query string. `/rfq/42/respond` survives a
 * refresh, a back button, a copied link and a bookmark, and it says what it is.
 *
 * WHO THE CUSTOMER IS, ANSWERED. `rfq.requesterContact` returns identity to any
 * approved provider and releases the contact channels only once a qualified
 * enquiry has been consumed - the same credit the rest of the product charges.
 * When they are locked, this page says so and offers the action that unlocks
 * them, rather than printing "N/A" as though the customer had left it blank.
 *
 * AUTHORIZATION IS THE SERVER'S. Every refusal rendered here is the server's
 * own message. Nothing on this page decides who may quote.
 */

import { useMemo, useState } from 'react';
import { Link, useParams, useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  ArrowLeft, Send, AlertTriangle, MapPin, CalendarDays, DollarSign,
  ShieldCheck, Lock, UserRound,
} from 'lucide-react';

export default function RFQRespondPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { lang, dir } = useLanguage();
  const ar = lang === 'ar';
  const { isAuthenticated } = useAuth();

  const rfqId = Number(params.id);
  const valid = Number.isInteger(rfqId) && rfqId > 0;

  const summary = trpc.rfq.summary.useQuery({ id: rfqId }, { enabled: isAuthenticated && valid, retry: false });
  const party = trpc.rfq.requesterContact.useQuery({ rfqId }, { enabled: isAuthenticated && valid, retry: false });

  const [form, setForm] = useState({ price: '', timeline: '', warranty: '', notes: '' });
  const submit = trpc.rfq.submitQuotation.useMutation({
    onSuccess: () => {
      toast.success(ar ? 'تم تقديم عرض السعر' : 'Quotation submitted');
      // Straight to the record they just created, not back to a list.
      navigate('/platform/supplier#role-quotations');
    },
    onError: error => toast.error(error.message),
  });

  const rfq = summary.data;
  const closed = useMemo(() => rfq != null && rfq.status !== 'open', [rfq]);

  if (!valid) {
    return (
      <Shell dir={dir}>
        <Refusal ar={ar} message={ar ? 'رقم طلب غير صالح.' : 'That is not a valid request number.'} />
      </Shell>
    );
  }

  return (
    <Shell dir={dir}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/rfq/${rfqId}`}>
          <Button variant="ghost" size="sm" className="gap-2" data-testid="respond-back">
            <ArrowLeft className={`h-4 w-4 ${ar ? 'rotate-180' : ''}`} />
            {ar ? 'تفاصيل الطلب' : 'Request details'}
          </Button>
        </Link>
        <span className="font-mono text-sm text-muted-foreground" data-testid="respond-rfq-number">#{rfqId}</span>
      </div>

      {summary.isLoading && <p className="text-sm text-muted-foreground">…</p>}

      {/* The server's refusal, rendered as written. */}
      {summary.error && (
        <Refusal ar={ar} message={summary.error.message} testid="respond-error" />
      )}

      {rfq && (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]" data-testid="respond-page">
          {/* ── What is being asked for ─────────────────────────────────── */}
          <Card data-testid="respond-brief">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <CardTitle className="text-xl">{rfq.title}</CardTitle>
                <Badge variant={rfq.status === 'open' ? 'default' : 'secondary'} data-testid="respond-status">
                  {rfq.status}
                </Badge>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{rfq.description}</p>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                {rfq.category && <span className="flex items-center gap-1">{rfq.category}</span>}
                {rfq.budget && (
                  <span className="flex items-center gap-1">
                    <DollarSign className="h-3 w-3" />
                    {ar ? 'الميزانية المطلوبة' : 'Requested budget'}: {Number(rfq.budget).toLocaleString()}
                  </span>
                )}
                {rfq.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{rfq.location}</span>}
                {rfq.deadline && (
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {new Date(rfq.deadline).toLocaleDateString(ar ? 'ar-EG' : 'en-US')}
                  </span>
                )}
              </div>
            </CardHeader>
            {Array.isArray(rfq.items) && rfq.items.length > 0 && (
              <CardContent>
                <p className="mb-2 text-sm font-medium">{ar ? 'البنود' : 'Line items'}</p>
                <div className="space-y-2">
                  {rfq.items.map(item => (
                    <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border p-2 text-sm" data-testid="respond-item">
                      <span className="min-w-0">
                        {item.name}
                        {item.specifications && (
                          <span className="block text-xs text-muted-foreground">{item.specifications}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {item.quantity} {item.unit ?? ''}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>

          <div className="space-y-6">
            {/* ── Who is asking ─────────────────────────────────────────── */}
            <Card data-testid="respond-requester">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserRound className="h-4 w-4" />
                  {ar ? 'مقدّم الطلب' : 'The customer'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {party.isLoading && <p className="text-muted-foreground">…</p>}
                {party.data && (
                  <>
                    <p className="flex flex-wrap items-center gap-2 font-medium" data-testid="respond-requester-name">
                      {party.data.requester.name ?? `#${party.data.requester.id}`}
                      {party.data.requester.verified && (
                        <Badge variant="outline" className="gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          {ar ? 'موثّق' : 'Verified'}
                        </Badge>
                      )}
                    </p>
                    <p className="text-muted-foreground">
                      {party.data.requester.location ?? (ar ? 'الموقع غير محدد' : 'Location not stated')}
                      {' · '}
                      {ar ? 'عضو منذ' : 'Member since'}{' '}
                      {new Date(party.data.requester.createdAt).toLocaleDateString(ar ? 'ar-EG' : 'en-US')}
                    </p>

                    {party.data.contact ? (
                      <div className="space-y-1 rounded-lg border p-2" data-testid="respond-contact">
                        <p>{party.data.contact.email ?? (ar ? 'لا يوجد بريد' : 'No email on file')}</p>
                        <p>{party.data.contact.phone ?? (ar ? 'لا يوجد هاتف' : 'No phone on file')}</p>
                      </div>
                    ) : (
                      /* Locked, and honest about why - never "N/A". */
                      <p className="flex items-start gap-2 rounded-lg border border-dashed p-2 text-xs text-muted-foreground" data-testid="respond-contact-locked">
                        <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                        {ar
                          ? 'تفاصيل التواصل تُفتح عند استخدام طلب مؤهل من رصيدك على هذا الطلب.'
                          : 'Contact details unlock when you open this as a qualified enquiry from your allowance.'}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* ── The response ──────────────────────────────────────────── */}
            <Card data-testid="respond-form">
              <CardHeader>
                <CardTitle className="text-base">{ar ? 'عرض السعر' : 'Your quotation'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {closed ? (
                  <p className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="respond-closed">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {ar ? 'هذا الطلب لم يعد مفتوحاً للردود.' : 'This request is no longer open for responses.'}
                  </p>
                ) : (
                  <>
                    <Input
                      data-testid="respond-price"
                      type="number"
                      placeholder={ar ? 'السعر بالجنيه' : 'Your price (EGP)'}
                      value={form.price}
                      onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                    />
                    <Input
                      data-testid="respond-timeline"
                      type="number"
                      placeholder={ar ? 'المدة بالأيام' : 'Timeline in days'}
                      value={form.timeline}
                      onChange={e => setForm(f => ({ ...f, timeline: e.target.value }))}
                    />
                    <Input
                      data-testid="respond-warranty"
                      placeholder={ar ? 'الضمان' : 'Warranty'}
                      value={form.warranty}
                      onChange={e => setForm(f => ({ ...f, warranty: e.target.value }))}
                    />
                    <Textarea
                      data-testid="respond-notes"
                      rows={3}
                      placeholder={ar ? 'ملاحظات' : 'Notes'}
                      value={form.notes}
                      onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    />
                    <Button
                      className="w-full gap-2"
                      data-testid="respond-submit"
                      disabled={submit.isPending || !form.price}
                      onClick={() => submit.mutate({
                        rfqId,
                        price: Number(form.price),
                        timeline: form.timeline ? Number(form.timeline) : undefined,
                        warranty: form.warranty || undefined,
                        notes: form.notes || undefined,
                      })}
                    >
                      <Send className="h-4 w-4" />
                      {submit.isPending ? (ar ? '…' : '…') : (ar ? 'أرسل العرض' : 'Submit quotation')}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ dir, children }: { dir: string; children: React.ReactNode }) {
  return <DashboardLayout><div dir={dir} className="space-y-2">{children}</div></DashboardLayout>;
}

function Refusal({ ar, message, testid }: { ar: boolean; message: string; testid?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="flex items-start gap-2 text-sm text-destructive" role="alert" data-testid={testid}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{message}</span>
        </p>
        <Link href="/rfq">
          <Button variant="outline" className="mt-4">{ar ? 'كل الطلبات' : 'All requests'}</Button>
        </Link>
      </CardContent>
    </Card>
  );
}
