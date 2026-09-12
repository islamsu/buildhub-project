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
