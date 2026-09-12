import { useState } from 'react';
import { useParams, Link } from 'wouter';
import { OpenDisputeDialog } from '@/components/OpenDisputeDialog';
import { trpc } from '@/lib/trpc';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/_core/hooks/useAuth';
import Navbar from '@/components/Navbar';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, BadgeCheck, CalendarClock, DollarSign, FileText, Lock,
  MapPin, Paperclip, ShieldCheck, Wallet, Flag,
} from 'lucide-react';

/**
 * THE QUOTATION DETAIL PAGE.
 *
 * A quotation is the most commercially consequential record BuildHub holds - it
 * is a price a company has committed to - and it had no page. The customer saw
 * it as a row inside their RFQ; the supplier saw it as a tile in their
 * workspace. Neither could open it, link to it, or bookmark it, and the
 * notification announcing a new bid could only point at the RFQ and leave the
 * reader to find it.
 *
 * ONE PAGE, TWO READERS. `rfq.quotation` decides which of them is asking and
 * returns different columns accordingly; this renders whichever shape it gets
 * rather than deciding anything itself. The customer sees the supplier's
 * contact address because the bid is addressed to them. The supplier reading
 * their own bid does not, because a quotation is not a channel to the customer.
 *
 * A rival supplier gets the not-found state, and so does a stranger, and so
 * does a genuinely missing id - all three are indistinguishable on purpose.
 * Quotation ids are sequential, so "that one exists but is not yours" would
 * tell a bidder how many competitors they have.
 */

type Attachment = { key: string; url: string; name: string; type: string };

function parseAttachments(value: unknown): Attachment[] {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? (parsed as Attachment[]).filter(a => a?.url && a?.name) : [];
  } catch {
    return [];
  }
}

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
};

function statusLabel(status: string, ar: boolean): string {
  if (!ar) return status;
  return { pending: 'قيد المراجعة', accepted: 'مقبول', rejected: 'مرفوض' }[status] ?? status;
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium break-words">{value}</p>
      </div>
    </div>
  );
}

