import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/_core/hooks/useAuth';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import { SaveButton } from '@/components/SaveButton';
import { trpc } from '@/lib/trpc';
import { useLocation } from 'wouter';
import { formatMoney } from '@shared/money';
import { useCategoryLabel } from '@/lib/useCategoryLabel';
import { Checkbox } from '@/components/ui/checkbox';
import { useRfqBasket } from '@/hooks/useRfqBasket';
import { inviteParam, MAX_CARRIED_INVITATIONS } from '@shared/rfqBasket';
import { toast } from 'sonner';
import { useState } from 'react';
import { BadgeCheck, Bookmark, MapPin, PackageSearch } from 'lucide-react';

/**
 * ── THE SHORTLIST ───────────────────────────────────────────────────────
 *
 * PRODUCT_NORTH_STAR.md CURRENT GLOBAL RELEASE item 9. The place the work of
 * comparing eleven suppliers survives closing the tab.
 *
 * IT ENDS IN AN ACTION, AND THE ACTION CARRIES THE WORK.
 *
 * The primary button used to navigate to `/rfq` and nothing else. That is a
 * LINK, not a journey: the buyer arrived at an empty create form and the
 * eleven suppliers and six products they had spent two days shortlisting
 * were left behind on the page they came from. §6 asks whether the next part
 * of the product knows it happened, and it did not.
 *
 * SELECTED PRODUCTS BECOME BASKET LINES and selected providers become
 * INVITATIONS, through the canonical systems both already had - the shared
 * `rfqBasket` reducer and `rfq.inviteSupplier` - rather than a second path
 * from this page (§11). Nothing here decides who may be invited; the server
 * authorizes every invitation one at a time exactly as it does from a
 * supplier's storefront.
 *
 * SELECTION DEFAULTS TO EVERYTHING, because a buyer who presses the primary
 * button without touching a checkbox means their shortlist, and an action
 * that carries nothing by default is the empty form again with extra steps.
 *
 * WITHDRAWN ITEMS ARE NAMED, NOT DROPPED. A product delisted after it was
 * saved is reported - the buyer chose it, and a list that quietly shortens
 * tells them nothing about why.
 */
