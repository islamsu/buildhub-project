import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus } from 'lucide-react';
import {
  DEFAULT_ATTRIBUTION_WINDOW_DAYS, REFERRAL_QUALIFICATION_TYPES, REFERRAL_REWARD_TYPES,
} from '@shared/referralRewards';

/**
 * CREATING A REFERRAL CAMPAIGN, from the product.
 *
 * `admin.createReferralCampaign` had no client caller: campaigns could only be
 * inserted with SQL. And NOTHING WORKS WITHOUT ONE - the engine resolves a
 * campaign at qualification and grants nothing when there is none, which is
 * why the empty state on this tab says so. An administrator could read that
 * sentence, agree with it, and have no way to act on it.
 *
 * The reward TERMS are set here and frozen the moment a reward is granted
 * against the campaign (server/referralCampaignEdit.ts), so this form is the
 * only place most of these fields are ever writable. Every one of them is
 * offered, rather than half of them being left to the column defaults the way
 * `attributionWindowDays` was before it became settable.
 */
const INVITER_ROLES = ['homeowner', 'contractor', 'supplier', 'engineer', 'architect', 'project_manager'] as const;

export function NewReferralCampaign({ onCreated }: { onCreated: () => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [open, setOpen] = useState(false);

  const [name, setName] = useState('');
  const [qualificationType, setQualificationType] = useState<string>(REFERRAL_QUALIFICATION_TYPES[0]);
  const [rewardType, setRewardType] = useState<string>(REFERRAL_REWARD_TYPES[0]);
  const [rewardValue, setRewardValue] = useState('5');
  const [rewardDurationDays, setRewardDurationDays] = useState('30');
  const [inviterRole, setInviterRole] = useState<string>('supplier');
  const [referredRole, setReferredRole] = useState<string>('homeowner');
  const [perInviterCap, setPerInviterCap] = useState('1');
  const [campaignCap, setCampaignCap] = useState('');
  const [attributionWindowDays, setAttributionWindowDays] = useState(String(DEFAULT_ATTRIBUTION_WINDOW_DAYS));
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');

  const create = trpc.admin.createReferralCampaign.useMutation({
    onSuccess: () => { setOpen(false); setName(''); onCreated(); },
  });

  const positive = (value: string) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  };
  const iso = (value: string) => (value ? new Date(`${value}T00:00:00.000Z`).toISOString() : undefined);
  const ready = name.trim().length > 0 && rewardValue.trim().length > 0
    && positive(perInviterCap) !== undefined && positive(attributionWindowDays) !== undefined;

  const rewardLabel = (value: string) => (ar
    ? {
      EXTRA_QUALIFIED_ENQUIRIES: 'استفسارات مؤهلة إضافية',
      TEMPORARY_FEATURED: 'ظهور مميز مؤقت',
      SUBSCRIPTION_EXTENSION: 'تمديد الاشتراك',
    }
    : {
      EXTRA_QUALIFIED_ENQUIRIES: 'Extra qualified enquiries',
      TEMPORARY_FEATURED: 'Temporary featured placement',
      SUBSCRIPTION_EXTENSION: 'Subscription extension',
    }
  )[value] ?? value;

  return (
    <>
      <Button size="sm" className="gap-1" data-testid="new-campaign" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />{ar ? 'حملة جديدة' : 'New campaign'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="new-campaign-form">
          <DialogHeader>
            <DialogTitle>{ar ? 'حملة إحالة جديدة' : 'New referral campaign'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <Field ar={ar} en="Name" arLabel="الاسم">
              <Input value={name} onChange={e => setName(e.target.value)} data-testid="campaign-name" maxLength={120} />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field ar={ar} en="Qualifies on" arLabel="يُؤهِّلها">
                <Select value={qualificationType} onValueChange={setQualificationType}>
                  <SelectTrigger data-testid="campaign-qualification"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REFERRAL_QUALIFICATION_TYPES.map(value => (
                      <SelectItem key={value} value={value}>{value.replace(/_/g, ' ').toLowerCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field ar={ar} en="Reward" arLabel="المكافأة">
                <Select value={rewardType} onValueChange={setRewardType}>
                  <SelectTrigger data-testid="campaign-reward-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REFERRAL_REWARD_TYPES.map(value => (
                      <SelectItem key={value} value={value}>{rewardLabel(value)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field ar={ar} en="Reward value" arLabel="قيمة المكافأة">
                <Input value={rewardValue} onChange={e => setRewardValue(e.target.value)} data-testid="campaign-reward-value" maxLength={100} />
              </Field>
              <Field ar={ar} en="Reward lasts (days)" arLabel="مدة المكافأة (أيام)">
                <Input value={rewardDurationDays} onChange={e => setRewardDurationDays(e.target.value)} data-testid="campaign-reward-days" inputMode="numeric" />
              </Field>
              <Field ar={ar} en="Inviter role" arLabel="دور الداعي">
                <Select value={inviterRole} onValueChange={setInviterRole}>
                  <SelectTrigger data-testid="campaign-inviter-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INVITER_ROLES.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field ar={ar} en="Referred role" arLabel="دور المُحال">
                <Select value={referredRole} onValueChange={setReferredRole}>
                  <SelectTrigger data-testid="campaign-referred-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INVITER_ROLES.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field ar={ar} en="Per-inviter cap" arLabel="حد لكل داعٍ">
                <Input value={perInviterCap} onChange={e => setPerInviterCap(e.target.value)} data-testid="campaign-per-inviter-cap" inputMode="numeric" />
              </Field>
              <Field ar={ar} en="Campaign cap (optional)" arLabel="حد الحملة (اختياري)">
                <Input value={campaignCap} onChange={e => setCampaignCap(e.target.value)} data-testid="campaign-cap" inputMode="numeric" />
              </Field>
              <Field ar={ar} en="Attribution window (days)" arLabel="نافذة الإسناد (أيام)">
                <Input value={attributionWindowDays} onChange={e => setAttributionWindowDays(e.target.value)} data-testid="campaign-attribution-window" inputMode="numeric" />
              </Field>
              <Field ar={ar} en="Starts (optional)" arLabel="يبدأ (اختياري)">
                <Input type="date" value={startsAt} onChange={e => setStartsAt(e.target.value)} data-testid="campaign-starts" />
              </Field>
              <Field ar={ar} en="Ends (optional)" arLabel="ينتهي (اختياري)">
                <Input type="date" value={endsAt} onChange={e => setEndsAt(e.target.value)} data-testid="campaign-ends" />
              </Field>
            </div>

            {/*
              CREATED AS A DRAFT. An active campaign starts binding referrals the
              moment it is saved, and a typo in a reward value that is already
              being granted cannot be corrected - the terms freeze on the first
              grant. Draft first, then Activate from the list, is the order that
              leaves a mistake fixable.
            */}
            <p className="text-xs text-muted-foreground">
              {ar
                ? 'تُنشأ الحملة كمسودة. فعّلها من القائمة بعد مراجعة شروطها - لا يمكن تعديل الشروط بعد منح أول مكافأة.'
                : 'Created as a draft. Activate it from the list once you have checked its terms - they can no longer be edited once a reward has been granted against it.'}
            </p>

            {create.isError && (
              <p className="text-sm text-destructive" data-testid="campaign-create-error">{create.error.message}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>{ar ? 'إلغاء' : 'Cancel'}</Button>
              <Button
                data-testid="campaign-create"
                disabled={!ready || create.isPending}
                onClick={() => create.mutate({
                  name: name.trim(),
                  status: 'draft',
                  qualificationType: qualificationType as never,
                  rewardType: rewardType as never,
                  rewardValue: rewardValue.trim(),
                  rewardDurationDays: positive(rewardDurationDays),
                  eligibleInviterRoles: [inviterRole],
                  eligibleReferredRoles: [referredRole],
                  perInviterCap: positive(perInviterCap) ?? 1,
                  campaignCap: positive(campaignCap),
                  attributionWindowDays: positive(attributionWindowDays) ?? DEFAULT_ATTRIBUTION_WINDOW_DAYS,
                  startsAt: iso(startsAt),
                  endsAt: iso(endsAt),
                })}
              >
                {create.isPending ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'إنشاء مسودة' : 'Create draft')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ ar, en, arLabel, children }: {
  ar: boolean; en: string; arLabel: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{ar ? arLabel : en}</Label>
      {children}
    </div>
  );
}
