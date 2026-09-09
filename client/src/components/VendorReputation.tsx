import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Star } from 'lucide-react';
import {
  REVIEW_REPORT_REASONS, REVIEW_RESPONSE_MAX_LENGTH, reviewLabel,
} from '@shared/reviews';

function StarRow({ value, size = 'sm' }: { value: number; size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'w-5 h-5' : 'w-4 h-4';
  return (
    <div className="flex items-center gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} className={`${cls} ${n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`} />
      ))}
    </div>
  );
}

/**
 * Reusable reputation display: dynamic average rating + review count + review
 * list for a single user, computed live (reviews.statsForUser / reviews.forUser)
 * rather than any stored aggregate - the single authoritative source used
 * everywhere reputation is shown (vendor profile, provider's own dashboard).
 */
export default function VendorReputation({ userId }: { userId: number }) {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  // WHO IS LOOKING decides which controls exist, but never whether the server
  // enforces them. `reviews.respond` re-checks that the responder is the
  // reviewee and that no reply exists yet; `reviews.report` re-checks the
  // reporter has not already reported this review. Hiding a button is a
  // courtesy to the reader, not a security control.
  const isSubject = user != null && user.id === userId;

  const [respondingTo, setRespondingTo] = useState<number | null>(null);
  const [responseBody, setResponseBody] = useState('');
  const [reportingId, setReportingId] = useState<number | null>(null);
  const [reportReason, setReportReason] = useState<string>(REVIEW_REPORT_REASONS[0]);
  const [reportDetail, setReportDetail] = useState('');
  const [actionError, setActionError] = useState('');
  const [reportedIds, setReportedIds] = useState<number[]>([]);

  const respond = trpc.reviews.respond.useMutation({
    onSuccess: () => {
      setRespondingTo(null); setResponseBody(''); setActionError('');
      void utils.reviews.forUser.invalidate({ userId });
    },
    onError: e => setActionError(e.message),
  });
  const report = trpc.reviews.report.useMutation({
    onSuccess: (_data, variables) => {
      setReportingId(null); setReportDetail(''); setActionError('');
      setReportedIds(previous => [...previous, variables.reviewId]);
    },
    onError: e => setActionError(e.message),
  });

  const { data: stats, isLoading: statsLoading, error: statsError } = trpc.reviews.statsForUser.useQuery({ userId }, { enabled: userId > 0 });
  const { data: reviewList, isLoading: reviewsLoading, error: reviewsError } = trpc.reviews.forUser.useQuery({ userId }, { enabled: userId > 0 });

  if (statsLoading || reviewsLoading) {
    return <div className="text-sm text-muted-foreground py-4">{t('common.loading')}</div>;
  }
  if (statsError || reviewsError) {
    return <div className="text-sm text-muted-foreground py-4">{t('reputation.load_error')}</div>;
  }

  const reviewCount = stats?.reviewCount ?? 0;
  const averageRating = stats?.averageRating ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <StarRow value={averageRating ?? 0} size="lg" />
        <span className="font-semibold">{averageRating != null ? averageRating.toFixed(1) : '—'}</span>
        <span className="text-sm text-muted-foreground">
          {reviewCount} {t('reputation.reviews')}
        </span>
      </div>

      {actionError && <p className="text-sm text-rose-600" data-testid="review-action-error">{actionError}</p>}

      {reviewCount === 0 || !reviewList?.length ? (
        <p className="text-sm text-muted-foreground italic">{t('reputation.no_reviews')}</p>
      ) : (
        <div className="space-y-3">
          {(reviewList as Array<{
            id: number; rating: number; comment: string | null; createdAt: string | Date;
            responseBody: string | null; responseAt: string | Date | null;
          }>).map(review => (
            <div key={review.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <StarRow value={review.rating} />
                <span className="text-xs text-muted-foreground">{new Date(review.createdAt).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US')}</span>
              </div>
              <p className="text-xs text-muted-foreground mb-1">{t('reputation.verified_customer')}</p>
              {review.comment && <p className="text-sm leading-6 whitespace-pre-wrap">{review.comment}</p>}
              {/* THE PROVIDER'S REPLY, under the review it answers. A reader
                  weighing a complaint should see the response in the same
                  place, not have to go looking for whether one exists. */}
              {review.responseBody && (
                <div className="mt-3 rounded-md border-s-2 border-primary/40 bg-muted/30 p-2 ps-3" data-testid={`review-response-${review.id}`}>
                  <p className="text-xs font-medium">{t('reputation.provider_response')}</p>
                  <p className="mt-1 text-sm leading-6 whitespace-pre-wrap">{review.responseBody}</p>
                </div>
              )}

              {/* ── THE TWO THINGS A READER MAY DO ABOUT A REVIEW ──────────
                  A RIGHT OF REPLY for the person the review is about, once
                  and only once - the reviewer has had their say and a page
                  that becomes an argument helps nobody reading it.
                  A REPORT for anyone signed in, because an abusive review
                  harms the subject whether or not the subject notices it
                  first. Neither control is offered to a signed-out visitor,
                  who has no account to attribute the action to. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {isSubject && !review.responseBody && respondingTo !== review.id && (
                  <Button size="sm" variant="outline"
                    onClick={() => { setRespondingTo(review.id); setActionError(''); }}
                    data-testid={`review-respond-open-${review.id}`}>
                    {t('reputation.respond')}
                  </Button>
                )}
                {user != null && !isSubject && reportingId !== review.id && (
                  <Button size="sm" variant="ghost" className="text-muted-foreground"
                    disabled={reportedIds.includes(review.id)}
                    onClick={() => { setReportingId(review.id); setActionError(''); }}
                    data-testid={`review-report-open-${review.id}`}>
                    {reportedIds.includes(review.id) ? t('reputation.reported') : t('reputation.report')}
                  </Button>
                )}
              </div>

              {respondingTo === review.id && (
                <div className="mt-2 space-y-2" data-testid={`review-respond-form-${review.id}`}>
                  <Textarea rows={3} value={responseBody} maxLength={REVIEW_RESPONSE_MAX_LENGTH}
                    aria-label={t('reputation.respond')}
                    placeholder={t('reputation.respond_placeholder')}
                    onChange={event => setResponseBody(event.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm"
                      disabled={respond.isPending || responseBody.trim().length === 0}
                      onClick={() => respond.mutate({ reviewId: review.id, body: responseBody })}
                      data-testid={`review-respond-submit-${review.id}`}>
                      {t('reputation.respond_submit')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setRespondingTo(null); setResponseBody(''); }}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('reputation.respond_once')}</p>
                </div>
              )}

              {reportingId === review.id && (
                <div className="mt-2 space-y-2" data-testid={`review-report-form-${review.id}`}>
                  <Select value={reportReason} onValueChange={setReportReason}>
                    <SelectTrigger aria-label={t('reputation.report_reason')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REVIEW_REPORT_REASONS.map(reason => (
                        <SelectItem key={reason} value={reason}>{reviewLabel('reportReason', reason, lang)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Textarea rows={2} value={reportDetail} maxLength={1000}
                    aria-label={t('reputation.report_detail')}
                    placeholder={t('reputation.report_detail')}
                    onChange={event => setReportDetail(event.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={report.isPending}
                      onClick={() => report.mutate({
                        reviewId: review.id,
                        reason: reportReason as typeof REVIEW_REPORT_REASONS[number],
                        detail: reportDetail.trim() || undefined,
                      })}
                      data-testid={`review-report-submit-${review.id}`}>
                      {t('reputation.report_submit')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setReportingId(null); setReportDetail(''); }}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                  {/* NO PROMISE OF AN OUTCOME. A report is a signal to a
                      moderator, not a takedown. */}
                  <p className="text-xs text-muted-foreground">{t('reputation.report_note')}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
