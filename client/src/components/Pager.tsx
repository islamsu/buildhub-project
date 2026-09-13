import { Button } from '@/components/ui/button';


/**
 * The page control, WITH THE TOTAL.
 *
 * Shared, not copied. It began inside AdminReferrals; the dispute queue needs
 * exactly the same control, and a second copy would be a second place for the
 * "Counting..." correction below to be missing from.
 *
 * "Page 1 of 4" and the real row count together are what stop a list from
 * quietly being a subset - which is exactly what `.limit(250)` and no count
 * produced here before.
 */
export function Pager({ ar, page, pageCount, total, onChange, testId }: {
  ar: boolean; page: number; pageCount: number; total: number | null;
  onChange: (page: number) => void; testId: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid={testId}>
      {/*
        NO COUNT UNTIL THERE IS ONE.
        `total ?? 0` printed a confident "0 records" while the query was still
        in flight, which an administrator glancing at the screen reads as "no
        referrals" - the same defect as an empty state standing in for a
        failure, in a smaller place. A null total means not yet known, and the
        page says that instead of asserting a number it does not have.
      */}
      <span className="text-xs text-muted-foreground" data-testid={`${testId}-total`}>
        {total === null
          ? (ar ? 'جارٍ الحساب…' : 'Counting…')
          : ar ? `${total} سجل` : `${total} record${total === 1 ? '' : 's'}`}
      </span>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="h-7" disabled={page === 0} onClick={() => onChange(page - 1)}>
          {ar ? 'السابق' : 'Previous'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {ar ? `صفحة ${page + 1} من ${pageCount}` : `Page ${page + 1} of ${pageCount}`}
        </span>
        <Button type="button" size="sm" variant="outline" className="h-7" disabled={page + 1 >= pageCount} onClick={() => onChange(page + 1)}>
          {ar ? 'التالي' : 'Next'}
        </Button>
      </div>
    </div>
  );
}
