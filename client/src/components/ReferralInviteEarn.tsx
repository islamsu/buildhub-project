import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';

/**
 * THE INVITER'S OWN PROGRAMME.
 *
 * This showed a code, a link, and one number - how many people had used the
 * code. It could not answer the only question an inviter actually has, which is
 * whether any of it earned anything: registered and qualified are different
 * facts, and a programme where nothing ever qualifies looked identical to one
 * that worked.
 *
 * The rewards were surfaced NOWHERE. BuildHub granted a real benefit, wrote a
 * ledger row, and the recipient's only chance of learning about it was a single
 * notification they may have missed. A vendor asking "what did I get, and is it
 * still active" had no screen to ask it on.
 *
 * NO PROMISE BEFORE QUALIFICATION. The reward depends on which campaign is
 * eligible at the moment a real qualifying event fires, and naming one here
 * would be a commitment the engine has not made.
 */
export default function ReferralInviteEarn() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const failedCopy = loadFailedCopy(ar);
  const referral = trpc.profile.myReferral.useQuery(undefined, { retry: false });
  const data = referral.data;

  const copy = () => {
    if (!data?.link) return;
    navigator.clipboard?.writeText?.(`${window.location.origin}${data.link}`);
  };

  const rewardStatusLabel = (value: string) => {
    const labels: Record<string, string> = ar
      ? { PENDING: 'قيد التنفيذ', GRANTED: 'فعّالة', EXPIRED: 'منتهية', REVERSED: 'مسحوبة', REJECTED: 'لم تُمنح' }
      : { PENDING: 'Pending', GRANTED: 'Active', EXPIRED: 'Ended', REVERSED: 'Withdrawn', REJECTED: 'Not granted' };
    return labels[value] ?? value;
  };

  if (referral.isError) {
    return (
      <div data-testid="referral-invite-earn">
        <LoadFailed {...failedCopy} onRetry={() => void referral.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="referral-invite-earn">
      <p className="text-sm text-muted-foreground">
        {ar
          ? 'شارك رمز الدعوة الخاص بك. المكافآت الأولية غير نقدية وتُمنح عند اكتمال التأهيل، وتعتمد على الحملة المؤهَّلة وقت التأهيل.'
          : 'Share your invite code. Initial rewards are non-cash and granted after qualification - which reward depends on the campaign eligible at that moment.'}
      </p>
      {data ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{ar ? 'الرمز' : 'Code'}: {data.code}</Badge>
            <Badge variant="outline" data-testid="referral-count-total">
              {ar ? 'الدعوات' : 'Invites'}: {data.counts.total}
            </Badge>
            {/* Registered and qualified separately, because collapsing them
                hides whether the programme is doing anything at all. */}
            <Badge variant="outline" data-testid="referral-count-registered">
              {ar ? 'مسجّلة' : 'Registered'}: {data.counts.registered}
            </Badge>
            <Badge variant="outline" data-testid="referral-count-qualified">
              {ar ? 'مؤهّلة' : 'Qualified'}: {data.counts.qualified + data.counts.rewarded}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md border bg-muted/30 px-2 py-1 text-xs">{window.location.origin}{data.link}</code>
            <Button size="sm" variant="outline" onClick={copy}>{ar ? 'نسخ الرابط' : 'Copy link'}</Button>
          </div>

          <div className="space-y-2" data-testid="referral-rewards">
            <h4 className="text-sm font-medium">{ar ? 'مكافآتي' : 'My rewards'}</h4>
            {data.rewards.length === 0 ? (
              /* TRUTHFUL, not encouraging. Zero rewards is a real answer, and
                 dressing it up as "rewards coming soon" would promise
                 something no campaign has committed to. */
              <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
                {ar
                  ? 'لم تُمنح لك أي مكافأة إحالة حتى الآن.'
                  : 'No referral reward has been granted to you yet.'}
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {(data.rewards as any[]).map(reward => (
                  <li key={reward.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <div>
                      <p className="font-medium">{reward.rewardType}: {reward.rewardValue}</p>
                      <p className="text-xs text-muted-foreground">
                        {reward.campaignName}
                        {reward.expiresAt
                          ? ` · ${ar ? 'تنتهي' : 'ends'} ${new Date(reward.expiresAt).toLocaleDateString()}`
                          : ''}
                      </p>
                    </div>
                    <Badge variant={reward.status === 'GRANTED' ? 'default' : 'secondary'}>
                      {rewardStatusLabel(reward.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">…</p>
      )}
    </div>
  );
}
