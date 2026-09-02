import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function ReferralInviteEarn() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { data } = trpc.profile.myReferral.useQuery(undefined, { retry: false });

  const copy = () => {
    if (!data?.link) return;
    navigator.clipboard?.writeText?.(`${window.location.origin}${data.link}`);
  };

  return (
    <div className="space-y-3" data-testid="referral-invite-earn">
      <p className="text-sm text-muted-foreground">
        {ar
          ? 'شارك رمز الدعوة الخاص بك. المكافآت الأولية غير نقدية وتُمنح عند اكتمال التأهيل.'
          : 'Share your invite code. Initial rewards are non-cash and granted after qualification.'}
      </p>
      {data ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{ar ? 'الرمز' : 'Code'}: {data.code}</Badge>
            <Badge variant="outline">{ar ? 'الدعوات' : 'Invites'}: {data.referrals}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md border bg-muted/30 px-2 py-1 text-xs">{window.location.origin}{data.link}</code>
            <Button size="sm" variant="outline" onClick={copy}>{ar ? 'نسخ الرابط' : 'Copy link'}</Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">…</p>
      )}
    </div>
  );
}
