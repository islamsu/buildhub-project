import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { CheckCircle2, Clock3, FileCheck2, FileUp, History, Loader2, ShieldCheck, UploadCloud, XCircle } from 'lucide-react';
import { getComplianceStatusLabel, type ComplianceDocumentStatus, type ComplianceRequirement } from '@shared/compliance';
import { toast } from 'sonner';

const MAX_SIZE = 10 * 1024 * 1024;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusClass(status: string) {
  if (status === 'approved') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'rejected' || status === 'update_required') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (status === 'under_review' || status === 'submitted') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export default function CompliancePage() {
  const { lang, dir } = useLanguage();
  const { isAuthenticated, user } = useAuth();
  const isArabic = lang === 'ar';
  const role = (user as any)?.userRole as string | undefined;
  const isProfessional = ['contractor', 'engineer', 'architect', 'supplier', 'project_manager'].includes(role || '');
  const { data, isLoading, error } = trpc.compliance.requirements.useQuery(undefined, { enabled: isAuthenticated && isProfessional });
  const utils = trpc.useUtils();
  const uploadDocument = trpc.compliance.uploadDocument.useMutation({ onSuccess: () => { toast.success(isArabic ? 'تم إرسال المستند للمراجعة' : 'Document submitted for review'); utils.compliance.requirements.invalidate(); }, onError: uploadError => toast.error(uploadError.message) });
  const [selectedRequirement, setSelectedRequirement] = useState<ComplianceRequirement | null>(null);
  const [uploadingName, setUploadingName] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [uploadEta, setUploadEta] = useState<number | null>(null);
  const [applicantNote, setApplicantNote] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAuthenticated && !isProfessional && role) toast.info(isArabic ? 'لا تحتاج حسابات الأفراد إلى مستندات مهنية' : 'Individual homeowner accounts do not require professional documents');
  }, [isAuthenticated, isProfessional, role, isArabic]);

  const latestDocuments = useMemo(() => {
    const result = new Map<string, NonNullable<typeof data>['documents'][number]>();
    for (const document of data?.documents || []) if (!result.has(document.documentType)) result.set(document.documentType, document);
    return result;
  }, [data?.documents]);

  const handleFile = async (file?: File) => {
    if (!file || !selectedRequirement) return;
    if (!(file.type.startsWith('image/') || file.type === 'application/pdf')) { toast.error(isArabic ? 'يسمح بملفات PDF والصور فقط' : 'Only PDF and image files are supported'); return; }
    if (file.size > MAX_SIZE) { toast.error(isArabic ? 'الحد الأقصى لحجم الملف 10 ميجابايت' : 'Maximum file size is 10MB'); return; }
    setUploadingName(file.name);
    setUploadProgress(0);
    setUploadSpeed(0);
    setUploadEta(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        const startedAt = performance.now();
        reader.onprogress = event => {
          if (!event.lengthComputable) return;
          const elapsed = Math.max((performance.now() - startedAt) / 1000, 0.001);
          const speed = event.loaded / elapsed;
          setUploadSpeed(speed);
          setUploadProgress(Math.round((event.loaded / event.total) * 88));
          setUploadEta(speed > 0 ? Math.ceil((event.total - event.loaded) / speed) : null);
        };
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
      });
      setUploadProgress(92);
      await uploadDocument.mutateAsync({ documentType: selectedRequirement.type, fileName: file.name, contentType: file.type, base64, applicantNote: applicantNote.trim() || undefined });
      setUploadProgress(100);
    } catch {
      // The mutation reports a localized error toast; reset the transient upload state below.
    } finally {
      setTimeout(() => { setUploadingName(''); setUploadProgress(0); setUploadSpeed(0); setUploadEta(null); setSelectedRequirement(null); setApplicantNote(''); }, 400);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!isAuthenticated) return <div className="min-h-screen bg-background"><Navbar /><div className="container pt-32 text-center"><ShieldCheck className="mx-auto mb-4 h-14 w-14 text-muted-foreground/40" /><h1 className="text-2xl font-bold">{isArabic ? 'سجّل الدخول لإكمال التحقق' : 'Sign in to complete verification'}</h1><Button className="mt-5" onClick={() => { window.location.href = '/auth?mode=login'; }}>{isArabic ? 'تسجيل الدخول' : 'Sign in'}</Button></div></div>;
  if (!isProfessional) return <div className="min-h-screen bg-background"><Navbar /><div className="container pt-32 text-center"><CheckCircle2 className="mx-auto mb-4 h-14 w-14 text-emerald-500" /><h1 className="text-2xl font-bold">{isArabic ? 'حسابك الفردي لا يحتاج مستندات مهنية' : 'Your individual account does not require professional documents'}</h1></div></div>;

  const overallStatus = data?.status || 'not_started';
  const requiredCount = data?.requirements.filter(item => item.required).length || 0;
  const approvedRequiredCount = data?.requirements.filter(item => item.required && latestDocuments.get(item.type)?.status === 'approved').length || 0;
  const completion = requiredCount ? Math.round((approvedRequiredCount / requiredCount) * 100) : 0;

  return <div className="min-h-screen bg-background" dir={dir}><Navbar /><main className="container max-w-6xl pt-24 pb-16">
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2"><Badge variant="outline">{isArabic ? 'التحقق من التسجيل' : 'Registration compliance'}</Badge><Badge className={statusClass(overallStatus)}>{getComplianceStatusLabel(overallStatus as any, isArabic)}</Badge></div><h1 className="text-3xl font-bold">{isArabic ? 'ملف المستندات القانونية' : 'Legal document profile'}</h1><p className="mt-2 max-w-2xl text-muted-foreground">{isArabic ? 'أرسل مستندات منشأتك أو مهنتك ليقوم فريق BuildHub بمراجعتها قبل تفعيل أدوات المحترفين.' : 'Submit your business or professional documents for BuildHub review before professional tools are activated.'}</p></div><div className="rounded-2xl border bg-card p-4 text-end"><p className="text-xs text-muted-foreground">{isArabic ? 'اكتمال المستندات المطلوبة' : 'Required documents complete'}</p><p className="mt-1 text-2xl font-bold text-primary">{completion}%</p><Progress value={completion} className="mt-2 w-40" /></div></div>
    {data?.reviewNotes && <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><strong>{isArabic ? 'ملاحظة المراجعة: ' : 'Reviewer note: '}</strong>{data.reviewNotes}</div>}
    {isLoading && <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground"><Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />{isArabic ? 'جاري تحميل متطلبات التسجيل…' : 'Loading registration requirements…'}</div>}
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-700">{error.message}</div>}
    {data && <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]"><Card><CardHeader><CardTitle>{isArabic ? 'المستندات المطلوبة حسب فئتك' : 'Documents required for your category'}</CardTitle></CardHeader><CardContent className="space-y-3"><input ref={fileInputRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={event => handleFile(event.target.files?.[0])} />{data.requirements.map(requirement => { const document = latestDocuments.get(requirement.type); const documentStatus = document?.status || 'not_started'; const isUploading = !!uploadingName && selectedRequirement?.type === requirement.type; return <div key={requirement.type} className="rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex gap-3"><div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary"><FileCheck2 className="h-5 w-5" /></div><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{isArabic ? requirement.nameAr : requirement.name}</h3>{requirement.required ? <Badge variant="outline" className="text-[10px]">{isArabic ? 'مطلوب' : 'Required'}</Badge> : <Badge variant="outline" className="text-[10px]">{isArabic ? 'اختياري' : 'Optional'}</Badge>}</div><p className="mt-1 text-sm text-muted-foreground">{isArabic ? requirement.descriptionAr : requirement.description}</p>{document && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><Badge className={statusClass(documentStatus)}>{getComplianceStatusLabel(documentStatus as any, isArabic)}</Badge><a className="underline underline-offset-2" href={document.url} target="_blank" rel="noreferrer">{document.fileName}</a><span className="text-muted-foreground">{formatSize(document.size)}</span></div>}{document?.reviewerNote && <p className="mt-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{document.reviewerNote}</p>}{(documentStatus === 'update_required' || documentStatus === 'rejected') && <Textarea rows={2} className="mt-3 max-w-xl text-sm" placeholder={isArabic ? 'اشرح ما الذي تم تحديثه في هذا المستند…' : 'Explain what changed in this re-upload…'} value={selectedRequirement?.type === requirement.type ? applicantNote : ''} onFocus={() => setSelectedRequirement(requirement)} onChange={event => { setSelectedRequirement(requirement); setApplicantNote(event.target.value); }} />}</div></div><Button variant="outline" size="sm" disabled={uploadDocument.isPending || isUploading} onClick={() => { setSelectedRequirement(requirement); fileInputRef.current?.click(); }} className="shrink-0 gap-2"><UploadCloud className="h-4 w-4" />{isUploading ? (isArabic ? 'جاري الرفع…' : 'Uploading…') : documentStatus === 'update_required' || documentStatus === 'rejected' ? (isArabic ? 'تحديث المستند' : 'Update document') : (isArabic ? 'رفع مستند' : 'Upload document')}</Button></div>{isUploading && <div className="mt-3 space-y-1.5"><div className="flex justify-between text-xs text-muted-foreground"><span>{uploadProgress}% · {uploadingName}</span><span>{uploadSpeed > 0 ? `${(uploadSpeed / (1024 * 1024)).toFixed(1)} MB/s` : ''} {uploadEta !== null ? `· ${uploadEta}s` : ''}</span></div><Progress value={uploadProgress} /></div>}</div>; })}</CardContent></Card><Card><CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5 text-primary" />{isArabic ? 'سجل المراجعة' : 'Review timeline'}</CardTitle></CardHeader><CardContent>{data.events.length ? <div className="space-y-4">{data.events.map(event => <div key={event.id} className="relative border-s-2 border-border ps-4 text-sm last:border-0"><span className="absolute -start-[7px] top-0 h-3 w-3 rounded-full bg-primary" /><p className="font-medium">{event.action.replaceAll('_', ' ')}</p><p className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString(isArabic ? 'ar-EG' : 'en-US')}</p>{event.note && <p className="mt-1 text-muted-foreground">{event.note}</p>}</div>)}</div> : <div className="py-8 text-center text-sm text-muted-foreground"><Clock3 className="mx-auto mb-2 h-6 w-6 opacity-40" />{isArabic ? 'ستظهر تحديثات المراجعة هنا.' : 'Review updates will appear here.'}</div>}{overallStatus === 'approved' && <div className="mt-5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="me-2 inline h-4 w-4" />{isArabic ? 'تم اعتماد ملفك ويمكنك استخدام أدوات المحترفين.' : 'Your profile is approved and professional tools are enabled.'}</div>}{overallStatus === 'rejected' && <div className="mt-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-700"><XCircle className="me-2 inline h-4 w-4" />{isArabic ? 'يرجى مراجعة الملاحظات وإعادة إرسال المستندات المطلوبة.' : 'Review the notes and resubmit the requested documents.'}</div>}{data.history?.length > 0 && <div className="mt-6 rounded-xl border bg-muted/20 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-primary" />{isArabic ? 'سجل رفع المستندات' : 'Document submission history'}</div><div className="space-y-3">{data.history.slice(0, 8).map(submission => <div key={submission.id} className="rounded-lg border bg-background p-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{submission.fileName}</span><Badge className={statusClass(submission.status)}>{getComplianceStatusLabel(submission.status as ComplianceDocumentStatus, isArabic)}</Badge></div>{submission.applicantNote && <p className="mt-2 text-muted-foreground">{submission.applicantNote}</p>}<p className="mt-1 text-muted-foreground">{new Date(submission.createdAt).toLocaleString(isArabic ? 'ar-EG' : 'en-US')}</p></div>)}</div></div>}</CardContent></Card></div>}
  </main></div>;
}
