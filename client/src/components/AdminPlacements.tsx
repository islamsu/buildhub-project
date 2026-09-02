import { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Link } from 'wouter';
import { Megaphone, Search } from 'lucide-react';

export default function AdminPlacements() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [query, setQuery] = useState('');
  const { data: rows = [] } = trpc.admin.placements.useQuery(undefined, { retry: false });

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
                        <Link href={`/vendor/${row.vendorId}`} className="font-medium underline-offset-2 hover:underline">
                          {row.vendorName || `#${row.vendorId}`}
                        </Link>
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
