/**
 * ── The qualified-enquiry allowance, as an administrator works with it ─────
 *
 * Part 45 requires a Super Admin to be able to VIEW the limit, the usage and
 * the remainder, to SET it up or down, and to READ ITS HISTORY. Before this
 * there was no per-vendor limit at all, so there was nothing to show.
 *
 * THE READ IS billing.read AND THE WRITE IS SUPER ADMIN. This component does
 * not decide that - the server does, and a Billing Admin who opens this panel
 * sees the numbers and gets a refusal if they try to save. The form is shown
 * to them anyway rather than hidden, because hiding a control is not a
 * permission and pretending otherwise teaches the wrong lesson about where
 * authorization lives. The refusal it renders is the server's own.
 *
 * THE REFUSAL WORTH READING CAREFULLY: setting a limit below what the vendor
 * has already consumed this month is rejected, and the message names the
 * usage. That is the owner's decision, taken explicitly - an administrator
 * cannot create an over-consumed state, and nothing already consumed is
 * revoked, refunded or renumbered.
 */

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Gauge, History, AlertTriangle } from 'lucide-react';

export default function AdminEnquiryAllowance() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [draft, setDraft] = useState('');
  const [userId, setUserId] = useState<number | null>(null);
  const [limitDraft, setLimitDraft] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const enabled = userId !== null;
  const { data, refetch, isLoading } = trpc.admin.vendorEnquiryAllowance.useQuery(
    { userId: userId ?? 0 }, { enabled },
  );

  const save = trpc.admin.setVendorEnquiryLimit.useMutation({
    onSuccess: result => {
      setError('');
      setSaved(ar
        ? `تم التغيير من ${result.previous ?? 'حد الباقة'} إلى ${result.limit ?? 'غير محدود'}`
        : `Changed from ${result.previous ?? 'the plan default'} to ${result.limit ?? 'unlimited'}`);
      void refetch();
    },
    // The server's own message, rendered as written. It names the usage that
    // made a decrease impossible, which is the whole point of refusing rather
    // than silently accepting.
    onError: mutationError => { setSaved(''); setError(mutationError.message); },
  });

  const lookUp = () => {
    const parsed = Number(draft.trim());
    setError(''); setSaved('');
    setUserId(Number.isInteger(parsed) && parsed > 0 ? parsed : null);
  };

  const submit = () => {
    if (userId === null) return;
    const raw = limitDraft.trim();
    setSaved(''); setError('');
    save.mutate({
      userId,
      // An empty field means unlimited, which is a real and deliberate value
      // in this schema rather than a missing one.
      limit: raw === '' ? null : Number(raw),
      reason: reason.trim() || undefined,
    });
  };

  const number = (value: number | null | undefined, unlimited: string) =>
    value === null || value === undefined ? unlimited : String(value);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="w-5 h-5" />
          {ar ? 'حد الطلبات المؤهلة' : 'Qualified enquiry allowance'}
        </CardTitle>
        <div className="flex flex-wrap items-end gap-2 pt-3">
          <div className="w-full sm:w-56">
            <Input
              data-testid="allowance-user-input"
              inputMode="numeric"
              placeholder={ar ? 'رقم حساب المورّد' : 'Vendor account id'}
              value={draft}
              onChange={event => setDraft(event.target.value.replace(/\D/g, ''))}
              onKeyDown={event => { if (event.key === 'Enter') lookUp(); }}
              aria-label={ar ? 'رقم حساب المورّد' : 'Vendor account id'}
            />
          </div>
          <Button data-testid="allowance-lookup" onClick={lookUp} disabled={!draft.trim()}>
            {ar ? 'عرض' : 'Look up'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {userId === null && (
          <p className="text-sm text-muted-foreground" data-testid="allowance-empty">
            {ar
              ? 'أدخل رقم حساب مورّد لعرض حده الشهري وما استُهلك منه.'
              : 'Enter a vendor account id to see their monthly allowance and what has been used.'}
          </p>
        )}

        {enabled && isLoading && <p className="text-sm text-muted-foreground">…</p>}

        {enabled && data && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Figure testid="allowance-plan" label={ar ? 'حد الباقة' : 'Plan allowance'}
                value={number(data.planAllowance, ar ? 'غير محدود' : 'Unlimited')}
                note={data.planId} />
              <Figure testid="allowance-effective" label={ar ? 'الحد المطبّق' : 'Allowance in force'}
                value={number(data.effectiveAllowance, ar ? 'غير محدود' : 'Unlimited')}
                note={data.overridden ? (ar ? 'معدّل يدوياً' : 'Overridden') : (ar ? 'من الباقة' : 'From the plan')} />
              <Figure testid="allowance-used" label={ar ? 'المستهلك' : 'Used'}
                value={String(data.used)} note={data.periodKey} />
              <Figure testid="allowance-remaining" label={ar ? 'المتبقي' : 'Remaining'}
                value={number(data.remaining, ar ? 'غير محدود' : 'Unlimited')}
                note={ar ? 'لا يقل عن صفر' : 'Never below zero'} />
            </div>

            <div className="space-y-2 rounded-xl border p-4">
              <p className="text-sm font-medium">{ar ? 'تغيير الحد' : 'Change the allowance'}</p>
              <p className="text-xs text-muted-foreground">
                {ar
                  ? 'اتركه فارغاً ليصبح غير محدود. لا يمكن خفض الحد إلى أقل مما استُهلك بالفعل هذا الشهر؛ الطلبات المستهلكة لا تُلغى أبداً.'
                  : 'Leave it empty for unlimited. It cannot be set below what has already been used this month; consumed enquiries are never revoked.'}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-full sm:w-40">
                  <Input
                    data-testid="allowance-limit-input"
                    inputMode="numeric"
                    placeholder={ar ? 'الحد الجديد' : 'New limit'}
                    value={limitDraft}
                    onChange={event => setLimitDraft(event.target.value.replace(/\D/g, ''))}
                    aria-label={ar ? 'الحد الجديد' : 'New limit'}
                  />
                </div>
                <div className="w-full sm:flex-1 sm:min-w-48">
                  <Input
                    data-testid="allowance-reason-input"
                    placeholder={ar ? 'السبب (يُسجَّل)' : 'Reason (recorded)'}
                    value={reason}
                    onChange={event => setReason(event.target.value)}
                    aria-label={ar ? 'السبب' : 'Reason'}
                  />
                </div>
                <Button data-testid="allowance-save" onClick={submit} disabled={save.isPending}>
                  {ar ? 'حفظ' : 'Save'}
                </Button>
              </div>
              {error && (
                <p className="flex items-start gap-2 text-sm text-destructive" data-testid="allowance-error" role="alert">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </p>
              )}
              {saved && <p className="text-sm text-emerald-600" data-testid="allowance-saved">{saved}</p>}
            </div>

            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm font-medium">
                <History className="h-4 w-4" />
                {ar ? 'سجل التغييرات' : 'Change history'}
              </p>
              {data.history.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="allowance-history-empty">
                  {ar ? 'لم يُعدَّل هذا الحد يدوياً من قبل.' : 'This allowance has never been changed by hand.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="allowance-history">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="text-start">
                        <th className="p-2 text-start">{ar ? 'من' : 'From'}</th>
                        <th className="p-2 text-start">{ar ? 'إلى' : 'To'}</th>
                        <th className="p-2 text-start">{ar ? 'السبب' : 'Reason'}</th>
                        <th className="p-2 text-start">{ar ? 'بواسطة' : 'By'}</th>
                        <th className="p-2 text-start">{ar ? 'الوقت' : 'When'}</th>
                        <th className="p-2 text-start">{ar ? 'الحالة' : 'State'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.history.map(entry => (
                        <tr key={entry.id} className="border-t" data-testid="allowance-history-row">
                          <td className="p-2" data-testid="allowance-history-from">
                            {entry.previousValue === null ? (ar ? 'حد الباقة' : 'Plan default') : entry.previousValue}
                          </td>
                          <td className="p-2 font-medium" data-testid="allowance-history-to">
                            {entry.value === null ? (ar ? 'غير محدود' : 'Unlimited') : entry.value}
                          </td>
                          <td className="p-2 text-muted-foreground">{entry.reason || '—'}</td>
                          <td className="p-2 text-muted-foreground">{entry.actorId ?? '—'}</td>
                          <td className="p-2 text-muted-foreground">
                            {new Date(entry.createdAt).toLocaleString(ar ? 'ar-EG' : 'en-US')}
                          </td>
                          <td className="p-2">
                            <Badge variant={entry.revokedAt ? 'secondary' : 'default'}>
                              {entry.revokedAt
                                ? (ar ? 'مستبدل' : 'Superseded')
                                : (ar ? 'ساري' : 'In force')}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Figure({ testid, label, value, note }: { testid: string; label: string; value: string; note?: string | null }) {
  return (
    <div className="rounded-xl border p-3" data-testid={testid}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold" data-testid={`${testid}-value`}>{value}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
