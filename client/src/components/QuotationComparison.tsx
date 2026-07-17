import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  Star, CheckCircle2, XCircle, Shield, Clock, DollarSign,
  Award, TrendingDown, Zap, User, MapPin, ChevronUp, ChevronDown,
  Trophy, ThumbsUp, ThumbsDown, Info,
} from 'lucide-react';

type QuotationRow = {
  id: number;
  rfqId: number;
  providerId: number;
  price: string;
  currency: string | null;
  timeline: number | null;
  warranty: string | null;
  paymentTerms: string | null;
  notes: string | null;
  status: 'pending' | 'accepted' | 'rejected' | null;
  createdAt: Date;
  providerName: string | null;
  providerEmail: string | null;
  providerRating: string | null;
  providerReviews: number | null;
  providerVerified: boolean | null;
  providerRole: string | null;
  providerLocation: string | null;
};

type SortKey = 'price' | 'score' | 'rating' | 'timeline';

/** Compute a composite score 0-100 for a quotation relative to the set. */
function computeScore(q: QuotationRow, all: QuotationRow[], rfqBudget?: number): number {
  const prices = all.map(x => parseFloat(x.price));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const timelines = all.map(x => x.timeline ?? 999);
  const minTimeline = Math.min(...timelines);
  const maxTimeline = Math.max(...timelines);

  const price = parseFloat(q.price);
  const priceScore = maxPrice === minPrice ? 100 : ((maxPrice - price) / (maxPrice - minPrice)) * 100;

  const timeline = q.timeline ?? maxTimeline;
  const timelineScore = maxTimeline === minTimeline ? 100 : ((maxTimeline - timeline) / (maxTimeline - minTimeline)) * 100;

  const rating = parseFloat(q.providerRating ?? '0');
  const ratingScore = (rating / 5) * 100;

  const verifiedBonus = q.providerVerified ? 10 : 0;

  // Budget fit: penalise if over budget
  let budgetScore = 100;
  if (rfqBudget && price > rfqBudget) {
    budgetScore = Math.max(0, 100 - ((price - rfqBudget) / rfqBudget) * 100);
  }

  // Weighted composite: price 35%, timeline 20%, rating 25%, budget 20%
  return Math.round(
    priceScore * 0.35 +
    timelineScore * 0.20 +
    ratingScore * 0.25 +
    budgetScore * 0.20 +
    verifiedBonus
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
    score >= 60 ? 'bg-blue-100 text-blue-700 border-blue-200' :
    score >= 40 ? 'bg-amber-100 text-amber-700 border-amber-200' :
                  'bg-red-100 text-red-700 border-red-200';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
      <Zap className="w-3 h-3" /> {score}
    </span>
  );
}

function StarRating({ rating, count }: { rating: number; count: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(s => (
        <Star
          key={s}
          className={`w-3.5 h-3.5 ${s <= Math.round(rating) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`}
        />
      ))}
      <span className="text-xs text-muted-foreground ml-1">({count})</span>
    </div>
  );
}

interface Props {
  rfqId: number;
  rfqTitle: string;
  rfqBudget?: number;
  rfqStatus?: string | null;
  isOwner: boolean;
  onClose: () => void;
}

