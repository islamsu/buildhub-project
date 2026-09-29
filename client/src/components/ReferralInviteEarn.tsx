import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import {
  qualificationLabel, referralStateLabel, rewardSentence, rewardStatusLabel,
} from '@/lib/referralLabels';
import { Check, Copy, Share2, Users } from 'lucide-react';
import { useState } from 'react';

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
 *
 * NO ENUM REACHES THE READER. It rendered `EXTRA_QUALIFIED_ENQUIRIES: 5`,
 * which is a database column shown to a customer as the product's own
 * language - untranslatable, and asking them to work out what they were given,
 * which is the one thing a rewards screen exists to answer. Every state and
 * every reward now reads as a sentence, in both languages, from
 * lib/referralLabels.
 *
 * WHO ACCEPTED, and how far each got. See the privacy note on
 * listMyReferredParties: a business already listed in the public directory is
 * named because it is already public; nobody else is, because a referral code
 * can be posted anywhere and a stranger who used it did not agree to be named
 * to whoever posted it.
 */
export default function ReferralInviteEarn() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const failedCopy = loadFailedCopy(ar);
  const referral = trpc.profile.myReferral.useQuery(undefined, { retry: false });
  const data = referral.data;

  const [copied, setCopied] = useState(false);
  const fullLink = data?.link ? `${window.location.origin}${data.link}` : '';

  const copy = () => {
    if (!fullLink) return;
    navigator.clipboard?.writeText?.(fullLink);
    // Confirmed, briefly. A copy button that does nothing visible is a button
    // people press three times and still do not trust.
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  /*
   * SHARE where the device offers it, COPY everywhere. navigator.share exists
   * on phones and in few desktop browsers, so it is offered only when it is
   * really there rather than rendered as a button that throws.
   */
  const canShare = typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function';
  const share = () => {
    if (!fullLink) return;
    void (navigator as any).share({
      title: 'BuildHub',
      text: ar ? 'انضم إلى BuildHub عبر دعوتي' : 'Join me on BuildHub',
      url: fullLink,
    }).catch(() => { /* dismissed by the person - not an error */ });
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
            <code className="rounded-md border bg-muted/30 px-2 py-1 text-xs" data-testid="referral-link">{fullLink}</code>
            <Button size="sm" variant="outline" onClick={copy} data-testid="referral-copy" className="gap-1.5">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? (ar ? 'تم النسخ' : 'Copied') : (ar ? 'نسخ الرابط' : 'Copy link')}
            </Button>
            {canShare && (
              <Button size="sm" variant="outline" onClick={share} data-testid="referral-share" className="gap-1.5">
                <Share2 className="h-3.5 w-3.5" />{ar ? 'مشاركة' : 'Share'}
              </Button>
            )}
          </div>

          {/* HOW IT WORKS, in three steps rather than one dense sentence. The
              reward is deliberately not named: which one applies is decided by
              the campaign eligible at the moment a real qualifying event
              fires, and naming one here would be a promise nothing has made. */}
          <ol className="grid gap-2 rounded-lg border bg-muted/20 p-3 text-sm sm:grid-cols-3" data-testid="referral-how">
            <li className="flex gap-2">
              <span className="font-semibold text-primary">1.</span>
              <span>{ar ? 'شارك رابطك.' : 'Share your link.'}</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-primary">2.</span>
              <span>{ar ? 'يسجّلون عبره ويبدأون العمل على المنصّة.' : 'They sign up through it and start using BuildHub.'}</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-primary">3.</span>
              <span>{ar ? 'عند استيفائهم الشروط تُمنح مكافأتك تلقائيًا.' : 'When they qualify, your reward is granted automatically.'}</span>
            </li>
          </ol>

          {/* ── WHO ACCEPTED, AND WHERE EACH ONE GOT TO ──────────────────
              Three counts could not tell an inviter which of their invitations
              turned into anything, or what the rest still need. */}
          <div className="space-y-2" data-testid="referral-referred">
            <h4 className="flex items-center gap-1.5 text-sm font-medium">
              <Users className="h-4 w-4 text-muted-foreground" />
              {ar ? 'من قبِل دعوتك' : 'Who accepted your invitation'}
            </h4>
            {(data.referred ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
                {ar
                  ? 'لم يسجّل أحد عبر رابطك بعد.'
                  : 'Nobody has signed up through your link yet.'}
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {(data.referred as any[]).map(person => (
                  <li key={person.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                      data-testid={`referral-referred-${person.id}`}>
                    <div className="min-w-0">
                      {/*
                        A PUBLICLY LISTED BUSINESS IS NAMED; nobody else is.
                        The server decides that, on the same two conditions the
                        vendor directory uses. A row with no name still says
                        what the account is and when it joined, which is what
                        the inviter needs, without turning a link posted in a
                        group into a list of strangers' names.
                      */}
                      <p className="truncate font-medium">
                        {person.name
                          ? person.name
                          : (ar ? 'حساب خاص' : 'A private account')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(person.createdAt).toLocaleDateString()}
                        {person.qualificationType
                          ? ` · ${ar ? 'لأن' : 'because'} ${qualificationLabel(person.qualificationType, lang)}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {person.rewardType && (
                        <span className="text-xs text-muted-foreground">
                          {rewardSentence(String(person.rewardType), person.rewardValue, lang)}
                        </span>
                      )}
                      <Badge variant={person.status === 'rewarded' ? 'default' : 'secondary'}>
                        {referralStateLabel(String(person.status), lang)}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
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
                      {/* The reward as a SENTENCE with its unit. "5" alone
                          does not say five of what, and the stored token said
                          it in a language nobody speaks. */}
                      <p className="font-medium" data-testid={`referral-reward-${reward.id}`}>
                        {rewardSentence(String(reward.rewardType), reward.rewardValue as number, lang)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {reward.campaignName}
                        {reward.expiresAt
                          ? ` · ${ar ? 'تنتهي' : 'ends'} ${new Date(reward.expiresAt as string).toLocaleDateString()}`
                          : ''}
                      </p>
                    </div>
                    <Badge variant={reward.status === 'GRANTED' ? 'default' : 'secondary'}>
                      {rewardStatusLabel(String(reward.status), lang)}
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
