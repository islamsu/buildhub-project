import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * A SECTION THAT COULD NOT LOAD, SAID PLAINLY.
 *
 * AdminDashboard destructured only `isLoading`, so a failed fetch rendered
 * "No disputes have been filed" - an administrator read a database outage as a
 * quiet platform and stopped looking. The server no longer hands back an empty
 * list when it cannot reach the database (server/_core/requireDb.ts), so the
 * failure arrives as an error, and this is what it must look like.
 *
 * Shared rather than copied: it started life inside AdminDashboard, and the
 * second screen that needed it would otherwise have grown its own slightly
 * different version of the same sentence.
 *
 * Retry rather than a reload, because a reload loses every filter on the page.
 */
export function LoadFailed({ text, onRetry, retryText }: { text: string; onRetry?: () => void; retryText: string }) {
  return (
    <div className="py-10 text-center" data-testid="section-failed">
      <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-destructive" />
      <p className="text-sm font-medium">{text}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>{retryText}</Button>
      )}
    </div>
  );
}

/**
 * THE SAME SENTENCE, WHERE A BLOCK WILL NOT FIT.
 *
 * A dropdown's result list is three lines tall; dropping a centred block with
 * an icon and a Retry button into it pushes the field off the screen. This is
 * the same statement at the size the surface has, and it reads from the same
 * copy, so the two cannot drift into saying different things about the same
 * failure. Retrying a typeahead is what typing another character already does.
 */
export function LoadFailedInline({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 px-3 py-3 text-sm text-destructive" role="alert" data-testid="section-failed-inline">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{text}</span>
    </p>
  );
}

/** The same sentence, in both languages, wherever a section fails. */
export function loadFailedCopy(ar: boolean) {
  return {
    text: ar
      ? 'تعذّر تحميل هذا القسم. هذه ليست نتيجة فارغة - يرجى المحاولة مرة أخرى.'
      : 'This section could not be loaded. This is not an empty result - please try again.',
    retryText: ar ? 'إعادة المحاولة' : 'Retry',
  };
}

export default LoadFailed;
