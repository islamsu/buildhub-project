import DashboardLayout from '@/components/DashboardLayout';
import SupplierCatalogue from '@/components/SupplierCatalogue';
import ProductImport from '@/components/ProductImport';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';

/**
 * DEDICATED CATALOGUE MANAGEMENT.
 *
 * The dashboard shows only a compact preview; this page is where a supplier
 * manages the full catalogue (questions, edit, images, publish/delist) and
 * performs bulk import. Keeping it here keeps the dashboard a command centre
 * rather than a full list.
 */
export default function CataloguePage() {
  const { lang, dir } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();

  return (
    <DashboardLayout>
      <div dir={dir} className="mx-auto max-w-5xl space-y-6">
        <Link href="/platform/supplier#role-catalogue">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className={`h-4 w-4 ${ar ? 'rotate-180' : ''}`} />
            {ar ? 'لوحة المورد' : 'Supplier dashboard'}
          </Button>
        </Link>
        <ProductImport onImported={() => { void utils.marketplace.myProducts.invalidate(); }} />
        <SupplierCatalogue />
      </div>
    </DashboardLayout>
  );
}
