import { useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { FileText, Image as ImageIcon, Plus, Upload } from 'lucide-react';
import {
  PROJECT_DOCUMENT_TYPES,
  PROJECT_DOCUMENT_CONTENT_TYPES,
  isAllowedProjectDocumentType,
  type ProjectDocumentType,
} from '@shared/projectFeatures';

/**
 * THE PROJECT DOCUMENTS TAB.
 *
 * This tab was a hardcoded panel: an icon, the sentence "Upload drawings,
 * BOQs, contracts, and invoices", and an Upload Document button with no
 * handler at all. Meanwhile `projects.documents` and `projects.uploadDocument`
 * were both complete on the server - owner-scoped, rate-limited, size-capped
 * and byte-sniffed. The capability existed; only the way to reach it did not.
 *
 * That is the mirror image of the usual failure, and it is worth naming: a
 * screen that DESCRIBES a feature is the most convincing possible evidence
 * that the feature is missing, because it reads exactly like the feature
 * working.
 *
 * WHAT THIS COMPONENT DOES NOT DO. It does not decide who may upload. The
 * server re-reads the project and refuses anybody who is not its owner, and
 * that is the control - this component would render the same for a
 * non-owner and every call would fail, which is the correct arrangement.
 */

/** The server's cap. Checked here too so the answer arrives before the upload. */
const MAX_SIZE = 8 * 1024 * 1024;

const readAsBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
  reader.onerror = () => reject(new Error('Read failed'));
  reader.readAsDataURL(file);
});

const TYPE_LABELS: Record<ProjectDocumentType, { en: string; ar: string }> = {
  drawing:  { en: 'Drawing',  ar: 'مخطط' },
  boq:      { en: 'BOQ',      ar: 'جدول كميات' },
  photo:    { en: 'Photo',    ar: 'صورة' },
  contract: { en: 'Contract', ar: 'عقد' },
  invoice:  { en: 'Invoice',  ar: 'فاتورة' },
  other:    { en: 'Other',    ar: 'أخرى' },
};

