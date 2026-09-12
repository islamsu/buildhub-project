import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  DISPUTE_CATEGORIES, type DisputeCategory, type DisputeSubjectType,
} from '@shared/disputes';

/**
 * RAISING A DISPUTE, FROM WHEREVER YOU ARE WHEN YOU NEED TO.
 *
 * ONE dialog for all three subjects, not three. What this replaces lived inline
 * in ProjectDetail, could only name a project, and had a free-text "type" box
 * beside no category and no respondent - so a supplier who disagreed with a
 * quotation had nowhere to go, and every dispute arrived at support naming
 * nobody.
 *
 * THE RESPONDENT IS CHOSEN FROM THE REAL CAST OF THE SUBJECT, never typed. The
 * candidates come from `disputes.subjectParties`, which refuses with NOT_FOUND
 * when the caller has no relationship to the subject - so this cannot be used
 * to enumerate the parties of somebody else's RFQ, and the server validates the
 * choice again on submit whatever this screen sends.
 */
export function OpenDisputeDialog({ subjectType, subjectId, open, onOpenChange }: {
  subjectType: DisputeSubjectType;
  subjectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [, navigate] = useLocation();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<DisputeCategory>('other');
  const [respondentId, setRespondentId] = useState<string>('none');

  const parties = trpc.disputes.subjectParties.useQuery(
    { subjectType, subjectId },
    { enabled: open, retry: false },
  );
  const utils = trpc.useUtils();
  const create = trpc.disputes.create.useMutation({
    onSuccess: result => {
      void utils.disputes.myDisputes.invalidate();
      onOpenChange(false);
      // Straight to the record. A dispute that vanishes on submit is the
      // "filed into a void" this whole surface exists to end.
      navigate(`/disputes/${result.id}`);
    },
  });

  useEffect(() => {
    if (!open) { setTitle(''); setDescription(''); setCategory('other'); setRespondentId('none'); }
  }, [open]);

  const categoryLabel = (value: string) => (ar
    ? {
      quality: 'الجودة', delivery: 'التسليم', quantity: 'الكمية', specification: 'المواصفات',
      communication: 'التواصل', conduct: 'السلوك', pricing: 'التسعير', other: 'أخرى',
    }
    : {
      quality: 'Quality', delivery: 'Delivery', quantity: 'Quantity', specification: 'Specification',
      communication: 'Communication', conduct: 'Conduct', pricing: 'Pricing', other: 'Other',
    }
  )[value] ?? value;

  const ready = title.trim().length > 0 && description.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto" data-testid="open-dispute">
        <DialogHeader>
          <DialogTitle>{ar ? 'فتح نزاع' : 'Open a dispute'}</DialogTitle>
        </DialogHeader>

        {parties.isError ? (
          /*
            The server's own sentence. It refuses with NOT_FOUND both for a
            subject that does not exist and for one this account has no
            relationship to, so an id cannot be probed for existence - and
            restating that here as "something went wrong" would hide the one
            thing the reader can act on.
          */
          <p className="text-sm text-destructive" data-testid="open-dispute-error">
            {ar
              ? 'لا يمكن فتح نزاع بشأن هذا العنصر من هذا الحساب.'
              : 'A dispute cannot be raised about this from this account.'}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {ar ? 'بشأن: ' : 'About: '}
              <span className="font-medium text-foreground" data-testid="dispute-subject-label">
                {parties.data?.label ?? (ar ? 'جارٍ التحميل…' : 'Loading…')}
              </span>
            </p>

            <Input
              data-testid="dispute-title" maxLength={255}
              placeholder={ar ? 'الموضوع' : 'Subject'}
              value={title} onChange={event => setTitle(event.target.value)}
            />
            <Textarea
              data-testid="dispute-description" rows={4} maxLength={5000}
              placeholder={ar ? 'اشرح المشكلة' : 'Describe the issue'}
              value={description} onChange={event => setDescription(event.target.value)}
            />

            <Select value={category} onValueChange={value => setCategory(value as DisputeCategory)}>
              <SelectTrigger data-testid="dispute-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DISPUTE_CATEGORIES.map(value => (
                  <SelectItem key={value} value={value}>{categoryLabel(value)}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="space-y-1">
              <Select value={respondentId} onValueChange={setRespondentId}>
                <SelectTrigger data-testid="dispute-respondent">
                  <SelectValue placeholder={ar ? 'ضد من؟' : 'Who is this about?'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {ar ? 'لا أحد بعينه' : 'Nobody in particular'}
                  </SelectItem>
                  {(parties.data?.candidates ?? []).map((candidate: any) => (
                    <SelectItem key={candidate.userId} value={String(candidate.userId)}>
                      {candidate.name ?? `#${candidate.userId}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {parties.data && (parties.data.candidates ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground" data-testid="dispute-no-candidates">
                  {ar
                    ? 'لا يوجد طرف آخر مسجّل على هذا العنصر بعد.'
                    : 'Nobody else is recorded on this yet, so the dispute names no one.'}
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {ar
                ? 'يصل النزاع إلى فريق الدعم، ويُبلَّغ الطرف الآخر إن سمّيته.'
                : 'Support reviews the dispute, and the other side is told if you name one.'}
            </p>

            {create.isError && (
              <p className="text-sm text-destructive" data-testid="dispute-submit-error">{create.error.message}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {ar ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button
                data-testid="dispute-submit"
                disabled={!ready || create.isPending || !parties.data}
                onClick={() => create.mutate({
                  subjectType, subjectId,
                  title: title.trim(), description: description.trim(), category,
                  respondentId: respondentId === 'none' ? undefined : Number(respondentId),
                })}
              >
                {create.isPending ? (ar ? 'جارٍ الإرسال…' : 'Submitting…') : (ar ? 'إرسال' : 'Submit')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
