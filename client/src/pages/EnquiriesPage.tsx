import { useLanguage } from '@/contexts/LanguageContext';
import { useSearch } from 'wouter';
import DashboardLayout from '@/components/DashboardLayout';
import QualifiedEnquiries from '@/components/QualifiedEnquiries';

/**
 * QUALIFIED ENQUIRIES, ON THEIR OWN PAGE.
 *
 * These were a section inside the provider workspace. The brief asks for
 * Enquiries to be a SUMMARY on the dashboard with a dedicated page behind it,
 * and the reason is the one the workspace comment already gave: this is where
 * a notification's `?rfq=` deep link lands. A destination buried three
 * sections down a long workspace is a destination the reader has to hunt for.
 *
 * THE DEEP LINK IS PRESERVED, which is the whole point of moving it here
 * rather than simply linking to the workspace anchor: `?rfq=` still selects
 * and highlights the enquiry, so every notification already in circulation
 * keeps working.
 */
export default function EnquiriesPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const search = useSearch();
  const rfqParam = new URLSearchParams(search).get('rfq');
  const highlightRfqId = rfqParam && /^\d+$/.test(rfqParam) ? Number(rfqParam) : undefined;

  return (
    <DashboardLayout>
      <div className="space-y-6" dir={ar ? 'rtl' : 'ltr'} data-testid="enquiries-page">
        <div>
          <h1 className="text-xl font-bold">{ar ? 'الطلبات المؤهلة' : 'Qualified enquiries'}</h1>
          <p className="text-sm text-muted-foreground">
            {ar
              ? 'الطلبات التي فتحتها، والرصيد المتبقي في باقتك هذا الشهر.'
              : 'The requests you have opened, and what your plan leaves you this month.'}
          </p>
        </div>
        <QualifiedEnquiries highlightRfqId={highlightRfqId} />
      </div>
    </DashboardLayout>
  );
}
