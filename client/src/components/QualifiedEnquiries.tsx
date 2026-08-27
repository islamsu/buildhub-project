import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { rfqCategoryLabel } from '@shared/rfqCategories';
import { Calendar, DollarSign, FileText, Inbox, Lock, MapPin, Paperclip, Unlock } from 'lucide-react';
import { useState } from 'react';

/**
 * Phase 4B.3: the vendor's qualified-enquiry inbox.
 *
 * Listing eligible RFQs is free - no allowance is consumed by browsing. A
 * credit is spent only when the vendor opens one for the first time, and the
 * server is the sole authority on whether that is allowed. This component
 * never decides eligibility or remaining allowance itself; it renders what the
 * server returns, and surfaces the server's own message when access is denied.
 *
 * CLOSURE PASS: "View details" used to end in a TOAST. The vendor spent a lead
 * credit, the server returned the full RFQ in the same response, and the client
 * threw it away - so the one thing the credit buys was never shown. The detail
 * the server already sends is now rendered.
 */
export default function QualifiedEnquiries() {
  const { lang, t } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.rfq.eligible.useQuery();

  // The RFQ the server returned when the credit was spent. Held here rather
  // than refetched: rfq.get is requester-scoped, so a vendor cannot read the
  // detail through it, and this response IS the vendor's authorized copy.
  const [detail, setDetail] = useState<Record<string, any> | null>(null);

  const open = trpc.rfq.openEnquiry.useMutation({
    onSuccess: result => {
      toast.success(t(result.alreadyConsumed ? 'enquiries.reopenedToast' : 'enquiries.openedToast'));
      setDetail(result.rfq as Record<string, any>);
      utils.rfq.eligible.invalidate();
      utils.billing.myEnquiryUsage.invalidate();
    },
    // The server owns the refusal reason - limit reached, not eligible, or not
    // found. We show its message rather than guessing one client-side.
    onError: error => toast.error(error.message),
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground py-4">{t('common.loading')}</div>;
  }
  if (!data) return null;

  const { items, usage } = data;
  const allowance = usage.allowance;
  const unlimited = allowance === null;
  const pct = allowance === null || allowance === 0 ? 0 : Math.min(100, (usage.used / allowance) * 100);
  const resets = new Date(usage.resetsAt).toLocaleDateString(ar ? 'ar-EG' : 'en-US');

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Inbox className="w-4 h-4" />
          {t('enquiries.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Usage */}
        <div className="rounded-lg border p-3 mb-4">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{t('enquiries.thisMonth')}</span>
            <span className="font-semibold">
              {unlimited ? `${usage.used} · ${t('enquiries.unlimited')}` : `${usage.used} / ${allowance}`}
            </span>
          </div>
          {!unlimited && <Progress value={pct} className="h-1.5 mt-2" />}
          <p className="text-xs text-muted-foreground mt-2">
            {unlimited
              ? t('enquiries.unlimitedNote')
              : usage.limitReached
                ? `${t('enquiries.limitReachedNote')} ${t('enquiries.resetsOn')} ${resets}`
                : `${t('enquiries.remaining')}: ${usage.remaining} · ${t('enquiries.resetsOn')} ${resets}`}
          </p>
        </div>

        {items.length === 0 && (
          <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
            {t('enquiries.empty')}
          </div>
        )}

        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">{item.title}</span>
                  {item.category && (
                    <Badge variant="outline" className="text-[10px]">
                      {rfqCategoryLabel(item.category, lang)}
                    </Badge>
                  )}
                  {item.alreadyOpened && (
                    <Badge className="bg-emerald-100 text-emerald-700 border-0 text-[10px]">
                      <Unlock className="w-2.5 h-2.5 me-0.5" />{t('enquiries.opened')}
                    </Badge>
                  )}
                </div>
                {item.location && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <MapPin className="w-3 h-3 shrink-0" />{item.location}
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant={item.alreadyOpened ? 'outline' : 'default'}
                className="gap-1.5 shrink-0"
                // Only a genuinely-blocking state disables the control: an
                // already-opened lead costs nothing to reopen even at the limit.
                disabled={open.isPending || (usage.limitReached && !item.alreadyOpened)}
                onClick={() => open.mutate({ rfqId: item.id })}
              >
                {usage.limitReached && !item.alreadyOpened
                  ? <><Lock className="w-3.5 h-3.5" />{t('enquiries.limitReached')}</>
                  : t('enquiries.viewDetails')}
              </Button>
            </div>
          ))}
        </div>
      </CardContent>

      <Dialog open={detail !== null} onOpenChange={openState => !openState && setDetail(null)}>
        <DialogContent className="max-w-lg" dir={ar ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="text-start">{detail?.title ?? ''}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-start">
              <div className="flex flex-wrap gap-2">
                {detail.category && <Badge variant="secondary">{rfqCategoryLabel(detail.category, lang)}</Badge>}
                {detail.status && <Badge variant="outline">{detail.status}</Badge>}
              </div>
              {detail.description && (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{detail.description}</p>
              )}
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                {detail.budget != null && (
                  <span className="flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {t('common.egp')} {Number(detail.budget).toLocaleString()}
                  </span>
                )}
                {detail.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{detail.location}
                  </span>
                )}
                {detail.deadline && (
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {new Date(detail.deadline).toLocaleDateString(ar ? 'ar-EG' : 'en-GB')}
                  </span>
                )}
              </div>
              {/* Attachments are authorized for a vendor who has consumed the
                  enquiry - the storage proxy resolves the key back to the RFQ
                  and looks for that vendor's qualifiedEnquiries row. */}
              {parseAttachments(detail.attachments).length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Paperclip className="h-3.5 w-3.5" />{t('enquiries.attachments')}
                  </p>
                  {parseAttachments(detail.attachments).map((file, index) => (
                    <a
                      key={file.key ?? index}
                      href={file.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 text-sm text-primary underline underline-offset-2"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0" />{file.name ?? file.key}
                    </a>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">{t('enquiries.detailNote')}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * `rfqs.attachments` is a JSON-encoded text column, so it can arrive as a
 * string or already parsed depending on the driver, and it may be absent
 * entirely. Anything that is not an array of objects yields nothing rather
 * than throwing inside a render.
 */
function parseAttachments(raw: unknown): { key?: string; url?: string; name?: string }[] {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
}
