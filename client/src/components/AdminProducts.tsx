import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Link } from 'wouter';
import { Package, Search, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';

export default function AdminProducts() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [query, setQuery] = useState('');
  const { data: products = [], isLoading } = trpc.admin.products.useQuery();

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return products;
    return products.filter(product =>
      `${product.name ?? ''} ${product.brand ?? ''} ${product.category ?? ''} ${product.supplierName ?? ''}`.toLowerCase().includes(term),
    );
  }, [products, query]);

  return (
    <Card data-testid="admin-products">
      <CardHeader className="space-y-3">
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          {ar ? 'إدارة المنتجات' : 'Product Management'}
        </CardTitle>
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-9"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={ar ? 'ابحث بالمنتج أو المورد أو الفئة…' : 'Search product, supplier or category…'}
          />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {ar ? 'جارٍ التحميل…' : 'Loading…'}
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {ar ? 'لا توجد منتجات مطابقة.' : 'No matching products.'}
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
      </CardContent>
    </Card>
  );
}
