import { useParams, Link } from 'wouter';
import { trpc } from '@/lib/trpc';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/_core/hooks/useAuth';
import { getRolePlatformPath } from '@/lib/rolePlatform';
import { isComplianceRole } from '@shared/compliance';
import Navbar from '@/components/Navbar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import QuotationComparison from '@/components/QuotationComparison';
import {
  ArrowLeft, Clock, DollarSign, FileText, MapPin, Lock, Package,
} from 'lucide-react';

/**
 * THE RFQ DETAIL PAGE.
 *
 * BuildHub had none. `/rfq` listed cards and `/rfq/:id` was not a route at all,
 * so every link to one - including two the AI offered contractors - fell
 * through to the 404 page. The people an RFQ is addressed to could read a
 * summary card and nothing more.
 *
 * IT IS ROLE-AWARE, and the difference is not cosmetic:
 *
 *   THE OWNER sees the full record they wrote, its attachments, and every
 *   response, with the comparison and award actions.
 *
 *   A PROVIDER sees exactly what the open feed already shows them, plus a
 *   route to the surface where the credit-gated full brief and the quotation
 *   form live. It does NOT show attachments, and it does NOT charge anything:
 *   reviewing is free, and the credit buys the full detail. That separation is
 *   the whole point of letting a supplier read before they buy.
 *
 *   ANYONE ELSE gets the same not-found as a nonexistent id.
 */

const STATUS_TONE: Record<string, string> = {
  open: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed: 'bg-slate-100 text-slate-600 border-slate-200',
  awarded: 'bg-blue-50 text-blue-700 border-blue-200',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
};

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