export default function SavedPage() {
  const { lang, dir } = useLanguage();
  const ar = lang === 'ar';
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  /* The canonical category name, in the reader's language. `products.category`
     stores the English name, so an Arabic page must look the Arabic one up
     rather than print the stored value (§67). */
  const categoryLabel = useCategoryLabel();

  const saved = trpc.profile.savedItems.useQuery(undefined, {
    enabled: isAuthenticated, retry: false,
  });

  const items = saved.data?.items ?? [];
  const unavailable = saved.data?.unavailable ?? [];
  const products = items.filter(item => item.itemKind === 'product');
  const providers = items.filter(item => item.itemKind === 'provider');

  const basket = useRfqBasket();
  /*
   * NULL MEANS "EVERYTHING", not "nothing".
   *
   * Held as an explicit deselection set rather than a selection set so that
   * the default survives the list changing: a shortlist that gains an item
   * while the page is open includes it, which is what a buyer who has
   * touched nothing means. An empty Set is still "all"; only what the buyer
   * has actually unticked is remembered.
   */
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const keyOf = (kind: string, id: number) => `${kind}:${id}`;
  const isPicked = (kind: string, id: number) => !excluded.has(keyOf(kind, id));
  const toggle = (kind: string, id: number) => setExcluded(current => {
    const next = new Set(current);
    const key = keyOf(kind, id);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const pickedProducts = products.filter((item: any) => isPicked('product', Number(item.target?.id)));
  const pickedProviders = providers.filter((item: any) => isPicked('provider', Number(item.target?.id)));
  const pickedCount = pickedProducts.length + pickedProviders.length;

  /*
   * CARRY, THEN GO.
   *
   * The basket is written BEFORE navigating rather than passed through the
   * URL: it is the canonical draft store, `/rfq?basket=1` already opens the
   * dialog over it, and a URL carrying six product lines with quantities and
   * specifications would be a second encoding of a contract that already
   * exists.
   *
   * Providers travel as ids in the query because an invitation is not a
   * draft - it is an act the server performs the moment the request exists,
   * and it needs nothing but the id.
   */
  const requestQuotations = () => {
    let added = 0;
    let refused = 0;
    for (const item of pickedProducts) {
      const target = item.target as any;
      const accepted = basket.add({
        productId: Number(target.id),
        name: (ar ? (target.nameAr || target.name) : target.name) ?? String(target.id),
        variantLabel: null,
        quantity: 1,
        unit: target.unit ?? null,
        specifications: null,
        // Catalogue price when added. Reference only - it is not a quotation.
        unitPrice: target.price == null ? null : Number(target.price),
      });
      if (accepted) added++; else refused++;
    }
    /* THE CAP IS SAID OUT LOUD. `addToBasket` refuses silently past
       MAX_BASKET_ITEMS, and a buyer who selected nine and got six with no
       explanation would reasonably conclude the page is broken. */
    if (refused > 0) {
      toast.error(ar
        ? `أُضيف ${added} منتجاً. لم تُضف ${refused} لأن سلة الطلب ممتلئة.`
        : `${added} product${added === 1 ? '' : 's'} added. ${refused} could not be added because the request is full.`);
    }
    const inviteIds = pickedProviders.map((item: any) => Number(item.target.id));
    const carried = inviteParam(inviteIds);
    if (inviteIds.length > carried.split(',').filter(Boolean).length) {
      toast.error(ar
        ? `يمكن دعوة ${MAX_CARRIED_INVITATIONS} موردين كحدّ أقصى في طلب واحد. يمكنك دعوة الباقين من صفحة الطلب بعد نشره.`
        : `At most ${MAX_CARRIED_INVITATIONS} suppliers can be invited with one request. You can invite the rest from the request after posting it.`);
    }
    const params = new URLSearchParams();
    // `basket=1` only when there is something to show; a stale flag over an
    // empty basket pops a dialog with nothing in it.
    if (added > 0 || basket.count > 0) params.set('basket', '1');
    if (carried) params.set('invite', carried);
    const query = params.toString();
    navigate(query ? `/rfq?${query}` : '/rfq');
  };

  return (
    <DashboardLayout>
      <div className="space-y-6" dir={dir}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{ar ? 'قائمتي المختصرة' : 'Saved'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {ar
                ? 'الموردون والمنتجات التي وضعتها جانباً للمقارنة. لا يرى المورد أنك حفظته.'
                : 'Suppliers and products you set aside to compare. A supplier is never told you saved them.'}
            </p>
          </div>
          {/* THE ACTION THE LIST EXISTS FOR, AND IT SAYS WHAT IT WILL DO.
              A shortlist with no way out of it is a drawer; a button that
              carries six products and four suppliers without naming them is
              a surprise. The label counts what is actually selected, so
              unticking something changes the button. */}
          {items.length > 0 && (
            <div className="flex flex-col items-end gap-1">
              <Button
                data-testid="saved-request-quotes"
                disabled={pickedCount === 0}
                onClick={requestQuotations}
              >
                {ar ? 'اطلب عروض أسعار' : 'Request quotations'}
              </Button>
              <p className="text-xs text-muted-foreground" data-testid="saved-selection-summary">
                {pickedCount === 0
                  ? (ar ? 'اختر عنصراً واحداً على الأقل' : 'Select at least one item')
                  : ar
                    ? `${pickedProducts.length} منتج · ${pickedProviders.length} مورد`
                    : `${pickedProducts.length} product${pickedProducts.length === 1 ? '' : 's'} · ${pickedProviders.length} supplier${pickedProviders.length === 1 ? '' : 's'}`}
              </p>
            </div>
          )}
        </div>

        {saved.isError ? (
          <Card><CardContent className="py-8">
            <LoadFailed {...loadFailedCopy(ar)} onRetry={() => void saved.refetch()} />
          </CardContent></Card>
        ) : saved.isLoading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
        ) : items.length === 0 && unavailable.length === 0 ? (
          /* AN EMPTY STATE THAT SAYS WHERE TO START, not one that says
             "nothing here" and leaves the buyer to work it out (§76). */
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center" data-testid="saved-empty">
              <Bookmark className="h-8 w-8 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground max-w-md">
                {ar
                  ? 'لم تحفظ شيئاً بعد. أثناء تصفح السوق، استخدم «حفظ» على أي مورد أو منتج لوضعه جانباً والمقارنة لاحقاً.'
                  : 'Nothing saved yet. While you browse the marketplace, use Save on any supplier or product to set it aside and compare later.'}
              </p>
              <Button variant="outline" onClick={() => navigate('/marketplace')} data-testid="saved-browse">
                {ar ? 'تصفّح السوق' : 'Browse the marketplace'}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {providers.length > 0 && (
              <Card data-testid="saved-providers">
                <CardHeader>
                  <CardTitle className="text-base">
                    {ar ? 'الموردون والمحترفون' : 'Suppliers & professionals'}
                    <span className="ms-2 text-sm font-normal text-muted-foreground">{providers.length}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {providers.map(item => {
                    const target = item.target as any;
                    return (
                      <div key={item.id} className="flex items-start justify-between gap-2 rounded-lg border p-3">
                        {/* SELECTING IS NOT NAVIGATING. The checkbox is its
                            own control with its own accessible name, beside
                            the button that opens the storefront, so neither
                            can be hit by aiming for the other (§62). */}
                        <Checkbox
                          className="mt-0.5 shrink-0"
                          checked={isPicked('provider', Number(target.id))}
                          onCheckedChange={() => toggle('provider', Number(target.id))}
                          data-testid={`saved-pick-provider-${target.id}`}
                          aria-label={ar
                            ? `أدرج ${target.businessName || target.name} في طلب العروض`
                            : `Include ${target.businessName || target.name} in the request`}
                        />
                        <button
                          className="min-w-0 flex-1 text-start"
                          data-testid={`saved-provider-${target.id}`}
                          onClick={() => navigate(`/vendor/${target.id}`)}
                        >
                          {/* The business where there is one, the same rule
                              the directory follows - a shortlist that names
                              people where the directory names companies
                              would look like a different marketplace. */}
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-medium">{target.businessName || target.name}</span>
                            {target.verified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                          </span>
                          {target.businessName && target.name && (
                            <span className="block truncate text-xs text-muted-foreground">{target.name}</span>
                          )}
                          {target.location && (
                            <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                              <MapPin className="h-3 w-3 shrink-0" />{target.location}
                            </span>
                          )}
                        </button>
                        <SaveButton kind="provider" itemId={target.id} saved variant="icon" />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {products.length > 0 && (
              <Card data-testid="saved-products">
                <CardHeader>
                  <CardTitle className="text-base">
                    {ar ? 'المنتجات' : 'Products'}
                    <span className="ms-2 text-sm font-normal text-muted-foreground">{products.length}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {products.map(item => {
                    const target = item.target as any;
                    return (
                      <div key={item.id} className="flex items-start justify-between gap-2 rounded-lg border p-3">
                        <Checkbox
                          className="mt-0.5 shrink-0"
                          checked={isPicked('product', Number(target.id))}
                          onCheckedChange={() => toggle('product', Number(target.id))}
                          data-testid={`saved-pick-product-${target.id}`}
                          aria-label={ar
                            ? `أدرج ${(target.nameAr || target.name)} في طلب العروض`
                            : `Include ${target.name} in the request`}
                        />
                        <button
                          className="min-w-0 flex-1 text-start"
                          data-testid={`saved-product-${target.id}`}
                          onClick={() => navigate(`/marketplace/products/${target.id}`)}
                        >
                          <span className="block truncate font-medium">
                            {ar ? (target.nameAr || target.name) : target.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">{categoryLabel(target.category)}</span>
                          {/* The product's OWN currency. A price with a
                              guessed currency is a wrong number. */}
                          {target.price != null && (
                            <span className="mt-0.5 block text-sm font-semibold">
                              {formatMoney(target.price, target.currency, lang)}
                              {target.unit ? <span className="text-xs font-normal text-muted-foreground"> / {target.unit}</span> : null}
                            </span>
                          )}
                        </button>
                        <SaveButton kind="product" itemId={target.id} saved variant="icon" />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {unavailable.length > 0 && (
              /* NAMED, NOT DROPPED. The buyer chose these; a list that
                 quietly shortens tells them nothing about why. */
              <Card data-testid="saved-unavailable">
                <CardContent className="flex items-start gap-3 py-4">
                  <PackageSearch className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-sm text-muted-foreground">
                    {ar
                      ? `${unavailable.length} من العناصر المحفوظة لم تعد معروضة في السوق. ربما سحبها المورد أو لم يعد حسابه منشوراً.`
                      : `${unavailable.length} saved ${unavailable.length === 1 ? 'item is' : 'items are'} no longer listed on the marketplace — the supplier may have withdrawn them, or their account is no longer public.`}
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