function formatSize(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProjectDocuments({ projectId }: { projectId: number }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<ProjectDocumentType>('drawing');
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState<'all' | ProjectDocumentType>('all');

  const documents = trpc.projects.documents.useQuery({ projectId }, { enabled: projectId > 0 });

  const upload = trpc.projects.uploadDocument.useMutation({
    onSuccess: () => {
      toast.success(ar ? 'تم رفع المستند' : 'Document uploaded');
      setOpen(false);
      setFile(null);
      setName('');
      documents.refetch();
    },
    // The server owns every refusal reason - not the owner, wrong bytes, too
    // large, rate limited. Its message is shown rather than a guess.
    onError: error => toast.error(error.message),
  });

  function choose(selected: File | null) {
    if (!selected) return;
    // Both checks mirror the server exactly. They exist so the answer arrives
    // before a multi-megabyte upload, NOT as the control - the server repeats
    // both and its verdict is the one that counts.
    if (!isAllowedProjectDocumentType(selected.type)) {
      toast.error(ar
        ? 'نوع الملف غير مدعوم. المسموح: صور PNG أو JPEG أو GIF أو WebP، أو ملف PDF.'
        : 'That file type is not supported. Allowed: PNG, JPEG, GIF or WebP images, or a PDF.');
      return;
    }
    if (selected.size > MAX_SIZE) {
      toast.error(ar ? 'الحد الأقصى لحجم الملف 8 ميجابايت.' : 'Files must be 8MB or smaller.');
      return;
    }
    setFile(selected);
    if (!name) setName(selected.name);
  }

  async function submit() {
    if (!file || !name.trim()) return;
    setUploading(true);
    try {
      const base64 = await readAsBase64(file);
      await upload.mutateAsync({ projectId, name: name.trim(), type, contentType: file.type, base64 });
    } catch {
      // mutateAsync rejections already surfaced by onError; this catches the
      // FileReader failing, which onError never sees.
      if (!upload.isError) toast.error(ar ? 'تعذر قراءة الملف.' : 'That file could not be read.');
    } finally {
      setUploading(false);
    }
  }

  const rows = (documents.data ?? []).filter(doc => filter === 'all' || doc.type === filter);

  return (
    <div data-testid="project-documents">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{ar ? 'مستندات المشروع' : 'Project Documents'}</h3>
          <Select value={filter} onValueChange={value => setFilter(value as typeof filter)}>
            <SelectTrigger className="h-8 w-[150px] text-xs" data-testid="documents-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{ar ? 'كل الأنواع' : 'All types'}</SelectItem>
              {PROJECT_DOCUMENT_TYPES.map(value => (
                <SelectItem key={value} value={value}>{ar ? TYPE_LABELS[value].ar : TYPE_LABELS[value].en}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)} data-testid="documents-upload-open">
          <Plus className="h-4 w-4" />{ar ? 'رفع مستند' : 'Upload Document'}
        </Button>
      </div>

      {documents.isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">{ar ? 'جاري التحميل…' : 'Loading…'}</p>
      )}

      {!documents.isLoading && rows.length === 0 && (
        <div className="rounded-xl border-2 border-dashed py-16 text-center text-muted-foreground" data-testid="documents-empty">
          <FileText className="mx-auto mb-4 h-12 w-12 opacity-30" />
          <p className="mb-1 font-medium">
            {(documents.data ?? []).length === 0
              ? (ar ? 'لا توجد مستندات بعد' : 'No documents yet')
              : (ar ? 'لا توجد مستندات من هذا النوع' : 'No documents of this type')}
          </p>
          <p className="text-sm">
            {ar
              ? 'ارفع المخططات وجداول الكميات والعقود والفواتير — صور أو ملفات PDF حتى 8 ميجابايت.'
              : 'Upload drawings, BOQs, contracts and invoices — images or PDFs up to 8MB.'}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {rows.map(doc => (
          <div key={doc.id} className="flex items-center gap-3 rounded-lg border p-3" data-testid="document-row">
            <span className="text-muted-foreground">
              {String(doc.url ?? '').match(/\.(png|jpe?g|gif|webp)$/i)
                ? <ImageIcon className="h-4 w-4" />
                : <FileText className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <a
                href={doc.url ?? '#'} target="_blank" rel="noreferrer"
                className="truncate text-sm font-medium hover:underline"
              >
                {doc.name}
              </a>
              <p className="text-xs text-muted-foreground">
                {formatSize(doc.size)}
                {doc.createdAt && ` · ${new Date(doc.createdAt).toLocaleDateString(ar ? 'ar-EG' : 'en-US')}`}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {ar
                ? TYPE_LABELS[doc.type as ProjectDocumentType]?.ar ?? doc.type
                : TYPE_LABELS[doc.type as ProjectDocumentType]?.en ?? doc.type}
            </Badge>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" dir={ar ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="text-start">{ar ? 'رفع مستند' : 'Upload Document'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-start">
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept={PROJECT_DOCUMENT_CONTENT_TYPES.join(',')}
              onChange={event => choose(event.target.files?.[0] ?? null)}
              data-testid="documents-file-input"
            />
            <Button
              variant="outline" className="w-full justify-start gap-2"
              onClick={() => fileInput.current?.click()}
              data-testid="documents-choose-file"
            >
              <Upload className="h-4 w-4" />
              <span className="truncate">
                {file ? file.name : (ar ? 'اختر ملفاً' : 'Choose a file')}
              </span>
            </Button>
            <Input
              placeholder={ar ? 'اسم المستند' : 'Document name'}
              value={name}
              onChange={event => setName(event.target.value)}
              maxLength={255}
              data-testid="documents-name"
            />
            <Select value={type} onValueChange={value => setType(value as ProjectDocumentType)}>
              <SelectTrigger data-testid="documents-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROJECT_DOCUMENT_TYPES.map(value => (
                  <SelectItem key={value} value={value}>{ar ? TYPE_LABELS[value].ar : TYPE_LABELS[value].en}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {ar
                ? 'الأنواع المدعومة: PNG، JPEG، GIF، WebP، PDF. الحد الأقصى 8 ميجابايت.'
                : 'Supported: PNG, JPEG, GIF, WebP, PDF. Maximum 8MB.'}
            </p>
            <Button
              className="w-full gap-2"
              onClick={submit}
              disabled={uploading || upload.isPending || !file || !name.trim()}
              data-testid="documents-submit"
            >
              <Upload className="h-4 w-4" />
              {uploading || upload.isPending
                ? (ar ? 'جاري الرفع…' : 'Uploading…')
                : (ar ? 'رفع' : 'Upload')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
