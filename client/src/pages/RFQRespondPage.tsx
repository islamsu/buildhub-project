import { useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { BILLING_CURRENCY } from '@shared/billing';
import { parseRfqAttachments, type RfqAttachmentMetadata } from '@shared/rfqAttachments';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, DollarSign,
  FileText, Lock, MapPin, Paperclip, Pencil, Send, ShieldCheck,
  Trash2, UserRound,
} from 'lucide-react';

type QuoteForm = {
  price: string;
  timeline: string;
  warranty: string;
  validUntil: string;
  commercialTerms: string;
  paymentTerms: string;
  notes: string;
};

const EMPTY_FORM: QuoteForm = {
  price: '', timeline: '', warranty: '', validUntil: '',
  commercialTerms: '', paymentTerms: '', notes: '',
};

const ACCEPTED_FILE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
]);
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 6;

export default function RFQRespondPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { lang, dir } = useLanguage();
  const ar = lang === 'ar';
  const { isAuthenticated } = useAuth();
  const rfqId = Number(params.id);
  const valid = Number.isInteger(rfqId) && rfqId > 0;
  const utils = trpc.useUtils();

  const summary = trpc.rfq.summary.useQuery({ id: rfqId }, { enabled: isAuthenticated && valid, retry: false });
  const access = trpc.rfq.responseAccess.useQuery({ rfqId }, { enabled: isAuthenticated && valid, retry: false });
  const party = trpc.rfq.requesterContact.useQuery({ rfqId }, { enabled: isAuthenticated && valid, retry: false });

  const [form, setForm] = useState<QuoteForm>(EMPTY_FORM);
  const [files, setFiles] = useState<RfqAttachmentMetadata[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const upload = trpc.rfq.uploadQuotationAttachment.useMutation();

  const openEnquiry = trpc.rfq.openEnquiry.useMutation({
    onSuccess: async result => {
      if (result.byInvitation) {
        toast.success(ar ? 'تم فتح الدعوة دون خصم رصيد' : 'Invitation opened without using an enquiry credit');
      } else {
        toast.success(result.alreadyConsumed
          ? (ar ? 'هذا الطلب مفتوح بالفعل ضمن رصيدك' : 'This enquiry was already open in your allowance')
          : (ar ? 'تم فتح الطلب المؤهل' : 'Qualified enquiry opened'));
      }
      await Promise.all([
        utils.rfq.responseAccess.invalidate({ rfqId }),
        utils.rfq.requesterContact.invalidate({ rfqId }),
      ]);
    },
    onError: error => toast.error(error.message),
  });

  const submit = trpc.rfq.submitQuotation.useMutation({
    onSuccess: result => {
      toast.success(ar ? 'تم تقديم عرض السعر' : 'Quotation submitted');
      navigate(`/quotations/${result.quotationId}`);
    },
    onError: error => toast.error(error.message),
  });

  const rfq = summary.data;
  const closed = useMemo(() => rfq != null && rfq.status !== 'open', [rfq]);
  const requesterFiles = parseRfqAttachments(access.data?.attachments);
  const today = new Date().toISOString().slice(0, 10);

  const validation = useMemo(() => {
    const errors: string[] = [];
    const price = Number(form.price);
    if (!Number.isFinite(price) || price <= 0) errors.push(ar ? 'أدخل سعراً صالحاً أكبر من صفر.' : 'Enter a valid price greater than zero.');
    if (!form.validUntil) errors.push(ar ? 'حدّد تاريخ صلاحية عرض السعر.' : 'Choose a quotation validity date.');
    if (form.validUntil && form.validUntil < today) errors.push(ar ? 'لا يمكن أن تكون الصلاحية في الماضي.' : 'Validity cannot be in the past.');
    if (form.timeline && (!Number.isInteger(Number(form.timeline)) || Number(form.timeline) <= 0)) {
      errors.push(ar ? 'يجب أن تكون مدة التنفيذ عدداً صحيحاً موجباً.' : 'Timeline must be a positive whole number.');
    }
    return errors;
  }, [ar, form.price, form.timeline, form.validUntil, today]);

  async function attachFiles(selected: FileList | null) {
    if (!selected?.length) return;
    if (files.length >= MAX_FILES) return;
    setUploading(true);
    for (const file of Array.from(selected).slice(0, MAX_FILES - files.length)) {
      if (!ACCEPTED_FILE_TYPES.has(file.type)) {
        toast.error(ar ? `${file.name}: يُسمح بالصور وPDF فقط` : `${file.name}: only images and PDF files are allowed`);
        continue;
      }
      if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
        toast.error(ar ? `${file.name}: الحد الأقصى 8 ميجابايت` : `${file.name}: maximum 8MB`);
        continue;
      }
      try {
        const base64 = await readAsBase64(file);
        const stored = await upload.mutateAsync({ fileName: file.name, contentType: file.type, base64 });
        setFiles(current => [...current, stored]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : (ar ? 'تعذر رفع الملف' : 'The file could not be uploaded'));
      }
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  function finalSubmit() {
    if (validation.length > 0 || !form.validUntil) return;
    submit.mutate({
      rfqId,
      price: Number(form.price),
      currency: BILLING_CURRENCY,
      timeline: form.timeline ? Number(form.timeline) : undefined,
      warranty: form.warranty.trim() || undefined,
      validUntil: new Date(`${form.validUntil}T23:59:59`),
      commercialTerms: form.commercialTerms.trim() || undefined,
      paymentTerms: form.paymentTerms.trim() || undefined,
      notes: form.notes.trim() || undefined,
      attachments: files.length ? files : undefined,
    });
  }

  if (!valid) {
    return <Shell dir={dir}><Refusal ar={ar} message={ar ? 'رقم طلب غير صالح.' : 'That is not a valid request number.'} /></Shell>;
  }

  return (
    <Shell dir={dir}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/rfq/${rfqId}`}>
          <Button variant="ghost" size="sm" className="gap-2" data-testid="respond-back">
            <ArrowLeft className={`h-4 w-4 ${ar ? 'rotate-180' : ''}`} />
            {ar ? 'تفاصيل الطلب' : 'Request details'}
          </Button>
        </Link>
        <span className="font-mono text-sm text-muted-foreground" data-testid="respond-rfq-number">#{rfqId}</span>
      </div>

      {(summary.isLoading || access.isLoading) && <p className="text-sm text-muted-foreground">…</p>}
      {summary.error && <Refusal ar={ar} message={summary.error.message} testid="respond-error" />}
      {access.error && <Refusal ar={ar} message={access.error.message} testid="respond-access-error" />}

      {rfq && access.data && (
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]" data-testid="respond-page">
          <div className="space-y-6">
            <RfqBrief ar={ar} rfq={rfq} projectTitle={access.data.projectTitle} />
            {requesterFiles.length > 0 && (
              <Card data-testid="respond-requester-attachments">
                <CardHeader><CardTitle className="text-base">{ar ? 'ملفات الطلب' : 'Request files'}</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {requesterFiles.map(file => (
                    <a key={file.key} href={file.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md border p-2 text-sm underline-offset-2 hover:underline">
                      <FileText className="h-4 w-4 shrink-0" /><span className="break-all">{file.name}</span>
                    </a>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <RequesterCard ar={ar} party={party} />

            {closed ? (
              <Card><CardContent className="pt-6"><p className="flex gap-2 text-sm text-muted-foreground" data-testid="respond-closed"><AlertTriangle className="h-4 w-4" />{ar ? 'هذا الطلب لم يعد مفتوحاً للردود.' : 'This request is no longer open for responses.'}</p></CardContent></Card>
            ) : !access.data.canRespond ? (
              <Card data-testid="respond-enquiry-gate">
                <CardHeader><CardTitle className="text-base">{ar ? 'افتح الطلب قبل إعداد العرض' : 'Open the enquiry before preparing a quote'}</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {ar
                      ? 'يتحقق الخادم من فئة خدماتك ورصيد الاستفسارات. الدعوة المباشرة معفاة من الخصم.'
                      : 'The server checks your declared service category and enquiry allowance. A direct invitation is exempt from usage.'}
                  </p>
                  <Button className="mt-4 w-full" disabled={openEnquiry.isPending} onClick={() => openEnquiry.mutate({ rfqId })} data-testid="respond-open-enquiry">
                    {openEnquiry.isPending ? '…' : (ar ? 'فتح الطلب المؤهل' : 'Open qualified enquiry')}
                  </Button>
                </CardContent>
              </Card>
            ) : reviewing ? (
              <ReviewCard ar={ar} rfq={rfq} form={form} files={files} pending={submit.isPending} onEdit={() => setReviewing(false)} onSubmit={finalSubmit} />
            ) : (
              <QuoteFormCard
                ar={ar} form={form} setForm={setForm} files={files} setFiles={setFiles}
                fileInput={fileInput} uploading={uploading} attachFiles={attachFiles}
                validation={validation} onReview={() => setReviewing(true)}
              />
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}

function RfqBrief({ ar, rfq, projectTitle }: { ar: boolean; rfq: any; projectTitle: string | null }) {
  return (
    <Card data-testid="respond-brief">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-xl">{rfq.title}</CardTitle>
          <Badge variant={rfq.status === 'open' ? 'default' : 'secondary'}>{rfq.status}</Badge>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{rfq.description}</p>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
          {rfq.category && <span>{rfq.category}</span>}
          {projectTitle && <span>{ar ? 'المشروع' : 'Project'}: {projectTitle}</span>}
          {rfq.budget && <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />{ar ? 'الميزانية' : 'Budget'}: {Number(rfq.budget).toLocaleString()} {BILLING_CURRENCY}</span>}
          {rfq.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{rfq.location}</span>}
          {rfq.deadline && <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{new Date(rfq.deadline).toLocaleDateString(ar ? 'ar-EG' : 'en-US')}</span>}
        </div>
      </CardHeader>
      {Array.isArray(rfq.items) && rfq.items.length > 0 && (
        <CardContent>
          <p className="mb-2 text-sm font-medium">{ar ? 'البنود المطلوبة' : 'Requested items'}</p>
          <div className="space-y-2">
            {rfq.items.map((item: any) => (
              <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border p-2 text-sm" data-testid="respond-item">
                <span className="min-w-0">{item.name}{item.specifications && <span className="block text-xs text-muted-foreground">{item.specifications}</span>}</span>
                <span className="shrink-0 text-muted-foreground">{item.quantity} {item.unit ?? ''}</span>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function RequesterCard({ ar, party }: { ar: boolean; party: any }) {
  return (
    <Card data-testid="respond-requester">
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><UserRound className="h-4 w-4" />{ar ? 'مقدّم الطلب' : 'The customer'}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {party.isLoading && <p className="text-muted-foreground">…</p>}
        {party.data && <>
          <p className="flex flex-wrap items-center gap-2 font-medium" data-testid="respond-requester-name">
            {party.data.requester.name ?? `#${party.data.requester.id}`}
            {party.data.requester.verified && <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" />{ar ? 'موثّق' : 'Verified'}</Badge>}
          </p>
          <p className="text-muted-foreground">{party.data.requester.location ?? (ar ? 'الموقع غير محدد' : 'Location not stated')}</p>
          {party.data.contact ? (
            <div className="space-y-1 rounded-lg border p-2" data-testid="respond-contact"><p>{party.data.contact.email ?? '—'}</p><p>{party.data.contact.phone ?? '—'}</p></div>
          ) : (
            <p className="flex items-start gap-2 rounded-lg border border-dashed p-2 text-xs text-muted-foreground" data-testid="respond-contact-locked"><Lock className="mt-0.5 h-3 w-3 shrink-0" />{ar ? 'تفاصيل التواصل غير متاحة في سياق هذا العرض.' : 'Contact details are not available in this quotation context.'}</p>
          )}
        </>}
      </CardContent>
    </Card>
  );
}

function QuoteFormCard(props: {
  ar: boolean; form: QuoteForm; setForm: React.Dispatch<React.SetStateAction<QuoteForm>>;
  files: RfqAttachmentMetadata[]; setFiles: React.Dispatch<React.SetStateAction<RfqAttachmentMetadata[]>>;
  fileInput: React.RefObject<HTMLInputElement | null>; uploading: boolean;
  attachFiles: (files: FileList | null) => void; validation: string[]; onReview: () => void;
}) {
  const { ar, form, setForm, files, setFiles, fileInput, uploading, attachFiles, validation, onReview } = props;
  const field = (key: keyof QuoteForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(current => ({ ...current, [key]: event.target.value }));
  return (
    <Card data-testid="respond-form">
      <CardHeader><CardTitle className="text-base">{ar ? 'إعداد عرض السعر' : 'Prepare your quotation'}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
          <Field label={ar ? 'السعر' : 'Price'} required><Input data-testid="respond-price" type="number" min="0.01" step="0.01" value={form.price} onChange={field('price')} /></Field>
          <Field label={ar ? 'العملة' : 'Currency'}><Input data-testid="respond-currency" value={BILLING_CURRENCY} readOnly aria-readonly="true" /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={ar ? 'مدة التنفيذ بالأيام' : 'Delivery / completion days'}><Input data-testid="respond-timeline" type="number" min="1" value={form.timeline} onChange={field('timeline')} /></Field>
          <Field label={ar ? 'صالح حتى' : 'Valid until'} required><Input data-testid="respond-valid-until" type="date" min={new Date().toISOString().slice(0, 10)} value={form.validUntil} onChange={field('validUntil')} /></Field>
        </div>
        <Field label={ar ? 'الضمان' : 'Warranty'}><Input data-testid="respond-warranty" maxLength={100} value={form.warranty} onChange={field('warranty')} /></Field>
        <Field label={ar ? 'الشروط التجارية' : 'Commercial terms'}><Textarea data-testid="respond-commercial-terms" rows={3} maxLength={4000} value={form.commercialTerms} onChange={field('commercialTerms')} /></Field>
        <Field label={ar ? 'شروط الدفع' : 'Payment terms'}><Textarea data-testid="respond-payment-terms" rows={2} maxLength={2000} value={form.paymentTerms} onChange={field('paymentTerms')} /></Field>
        <Field label={ar ? 'ملاحظات المورّد' : 'Supplier notes'}><Textarea data-testid="respond-notes" rows={3} maxLength={4000} value={form.notes} onChange={field('notes')} /></Field>

        <div>
          <input ref={fileInput} type="file" className="hidden" multiple accept="image/png,image/jpeg,image/gif,image/webp,application/pdf" onChange={event => void attachFiles(event.target.files)} data-testid="respond-file-input" />
          <Button type="button" variant="outline" className="w-full gap-2" disabled={uploading || files.length >= MAX_FILES} onClick={() => fileInput.current?.click()} data-testid="respond-attach">
            <Paperclip className="h-4 w-4" />{uploading ? (ar ? 'جاري الرفع…' : 'Uploading…') : (ar ? 'إرفاق عرض فني أو شهادات أو صور' : 'Attach proposal, certificates, or photos')}
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">{ar ? 'صور أو PDF، حتى 6 ملفات و8 ميجابايت لكل ملف. يراها صاحب الطلب فقط.' : 'Images or PDFs, up to 6 files and 8MB each. Only the requester can see them.'}</p>
          {files.length > 0 && <div className="mt-2 space-y-1" data-testid="respond-attachments">{files.map(file => (
            <div key={file.key} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"><FileText className="h-3.5 w-3.5" /><span className="min-w-0 flex-1 truncate">{file.name}</span><button type="button" className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label={ar ? `إزالة ${file.name}` : `Remove ${file.name}`} onClick={() => setFiles(current => current.filter(item => item.key !== file.key))} data-testid="respond-remove-attachment"><Trash2 className="h-3.5 w-3.5" /></button></div>
          ))}</div>}
        </div>

        {validation.length > 0 && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="respond-validation"><ul className="list-disc space-y-1 ps-5">{validation.map(error => <li key={error}>{error}</li>)}</ul></div>}
        <Button className="w-full gap-2" disabled={uploading || validation.length > 0} onClick={onReview} data-testid="respond-review"><CheckCircle2 className="h-4 w-4" />{ar ? 'مراجعة العرض' : 'Review quotation'}</Button>
      </CardContent>
    </Card>
  );
}

function ReviewCard({ ar, rfq, form, files, pending, onEdit, onSubmit }: { ar: boolean; rfq: any; form: QuoteForm; files: RfqAttachmentMetadata[]; pending: boolean; onEdit: () => void; onSubmit: () => void }) {
  const rows = [
    [ar ? 'الطلب' : 'Request', `#${rfq.id} · ${rfq.title}`],
    [ar ? 'السعر' : 'Price', `${Number(form.price).toLocaleString(ar ? 'ar-EG' : 'en-US')} ${BILLING_CURRENCY}`],
    [ar ? 'مدة التنفيذ' : 'Timeline', form.timeline ? `${form.timeline} ${ar ? 'يوم' : 'days'}` : '—'],
    [ar ? 'الضمان' : 'Warranty', form.warranty || '—'],
    [ar ? 'الصلاحية' : 'Valid until', new Date(`${form.validUntil}T12:00:00`).toLocaleDateString(ar ? 'ar-EG' : 'en-US')],
    [ar ? 'الشروط التجارية' : 'Commercial terms', form.commercialTerms || '—'],
    [ar ? 'شروط الدفع' : 'Payment terms', form.paymentTerms || '—'],
    [ar ? 'الملاحظات' : 'Notes', form.notes || '—'],
  ];
  return (
    <Card data-testid="respond-review-stage">
      <CardHeader><CardTitle className="text-base">{ar ? 'راجع وأكّد عرضك' : 'Review and confirm your quotation'}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <dl className="space-y-3">{rows.map(([label, value]) => <div key={label} className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium">{value}</dd></div>)}</dl>
        <div><p className="mb-2 text-xs text-muted-foreground">{ar ? 'المرفقات' : 'Attachments'}</p>{files.length === 0 ? <p className="text-sm text-muted-foreground">{ar ? 'لا توجد مرفقات' : 'No attachments'}</p> : <ul className="space-y-1" data-testid="respond-review-attachments">{files.map(file => <li key={file.key} className="flex items-center gap-2 text-sm"><Paperclip className="h-3.5 w-3.5" />{file.name}</li>)}</ul>}</div>
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" data-testid="respond-confirmation-copy">{ar ? 'بالتأكيد، سيتم إرسال العرض لصاحب الطلب وتسجيله كسجل تجاري قيد المراجعة.' : 'Confirming sends this quotation to the requester and records it as a pending commercial submission.'}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" className="gap-2" disabled={pending} onClick={onEdit} data-testid="respond-edit"><Pencil className="h-4 w-4" />{ar ? 'العودة للتعديل' : 'Back to edit'}</Button>
          <Button className="gap-2" disabled={pending} onClick={onSubmit} data-testid="respond-submit"><Send className="h-4 w-4" />{pending ? '…' : (ar ? 'تأكيد وإرسال العرض' : 'Confirm and submit')}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block space-y-1 text-sm font-medium"><span>{label}{required && <span aria-hidden="true" className="text-destructive"> *</span>}</span>{children}</label>;
}

function Shell({ dir, children }: { dir: string; children: React.ReactNode }) {
  return <DashboardLayout><main dir={dir} className="space-y-2">{children}</main></DashboardLayout>;
}

function Refusal({ ar, message, testid }: { ar: boolean; message: string; testid?: string }) {
  return <Card><CardContent className="pt-6"><p className="flex items-start gap-2 text-sm text-destructive" role="alert" data-testid={testid}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{message}</span></p><Link href="/rfq"><Button variant="outline" className="mt-4">{ar ? 'كل الطلبات' : 'All requests'}</Button></Link></CardContent></Card>;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('File could not be read'));
    reader.readAsDataURL(file);
  });
}
