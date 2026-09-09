import { useState } from 'react';
import { useRoute, Link } from 'wouter';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import { ChevronLeft, ChevronRight, LifeBuoy } from 'lucide-react';
import { supportLabel } from '@shared/supportTickets';

/**
 * ONE SUPPORT TICKET, AND ITS CONVERSATION.
 *
 * This is what `/support/:id` in every support notification points at. A
 * notification linking to a route that does not exist is worse than no
 * notification, so the route came with the notifications rather than after.
 *
 * WHAT IS NOT ON THIS PAGE: the internal notes support staff write about the
 * ticket. They live in `adminNotes` and are read by a separate permissioned
 * procedure - there is no path by which this component could render one, which
 * is the point of separating them by TABLE rather than by a visibility column.
 */
export default function SupportTicketDetail() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [, params] = useRoute('/support/:id');
  const ticketId = Number(params?.id ?? 0);
  const utils = trpc.useUtils();

  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [attaching, setAttaching] = useState(false);

  const detail = trpc.support.ticket.useQuery(
    { ticketId },
    { retry: false, enabled: Number.isInteger(ticketId) && ticketId > 0 },
  );

  const reply = trpc.support.reply.useMutation({
    onSuccess: () => {
      setBody(''); setError('');
      void utils.support.ticket.invalidate({ ticketId });
      void utils.support.myTickets.invalidate();
    },
    onError: e => setError(e.message),
  });

  const attach = trpc.support.attach.useMutation({
    onSuccess: () => { setError(''); void utils.support.ticket.invalidate({ ticketId }); },
    onError: e => setError(e.message),
    onSettled: () => setAttaching(false),
  });

  /**
   * ATTACHING A FILE. Read as base64 in the browser and sent through the same
   * `support.attach` the server validates: the bytes are checked against the
   * declared type at the endpoint, so a renamed executable is refused there
   * rather than trusted here.
   *
   * A deployment with no object store answers with an honest refusal, which is
   * surfaced verbatim instead of being reported as a generic failure.
   */
  const onFile = async (file: File | null | undefined) => {
    if (!file) return;
    setAttaching(true);
    try {
      const buffer = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      attach.mutate({
        ticketId,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        dataBase64: btoa(binary),
      });
    } catch {
      setAttaching(false);
      setError(ar ? 'تعذّر قراءة الملف.' : 'That file could not be read.');
    }
  };

  const Back = ar ? ChevronRight : ChevronLeft;
  const ticket = detail.data?.ticket;
  const closed = ticket?.status === 'closed';

  return (
    <div className="container max-w-3xl py-8 space-y-6" dir={ar ? 'rtl' : 'ltr'}>
      <Button variant="ghost" size="sm" className="gap-1.5" asChild>
        <Link href="/support"><Back className="h-4 w-4" />{ar ? 'كل التذاكر' : 'All tickets'}</Link>
      </Button>

      {detail.isError && (
        <LoadFailed {...loadFailedCopy(ar)} onRetry={() => void detail.refetch()} />
      )}
      {detail.isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {ar ? 'جارٍ التحميل…' : 'Loading…'}
        </p>
      )}

      {ticket && (
        <>
          <Card data-testid="support-ticket-header">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <LifeBuoy className="h-5 w-5" />
                    {ticket.subject}
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {ticket.reference} · {supportLabel('category', ticket.category, lang)}
                  </p>
                </div>
                <Badge variant="outline" data-testid="support-ticket-status">
                  {supportLabel('status', ticket.status, lang)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm">{ticket.description}</p>
              {/* The resolution, when there is one. A resolved ticket that
                  shows only a status word tells the customer nothing about
                  what was actually done. */}
              {(detail.data?.attachments ?? []).length > 0 && (
                <ul className="mt-4 space-y-1 text-sm" data-testid="support-attachments">
                  {((detail.data?.attachments ?? []) as Array<{ id: number; fileName: string; url: string }>).map(file => (
                    <li key={file.id}>
                      {/* The server builds the URL - see ticketThread. */}
                      <a className="text-primary underline" href={file.url} target="_blank" rel="noreferrer">
                        {file.fileName}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {ticket.resolutionNotes && (
                <div className="mt-4 rounded-xl border bg-emerald-50/50 p-3" data-testid="support-resolution">
                  <p className="text-xs font-medium text-emerald-800">
                    {ar ? 'ما تم' : 'What was done'}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{ticket.resolutionNotes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">{ar ? 'المحادثة' : 'Conversation'}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(detail.data?.messages ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground" data-testid="support-thread-empty">
                  {ar ? 'لا توجد ردود بعد.' : 'No replies yet.'}
                </p>
              )}
              {((detail.data?.messages ?? []) as Array<{ id: number; authorSide: string; authorName: string | null; body: string }>).map(message => (
                <div
                  key={message.id}
                  className={`rounded-xl border p-3 ${message.authorSide === 'support' ? 'bg-sky-50/60' : 'bg-muted/20'}`}
                  data-testid={`support-message-${message.id}`}
                >
                  <p className="text-xs font-medium">
                    {message.authorSide === 'support'
                      ? (ar ? 'فريق دعم BuildHub' : 'BuildHub support')
                      : message.authorName}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{message.body}</p>
                </div>
              ))}

              {/* A CLOSED TICKET SAYS SO rather than offering a box that will
                  be refused. Closed is terminal on the server; the UI must not
                  imply otherwise. */}
              {closed ? (
                <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground" data-testid="support-closed-note">
                  {ar
                    ? 'هذه التذكرة مغلقة. افتح تذكرة جديدة وأشر إلى هذا الرقم.'
                    : 'This ticket is closed. Open a new one and reference this number.'}
                </p>
              ) : (
                <div className="space-y-2">
                  <Textarea
                    aria-label={ar ? 'ردك' : 'Your reply'}
                    placeholder={ar ? 'اكتب ردك…' : 'Write your reply…'}
                    rows={4}
                    value={body}
                    onChange={event => setBody(event.target.value)}
                    data-testid="support-reply-body"
                  />
                  {error && <p className="text-sm text-rose-600" data-testid="support-reply-error">{error}</p>}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => reply.mutate({ ticketId, body })}
                      disabled={reply.isPending || body.trim().length === 0}
                      data-testid="support-reply-submit"
                    >
                      {reply.isPending ? (ar ? 'جارٍ الإرسال…' : 'Sending…') : (ar ? 'إرسال الرد' : 'Send reply')}
                    </Button>
                    <label className="cursor-pointer text-sm text-primary underline">
                      {attaching ? (ar ? 'جارٍ الرفع…' : 'Uploading…') : (ar ? 'إرفاق ملف' : 'Attach a file')}
                      <input
                        type="file"
                        className="hidden"
                        accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
                        disabled={attaching}
                        onChange={event => void onFile(event.target.files?.[0])}
                        data-testid="support-attach-input"
                      />
                    </label>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
