import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Search, Star, StarOff } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Pager } from '@/components/Pager';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';

/**
 * FEATURED PRODUCTS, AS EDITORIAL CURATION.
 *
 * `products.featured` is editorial merchandising, not paid placement: an
 * administrator chooses which products the marketplace shows first. It never
 * changes the product's owner. This is the control that makes the (already
 * wired) marketplace ordering real instead of inert.
 */
const FEATURED_PAGE_SIZE = 25;

export default function AdminFeaturedProducts() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  /*
   * PAGED AND SEARCHED. Was `.limit(200)` ordered featured-first, so a product
   * outside the first 200 could not be featured from this screen at all - and
   * nothing on the screen said the list had stopped.
   */
  const list = trpc.admin.marketplaceProducts.useQuery(
    { page, pageSize: FEATURED_PAGE_SIZE, search: search || undefined },
    { retry: false, placeholderData: previous => previous },
  );
  const isLoading = list.isLoading;
  const products = (list.data?.rows ?? []) as any[];

  const toggle = trpc.admin.setProductFeatured.useMutation({
    onSuccess: () => {
      void utils.admin.marketplaceProducts.invalidate();
      void utils.marketplace.list.invalidate();
    },
  });

  return (
    <Card data-testid="admin-featured-products">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Star className="h-5 w-5" />
          {ar ? 'منتجات مميزة' : 'Featured products'}
        </CardTitle>
        <p className="pt-1 text-xs text-muted-foreground">
          {ar
            ? 'التمييز هو تنسيق تحريري وليس إعلاناً مدفوعاً. يظهر المنتج المميز أولاً في السوق ولا يغيّر ملكيته.'
            : 'Featured is editorial curation, not paid placement. A featured product appears first in the marketplace; its ownership is unchanged.'}
        </p>
        <form
          className="flex max-w-md gap-2 pt-3"
          onSubmit={event => { event.preventDefault(); setSearch(typed.trim()); setPage(0); }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="ps-9" value={typed} data-testid="featured-products-search"
              onChange={event => setTyped(event.target.value)}
              placeholder={ar ? 'ابحث بالمنتج أو الفئة أو المورد…' : 'Search product, category or supplier…'}
            />
          </div>
          <Button type="submit" variant="outline" className="h-9">{ar ? 'بحث' : 'Search'}</Button>
        </form>
      </CardHeader>

      <CardContent className="space-y-3">
        {list.isError ? (
          <LoadFailed {...loadFailedCopy(ar)} onRetry={() => void list.refetch()} />
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">{ar ? 'جاري التحميل…' : 'Loading…'}</p>
        ) : products.length === 0 ? (
          <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground" data-testid="featured-products-empty">
            {search
              ? (ar ? 'لا توجد منتجات مطابقة لهذا البحث.' : 'No products match this search.')
              : (ar ? 'لم يُدرج أي منتج بعد.' : 'No product has been listed yet.')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm" data-testid="featured-products-table">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-3 py-2 text-start font-medium text-muted-foreground">{ar ? 'المنتج' : 'Product'}</th>
                  <th className="px-3 py-2 text-start font-medium text-muted-foreground">{ar ? 'المورّد' : 'Supplier'}</th>
                  <th className="px-3 py-2 text-start font-medium text-muted-foreground">{ar ? 'الفئة' : 'Category'}</th>
                  <th className="px-3 py-2 text-start font-medium text-muted-foreground">{ar ? 'الحالة' : 'Status'}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      {ar && p.nameAr ? p.nameAr : p.name}
                      <span className="text-muted-foreground"> #{p.id}</span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{p.supplierName ?? `#${p.supplierId}`}</td>
                    <td className="px-3 py-2">{p.category}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {!p.active && <Badge variant="outline" className="text-[10px]">{ar ? 'مخفي' : 'Delisted'}</Badge>}
                        {p.featured && <Badge className="text-[10px]">{ar ? 'مميز' : 'Featured'}</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-end">
                      <Button
                        size="sm"
                        variant={p.featured ? 'outline' : 'default'}
                        data-testid={`featured-toggle-${p.id}`}
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate({ productId: p.id, featured: !p.featured })}
                      >
                        {p.featured ? <StarOff className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />}
                        <span className="ms-1">{p.featured ? (ar ? 'إلغاء التمييز' : 'Unfeature') : (ar ? 'تمييز' : 'Feature')}</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pager
          ar={ar} page={page} total={list.data?.total ?? null}
          pageCount={Math.max(1, Math.ceil((list.data?.total ?? 0) / FEATURED_PAGE_SIZE))}
          onChange={setPage} testId="admin-featured-pager"
        />
      </CardContent>
    </Card>
  );
}
