import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import { Link } from 'wouter';
import { Gift, Search, UsersRound } from 'lucide-react';

/**
 * REFERRAL ADMINISTRATION, over the data that actually exists.
 *
 * Three things were wrong with the screen this replaces.
 *
 * The Reward column read `referrals.rewardType` / `.rewardValue` - columns
 * NOTHING has ever written - so it showed "-" on every row while the real
 * reward sat in `referralRewards` beside it.
 *
 * Search and the status filter ran in the browser over a `.limit(250)` result,
 * so a search that matched row 251 answered "No matching referrals". A filter
 * over a truncated set is worse than no filter, because it answers with
 * confidence. Both now run in the query, against the whole table.
 *
 * And the reward ledger had NO SCREEN AT ALL: `admin.referralRewards`,
 * `admin.reverseReferralReward` and `admin.qualifyReferral` were procedures no
 * client called, so an administrator could not see what BuildHub had granted,
 * let alone withdraw it.
 */
const PAGE_SIZE = 25;

type ReferralStatus = 'all' | 'registered' | 'qualified' | 'rewarded' | 'expired' | 'revoked';

export default function AdminReferrals() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const failedCopy = loadFailedCopy(ar);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ReferralStatus>('all');
  const [page, setPage] = useState(0);
  const [rewardPage, setRewardPage] = useState(0);

  const referrals = trpc.admin.referrals.useQuery(
    { page, pageSize: PAGE_SIZE, search: search || undefined, status },
    { retry: false },
  );
  const rewards = trpc.admin.referralRewards.useQuery({ page: rewardPage, pageSize: PAGE_SIZE }, { retry: false });

  const utils = trpc.useUtils();
  const invalidate = () => {
    void utils.admin.referrals.invalidate();
    void utils.admin.referralRewards.invalidate();
  };
  const qualify = trpc.admin.qualifyReferral.useMutation({ onSuccess: invalidate });
  const reverse = trpc.admin.reverseReferralReward.useMutation({ onSuccess: invalidate });

  const statusLabel = (value: string) => {
    const labels: Record<string, string> = ar
      ? { registered: 'مسجّل', qualified: 'مؤهّل', rewarded: 'تمت المكافأة', expired: 'منتهٍ', revoked: 'ملغى' }
      : { registered: 'Registered', qualified: 'Qualified', rewarded: 'Rewarded', expired: 'Expired', revoked: 'Revoked' };
    return labels[value] ?? value;
  };

  const rewardStatusLabel = (value: string) => {
    const labels: Record<string, string> = ar
      ? { PENDING: 'قيد التنفيذ', GRANTED: 'ممنوحة', EXPIRED: 'منتهية', REVERSED: 'مسحوبة', REJECTED: 'مرفوضة' }
      : { PENDING: 'Pending', GRANTED: 'Granted', EXPIRED: 'Expired', REVERSED: 'Reversed', REJECTED: 'Rejected' };
    return labels[value] ?? value;
  };

  const rewardTone = (value: string) =>
    value === 'GRANTED' ? 'default'
      : value === 'REVERSED' || value === 'REJECTED' ? 'destructive'
        : 'secondary';

  const pageCount = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** A reward summary that says what it is, and what became of it. */
  const rewardSummary = (row: any) => {
    const list = (row.rewards ?? []) as any[];
    if (list.length === 0) return <span className="text-muted-foreground">—</span>;
    return (
      <div className="space-y-1">
        {list.map(reward => (
          <div key={reward.id} className="flex flex-wrap items-center gap-1">
            <span className="text-xs">{reward.rewardType}: {reward.rewardValue}</span>
            <Badge variant={rewardTone(reward.status) as any} className="text-[10px]">
              {rewardStatusLabel(reward.status)}
            </Badge>
          </div>
        ))}
      </div>
    );
  };

  const runQualify = (referralId: number) => {
    const note = window.prompt(ar ? 'سبب التأهيل اليدوي (اختياري):' : 'Reason for qualifying manually (optional):');
    if (note === null) return;
    qualify.mutate({ referralId, note: note.trim() || undefined });
  };

  const runReverse = (rewardId: number) => {
    const reason = window.prompt(ar
      ? 'سبب سحب هذه المكافأة (مطلوب):'
      : 'Why is this reward being withdrawn? (required):');
    if (reason === null) return;
    if (!reason.trim()) {
      window.alert(ar ? 'السبب مطلوب - سيظهر في سجل التدقيق.' : 'A reason is required - it is recorded in the audit trail.');
      return;
    }
    reverse.mutate({ rewardId, reason: reason.trim() });
  };

  return (
    <Card data-testid="admin-referrals">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UsersRound className="h-5 w-5" />
          {ar ? 'إدارة الإحالات' : 'Referral Management'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="referrals">
          <TabsList>
            <TabsTrigger value="referrals" data-testid="tab-referrals">{ar ? 'الإحالات' : 'Referrals'}</TabsTrigger>
            <TabsTrigger value="rewards" data-testid="tab-referral-rewards">
              <Gift className="me-1 h-4 w-4" />{ar ? 'المكافآت' : 'Rewards'}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="referrals" className="space-y-3 pt-4">
            <form
              className="grid gap-2 sm:grid-cols-[1fr_180px_auto]"
              onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(0); }}
            >
              <div className="relative">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="ps-9" value={query} data-testid="referral-search"
                  onChange={event => setQuery(event.target.value)}
                  placeholder={ar ? 'ابحث بالداعي أو الرمز…' : 'Search referrer or code…'}
                />
              </div>
              <Select value={status} onValueChange={value => { setStatus(value as ReferralStatus); setPage(0); }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{ar ? 'كل الحالات' : 'All statuses'}</SelectItem>
                  {(['registered', 'qualified', 'rewarded', 'expired', 'revoked'] as const).map(value => (
                    <SelectItem key={value} value={value}>{statusLabel(value)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" variant="outline" className="h-9">{ar ? 'بحث' : 'Search'}</Button>
            </form>

            {referrals.isError ? (
              <LoadFailed {...failedCopy} onRetry={() => void referrals.refetch()} />
            ) : (referrals.data?.rows.length ?? 0) === 0 ? (
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
                      <th className="p-2 text-start">{ar ? 'إجراءات' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(referrals.data?.rows ?? []).map((row: any) => (
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
                        <td className="p-2">{rewardSummary(row)}</td>
                        <td className="p-2 text-muted-foreground">{new Date(row.createdAt).toLocaleDateString()}</td>
                        <td className="p-2">
                          {row.status === 'registered' && (
                            <Button
                              size="sm" variant="outline" className="h-7 text-xs"
                              data-testid={`qualify-referral-${row.id}`}
                              disabled={qualify.isPending}
                              onClick={() => runQualify(Number(row.id))}
                            >
                              {ar ? 'تأهيل' : 'Qualify'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {qualify.isError && (
              <p className="text-sm text-destructive" data-testid="qualify-error">{qualify.error.message}</p>
            )}

            <Pager
              ar={ar} page={page} pageCount={pageCount(referrals.data?.total ?? 0)}
              total={referrals.data?.total ?? 0} onChange={setPage} testId="referral-pager"
            />
          </TabsContent>

          <TabsContent value="rewards" className="space-y-3 pt-4">
            {rewards.isError ? (
              <LoadFailed {...failedCopy} onRetry={() => void rewards.refetch()} />
            ) : (rewards.data?.rows.length ?? 0) === 0 ? (
              <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                {ar ? 'لم تُمنح أي مكافأة إحالة بعد.' : 'No referral reward has been granted yet.'}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="p-2 text-start">{ar ? 'المستفيد' : 'Recipient'}</th>
                      <th className="p-2 text-start">{ar ? 'الحملة' : 'Campaign'}</th>
                      <th className="p-2 text-start">{ar ? 'المكافأة' : 'Reward'}</th>
                      <th className="p-2 text-start">{ar ? 'الحالة' : 'Status'}</th>
                      <th className="p-2 text-start">{ar ? 'تنتهي' : 'Expires'}</th>
                      <th className="p-2 text-start">{ar ? 'إجراءات' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rewards.data?.rows ?? []).map((row: any) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="p-2">
                          <Link href={`/admin/users/${row.recipientUserId}`} className="font-medium underline-offset-2 hover:underline">
                            {row.recipientName || `#${row.recipientUserId}`}
                          </Link>
                        </td>
                        <td className="p-2 text-muted-foreground">{row.campaignName}</td>
                        <td className="p-2">{row.rewardType}: {row.rewardValue}</td>
                        <td className="p-2">
                          <Badge variant={rewardTone(row.status) as any}>{rewardStatusLabel(row.status)}</Badge>
                          {row.reversalReason && (
                            <p className="mt-1 max-w-[22rem] text-xs text-muted-foreground">{row.reversalReason}</p>
                          )}
                        </td>
                        <td className="p-2 text-muted-foreground">
                          {row.expiresAt ? new Date(row.expiresAt).toLocaleDateString() : (ar ? 'بدون نهاية' : 'No end')}
                        </td>
                        <td className="p-2">
                          {row.status === 'GRANTED' && (
                            <Button
                              size="sm" variant="outline" className="h-7 text-xs"
                              data-testid={`reverse-reward-${row.id}`}
                              disabled={reverse.isPending}
                              onClick={() => runReverse(Number(row.id))}
                            >
                              {ar ? 'سحب' : 'Reverse'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {reverse.isError && (
              <p className="text-sm text-destructive" data-testid="reverse-error">{reverse.error.message}</p>
            )}
            {reverse.data?.detail && (
              <p className="text-sm text-muted-foreground" data-testid="reverse-detail">{reverse.data.detail}</p>
            )}

            <Pager
              ar={ar} page={rewardPage} pageCount={pageCount(rewards.data?.total ?? 0)}
              total={rewards.data?.total ?? 0} onChange={setRewardPage} testId="reward-pager"
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/**
 * The page control, WITH THE TOTAL.
 *
 * "Page 1 of 4" and the real row count together are what stop a list from
 * quietly being a subset - which is exactly what `.limit(250)` and no count
 * produced here before.
 */
function Pager({ ar, page, pageCount, total, onChange, testId }: {
  ar: boolean; page: number; pageCount: number; total: number;
  onChange: (page: number) => void; testId: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid={testId}>
      <span className="text-xs text-muted-foreground">
        {ar ? `${total} سجل` : `${total} record${total === 1 ? '' : 's'}`}
      </span>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="h-7" disabled={page === 0} onClick={() => onChange(page - 1)}>
          {ar ? 'السابق' : 'Previous'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {ar ? `صفحة ${page + 1} من ${pageCount}` : `Page ${page + 1} of ${pageCount}`}
        </span>
        <Button type="button" size="sm" variant="outline" className="h-7" disabled={page + 1 >= pageCount} onClick={() => onChange(page + 1)}>
          {ar ? 'التالي' : 'Next'}
        </Button>
      </div>
    </div>
  );
}
