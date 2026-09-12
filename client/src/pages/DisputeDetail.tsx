import { useRef, useState } from 'react';
import { Link, useRoute } from 'wouter';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import { ArrowLeft, Paperclip } from 'lucide-react';
import { disputeLabels, statusTone } from '@/lib/disputeCopy';
import {
  DISPUTE_EVIDENCE_CONTENT_TYPES, DISPUTE_OPEN_STATUSES,
  MAX_DISPUTE_EVIDENCE_SIZE, MAX_DISPUTE_MESSAGE_LENGTH,
} from '@shared/disputes';

/**
 * ONE DISPUTE, FOR THE PEOPLE IN IT.
 *
 * There was no such page. `disputes.get` had no caller, the notification the
 * respondent receives links to `/disputes/:id`, and that route did not exist -
 * so being named in a dispute meant being told about a page that was not there.
 *
 * WHAT THIS PAGE DOES NOT SHOW: the administrator's internal notes, which live
 * in a different table entirely and are not in this procedure's response, and
 * the rest of the subject's cast, which is not a party's business - naming who
 * else bid on an RFQ would leak the bidder list to the loser.
 */
export default function DisputeDetail() {
  const [, params] = useRoute('/disputes/:id');
  const disputeId = Number(params?.id ?? 0);
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const label = disputeLabels(ar);
  const { user } = useAuth();

  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [uploadError, setUploadError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const detail = trpc.disputes.get.useQuery({ disputeId }, { enabled: disputeId > 0, retry: false });
  const utils = trpc.useUtils();
  const refresh = () => {
    void utils.disputes.get.invalidate({ disputeId });
    void utils.disputes.myDisputes.invalidate();
  };
  const post = trpc.disputes.postMessage.useMutation({ onSuccess: () => { setMessage(''); refresh(); } });
  const withdraw = trpc.disputes.withdraw.useMutation({ onSuccess: () => { setReason(''); refresh(); } });
  const reopen = trpc.disputes.reopen.useMutation({ onSuccess: () => { setReason(''); refresh(); } });
  const addEvidence = trpc.disputes.addEvidence.useMutation({ onSuccess: refresh });
  const removeEvidence = trpc.disputes.removeEvidence.useMutation({ onSuccess: refresh });

  if (detail.isError) {
    /*
     * NOT_FOUND covers BOTH a dispute that does not exist and one this account
     * may not read - deliberately, so an id cannot be probed for existence.
     * The page says the same thing for both, because saying anything more
     * precise would undo that.
     */
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <p className="text-sm text-muted-foreground" data-testid="dispute-not-found">
              {ar
                ? 'لا يوجد نزاع بهذا الرقم يمكنك الاطلاع عليه.'
                : 'There is no dispute with that number that you can view.'}
            </p>
            <Link href="/disputes" className="text-sm underline underline-offset-2">
              {ar ? 'العودة إلى النزاعات' : 'Back to your disputes'}
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!detail.data) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <p className="py-16 text-center text-sm text-muted-foreground">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
      </div>
    );
  }

  const dispute = detail.data.dispute as any;
  const live = (DISPUTE_OPEN_STATUSES as readonly string[]).includes(dispute.status);
  const iAmReporter = Number(dispute.reporterId) === Number((user as any)?.id);
  const iAmNamed = iAmReporter || Number(dispute.respondentId) === Number((user as any)?.id);

  const attach = async (file: File) => {
    setUploadError('');
    if (!(DISPUTE_EVIDENCE_CONTENT_TYPES as readonly string[]).includes(file.type)) {
      // Refused HERE, before the upload, because the server's list is the list
      // of formats it can actually verify - and a refusal after a slow upload
      // is the worst moment to learn the file was never going to be accepted.
      setUploadError(ar ? 'يُقبل PDF أو صورة فقط.' : 'Only a PDF or an image can be attached.');
      return;
    }
    if (file.size > MAX_DISPUTE_EVIDENCE_SIZE) {
      setUploadError(ar ? 'الحد الأقصى 10 ميجابايت.' : 'The limit is 10MB.');
      return;
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    });
    addEvidence.mutate({ disputeId, fileName: file.name, contentType: file.type, base64 });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4" data-testid="dispute-detail-page">
      <Link href="/disputes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />{ar ? 'النزاعات' : 'Disputes'}
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <span className="font-mono text-xs text-muted-foreground">{dispute.reference ?? `#${dispute.id}`}</span>
            {dispute.title}
            <Badge variant={statusTone(dispute.status) as any} data-testid="dispute-status">
              {label.status(dispute.status)}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="whitespace-pre-wrap text-muted-foreground">{dispute.description}</p>
          <p className="text-xs text-muted-foreground">
            {ar ? 'بشأن: ' : 'About: '}
            <span data-testid="dispute-subject">
              {detail.data.subjectLabel ?? (ar ? 'غير مسجّل' : 'not recorded')}
            </span>
            {' · '}{label.category(dispute.category)}
            {' · '}{new Date(dispute.createdAt).toLocaleDateString()}
          </p>

          {/*
            THE OUTCOME, WHERE THE PARTIES CAN READ IT. A resolved dispute whose
            page shows only a green badge tells somebody the matter is closed
            without telling them how, which is the question they have.
          */}
          {dispute.resolutionType && (
            <div className="rounded-lg border bg-muted/40 p-3" data-testid="dispute-outcome">
              <p className="text-xs font-semibold uppercase text-muted-foreground">{ar ? 'النتيجة' : 'Outcome'}</p>
              <p>{label.resolution(dispute.resolutionType)}</p>
              {dispute.resolutionNotes && (
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{dispute.resolutionNotes}</p>
              )}
            </div>
          )}

          {/* ── MESSAGES ────────────────────────────────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">
              {ar ? 'الرسائل' : 'Messages'}
            </h3>
            {detail.data.messages.length === 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="dispute-no-messages">
                {ar ? 'لا توجد رسائل بعد.' : 'No messages yet.'}
              </p>
            ) : (
              <ul className="space-y-2" data-testid="dispute-messages">
                {detail.data.messages.map((row: any) => (
                  <li key={row.id} className={`rounded-lg border p-2 ${
                    Number(row.authorId) === Number((user as any)?.id) ? 'bg-primary/5' : ''
                  }`}>
                    <p className="text-xs text-muted-foreground">
                      {Number(row.authorId) === Number((user as any)?.id)
                        ? (ar ? 'أنت' : 'You')
                        : (ar ? 'الطرف الآخر' : 'The other party')}
                      {' · '}{new Date(row.createdAt).toLocaleString()}
                    </p>
                    <p className="whitespace-pre-wrap">{row.body}</p>
                  </li>
                ))}
              </ul>
            )}

            {live ? (
              <div className="space-y-2">
                <Textarea
                  rows={3} data-testid="dispute-message" maxLength={MAX_DISPUTE_MESSAGE_LENGTH}
                  placeholder={ar ? 'اكتب رسالة…' : 'Write a message…'}
                  value={message} onChange={event => setMessage(event.target.value)}
                />
                <Button
                  size="sm" data-testid="dispute-message-send"
                  disabled={!message.trim() || post.isPending}
                  onClick={() => post.mutate({ disputeId, body: message.trim() })}
                >
                  {ar ? 'إرسال' : 'Send'}
                </Button>
                {post.isError && <p className="text-xs text-destructive">{post.error.message}</p>}
              </div>
            ) : (
              /*
                A concluded dispute takes no more messages - the server refuses
                them - and saying WHY here beats offering a box that fails.
              */
              <p className="text-xs text-muted-foreground" data-testid="dispute-closed-note">
                {ar
                  ? 'انتهى هذا النزاع، ولم يعد يقبل رسائل. أعد فتحه إن كان هناك ما يُضاف.'
                  : 'This dispute has concluded and takes no more messages. Reopen it if there is more to say.'}
              </p>
            )}
          </section>

          {/* ── EVIDENCE ────────────────────────────────────────────────── */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
              <Paperclip className="h-3 w-3" />{ar ? 'الأدلة' : 'Evidence'}
            </h3>
            {detail.data.evidence.length === 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="dispute-no-evidence">
                {ar ? 'لم تُرفَق أي ملفات.' : 'No files have been attached.'}
              </p>
            ) : (
              <ul className="space-y-1" data-testid="dispute-evidence">
                {detail.data.evidence.map((file: any) => (
                  <li key={file.id} className="flex flex-wrap items-center gap-2 text-xs">
                    {file.url ? (
                      <a href={file.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                        {file.fileName}
                      </a>
                    ) : (
                      <span className="text-muted-foreground line-through">{file.fileName}</span>
                    )}
                    {file.removedAt && (
                      <span className="text-muted-foreground">{ar ? 'مسحوب' : 'withdrawn'}</span>
                    )}
                    {live && !file.removedAt && Number(file.uploadedBy) === Number((user as any)?.id) && (
                      <Button
                        size="sm" variant="ghost" className="h-6 text-xs"
                        data-testid={`dispute-evidence-remove-${file.id}`}
                        disabled={removeEvidence.isPending}
                        onClick={() => removeEvidence.mutate({ evidenceId: Number(file.id) })}
                      >
                        {ar ? 'سحب' : 'Withdraw'}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {live && (
              <div className="space-y-1">
                <input
                  ref={fileInput} type="file" className="hidden"
                  data-testid="dispute-evidence-input"
                  accept={DISPUTE_EVIDENCE_CONTENT_TYPES.join(',')}
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) void attach(file);
                    event.target.value = '';
                  }}
                />
                <Button
                  size="sm" variant="outline" className="h-7 text-xs"
                  data-testid="dispute-evidence-add"
                  disabled={addEvidence.isPending}
                  onClick={() => fileInput.current?.click()}
                >
                  {addEvidence.isPending ? (ar ? 'جارٍ الرفع…' : 'Uploading…') : (ar ? 'إرفاق ملف' : 'Attach a file')}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {ar ? 'PDF أو صورة، حتى 10 ميجابايت.' : 'A PDF or an image, up to 10MB.'}
                </p>
                {(uploadError || addEvidence.isError) && (
                  <p className="text-xs text-destructive" data-testid="dispute-evidence-error">
                    {uploadError || addEvidence.error?.message}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* ── HISTORY ─────────────────────────────────────────────────── */}
          <section className="space-y-1">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">{ar ? 'السجل' : 'History'}</h3>
            <ol className="space-y-1 text-xs text-muted-foreground" data-testid="dispute-history">
              {detail.data.history.map((entry: any) => (
                <li key={entry.id}>
                  {new Date(entry.createdAt).toLocaleString()}
                  {' — '}
                  {entry.fromStatus === 'none'
                    ? (ar ? 'فُتح النزاع' : 'Dispute raised')
                    : `${label.status(entry.fromStatus)} → ${label.status(entry.toStatus)}`}
                  {entry.reason ? ` — ${entry.reason}` : ''}
                </li>
              ))}
            </ol>
          </section>

          {/* ── WHAT THIS PERSON MAY DO ─────────────────────────────────── */}
          {iAmNamed && (
            <section className="space-y-2 border-t pt-3">
              {live && iAmReporter && (
                <div className="space-y-1">
                  {/*
                    THE SERVER REQUIRES A REASON, so this asks for one rather
                    than offering a button that fails. It goes into the status
                    history the other party reads: withdrawing without saying
                    why leaves them with a dispute that vanished.
                  */}
                  <Textarea
                    rows={2} data-testid="dispute-withdraw-reason" maxLength={500}
                    placeholder={ar ? 'لماذا تسحب النزاع؟ (مطلوب)' : 'Why are you withdrawing? (required)'}
                    value={reason} onChange={event => setReason(event.target.value)}
                  />
                  <Button
                    size="sm" variant="outline" data-testid="dispute-withdraw"
                    disabled={!reason.trim() || withdraw.isPending}
                    onClick={() => {
                      if (window.confirm(ar
                        ? 'سحب النزاع نهائي - لا يمكن إعادة فتحه. المتابعة؟'
                        : 'Withdrawing is final - a withdrawn dispute cannot be reopened. Continue?')) {
                        withdraw.mutate({ disputeId, reason: reason.trim() });
                      }
                    }}
                  >
                    {ar ? 'سحب النزاع' : 'Withdraw this dispute'}
                  </Button>
                  {/*
                    Said before the click, not after. Withdrawal is terminal by
                    design - so a party cannot withdraw to stop an investigation
                    and restart it when it suits them - and a control whose
                    finality is only discovered afterwards is a trap.
                  */}
                  <p className="text-xs text-muted-foreground">
                    {ar
                      ? 'السحب نهائي. إن عادت المشكلة، افتح نزاعًا جديدًا.'
                      : 'Withdrawing is final. If the problem returns, raise a new dispute.'}
                  </p>
                  {withdraw.isError && <p className="text-xs text-destructive">{withdraw.error.message}</p>}
                </div>
              )}

              {!live && dispute.status !== 'withdrawn' && (
                <div className="space-y-2">
                  <Textarea
                    rows={2} data-testid="dispute-reopen-reason" maxLength={500}
                    placeholder={ar ? 'لماذا يجب إعادة فتحه؟ (مطلوب)' : 'Why should this be reopened? (required)'}
                    value={reason} onChange={event => setReason(event.target.value)}
                  />
                  <Button
                    size="sm" variant="outline" data-testid="dispute-reopen"
                    disabled={!reason.trim() || reopen.isPending}
                    onClick={() => reopen.mutate({ disputeId, reason: reason.trim() })}
                  >
                    {ar ? 'إعادة الفتح' : 'Reopen'}
                  </Button>
                  {reopen.isError && <p className="text-xs text-destructive" data-testid="dispute-reopen-error">{reopen.error.message}</p>}
                </div>
              )}
            </section>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
