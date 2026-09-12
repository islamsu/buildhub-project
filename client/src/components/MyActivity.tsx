import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import { ScrollText } from 'lucide-react';

/**
 * WHAT BUILDHUB HAS RECORDED ABOUT YOUR OWN ACTIVITY.
 *
 * `audit.mine` was built, authorized and never called: BuildHub recorded every
 * commercial event against a person's records and showed them none of it. The
 * trail exists so that "when was my quotation accepted?" and "when did that
 * placement start?" have an answer that is not somebody's memory.
 *
 * SELF-SCOPED ON THE SERVER, and it deliberately withholds one thing: the
 * ACTOR is returned only when it is the caller themselves. Whose account
 * touched a record is not the record owner's business, and returning it here
 * would turn a personal history into a way to learn which administrators
 * handled which accounts.
 */
export default function MyActivity() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const events = trpc.audit.mine.useQuery({ limit: 50 }, { retry: false });

  return (
    <div className="space-y-3" data-testid="my-activity">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <ScrollText className="h-4 w-4" />
        {ar ? 'سجل نشاطك' : 'Your activity record'}
      </h3>

      {events.isError ? (
        <LoadFailed {...loadFailedCopy(ar)} onRetry={() => void events.refetch()} />
      ) : (events.data?.length ?? 0) === 0 ? (
        /*
          NOTHING RECORDED IS A REAL ANSWER for a new account, and it says which
          kinds of thing would appear rather than leaving a blank panel that
          reads as broken.
        */
        <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground" data-testid="my-activity-empty">
          {events.isLoading
            ? (ar ? 'جارٍ التحميل…' : 'Loading…')
            : (ar
              ? 'لا يوجد نشاط مسجّل بعد. ستظهر هنا أحداث مثل قبول عرض سعر أو بدء ظهور مميز.'
              : 'Nothing recorded yet. Events like a quotation being accepted or a placement starting appear here.')}
        </p>
      ) : (
        <ul className="space-y-1" data-testid="my-activity-list">
          {(events.data ?? []).map((row: any) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-xs">
              <Badge variant="outline">{String(row.action).replaceAll('_', ' ')}</Badge>
              <span className="font-mono text-muted-foreground">{row.subjectType} #{row.subjectId}</span>
              {row.detail && <span className="min-w-0 break-words text-muted-foreground">{row.detail}</span>}
              <span className="ms-auto text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
