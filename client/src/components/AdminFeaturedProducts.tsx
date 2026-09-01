import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Star, StarOff } from 'lucide-react';

/**
 * FEATURED PRODUCTS, AS EDITORIAL CURATION.
 *
 * `products.featured` is editorial merchandising, not paid placement: an
 * administrator chooses which products the marketplace shows first. It never
 * changes the product's owner. This is the control that makes the (already
 * wired) marketplace ordering real instead of inert.
 */
export default function AdminFeaturedProducts() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();
  const { data: products = [], isLoading } = trpc.admin.marketplaceProducts.useQuery(undefined, { retry: false });

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
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{ar ? 'جاري التحميل…' : 'Loading…'}</p>
        ) : products.length === 0 ? (
          <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground" data-testid="featured-products-empty">
            {ar ? 'لا توجد منتجات.' : 'No products.'}
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
      </CardContent>
    </Card>
  );
}
