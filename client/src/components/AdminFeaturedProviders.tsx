import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Star } from 'lucide-react';
import VendorIdentitySelect from '@/components/VendorIdentitySelect';
import { Link } from 'wouter';

/**
 * EDITORIAL FEATURED PROVIDERS, AS AN ADMIN ACT.
 *
 * Featured is platform curation, not paid placement (that is sponsorship, and
 * it stays a separate labelled surface). An administrator names a provider and
 * a service category; the marketplace then showcases that provider in that
 * category. Every row is a real account the directory itself would list.
 */
export default function AdminFeaturedProviders() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();
  const { data: rows = [], isLoading } = trpc.admin.featuredProviders.useQuery(undefined, { retry: false });
  const { data: categories = [] } = trpc.marketplace.vendorCategories.useQuery();

  const [vendorId, setVendorId] = useState<number | null>(null);
  const [category, setCategory] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [indefinite, setIndefinite] = useState(true);
  const [priority, setPriority] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refresh = () => {
    void utils.admin.featuredProviders.invalidate();
    void utils.marketplace.featuredProviders.invalidate();
  };

  const feature = trpc.admin.featureVendor.useMutation({
    onSuccess: () => {
      setError(''); setVendorId(null);
      setNotice(ar ? 'تم تمييز المزوّد.' : 'Provider featured.');
      refresh();
    },
    onError: e => { setNotice(''); setError(e.message); },
  });

  const unfeature = trpc.admin.unfeatureVendor.useMutation({
    onSuccess: () => {
      setError('');
      setNotice(ar ? 'تم إلغاء التمييز.' : 'Provider unfeatured.');
      refresh();
    },
    onError: e => { setNotice(''); setError(e.message); },
  });

  const date = (v: unknown) => v ? new Date(v as string).toLocaleDateString(ar ? 'ar-EG' : 'en-US') : '—';
  const statusLabel = (row: { startsAt: Date | string; endsAt: Date | string | null; revokedAt: Date | string | null; live: boolean }) => {
    if (row.revokedAt) return ar ? 'ملغى' : 'Removed';
    const start = new Date(row.startsAt).getTime();
    const now = Date.now();
    if (start > now) return ar ? 'مجدول' : 'Scheduled';
    if (row.endsAt && new Date(row.endsAt).getTime() <= now) return ar ? 'منتهي' : 'Expired';
    return ar ? 'فعّال' : 'Active';
  };

  return (
    <Card data-testid="admin-featured-providers">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Star className="h-5 w-5" />
          {ar ? 'المزوّدون المميزون' : 'Featured providers'}
        </CardTitle>
        <p className="pt-1 text-xs text-muted-foreground">
          {ar
            ? 'التمييز هو تنسيق تحريري، وليس إعلاناً مدفوعاً. يمنح مساحة مميزة في فئة خدمة واحدة دون تغيير ملكية المزوّد أو ترتيبه الطبيعي.'
            : 'Featured is editorial curation, not paid placement. It grants a showcase slot in one service category and never changes ownership or organic ranking.'}
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-4 items-end">
          <div>
            <VendorIdentitySelect
              value={vendorId}
              onChange={setVendorId}
              label={ar ? 'المزوّد' : 'Provider'}
              testId="feature-vendor"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="feature-category">
              {ar ? 'الفئة' : 'Category'}
            </label>
            <select
              id="feature-category" data-testid="feature-category"
              className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={category} onChange={e => setCategory(e.target.value)}
            >
              <option value="">{ar ? 'اختر فئة' : 'Select a category'}</option>
              {categories.map(c => <option key={String(c)} value={String(c)}>{String(c)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="feature-starts">
              {ar ? 'يبدأ من' : 'From'}
            </label>
            <Input
              id="feature-starts" data-testid="feature-starts" type="date" className="mt-1 h-9"
              value={startsAt} onChange={e => setStartsAt(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="feature-priority">
              {ar ? 'الأولوية' : 'Priority'}
            </label>
            <Input
              id="feature-priority" data-testid="feature-priority" inputMode="numeric" className="mt-1 h-9"
              value={priority} onChange={e => setPriority(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="feature-ends">
              {ar ? 'حتى' : 'Until'}
            </label>
            <Input
              id="feature-ends" data-testid="feature-ends" type="date" className="mt-1 h-9"
              value={endsAt} disabled={indefinite} onChange={e => setEndsAt(e.target.value)}
            />
          </div>
          <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={indefinite} onChange={e => setIndefinite(e.target.checked)} />
            {ar ? 'بدون نهاية' : 'Indefinite'}
          </label>
          <Button
            size="sm" data-testid="feature-grant"
            disabled={!vendorId || !category || feature.isPending}
            onClick={() => {
              setNotice(''); setError('');
              if (startsAt && !indefinite && endsAt && endsAt <= startsAt) {
                setError(ar ? 'يجب أن يكون تاريخ النهاية بعد تاريخ البداية.' : 'The end date must be after the start date.');
                return;
              }
              feature.mutate({
                vendorId: vendorId!,
                category,
                priority: priority ? Number(priority) : undefined,
                startsAt: startsAt ? new Date(`${startsAt}T00:00:00Z`).toISOString() : undefined,
                endsAt: !indefinite && endsAt ? new Date(`${endsAt}T23:59:59Z`).toISOString() : undefined,
              });
            }}
          >
            {ar ? 'تمييز' : 'Feature'}
          </Button>
        </div>

        {notice && <p className="text-sm text-emerald-700" data-testid="feature-notice">{notice}</p>}
        {error && <p className="text-sm text-destructive" data-testid="feature-error">{error}</p>}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{ar ? 'جاري التحميل…' : 'Loading…'}</p>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground" data-testid="feature-empty">
            {ar ? 'لا يوجد مزوّدون مميزون.' : 'No featured providers.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm" data-testid="feature-table">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-3 py-2 text-start font-medium text-muted-foreground">{ar ? 'المزوّد' : 'Provider'}</th>
                  <th className="px-3 py-2 text-start font-medium text-muted-foreground">{ar ? 'الفئة' : 'Category'}</th>
                  <th className="px-3 py-2 text-start font-medium text-muted-foreground">{ar ? 'الفترة' : 'Period'}</th>
                  <th className="px-3 py-2 text-start font-medium text-muted-foreground">{ar ? 'الحالة' : 'Status'}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <Link href={`/vendor/${row.vendorId}`} className="underline-offset-2 hover:underline">
                        {String(row.vendorName ?? '—')}
                      </Link>
                      <span className="text-muted-foreground"> #{row.vendorId}</span>
                    </td>
                    <td className="px-3 py-2">{row.category}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {date(row.startsAt)} → {row.endsAt ? date(row.endsAt) : (ar ? 'مفتوحة' : 'open-ended')}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={row.live ? 'default' : 'outline'} className="text-[10px]">{statusLabel(row)}</Badge>
                    </td>
                    <td className="px-3 py-2 text-end">
                      {!row.revokedAt && (
                        <Button
                          size="sm" variant="outline"
                          data-testid={`feature-remove-${row.id}`}
                          disabled={unfeature.isPending}
                          onClick={() => { setNotice(''); setError(''); unfeature.mutate({ placementId: Number(row.id) }); }}
                        >
                          {ar ? 'إلغاء التمييز' : 'Unfeature'}
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
