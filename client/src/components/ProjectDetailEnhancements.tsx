import { useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Calendar, CheckCircle2, Clock, FileText, Image, Loader2, Plus, Receipt, Upload, BarChart3 } from 'lucide-react';

type DocumentType = 'drawing' | 'boq' | 'photo' | 'contract' | 'invoice' | 'other';

const labels = {
  en: {
    timeline: 'Project Timeline', files: 'Project Files', invoices: 'Invoices', reports: 'Progress Reports',
    noMilestones: 'No milestones have been added yet.', noFiles: 'No project files uploaded yet.', noInvoices: 'No invoices uploaded yet.', noReports: 'No progress reports yet.',
    upload: 'Upload File', uploadInvoice: 'Upload Invoice', chooseType: 'Document type', drawing: 'Drawing', boq: 'BOQ', photo: 'Photo', contract: 'Contract', invoice: 'Invoice', other: 'Other',
    reportTitle: 'New Progress Report', title: 'Report title', summary: 'Summary of completed work and blockers', progress: 'Project progress (%)', addReport: 'Add Report', saving: 'Saving…', uploading: 'Uploading…',
    due: 'Due', completed: 'Completed', pending: 'Pending', view: 'View', download: 'Open',
  },
  ar: {
    timeline: 'الجدول الزمني للمشروع', files: 'ملفات المشروع', invoices: 'الفواتير', reports: 'تقارير التقدم',
    noMilestones: 'لم تتم إضافة معالم للمشروع بعد.', noFiles: 'لم يتم رفع ملفات للمشروع بعد.', noInvoices: 'لم يتم رفع فواتير بعد.', noReports: 'لا توجد تقارير تقدم بعد.',
    upload: 'رفع ملف', uploadInvoice: 'رفع فاتورة', chooseType: 'نوع المستند', drawing: 'مخطط', boq: 'جدول كميات', photo: 'صورة', contract: 'عقد', invoice: 'فاتورة', other: 'أخرى',
    reportTitle: 'تقرير تقدم جديد', title: 'عنوان التقرير', summary: 'ملخص الأعمال المنجزة والمعوقات', progress: 'نسبة تقدم المشروع (%)', addReport: 'إضافة تقرير', saving: 'جاري الحفظ…', uploading: 'جاري الرفع…',
    due: 'الاستحقاق', completed: 'مكتمل', pending: 'قيد الانتظار', view: 'عرض', download: 'فتح',
  },
} as const;

