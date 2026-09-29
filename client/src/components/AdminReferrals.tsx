import { AdminUserLink } from '@/components/AdminEntityLink';
import { qualificationLabel, rewardSentence } from '@/lib/referralLabels';
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
import { Pager } from '@/components/Pager';
import { NewReferralCampaign } from '@/components/NewReferralCampaign';
import { Link } from 'wouter';
import { Activity, Gift, Megaphone, Search, Ticket, UsersRound } from 'lucide-react';
import { DEFAULT_ATTRIBUTION_WINDOW_DAYS } from '@shared/referralRewards';

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

/** A code lifecycle event, said in words rather than shown as an enum. */
function codeActionLabel(action: string, ar: boolean): string {
  const labels: Record<string, string> = ar
    ? { issued: 'صدر الكود', rotated: 'تم تدوير الكود', disabled: 'تم تعطيل الكود', reactivated: 'تمت إعادة التفعيل' }
    : { issued: 'Code issued', rotated: 'Code rotated', disabled: 'Code disabled', reactivated: 'Code reactivated' };
  return labels[action] ?? action;
}

/**
 * A ROW OF COUNTED FIGURES.
 *
 * `undefined` is not zero. While the query is in flight or after it failed
 * the tile shows a dash, for the same reason the marketplace stat cards do:
 * a confident 0 assembled from a missing response is a claim about the
 * business, made because a request did not come back.
 */
