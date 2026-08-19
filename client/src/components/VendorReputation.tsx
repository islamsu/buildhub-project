import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Star } from 'lucide-react';

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

      {reviewCount === 0 || !reviewList?.length ? (
        <p className="text-sm text-muted-foreground italic">{t('reputation.no_reviews')}</p>
      ) : (
        <div className="space-y-3">
          {reviewList.map(review => (
            <div key={review.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <StarRow value={review.rating} />
                <span className="text-xs text-muted-foreground">{new Date(review.createdAt).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US')}</span>
              </div>
              <p className="text-xs text-muted-foreground mb-1">{t('reputation.verified_customer')}</p>
              {review.comment && <p className="text-sm leading-6 whitespace-pre-wrap">{review.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
