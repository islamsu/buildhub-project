import { useLanguage } from '@/contexts/LanguageContext';
import DashboardLayout from '@/components/DashboardLayout';
import VendorServiceCategories from '@/components/VendorServiceCategories';

/**
 * SERVICE CATEGORIES, ON THEIR OWN PAGE.
 *
 * What a vendor declares here decides which RFQs reach them, so it is not a
 * cosmetic preference tucked into a settings accordion - it is the single
 * control over their entire inbound pipeline.
 *
 * It also remains inside Settings, and that is deliberate rather than a
 * duplicate surface: Settings is where a vendor configures their account, and
 * this is configuration. The dashboard shows a SUMMARY that links here, which
 * is what the brief asks for - one editable surface, reachable two ways,
 * rather than two editors that can disagree.
 */
export default function ServiceCategoriesPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';

  return (
    <DashboardLayout>
      <div className="space-y-6" dir={ar ? 'rtl' : 'ltr'} data-testid="service-categories-page">
        <div>
          <h1 className="text-xl font-bold">{ar ? 'فئات الخدمة' : 'Service categories'}</h1>
          <p className="text-sm text-muted-foreground">
            {ar
              ? 'ما تختاره هنا يحدّد أي طلبات عروض الأسعار تصلك.'
              : 'What you declare here decides which requests for quotation reach you.'}
          </p>
        </div>
        <VendorServiceCategories />
      </div>
    </DashboardLayout>
  );
}