export default function QuotationDetail() {
  const { id } = useParams<{ id: string }>();
  const quotationId = Number(id);
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { isAuthenticated } = useAuth();
  const valid = Number.isFinite(quotationId) && quotationId > 0;
  const [disputeOpen, setDisputeOpen] = useState(false);

  const query = trpc.rfq.quotation.useQuery(
    { id: quotationId },
    { enabled: isAuthenticated && valid, retry: false },
  );

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background" dir={ar ? 'rtl' : 'ltr'}>
        <Navbar />
        <div className="mx-auto max-w-3xl px-4 pt-24 pb-16 text-center">
          <Lock className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
          <h1 className="text-xl font-semibold" data-testid="quotation-detail-title">
            {ar ? 'سجّل الدخول لعرض هذا العرض' : 'Sign in to view this quotation'}
          </h1>
          <Link href="/auth?mode=login">
            <Button className="mt-4">{ar ? 'تسجيل الدخول' : 'Sign in'}</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="min-h-screen bg-background" dir={ar ? 'rtl' : 'ltr'}>
        <Navbar />
        <p className="mx-auto max-w-3xl px-4 pt-24 pb-16 text-center text-muted-foreground">
          {ar ? 'جاري التحميل…' : 'Loading…'}
        </p>
      </div>
    );
  }

  if (query.isError || !query.data) {
    // Deliberately the same answer for "no such quotation", "not yours" and
    // "a rival's bid on the RFQ you also bid on".
    return (
      <div className="min-h-screen bg-background" dir={ar ? 'rtl' : 'ltr'}>
        <Navbar />
        <div className="mx-auto max-w-3xl px-4 pt-24 pb-16 text-center" data-testid="quotation-detail-notfound">
          <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
          <h1 className="font-medium" data-testid="quotation-detail-title">
            {ar ? 'هذا العرض غير متاح' : 'This quotation is not available'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ar
              ? 'ربما تم حذفه، أو ليس لديك صلاحية عرضه.'
              : 'It may have been removed, or it is not one you have access to.'}
          </p>
          <Link href="/rfq">
            <Button variant="outline" className="mt-4 gap-2">
              <ArrowLeft className="h-4 w-4" />{ar ? 'كل الطلبات' : 'All requests'}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const q = query.data;
  const attachments = parseAttachments(q.attachments);
  const status = q.status ?? 'pending';
  const isRequester = q.viewerRole === 'requester';
  const currency = q.currency ?? 'EGP';
  const money = Number(q.price).toLocaleString(ar ? 'ar-EG' : 'en-US');

  return (
    <div className="min-h-screen bg-background" dir={ar ? 'rtl' : 'ltr'}>
      <Navbar />
      {/* pt-24, not py-8. The navbar is `fixed h-16`, so a page that starts its
          own padding from the top of the document puts its first control
          underneath it - elementFromPoint returns the navbar and the click
          never lands. RFQDetail shipped with exactly that defect. */}
      <div className="mx-auto max-w-4xl px-4 pt-24 pb-16">
        <Link href={`/rfq/${q.rfqId}`}>
          <Button variant="ghost" size="sm" className="mb-4 gap-2" data-testid="quotation-detail-back">
            <ArrowLeft className="h-4 w-4" />
            {ar ? 'العودة إلى الطلب' : 'Back to the request'}
          </Button>
        </Link>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                {/* The page's own h1. CardTitle renders a div and takes no
                    asChild, so the heading is declared here with its type
                    styles - the same approach RFQDetail settled on. */}
                <h1 className="text-xl font-semibold leading-none" data-testid="quotation-detail-title">
                  {ar ? 'عرض سعر' : 'Quotation'} #{q.id}
                </h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  {ar ? 'على الطلب' : 'On request'}{' '}
                  <Link href={`/rfq/${q.rfqId}`} className="underline underline-offset-2" data-testid="quotation-detail-rfq-link">
                    #{q.rfqId}{q.rfqTitle ? ` · ${q.rfqTitle}` : ''}
                  </Link>
                  {q.createdAt && ` · ${new Date(q.createdAt).toLocaleDateString(ar ? 'ar-EG' : 'en-US')}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[status] ?? STATUS_TONE.pending}`}
                  data-testid="quotation-detail-status"
                >
                  {statusLabel(status, ar)}
                </span>
                {q.revisionNumber > 1 && (
                  <Badge variant="outline" className="text-xs" data-testid="quotation-detail-revision">
                    {ar ? `مراجعة ${q.revisionNumber}` : `Revision ${q.revisionNumber}`}
                  </Badge>
                )}
                {!isRequester && (
                  <Badge variant="outline" className="text-xs" data-testid="quotation-detail-mine">
                    {ar ? 'عرضك' : 'Your quotation'}
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* ── The price, which is the point of the record ──────────── */}
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground">{ar ? 'السعر المعروض' : 'Quoted price'}</p>
              <p className="text-2xl font-semibold" data-testid="quotation-detail-price">
                {money} <span className="text-base font-normal text-muted-foreground">{currency}</span>
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {q.timeline != null && (
                <Detail
                  icon={<CalendarClock className="h-4 w-4" />}
                  label={ar ? 'مدة التنفيذ' : 'Timeline'}
                  value={ar ? `${q.timeline} يوم` : `${q.timeline} days`}
                />
              )}
              {q.warranty && (
                <Detail
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label={ar ? 'الضمان' : 'Warranty'}
                  value={q.warranty}
                />
              )}
              {q.validUntil && (
                <Detail
                  icon={<CalendarClock className="h-4 w-4" />}
                  label={ar ? 'صالح حتى' : 'Valid until'}
                  value={new Date(q.validUntil).toLocaleDateString(ar ? 'ar-EG' : 'en-US')}
                />
              )}
              {q.paymentTerms && (
                <Detail
                  icon={<Wallet className="h-4 w-4" />}
                  label={ar ? 'شروط الدفع' : 'Payment terms'}
                  value={q.paymentTerms}
                />
              )}
              {q.rfqCategory && (
                <Detail
                  icon={<FileText className="h-4 w-4" />}
                  label={ar ? 'التصنيف' : 'Category'}
                  value={q.rfqCategory}
                />
              )}
            </div>

            {q.commercialTerms && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">{ar ? 'الشروط التجارية' : 'Commercial terms'}</p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground" data-testid="quotation-detail-commercial-terms">
                  {q.commercialTerms}
                </p>
              </div>
            )}

            {q.notes && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">{ar ? 'ملاحظات المورّد' : 'Supplier notes'}</p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground" data-testid="quotation-detail-notes">
                  {q.notes}
                </p>
              </div>
            )}

            {/* ── Who quoted ──────────────────────────────────────────── */}
            {q.provider && (
              <div className="rounded-xl border p-4" data-testid="quotation-detail-provider">
                <p className="mb-2 text-xs text-muted-foreground">{ar ? 'مقدّم العرض' : 'Quoted by'}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/vendor/${q.provider.id}`} className="font-medium underline underline-offset-2">
                    {q.provider.name ?? `#${q.provider.id}`}
                  </Link>
                  {q.provider.verified && (
                    <Badge variant="secondary" className="gap-1 text-xs">
                      <BadgeCheck className="h-3 w-3" />{ar ? 'موثّق' : 'Verified'}
                    </Badge>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  {q.provider.location && (
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{q.provider.location}</span>
                  )}
                  {/* Present for the customer evaluating the bid, absent for the
                      supplier reading their own - the server decides which, and
                      returns null rather than the address in the second case. */}
                  {q.provider.email && (
                    <a href={`mailto:${q.provider.email}`} className="flex items-center gap-1 underline underline-offset-2" data-testid="quotation-detail-provider-email">
                      <DollarSign className="h-3 w-3" />{q.provider.email}
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* ── Supporting files ────────────────────────────────────── */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Paperclip className="h-3.5 w-3.5" />{ar ? 'المرفقات' : 'Attachments'}
              </p>
              {attachments.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="quotation-detail-no-attachments">
                  {ar ? 'لا توجد مرفقات مع هذا العرض.' : 'No files were attached to this quotation.'}
                </p>
              ) : (
                <ul className="space-y-2" data-testid="quotation-detail-attachments">
                  {attachments.map(file => (
                    <li key={file.key}>
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 text-sm underline underline-offset-2"
                      >
                        <FileText className="h-4 w-4 shrink-0" />
                        <span className="break-all">{file.name}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* The decision itself stays on the RFQ, where the customer can see
                every bid side by side. Duplicating accept/reject here would let
                somebody award a contract without ever comparing it to the
                alternatives. */}
            {isRequester && (
              <div className="rounded-xl border border-dashed p-4">
                <p className="text-sm text-muted-foreground">
                  {ar
                    ? 'قرار القبول أو الرفض يتم من صفحة الطلب، حيث تظهر كل العروض جنباً إلى جنب.'
                    : 'Accept and reject live on the request, where every quotation is shown side by side.'}
                </p>
                <Link href={`/rfq/${q.rfqId}`}>
                  <Button variant="outline" size="sm" className="mt-3 gap-2" data-testid="quotation-detail-compare">
                    {ar ? 'قارن كل العروض' : 'Compare all quotations'}
                  </Button>
                </Link>
              </div>
            )}

            {/*
              ── RAISING A DISPUTE ABOUT THIS QUOTATION ─────────────────────
              Reaching this page at all means the server has already decided
              the reader is the requester or the supplier - `rfq.quotation` is
              scoped to those two - which are exactly the two parties of a
              quotation dispute. A competitor who also bid on the RFQ never got
              here, and would be refused by the eligibility service anyway.

              Before this, a supplier who disagreed with a quotation had
              nothing to dispute against: `disputes.create` could only name a
              project.
            */}
            <div className="rounded-xl border border-dashed p-4">
              <p className="text-sm font-medium">{ar ? 'مشكلة بشأن هذا العرض؟' : 'A problem with this quotation?'}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {ar
                  ? 'يمكنك فتح نزاع بشأنه. يصل إلى فريق الدعم، ويُبلَّغ الطرف الآخر.'
                  : 'You can raise a dispute about it. Support reviews it, and the other party is told.'}
              </p>
              <Button
                variant="outline" size="sm" className="mt-3 gap-2"
                data-testid="quotation-open-dispute"
                onClick={() => setDisputeOpen(true)}
              >
                <Flag className="h-4 w-4" />{ar ? 'فتح نزاع' : 'Open a dispute'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <OpenDisputeDialog
        subjectType="quotation" subjectId={quotationId}
        open={disputeOpen} onOpenChange={setDisputeOpen}
      />
    </div>
  );
}
