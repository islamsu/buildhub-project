import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import {
  MAX_SHOWCASE_ITEMS, showcaseKey, showcaseKindLabel,
  type ShowcaseItemKind,
} from '@shared/supplierShowcase';
import { ArrowDown, ArrowUp, Sparkles } from 'lucide-react';

/**
 * ── THE SUPPLIER CHOOSES, AND THAT IS THE WHOLE POINT (§18) ─────────────
 *
 * FEATURED is BuildHub's editorial choice and SPONSORED is a commercial
 * grant; neither is offered here and neither can be requested here. This
 * screen controls the supplier's OWN storefront and nothing else, and it
 * says so - a supplier who believed this moved them up the marketplace would
 * have been misled about what they were buying with their attention.
 *
 * THE CANDIDATE LIST COMES FROM THE SERVER'S OWN RULE. It is computed by the
 * same ownership-and-visibility test the writer applies, so the form cannot
 * offer something that submitting will refuse.
 */
export default function ShowcaseManager() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();

  const current = trpc.profile.myShowcase.useQuery(undefined, { retry: false });
  const candidates = trpc.profile.showcaseCandidates.useQuery(undefined, { retry: false });

  /** The working selection, in the supplier's chosen order. */
  const [selection, setSelection] = useState<{ kind: ShowcaseItemKind; itemId: number }[]>([]);
  const [dirty, setDirty] = useState(false);

  // Seeded from the server once, and NOT re-seeded on every refetch - that
  // would discard edits in progress the moment anything invalidated the query.
  useEffect(() => {
    if (current.data && !dirty) {
      setSelection(current.data.cards.map(card => ({ kind: card.kind, itemId: card.itemId })));
    }
  }, [current.data, dirty]);

  const save = trpc.profile.setShowcase.useMutation({
    onSuccess: result => {
      setDirty(false);
      utils.profile.myShowcase.invalidate();
      utils.profile.showcase.invalidate();
      // THE SERVER'S ANSWER IS WHAT IS REPORTED, not the request. If it
      // refused an entry - withdrawn between load and save - saying "saved"
      // over a showcase that is one item shorter would be a lie the supplier
      // only discovers by reloading their own page.
      if (result.refused.length > 0) {
        toast.error(ar
          ? `حُفظ ${result.stored.length}. رُفض ${result.refused.length} لأنه لم يعد منشوراً أو ليس لك.`
          : `${result.stored.length} saved. ${result.refused.length} refused — no longer published, or not yours.`);
      } else {
        toast.success(ar ? 'تم تحديث مختاراتك' : 'Your highlights are updated');
      }
    },
    onError: error => toast.error(error.message),
  });

  const chosen = useMemo(
    () => new Set(selection.map(entry => showcaseKey(entry.kind, entry.itemId))),
    [selection],
  );
  const cardsById = useMemo(() => {
    const map = new Map<string, any>();
    for (const card of candidates.data ?? []) map.set(showcaseKey(card.kind, card.itemId), card);
    return map;
  }, [candidates.data]);

  const toggle = (kind: ShowcaseItemKind, itemId: number) => {
    setDirty(true);
    setSelection(current => {
      const key = showcaseKey(kind, itemId);
      if (current.some(entry => showcaseKey(entry.kind, entry.itemId) === key)) {
        return current.filter(entry => showcaseKey(entry.kind, entry.itemId) !== key);
      }
      // THE CAP IS SAID OUT LOUD, not enforced silently. A checkbox that
      // simply refuses to tick reads as a broken control.
      if (current.length >= MAX_SHOWCASE_ITEMS) {
        toast.error(ar
          ? `يمكنك اختيار ${MAX_SHOWCASE_ITEMS} عناصر كحدّ أقصى. أزل واحداً أولاً.`
          : `You can highlight ${MAX_SHOWCASE_ITEMS} items at most. Remove one first.`);
        return current;
      }
      return [...current, { kind, itemId }];
    });
  };

  const move = (index: number, delta: number) => {
    setDirty(true);
    setSelection(current => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const failed = current.isError || candidates.isError;
  const loading = current.isLoading || candidates.isLoading;
  const available = candidates.data ?? [];

  return (
    <Card data-testid="showcase-manager">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          {ar ? 'مختارات واجهتك' : 'Storefront highlights'}
        </CardTitle>
        {/* WHAT THIS IS AND, JUST AS IMPORTANTLY, WHAT IT IS NOT. */}
        <p className="text-sm text-muted-foreground">
          {ar
            ? `اختر حتى ${MAX_SHOWCASE_ITEMS} عناصر لتظهر أولاً في أعلى صفحتك العامة، ورتّبها كما تشاء.`
            : `Choose up to ${MAX_SHOWCASE_ITEMS} items to show first at the top of your public page, in the order you want.`}
        </p>
        <p className="text-xs text-muted-foreground" data-testid="showcase-scope-note">
          {ar
            ? 'يؤثّر هذا على صفحتك العامة فقط. لا يغيّر ترتيبك في السوق أو نتائج البحث، وليس ترشيحاً من BuildHub ولا مساحة مدفوعة.'
            : 'This affects your own public page only. It does not change your position in the marketplace or in search results, and it is neither a BuildHub recommendation nor a paid placement.'}
        </p>
      </CardHeader>
      <CardContent>
        {failed ? (
          <LoadFailed
            {...loadFailedCopy(ar)}
            onRetry={() => { void current.refetch(); void candidates.refetch(); }}
          />
        ) : loading ? (
          <p className="py-6 text-sm text-muted-foreground">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
        ) : available.length === 0 ? (
          /* AN EMPTY STATE THAT SAYS WHERE TO START (§76). "Nothing to
             highlight" with no route out of it is a dead end. */
          <div className="rounded-lg border border-dashed py-10 text-center" data-testid="showcase-manager-empty">
            <p className="text-sm text-muted-foreground">
              {ar
                ? 'لا يوجد شيء لعرضه بعد. انشر منتجاً أو خدمة أو أضف عملاً سابقاً، ثم اختره هنا.'
                : 'Nothing to highlight yet. Publish a product or a service, or add past work, then choose it here.'}
            </p>
            <Button asChild variant="outline" size="sm" className="mt-3" data-testid="showcase-manager-empty-cta">
              <Link href="/products/new">{ar ? 'أضف منتجاً' : 'Add a product'}</Link>
            </Button>
          </div>
        ) : (
          <>
            {/* THE CHOSEN ORDER, because the order is part of the choice. */}
            {selection.length > 0 && (
              <div className="mb-4 space-y-2" data-testid="showcase-selected">
                <p className="text-xs font-medium text-muted-foreground">
                  {ar ? `المختار: ${selection.length} من ${MAX_SHOWCASE_ITEMS}` : `Selected: ${selection.length} of ${MAX_SHOWCASE_ITEMS}`}
                </p>
                {selection.map((entry, index) => {
                  const card = cardsById.get(showcaseKey(entry.kind, entry.itemId));
                  return (
                    <div
                      key={showcaseKey(entry.kind, entry.itemId)}
                      className="flex items-center gap-2 rounded-lg border p-2"
                      data-testid={`showcase-selected-${entry.kind}-${entry.itemId}`}
                    >
                      <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {card?.title ?? `#${entry.itemId}`}
                      </span>
                      <Badge variant="secondary" className="text-[10px]">
                        {showcaseKindLabel(entry.kind, ar ? 'ar' : 'en')}
                      </Badge>
                      {/* Ordering by buttons rather than drag: a drag-only
                          reorder is unreachable from a keyboard (§62). */}
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        aria-label={ar ? `حرّك ${card?.title ?? ''} لأعلى` : `Move ${card?.title ?? ''} up`}
                        data-testid={`showcase-up-${entry.kind}-${entry.itemId}`}
                      ><ArrowUp className="h-3.5 w-3.5" /></Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        disabled={index === selection.length - 1}
                        onClick={() => move(index, 1)}
                        aria-label={ar ? `حرّك ${card?.title ?? ''} لأسفل` : `Move ${card?.title ?? ''} down`}
                        data-testid={`showcase-down-${entry.kind}-${entry.itemId}`}
                      ><ArrowDown className="h-3.5 w-3.5" /></Button>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {ar ? 'اختر من عناصرك المنشورة' : 'Choose from your published items'}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {available.map(card => {
                const key = showcaseKey(card.kind, card.itemId);
                const picked = chosen.has(key);
                return (
                  <label
                    key={key}
                    className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${picked ? 'border-primary bg-primary/5' : ''}`}
                    data-testid={`showcase-candidate-${card.kind}-${card.itemId}`}
                  >
                    <Checkbox
                      className="mt-0.5 shrink-0"
                      checked={picked}
                      onCheckedChange={() => toggle(card.kind, card.itemId)}
                      data-testid={`showcase-pick-${card.kind}-${card.itemId}`}
                      aria-label={ar ? `اعرض ${card.title} في واجهتك` : `Highlight ${card.title} on your storefront`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{card.title}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {showcaseKindLabel(card.kind, ar ? 'ar' : 'en')}
                        {card.subtitle ? ` · ${card.subtitle}` : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            {/* WHAT WAS DROPPED, TO THE OWNER ONLY. A storefront that quietly
                shortens teaches its owner nothing about why (§10). */}
            {(current.data?.unavailable ?? 0) > 0 && (
              <p className="mt-3 text-xs text-amber-700" data-testid="showcase-unavailable">
                {ar
                  ? `${current.data?.unavailable} من مختاراتك لم تعد معروضة على صفحتك لأنها لم تعد منشورة.`
                  : `${current.data?.unavailable} of your highlights no longer appear on your page because they are no longer published.`}
              </p>
            )}

            <div className="mt-4 flex items-center gap-2">
              <Button
                onClick={() => save.mutate({ entries: selection })}
                disabled={save.isPending || !dirty}
                data-testid="showcase-save"
              >
                {save.isPending ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'احفظ المختارات' : 'Save highlights')}
              </Button>
              {dirty && (
                <span className="text-xs text-muted-foreground" data-testid="showcase-dirty">
                  {ar ? 'لديك تغييرات غير محفوظة' : 'You have unsaved changes'}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
