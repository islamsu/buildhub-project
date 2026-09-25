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
import { BadgeCheck, Bookmark, MapPin, PackageSearch } from 'lucide-react';

/**
 * ── THE SHORTLIST ───────────────────────────────────────────────────────
 *
 * PRODUCT_NORTH_STAR.md CURRENT GLOBAL RELEASE item 9. The place the work of
 * comparing eleven suppliers survives closing the tab.
 *
 * IT ENDS IN AN ACTION. A shortlist that only holds things is a list; §22
 * says the buyer's two paths must connect, so the page's primary action
 * turns what has been gathered into a request for quotations. Without that
 * it would be a drawer.
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
          {/* THE ACTION THE LIST EXISTS FOR. A shortlist with no way out of
              it is a drawer; this is where sourcing continues. */}
          {items.length > 0 && (
            <Button data-testid="saved-request-quotes" onClick={() => navigate('/rfq')}>
              {ar ? 'اطلب عروض أسعار' : 'Request quotations'}
            </Button>
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
