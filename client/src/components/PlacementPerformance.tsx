/**
 * ── COMMERCIAL PLACEMENT PERFORMANCE ──────────────────────────────────────
 *
 * Every number here is a COUNT of events that were actually observed. There is
 * no revenue, GMV, commission or order column - BuildHub observes none of them
 * while payments are deferred, and a column is an invitation to fill it in.
 *
 * TWO PRESENTATION RULES THAT ARE REALLY HONESTY RULES.
 *
 * 1. A rate with no denominator shows a dash, not 0%. "0% clicked" asserts
 *    that people saw the placement and chose not to act. With no impressions
 *    the truth is that there is nothing to compute yet, and those are entirely
 *    different facts for someone deciding whether a campaign is working.
 *
 * 2. The formulas are printed on the screen. An administrator comparing two
 *    placements needs to know that conversion is measured against VIEWS and
 *    not against impressions, without reading the source.
 */
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart3 } from 'lucide-react';

/** A percentage, or an explicit dash when there is nothing to divide by. */
function Rate({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-muted-foreground" title="No observations yet">—</span>;
  }
  return <span>{value}%</span>;
}

export default function PlacementPerformance() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { data, isLoading } = trpc.admin.placementPerformance.useQuery();
  const rows = data?.rows ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          {ar ? 'أداء المساحات الإعلانية' : 'Placement performance'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* The formulas, stated on the screen rather than left implicit. */}
        <div className="mb-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">CTR = {data?.formulas.ctr ?? 'CTA actions ÷ impressions'}</Badge>
          <Badge variant="outline">View rate = {data?.formulas.viewRate ?? 'entity views ÷ impressions'}</Badge>
          <Badge variant="outline">Conversion = {data?.formulas.conversionRate ?? 'attributed qualified enquiries ÷ entity views'}</Badge>
        </div>

        {isLoading && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {ar ? 'جارٍ التحميل…' : 'Loading…'}
          </p>
        )}

        {/* A REAL empty state. No placements means no rows - not a demonstration
            table with plausible-looking numbers in it. */}
        {!isLoading && rows.length === 0 && (
          <div className="rounded-xl border border-dashed py-10 text-center">
            <p className="font-medium">{ar ? 'لا توجد مساحات إعلانية بعد' : 'No placements booked yet'}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {ar
                ? 'ستظهر الأرقام هنا بعد حجز مساحة وظهورها فعلياً للزوّار.'
                : 'Figures appear here once a placement is booked and actually seen by visitors.'}
            </p>
          </div>
        )}

        {!isLoading && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-2">{ar ? 'الجهة' : 'Entity'}</th>
                  <th className="p-2">{ar ? 'السطح' : 'Surface'}</th>
                  <th className="p-2 text-right">{ar ? 'الظهور' : 'Impressions'}</th>
                  <th className="p-2 text-right">{ar ? 'المشاهدات' : 'Entity views'}</th>
                  <th className="p-2 text-right">{ar ? 'الإجراءات' : 'CTA actions'}</th>
                  <th className="p-2 text-right">{ar ? 'طلبات مؤهلة' : 'Qualified enquiries'}</th>
                  <th className="p-2 text-right">CTR</th>
                  <th className="p-2 text-right">{ar ? 'معدل المشاهدة' : 'View rate'}</th>
                  <th className="p-2 text-right">{ar ? 'معدل التحويل' : 'Conversion'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.placementId} className="border-b last:border-0">
                    <td className="p-2 font-medium">
                      {/* The business, not the row id - the Admin human-first rule. */}
                      {row.entityName ?? <span className="text-muted-foreground">{ar ? 'غير متاح' : 'Not available'}</span>}
                      <span className="ms-2 text-xs text-muted-foreground">{row.entityType}</span>
                    </td>
                    <td className="p-2 text-muted-foreground">{row.surface ?? '—'}</td>
                    <td className="p-2 text-right tabular-nums">{row.impressions}</td>
                    <td className="p-2 text-right tabular-nums">{row.entityViews}</td>
                    <td className="p-2 text-right tabular-nums">{row.ctaActions}</td>
                    <td className="p-2 text-right tabular-nums">{row.qualifiedEnquiries}</td>
                    <td className="p-2 text-right tabular-nums"><Rate value={row.ctr} /></td>
                    <td className="p-2 text-right tabular-nums"><Rate value={row.viewRate} /></td>
                    <td className="p-2 text-right tabular-nums"><Rate value={row.conversionRate} /></td>
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
