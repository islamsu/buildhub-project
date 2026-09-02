import { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link } from 'wouter';
import { Megaphone, Search } from 'lucide-react';
import VendorIdentitySelect from '@/components/VendorIdentitySelect';
import ProductIdentitySelect from '@/components/ProductIdentitySelect';

export default function AdminPlacements() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [query, setQuery] = useState('');
  const { data: rows = [] } = trpc.admin.placements.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [productId, setProductId] = useState<number | null>(null);
  const [entityType, setEntityType] = useState<'PROVIDER' | 'PRODUCT'>('PROVIDER');
  const [packageValue, setPackageValue] = useState<'BOOST' | 'SPOTLIGHT' | 'PREMIER'>('BOOST');
  const [surface, setSurface] = useState<'MASTER_DISCOVERY' | 'TYPE_CATEGORY_SPOTLIGHT' | 'SEARCH_RESULTS_BOOST'>('SEARCH_RESULTS_BOOST');
  const [category, setCategory] = useState('General');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [priority, setPriority] = useState('0');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const book = trpc.admin.bookPlacement.useMutation({
    onSuccess: () => {
      setNotice(ar ? 'تم إنشاء المساحة.' : 'Placement booked.');
      setVendorId(null); setCategory('General'); setStartsAt(''); setEndsAt(''); setPriority('0');
      void utils.admin.placements.invalidate();
    },
    onError: mutationError => { setNotice(''); setError(mutationError.message); },
  });

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(row => `${row.vendorName ?? ''} ${row.package ?? ''} ${row.surface ?? ''} ${row.category ?? ''}`.toLowerCase().includes(term));
  }, [rows, query]);

  const sourceLabel = (value: string) => {
    const labels: Record<string, string> = ar
      ? { PAID_SPONSORSHIP: 'إعلان مدفوع', ADMIN_EDITORIAL: 'تحريري', REFERRAL_REWARD: 'مكافأة إحالة', PROMOTIONAL_COMP: 'ترويجي' }
      : { PAID_SPONSORSHIP: 'Paid Sponsorship', ADMIN_EDITORIAL: 'Editorial', REFERRAL_REWARD: 'Referral Reward', PROMOTIONAL_COMP: 'Promotional' };
    return labels[value] ?? value;
  };

  return (
    <Card data-testid="admin-placements">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="h-5 w-5" />
          {ar ? 'إدارة المساحات التجارية' : 'Commercial Placement Management'}
        </CardTitle>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="ps-9" value={query} onChange={event => setQuery(event.target.value)} placeholder={ar ? 'ابحث بالكيان أو الباقة أو السطح…' : 'Search entity, package or surface…'} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-5 rounded-xl border p-4">
          <p className="text-sm font-medium">{ar ? 'حجز مساحة تجارية' : 'Book a commercial placement'}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select value={entityType} onValueChange={value => setEntityType(value as typeof entityType)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="PROVIDER">Provider</SelectItem><SelectItem value="PRODUCT">Product</SelectItem></SelectContent>
            </Select>
            {entityType === 'PROVIDER' ? (
              <VendorIdentitySelect value={vendorId} onChange={setVendorId} label={ar ? 'المورّد' : 'Provider'} testId="placement-vendor" />
            ) : (
              <ProductIdentitySelect value={productId} onChange={setProductId} label={ar ? 'المنتج' : 'Product'} testId="placement-product" />
            )}
            <Select value={packageValue} onValueChange={value => setPackageValue(value as typeof packageValue)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="BOOST">BOOST</SelectItem><SelectItem value="SPOTLIGHT">SPOTLIGHT</SelectItem><SelectItem value="PREMIER">PREMIER</SelectItem></SelectContent>
            </Select>
            <Select value={surface} onValueChange={value => setSurface(value as typeof surface)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="SEARCH_RESULTS_BOOST">SEARCH_RESULTS_BOOST</SelectItem><SelectItem value="TYPE_CATEGORY_SPOTLIGHT">TYPE_CATEGORY_SPOTLIGHT</SelectItem><SelectItem value="MASTER_DISCOVERY">MASTER_DISCOVERY</SelectItem></SelectContent>
            </Select>
            <Input className="h-9" value={category} onChange={event => setCategory(event.target.value)} placeholder={ar ? 'الفئة' : 'Category'} />
            <Input className="h-9" type="date" value={startsAt} onChange={event => setStartsAt(event.target.value)} />
            <Input className="h-9" type="date" value={endsAt} onChange={event => setEndsAt(event.target.value)} />
            <Input className="h-9" inputMode="numeric" value={priority} onChange={event => setPriority(event.target.value.replace(/\D/g, ''))} placeholder={ar ? 'الأولوية' : 'Priority'} />
          </div>
          <Button
            size="sm"
            className="mt-3"
            disabled={(entityType === 'PROVIDER' ? vendorId === null : productId === null) || !category.trim() || !startsAt || book.isPending}
            onClick={() => book.mutate({
              entityType,
              entityId: entityType === 'PROVIDER' ? vendorId! : productId!,
              package: packageValue,
              surface,
              source: 'ADMIN_EDITORIAL',
              category: category.trim(),
              startsAt: new Date(`${startsAt}T00:00:00Z`).toISOString(),
              endsAt: endsAt ? new Date(`${endsAt}T23:59:59Z`).toISOString() : null,
              priority: Number(priority) || 0,
            })}
          >
            {ar ? 'حجز' : 'Book placement'}
          </Button>
          {notice && <p className="mt-2 text-sm text-emerald-700">{notice}</p>}
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
        {filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            {ar ? 'لا توجد مساحات تجارية مطابقة.' : 'No matching placements.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="p-2 text-start">{ar ? 'الكيان' : 'Entity'}</th>
                  <th className="p-2 text-start">{ar ? 'النوع' : 'Kind'}</th>
                  <th className="p-2 text-start">{ar ? 'الباقة' : 'Package'}</th>
                  <th className="p-2 text-start">{ar ? 'السطح' : 'Surface'}</th>
                  <th className="p-2 text-start">{ar ? 'المصدر' : 'Source'}</th>
                  <th className="p-2 text-start">{ar ? 'الفئة' : 'Category'}</th>
                  <th className="p-2 text-start">{ar ? 'الأولوية' : 'Priority'}</th>
                  <th className="p-2 text-start">{ar ? 'الحالة' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => {
                  const live = !row.revokedAt && (!row.endsAt || new Date(row.endsAt).getTime() > Date.now());
                  return (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="p-2">
                        {row.entityType === 'PRODUCT' ? (
                          <Link href={`/marketplace/products/${row.productId}`} className="font-medium underline-offset-2 hover:underline">
                            {row.productName || `#${row.productId}`}
                          </Link>
                        ) : (
                          <Link href={`/vendor/${row.vendorId}`} className="font-medium underline-offset-2 hover:underline">
                            {row.vendorName || `#${row.vendorId}`}
                          </Link>
                        )}
                      </td>
                      <td className="p-2 text-muted-foreground">{row.kind}</td>
                      <td className="p-2"><Badge variant="outline">{row.package || '—'}</Badge></td>
                      <td className="p-2 text-muted-foreground">{row.surface || '—'}</td>
                      <td className="p-2 text-muted-foreground">{sourceLabel(row.source)}</td>
                      <td className="p-2 text-muted-foreground">{row.category}</td>
                      <td className="p-2 text-muted-foreground">{row.priority}</td>
                      <td className="p-2"><Badge variant={live ? 'default' : 'secondary'}>{live ? (ar ? 'نشط' : 'Active') : (ar ? 'غير نشط' : 'Inactive')}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
