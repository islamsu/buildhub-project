import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from '@shared/productImport';
import { Download, FileSpreadsheet, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * BULK CATALOGUE IMPORT, for a supplier with more than a handful of products.
 *
 * The flow is deliberately preview-then-commit: a supplier uploads, sees
 * exactly which rows are wrong and why, fixes the file, and only then writes.
 * The preview calls the SAME server procedure with dryRun, so what it reports
 * is the server's verdict rather than a second opinion computed in the browser.
 */
export default function ProductImport({ onImported }: { onImported?: () => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const fileInput = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<{
    totalRows: number; errorCount: number; imported: number; dryRun: boolean;
    errors: { line: number; column: string; message: string }[];
    duplicatesInFile: string[];
  } | null>(null);

  const template = trpc.marketplace.importTemplate.useQuery();
  const importProducts = trpc.marketplace.importProducts.useMutation({
    onSuccess: (summary) => {
      setResult(summary);
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

  const blocked = (result?.errorCount ?? 0) > 0;

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
                <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs">
                  {result.errors.map((error, index) => (
                    <li key={`${error.line}-${error.column}-${index}`} data-testid="import-error">
                      <span className="font-medium">{ar ? `صف ${error.line}` : `Row ${error.line}`}</span>
                      {' · '}{error.column}{' — '}{error.message}
                    </li>
                  ))}
                </ul>
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
