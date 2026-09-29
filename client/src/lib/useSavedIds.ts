import { useMemo } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import type { SavedItemKind } from '@shared/savedItems';

/**
 * WHICH OF THE THINGS ON THIS PAGE THE VIEWER HAS SAVED.
 *
 * ONE QUERY FOR A GRID, not one per card, and deliberately NOT a `saved`
 * flag on the public marketplace rows: a per-viewer fact inside a cacheable
 * public response is how a shared cache ends up showing one buyer another
 * buyer's shortlist.
 *
 * Returns an empty set - never undefined - so a card renders "not saved"
 * while the answer is in flight rather than flickering between states. That
 * is honest: an unsaved item and an unknown one look the same to a buyer,
 * and the button corrects itself the moment the server answers.
 */
export function useSavedIds(kind: SavedItemKind, itemIds: number[]): Set<number> {
  const { isAuthenticated } = useAuth();
  // Sorted and joined so a re-render with the same ids in a different order
  // does not look like a new query to react-query.
  const key = useMemo(() => [...itemIds].sort((a, b) => a - b), [itemIds.join(',')]);
  const { data } = trpc.profile.savedState.useQuery(
    { kind, itemIds: key.slice(0, 100) },
    { enabled: isAuthenticated && key.length > 0, retry: false },
  );
  return useMemo(() => new Set(data?.saved ?? []), [data]);
}
