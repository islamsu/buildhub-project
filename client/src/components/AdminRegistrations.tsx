import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadFailed } from '@/components/LoadFailed';
import { toast } from 'sonner';
import {
  AlertTriangle, CheckCircle2, ClipboardCheck, Download, Eye, FileSearch,
  Loader2, RefreshCw, RotateCcw, Search, SendHorizontal, XCircle,
} from 'lucide-react';
import { BarChart, Bar, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { summarizeComplianceRegistrations } from '@shared/compliance';
import { buildRegistrationMetricsCsv, filterRegistrationApplicants, dateKey } from '@shared/registrationMetrics';
import { ROLE_GROUPS, labelForRole, formatComplianceStatus, EmptyState } from '@/lib/adminRoleLabels';
import type { AdminPermission } from '@shared/adminRoles';

/**
 * ── PROFESSIONAL REGISTRATIONS ────────────────────────────────────────────
 *
 * ONE WORKFLOW, ONE DESTINATION. Before this page there were two top-level
 * admin destinations over the same data:
 *
 *   "Professional registration summary" - a full management interface sitting
 *     on the /admin OVERVIEW, with applicant search, category and date
 *     filters, CSV export, pending selection and bulk approve/reject;
 *   "Pending Verifications" (/admin/compliance) - the document review queue.
 *
 * They were not two business capabilities. Both read the SAME query -
 * `admin.complianceQueue` - filtered two different ways in the browser, over
 * the same applicant rows, driving the same `onboardingStatus` lifecycle
 * through the same `admin.updateApplicantStatus` mutation. Nothing in the data
 * distinguishes "registration approval" from "ongoing compliance": there is no
 * renewal, no expiry, no post-approval obligation. So there is no second
 * lifecycle to preserve, and pretending otherwise would have been the
 * fabrication this project refuses elsewhere.
 *
 * Consolidated here, with the status bands as TABS over one query rather than
 * as two screens. If a genuine continuing-compliance model is built later -
 * renewals, expiring certificates - it earns its own destination then, on
 * evidence.
 *
 * A DASHBOARD IS NOT A MANAGEMENT PAGE. Bulk-approving registrations from a
 * summary card broke the rule the rest of BuildHub follows; /admin keeps a
 * compact preview and a link here.
 *
 * Every capability the two old surfaces had is below, and
 * client/src/lib/adminRegistrationCapabilities.ts lists them so a test can
 * hold this file to the list rather than trusting this sentence.
 */
export default function AdminRegistrations() {
  const { lang, t } = useLanguage();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const utils = trpc.useUtils();
  const [statusTab, setStatusTab] = useState('all');

  /**
   * THE PERMISSION GATE IS STILL HERE, not inherited from the menu.
   *
   * Navigation hides what an administrator may not use; it does not decide it.
   * Every query below is gated on the permission its endpoint requires, so a
   * Sub-Admin who reaches this URL directly fires no request it would refuse -
   * and the server refuses it regardless.
   */
  const { data: me } = trpc.admin.me.useQuery(undefined, { retry: false });
  const can = (permission: AdminPermission) => Boolean((me?.permissions as readonly string[] | undefined)?.includes(permission));
  const [activeApplicant, setActiveApplicant] = useState<any | null>(null);
  const [activeDocument, setActiveDocument] = useState<any | null>(null);
  const [complianceStatus, setComplianceStatus] = useState<'under_review' | 'approved' | 'rejected' | 'update_required'>('under_review');
  const [complianceNote, setComplianceNote] = useState('');
  const [complianceRoleFilter, setComplianceRoleFilter] = useState('all');
  const [complianceStatusFilter, setComplianceStatusFilter] = useState('all');
  const [registrationRoleFilter, setRegistrationRoleFilter] = useState('all');
  const [registrationSearch, setRegistrationSearch] = useState('');
  const [registrationDateFrom, setRegistrationDateFrom] = useState('');
  const [registrationDateTo, setRegistrationDateTo] = useState('');
  const [includeDummyRegistrations, setIncludeDummyRegistrations] = useState(false);
  const [selectedRegistrationIds, setSelectedRegistrationIds] = useState<number[]>([]);
  const [bulkDecision, setBulkDecision] = useState<'approved' | 'rejected' | null>(null);
  const [bulkRejectionReason, setBulkRejectionReason] = useState('');
  const [csvExporting, setCsvExporting] = useState(false);
  const [documentPreviewSource, setDocumentPreviewSource] = useState<string | null>(null);
  const [documentPreviewStatus, setDocumentPreviewStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [documentPreviewError, setDocumentPreviewError] = useState('');
  const previewRequestRef = useRef(0);
  const previewObjectUrlRef = useRef<string | null>(null);
  const complianceQueueInput = useMemo(() => ({ includeDummy: includeDummyRegistrations }), [includeDummyRegistrations]);

  const { data: complianceQueue = [], isLoading: complianceLoading, isError: complianceFailed, refetch: refetchCompliance } =
    trpc.admin.complianceQueue.useQuery(complianceQueueInput, { enabled: can('marketplace.manage') });
  const { data: complianceDetail } = trpc.admin.complianceApplicant.useQuery({ userId: activeApplicant?.id }, { enabled: can('marketplace.manage') && Boolean(activeApplicant?.id) });

  const reviewComplianceDocument = trpc.admin.reviewComplianceDocument.useMutation({
    onSuccess: () => { toast.success(lang === 'ar' ? 'تم تحديث المستند وإرسال إشعار للمستخدم' : 'Document updated and applicant notified'); utils.admin.complianceQueue.invalidate(); utils.admin.complianceApplicant.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const updateApplicantStatus = trpc.admin.updateApplicantStatus.useMutation({
    onSuccess: () => { toast.success(lang === 'ar' ? 'تم تحديث حالة التسجيل وإرسال الإشعار' : 'Registration status updated and applicant notified'); utils.admin.complianceQueue.invalidate(); utils.admin.complianceApplicant.invalidate(); utils.admin.users.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const bulkUpdateApplicantStatus = trpc.admin.bulkUpdateApplicantStatus.useMutation({
    onSuccess: data => {
      toast.success(lang === 'ar' ? `تم تحديث حالة ${data.updatedCount} طلبات` : `${data.updatedCount} applications updated`);
      setSelectedRegistrationIds([]);
      setBulkDecision(null);
      setBulkRejectionReason('');
      utils.admin.complianceQueue.invalidate();
      utils.admin.complianceApplicant.invalidate();
      utils.admin.users.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const releasePreviewObjectUrl = () => {
    if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current);
    previewObjectUrlRef.current = null;
  };

  const closeDocumentPreview = () => {
    previewRequestRef.current += 1;
    releasePreviewObjectUrl();
    setActiveDocument(null);
    setDocumentPreviewSource(null);
    setDocumentPreviewStatus('idle');
    setDocumentPreviewError('');
  };

  const loadDocumentPreview = async (document: any) => {
    const requestId = ++previewRequestRef.current;
    releasePreviewObjectUrl();
    setActiveDocument(document);
    setDocumentPreviewSource(null);
    setDocumentPreviewStatus('loading');
    setDocumentPreviewError('');
    try {
      if (!document?.url) throw new Error(lang === 'ar' ? 'رابط المستند غير متاح.' : 'The document URL is unavailable.');
      const response = await fetch(document.url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${response.status}`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('empty-document');
      const objectUrl = URL.createObjectURL(blob);
      if (requestId !== previewRequestRef.current) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      previewObjectUrlRef.current = objectUrl;
      setDocumentPreviewSource(objectUrl);
      setDocumentPreviewStatus('ready');
    } catch {
      if (requestId !== previewRequestRef.current) return;
      setDocumentPreviewStatus('error');
      setDocumentPreviewError(lang === 'ar' ? 'تعذر تحميل المستند. تحقق من الاتصال وحاول مرة أخرى.' : 'We could not load this document. Check the connection and try again.');
    }
  };

  useEffect(() => () => {
    previewRequestRef.current += 1;
    releasePreviewObjectUrl();
  }, []);

  const filteredComplianceQueue = useMemo(() => complianceQueue.filter(applicant => {
    const roleMatches = complianceRoleFilter === 'all' || applicant.userRole === complianceRoleFilter;
    const statusMatches = complianceStatusFilter === 'all' || applicant.onboardingStatus === complianceStatusFilter;
    return roleMatches && statusMatches;
  }), [complianceQueue, complianceRoleFilter, complianceStatusFilter]);

  /** The two strings every failed section shows. Worded once, not per tab. */
  const loadFailedText = lang === 'ar'
    ? 'تعذّر تحميل هذه البيانات. هذه ليست نتيجة فارغة.'
    : 'This could not be loaded. This is not an empty result.';
  const retryText = lang === 'ar' ? 'إعادة المحاولة' : 'Try again';
  const isAdmin = true;

  const registrationDateRangeInvalid = Boolean(registrationDateFrom && registrationDateTo && registrationDateFrom > registrationDateTo);
  const filteredRegistrationApplicants = useMemo(() => filterRegistrationApplicants(complianceQueue, { role: registrationRoleFilter, from: registrationDateFrom, to: registrationDateTo, includeDummy: includeDummyRegistrations }).filter(applicant => {
    const query = registrationSearch.trim().toLowerCase();
    return !query || `${applicant.name ?? ''} ${applicant.email ?? ''}`.toLowerCase().includes(query);
  }), [complianceQueue, registrationRoleFilter, registrationDateFrom, registrationDateTo, registrationSearch, includeDummyRegistrations]);
  const pendingRegistrationApplicants = useMemo(() => filteredRegistrationApplicants.filter(applicant => ['under_review', 'update_required', 'not_started'].includes(applicant.onboardingStatus ?? 'not_started')), [filteredRegistrationApplicants]);
  const allPendingSelected = pendingRegistrationApplicants.length > 0 && pendingRegistrationApplicants.every(applicant => selectedRegistrationIds.includes(applicant.id));
  useEffect(() => {
    const visibleIds = new Set(filteredRegistrationApplicants.map(applicant => applicant.id));
    setSelectedRegistrationIds(previous => {
      const next = previous.filter(id => visibleIds.has(id));
      return next.length === previous.length && next.every((id, index) => id === previous[index]) ? previous : next;
    });
  }, [filteredRegistrationApplicants]);
  const registrationSummary = useMemo(() => {
    const counts = summarizeComplianceRegistrations(filteredRegistrationApplicants, lang === 'ar').map(row => ({ role: row.label, pending: row.pending, approved: row.approved }));
    return { counts, pending: counts.reduce((total, row) => total + row.pending, 0), approved: counts.reduce((total, row) => total + row.approved, 0) };
  }, [filteredRegistrationApplicants, lang]);

  const toggleRegistrationSelection = (userId: number, checked: boolean) => {
    setSelectedRegistrationIds(previous => checked ? Array.from(new Set([...previous, userId])) : previous.filter(id => id !== userId));
  };

  const toggleAllPendingRegistrations = (checked: boolean) => {
    setSelectedRegistrationIds(checked ? pendingRegistrationApplicants.map(applicant => applicant.id) : []);
  };

  const submitBulkDecision = () => {
    if (!isAdmin || !bulkDecision || !selectedRegistrationIds.length) return;
    bulkUpdateApplicantStatus.mutate({
      userIds: selectedRegistrationIds,
      status: bulkDecision,
      note: bulkDecision === 'rejected' ? bulkRejectionReason.trim() || undefined : undefined,
    });
  };

  const exportRegistrationCsv = async () => {
    if (!isAdmin || csvExporting || !filteredRegistrationApplicants.length) return;
    const toastId = `registration-export-${Date.now()}`;
    setCsvExporting(true);
    toast.loading(lang === 'ar' ? 'جاري تجهيز ملف CSV…' : 'Preparing CSV export…', { id: toastId, duration: Infinity, closeButton: true });
    try {
      await new Promise(resolve => window.setTimeout(resolve, 80));
      const csv = buildRegistrationMetricsCsv(filteredRegistrationApplicants, role => labelForRole(role, 'en'));
      const blob = new Blob([`\\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `buildhub-registration-metrics-${dateKey(new Date()) || 'export'}.csv`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(lang === 'ar' ? 'تم إنشاء ملف CSV وتنزيله' : 'CSV export generated and downloaded', { id: toastId, duration: 5000, closeButton: true });
    } catch {
      toast.error(lang === 'ar' ? 'تعذر إنشاء ملف CSV. حاول مرة أخرى.' : 'CSV export failed. Please try again.', { id: toastId, duration: 6000, closeButton: true });
    } finally {
      setCsvExporting(false);
    }
  };

  return (
    <div className="space-y-6" dir={dir} data-testid="admin-registrations">
      {/* THE STATUS BANDS ARE TABS OVER ONE QUERY, not separate screens. They
          drive `complianceStatusFilter`, which is the same filter the old
          Pending Verifications select drove. */}
      <Tabs value={statusTab} onValueChange={value => { setStatusTab(value); setComplianceStatusFilter(value); }}>
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="all" data-testid="registrations-tab-all">{lang === 'ar' ? 'الكل' : 'All'}</TabsTrigger>
          {['under_review', 'update_required', 'approved', 'rejected'].map(status => (
            <TabsTrigger key={status} value={status} data-testid={`registrations-tab-${status}`}>
              {formatComplianceStatus(status, lang)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div><CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-primary" />{lang === 'ar' ? 'ملخص تسجيل المحترفين' : 'Professional registration summary'}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{lang === 'ar' ? 'ابحث عن المتقدمين، قارن الحالات، وطبّق فلاتر الفئة وتاريخ الإرسال.' : 'Search applicants, compare statuses, and filter by category and submission date.'}</p></div>
                <div className="flex flex-wrap items-center gap-2 text-xs"><Badge className="border-amber-200 bg-amber-50 text-amber-700">{lang === 'ar' ? 'قيد الانتظار' : 'Pending'}: {registrationSummary.pending}</Badge><Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{lang === 'ar' ? 'معتمد' : 'Approved'}: {registrationSummary.approved}</Badge><Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={exportRegistrationCsv} disabled={csvExporting || !filteredRegistrationApplicants.length}>{csvExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}{csvExporting ? (lang === 'ar' ? 'جاري التصدير…' : 'Exporting…') : (lang === 'ar' ? 'تصدير CSV' : 'Export CSV')}</Button></div>
        </CardHeader>
              <CardContent><div className="mb-5 rounded-xl border bg-muted/20 p-3"><div className="grid gap-3 lg:grid-cols-[minmax(220px,1.5fr)_minmax(160px,1fr)_minmax(160px,1fr)_auto] lg:items-end"><div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">{lang === 'ar' ? 'بحث عن متقدم' : 'Search applicants'}</label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={registrationSearch} onChange={event => setRegistrationSearch(event.target.value)} placeholder={lang === 'ar' ? 'الاسم الكامل أو البريد الإلكتروني…' : 'Full name or email…'} className="h-9 bg-background pl-9" /></div></div><div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">{lang === 'ar' ? 'الفئة المهنية' : 'Professional category'}</label><Select value={registrationRoleFilter} onValueChange={setRegistrationRoleFilter}><SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{lang === 'ar' ? 'كل الفئات' : 'All categories'}</SelectItem>{ROLE_GROUPS.filter(group => !['homeowner', 'admin'].includes(group.key)).map(group => <SelectItem key={group.key} value={group.key}>{lang === 'ar' ? group.ar : group.en}</SelectItem>)}</SelectContent></Select></div><div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">{lang === 'ar' ? 'من تاريخ الإرسال' : 'Submission date from'}</label><Input type="date" value={registrationDateFrom} max={registrationDateTo || undefined} onChange={event => setRegistrationDateFrom(event.target.value)} className="h-9 bg-background" /></div><div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">{lang === 'ar' ? 'إلى تاريخ الإرسال' : 'Submission date to'}</label><Input type="date" value={registrationDateTo} min={registrationDateFrom || undefined} onChange={event => setRegistrationDateTo(event.target.value)} className="h-9 bg-background" /></div><Button type="button" variant="ghost" className="h-9 gap-1" onClick={() => { setRegistrationSearch(''); setRegistrationRoleFilter('all'); setRegistrationDateFrom(''); setRegistrationDateTo(''); }}><RotateCcw className="h-3.5 w-3.5" />{lang === 'ar' ? 'مسح' : 'Clear'}</Button><label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-xs"><Checkbox checked={includeDummyRegistrations} onCheckedChange={value => setIncludeDummyRegistrations(value === true)} />{lang === 'ar' ? 'تضمين الاختبار' : 'Include test data'}</label></div>{registrationDateRangeInvalid && <p className="mt-2 text-xs text-rose-600">{lang === 'ar' ? 'يجب أن يكون تاريخ البداية قبل تاريخ النهاية.' : 'The start date must be before the end date.'}</p>}</div><div className="mb-5 rounded-xl border p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={allPendingSelected} onCheckedChange={value => toggleAllPendingRegistrations(value === true)} disabled={!pendingRegistrationApplicants.length || bulkUpdateApplicantStatus.isPending} /><span>{lang === 'ar' ? 'تحديد الطلبات قيد الانتظار' : 'Select pending applications'}</span><Badge variant="secondary">{pendingRegistrationApplicants.length}</Badge></label>{selectedRegistrationIds.length > 0 && <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">{selectedRegistrationIds.length} {lang === 'ar' ? 'محدد' : 'selected'}</span><Button type="button" size="sm" className="h-8 gap-1" onClick={() => setBulkDecision('approved')} disabled={bulkUpdateApplicantStatus.isPending}><CheckCircle2 className="h-3.5 w-3.5" />{lang === 'ar' ? 'اعتماد جماعي' : 'Bulk approve'}</Button><Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-rose-700" onClick={() => setBulkDecision('rejected')} disabled={bulkUpdateApplicantStatus.isPending}><XCircle className="h-3.5 w-3.5" />{lang === 'ar' ? 'رفض جماعي' : 'Bulk reject'}</Button></div>}</div>{pendingRegistrationApplicants.length > 0 ? <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{pendingRegistrationApplicants.map(applicant => <label key={applicant.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-muted/10 p-2.5 transition-colors hover:bg-muted/30"><span className="flex min-w-0 items-center gap-2"><Checkbox checked={selectedRegistrationIds.includes(applicant.id)} onCheckedChange={value => toggleRegistrationSelection(applicant.id, value === true)} disabled={bulkUpdateApplicantStatus.isPending} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{applicant.name || applicant.email || `#${applicant.id}`}</span><span className="block truncate text-xs text-muted-foreground">{applicant.email || '—'} · {labelForRole(applicant.userRole, lang)}</span></span></span><span className="shrink-0 text-xs text-muted-foreground">{dateKey(applicant.documents?.[0]?.createdAt ?? applicant.createdAt)}</span></label>)}</div> : <p className="mt-3 text-xs text-muted-foreground">{lang === 'ar' ? 'لا توجد طلبات قيد الانتظار مطابقة للفلاتر.' : 'No pending applications match the current filters.'}</p>}</div><ResponsiveContainer width="100%" height={260}><BarChart data={registrationSummary.counts} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }} barCategoryGap="22%"><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="role" width={lang === 'ar' ? 110 : 125} tick={{ fontSize: 11 }} /><Tooltip cursor={{ fill: 'hsl(var(--muted) / 0.35)' }} /><Legend /><Bar dataKey="pending" name={lang === 'ar' ? 'قيد الانتظار' : 'Pending'} stackId="status" fill="#f59e0b" radius={[4, 0, 0, 4]} isAnimationActive={false} /><Bar dataKey="approved" name={lang === 'ar' ? 'معتمد' : 'Approved'} stackId="status" fill="#10b981" radius={[0, 4, 4, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer></CardContent>
      </Card>

      <Card><CardHeader><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><CardTitle className="flex items-center gap-2"><ClipboardCheck className="w-5 h-5" />{lang === 'ar' ? 'مراجعة المستندات القانونية' : 'Legal document review queue'}</CardTitle><Badge variant="outline">{lang === 'ar' ? 'نمط مؤسسي' : 'Enterprise onboarding'}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{lang === 'ar' ? 'راجع مستندات كل منشأة، اطلب تحديث مستند محدد، وأرسل حالة التسجيل إلى مقدم الطلب.' : 'Review each business profile, request a specific document update, and send registration status updates to the applicant.'}</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><Select value={complianceRoleFilter} onValueChange={setComplianceRoleFilter}><SelectTrigger><SelectValue placeholder={lang === 'ar' ? 'تصفية حسب الفئة' : 'Filter by role'} /></SelectTrigger><SelectContent><SelectItem value="all">{lang === 'ar' ? 'كل الفئات' : 'All roles'}</SelectItem>{ROLE_GROUPS.filter(group => group.key !== 'homeowner' && group.key !== 'admin').map(group => <SelectItem key={group.key} value={group.key}>{lang === 'ar' ? group.ar : group.en}</SelectItem>)}</SelectContent></Select><Select value={complianceStatusFilter} onValueChange={setComplianceStatusFilter}><SelectTrigger><SelectValue placeholder={lang === 'ar' ? 'تصفية حسب الحالة' : 'Filter by status'} /></SelectTrigger><SelectContent><SelectItem value="all">{lang === 'ar' ? 'كل الحالات' : 'All statuses'}</SelectItem><SelectItem value="not_started">{formatComplianceStatus('not_started', lang)}</SelectItem><SelectItem value="under_review">{formatComplianceStatus('under_review', lang)}</SelectItem><SelectItem value="update_required">{formatComplianceStatus('update_required', lang)}</SelectItem><SelectItem value="approved">{formatComplianceStatus('approved', lang)}</SelectItem><SelectItem value="rejected">{formatComplianceStatus('rejected', lang)}</SelectItem></SelectContent></Select></div></CardHeader><CardContent>{complianceFailed ? <LoadFailed text={loadFailedText} retryText={retryText} onRetry={() => void refetchCompliance()} /> : complianceLoading ? <div className="py-10 text-center text-muted-foreground"><RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />{t('common.loading')}</div> : filteredComplianceQueue.length === 0 ? <EmptyState text={lang === 'ar' ? 'لا توجد ملفات مطابقة للفلاتر الحالية' : 'No registrations match the current filters'} /> : <div className="space-y-3">{filteredComplianceQueue.map(applicant => { const required = applicant.requirements.filter((item: any) => item.required).length; const approved = applicant.documents.filter((document: any) => document.status === 'approved').length; const previewDocument = applicant.documents.find((document: any) => Boolean(document.url)); const openApplicant = () => { setActiveApplicant(applicant); setComplianceStatus(applicant.onboardingStatus === 'not_started' ? 'under_review' : applicant.onboardingStatus as typeof complianceStatus); setComplianceNote(applicant.onboardingReviewNotes ?? ''); }; return <div role="button" tabIndex={0} key={applicant.id} className="w-full rounded-xl border p-4 text-start transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={openApplicant} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openApplicant(); } }}><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3"><div className="rounded-lg bg-primary/10 p-2 text-primary"><FileSearch className="h-5 w-5" /></div><div className="min-w-0"><p className="truncate font-semibold">{applicant.name || applicant.email || `#${applicant.id}`}</p><p className="text-xs text-muted-foreground">{labelForRole(applicant.userRole, lang)} · {applicant.email || '—'}</p></div></div><div className="flex flex-wrap items-center gap-2"><Badge className={formatComplianceStatus(applicant.onboardingStatus, lang) === (lang === 'ar' ? 'تمت الموافقة' : 'Approved') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}>{formatComplianceStatus(applicant.onboardingStatus, lang)}</Badge><span className="text-xs text-muted-foreground">{approved}/{required} {lang === 'ar' ? 'مطلوب معتمد' : 'required approved'}</span>{previewDocument && <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={event => { event.stopPropagation(); loadDocumentPreview(previewDocument); }}><Eye className="h-3 w-3" />{lang === 'ar' ? 'معاينة' : 'Quick view'}</Button>}<Eye className="h-4 w-4 text-muted-foreground" /></div></div></div>; })}</div>}</CardContent></Card>

      <Dialog open={Boolean(bulkDecision)} onOpenChange={open => { if (!open && !bulkUpdateApplicantStatus.isPending) { setBulkDecision(null); setBulkRejectionReason(''); } }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />{bulkDecision === 'approved' ? (lang === 'ar' ? 'تأكيد الاعتماد الجماعي' : 'Confirm bulk approval') : (lang === 'ar' ? 'تأكيد الرفض الجماعي' : 'Confirm bulk rejection')}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{bulkDecision === 'approved' ? (lang === 'ar' ? `سيتم اعتماد ${selectedRegistrationIds.length} طلبات تسجيل.` : `${selectedRegistrationIds.length} registration applications will be approved.`) : (lang === 'ar' ? `سيتم رفض ${selectedRegistrationIds.length} طلبات تسجيل. يمكنك إضافة سبب اختياري.` : `${selectedRegistrationIds.length} registration applications will be rejected. You may add an optional reason.`)}</p>{bulkDecision === 'rejected' && <Textarea rows={4} maxLength={2000} placeholder={lang === 'ar' ? 'سبب الرفض (اختياري)' : 'Rejection reason (optional)'} value={bulkRejectionReason} onChange={event => setBulkRejectionReason(event.target.value)} />}<DialogFooter><Button type="button" variant="outline" onClick={() => { setBulkDecision(null); setBulkRejectionReason(''); }} disabled={bulkUpdateApplicantStatus.isPending}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</Button><Button type="button" variant={bulkDecision === 'rejected' ? 'destructive' : 'default'} onClick={submitBulkDecision} disabled={bulkUpdateApplicantStatus.isPending || !selectedRegistrationIds.length}>{bulkUpdateApplicantStatus.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : bulkDecision === 'rejected' ? (lang === 'ar' ? 'تأكيد الرفض' : 'Confirm rejection') : (lang === 'ar' ? 'تأكيد الاعتماد' : 'Confirm approval')}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(activeDocument)} onOpenChange={open => !open && closeDocumentPreview()}><DialogContent className="max-w-4xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-primary" />{activeDocument?.fileName || (lang === 'ar' ? 'معاينة المستند' : 'Document preview')}</DialogTitle></DialogHeader><div className="flex min-h-[360px] items-center justify-center overflow-hidden rounded-xl border bg-muted/20 p-3">{documentPreviewStatus === 'loading' && <div className="text-center text-muted-foreground"><Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" /><p>{lang === 'ar' ? 'جاري تحميل المستند…' : 'Loading document…'}</p></div>}{documentPreviewStatus === 'error' && <div className="max-w-sm text-center"><AlertTriangle className="mx-auto mb-3 h-8 w-8 text-rose-500" /><p className="text-sm font-medium">{lang === 'ar' ? 'تعذر تحميل المستند' : 'Document could not be loaded'}</p><p className="mt-1 text-xs text-muted-foreground">{documentPreviewError}</p><Button type="button" size="sm" className="mt-4 gap-2" onClick={() => activeDocument && loadDocumentPreview(activeDocument)}><RefreshCw className="h-3.5 w-3.5" />{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</Button></div>}{documentPreviewStatus === 'ready' && documentPreviewSource && (activeDocument?.mimeType?.startsWith('image/') ? <img src={documentPreviewSource} alt={activeDocument.fileName} className="max-h-[65vh] max-w-full rounded-lg object-contain" onError={() => { setDocumentPreviewStatus('error'); setDocumentPreviewError(lang === 'ar' ? 'تعذر عرض صورة المستند.' : 'The document image could not be displayed.'); }} /> : <iframe src={documentPreviewSource} title={activeDocument.fileName} className="h-[65vh] w-full rounded-lg bg-background" onLoad={() => setDocumentPreviewStatus('ready')} />)}</div><DialogFooter><Button variant="outline" onClick={closeDocumentPreview}>{lang === 'ar' ? 'إغلاق' : 'Close'}</Button>{activeDocument?.url && <a href={activeDocument.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90">{lang === 'ar' ? 'فتح في تبويب جديد' : 'Open in new tab'}</a>}</DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(activeApplicant)} onOpenChange={open => !open && setActiveApplicant(null)}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-primary" />{activeApplicant?.name || activeApplicant?.email || (lang === 'ar' ? 'ملف التسجيل' : 'Registration profile')}</DialogTitle></DialogHeader><div className="space-y-5">{complianceDetail ? <><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-4"><div><p className="text-sm text-muted-foreground">{labelForRole(complianceDetail.applicant.userRole, lang)} · {complianceDetail.applicant.email || '—'}</p><p className="mt-1 text-lg font-semibold">{formatComplianceStatus(complianceDetail.applicant.onboardingStatus, lang)}</p></div><Badge className={complianceDetail.applicant.onboardingStatus === 'approved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}>{formatComplianceStatus(complianceDetail.applicant.onboardingStatus, lang)}</Badge></div><div className="space-y-3">{complianceDetail.requirements.map(requirement => { const document = complianceDetail.documents.find(item => item.documentType === requirement.type); return <div key={requirement.type} className="rounded-xl border p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{lang === 'ar' ? requirement.nameAr : requirement.name}</p>{requirement.required ? <Badge variant="outline" className="text-[10px]">{lang === 'ar' ? 'مطلوب' : 'Required'}</Badge> : <Badge variant="outline" className="text-[10px]">{lang === 'ar' ? 'اختياري' : 'Optional'}</Badge>}</div>{document ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><Badge className={document.status === 'approved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : document.status === 'rejected' || document.status === 'update_required' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-700'}>{formatComplianceStatus(document.status, lang)}</Badge><button type="button" className="inline-flex items-center gap-1 underline underline-offset-2" onClick={event => { event.stopPropagation(); loadDocumentPreview(document); }}><Eye className="h-3 w-3" />{document.fileName}</button><span className="text-muted-foreground">{(document.size / (1024 * 1024)).toFixed(1)} MB</span></div> : <p className="mt-2 text-xs text-muted-foreground">{lang === 'ar' ? 'لم يتم رفع المستند بعد' : 'Document not submitted yet'}</p>}{document?.applicantNote && <p className="mt-2 text-xs text-muted-foreground">{lang === 'ar' ? 'ملاحظة مقدم الطلب: ' : 'Applicant note: '}{document.applicantNote}</p>}{document?.reviewerNote && <p className="mt-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{lang === 'ar' ? 'ملاحظة المراجع: ' : 'Reviewer note: '}{document.reviewerNote}</p>}{complianceDetail.history?.filter(item => item.documentType === requirement.type).length > 1 && <div className="mt-3 rounded-lg bg-muted/30 p-3"><p className="mb-2 text-xs font-semibold">{lang === 'ar' ? 'سجل إعادة الرفع' : 'Re-upload history'}</p>{complianceDetail.history.filter(item => item.documentType === requirement.type).slice(0, 5).map(item => <div key={item.id} className="border-t py-2 text-xs first:border-0 first:pt-0"><div className="flex flex-wrap items-center justify-between gap-2"><span>{item.fileName}</span><span className="text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span></div>{item.applicantNote && <p className="mt-1 text-muted-foreground">{item.applicantNote}</p>}</div>)}</div>}</div>{document && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" className="gap-1 text-emerald-700" onClick={() => reviewComplianceDocument.mutate({ documentId: document.id, status: 'approved' })} disabled={reviewComplianceDocument.isPending}><CheckCircle2 className="h-3 w-3" />{lang === 'ar' ? 'اعتماد' : 'Approve'}</Button><Button size="sm" variant="outline" className="gap-1" onClick={() => reviewComplianceDocument.mutate({ documentId: document.id, status: 'update_required', reviewerNote: complianceNote || undefined })} disabled={reviewComplianceDocument.isPending}><RotateCcw className="h-3 w-3" />{lang === 'ar' ? 'طلب تحديث' : 'Request update'}</Button><Button size="sm" variant="outline" className="gap-1 text-rose-700" onClick={() => reviewComplianceDocument.mutate({ documentId: document.id, status: 'rejected', reviewerNote: complianceNote || undefined })} disabled={reviewComplianceDocument.isPending}><XCircle className="h-3 w-3" />{lang === 'ar' ? 'رفض' : 'Reject'}</Button></div>}</div></div>; })}</div><div className="rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="mb-3 text-sm font-semibold">{lang === 'ar' ? 'إرسال تحديث حالة التسجيل' : 'Send registration status update'}</p><div className="grid gap-3 md:grid-cols-[0.7fr_1.3fr]"><Select value={complianceStatus} onValueChange={value => setComplianceStatus(value as typeof complianceStatus)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="under_review">{formatComplianceStatus('under_review', lang)}</SelectItem><SelectItem value="approved">{formatComplianceStatus('approved', lang)}</SelectItem><SelectItem value="update_required">{formatComplianceStatus('update_required', lang)}</SelectItem><SelectItem value="rejected">{formatComplianceStatus('rejected', lang)}</SelectItem></SelectContent></Select><Textarea rows={2} placeholder={lang === 'ar' ? 'اكتب رسالة لمقدم الطلب أو ما الذي يجب تحديثه…' : 'Tell the applicant what to update or clarify…'} value={complianceNote} onChange={event => setComplianceNote(event.target.value)} /></div><div className="mt-3 flex justify-end"><Button onClick={() => updateApplicantStatus.mutate({ userId: complianceDetail.applicant.id, status: complianceStatus, note: complianceNote || undefined })} disabled={updateApplicantStatus.isPending} className="gap-2"><SendHorizontal className="h-4 w-4" />{updateApplicantStatus.isPending ? t('common.loading') : (lang === 'ar' ? 'إرسال التحديث' : 'Send update')}</Button></div></div><div><p className="mb-2 text-sm font-semibold">{lang === 'ar' ? 'سجل المراجعة' : 'Audit timeline'}</p><div className="space-y-2">{complianceDetail.events.map(event => <div key={event.id} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-xs"><span className="font-medium">{event.action.replaceAll('_', ' ')} · {event.status || '—'}</span><span className="text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</span>{event.note && <p className="basis-full text-muted-foreground">{event.note}</p>}</div>)}</div></div></> : <div className="py-10 text-center text-muted-foreground"><RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />{t('common.loading')}</div>}</div></DialogContent></Dialog>
    </div>
  );
}
