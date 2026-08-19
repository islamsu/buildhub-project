import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CheckCircle2, MessageSquare, Star } from 'lucide-react';

function RatingPicker({ value, onChange }: { value: number; onChange: (rating: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={String(n)}
          className="p-0.5"
        >
          <Star className={`w-6 h-6 ${n <= value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`} />
        </button>
      ))}
    </div>
  );
}

/**
 * Customer-facing review submission. Eligibility (who can be reviewed, whether
 * they already have been) always comes from the server (reviews.eligibleReviewees),
 * never computed or assumed client-side - the client only reflects what the
 * server already decided, and reviews.submit re-validates everything again on
 * the write itself.
 */
export default function ReviewSubmissionPanel({ projectId, isCompleted }: { projectId: number; isCompleted: boolean }) {
  const { t } = useLanguage();
  const utils = trpc.useUtils();
  const [openFor, setOpenFor] = useState<number | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  const { data: eligible, isLoading, error } = trpc.reviews.eligibleReviewees.useQuery(
    { projectId },
    { enabled: isCompleted && projectId > 0 },
  );

  const submitReview = trpc.reviews.submit.useMutation({
    onSuccess: () => {
      toast.success(t('review.success'));
      setOpenFor(null);
      setRating(0);
      setComment('');
      utils.reviews.eligibleReviewees.invalidate({ projectId });
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  if (!isCompleted) {
    return <p className="text-sm text-muted-foreground py-8 text-center">{t('review.not_completed')}</p>;
  }
  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">{t('common.loading')}</p>;
  }
  if (error) {
    return <p className="text-sm text-muted-foreground py-8 text-center">{t('reputation.load_error')}</p>;
  }
  if (!eligible || eligible.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">{t('review.no_participants')}</p>;
  }

  return (
    <div className="space-y-3">
      {eligible.map(participant => (
        <div key={participant.providerId} className="rounded-xl border p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="font-medium">{participant.name || '—'}</p>
            {participant.alreadyReviewed ? (
              <Badge variant="secondary" className="gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{t('review.already_reviewed')}</Badge>
            ) : openFor === participant.providerId ? null : (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setOpenFor(participant.providerId); setRating(0); setComment(''); }}>
                <MessageSquare className="w-3.5 h-3.5" /> {t('review.leave_review')}
              </Button>
            )}
          </div>

          {!participant.alreadyReviewed && openFor === participant.providerId && (
            <div className="mt-3 space-y-3 border-t pt-3">
              <div>
                <p className="text-sm font-medium mb-1">{t('review.rating_label')}</p>
                <RatingPicker value={rating} onChange={setRating} />
              </div>
              <Textarea
                rows={3}
                maxLength={2000}
                placeholder={t('review.comment_placeholder')}
                value={comment}
                onChange={e => setComment(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={submitReview.isPending}
                  onClick={() => {
                    if (rating < 1) { toast.error(t('review.rating_required')); return; }
                    submitReview.mutate({ projectId, revieweeId: participant.providerId, rating, comment: comment || undefined });
                  }}
                >
                  {submitReview.isPending ? t('review.submitting') : t('review.submit_action')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setOpenFor(null)}>{t('common.cancel')}</Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