function OverviewGroup({ title, tiles, loading }: {
  title: string;
  loading: boolean;
  tiles: { key: string; label: string; value: number | undefined }[];
}) {
  return (
    <div data-testid={`referral-overview-${title.replace(/\s+/g, '-').toLowerCase()}`}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(tile => (
          <div key={tile.key} className="rounded-lg border bg-card p-3" data-testid={`referral-stat-${tile.key}`}>
            <p className="text-2xl font-bold tabular-nums">
              {loading || typeof tile.value !== 'number' ? '—' : tile.value.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">{tile.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

type ReferralStatus = 'all' | 'registered' | 'qualified' | 'rewarded' | 'expired' | 'revoked';
/** `missing` is a real operational state: an account that cannot invite. */
type CodeFilter = 'all' | 'active' | 'disabled' | 'missing';

export default function AdminReferrals() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const failedCopy = loadFailedCopy(ar);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ReferralStatus>('all');
  const [page, setPage] = useState(0);
  const [rewardPage, setRewardPage] = useState(0);
  const [codeQuery, setCodeQuery] = useState('');
  const [codeSearch, setCodeSearch] = useState('');
  const [codeStatus, setCodeStatus] = useState<CodeFilter>('all');
  const [codePage, setCodePage] = useState(0);
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  /**
   * CONTROLLED, so the control plane can behave like a graph.
   *
   * "View referrals" on a code has to be able to put the administrator on the
   * Referrals tab with that code already searched. With an uncontrolled Tabs
   * it could only have set the search box on a tab nobody was looking at -
   * which is the "copy the id and go find it yourself" pattern the owner
   * asked for cross-domain links to replace.
   */
  const [tab, setTab] = useState('overview');

  const referrals = trpc.admin.referrals.useQuery(
    { page, pageSize: PAGE_SIZE, search: search || undefined, status },
    { retry: false },
  );
  const rewards = trpc.admin.referralRewards.useQuery({ page: rewardPage, pageSize: PAGE_SIZE }, { retry: false });
  const overview = trpc.admin.referralOverview.useQuery(undefined, { retry: false });
  const codes = trpc.admin.referralCodes.useQuery(
    { page: codePage, pageSize: PAGE_SIZE, search: codeSearch || undefined, status: codeStatus },
    { retry: false, placeholderData: previous => previous },
  );
  const history = trpc.admin.referralCodeHistory.useQuery(
    { userId: historyFor ?? 0 },
    { retry: false, enabled: historyFor !== null },
  );
  const [campaignPage, setCampaignPage] = useState(0);
  const campaigns = trpc.admin.referralCampaigns.useQuery(
    { page: campaignPage, pageSize: PAGE_SIZE },
    { retry: false, placeholderData: previous => previous },
  );
  const campaignRows = (campaigns.data?.rows ?? []) as any[];

  const utils = trpc.useUtils();
  const invalidate = () => {
    void utils.admin.referrals.invalidate();
    void utils.admin.referralRewards.invalidate();
    void utils.admin.referralCampaigns.invalidate();
    void utils.admin.referralCodes.invalidate();
    void utils.admin.referralCodeHistory.invalidate();
    // The Overview reads all four. Leaving it out would let the summary drift
    // from the tables underneath it, which is worse than not having it.
    void utils.admin.referralOverview.invalidate();
  };
  const qualify = trpc.admin.qualifyReferral.useMutation({ onSuccess: invalidate });
  const reverse = trpc.admin.reverseReferralReward.useMutation({ onSuccess: invalidate });
  const updateCampaign = trpc.admin.updateReferralCampaign.useMutation({ onSuccess: invalidate });
  const issueCode = trpc.admin.issueReferralCode.useMutation({ onSuccess: invalidate });
  const rotateCode = trpc.admin.rotateReferralCode.useMutation({ onSuccess: invalidate });
  const setCodeState = trpc.admin.setReferralCodeStatus.useMutation({ onSuccess: invalidate });

  /**
   * COPYING IS THE ACTION AN ADMINISTRATOR ACTUALLY TAKES on a code, and
   * `navigator.clipboard` is not available on an insecure origin or without
   * permission. The fallback keeps the action working rather than failing
   * silently, which is how a copy button most often breaks.
   */
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (value: string, id: string) => {
    try { await navigator.clipboard.writeText(value); }
    catch {
      const field = document.createElement('textarea');
      field.value = value;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      try { document.execCommand('copy'); } finally { field.remove(); }
    }
    setCopied(id);
    window.setTimeout(() => setCopied(current => (current === id ? null : current)), 1800);
  };

  const absoluteLink = (link: string) =>
    (typeof window === 'undefined' ? link : `${window.location.origin}${link}`);

  /**
   * ROTATION AND DEACTIVATION BOTH BREAK SOMETHING SOMEBODY IS USING, so both
   * name the consequence before they ask, and both require a reason that goes
   * into the code history beside the actor.
   */
  const runRotate = (userId: number, ownerName: string) => {
    const reason = window.prompt(ar
      ? `تدوير كود ${ownerName}: سيتوقف أي رابط يحمل الكود الحالي عن العمل فورًا. السبب (مطلوب):`
      : `Rotate ${ownerName}'s code. Every link already carrying the current code stops working immediately. Reason (required):`);
    if (reason === null) return;
    if (reason.trim().length < 3) {
      window.alert(ar ? 'السبب مطلوب ويُسجَّل في سجل الكود.' : 'A reason is required and is recorded in the code history.');
      return;
    }
    rotateCode.mutate({ userId, reason: reason.trim() });
  };

  const runSetStatus = (userId: number, next: 'active' | 'disabled', ownerName: string) => {
    const reason = window.prompt(next === 'disabled'
      ? (ar
        ? `تعطيل كود ${ownerName}: لن يُسند أي تسجيل جديد عبره. الإحالات والمكافآت السابقة لا تتأثر. السبب (مطلوب):`
        : `Disable ${ownerName}'s code. No new sign-up will be attributed through it. Referrals and rewards already earned are untouched. Reason (required):`)
      : (ar
        ? `إعادة تفعيل كود ${ownerName}. السبب (مطلوب):`
        : `Reactivate ${ownerName}'s code. Reason (required):`));
    if (reason === null) return;
    if (reason.trim().length < 3) {
      window.alert(ar ? 'السبب مطلوب ويُسجَّل في سجل الكود.' : 'A reason is required and is recorded in the code history.');
      return;
    }
    setCodeState.mutate({ userId, status: next, reason: reason.trim() });
  };

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
            <span className="text-xs">{rewardSentence(String(reward.rewardType), reward.rewardValue as number, lang)}</span>
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
        {/*
          THE PRIMARY ACTION BELONGS IN THE HEADER.

          Creating a campaign was buried inside the Campaigns tab, which meant
          the one action that makes the whole programme do anything - no reward
          can be granted until a campaign exists - was invisible until an
          administrator guessed which of five tabs to open. The owner named
          this directly: a critical action buried where a normal administrator
          would not reasonably find it is a product defect, not a layout
          preference. It stays in the Campaigns tab too; discoverability is
          not exclusivity.
        */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <UsersRound className="h-5 w-5" />
              {ar ? 'إدارة الإحالات' : 'Referral Management'}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {ar
                ? 'الأكواد والإحالات والمكافآت والحملات — كل ما يشغّل برنامج الإحالة.'
                : 'Codes, referrals, rewards and campaigns — everything that runs the referral programme.'}
            </p>
          </div>
          <NewReferralCampaign onCreated={invalidate} />
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview" data-testid="tab-referral-overview">
              <Activity className="me-1 h-4 w-4" />{ar ? 'نظرة عامة' : 'Overview'}
            </TabsTrigger>
            <TabsTrigger value="codes" data-testid="tab-referral-codes">
              <Ticket className="me-1 h-4 w-4" />{ar ? 'أكواد الإحالة' : 'Referral Codes'}
            </TabsTrigger>
            <TabsTrigger value="referrals" data-testid="tab-referrals">{ar ? 'الإحالات' : 'Referrals'}</TabsTrigger>
            <TabsTrigger value="rewards" data-testid="tab-referral-rewards">
              <Gift className="me-1 h-4 w-4" />{ar ? 'المكافآت' : 'Rewards'}
            </TabsTrigger>
            <TabsTrigger value="campaigns" data-testid="tab-referral-campaigns">
              <Megaphone className="me-1 h-4 w-4" />{ar ? 'الحملات' : 'Campaigns'}
            </TabsTrigger>
          </TabsList>

          {/*
            ── OVERVIEW ─────────────────────────────────────────────────────
            EVERY FIGURE HERE WAS COUNTED. There is no link-visit or
            click-through number, because this product has no such
            instrumentation - and a conversion rate assembled from numbers
            nobody measured is exactly the defect the platform statistics work
            removed from the front door.

            A failed query renders as a failure, not as a programme with zero
            of everything.
          */}
          <TabsContent value="overview" className="space-y-4 pt-4" data-testid="referral-overview">
            {overview.isError ? (
              <LoadFailed {...failedCopy} onRetry={() => void overview.refetch()} />
            ) : (
              <>
                <OverviewGroup
                  title={ar ? 'أكواد الإحالة' : 'Referral codes'}
                  loading={overview.isLoading}
                  tiles={[
                    { key: 'issued', label: ar ? 'كود صادر' : 'Issued', value: overview.data?.codes.issued },
                    { key: 'active', label: ar ? 'نشط' : 'Active', value: overview.data?.codes.active },
                    { key: 'disabled', label: ar ? 'معطّل' : 'Disabled', value: overview.data?.codes.disabled },
                    { key: 'missing', label: ar ? 'بدون كود' : 'No code yet', value: overview.data?.codes.missing },
                  ]}
                />
                <OverviewGroup
                  title={ar ? 'الإحالات' : 'Referrals'}
                  loading={overview.isLoading}
                  tiles={[
                    { key: 'attributed', label: ar ? 'مُسنَدة' : 'Attributed', value: overview.data?.referrals.attributed },
                    { key: 'qualified', label: ar ? 'مؤهَّلة' : 'Qualified', value: overview.data?.referrals.qualified },
                    { key: 'rewarded', label: ar ? 'تمت مكافأتها' : 'Rewarded', value: overview.data?.referrals.rewarded },
                  ]}
                />
                <OverviewGroup
                  title={ar ? 'المكافآت' : 'Rewards'}
                  loading={overview.isLoading}
                  tiles={[
                    { key: 'granted', label: ar ? 'ممنوحة' : 'Granted', value: overview.data?.rewards.granted },
                    { key: 'pending', label: ar ? 'قيد التنفيذ' : 'Pending', value: overview.data?.rewards.pending },
                    { key: 'expired', label: ar ? 'منتهية' : 'Expired', value: overview.data?.rewards.expired },
                    { key: 'reversed', label: ar ? 'مسحوبة' : 'Reversed', value: overview.data?.rewards.reversed },
                  ]}
                />
                {/*
                  WHAT THIS SCREEN CANNOT TELL YOU is worth saying out loud.
                  An administrator looking for a click-through rate should
                  learn that it is not measured, rather than assume the figure
                  is somewhere they have not looked.
                */}
                <p className="text-xs text-muted-foreground" data-testid="referral-overview-note">
                  {ar
                    ? 'كل رقم هنا محسوب من السجلات الفعلية. زيارات روابط الإحالة غير مُقاسة في هذا الإصدار، لذلك لا يوجد معدل تحويل — ولن يُعرض رقم لم يُقَس.'
                    : 'Every figure here is counted from real records. Referral-link visits are not instrumented in this release, so there is no click-through or conversion rate — a number nobody measured is not shown as one.'}
                </p>
              </>
            )}
          </TabsContent>

          {/*
            ── REFERRAL CODES ───────────────────────────────────────────────
            The concept that had no Admin surface at all. `users.referralCode`
            was minted at sign-up and never governed: nothing could stop a code
            that had leaked, nothing could issue one to an account that somehow
            lacked one, and nothing recorded who changed what.

            THERE IS NO "CREATE REFERRAL" HERE, deliberately. A referral
            records that a real person followed a real link; a button that
            writes that relationship would fabricate the one fact this ledger
            exists to hold.
          */}
          <TabsContent value="codes" className="space-y-3 pt-4" data-testid="referral-codes">
            <form
              className="grid gap-2 sm:grid-cols-[1fr_200px_auto]"
              onSubmit={event => { event.preventDefault(); setCodeSearch(codeQuery.trim()); setCodePage(0); }}
            >
              <div className="relative">
                <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="ps-9" value={codeQuery} data-testid="referral-code-search"
                  aria-label={ar ? 'ابحث بالكود أو الاسم أو البريد' : 'Search by code, name or email'}
                  placeholder={ar ? 'ابحث بالكود أو الاسم أو البريد' : 'Search by code, name or email'}
                  onChange={event => setCodeQuery(event.target.value)}
                />
              </div>
              <Select value={codeStatus} onValueChange={value => { setCodeStatus(value as CodeFilter); setCodePage(0); }}>
                <SelectTrigger data-testid="referral-code-status" aria-label={ar ? 'حالة الكود' : 'Code status'}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{ar ? 'كل الأكواد' : 'All codes'}</SelectItem>
                  <SelectItem value="active">{ar ? 'نشط' : 'Active'}</SelectItem>
                  <SelectItem value="disabled">{ar ? 'معطّل' : 'Disabled'}</SelectItem>
                  <SelectItem value="missing">{ar ? 'بدون كود' : 'No code yet'}</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" variant="secondary" data-testid="referral-code-search-submit">
                {ar ? 'بحث' : 'Search'}
              </Button>
            </form>

            {codes.isError ? (
              <LoadFailed {...failedCopy} onRetry={() => void codes.refetch()} />
            ) : (codes.data?.rows ?? []).length === 0 ? (
              /* AN EMPTY STATE THAT NAMES THE NEXT LEGITIMATE ACTION. */
              <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground" data-testid="referral-codes-empty">
                {codeSearch || codeStatus !== 'all'
                  ? (ar ? 'لا توجد أكواد مطابقة لهذا البحث أو المرشِّح.' : 'No codes match this search or filter.')
                  : (ar
                    ? 'لا توجد حسابات تحمل أكواد إحالة بعد. يُصدَر الكود تلقائيًا عند التسجيل؛ ويمكن إصدار كود يدويًا لأي حساب لا يحمل واحدًا.'
                    : 'No accounts hold referral codes yet. A code is issued automatically at sign-up; one can be issued by hand to any account that lacks one.')}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="p-2 text-start">{ar ? 'الكود' : 'Code'}</th>
                      <th className="p-2 text-start">{ar ? 'صاحب الكود' : 'Owner'}</th>
                      <th className="p-2 text-start">{ar ? 'الحالة' : 'Status'}</th>
                      <th className="p-2 text-end">{ar ? 'مُسنَدة' : 'Attributed'}</th>
                      <th className="p-2 text-end">{ar ? 'مؤهَّلة' : 'Qualified'}</th>
                      <th className="p-2 text-end">{ar ? 'مكافآت' : 'Rewarded'}</th>
                      <th className="p-2 text-start">{ar ? 'إجراءات' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(codes.data?.rows ?? []).map((row: any) => (
                      <tr key={row.userId} className="border-b last:border-0 align-top" data-testid={`referral-code-row-${row.userId}`}>
                        <td className="p-2">
                          {row.code ? (
                            <>
                              <code className="rounded bg-muted px-1.5 py-0.5 text-xs" data-testid={`referral-code-value-${row.userId}`}>{row.code}</code>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {row.issuedAt
                                  ? `${ar ? 'صدر' : 'Issued'} ${new Date(row.issuedAt).toLocaleDateString(ar ? 'ar-EG' : 'en-GB')}`
                                  /* Codes minted before the lifecycle existed have no
                                     issue date. Unknown is said, not invented. */
                                  : (ar ? 'تاريخ الإصدار غير مسجَّل' : 'Issue date not recorded')}
                              </p>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground" data-testid={`referral-code-none-${row.userId}`}>
                              {ar ? 'لا يوجد كود' : 'No code'}
                            </span>
                          )}
                        </td>
                        <td className="p-2">
                          {/* HUMAN NAMES ARE PRIMARY, and the link is canonical:
                              this is the code owner's own User Management page. */}
                          <AdminUserLink id={Number(row.userId)} name={row.ownerName ?? row.ownerEmail ?? `#${row.userId}`} />
                          <p className="text-xs text-muted-foreground">{row.ownerEmail ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">{row.ownerRole ?? '—'}</p>
                        </td>
                        <td className="p-2">
                          {/* Not colour alone: every state carries its word. */}
                          <Badge
                            variant={!row.code ? 'outline' : row.codeStatus === 'active' ? 'default' : 'destructive'}
                            className="text-[10px]"
                            data-testid={`referral-code-status-${row.userId}`}
                          >
                            {!row.code
                              ? (ar ? 'بدون كود' : 'No code')
                              : row.codeStatus === 'active' ? (ar ? 'نشط' : 'Active') : (ar ? 'معطّل' : 'Disabled')}
                          </Badge>
                        </td>
                        <td className="p-2 text-end tabular-nums">{row.attributed}</td>
                        <td className="p-2 text-end tabular-nums">{row.qualified}</td>
                        <td className="p-2 text-end tabular-nums">{row.rewarded}</td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1">
                            {!row.code ? (
                              <Button
                                size="sm" variant="outline" className="h-7 text-xs"
                                data-testid={`referral-code-issue-${row.userId}`}
                                disabled={issueCode.isPending}
                                onClick={() => issueCode.mutate({ userId: Number(row.userId) })}
                              >
                                {ar ? 'إصدار كود' : 'Issue code'}
                              </Button>
                            ) : (
                              <>
                                <Button
                                  size="sm" variant="outline" className="h-7 text-xs"
                                  data-testid={`referral-code-copy-${row.userId}`}
                                  onClick={() => void copy(row.code, `code-${row.userId}`)}
                                >
                                  {copied === `code-${row.userId}` ? (ar ? 'تم النسخ' : 'Copied') : (ar ? 'نسخ الكود' : 'Copy code')}
                                </Button>
                                {/* NO LINK FOR A DISABLED CODE. Offering one would
                                    hand somebody a URL that attributes nothing. */}
                                {row.link && (
                                  <Button
                                    size="sm" variant="outline" className="h-7 text-xs"
                                    data-testid={`referral-link-copy-${row.userId}`}
                                    onClick={() => void copy(absoluteLink(row.link), `link-${row.userId}`)}
                                  >
                                    {copied === `link-${row.userId}` ? (ar ? 'تم النسخ' : 'Copied') : (ar ? 'نسخ الرابط' : 'Copy link')}
                                  </Button>
                                )}
                                <Button
                                  size="sm" variant="outline" className="h-7 text-xs"
                                  data-testid={`referral-code-rotate-${row.userId}`}
                                  disabled={rotateCode.isPending}
                                  onClick={() => runRotate(Number(row.userId), String(row.ownerName ?? row.ownerEmail ?? `#${row.userId}`))}
                                >
                                  {ar ? 'تدوير' : 'Rotate'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant={row.codeStatus === 'active' ? 'destructive' : 'outline'}
                                  className="h-7 text-xs"
                                  data-testid={`referral-code-toggle-${row.userId}`}
                                  disabled={setCodeState.isPending}
                                  onClick={() => runSetStatus(
                                    Number(row.userId),
                                    row.codeStatus === 'active' ? 'disabled' : 'active',
                                    String(row.ownerName ?? row.ownerEmail ?? `#${row.userId}`),
                                  )}
                                >
                                  {row.codeStatus === 'active' ? (ar ? 'تعطيل' : 'Disable') : (ar ? 'تفعيل' : 'Reactivate')}
                                </Button>
                              </>
                            )}
                            {/* THE ATTRIBUTED REFERRALS, not a number to go and
                                look for by hand: the search below runs on the
                                code, which is what the referral rows carry. */}
                            {row.code && row.attributed > 0 && (
                              <Button
                                size="sm" variant="ghost" className="h-7 text-xs"
                                data-testid={`referral-code-open-referrals-${row.userId}`}
                                onClick={() => { setQuery(row.code); setSearch(row.code); setPage(0); setTab('referrals'); }}
                              >
                                {ar ? 'عرض الإحالات' : 'View referrals'}
                              </Button>
                            )}
                            <Button
                              size="sm" variant="ghost" className="h-7 text-xs"
                              data-testid={`referral-code-history-${row.userId}`}
                              onClick={() => setHistoryFor(current => (current === Number(row.userId) ? null : Number(row.userId)))}
                            >
                              {ar ? 'السجل' : 'History'}
                            </Button>
                          </div>

                          {historyFor === Number(row.userId) && (
                            <div className="mt-2 rounded-md border bg-muted/40 p-2" data-testid={`referral-code-history-panel-${row.userId}`}>
                              {history.isError ? (
                                <LoadFailed {...failedCopy} onRetry={() => void history.refetch()} />
                              ) : history.isLoading ? (
                                <p className="text-xs text-muted-foreground">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
                              ) : (history.data ?? []).length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  {ar
                                    ? 'لا توجد تغييرات مسجَّلة على هذا الكود.'
                                    : 'No recorded changes to this code.'}
                                </p>
                              ) : (
                                <ul className="space-y-1.5">
                                  {(history.data ?? []).map((event: any) => (
                                    <li key={event.id} className="text-xs">
                                      <span className="font-medium">{codeActionLabel(String(event.action), ar)}</span>
                                      {' · '}
                                      {new Date(event.createdAt).toLocaleString(ar ? 'ar-EG' : 'en-GB')}
                                      {' · '}
                                      {event.actorName ?? `#${event.actorId}`}
                                      {/* THE STRING THAT STOPPED WORKING. After a
                                          rotation this is the only record of it. */}
                                      {event.action === 'rotated' && event.previousCode && (
                                        <span className="text-muted-foreground">
                                          {' '}— {ar ? 'الكود السابق' : 'was'} <code>{event.previousCode}</code>
                                        </span>
                                      )}
                                      {event.reason && (
                                        <p className="text-muted-foreground">{event.reason}</p>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(issueCode.isError || rotateCode.isError || setCodeState.isError) && (
              <p className="text-sm text-destructive" data-testid="referral-code-error">
                {(issueCode.error ?? rotateCode.error ?? setCodeState.error)?.message}
              </p>
            )}

            <Pager
              ar={ar} page={codePage} total={codes.data?.total ?? null}
              pageCount={pageCount(codes.data?.total ?? 0)}
              onChange={setCodePage} testId="referral-code-pager"
            />
          </TabsContent>

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
                      <th className="p-2 text-start">{ar ? 'الحملة' : 'Campaign'}</th>
                      <th className="p-2 text-start">{ar ? 'المكافأة' : 'Reward'}</th>
                      <th className="p-2 text-start">{ar ? 'التاريخ' : 'Date'}</th>
                      <th className="p-2 text-start">{ar ? 'إجراءات' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(referrals.data?.rows ?? []).map((row: any) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="p-2">
                          <AdminUserLink id={row.referrerId} name={row.referrerName} className="font-medium" />
                          {row.referrerEmail && <p className="text-xs text-muted-foreground">{row.referrerEmail}</p>}
                        </td>
                        <td className="p-2">
                          {/* THE PERSON, not the number. This printed `#4127`
                              as the referred party's whole identity - the one
                              row on this screen the human-first rule had
                              missed - because the query behind it joined
                              `users` for the referrer only. */}
                          <AdminUserLink id={row.referredId} name={row.referredName} />
                        </td>
                        <td className="p-2 font-mono text-xs">{row.code}</td>
                        <td className="p-2"><Badge variant="secondary">{statusLabel(row.status)}</Badge></td>
                        {/* LATE BINDING, SHOWN AS THE DESIGN RATHER THAN AS A
                            GAP. A referral has no campaign until it qualifies -
                            that is owner decision 2, and it is why the engine
                            can pick the campaign that is actually eligible at
                            the moment the qualifying event happens. Rendering
                            nothing left an administrator unable to tell "not
                            bound yet" from "we lost the campaign". */}
                        <td className="p-2 text-muted-foreground" data-testid={`referral-campaign-${row.id}`}>
                          {row.campaignId
                            ? (row.campaignName ?? `#${row.campaignId}`)
                            : <span className="text-xs italic">{ar ? 'تُحدَّد عند التأهل' : 'Determined on qualification'}</span>}
                        </td>
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
              total={referrals.data?.total ?? null} onChange={setPage} testId="referral-pager"
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
                          <AdminUserLink id={row.recipientUserId} name={row.recipientName} className="font-medium" />
                        </td>
                        <td className="p-2 text-muted-foreground">{row.campaignName}</td>
                        {/* The reward as words. An administrator explaining a
                            grant to a supplier should be reading the same
                            sentence the supplier sees, not a stored token. */}
                        <td className="p-2">{rewardSentence(String(row.rewardType), row.rewardValue as number, lang)}</td>
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
              total={rewards.data?.total ?? null} onChange={setRewardPage} testId="reward-pager"
            />
          </TabsContent>

          {/* ── CAMPAIGNS: six procedures that no client has ever called ──── */}
          <TabsContent value="campaigns" className="space-y-3 pt-4">
            {/*
              The empty state below says no reward can be granted until a
              campaign exists - and until now there was no way to create one
              from the product at all. `admin.createReferralCampaign` had no
              caller; campaigns were insertable only with SQL.
            */}
            <div className="flex justify-end">
              <NewReferralCampaign onCreated={invalidate} />
            </div>
            {campaigns.isError ? (
              <LoadFailed {...failedCopy} onRetry={() => void campaigns.refetch()} />
            ) : campaignRows.length === 0 ? (
              <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                {ar
                  ? 'لا توجد حملات إحالة. لن تُمنح أي مكافأة حتى تُنشأ حملة وتُفعَّل.'
                  : 'No referral campaigns exist. No reward can be granted until one is created and made active.'}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="p-2 text-start">{ar ? 'الحملة' : 'Campaign'}</th>
                      <th className="p-2 text-start">{ar ? 'يُؤهِّلها' : 'Qualifies on'}</th>
                      <th className="p-2 text-start">{ar ? 'المكافأة' : 'Reward'}</th>
                      <th className="p-2 text-start">{ar ? 'الحدود' : 'Caps'}</th>
                      <th className="p-2 text-start">{ar ? 'الحالة' : 'Status'}</th>
                      <th className="p-2 text-start">{ar ? 'إجراءات' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignRows.map((row: any) => (
                      <tr key={row.id} className="border-b last:border-0" data-testid={`campaign-row-${row.id}`}>
                        <td className="p-2">
                          <p className="font-medium">{row.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {ar ? 'نافذة الإسناد' : 'Attribution window'}: {row.attributionWindowDays ?? DEFAULT_ATTRIBUTION_WINDOW_DAYS}
                            {ar ? ' يومًا' : ' days'}
                          </p>
                        </td>
                        <td className="p-2 text-xs">{qualificationLabel(String(row.qualificationType), lang) ?? String(row.qualificationType)}</td>
                        <td className="p-2 text-xs">
                          {rewardSentence(String(row.rewardType), row.rewardValue as number, lang)}
                          {row.rewardDurationDays ? ` · ${row.rewardDurationDays}d` : ''}
                        </td>
                        <td className="p-2 text-xs">
                          {ar ? 'لكل داعٍ' : 'per inviter'} {row.perInviterCap}
                          {row.campaignCap ? ` · ${ar ? 'إجمالي' : 'total'} ${row.campaignCap}` : ''}
                        </td>
                        <td className="p-2"><Badge variant="secondary">{row.status}</Badge></td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1">
                            {(['draft', 'active', 'paused', 'ended'] as const)
                              .filter(next => next !== row.status)
                              .map(next => (
                                <Button
                                  key={next} size="sm" variant="outline" className="h-7 text-xs"
                                  data-testid={`campaign-${row.id}-${next}`}
                                  disabled={updateCampaign.isPending}
                                  onClick={() => updateCampaign.mutate({ campaignId: Number(row.id), status: next })}
                                >
                                  {next}
                                </Button>
                              ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {updateCampaign.isError && (
              <p className="text-sm text-destructive" data-testid="campaign-error">{updateCampaign.error.message}</p>
            )}

            {/*
              WHY THERE IS NO "EDIT TERMS" HERE ONCE A CAMPAIGN HAS PAID OUT.
              The server refuses it and explains why; saying the same thing on
              the screen means an administrator learns the rule before they try,
              rather than from an error.
            */}
            <p className="text-xs text-muted-foreground" data-testid="campaign-terms-note">
              {ar
                ? 'يمكن تعديل جدولة الحملة وحدودها في أي وقت. أما شروط المكافأة والأهلية فتُثبَّت بمجرد منح أول مكافأة، حتى لا يتغيّر ما وُعد به بعد منحه.'
                : "A campaign's schedule and caps can be changed at any time. Its reward terms and eligibility are fixed once it has granted its first reward, so that what was promised is not rewritten after it has been given."}
            </p>
            <Pager
              ar={ar} page={campaignPage} total={campaigns.data?.total ?? null}
              pageCount={Math.max(1, Math.ceil((campaigns.data?.total ?? 0) / PAGE_SIZE))}
              onChange={setCampaignPage} testId="campaign-pager"
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
