import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Flag, PencilLine } from 'lucide-react';
import {
  PRODUCT_QUESTION_REPORT_REASONS, productQuestionLabel,
} from '@shared/productQuestions';
import { toast } from 'sonner';

/**
 * ── THE PUBLIC Q&A ON A PRODUCT, WITH SOMEWHERE TO COMPLAIN ──────────────
 *
 * This thread had no remedy of any kind. A question carrying abuse, a third
 * party's phone number or a competitor's contact details was published here
 * and nobody could act on it - not the supplier whose listing it sat on, not
 * an administrator. Reviews had a report button. This did not.
 *
 * WHAT EACH PERSON CAN DO HERE:
 *
 *   ANYONE SIGNED IN     report the question, or the answer, separately
 *   THE SUPPLIER         correct their own answer, with the old text kept
 *
 * THE TWO HALVES ARE REPORTED SEPARATELY because they are written by
 * different people. A reasonable question can get an abusive reply, and an
 * abusive question can get a patient one; one button for "the exchange" would
 * force a moderator to act on both to act on either.
 *
 * NOBODY REPORTS THEIR OWN WORDS. The control is withheld from the author
 * rather than shown and then refused - reporting your own question is not a
 * moderation request, it is a deletion request wearing one, and deletion is
 * exactly what this system does not offer.
 *
 * AN EDITED ANSWER SAYS SO. The marker is not decoration: a supplier who
 * answers "yes, we ship to Alexandria", takes the order and quietly changes
 * it to "no" is the harm the revision history exists to make visible, and a
 * silent edit would hide it from the person who asked.
 *
 * A HIDDEN ANSWER LEAVES ITS QUESTION STANDING, and the reader is told the
 * reply was removed rather than shown a question that looks ignored. Silence
 * and moderation mean very different things to somebody deciding whether to
 * buy.
 */

type QuestionRow = {
  id: number;
  question: string;
  answer: string | null;
  answeredAt: Date | string | null;
  createdAt: Date | string;
  answerHidden?: boolean;
  answerEdited?: boolean;
};

