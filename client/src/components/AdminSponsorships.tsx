import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Megaphone } from 'lucide-react';

/**
 * SPONSORED PLACEMENT, AS AN ADMINISTRATIVE ACT.
 *
 * BuildHub already had one route to a sponsored slot - a Premium plan buys
 * rotating placement - and that stays. This is the second, approved route: an
 * administrator grants a named vendor a slot in a named category, for a
 * period, with a reason.
 *
 * IT ANSWERS THE WHOLE QUESTION, which is why the table shows revoked and
 * elapsed grants rather than only live ones: "which vendors are sponsored, in
 * which category, for what period, and by what action" includes the ones that
 * have ended. `live` says which is which, so the reader is not inferring it
 * from dates.
 *
 * Nothing here is invented. Every row is a real grant somebody made; a
 * category with no sponsors shows nothing rather than filler.
 */
export default function AdminSponsorships() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();
  const { data: rows = [], isLoading } = trpc.admin.sponsorships.useQuery(undefined, { retry: false });
  const { data: categories = [] } = trpc.marketplace.vendorCategories.useQuery();

  const [vendorId, setVendorId] = useState('');
  const [category, setCategory] = useState('');
  const [reason, setReason] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [indefinite, setIndefinite] = useState(true);
  const [priority, setPriority] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refresh = () => {
    void utils.admin.sponsorships.invalidate();
    void utils.marketplace.sponsoredVendors.invalidate();
  };

  const grant = trpc.admin.grantSponsorship.useMutation({
    onSuccess: () => {
      setError(''); setReason(''); setVendorId('');
      setNotice(ar ? 'تم منح الرعاية.' : 'Sponsorship granted.');
      refresh();
    },
    // The server's own refusal, rendered as written: it names the rule that
    // refused - an unapproved provider, an overlapping grant, a backwards date.
    onError: e => { setNotice(''); setError(e.message); },
  });

  const revoke = trpc.admin.revokeSponsorship.useMutation({
    onSuccess: () => {
      setError('');
      setNotice(ar ? 'تم إلغاء الرعاية.' : 'Sponsorship revoked.');
      refresh();
    },
    onError: e => { setNotice(''); setError(e.message); },
  });

  const date = (v: unknown) => v ? new Date(v as string).toLocaleDateString(ar ? 'ar-EG' : 'en-US') : '—';

  return (
    <Card data-testid="admin-sponsorships">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="w-5 h-5" />
          {ar ? 'الرعاية في دليل الموردين' : 'Sponsored placement'}
        </CardTitle>
        <p className="pt-1 text-xs text-muted-foreground">
          {ar
            ? 'الرعاية تمنح مساحة معلَّمة في فئة خدمة واحدة. لا تمنح توثيقاً ولا تقييماً ولا ترتيباً أفضل في القائمة الطبيعية.'
            : 'A sponsorship buys a labelled slot in one service category. It does not buy verification, a rating, or a better position in the organic list.'}
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ── Granting ─────────────────────────────────────────────────── */}
        <div className="grid gap-2 sm:grid-cols-5 items-end">
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="sponsor-vendor">
              {ar ? 'رقم المورّد' : 'Vendor id'}
            </label>
            <Input
              id="sponsor-vendor" data-testid="sponsor-vendor" inputMode="numeric" className="mt-1 h-9"
              value={vendorId} onChange={e => setVendorId(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="sponsor-category">
              {ar ? 'الفئة' : 'Category'}
            </label>
            <select
              id="sponsor-category" data-testid="sponsor-category"
              className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={category} onChange={e => setCategory(e.target.value)}
            >
              <option value="">{ar ? 'اختر فئة' : 'Select a category'}</option>
              {categories.map(c => <option key={String(c)} value={String(c)}>{String(c)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="sponsor-starts">
              {ar ? 'يبدأ من' : 'From'}
            </label>
            <Input
              id="sponsor-starts" data-testid="sponsor-starts" type="date" className="mt-1 h-9"
              value={startsAt} onChange={e => setStartsAt(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="sponsor-priority">
              {ar ? 'الأولوية' : 'Priority'}
            </label>
            <Input
              id="sponsor-priority" data-testid="sponsor-priority" inputMode="numeric" className="mt-1 h-9"
              value={priority} onChange={e => setPriority(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="sponsor-ends">
              {ar ? 'حتى' : 'Until'}
            </label>
            <Input
              id="sponsor-ends" data-testid="sponsor-ends" type="date" className="mt-1 h-9"
              value={endsAt} disabled={indefinite} onChange={e => setEndsAt(e.target.value)}
            />
          </div>
          <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={indefinite} onChange={e => setIndefinite(e.target.checked)} />
            {ar ? 'بدون نهاية' : 'Indefinite'}
          </label>
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground" htmlFor="sponsor-reason">
              {ar ? 'السبب (مطلوب)' : 'Reason (required)'}
            </label>
            <Input
              id="sponsor-reason" data-testid="sponsor-reason" className="mt-1 h-9" maxLength={500}
              value={reason} onChange={e => setReason(e.target.value)}
            />
          </div>
        </div>

        <Button
          size="sm" data-testid="sponsor-grant"
          disabled={!vendorId || !category || reason.trim() === '' || grant.isPending}
          onClick={() => {
            setNotice(''); setError('');
            if (startsAt && !indefinite && endsAt && endsAt <= startsAt) {
              setError(ar ? 'يجب أن يكون تاريخ النهاية بعد تاريخ البداية.' : 'The end date must be after the start date.');
              return;
            }
            grant.mutate({
              vendorId: Number(vendorId),
              category,
              reason: reason.trim(),
              priority: priority ? Number(priority) : undefined,
              startsAt: startsAt ? new Date(`${startsAt}T00:00:00Z`).toISOString() : undefined,
              // A date input gives a day; the grant runs to the END of it, so
              // a sponsorship "until the 30th" includes the 30th.
              endsAt: !indefinite && endsAt ? new Date(`${endsAt}T23:59:59Z`).toISOString() : undefined,
            });
          }}
        >
          {ar ? 'منح الرعاية' : 'Grant sponsorship'}
        </Button>

        {notice && <p className="text-sm text-emerald-700" data-testid="sponsor-notice">{notice}</p>}
        {error && <p className="text-sm text-destructive" data-testid="sponsor-error">{error}</p>}

        {/* ── The record ───────────────────────────────────────────────── */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{ar ? 'جاري التحميل…' : 'Loading…'}</p>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground"
             data-testid="sponsor-empty">
            {ar ? 'لا توجد رعايات مسجّلة.' : 'No sponsorships recorded.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm" data-testid="sponsor-table">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-start py-2 px-3 font-medium text-muted-foreground">{ar ? 'المورّد' : 'Vendor'}</th>
                  <th className="text-start py-2 px-3 font-medium text-muted-foreground">{ar ? 'الفئة' : 'Category'}</th>
                  <th className="text-start py-2 px-3 font-medium text-muted-foreground">{ar ? 'الفترة' : 'Period'}</th>
                  <th className="text-start py-2 px-3 font-medium text-muted-foreground">{ar ? 'السبب' : 'Reason'}</th>
                  <th className="text-start py-2 px-3 font-medium text-muted-foreground">{ar ? 'الحالة' : 'Status'}</th>
                  <th className="text-start py-2 px-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-2 px-3">
                      {String(row.vendorName ?? '—')}
                      <span className="text-muted-foreground"> #{row.vendorId}</span>
                    </td>
                    <td className="py-2 px-3">{row.category}</td>
                    <td className="py-2 px-3 text-muted-foreground">
                      {date(row.startsAt)} → {row.endsAt ? date(row.endsAt) : (ar ? 'مفتوحة' : 'open-ended')}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">{String(row.grantedReason ?? '—')}</td>
                    <td className="py-2 px-3">
                      <Badge variant={row.live ? 'default' : 'outline'} className="text-[10px]">
                        {row.revokedAt
                          ? (ar ? 'ملغاة' : 'Revoked')
                          : row.live
                            ? (ar ? 'فعّالة' : 'Live')
                            : (ar ? 'منتهية' : 'Not live')}
                      </Badge>
                    </td>
                    <td className="py-2 px-3">
                      {/* Offered only where it would do something. A revoked
                          grant keeps its row for the audit, but the button
                          would be a control that cannot act. */}
                      {!row.revokedAt && (
                        <Button
                          size="sm" variant="outline"
                          data-testid={`sponsor-revoke-${row.id}`}
                          disabled={revoke.isPending}
                          onClick={() => { setNotice(''); setError(''); revoke.mutate({ sponsorshipId: Number(row.id) }); }}
                        >
                          {ar ? 'إلغاء' : 'Revoke'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