export default function QuotationComparison({ rfqId, rfqTitle, rfqBudget, rfqStatus, isOwner, onClose }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortAsc, setSortAsc] = useState(false);
  const [confirmAccept, setConfirmAccept] = useState<QuotationRow | null>(null);
  const [confirmReject, setConfirmReject] = useState<QuotationRow | null>(null);

  const { data: quotes = [], refetch, isLoading } = trpc.rfq.quotations.useQuery({ rfqId });

  const acceptMutation = trpc.rfq.acceptQuotation.useMutation({
    onSuccess: () => {
      toast.success('Quotation accepted! The provider has been notified.');
      setConfirmAccept(null);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const rejectMutation = trpc.rfq.rejectQuotation.useMutation({
    onSuccess: () => {
      toast.success('Quotation rejected.');
      setConfirmReject(null);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const scored = quotes.map(q => ({ ...q, score: computeScore(q as QuotationRow, quotes as QuotationRow[], rfqBudget) }));

  const sorted = [...scored].sort((a, b) => {
    let diff = 0;
    if (sortKey === 'price') diff = parseFloat(a.price) - parseFloat(b.price);
    else if (sortKey === 'score') diff = b.score - a.score;
    else if (sortKey === 'rating') diff = parseFloat(b.providerRating ?? '0') - parseFloat(a.providerRating ?? '0');
    else if (sortKey === 'timeline') diff = (a.timeline ?? 9999) - (b.timeline ?? 9999);
    return sortAsc ? diff : -diff;
  });

  const bestScore = Math.max(...scored.map(q => q.score), 0);
  const lowestPrice = Math.min(...quotes.map(q => parseFloat(q.price)), Infinity);
  const fastestTimeline = Math.min(...quotes.map(q => q.timeline ?? 9999), 9999);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(key === 'price' || key === 'timeline'); }
  };

  const SortBtn = ({ label, k, icon }: { label: string; k: SortKey; icon: React.ReactNode }) => (
    <button
      onClick={() => toggleSort(k)}
      className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md transition-colors
        ${sortKey === k ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
    >
      {icon}{label}
      {sortKey === k ? (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null}
    </button>
  );

  const rfqAwarded = rfqStatus === 'awarded';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">{rfqTitle}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {quotes.length} quotation{quotes.length !== 1 ? 's' : ''} received
            {rfqBudget && <span className="ml-2">· Budget: <strong>EGP {rfqBudget.toLocaleString()}</strong></span>}
          </p>
        </div>
        {rfqAwarded && (
          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1">
            <Trophy className="w-3.5 h-3.5" /> Awarded
          </Badge>
        )}
      </div>

      {/* Sort controls */}
      {quotes.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Sort by:</span>
          <SortBtn label="Best Score" k="score" icon={<Zap className="w-3 h-3" />} />
          <SortBtn label="Price" k="price" icon={<DollarSign className="w-3 h-3" />} />
          <SortBtn label="Rating" k="rating" icon={<Star className="w-3 h-3" />} />
          <SortBtn label="Timeline" k="timeline" icon={<Clock className="w-3 h-3" />} />
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-12 text-muted-foreground">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          Loading quotations…
        </div>
      )}

      {/* Empty state */}
      {!isLoading && quotes.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <DollarSign className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="font-medium">No quotations yet</p>
          <p className="text-sm mt-1">Providers will submit their offers here once they see your RFQ.</p>
        </div>
      )}

      {/* Comparison cards — side-by-side scroll on desktop */}
      {sorted.length > 0 && (
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(sorted.length, 3)}, minmax(260px, 1fr))`, overflowX: 'auto' }}>
          {sorted.map((q, idx) => {
            const isBest = q.score === bestScore && bestScore > 0;
            const isCheapest = parseFloat(q.price) === lowestPrice;
            const isFastest = q.timeline === fastestTimeline && fastestTimeline < 9999;
            const isAccepted = q.status === 'accepted';
            const isRejected = q.status === 'rejected';

            return (
              <Card
                key={q.id}
                className={`relative flex flex-col transition-all duration-200
                  ${isBest && !rfqAwarded ? 'ring-2 ring-primary shadow-lg' : ''}
                  ${isAccepted ? 'ring-2 ring-emerald-500 shadow-emerald-100 shadow-lg' : ''}
                  ${isRejected ? 'opacity-50' : ''}
                `}
              >
                {/* Best value ribbon */}
                {isBest && !rfqAwarded && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <span className="bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full shadow flex items-center gap-1">
                      <Trophy className="w-3 h-3" /> Best Value
                    </span>
                  </div>
                )}
                {isAccepted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <span className="bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Accepted
                    </span>
                  </div>
                )}

                <CardHeader className="pb-3 pt-6">
                  {/* Provider info */}
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                      {(q.providerName ?? 'P').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-sm truncate">{q.providerName ?? 'Provider'}</span>
                        {q.providerVerified && (
                          <Tooltip>
                            <TooltipTrigger>
                              <Shield className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent>Verified Provider</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground capitalize">{q.providerRole?.replace('_', ' ')}</div>
                      {q.providerLocation && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                          <MapPin className="w-3 h-3" />{q.providerLocation}
                        </div>
                      )}
                    </div>
                    <ScoreBadge score={q.score} />
                  </div>
                  <StarRating
                    rating={parseFloat(q.providerRating ?? '0')}
                    count={q.providerReviews ?? 0}
                  />
                </CardHeader>

                <CardContent className="flex-1 space-y-4">
                  {/* Price */}
                  <div className="text-center py-3 rounded-lg bg-muted/50">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="text-2xl font-bold text-foreground">
                        {parseFloat(q.price).toLocaleString()}
                      </span>
                      <span className="text-sm text-muted-foreground">{q.currency ?? 'EGP'}</span>
                      {isCheapest && (
                        <Tooltip>
                          <TooltipTrigger>
                            <TrendingDown className="w-4 h-4 text-emerald-500" />
                          </TooltipTrigger>
                          <TooltipContent>Lowest Price</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {rfqBudget && (
                      <div className={`text-xs mt-1 font-medium ${parseFloat(q.price) <= rfqBudget ? 'text-emerald-600' : 'text-red-500'}`}>
                        {parseFloat(q.price) <= rfqBudget
                          ? `EGP ${(rfqBudget - parseFloat(q.price)).toLocaleString()} under budget`
                          : `EGP ${(parseFloat(q.price) - rfqBudget).toLocaleString()} over budget`}
                      </div>
                    )}
                  </div>

                  {/* Score breakdown */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Info className="w-3 h-3" /> Match Score
                      </span>
                      <span className="font-semibold">{q.score}/100</span>
                    </div>
                    <Progress value={q.score} className="h-1.5" />
                  </div>

                  {/* Key details */}
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" /> Timeline
                      </span>
                      <span className="font-medium flex items-center gap-1">
                        {q.timeline ? `${q.timeline} days` : '—'}
                        {isFastest && q.timeline && (
                          <Tooltip>
                            <TooltipTrigger><Zap className="w-3.5 h-3.5 text-amber-500" /></TooltipTrigger>
                            <TooltipContent>Fastest Delivery</TooltipContent>
                          </Tooltip>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5" /> Warranty
                      </span>
                      <span className="font-medium">{q.warranty ?? '—'}</span>
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-muted-foreground flex items-center gap-1.5 shrink-0">
                        <DollarSign className="w-3.5 h-3.5" /> Payment
                      </span>
                      <span className="font-medium text-right text-xs leading-relaxed">{q.paymentTerms ?? '—'}</span>
                    </div>
                  </div>

                  {/* Notes */}
                  {q.notes && (
                    <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground leading-relaxed">
                      {q.notes}
                    </div>
                  )}

                  {/* Status badge */}
                  {isRejected && (
                    <div className="flex items-center justify-center gap-1.5 text-xs text-red-500 font-medium">
                      <XCircle className="w-3.5 h-3.5" /> Rejected
                    </div>
                  )}

                  {/* Action buttons */}
                  {isOwner && !rfqAwarded && !isRejected && !isAccepted && (
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        className="flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => setConfirmAccept(q)}
                        disabled={acceptMutation.isPending}
                      >
                        <ThumbsUp className="w-3.5 h-3.5" /> Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 gap-1.5 text-red-500 border-red-200 hover:bg-red-50"
                        onClick={() => setConfirmReject(q)}
                        disabled={rejectMutation.isPending}
                      >
                        <ThumbsDown className="w-3.5 h-3.5" /> Reject
                      </Button>
                    </div>
                  )}
                  {isOwner && rfqAwarded && isAccepted && (
                    <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-600 font-semibold pt-2">
                      <Award className="w-4 h-4" /> Awarded to this provider
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Tabular comparison (when 2+ quotes) */}
      {sorted.length >= 2 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Side-by-Side Comparison</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 text-muted-foreground font-medium w-32">Criteria</th>
                  {sorted.map(q => (
                    <th key={q.id} className="text-center py-2 px-3 font-semibold min-w-[140px]">
                      <div className="flex flex-col items-center gap-1">
                        <span className="truncate max-w-[120px]">{q.providerName ?? 'Provider'}</span>
                        <ScoreBadge score={q.score} />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {/* Price */}
                <tr>
                  <td className="py-2.5 pr-4 text-muted-foreground flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5" /> Price
                  </td>
                  {sorted.map(q => {
                    const cheapest = parseFloat(q.price) === lowestPrice;
                    return (
                      <td key={q.id} className={`text-center py-2.5 px-3 font-semibold ${cheapest ? 'text-emerald-600' : ''}`}>
                        {parseFloat(q.price).toLocaleString()} {q.currency ?? 'EGP'}
                        {cheapest && <div className="text-xs font-normal text-emerald-500">Lowest</div>}
                      </td>
                    );
                  })}
                </tr>
                {/* Timeline */}
                <tr className="bg-muted/20">
                  <td className="py-2.5 pr-4 text-muted-foreground flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" /> Timeline
                  </td>
                  {sorted.map(q => {
                    const fastest = q.timeline === fastestTimeline && fastestTimeline < 9999;
                    return (
                      <td key={q.id} className={`text-center py-2.5 px-3 font-medium ${fastest ? 'text-amber-600' : ''}`}>
                        {q.timeline ? `${q.timeline} days` : '—'}
                        {fastest && <div className="text-xs font-normal text-amber-500">Fastest</div>}
                      </td>
                    );
                  })}
                </tr>
                {/* Rating */}
                <tr>
                  <td className="py-2.5 pr-4 text-muted-foreground flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5" /> Rating
                  </td>
                  {sorted.map(q => (
                    <td key={q.id} className="text-center py-2.5 px-3">
                      <StarRating rating={parseFloat(q.providerRating ?? '0')} count={q.providerReviews ?? 0} />
                    </td>
                  ))}
                </tr>
                {/* Verified */}
                <tr className="bg-muted/20">
                  <td className="py-2.5 pr-4 text-muted-foreground flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" /> Verified
                  </td>
                  {sorted.map(q => (
                    <td key={q.id} className="text-center py-2.5 px-3">
                      {q.providerVerified
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                        : <XCircle className="w-4 h-4 text-muted-foreground/40 mx-auto" />}
                    </td>
                  ))}
                </tr>
                {/* Warranty */}
                <tr>
                  <td className="py-2.5 pr-4 text-muted-foreground flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5" /> Warranty
                  </td>
                  {sorted.map(q => (
                    <td key={q.id} className="text-center py-2.5 px-3 text-xs">{q.warranty ?? '—'}</td>
                  ))}
                </tr>
                {/* Payment Terms */}
                <tr className="bg-muted/20">
                  <td className="py-2.5 pr-4 text-muted-foreground flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5" /> Payment
                  </td>
                  {sorted.map(q => (
                    <td key={q.id} className="text-center py-2.5 px-3 text-xs">{q.paymentTerms ?? '—'}</td>
                  ))}
                </tr>
                {/* Status */}
                <tr>
                  <td className="py-2.5 pr-4 text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Status
                  </td>
                  {sorted.map(q => (
                    <td key={q.id} className="text-center py-2.5 px-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full
                        ${q.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' :
                          q.status === 'rejected' ? 'bg-red-100 text-red-600' :
                          'bg-blue-100 text-blue-700'}`}>
                        {q.status ?? 'pending'}
                      </span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Accept confirmation dialog */}
      <AlertDialog open={!!confirmAccept} onOpenChange={() => setConfirmAccept(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Accept Quotation?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to accept the quotation from <strong>{confirmAccept?.providerName ?? 'this provider'}</strong> for{' '}
              <strong>EGP {confirmAccept ? parseFloat(confirmAccept.price).toLocaleString() : ''}</strong>.
              All other quotations will be automatically rejected and the RFQ will be marked as awarded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => confirmAccept && acceptMutation.mutate({ quotationId: confirmAccept.id, rfqId })}
              disabled={acceptMutation.isPending}
            >
              {acceptMutation.isPending ? 'Accepting…' : 'Yes, Accept'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject confirmation dialog */}
      <AlertDialog open={!!confirmReject} onOpenChange={() => setConfirmReject(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Quotation?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to reject the quotation from <strong>{confirmReject?.providerName ?? 'this provider'}</strong>?
              This action can be undone by contacting support.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => confirmReject && rejectMutation.mutate({ quotationId: confirmReject.id, rfqId })}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? 'Rejecting…' : 'Yes, Reject'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