export default function RFQDetail() {
  const { id } = useParams<{ id: string }>();
  const rfqId = Number(id);
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { user, isAuthenticated } = useAuth();
  const valid = Number.isFinite(rfqId) && rfqId > 0;

  // The summary is what ANY authenticated caller may see - the same column
  // allowlist the open feed returns. It is the only read a provider gets.
  const summary = trpc.rfq.summary.useQuery({ id: rfqId }, { enabled: isAuthenticated && valid, retry: false });

  const isOwner = Boolean(summary.data && user && summary.data.requesterId === (user as { id?: number }).id);

  // The owner's full record, including attachments. Scoped by requesterId on
  // the server, so this simply fails for anyone else - it is not the thing
  // deciding whether they may see it.
  const owned = trpc.rfq.get.useQuery({ id: rfqId }, { enabled: isOwner, retry: false });

  const account = user as { userRole?: string; onboardingStatus?: string } | null;
  const providerRoles = ['contractor', 'supplier', 'engineer', 'architect', 'project_manager'];
  const isProvider = isAuthenticated && providerRoles.includes(account?.userRole ?? '');
  /**
   * A provider whose verification is not approved yet.
   *
   * The response surface is gated on this server-side and redirects them to
   * `/compliance`, so offering "Continue to respond" sent them somewhere they
   * had not asked to go, with nothing connecting the two. Found by following
   * the button as an unapproved supplier in a real browser.
   *
   * This is presentation, not authorization: the gate is the redirect and the
   * `approvedProviderProcedure` behind it, both of which still hold whatever
   * this renders.
   */
  const awaitingApproval = isProvider
    && isComplianceRole(account?.userRole)
    && account?.onboardingStatus !== 'approved';

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="mx-auto max-w-3xl px-4 py-20 text-center">
          <Lock className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
          <p className="font-medium">{ar ? 'سجّل الدخول لعرض هذا الطلب' : 'Sign in to view this request'}</p>
          <Link href="/auth?mode=login">
            <Button className="mt-4">{ar ? 'تسجيل الدخول' : 'Sign in'}</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (summary.isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <p className="mx-auto max-w-3xl px-4 py-20 text-center text-muted-foreground">
          {ar ? 'جاري التحميل…' : 'Loading…'}
        </p>
      </div>
    );
  }

  if (summary.isError || !summary.data) {
    // The same answer for "no such RFQ" and "not one you may see", so the page
    // is not a way to learn which ids exist.
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="mx-auto max-w-3xl px-4 py-20 text-center" data-testid="rfq-detail-notfound">
          <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
          <p className="font-medium">{ar ? 'هذا الطلب غير متاح' : 'This request is not available'}</p>
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

  const rfq = summary.data;
  const full = isOwner ? owned.data : null;
  const attachments = parseAttachments((full as { attachments?: unknown } | null)?.attachments);
  const status = rfq.status ?? 'open';
  const isOpen = status === 'open';

  return (
    <div className="min-h-screen bg-background" dir={ar ? 'rtl' : 'ltr'}>
      <Navbar />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <Link href="/rfq">
          <Button variant="ghost" size="sm" className="mb-4 gap-2" data-testid="rfq-detail-back">
            <ArrowLeft className="h-4 w-4" />{ar ? 'كل الطلبات' : 'All requests'}
          </Button>
        </Link>

        {/* ── The record ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-xl" data-testid="rfq-detail-title">{rfq.title}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {ar ? 'رقم الطلب' : 'Request'} #{rfq.id}
                  {rfq.createdAt && ` · ${new Date(rfq.createdAt).toLocaleDateString(ar ? 'ar-EG' : 'en-US')}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[status] ?? STATUS_TONE.open}`}
                  data-testid="rfq-detail-status"
                >
                  {status}
                </span>
                {isOwner && (
                  <Badge variant="outline" className="text-xs" data-testid="rfq-detail-owner">
                    {ar ? 'طلبك' : 'Your request'}
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            {rfq.description && (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground" data-testid="rfq-detail-description">
                {rfq.description}
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {rfq.category && (
                <Detail icon={<FileText className="h-4 w-4" />} label={ar ? 'الفئة' : 'Category'} value={rfq.category} />
              )}
              {rfq.location && (
                <Detail icon={<MapPin className="h-4 w-4" />} label={ar ? 'الموقع' : 'Location'} value={rfq.location} />
              )}
              {rfq.budget && (
                <Detail
                  icon={<DollarSign className="h-4 w-4" />}
                  label={ar ? 'الميزانية' : 'Budget'}
                  value={`${Number(rfq.budget).toLocaleString()}`}
                />
              )}
              {rfq.deadline && (
                <Detail
                  icon={<Clock className="h-4 w-4" />}
                  label={ar ? 'الموعد النهائي' : 'Deadline'}
                  value={new Date(rfq.deadline).toLocaleDateString(ar ? 'ar-EG' : 'en-US')}
                />
              )}
            </div>

            {/* Attachments are the OWNER's view only. For a provider they are
                behind the qualified enquiry, which is what the credit buys. */}
            {isOwner && attachments.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">{ar ? 'المرفقات' : 'Attachments'}</p>
                <div className="flex flex-wrap gap-2" data-testid="rfq-detail-attachments">
                  {attachments.map(att => (
                    <a
                      key={att.key} href={att.url} target="_blank" rel="noreferrer"
                      className="flex max-w-[200px] items-center gap-1.5 rounded-md border bg-muted/30 px-2.5 py-2 text-xs transition-colors hover:bg-muted/60"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-red-500" />
                      <span className="truncate">{att.name}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* A provider is told plainly what they are NOT seeing and what it
                costs, rather than being shown a gap they have to guess at. */}
            {!isOwner && isProvider && (
              <div className="rounded-lg border bg-muted/30 p-4" data-testid="rfq-detail-provider-panel">
                <p className="text-sm font-medium">
                  {ar ? 'الرد على هذا الطلب' : 'Responding to this request'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {ar
                    ? 'عرض هذا الطلب مجاني. فتح الطلب المؤهل يكشف الملف الكامل والمرفقات ويستهلك رصيداً واحداً من رصيدك الشهري، ويتطلب أن يكون الطلب ضمن فئات خدماتك المعلنة.'
                    : 'Viewing this request is free. Opening the qualified enquiry reveals the full brief and its attachments, uses one of your monthly credits, and requires the request to fall inside your declared service categories.'}
                </p>
                {awaitingApproval ? (
                  <div className="mt-3" data-testid="rfq-detail-awaiting-approval">
                    <p className="text-sm font-medium text-muted-foreground">
                      {ar
                        ? 'لا يمكنك الرد على الطلبات حتى تكتمل مراجعة توثيق حسابك.'
                        : 'You cannot respond to requests until your account verification has been reviewed.'}
                    </p>
                    <Link href="/compliance">
                      <Button variant="outline" className="mt-3 gap-2">
                        <Package className="h-4 w-4" />
                        {ar ? 'أكمل التوثيق' : 'Complete verification'}
                      </Button>
                    </Link>
                  </div>
                ) : isOpen ? (
                  // The id travels with them. This used to be a bare
                  // `/provider`, which landed a provider on a dashboard with no
                  // memory of which request they had just been reading.
                  //
                  // It addresses `/platform/:role` DIRECTLY rather than
                  // `/provider`, which is a legacy compatibility shim that
                  // redirects here. Routing a new feature through a redirect
                  // meant one extra place for the address to be rewritten - and
                  // the first version of that shim dropped the query string,
                  // so the id vanished between the click and the destination.
                  <Link href={`${getRolePlatformPath((user as { userRole?: string } | null)?.userRole)}?rfq=${rfq.id}`}>
                    <Button className="mt-3 gap-2" data-testid="rfq-detail-respond">
                      <Package className="h-4 w-4" />
                      {ar ? 'المتابعة إلى الردود' : 'Continue to respond'}
                    </Button>
                  </Link>
                ) : (
                  <p className="mt-3 text-sm font-medium text-muted-foreground">
                    {ar
                      ? 'هذا الطلب لم يعد مفتوحاً للردود.'
                      : 'This request is no longer open for responses.'}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── The owner's responses ──────────────────────────────────── */}
        {isOwner && (
          <div className="mt-6" data-testid="rfq-detail-quotations">
            <QuotationComparison
              rfqId={rfq.id}
              rfqTitle={rfq.title}
              rfqBudget={rfq.budget ? Number(rfq.budget) : undefined}
              rfqStatus={status}
              isOwner
              onClose={() => undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border p-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}
