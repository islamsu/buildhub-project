import { useState } from 'react';
import { Link } from 'wouter';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import { LifeBuoy } from 'lucide-react';
import { SUPPORT_CATEGORIES, supportLabel } from '@shared/supportTickets';

/**
 * ── ASKING BUILDHUB FOR HELP ──────────────────────────────────────────────
 *
 * There was no way to. `todo.md:793` named support tickets and the system did
 * not exist - the only "contact support" in the product was two error messages
 * telling a locked-out user to do something the product gave them no way to do.
 *
 * WHO IS WAITING ON WHOM is the first thing this screen says, because it is the
 * first thing a person wants to know and the one thing a status word alone does
 * not tell them: `awaiting_user` means BuildHub is blocked on THEM, and reads
 * as "Waiting for you" rather than as a state they have to interpret.
 */
export default function MySupport() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();

  const [category, setCategory] = useState<string>('account');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const tickets = trpc.support.myTickets.useQuery(undefined, { retry: false });

  const create = trpc.support.createTicket.useMutation({
    onSuccess: () => {
      setSubject(''); setDescription(''); setError('');
      void utils.support.myTickets.invalidate();
    },
    onError: e => setError(e.message),
  });

  const tone = (status: string) =>
    status === 'awaiting_user' ? 'border-amber-200 bg-amber-50 text-amber-700'
      : status === 'resolved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : status === 'closed' ? 'border-slate-200 bg-slate-50 text-slate-600'
      : 'border-sky-200 bg-sky-50 text-sky-700';

  return (
    <div className="container max-w-4xl py-8 space-y-6" dir={ar ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <LifeBuoy className="h-6 w-6" />
          {ar ? 'الدعم' : 'Support'}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {ar
            ? 'اطرح سؤالك على فريق BuildHub وتابع الرد هنا.'
            : 'Ask the BuildHub team a question and follow the answer here.'}
        </p>
      </div>

      <Card data-testid="support-new-ticket">
        <CardHeader>
          <CardTitle className="text-base">{ar ? 'تذكرة جديدة' : 'New ticket'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger aria-label={ar ? 'الفئة' : 'Category'}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORT_CATEGORIES.map(value => (
                <SelectItem key={value} value={value}>
                  {supportLabel('category', value, lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label={ar ? 'الموضوع' : 'Subject'}
            placeholder={ar ? 'اذكر موضوع المشكلة باختصار' : 'A short summary of the problem'}
            value={subject}
            onChange={event => setSubject(event.target.value)}
            data-testid="support-subject"
          />
          <Textarea
            aria-label={ar ? 'الوصف' : 'Description'}
            placeholder={ar
              ? 'اشرح ما حدث، وما الذي كنت تحاول فعله.'
              : 'Describe what happened, and what you were trying to do.'}
            rows={5}
            value={description}
            onChange={event => setDescription(event.target.value)}
            data-testid="support-description"
          />
          {/* PRIORITY IS NOT HERE, deliberately. Triage is BuildHub's judgement
              about its own queue - see SUPPORT_PRIORITY_IS_STAFF_ONLY. */}
          {error && <p className="text-sm text-rose-600" data-testid="support-error">{error}</p>}
          <Button
            onClick={() => create.mutate({ category: category as never, subject, description })}
            disabled={create.isPending || subject.trim().length < 4 || description.trim().length < 10}
            data-testid="support-submit"
          >
            {create.isPending ? (ar ? 'جارٍ الإرسال…' : 'Sending…') : (ar ? 'إرسال' : 'Send')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{ar ? 'تذاكري' : 'My tickets'}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* A FAILED FETCH IS NOT AN EMPTY LIST. Rendering "you have no
              tickets" when the request failed tells the customer their problem was
              never filed, which is a different and worse claim. */}
          {tickets.isError && (
            <LoadFailed {...loadFailedCopy(ar)} onRetry={() => void tickets.refetch()} />
          )}
          {tickets.isLoading && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {ar ? 'جارٍ التحميل…' : 'Loading…'}
            </p>
          )}
          {!tickets.isLoading && !tickets.isError && (tickets.data ?? []).length === 0 && (
            <div className="rounded-xl border border-dashed py-10 text-center" data-testid="support-empty">
              <p className="font-medium">{ar ? 'لا توجد تذاكر بعد' : 'No tickets yet'}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {ar
                  ? 'عندما تفتح تذكرة ستظهر هنا مع ردود الفريق.'
                  : 'When you open a ticket it appears here, with the team’s replies.'}
              </p>
            </div>
          )}
          {!tickets.isError && (tickets.data ?? []).length > 0 && (
            <div className="space-y-2" data-testid="support-list">
              {(tickets.data ?? []).map(ticket => (
                <Link
                  key={ticket.id}
                  href={`/support/${ticket.id}`}
                  className="block rounded-xl border p-4 transition-colors hover:bg-muted/30"
                  data-testid={`support-row-${ticket.id}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{ticket.subject}</span>
                    <Badge variant="outline" className={tone(ticket.status)}>
                      {supportLabel('status', ticket.status, lang)}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span>{ticket.reference}</span>
                    <span>{supportLabel('category', ticket.category, lang)}</span>
                    {ticket.awaitingParty === 'user' && (
                      <span className="font-medium text-amber-700">
                        {ar ? 'بانتظار ردك' : 'Waiting for your reply'}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