export default function ProductQuestionThread({
  questions, productId, isSupplier, onChanged,
}: {
  questions: QuestionRow[];
  productId: number;
  /** Whether the viewer owns this product, and may therefore correct answers. */
  isSupplier: boolean;
  onChanged: () => void;
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';

  const [reportOn, setReportOn] = useState<{ id: number; target: 'question' | 'answer' } | null>(null);
  const [reason, setReason] = useState<string>('abusive');
  const [detail, setDetail] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const report = trpc.marketplace.reportQuestion.useMutation({
    onSuccess: () => {
      setReportOn(null); setDetail('');
      toast.success(ar ? 'تم إرسال البلاغ للمراجعة.' : 'Reported. A moderator will look at it.');
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const editAnswer = trpc.marketplace.editAnswer.useMutation({
    onSuccess: () => {
      setEditing(null); setDraft('');
      toast.success(ar ? 'تم تحديث الإجابة، والإجابة السابقة محفوظة.' : 'Answer updated. The previous one is kept on the record.');
      onChanged();
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  if (questions.length === 0) return null;

  return (
    <div className="mt-5 space-y-3" data-testid="product-question-thread">
      {questions.map(item => (
        <div key={item.id} className="rounded-lg bg-muted/40 p-3" data-testid={`product-question-${item.id}`}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium">{item.question}</p>
            <Button
              size="sm" variant="ghost"
              className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground"
              onClick={() => { setReportOn({ id: item.id, target: 'question' }); setReason('abusive'); }}
              data-testid={`product-question-report-${item.id}`}
              aria-label={ar ? 'الإبلاغ عن هذا السؤال' : 'Report this question'}
            >
              <Flag className="h-3 w-3" />
              {ar ? 'إبلاغ' : 'Report'}
            </Button>
          </div>

          {item.answerHidden ? (
            /* NOT SILENTLY BLANK. "The supplier never replied" and "BuildHub
               removed the reply" are different facts and a buyer weighing a
               purchase deserves the right one. */
            <p
              className="mt-2 border-s-2 border-muted-foreground/40 ps-3 text-sm italic text-muted-foreground"
              data-testid={`product-answer-hidden-${item.id}`}
            >
              {ar ? 'أزالت بيلدهَب هذه الإجابة.' : 'BuildHub removed this answer.'}
            </p>
          ) : item.answer ? (
            <div className="mt-2 border-s-2 border-primary ps-3">
              {editing === item.id ? (
                <div className="space-y-2">
                  <Textarea
                    rows={3} value={draft} onChange={event => setDraft(event.target.value)}
                    aria-label={ar ? 'تصحيح الإجابة' : 'Correct the answer'}
                    data-testid={`product-answer-draft-${item.id}`}
                  />
                  <p className="text-xs text-muted-foreground">
                    {ar
                      ? 'ستبقى الإجابة السابقة في السجل وسيظهر أن الإجابة عُدّلت.'
                      : 'The previous answer is kept on the record and the listing will show that it was edited.'}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={editAnswer.isPending || draft.trim().length < 2}
                      onClick={() => editAnswer.mutate({ questionId: item.id, answer: draft.trim() })}
                      data-testid={`product-answer-save-${item.id}`}
                    >
                      {ar ? 'حفظ التصحيح' : 'Save correction'}
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => { setEditing(null); setDraft(''); }}
                      data-testid={`product-answer-cancel-${item.id}`}
                    >
                      {ar ? 'إلغاء' : 'Cancel'}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">{item.answer}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {item.answerEdited && (
                      <Badge variant="outline" className="text-[10px]" data-testid={`product-answer-edited-${item.id}`}>
                        {ar ? 'مُعدّلة' : 'Edited'}
                      </Badge>
                    )}
                    {isSupplier ? (
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                        onClick={() => { setEditing(item.id); setDraft(item.answer ?? ''); }}
                        data-testid={`product-answer-edit-${item.id}`}
                      >
                        <PencilLine className="h-3 w-3" />
                        {ar ? 'تصحيح' : 'Correct this'}
                      </Button>
                    ) : (
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                        onClick={() => { setReportOn({ id: item.id, target: 'answer' }); setReason('abusive'); }}
                        data-testid={`product-answer-report-${item.id}`}
                        aria-label={ar ? 'الإبلاغ عن هذه الإجابة' : 'Report this answer'}
                      >
                        <Flag className="h-3 w-3" />
                        {ar ? 'إبلاغ' : 'Report'}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      ))}

      <Dialog open={!!reportOn} onOpenChange={open => { if (!open) setReportOn(null); }}>
        <DialogContent data-testid="product-report-dialog">
          <DialogHeader>
            <DialogTitle>
              {reportOn?.target === 'answer'
                ? (ar ? 'الإبلاغ عن الإجابة' : 'Report this answer')
                : (ar ? 'الإبلاغ عن السؤال' : 'Report this question')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* A REASON IS REQUIRED, from a list that fits what is being
                reported. Free text alone cannot be triaged, and a queue that
                cannot be triaged drowns. */}
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger aria-label={ar ? 'سبب البلاغ' : 'Reason'} data-testid="product-report-reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_QUESTION_REPORT_REASONS.map(value => (
                  <SelectItem key={value} value={value}>
                    {productQuestionLabel('reportReason', value, lang)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              rows={3} value={detail} onChange={event => setDetail(event.target.value)}
              aria-label={ar ? 'تفاصيل إضافية' : 'Anything else'}
              data-testid="product-report-detail"
              placeholder={ar ? 'تفاصيل إضافية (اختياري)' : 'Anything else (optional)'}
            />
            <p className="text-xs text-muted-foreground">
              {ar
                ? 'يراجع فريق بيلدهَب البلاغ. لا يُحذف أي محتوى — قد يُخفى فقط.'
                : 'A moderator reads every report. Nothing is deleted — content can only be hidden.'}
            </p>
          </div>
          <DialogFooter>
            <Button
              disabled={report.isPending || !reportOn}
              onClick={() => reportOn && report.mutate({
                questionId: reportOn.id,
                target: reportOn.target,
                reason: reason as typeof PRODUCT_QUESTION_REPORT_REASONS[number],
                detail: detail.trim() || undefined,
              })}
              data-testid="product-report-submit"
            >
              {ar ? 'إرسال البلاغ' : 'Send report'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
