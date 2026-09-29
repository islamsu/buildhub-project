import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/_core/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import type { SavedItemKind } from '@shared/savedItems';

/**
 * ── SAVE, FROM WHEREVER THE BUYER FOUND IT ──────────────────────────────
 *
 * One control, used on product cards, provider cards and both detail pages,
 * so the gesture is the same everywhere and there is one place to fix it.
 *
 * SIGNED OUT IS NOT A DEAD BUTTON. A visitor who clicks Save is told what
 * signing in would give them and sent there - the §76 rule that a fresh user
 * should meet no unexplained disabled capability. Hiding it would be worse:
 * they would never learn the shortlist exists.
 *
 * THE STATE COMES FROM THE SERVER'S ANSWER, not from optimism. `toggleSaved`
 * returns what the item's state now IS rather than what happened, so a
 * double-tap on a slow connection settles on the truth instead of flipping
 * twice. The button is disabled while in flight and keeps its width, because
 * §58 forbids a control that jumps as it loads.
 */
export function SaveButton({
  kind, itemId, saved, variant = 'button', onChanged,
}: {
  kind: SavedItemKind;
  itemId: number;
  /** Known from a grid's batched `savedState`; undefined until it arrives. */
  saved: boolean | undefined;
  variant?: 'button' | 'icon';
  onChanged?: (saved: boolean) => void;
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const toggle = trpc.profile.toggleSaved.useMutation({
    onSuccess: result => {
      onChanged?.(result.saved);
      void utils.profile.savedCount.invalidate();
      void utils.profile.savedItems.invalidate();
      void utils.profile.savedState.invalidate();
      toast.success(result.saved
        ? (ar ? 'تمت الإضافة إلى قائمتك' : 'Added to your shortlist')
        : (ar ? 'أُزيل من قائمتك' : 'Removed from your shortlist'));
    },
    onError: error => toast.error(error.message),
  });

  const isSaved = saved === true;
  const label = isSaved
    ? (ar ? 'محفوظ' : 'Saved')
    : (ar ? 'حفظ' : 'Save');

  const act = (event: React.MouseEvent) => {
    // The card behind this is usually a link. Saving is not navigating.
    event.preventDefault();
    event.stopPropagation();
    if (!isAuthenticated) {
      toast.info(ar
        ? 'سجّل الدخول لحفظ الموردين والمنتجات في قائمتك.'
        : 'Sign in to keep suppliers and products on a shortlist.');
      navigate('/auth');
      return;
    }
    toggle.mutate({ kind, itemId });
  };

  const Icon = isSaved ? BookmarkCheck : Bookmark;

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={act}
        disabled={toggle.isPending}
        data-testid={`save-${kind}-${itemId}`}
        data-saved={isSaved ? 'true' : 'false'}
        // An icon control needs a name a screen reader can read (§62), and
        // aria-pressed is what makes a toggle legible as a toggle.
        aria-label={label}
        aria-pressed={isSaved}
        title={label}
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 ${
          isSaved ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:text-foreground'
        }`}
      >
        <Icon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={isSaved ? 'secondary' : 'outline'}
      onClick={act}
      disabled={toggle.isPending}
      data-testid={`save-${kind}-${itemId}`}
      data-saved={isSaved ? 'true' : 'false'}
      aria-pressed={isSaved}
      // A fixed width so the label changing from Save to Saved does not
      // resize the button under the cursor.
      className="min-w-[104px] gap-1.5"
    >
      <Icon className="h-4 w-4" />
      {label}
    </Button>
  );
}
