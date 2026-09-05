import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Link } from 'wouter';
import { Package, Search, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Pager } from '@/components/Pager';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';

const PAGE_SIZE = 25;

export default function AdminProducts() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  /*
   * THE SEARCH RUNS IN THE QUERY, NOT IN THE BROWSER.
   *
   * This filtered a `.limit(250)` array, so a product on row 251 came back as
   * "no matching products" - with exactly the confidence of a correct answer,
   * and no total on the screen to hint otherwise.
   */
  const list = trpc.admin.products.useQuery(
    { page, pageSize: PAGE_SIZE, search: search || undefined },
    { retry: false, placeholderData: previous => previous },
  );
  const isLoading = list.isLoading;
  const filtered = (list.data?.rows ?? []) as any[];

  return (
    <Card data-testid="admin-products">
      <CardHeader className="space-y-3">
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          {ar ? 'إدارة المنتجات' : 'Product Management'}
        </CardTitle>
        <form
          className="flex max-w-md gap-2"
          onSubmit={event => { event.preventDefault(); setSearch(typed.trim()); setPage(0); }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="ps-9"
              value={typed}
              data-testid="admin-products-search"
              onChange={event => setTyped(event.target.value)}
              placeholder={ar ? 'ابحث بالمنتج أو المورد أو الفئة…' : 'Search product, supplier or category…'}
            />
          </div>
          <Button type="submit" variant="outline" className="h-9">{ar ? 'بحث' : 'Search'}</Button>
        </form>
      </CardHeader>
      <CardContent className="space-y-3">
        {list.isError ? (
          <LoadFailed {...loadFailedCopy(ar)} onRetry={() => void list.refetch()} />
        ) : isLoading ? (
          <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {ar ? 'جارٍ التحميل…' : 'Loading…'}
          </p>
        ) : filtered.length === 0 ? (
          /* Two sentences, because "no products listed" and "none match this
             search" are different facts and only one of them is about you. */
          <p className="py-12 text-center text-sm text-muted-foreground" data-testid="admin-products-empty">
            {search
              ? (ar ? 'لا توجد منتجات مطابقة لهذا البحث.' : 'No products match this search.')
              : (ar ? 'لم يُدرج أي منتج بعد.' : 'No product has been listed yet.')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-start">
                  <th className="p-2 text-start font-medium text-muted-foreground">{ar ? 'المنتج' : 'Product'}</th>
                  <th className="p-2 text-start font-medium text-muted-foreground">{ar ? 'المورد' : 'Supplier'}</th>
                  <th className="p-2 text-start font-medium text-muted-foreground">{ar ? 'الفئة' : 'Category'}</th>
                  <th className="p-2 text-start font-medium text-muted-foreground">{ar ? 'السعر' : 'Price'}</th>
                  <th className="p-2 text-start font-medium text-muted-foreground">{ar ? 'الحالة' : 'State'}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(product => (
                  <tr key={product.id} className="border-b border-border/50">
                    <td className="p-2">
                      <Link href={`/marketplace/products/${product.id}`} className="font-medium underline-offset-2 hover:underline">
                        {product.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{product.brand || '—'}</p>
                    </td>
                    <td className="p-2">
                      {product.supplierId ? (
                        <Link href={`/vendor/${product.supplierId}`} className="text-muted-foreground underline-offset-2 hover:underline">
                          {product.supplierName || `#${product.supplierId}`}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="p-2 text-muted-foreground">{product.category || '—'}</td>
                    <td className="p-2 text-muted-foreground">{product.price ?? '—'}</td>
                    <td className="p-2">
                      <Badge variant={product.active ? 'default' : 'secondary'}>
                        {ar ? (product.active ? 'منشور' : 'مخفي') : (product.active ? 'Active' : 'Hidden')}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pager
          ar={ar} page={page} total={list.data?.total ?? null}
          pageCount={Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE))}
          onChange={setPage} testId="admin-products-pager"
        />
      </CardContent>
    </Card>
  );
}
