import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Link } from 'wouter';
import { Gauge, History, AlertTriangle, Search, Building2, BadgeCheck } from 'lucide-react';

type VendorHit = {
  id: number;
  name: string;
  email: string | null;
  userRole: string | null;
  location: string | null;
  verified: boolean | null;
  accountStatus: string | null;
  companyName: string | null;
  tradingName: string | null;
};

/**
 * THE QUALIFIED-ENQUIRY ALLOWANCE, LOOKED UP BY BUSINESS IDENTITY.
 *
 * The administrator works with names, companies and emails - not a remembered
 * database id. The search is server-authorised, debounced, and returns a
 * bounded provider allowlist (no credential column).
 */
export default function AdminEnquiryAllowance() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [searchText, setSearchText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<VendorHit | null>(null);
  const [open, setOpen] = useState(false);
  const [limitDraft, setLimitDraft] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(searchText.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchText]);

  const enabled = selected !== null;
  const { data: results = [] } = trpc.admin.vendorSearch.useQuery(
    { query: debounced },
    { enabled: debounced.length >= 2 },
  );
  const { data, refetch, isLoading } = trpc.admin.vendorEnquiryAllowance.useQuery(
    { userId: selected?.id ?? 0 },
    { enabled },
  );

  const save = trpc.admin.setVendorEnquiryLimit.useMutation({
    onSuccess: result => {
      setError('');
      setSaved(ar
        ? `تم التغيير من ${result.previous ?? 'حد الباقة'} إلى ${result.limit ?? 'غير محدود'}`
        : `Changed from ${result.previous ?? 'the plan default'} to ${result.limit ?? 'unlimited'}`);
      void refetch();
    },
    onError: mutationError => { setSaved(''); setError(mutationError.message); },
  });

  const select = (vendor: VendorHit) => {
    setSelected(vendor);
    setSearchText('');
    setOpen(false);
    setError('');
    setSaved('');
    setLimitDraft('');
    setReason('');
  };

  const submit = () => {
    if (selected === null) return;
    const raw = limitDraft.trim();
    setSaved(''); setError('');
    save.mutate({
      userId: selected.id,
      limit: raw === '' ? null : Number(raw),
      reason: reason.trim() || undefined,
    });
  };

  const number = (value: number | null | undefined, unlimited: string) =>
    value === null || value === undefined ? unlimited : String(value);

  return (
    <Card data-testid="admin-enquiry-allowance">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="h-5 w-5" />
          {ar ? 'حد الطلبات المؤهلة' : 'Qualified enquiry allowance'}
        </CardTitle>

        <div className="relative pt-3" ref={boxRef}>
          <div className="relative w-full sm:max-w-md">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="allowance-search"
              className="ps-9"
              placeholder={ar ? 'ابحث عن مورّد بالاسم أو الشركة أو البريد…' : 'Search a vendor by name, company or email…'}
              value={searchText}
              onChange={e => { setSearchText(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
              aria-label={ar ? 'ابحث عن مورّد' : 'Search for a vendor'}
            />
          </div>

          {open && debounced.length >= 2 && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border bg-popover text-popover-foreground shadow-lg sm:max-w-md">
              {results.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground" data-testid="allowance-search-empty">
                  {ar ? 'لا يوجد مورّدون مطابقون.' : 'No matching vendors.'}
                </p>
              ) : (
                <ul className="max-h-72 overflow-y-auto" data-testid="allowance-search-results">
                  {results.map(vendor => (
                    <li key={vendor.id}>
                      <button
                        type="button"
                        className="flex w-full items-start gap-2 px-3 py-2 text-start hover:bg-muted"
                        data-testid={`allowance-result-${vendor.id}`}
                        onClick={() => select(vendor)}
                      >
                        <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1 font-medium">
                            {vendor.companyName || vendor.name}
                            {vendor.verified && <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" />}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {vendor.userRole ?? ''}{vendor.email ? ` · ${vendor.email}` : ''}{vendor.location ? ` · ${vendor.location}` : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {selected && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Badge variant="secondary">{selected.companyName || selected.name}</Badge>
            <Badge variant="outline">{selected.userRole}</Badge>
            {selected.verified && <Badge variant="outline" className="text-emerald-700">{ar ? 'موثّق' : 'Verified'}</Badge>}
            <Link href={`/vendor/${selected.id}`}>
              <Button size="sm" variant="link" className="h-8 p-0" data-testid="allowance-view-vendor">
                {ar ? 'عرض المورّد' : 'View vendor'}
              </Button>
            </Link>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        {selected === null && (
          <p className="text-sm text-muted-foreground" data-testid="allowance-empty">
            {ar
              ? 'ابحث عن مورّد لعرض حده الشهري وما استُهلك منه.'
              : 'Search for a vendor to see their monthly allowance and what has been used.'}
          </p>
        )}

        {enabled && isLoading && <p className="text-sm text-muted-foreground">…</p>}

        {enabled && data && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Figure testid="allowance-plan" label={ar ? 'حد الباقة' : 'Plan allowance'}
                value={number(data.planAllowance, ar ? 'غير محدود' : 'Unlimited')} note={data.planId} />
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
                  <label className="mb-1 block text-xs text-muted-foreground" htmlFor="allowance-limit-input">
                    {ar ? 'الحد الجديد' : 'New allowance'}
                  </label>
                  <Input
                    id="allowance-limit-input" data-testid="allowance-limit-input" inputMode="numeric"
                    placeholder={ar ? 'غير محدود' : 'Unlimited'} value={limitDraft}
                    onChange={e => setLimitDraft(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
                <div className="w-full flex-1 sm:min-w-48">
                  <label className="mb-1 block text-xs text-muted-foreground" htmlFor="allowance-reason-input">
                    {ar ? 'السبب (يُسجَّل)' : 'Reason (recorded)'}
                  </label>
                  <Input
                    id="allowance-reason-input" data-testid="allowance-reason-input"
                    value={reason} onChange={e => setReason(e.target.value)}
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
                      <tr>
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
                        <tr key={entry.id} className="border-t">
                          <td className="p-2">{entry.previousValue === null ? (ar ? 'حد الباقة' : 'Plan default') : entry.previousValue}</td>
                          <td className="p-2 font-medium">{entry.value === null ? (ar ? 'غير محدود' : 'Unlimited') : entry.value}</td>
                          <td className="p-2 text-muted-foreground">{entry.reason || '—'}</td>
                          <td className="p-2 text-muted-foreground">{entry.actorId ?? '—'}</td>
                          <td className="p-2 text-muted-foreground">{new Date(entry.createdAt).toLocaleString(ar ? 'ar-EG' : 'en-US')}</td>
                          <td className="p-2">
                            <Badge variant={entry.revokedAt ? 'secondary' : 'default'}>
                              {entry.revokedAt ? (ar ? 'مستبدل' : 'Superseded') : (ar ? 'ساري' : 'In force')}
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
