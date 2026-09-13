import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, summariseLines } from '@shared/productImport';
import { Download, FileSpreadsheet, Upload, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

/**
 * BULK CATALOGUE IMPORT, for a supplier with more than a handful of products.
 *
 * The flow is deliberately preview-then-commit: a supplier uploads, sees
 * exactly which rows are wrong and why, fixes the file, and only then writes.
 * The preview calls the SAME server procedure with dryRun, so what it reports
 * is the server's verdict rather than a second opinion computed in the browser.
 *
 * WHAT THIS SCREEN LEARNED FROM THE REPORTED FAILURE. A supplier uploaded a
 * real catalogue and got dozens of identical "Waterproofing is not a BuildHub
 * category" lines - one per row, no summary, no indication that it was one
 * problem, and no way to see what the acceptable categories actually were. So:
 *
 *   - category failures LEAD, grouped by the offending value with the rows
 *     collapsed into ranges. Fifty rows is one entry saying "rows 2-51";
 *   - the per-row list is still there, behind a disclosure, because an error
 *     export needs it and a supplier fixing one odd row wants it;
 *   - the clean preview shows what each value RESOLVED TO before anything is
 *     written, so a supplier who typed "Pools" sees "Swimming Pool Equipment"
 *     here rather than discovering the mapping afterwards;
 *   - the acceptable categories are listed ON THIS PAGE, read live from the
 *     taxonomy. Not a help article that goes stale the first time an
 *     administrator adds one.
 */
type ImportSummary = {
  totalRows: number; errorCount: number; imported: number; dryRun: boolean;
  errors: { line: number; column: string; message: string }[];
  duplicatesInFile: string[];
  categoryIssues: { supplied: string; reason: string; message: string; suggestions: string[]; lines: number[] }[];
  resolvedCategories: { supplied: string; resolved: string }[];
};

export default function ProductImport({ onImported }: { onImported?: () => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const fileInput = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ImportSummary | null>(null);

  const template = trpc.marketplace.importTemplate.useQuery();
  /**
   * The live taxonomy, not a compiled-in copy. The whole point of the category
   * work is that an administrator can add one without a deployment; a
   * reference list shipped in this bundle would be stale the moment they did.
   */
  const taxonomy = trpc.marketplace.categories.useQuery({ view: 'listable' });
  const importProducts = trpc.marketplace.importProducts.useMutation({
    onSuccess: (summary) => {
      setResult(summary as ImportSummary);
      if (!summary.dryRun && summary.imported > 0) {
        toast.success(ar ? `تم استيراد ${summary.imported} منتجاً` : `Imported ${summary.imported} products`);
        setCsv(null); setFileName('');
        onImported?.();
      }
    },
    onError: (error) => toast.error(error.message),
  });

  async function readFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error(ar ? 'الملف كبير جداً' : 'That file is too large');
      return;
    }
    // The read and the upload are separated so a file that cannot be read
    // reports a read failure, not a server refusal.
    let text: string;
    try { text = await file.text(); }
    catch { toast.error(ar ? 'تعذّرت قراءة الملف' : 'That file could not be read'); return; }
    setCsv(text);
    setFileName(file.name);
    setResult(null);
    importProducts.mutate({ csv: text, dryRun: true });
  }

  function downloadTemplate() {
    const content = template.data?.csv;
    if (!content) return;
    // A BOM so Excel opens the Arabic column correctly instead of as mojibake.
    const blob = new Blob([`﻿${content}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'buildhub-products-template.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /** "rows 2-51" / "rows 4, 9-12". Ranges come from the shared helper. */
  const rowRanges = (lines: number[]) => summariseLines(lines)
    .map(range => (range.from === range.to ? `${range.from}` : `${range.from}–${range.to}`))
    .join(ar ? '، ' : ', ');

  const blocked = (result?.errorCount ?? 0) > 0;
  const categoryIssues = result?.categoryIssues ?? [];
  /** Only the mappings worth showing: a value that resolved to itself is not news. */
  const renamed = (result?.resolvedCategories ?? []).filter(entry => entry.supplied.trim() !== entry.resolved);
  const listable = taxonomy.data?.categories ?? [];

  return (
    <Card data-testid="product-import">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSpreadsheet className="h-4 w-4" />
          {ar ? 'استيراد المنتجات من ملف' : 'Import products from a file'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {ar
            ? `ارفع ملف CSV يحتوي على منتجاتك (حتى ${MAX_IMPORT_ROWS} صف). سنعرض لك الأخطاء قبل الحفظ.`
            : `Upload a CSV of your products (up to ${MAX_IMPORT_ROWS} rows). You will see any problems before anything is saved.`}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={downloadTemplate}
            disabled={!template.data} data-testid="import-template">
            <Download className="h-4 w-4" />
            {ar ? 'تحميل القالب' : 'Download template'}
          </Button>
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden"
            data-testid="import-file" onChange={event => readFile(event.target.files)} />
          <Button size="sm" className="gap-2" onClick={() => fileInput.current?.click()}
            disabled={importProducts.isPending} data-testid="import-choose">
            <Upload className="h-4 w-4" />
            {ar ? 'اختر ملفاً' : 'Choose a file'}
          </Button>
        </div>

        {/*
          THE ACCEPTABLE CATEGORIES, ON THE PAGE THAT NEEDS THEM.
          Collapsed by default so it does not crowd the upload, and read from
          the same taxonomy the server validates against - so it can never say
          something the import then refuses.
        */}
        {listable.length > 0 && (
          <details className="rounded-lg border text-sm" data-testid="import-categories">
            <summary className="cursor-pointer px-3 py-2 font-medium">
              {ar
                ? `الفئات المقبولة (${listable.length})`
                : `Categories you can use (${listable.length})`}
            </summary>
            <ul className="flex flex-wrap gap-1.5 px-3 pb-3 pt-1">
              {listable.map(category => (
                <li key={category.id} data-testid="import-category-option"
                  className="rounded-full border bg-muted/40 px-2 py-0.5 text-xs">
                  {ar ? category.nameAr : category.nameEn}
                </li>
              ))}
            </ul>
            <p className="px-3 pb-3 text-xs text-muted-foreground">
              {ar
                ? 'اكتب اسم الفئة في عمود category كما هو مكتوب هنا.'
                : 'Write the category name in the "category" column exactly as it appears here.'}
            </p>
          </details>
        )}

        {fileName && <p className="text-xs text-muted-foreground" data-testid="import-filename">{fileName}</p>}

        {result && (
          <div className="rounded-lg border p-3" data-testid="import-result">
            {blocked ? (
              <>
                <p className="flex items-center gap-2 text-sm font-medium text-destructive" data-testid="import-blocked">
                  <AlertTriangle className="h-4 w-4" />
                  {ar
                    ? `${result.errorCount} خطأ — لم يتم حفظ أي شيء`
                    : `${result.errorCount} problem${result.errorCount === 1 ? '' : 's'} — nothing was saved`}
                </p>

                {/*
                  GROUPED FIRST. One entry per offending value, with the rows
                  collapsed into ranges and the suggestion the server offered.
                */}
                {categoryIssues.length > 0 && (
                  <ul className="mt-2 space-y-2" data-testid="import-category-issues">
                    {categoryIssues.map(issue => (
                      <li key={issue.supplied} className="rounded-md bg-destructive/5 p-2 text-xs"
                        data-testid="import-category-issue">
                        <p className="font-medium">
                          &ldquo;{issue.supplied}&rdquo;
                          {' · '}
                          {ar
                            ? `${issue.lines.length} صف (صفوف ${rowRanges(issue.lines)})`
                            : `${issue.lines.length} row${issue.lines.length === 1 ? '' : 's'} (row${issue.lines.length === 1 ? '' : 's'} ${rowRanges(issue.lines)})`}
                        </p>
                        <p className="mt-0.5 text-muted-foreground">{issue.message}</p>
                        {issue.suggestions.length > 0 && (
                          <p className="mt-0.5" data-testid="import-category-suggestion">
                            {ar ? 'هل تقصد: ' : 'Did you mean: '}
                            {issue.suggestions.join(ar ? '، ' : ', ')}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {/*
                  The per-row detail is retained, not replaced - an error export
                  needs it, and a supplier fixing one odd row wants it. Behind a
                  disclosure so it does not bury the summary above.
                */}
                <details className="mt-2" data-testid="import-row-errors">
                  <summary className="cursor-pointer text-xs font-medium">
                    {ar
                      ? `عرض أخطاء الصفوف (${result.errors.length})`
                      : `Show row-by-row errors (${result.errors.length})`}
                  </summary>
                  <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs">
                    {result.errors.map((error, index) => (
                      <li key={`${error.line}-${error.column}-${index}`} data-testid="import-error">
                        <span className="font-medium">{ar ? `صف ${error.line}` : `Row ${error.line}`}</span>
                        {' · '}{error.column}{' — '}{error.message}
                      </li>
                    ))}
                  </ul>
                  {result.errorCount > result.errors.length && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ar
                        ? `تُعرض أول ${result.errors.length} من ${result.errorCount}.`
                        : `Showing the first ${result.errors.length} of ${result.errorCount}.`}
                    </p>
                  )}
                </details>

                <p className="mt-2 text-xs text-muted-foreground">
                  {ar
                    ? 'صحّح الملف وارفعه مرة أخرى. الاستيراد كله أو لا شيء.'
                    : 'Fix the file and upload it again. An import is all or nothing.'}
                </p>
              </>
            ) : result.dryRun ? (
              <>
                <p className="flex items-center gap-2 text-sm font-medium" data-testid="import-ready">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  {ar ? `${result.totalRows} صف جاهز للاستيراد` : `${result.totalRows} rows ready to import`}
                </p>

                {/*
                  WHAT IT WILL BE FILED UNDER, before it is written. Only the
                  values that will change, so the list is short enough to read.
                */}
                {renamed.length > 0 && (
                  <div className="mt-2" data-testid="import-resolved">
                    <p className="text-xs font-medium">
                      {ar ? 'ستُحفظ هذه الفئات باسمها الرسمي:' : 'These categories will be saved under their canonical name:'}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {renamed.map(entry => (
                        <li key={entry.supplied} className="flex items-center gap-1.5" data-testid="import-resolved-row">
                          <span>{entry.supplied}</span>
                          <ArrowRight className={`h-3 w-3 shrink-0 ${ar ? 'rotate-180' : ''}`} aria-hidden />
                          <span className="font-medium text-foreground">{entry.resolved}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Button size="sm" className="mt-2" data-testid="import-commit"
                  disabled={importProducts.isPending || !csv}
                  onClick={() => csv && importProducts.mutate({ csv, dryRun: false })}>
                  {importProducts.isPending
                    ? (ar ? 'جارٍ الاستيراد…' : 'Importing…')
                    : (ar ? `استيراد ${result.totalRows} منتجاً` : `Import ${result.totalRows} products`)}
                </Button>
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm font-medium" data-testid="import-done">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                {ar ? `تم استيراد ${result.imported} منتجاً` : `Imported ${result.imported} products`}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