export default function ProjectDetailEnhancements({ projectId, lang }: { projectId: number; lang: 'en' | 'ar' }) {
  const copy = labels[lang];
  const [documentType, setDocumentType] = useState<DocumentType>('drawing');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [reportForm, setReportForm] = useState({ title: '', summary: '', progress: '0' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: milestones = [] } = trpc.projects.milestones.useQuery({ projectId });
  const { data: documents = [], refetch: refetchDocuments } = trpc.projects.documents.useQuery({ projectId });
  const { data: reports = [], refetch: refetchReports } = trpc.projects.progressReports.useQuery({ projectId });
  const uploadDocument = trpc.projects.uploadDocument.useMutation({
    onSuccess: () => { toast.success(lang === 'ar' ? 'تم رفع الملف بنجاح' : 'File uploaded successfully'); setUploadProgress(0); refetchDocuments(); if (fileInputRef.current) fileInputRef.current.value = ''; },
    onError: error => { setUploadProgress(0); toast.error(error.message); },
  });
  const addReport = trpc.projects.addProgressReport.useMutation({
    onSuccess: () => { toast.success(lang === 'ar' ? 'تم حفظ التقرير' : 'Progress report saved'); setReportForm({ title: '', summary: '', progress: '0' }); refetchReports(); },
    onError: error => toast.error(error.message),
  });

  const handleFile = (file?: File) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast.error(lang === 'ar' ? 'الحد الأقصى 8 ميجابايت' : 'Maximum file size is 8MB'); return; }
    const contentType = file.type || 'application/octet-stream';
    if (!(contentType.startsWith('image/') || contentType === 'application/pdf' || contentType.startsWith('text/'))) { toast.error(lang === 'ar' ? 'نوع الملف غير مدعوم' : 'Unsupported file type'); return; }
    const reader = new FileReader();
    reader.onprogress = event => { if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 80)); };
    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1] ?? '';
      setUploadProgress(85);
      uploadDocument.mutate({ projectId, name: file.name, type: documentType, contentType, base64 });
    };
    reader.onerror = () => toast.error(lang === 'ar' ? 'تعذر قراءة الملف' : 'Unable to read file');
    reader.readAsDataURL(file);
  };

  const typeLabel = (type: string) => copy[type as DocumentType] ?? copy.other;

  return (
    <Tabs defaultValue="timeline" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <input ref={fileInputRef} type="file" className="hidden" accept="image/*,.pdf,.txt" onChange={event => handleFile(event.target.files?.[0])} />
      <TabsList className="mb-5 flex-wrap h-auto gap-1">
        <TabsTrigger value="timeline" className="gap-1.5"><Calendar className="h-4 w-4" />{copy.timeline}</TabsTrigger>
        <TabsTrigger value="files" className="gap-1.5"><FileText className="h-4 w-4" />{copy.files} ({documents.length})</TabsTrigger>
        <TabsTrigger value="invoices" className="gap-1.5"><Receipt className="h-4 w-4" />{copy.invoices}</TabsTrigger>
        <TabsTrigger value="reports" className="gap-1.5"><BarChart3 className="h-4 w-4" />{copy.reports}</TabsTrigger>
      </TabsList>

      <TabsContent value="timeline"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Calendar className="h-5 w-5" />{copy.timeline}</CardTitle></CardHeader><CardContent><div className="space-y-4">{milestones.length === 0 ? <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{copy.noMilestones}</div> : milestones.map((milestone, index) => <div key={milestone.id} className="relative flex gap-4"><div className="flex flex-col items-center"><div className={`flex h-9 w-9 items-center justify-center rounded-full ${milestone.status === 'completed' ? 'bg-emerald-100 text-emerald-600' : 'bg-primary/10 text-primary'}`}>{milestone.status === 'completed' ? <CheckCircle2 className="h-5 w-5" /> : <span className="text-sm font-semibold">{index + 1}</span>}</div>{index < milestones.length - 1 && <div className="mt-1 h-full min-h-8 w-px bg-border" />}</div><div className="min-w-0 flex-1 pb-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{milestone.title}</p><Badge variant={milestone.status === 'completed' ? 'default' : 'outline'}>{milestone.status === 'completed' ? copy.completed : copy.pending}</Badge></div>{milestone.dueDate && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{copy.due}: {new Date(milestone.dueDate as Date).toLocaleDateString()}</p>}<Progress value={milestone.progress ?? (milestone.status === 'completed' ? 100 : 0)} className="mt-3 h-1.5" /></div></div>)}</div></CardContent></Card></TabsContent>

      <TabsContent value="files"><Card><CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />{copy.files}</CardTitle><div className="flex flex-wrap items-center gap-2"><select aria-label={copy.chooseType} value={documentType} onChange={event => setDocumentType(event.target.value as DocumentType)} className="h-9 rounded-md border bg-background px-2 text-sm">{(['drawing', 'boq', 'photo', 'contract', 'other'] as DocumentType[]).map(type => <option key={type} value={type}>{typeLabel(type)}</option>)}</select><Button size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={uploadDocument.isPending}><Upload className="h-4 w-4" />{uploadDocument.isPending ? `${copy.uploading} ${uploadProgress}%` : copy.upload}</Button></div></CardHeader><CardContent>{uploadDocument.isPending && <Progress value={uploadProgress} className="mb-4 h-2" />}{documents.filter(document => document.type !== 'invoice').length === 0 ? <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{copy.noFiles}</div> : <div className="grid gap-3 md:grid-cols-2">{documents.filter(document => document.type !== 'invoice').map(document => <div key={document.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><div className="flex min-w-0 items-center gap-3"><div className="rounded-lg bg-primary/10 p-2">{document.type === 'photo' ? <Image className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-primary" />}</div><div className="min-w-0"><p className="truncate text-sm font-medium">{document.name}</p><p className="text-xs text-muted-foreground">{typeLabel(document.type ?? 'other')} · {document.size ? `${(document.size / 1024 / 1024).toFixed(2)} MB` : '—'}</p></div></div><Button size="sm" variant="outline" asChild><a href={document.url} target="_blank" rel="noreferrer">{copy.download}</a></Button></div>)}</div>}</CardContent></Card></TabsContent>

      <TabsContent value="invoices"><Card><CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" />{copy.invoices}</CardTitle><Button size="sm" className="gap-1.5" onClick={() => { setDocumentType('invoice'); fileInputRef.current?.click(); }} disabled={uploadDocument.isPending}><Plus className="h-4 w-4" />{copy.uploadInvoice}</Button></CardHeader><CardContent>{documents.filter(document => document.type === 'invoice').length === 0 ? <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{copy.noInvoices}</div> : <div className="space-y-3">{documents.filter(document => document.type === 'invoice').map(document => <div key={document.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><div><p className="text-sm font-medium">{document.name}</p><p className="text-xs text-muted-foreground">{document.createdAt ? new Date(document.createdAt as Date).toLocaleDateString() : '—'} · {document.size ? `${(document.size / 1024).toFixed(0)} KB` : '—'}</p></div><Button size="sm" variant="outline" asChild><a href={document.url} target="_blank" rel="noreferrer">{copy.view}</a></Button></div>)}</div>}</CardContent></Card></TabsContent>

      <TabsContent value="reports"><Card><CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" />{copy.reports}</CardTitle></CardHeader><CardContent><div className="mb-6 grid gap-3 md:grid-cols-[1fr_1fr_160px_auto]"><Input placeholder={copy.title} value={reportForm.title} onChange={event => setReportForm(form => ({ ...form, title: event.target.value }))} /><Textarea className="md:col-span-1" placeholder={copy.summary} rows={1} value={reportForm.summary} onChange={event => setReportForm(form => ({ ...form, summary: event.target.value }))} /><Input type="number" min={0} max={100} placeholder={copy.progress} value={reportForm.progress} onChange={event => setReportForm(form => ({ ...form, progress: event.target.value }))} /><Button className="gap-1.5" onClick={() => addReport.mutate({ projectId, title: reportForm.title, summary: reportForm.summary, progress: Number(reportForm.progress) })} disabled={addReport.isPending || !reportForm.title || !reportForm.summary}>{addReport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{addReport.isPending ? copy.saving : copy.addReport}</Button></div>{reports.length === 0 ? <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{copy.noReports}</div> : <div className="space-y-3">{reports.map(report => <div key={report.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{report.title}</p><Badge>{report.progress}%</Badge></div><Progress value={report.progress} className="my-3 h-2" /><p className="text-sm text-muted-foreground">{report.summary}</p><p className="mt-2 text-xs text-muted-foreground">{report.createdAt ? new Date(report.createdAt as Date).toLocaleString() : '—'}</p></div>)}</div>}</CardContent></Card></TabsContent>
    </Tabs>
  );
}
