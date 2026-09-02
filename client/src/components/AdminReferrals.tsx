import { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link } from 'wouter';
import { Search, UsersRound } from 'lucide-react';

export default function AdminReferrals() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'registered' | 'qualified' | 'rewarded' | 'expired' | 'revoked'>('all');
  const { data: rows = [] } = trpc.admin.referrals.useQuery(undefined, { retry: false });

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter(row => {
      const statusMatches = status === 'all' || row.status === status;
      const searchMatches = !term || `${row.referrerName ?? ''} ${row.referrerEmail ?? ''} ${row.code ?? ''}`.toLowerCase().includes(term);
      return statusMatches && searchMatches;
    });
  }, [rows, query, status]);

  const statusLabel = (value: string) => {
    const labels: Record<string, string> = ar
      ? { registered: 'مسجّل', qualified: 'مؤهّل', rewarded: 'تمت المكافأة', expired: 'منتهٍ', revoked: 'ملغى' }
      : { registered: 'Registered', qualified: 'Qualified', rewarded: 'Rewarded', expired: 'Expired', revoked: 'Revoked' };
    return labels[value] ?? value;
  };

  return (
    <Card data-testid="admin-referrals">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UsersRound className="h-5 w-5" />
          {ar ? 'إدارة الإحالات' : 'Referral Management'}
        </CardTitle>
        <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="ps-9" value={query} onChange={event => setQuery(event.target.value)} placeholder={ar ? 'ابحث بالداعي أو الرمز…' : 'Search referrer or code…'} />
          </div>
          <Select value={status} onValueChange={value => setStatus(value as typeof status)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{ar ? 'كل الحالات' : 'All statuses'}</SelectItem>
              <SelectItem value="registered">{statusLabel('registered')}</SelectItem>
              <SelectItem value="qualified">{statusLabel('qualified')}</SelectItem>
              <SelectItem value="rewarded">{statusLabel('rewarded')}</SelectItem>
              <SelectItem value="expired">{statusLabel('expired')}</SelectItem>
              <SelectItem value="revoked">{statusLabel('revoked')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            {ar ? 'لا توجد إحالات مطابقة.' : 'No matching referrals.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="p-2 text-start">{ar ? 'الداعي' : 'Referrer'}</th>
                  <th className="p-2 text-start">{ar ? 'المُحال' : 'Referred'}</th>
                  <th className="p-2 text-start">{ar ? 'الرمز' : 'Code'}</th>
                  <th className="p-2 text-start">{ar ? 'الحالة' : 'Status'}</th>
                  <th className="p-2 text-start">{ar ? 'المكافأة' : 'Reward'}</th>
                  <th className="p-2 text-start">{ar ? 'التاريخ' : 'Date'}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="p-2">
                      <Link href={`/admin/users/${row.referrerId}`} className="font-medium underline-offset-2 hover:underline">
                        {row.referrerName || `#${row.referrerId}`}
                      </Link>
                      {row.referrerEmail && <p className="text-xs text-muted-foreground">{row.referrerEmail}</p>}
                    </td>
                    <td className="p-2">
                      <Link href={`/admin/users/${row.referredId}`} className="underline-offset-2 hover:underline">
                        #{row.referredId}
                      </Link>
                    </td>
                    <td className="p-2 font-mono text-xs">{row.code}</td>
                    <td className="p-2"><Badge variant="secondary">{statusLabel(row.status)}</Badge></td>
                    <td className="p-2 text-muted-foreground">{row.rewardType ? `${row.rewardType}${row.rewardValue ? `: ${row.rewardValue}` : ''}` : '—'}</td>
                    <td className="p-2 text-muted-foreground">{new Date(row.createdAt).toLocaleDateString()}</td>
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
