import { useAuth } from '@/_core/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { trpc } from '@/lib/trpc';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import { Users, FolderOpen, Package, FileText, ShieldCheck, AlertTriangle, TrendingUp, Settings, Search, Eye, Ban, CheckCircle2, MessageSquare, Flag, Activity, Globe, UserRound, UserCheck, UserX, Save, RefreshCw, ClipboardCheck, FileSearch, RotateCcw, XCircle, SendHorizontal, Download, CalendarDays, Loader2, UserPlus, Trash2, History, Power, KeyRound, Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useLocation } from 'wouter';
import { useEffect, useMemo, useRef, useState } from 'react';
import { summarizeComplianceRegistrations } from '@shared/compliance';
import { buildRegistrationMetricsCsv, filterRegistrationApplicants, dateKey } from '@shared/registrationMetrics';
import AdminVendorBilling from '@/components/AdminVendorBilling';
import AdminSponsorships from '@/components/AdminSponsorships';
import AdminFeaturedProducts from '@/components/AdminFeaturedProducts';
import AdminFeaturedProviders from '@/components/AdminFeaturedProviders';
import AdminEnquiryAllowance from '@/components/AdminEnquiryAllowance';
import AdminRfqInvestigation from '@/components/AdminRfqInvestigation';
import AdminCommercialAnalytics from '@/components/AdminCommercialAnalytics';
import AdminPlatformSearch from '@/components/AdminPlatformSearch';
import AdminDataQuality from '@/components/AdminDataQuality';
import AdminOperationalHealth from '@/components/AdminOperationalHealth';
import AdminProjects from '@/components/AdminProjects';
import AdminProducts from '@/components/AdminProducts';

/*
 * Slice 4 removed a hardcoded MONTHLY_USERS array from this file - six months
 * of invented growth (120 users rising to 580, 45 projects rising to 198) that
 * `admin.analyticsSummary` fell back to whenever it returned nothing.
 *
 * On a pre-launch platform it returns nothing constantly, so the owner's own
 * analytics tab was showing fabricated traction as though it were measured.
 * Numbers on an admin dashboard get read as fact and get quoted to investors.
 *
 * The charts now render whatever the server actually measured, and an explicit
 * empty state when that is nothing at all.
 */

const ROLE_GROUPS = [
  { key: 'homeowner', en: 'Homeowners', ar: 'أصحاب المنازل' },
  { key: 'contractor', en: 'Contractors', ar: 'المقاولون' },
  { key: 'engineer', en: 'Engineers', ar: 'المهندسون' },
  { key: 'architect', en: 'Architects', ar: 'المهندسون المعماريون' },
  { key: 'supplier', en: 'Suppliers', ar: 'الموردون' },
  { key: 'project_manager', en: 'Project Managers', ar: 'مديرو المشاريع' },
  { key: 'admin', en: 'Administrators', ar: 'المشرفون' },
];

const FREEZE_REASONS = [
  { value: 'policy_violation', en: 'Policy violation', ar: 'مخالفة السياسة' },
  { value: 'suspicious_activity', en: 'Suspicious activity', ar: 'نشاط مشبوه' },
  { value: 'compliance_review', en: 'Compliance review', ar: 'مراجعة الامتثال' },
  { value: 'incomplete_profile', en: 'Incomplete or invalid profile', ar: 'ملف شخصي غير مكتمل أو غير صالح' },
  { value: 'user_requested', en: 'Temporary hold requested by user', ar: 'تعليق مؤقت بطلب من المستخدم' },
  { value: 'other', en: 'Other', ar: 'سبب آخر' },
] as const;

const SETTING_DEFINITIONS = [
  { key: 'maintenanceMode', en: 'Maintenance Mode', ar: 'وضع الصيانة', type: 'boolean' as const },
  { key: 'registrationEnabled', en: 'Registration Enabled', ar: 'السماح بالتسجيل', type: 'boolean' as const },
  { key: 'emailNotifications', en: 'Email Notifications', ar: 'إشعارات البريد الإلكتروني', type: 'boolean' as const },
  { key: 'smsAlerts', en: 'SMS Alerts', ar: 'تنبيهات الرسائل النصية', type: 'boolean' as const },
  { key: 'autoVerifyKyc', en: 'Auto-verify after KYC', ar: 'التحقق التلقائي بعد KYC', type: 'boolean' as const },
  { key: 'manualReviewThreshold', en: 'Manual Review Threshold', ar: 'حد المراجعة اليدوية', type: 'number' as const },
  { key: 'transactionFeePercent', en: 'Transaction Fee (%)', ar: 'رسوم المعاملة (%)', type: 'number' as const },
  { key: 'commissionPercent', en: 'Commission (%)', ar: 'العمولة (%)', type: 'number' as const },
  { key: 'reviewApprovalRequired', en: 'Review Approval Required', ar: 'اعتماد التقييمات مطلوب', type: 'boolean' as const },
  { key: 'spamSensitivity', en: 'Spam Sensitivity', ar: 'حساسية الرسائل المزعجة', type: 'text' as const },
];

function labelForRole(role: string | null | undefined, lang: 'en' | 'ar') {
  const found = ROLE_GROUPS.find(group => group.key === role);
  return found ? (lang === 'ar' ? found.ar : found.en) : role || (lang === 'ar' ? 'غير محدد' : 'Unassigned');
}

function formatComplianceStatus(status: string | null | undefined, lang: 'en' | 'ar') {
  const labels: Record<string, [string, string]> = { not_started: ['Not started', 'لم يبدأ'], submitted: ['Submitted', 'تم الإرسال'], under_review: ['Under review', 'قيد المراجعة'], update_required: ['Update required', 'يتطلب تحديثاً'], approved: ['Approved', 'تمت الموافقة'], rejected: ['Rejected', 'مرفوض'] };
  return status ? (labels[status]?.[lang === 'ar' ? 1 : 0] ?? status) : '—';
}

function formatStatus(status: string | null | undefined, lang: 'en' | 'ar') {
  const labels: Record<string, string> = lang === 'ar'
    ? { open: 'مفتوحة', investigating: 'قيد التحقيق', resolved: 'تم الحل', rejected: 'مرفوضة', active: 'نشط', frozen: 'مجمد', pending: 'قيد الانتظار', accepted: 'مقبول' }
    : { open: 'Open', investigating: 'Investigating', resolved: 'Resolved', rejected: 'Rejected', active: 'Active', frozen: 'Frozen', pending: 'Pending', accepted: 'Accepted' };
  return status ? labels[status] ?? status : '—';
}

function formatFreezeReason(reason: string | null | undefined, lang: 'en' | 'ar') {
  const normalized = reason?.trim();
  if (!normalized) return '';
  const match = FREEZE_REASONS.find(option => option.value === normalized || option.en === normalized || option.ar === normalized);
  return match ? (lang === 'ar' ? match.ar : match.en) : normalized;
}


export default function AdminDashboard() {
  const { t, lang, dir } = useLanguage();
  const { user, isAuthenticated, loading } = useAuth();
  const [location, navigate] = useLocation();
  const adminSection = useMemo(() => {
    if (location === '/admin' || location === '/admin/') return 'overview';
    const section = location.split('/')[2];
    return ['users', 'projects', 'products', 'compliance', 'analytics', 'billing', 'disputes', 'operations', 'settings'].includes(section ?? '') ? section! : 'overview';
  }, [location]);
  const handleAdminSectionChange = (section: string) => {
    if (section === 'overview') { navigate('/admin'); return; }
    navigate(section === 'users' ? '/admin/users' : `/admin/${section}`);
  };
  const [userSearch, setUserSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [freezeTarget, setFreezeTarget] = useState<any | null>(null);
  const [freezeReason, setFreezeReason] = useState('');
  const [freezeReasonDetail, setFreezeReasonDetail] = useState('');
  const [activeDispute, setActiveDispute] = useState<any | null>(null);
  const [disputeStatus, setDisputeStatus] = useState<'open' | 'investigating' | 'resolved' | 'rejected'>('investigating');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>({});
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
  const [createAccountType, setCreateAccountType] = useState<'admin' | 'dummy' | null>(null);
  const [accountDraft, setAccountDraft] = useState({ name: '', username: '', email: '', phone: '', userRole: 'homeowner', note: '', password: '' });
  const [dummyPasswordTarget, setDummyPasswordTarget] = useState<any | null>(null);
  // QA sign-in links. issuedToken holds the raw token for exactly as long as
  // the dialog is open - it is never stored, never refetchable, and cleared on
  // close, because the server will not show it again.
  const [linkTarget, setLinkTarget] = useState<any | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [linkMinutes, setLinkMinutes] = useState(60);
  const [dummyPassword, setDummyPassword] = useState('');
  const [auditTarget, setAuditTarget] = useState<any | null>(null);
  const [bulkDecision, setBulkDecision] = useState<'approved' | 'rejected' | null>(null);
  const [bulkRejectionReason, setBulkRejectionReason] = useState('');
  const [csvExporting, setCsvExporting] = useState(false);
  const [documentPreviewSource, setDocumentPreviewSource] = useState<string | null>(null);
  const [documentPreviewStatus, setDocumentPreviewStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [documentPreviewError, setDocumentPreviewError] = useState('');
  const previewRequestRef = useRef(0);
  const previewObjectUrlRef = useRef<string | null>(null);
  const isAdmin = isAuthenticated && (user as any)?.role === 'admin';
  const utils = trpc.useUtils();
  const utilsTrpc = trpc.useUtils();
  const complianceQueueInput = useMemo(() => ({ includeDummy: includeDummyRegistrations }), [includeDummyRegistrations]);

  // WHO this administrator is, and therefore what they may load.
  //
  // Every query below is gated on the PERMISSION its endpoint requires, not
  // merely on "is an admin". Without that, a Sub-Admin opening this page would
  // fire eight requests, collect a 403 from most of them, and be shown a
  // dashboard full of errors for working as designed. `can()` returns false
  // while admin.me is still loading, so nothing is requested speculatively.
  const { data: adminMe } = trpc.admin.me.useQuery(undefined, { enabled: isAdmin, retry: false });
  const can = (permission: string) => adminMe?.permissions.includes(permission as never) ?? false;

  const { data: stats } = trpc.admin.stats.useQuery(undefined, { enabled: can('users.read') });
  const { data: allUsers = [], isLoading: usersLoading } = trpc.admin.users.useQuery(undefined, { enabled: can('users.read') });
  const { data: disputes = [], isLoading: disputesLoading } = trpc.admin.disputes.useQuery(undefined, { enabled: can('support.manage') });
  const { data: settings } = trpc.admin.settings.useQuery(undefined, { enabled: can('settings.manage') });
  const { data: complianceQueue = [], isLoading: complianceLoading } = trpc.admin.complianceQueue.useQuery(complianceQueueInput, { enabled: can('marketplace.manage') });
  const { data: complianceDetail } = trpc.admin.complianceApplicant.useQuery({ userId: activeApplicant?.id }, { enabled: can('marketplace.manage') && Boolean(activeApplicant?.id) });
  const { data: auditEvents = [] } = trpc.admin.accountAudit.useQuery({ userId: auditTarget?.id }, { enabled: can('users.read') && Boolean(auditTarget?.id) });
  const { data: dynamicAnalytics = [] } = trpc.admin.analyticsSummary.useQuery(complianceQueueInput, { enabled: can('audit.read') });
  const analyticsData = dynamicAnalytics;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('qaDummyPassword') !== '1') return;
    if (params.get('dialog') === 'change') {
      setDummyPasswordTarget({ id: 0, name: 'Preview Dummy User', username: 'preview.dummy' });
    } else {
      setCreateAccountType('dummy');
    }
  }, [location]);

  useEffect(() => {
    if (settings) setSettingDrafts(settings);
  }, [settings]);

  const createUser = trpc.admin.createUser.useMutation({
    onSuccess: data => {
      toast.success(lang === 'ar' ? 'تم إنشاء الحساب الإداري وإرسال الدعوة' : 'Admin account created & invitation generated');
      if (data.invitationLink) {
        navigator.clipboard?.writeText?.(window.location.origin + data.invitationLink);
        toast.info(lang === 'ar' ? 'تم نسخ رابط إعداد كلمة المرور إلى الحافظة' : 'Password setup link copied to clipboard', { duration: 6000 });
      }
      setCreateAccountType(null);
      setAccountDraft({ name: '', username: '', email: '', phone: '', userRole: 'homeowner', note: '', password: '' });
      utils.admin.users.invalidate();
      utils.admin.stats.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const createDummyUser = trpc.admin.createDummyUser.useMutation({
    onSuccess: data => { toast.success(lang === 'ar' ? `تم إنشاء المستخدم التجريبي: ${data.username}` : `Dummy user created: ${data.username}`); setCreateAccountType(null); setAccountDraft({ name: '', username: '', email: '', phone: '', userRole: 'homeowner', note: '', password: '' }); utils.admin.users.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const setDummyUserPassword = trpc.admin.setDummyUserPassword.useMutation({
    onSuccess: () => {
      toast.success(lang === 'ar' ? 'تم تحديث كلمة مرور المستخدم التجريبي' : 'Dummy-user password updated');
      setDummyPasswordTarget(null);
      setDummyPassword('');
      utils.admin.users.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const capabilities = trpc.auth.capabilities.useQuery();
  const testLoginEnabled = capabilities.data?.testLogin === true;
  const linksQuery = trpc.admin.testLoginLinks.useQuery(
    { userId: linkTarget?.id ?? 0 },
    { enabled: Boolean(linkTarget?.id) },
  );
  const issueTestLoginLink = trpc.admin.issueTestLoginLink.useMutation({
    onSuccess: data => { setIssuedToken(data.token); linksQuery.refetch(); },
    onError: error => toast.error(error.message),
  });
  const revokeTestLoginLink = trpc.admin.revokeTestLoginLink.useMutation({
    onSuccess: () => { toast.success(lang === 'ar' ? 'تم إبطال الرابط' : 'Sign-in link revoked'); linksQuery.refetch(); },
    onError: error => toast.error(error.message),
  });
  const setDummyUserActive = trpc.admin.setDummyUserActive.useMutation({
    onSuccess: () => { toast.success(lang === 'ar' ? 'تم تحديث حالة المستخدم التجريبي' : 'Dummy-user status updated'); utils.admin.users.invalidate(); utils.admin.stats.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const deleteDummyUser = trpc.admin.deleteDummyUser.useMutation({
    onSuccess: () => { toast.success(lang === 'ar' ? 'تم حذف المستخدم التجريبي' : 'Dummy user deleted'); setAuditTarget(null); utils.admin.users.invalidate(); utils.admin.stats.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const resendInvitation = trpc.admin.resendInvitation.useMutation({
    onSuccess: data => {
      toast.success(lang === 'ar' ? 'تم إعادة إرسال دعوة إعداد كلمة المرور' : 'Password setup invitation resent');
      if (data.invitationLink) {
        navigator.clipboard?.writeText?.(window.location.origin + data.invitationLink);
        toast.info(lang === 'ar' ? 'تم نسخ رابط الدعوة إلى الحافظة' : 'Invitation link copied to clipboard', { duration: 6000 });
      }
      utils.admin.users.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const verifyUser = trpc.admin.verifyUser.useMutation({
    onSuccess: () => { toast.success(lang === 'ar' ? 'تم تحديث حالة التحقق' : 'Verification status updated'); utils.admin.users.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const setUserFrozen = trpc.admin.setUserFrozen.useMutation({
    onSuccess: (_data, variables) => {
      toast.success(lang === 'ar' ? (variables.frozen ? 'تم تجميد المستخدم' : 'تم إلغاء تجميد المستخدم') : (variables.frozen ? 'User frozen' : 'User unfrozen'));
      setFreezeTarget(null);
      setFreezeReason('');
      setFreezeReasonDetail('');
      utils.admin.users.invalidate();
      utils.admin.stats.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const updateDispute = trpc.admin.updateDispute.useMutation({
    onSuccess: () => {
      toast.success(lang === 'ar' ? 'تم تحديث النزاع' : 'Dispute updated');
      setActiveDispute(null);
      utils.admin.disputes.invalidate();
      utils.admin.stats.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const updateSetting = trpc.admin.updateSetting.useMutation({
    onSuccess: () => { toast.success(lang === 'ar' ? 'تم حفظ الإعداد' : 'Setting saved'); utils.admin.settings.invalidate(); },
    onError: error => toast.error(error.message),
  });
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

  const filteredUsers = useMemo(() => allUsers.filter(userRow => {
    const role = (userRow as any).userRole ?? userRow.role;
    const matchesGroup = selectedGroup === 'all' || role === selectedGroup;
    const query = userSearch.trim().toLowerCase();
    const matchesSearch = !query || `${userRow.name ?? ''} ${userRow.email ?? ''}`.toLowerCase().includes(query);
    return matchesGroup && matchesSearch;
  }), [allUsers, selectedGroup, userSearch]);

  const groupCounts = useMemo(() => ROLE_GROUPS.reduce<Record<string, number>>((result, group) => {
    result[group.key] = allUsers.filter(userRow => ((userRow as any).userRole ?? userRow.role) === group.key).length;
    return result;
  }, {}), [allUsers]);

  const recentUsers = useMemo(() => allUsers.slice(0, 7), [allUsers]);
  const userSummaryCounts = useMemo(() => ({
    total: allUsers.length,
    homeowners: groupCounts.homeowner ?? 0,
    suppliers: groupCounts.supplier ?? 0,
    professionals: (groupCounts.contractor ?? 0) + (groupCounts.engineer ?? 0) + (groupCounts.architect ?? 0) + (groupCounts.project_manager ?? 0),
    administrators: groupCounts.admin ?? 0,
  }), [allUsers, groupCounts]);

  const filteredComplianceQueue = useMemo(() => complianceQueue.filter(applicant => {
    const roleMatches = complianceRoleFilter === 'all' || applicant.userRole === complianceRoleFilter;
    const statusMatches = complianceStatusFilter === 'all' || applicant.onboardingStatus === complianceStatusFilter;
    return roleMatches && statusMatches;
  }), [complianceQueue, complianceRoleFilter, complianceStatusFilter]);

  const openDisputes = disputes.filter(dispute => dispute.status === 'open').length;
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

  if (loading) return null;
  if (!isAuthenticated) { window.location.href = '/auth?mode=login'; return null; }
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir={dir}>
        <div className="text-center">
          <AlertTriangle className="w-16 h-16 mx-auto mb-4 text-destructive" />
          <h2 className="text-2xl font-bold mb-2">{lang === 'ar' ? 'غير مصرح' : 'Access Denied'}</h2>
          <p className="text-muted-foreground">{lang === 'ar' ? 'ليس لديك صلاحيات المشرف.' : 'You do not have admin privileges.'}</p>
          {/* To the ADMIN door. Someone landing here is either signed out or
              signed in as a customer; /dashboard would be the right answer for
              the second and useless for the first, and administrators do not
              sign in at /auth any more. */}
          <Button className="mt-4" onClick={() => navigate('/admin/login')}>{lang === 'ar' ? 'دخول المشرفين' : 'Administrator sign-in'}</Button>
        </div>
      </div>
    );
  }

  const statCards = [
    { label: lang === 'ar' ? 'إجمالي المستخدمين' : 'Total Users', value: stats?.users ?? 0, icon: Users, color: 'text-blue-500', bg: 'bg-blue-50', section: 'users' },
    { label: lang === 'ar' ? 'المشاريع النشطة' : 'Active Projects', value: stats?.projects ?? 0, icon: FolderOpen, color: 'text-green-500', bg: 'bg-green-50', section: 'projects' },
    { label: lang === 'ar' ? 'المنتجات المدرجة' : 'Products Listed', value: stats?.products ?? 0, icon: Package, color: 'text-amber-500', bg: 'bg-amber-50', section: 'products' },
    { label: lang === 'ar' ? 'النزاعات المفتوحة' : 'Open Disputes', value: openDisputes, icon: MessageSquare, color: 'text-purple-500', bg: 'bg-purple-50', section: 'disputes' },
  ];

  const handleFreezeSubmit = () => {
    if (!freezeTarget) return;
    const isCurrentlyFrozen = (freezeTarget as any).accountStatus === 'frozen';
    if (!isCurrentlyFrozen && !freezeReason) return;
    const reason = freezeReason === 'other' && freezeReasonDetail.trim()
      ? freezeReasonDetail.trim()
      : freezeReason || undefined;
    setUserFrozen.mutate({ userId: freezeTarget.id, frozen: !isCurrentlyFrozen, reason });
  };

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

  const exportAuditPdf = async () => {
    if (!isAdmin) return;
    const toastId = `audit-export-${Date.now()}`;
    toast.loading(lang === 'ar' ? 'جاري إعداد تقرير تدقيق الحسابات بصيغة PDF…' : 'Generating audit log PDF report…', { id: toastId, duration: Infinity, closeButton: true });
    try {
      const auditRows = await utilsTrpc.admin.fullAuditReport.fetch();
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.error(lang === 'ar' ? 'يرجى السماح بالنوافذ المنبثقة لتنزيل ملف PDF' : 'Please allow popups to download the PDF report', { id: toastId, duration: 5000, closeButton: true });
        return;
      }
      const html = `<!DOCTYPE html>
      <html lang="${lang}">
      <head>
        <meta charset="utf-8">
        <title>BuildHub - Comprehensive Account Audit Log</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; padding: 24px; color: #111827; }
          h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
          p { font-size: 12px; color: #6b7280; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 12px; }
          th, td { border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; }
          th { background-color: #f3f4f6; font-weight: 600; color: #374151; }
          tr:nth-child(even) { background-color: #f9fafb; }
          .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 500; background: #e5e7eb; }
        </style>
      </head>
      <body>
        <h1>BuildHub Enterprise Account Audit Log</h1>
        <p>Generated on ${new Date().toLocaleString()} · Total Audit Events: ${auditRows.length}</p>
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Email</th>
              <th>Account Type</th>
              <th>Role</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Status</th>
              <th>Invitation</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            ${auditRows.map(row => `
              <tr>
                <td>${new Date(row.createdAt).toLocaleString()}</td>
                <td><strong>${row.userName}</strong></td>
                <td>${row.userEmail}</td>
                <td><span class="badge">${row.accountType}</span></td>
                <td>${row.role}</td>
                <td><code>${row.action}</code></td>
                <td>${row.actorName}</td>
                <td>${row.accountStatus}</td>
                <td>${row.invitationStatus}</td>
                <td>${row.note}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <script>
          window.onload = () => { window.print(); };
        </script>
      </body>
      </html>`;
      printWindow.document.write(html);
      printWindow.document.close();
      toast.success(lang === 'ar' ? 'تم إنشاء تقرير التدقيق بنجاح' : 'Audit log PDF export ready', { id: toastId, duration: 5000, closeButton: true });
    } catch {
      toast.error(lang === 'ar' ? 'تعذر إنشاء تقرير التدقيق. حاول مرة أخرى.' : 'Audit PDF export failed. Please try again.', { id: toastId, duration: 6000, closeButton: true });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6" dir={dir}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-2xl font-bold mb-1">{t('admin.title')}</h2><p className="text-muted-foreground">{lang === 'ar' ? 'مراقبة وإدارة منصة BuildHub' : 'Monitor and manage the BuildHub platform'}</p></div>
          <div className="flex items-center gap-2"><Badge className="badge-success text-xs px-3 py-1">{lang === 'ar' ? 'المنصة تعمل بشكل جيد' : 'Platform Healthy'}</Badge><Badge className="badge-info text-xs px-3 py-1 flex items-center gap-1"><Activity className="w-3 h-3" /> {lang === 'ar' ? 'مباشر' : 'Live'}</Badge></div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map(stat => <Card key={stat.label} role="button" tabIndex={0} className="cursor-pointer transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary" data-testid={`admin-kpi-${stat.section}`} onClick={() => handleAdminSectionChange(stat.section)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleAdminSectionChange(stat.section); } }}><CardContent className="p-5"><div className={`w-10 h-10 rounded-xl ${stat.bg} flex items-center justify-center mb-3`}><stat.icon className={`w-5 h-5 ${stat.color}`} /></div><p className="text-2xl font-bold">{stat.value.toLocaleString()}</p><p className="text-sm text-muted-foreground">{stat.label}</p></CardContent></Card>)}
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div><CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-primary" />{lang === 'ar' ? 'ملخص تسجيل المحترفين' : 'Professional registration summary'}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{lang === 'ar' ? 'ابحث عن المتقدمين، قارن الحالات، وطبّق فلاتر الفئة وتاريخ الإرسال.' : 'Search applicants, compare statuses, and filter by category and submission date.'}</p></div>
            <div className="flex flex-wrap items-center gap-2 text-xs"><Badge className="border-amber-200 bg-amber-50 text-amber-700">{lang === 'ar' ? 'قيد الانتظار' : 'Pending'}: {registrationSummary.pending}</Badge><Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{lang === 'ar' ? 'معتمد' : 'Approved'}: {registrationSummary.approved}</Badge><Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={exportRegistrationCsv} disabled={csvExporting || !filteredRegistrationApplicants.length}>{csvExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}{csvExporting ? (lang === 'ar' ? 'جاري التصدير…' : 'Exporting…') : (lang === 'ar' ? 'تصدير CSV' : 'Export CSV')}</Button></div>
          </CardHeader>
          <CardContent><div className="mb-5 rounded-xl border bg-muted/20 p-3"><div className="grid gap-3 lg:grid-cols-[minmax(220px,1.5fr)_minmax(160px,1fr)_minmax(160px,1fr)_auto] lg:items-end"><div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">{lang === 'ar' ? 'بحث عن متقدم' : 'Search applicants'}</label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={registrationSearch} onChange={event => setRegistrationSearch(event.target.value)} placeholder={lang === 'ar' ? 'الاسم الكامل أو البريد الإلكتروني…' : 'Full name or email…'} className="h-9 bg-background pl-9" /></div></div><div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">{lang === 'ar' ? 'الفئة المهنية' : 'Professional category'}</label><Select value={registrationRoleFilter} onValueChange={setRegistrationRoleFilter}><SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{lang === 'ar' ? 'كل الفئات' : 'All categories'}</SelectItem>{ROLE_GROUPS.filter(group => !['homeowner', 'admin'].includes(group.key)).map(group => <SelectItem key={group.key} value={group.key}>{lang === 'ar' ? group.ar : group.en}</SelectItem>)}</SelectContent></Select></div><div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">{lang === 'ar' ? 'من تاريخ الإرسال' : 'Submission date from'}</label><Input type="date" value={registrationDateFrom} max={registrationDateTo || undefined} onChange={event => setRegistrationDateFrom(event.target.value)} className="h-9 bg-background" /></div><div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">{lang === 'ar' ? 'إلى تاريخ الإرسال' : 'Submission date to'}</label><Input type="date" value={registrationDateTo} min={registrationDateFrom || undefined} onChange={event => setRegistrationDateTo(event.target.value)} className="h-9 bg-background" /></div><Button type="button" variant="ghost" className="h-9 gap-1" onClick={() => { setRegistrationSearch(''); setRegistrationRoleFilter('all'); setRegistrationDateFrom(''); setRegistrationDateTo(''); }}><RotateCcw className="h-3.5 w-3.5" />{lang === 'ar' ? 'مسح' : 'Clear'}</Button><label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-xs"><Checkbox checked={includeDummyRegistrations} onCheckedChange={value => setIncludeDummyRegistrations(value === true)} />{lang === 'ar' ? 'تضمين الاختبار' : 'Include test data'}</label></div>{registrationDateRangeInvalid && <p className="mt-2 text-xs text-rose-600">{lang === 'ar' ? 'يجب أن يكون تاريخ البداية قبل تاريخ النهاية.' : 'The start date must be before the end date.'}</p>}</div><div className="mb-5 rounded-xl border p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={allPendingSelected} onCheckedChange={value => toggleAllPendingRegistrations(value === true)} disabled={!pendingRegistrationApplicants.length || bulkUpdateApplicantStatus.isPending} /><span>{lang === 'ar' ? 'تحديد الطلبات قيد الانتظار' : 'Select pending applications'}</span><Badge variant="secondary">{pendingRegistrationApplicants.length}</Badge></label>{selectedRegistrationIds.length > 0 && <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">{selectedRegistrationIds.length} {lang === 'ar' ? 'محدد' : 'selected'}</span><Button type="button" size="sm" className="h-8 gap-1" onClick={() => setBulkDecision('approved')} disabled={bulkUpdateApplicantStatus.isPending}><CheckCircle2 className="h-3.5 w-3.5" />{lang === 'ar' ? 'اعتماد جماعي' : 'Bulk approve'}</Button><Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-rose-700" onClick={() => setBulkDecision('rejected')} disabled={bulkUpdateApplicantStatus.isPending}><XCircle className="h-3.5 w-3.5" />{lang === 'ar' ? 'رفض جماعي' : 'Bulk reject'}</Button></div>}</div>{pendingRegistrationApplicants.length > 0 ? <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{pendingRegistrationApplicants.map(applicant => <label key={applicant.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-muted/10 p-2.5 transition-colors hover:bg-muted/30"><span className="flex min-w-0 items-center gap-2"><Checkbox checked={selectedRegistrationIds.includes(applicant.id)} onCheckedChange={value => toggleRegistrationSelection(applicant.id, value === true)} disabled={bulkUpdateApplicantStatus.isPending} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{applicant.name || applicant.email || `#${applicant.id}`}</span><span className="block truncate text-xs text-muted-foreground">{applicant.email || '—'} · {labelForRole(applicant.userRole, lang)}</span></span></span><span className="shrink-0 text-xs text-muted-foreground">{dateKey(applicant.documents?.[0]?.createdAt ?? applicant.createdAt)}</span></label>)}</div> : <p className="mt-3 text-xs text-muted-foreground">{lang === 'ar' ? 'لا توجد طلبات قيد الانتظار مطابقة للفلاتر.' : 'No pending applications match the current filters.'}</p>}</div><ResponsiveContainer width="100%" height={260}><BarChart data={registrationSummary.counts} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }} barCategoryGap="22%"><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="role" width={lang === 'ar' ? 110 : 125} tick={{ fontSize: 11 }} /><Tooltip cursor={{ fill: 'hsl(var(--muted) / 0.35)' }} /><Legend /><Bar dataKey="pending" name={lang === 'ar' ? 'قيد الانتظار' : 'Pending'} stackId="status" fill="#f59e0b" radius={[4, 0, 0, 4]} isAnimationActive={false} /><Bar dataKey="approved" name={lang === 'ar' ? 'معتمد' : 'Approved'} stackId="status" fill="#10b981" radius={[0, 4, 4, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer></CardContent>
        </Card>

        <Tabs value={adminSection} onValueChange={handleAdminSectionChange}>
          <TabsContent value="overview">
            <Card data-testid="admin-users-preview">
              <CardHeader className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="h-5 w-5" />
                      {lang === 'ar' ? 'المستخدمون' : 'Users'}
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {lang === 'ar'
                        ? 'ملخص سريع بدلاً من تحميل قاعدة المستخدمين كاملة داخل لوحة التحكم.'
                        : 'A quick summary instead of loading the full user base inside the control panel.'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5"
                    onClick={() => handleAdminSectionChange('users')}
                    data-testid="admin-view-all-users"
                  >
                    <Users className="h-3.5 w-3.5" />
                    {lang === 'ar' ? 'عرض كل المستخدمين' : 'View all users'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  {[
                    { key: 'total', label: lang === 'ar' ? 'إجمالي المستخدمين' : 'Total Users', value: userSummaryCounts.total },
                    { key: 'homeowners', label: lang === 'ar' ? 'أصحاب المنازل' : 'Homeowners', value: userSummaryCounts.homeowners },
                    { key: 'suppliers', label: lang === 'ar' ? 'الموردون' : 'Suppliers', value: userSummaryCounts.suppliers },
                    { key: 'professionals', label: lang === 'ar' ? 'المحترفون' : 'Professionals', value: userSummaryCounts.professionals },
                    { key: 'administrators', label: lang === 'ar' ? 'المشرفون' : 'Administrators', value: userSummaryCounts.administrators },
                  ].map(item => (
                    <div key={item.key} className="rounded-xl border p-3">
                      <p className="truncate text-xs text-muted-foreground">{item.label}</p>
                      <p className="mt-1 text-lg font-semibold">{item.value}</p>
                    </div>
                  ))}
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium">{lang === 'ar' ? 'أحدث التسجيلات' : 'Recent registrations'}</p>
                    {usersLoading && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>
                  {recentUsers.length === 0 ? (
                    <p className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                      {lang === 'ar' ? 'لا يوجد مستخدمون بعد.' : 'No users yet.'}
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border">
                      {recentUsers.map(userRow => (
                        <button
                          type="button"
                          key={userRow.id}
                          className="flex w-full items-center justify-between gap-3 border-b border-border/50 px-3 py-2.5 text-start transition-colors last:border-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          onClick={() => navigate(`/admin/users/${userRow.id}`)}
                          data-testid={`admin-recent-user-${userRow.id}`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{userRow.name || userRow.email || `#${userRow.id}`}</span>
                            <span className="block truncate text-xs text-muted-foreground">{userRow.email || '—'} · {labelForRole((userRow as any).userRole ?? userRow.role, lang)}</span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">{new Date(userRow.createdAt).toLocaleDateString()}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users">
            <Card>
              <CardHeader className="space-y-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" />{lang === 'ar' ? 'إدارة المستخدمين حسب المجموعة' : 'User Management by Group'}</CardTitle><div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" className="h-8 gap-1" onClick={exportAuditPdf}><Download className="h-3.5 w-3.5" />{lang === 'ar' ? 'تصدير سجل التدقيق PDF' : 'Export Audit PDF'}</Button><Button size="sm" className="h-8 gap-1" onClick={() => { setCreateAccountType('admin'); setAccountDraft({ name: '', username: '', email: '', phone: '', userRole: 'homeowner', note: '', password: '' }); }}><UserPlus className="h-3.5 w-3.5" />{lang === 'ar' ? 'إنشاء حساب' : 'Create account'}</Button><Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => { setCreateAccountType('dummy'); setAccountDraft({ name: '', username: '', email: '', phone: '', userRole: 'homeowner', note: '', password: '' }); }}><Power className="h-3.5 w-3.5" />{lang === 'ar' ? 'مستخدم تجريبي' : 'Dummy user'}</Button><div className="relative w-full lg:w-72"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input className="pl-9 h-9 text-sm" placeholder={lang === 'ar' ? 'بحث بالاسم أو البريد...' : 'Search by name or email...'} value={userSearch} onChange={event => setUserSearch(event.target.value)} /></div></div></div><div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
<button type="button" onClick={() => setSelectedGroup('all')} className={`rounded-lg border p-3 text-start transition-colors ${selectedGroup === 'all' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}><p className="text-xs text-muted-foreground">{lang === 'ar' ? 'الكل' : 'All Users'}</p><p className="text-lg font-semibold">{allUsers.length}</p></button>{ROLE_GROUPS.map(group => <button type="button" key={group.key} onClick={() => setSelectedGroup(group.key)} className={`rounded-lg border p-3 text-start transition-colors ${selectedGroup === group.key ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}><p className="truncate text-xs text-muted-foreground">{lang === 'ar' ? group.ar : group.en}</p><p className="text-lg font-semibold">{groupCounts[group.key] ?? 0}</p></button>)}</div></CardHeader>
              <CardContent><div className="mb-3 flex items-center justify-between text-sm text-muted-foreground"><span>{selectedGroup === 'all' ? (lang === 'ar' ? 'كل المجموعات' : 'All groups') : labelForRole(selectedGroup, lang)}</span>{usersLoading && <RefreshCw className="h-4 w-4 animate-spin" />}</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border"><th className="text-left py-3 px-2 font-medium text-muted-foreground">{lang === 'ar' ? 'الاسم' : 'Name'}</th><th className="text-left py-3 px-2 font-medium text-muted-foreground">{lang === 'ar' ? 'البريد الإلكتروني' : 'Email'}</th><th className="text-left py-3 px-2 font-medium text-muted-foreground">{lang === 'ar' ? 'المجموعة' : 'Group'}</th><th className="text-left py-3 px-2 font-medium text-muted-foreground">{lang === 'ar' ? 'الحالة' : 'Status'}</th><th className="text-left py-3 px-2 font-medium text-muted-foreground">{lang === 'ar' ? 'الانضمام' : 'Joined'}</th><th className="text-left py-3 px-2 font-medium text-muted-foreground">{t('admin.actions')}</th></tr></thead><tbody>{filteredUsers.map(userRow => { const status = (userRow as any).accountStatus ?? 'active'; const isFrozen = status === 'frozen'; const isSelf = userRow.id === (user as any).id; return <tr key={userRow.id} className="border-b border-border/50 hover:bg-muted/30"><td className="py-3 px-2 font-medium"><div className="flex items-center gap-2"><UserRound className="h-4 w-4 text-muted-foreground" /><button type="button" data-testid={`admin-user-link-${userRow.id}`} onClick={() => navigate(`/admin/users/${userRow.id}`)} className="truncate text-start font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{userRow.name ?? '—'}</button>{(userRow as any).isDummy ? <Badge className="border-violet-200 bg-violet-50 text-[10px] text-violet-700">{lang === 'ar' ? 'تجريبي / اختباري' : 'Dummy / Test'}</Badge> : (userRow as any).accountSource === 'admin_created' ? <Badge className="border-blue-200 bg-blue-50 text-[10px] text-blue-700">{lang === 'ar' ? 'منشأ بواسطة المشرف' : 'Admin Created'}</Badge> : <Badge className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">{lang === 'ar' ? 'تسجيل ذاتي' : 'Self Registered'}</Badge>}</div><p className="mt-1 text-xs font-normal text-muted-foreground">@{(userRow as any).username ?? '—'} · {(userRow as any).invitationStatus && (userRow as any).invitationStatus !== 'none' ? `${lang === 'ar' ? 'الدعوة' : 'Invite'}: ${formatStatus((userRow as any).invitationStatus, lang)}` : ''}</p></td><td className="py-3 px-2 text-muted-foreground">{userRow.email ?? '—'}</td><td className="py-3 px-2"><Badge variant="secondary">{labelForRole((userRow as any).userRole ?? userRow.role, lang)}</Badge></td><td className="py-3 px-2"><Badge variant={isFrozen ? 'destructive' : 'outline'} title={isFrozen && (userRow as any).frozenReason ? formatFreezeReason((userRow as any).frozenReason, lang) : undefined}>{formatStatus(status, lang)}{isFrozen ? (formatFreezeReason((userRow as any).frozenReason, lang) ? ` · ${formatFreezeReason((userRow as any).frozenReason, lang)}` : '') : ` · ${formatStatus((userRow as any).verified ? 'accepted' : 'pending', lang)}`}</Badge></td><td className="py-3 px-2 text-muted-foreground">{new Date(userRow.createdAt).toLocaleDateString()}</td><td className="py-3 px-2"><div className="flex flex-wrap items-center gap-1"><Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setAuditTarget(userRow)}><History className="h-3 w-3" />{lang === 'ar' ? 'السجل' : 'Audit'}</Button>{(userRow as any).accountSource === 'admin_created' && !(userRow as any).isDummy && <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => resendInvitation.mutate({ userId: userRow.id })} disabled={resendInvitation.isPending}><SendHorizontal className="h-3 w-3" />{lang === 'ar' ? 'إعادة دعوة' : 'Resend Invite'}</Button>}{(userRow as any).isDummy ? <><Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => { setDummyPasswordTarget(userRow); setDummyPassword(''); }}><KeyRound className="h-3 w-3" />{lang === 'ar' ? 'كلمة المرور' : 'Password'}</Button><Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => { setLinkTarget(userRow); setIssuedToken(null); setLinkMinutes(60); }}><LinkIcon className="h-3 w-3" />{lang === 'ar' ? 'رابط دخول' : 'QA link'}</Button><Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setDummyUserActive.mutate({ userId: userRow.id, active: isFrozen })} disabled={setDummyUserActive.isPending}>{isFrozen ? <Power className="h-3 w-3" /> : <Ban className="h-3 w-3" />}{isFrozen ? (lang === 'ar' ? 'تفعيل' : 'Activate') : (lang === 'ar' ? 'تعطيل' : 'Deactivate')}</Button><Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-destructive hover:text-destructive" onClick={() => { if (window.confirm(lang === 'ar' ? 'حذف المستخدم التجريبي؟' : 'Delete this dummy user?')) deleteDummyUser.mutate({ userId: userRow.id }); }} disabled={deleteDummyUser.isPending}><Trash2 className="h-3 w-3" />{lang === 'ar' ? 'حذف' : 'Delete'}</Button></> : <><Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => verifyUser.mutate({ userId: userRow.id, verified: !(userRow as any).verified })} disabled={verifyUser.isPending}><ShieldCheck className="h-3 w-3" />{(userRow as any).verified ? (lang === 'ar' ? 'إلغاء التحقق' : 'Unverify') : (lang === 'ar' ? 'تحقق' : 'Verify')}</Button><Button size="sm" variant={isFrozen ? 'outline' : 'ghost'} className={`h-7 gap-1 text-xs ${isFrozen ? '' : 'text-destructive hover:text-destructive'}`} onClick={() => { setFreezeTarget(userRow); setFreezeReason((userRow as any).accountStatus === 'frozen' ? '' : ''); setFreezeReasonDetail(''); }} disabled={isSelf}>{isFrozen ? <UserCheck className="h-3 w-3" /> : <UserX className="h-3 w-3" />}{isFrozen ? (lang === 'ar' ? 'إلغاء التجميد' : 'Unfreeze') : (lang === 'ar' ? 'تجميد' : 'Freeze')}</Button></>}
</div></td></tr>; })}{filteredUsers.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">{lang === 'ar' ? 'لا يوجد مستخدمون في هذه المجموعة' : 'No users in this group'}</td></tr>}</tbody></table></div></CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="projects">
            <AdminProjects />
          </TabsContent>

          <TabsContent value="products">
            <AdminProducts />
          </TabsContent>

          <TabsContent value="compliance"><Card><CardHeader><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><CardTitle className="flex items-center gap-2"><ClipboardCheck className="w-5 h-5" />{lang === 'ar' ? 'مراجعة المستندات القانونية' : 'Legal document review queue'}</CardTitle><Badge variant="outline">{lang === 'ar' ? 'نمط مؤسسي' : 'Enterprise onboarding'}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{lang === 'ar' ? 'راجع مستندات كل منشأة، اطلب تحديث مستند محدد، وأرسل حالة التسجيل إلى مقدم الطلب.' : 'Review each business profile, request a specific document update, and send registration status updates to the applicant.'}</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><Select value={complianceRoleFilter} onValueChange={setComplianceRoleFilter}><SelectTrigger><SelectValue placeholder={lang === 'ar' ? 'تصفية حسب الفئة' : 'Filter by role'} /></SelectTrigger><SelectContent><SelectItem value="all">{lang === 'ar' ? 'كل الفئات' : 'All roles'}</SelectItem>{ROLE_GROUPS.filter(group => group.key !== 'homeowner' && group.key !== 'admin').map(group => <SelectItem key={group.key} value={group.key}>{lang === 'ar' ? group.ar : group.en}</SelectItem>)}</SelectContent></Select><Select value={complianceStatusFilter} onValueChange={setComplianceStatusFilter}><SelectTrigger><SelectValue placeholder={lang === 'ar' ? 'تصفية حسب الحالة' : 'Filter by status'} /></SelectTrigger><SelectContent><SelectItem value="all">{lang === 'ar' ? 'كل الحالات' : 'All statuses'}</SelectItem><SelectItem value="not_started">{formatComplianceStatus('not_started', lang)}</SelectItem><SelectItem value="under_review">{formatComplianceStatus('under_review', lang)}</SelectItem><SelectItem value="update_required">{formatComplianceStatus('update_required', lang)}</SelectItem><SelectItem value="approved">{formatComplianceStatus('approved', lang)}</SelectItem><SelectItem value="rejected">{formatComplianceStatus('rejected', lang)}</SelectItem></SelectContent></Select></div></CardHeader><CardContent>{complianceLoading ? <div className="py-10 text-center text-muted-foreground"><RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />{t('common.loading')}</div> : filteredComplianceQueue.length === 0 ? <EmptyState text={lang === 'ar' ? 'لا توجد ملفات مطابقة للفلاتر الحالية' : 'No registrations match the current filters'} /> : <div className="space-y-3">{filteredComplianceQueue.map(applicant => { const required = applicant.requirements.filter((item: any) => item.required).length; const approved = applicant.documents.filter((document: any) => document.status === 'approved').length; const previewDocument = applicant.documents.find((document: any) => Boolean(document.url)); const openApplicant = () => { setActiveApplicant(applicant); setComplianceStatus(applicant.onboardingStatus === 'not_started' ? 'under_review' : applicant.onboardingStatus as typeof complianceStatus); setComplianceNote(applicant.onboardingReviewNotes ?? ''); }; return <div role="button" tabIndex={0} key={applicant.id} className="w-full rounded-xl border p-4 text-start transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={openApplicant} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openApplicant(); } }}><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3"><div className="rounded-lg bg-primary/10 p-2 text-primary"><FileSearch className="h-5 w-5" /></div><div className="min-w-0"><p className="truncate font-semibold">{applicant.name || applicant.email || `#${applicant.id}`}</p><p className="text-xs text-muted-foreground">{labelForRole(applicant.userRole, lang)} · {applicant.email || '—'}</p></div></div><div className="flex flex-wrap items-center gap-2"><Badge className={formatComplianceStatus(applicant.onboardingStatus, lang) === (lang === 'ar' ? 'تمت الموافقة' : 'Approved') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}>{formatComplianceStatus(applicant.onboardingStatus, lang)}</Badge><span className="text-xs text-muted-foreground">{approved}/{required} {lang === 'ar' ? 'مطلوب معتمد' : 'required approved'}</span>{previewDocument && <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={event => { event.stopPropagation(); loadDocumentPreview(previewDocument); }}><Eye className="h-3 w-3" />{lang === 'ar' ? 'معاينة' : 'Quick view'}</Button>}<Eye className="h-4 w-4 text-muted-foreground" /></div></div></div>; })}</div>}</CardContent></Card></TabsContent>

          <TabsContent value="analytics"><div className="space-y-6"><AdminCommercialAnalytics includeDummy={includeDummyRegistrations} />{analyticsData.length === 0 ? (
            <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">
              {lang === 'ar' ? 'لا توجد بيانات كافية بعد لعرض الرسوم البيانية. ستظهر هنا فور تسجيل مستخدمين وإنشاء مشاريع.' : 'Not enough activity yet to chart. These graphs fill in as real users register and real projects are created.'}
            </CardContent></Card>
          ) : (<div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><Card><CardHeader><CardTitle className="text-base">{lang === 'ar' ? 'نمو المستخدمين' : 'User Growth'}</CardTitle></CardHeader><CardContent><ResponsiveContainer width="100%" height={220}><LineChart data={analyticsData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /><Tooltip /><Line type="monotone" dataKey="users" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></CardContent></Card><Card><CardHeader><CardTitle className="text-base">{lang === 'ar' ? 'المشاريع المنشأة' : 'Projects Created'}</CardTitle></CardHeader><CardContent><ResponsiveContainer width="100%" height={220}><BarChart data={analyticsData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /><Tooltip /><Bar dataKey="projects" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></CardContent></Card></div>)}</div></TabsContent>

          <TabsContent value="billing"><div className="space-y-6"><AdminVendorBilling /><AdminEnquiryAllowance /></div></TabsContent>

          <TabsContent value="disputes"><div className="space-y-6"><AdminPlatformSearch /><AdminRfqInvestigation /><Card><CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5" />{lang === 'ar' ? 'إدارة النزاعات' : 'Dispute Management'}</CardTitle></CardHeader><CardContent>{disputesLoading ? <div className="py-10 text-center text-muted-foreground"><RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />{t('common.loading')}</div> : disputes.length === 0 ? <EmptyState text={lang === 'ar' ? 'لا توجد نزاعات مسجلة' : 'No disputes have been filed'} /> : <div className="space-y-3">{disputes.map(dispute => <div key={dispute.id} className="rounded-xl border p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="font-semibold text-sm">{dispute.title}</h3><Badge variant={dispute.priority === 'high' ? 'destructive' : 'outline'}>{dispute.priority}</Badge><Badge variant="secondary">{formatStatus(dispute.status, lang)}</Badge></div><p className="text-sm text-muted-foreground line-clamp-2">{dispute.description}</p><p className="mt-2 text-xs text-muted-foreground">{dispute.reporterName || `#${dispute.reporterId}`} {dispute.respondentName ? ` · ${dispute.respondentName}` : ''} · {dispute.type} · {new Date(dispute.createdAt).toLocaleDateString()}</p></div><Button size="sm" variant="outline" className="h-8 shrink-0 gap-1" onClick={() => { setActiveDispute(dispute); setDisputeStatus(dispute.status); setResolutionNotes(dispute.resolutionNotes ?? ''); }}><Eye className="w-3 h-3" />{lang === 'ar' ? 'مراجعة' : 'Review'}</Button></div></div>)}</div>}</CardContent></Card></div></TabsContent>

          {/* Operations. The tab this replaces was "Fraud Detection", which
              rendered a permanent empty state - there is no detector and no
              signals table behind it, so it could never show anything. A
              console tab that can never answer teaches an administrator to
              stop reading the console. Automated fraud detection is recorded
              as NOT IMPLEMENTED rather than mocked up here. */}
          <TabsContent value="operations"><div className="space-y-6"><AdminDataQuality /><AdminOperationalHealth />{can('marketplace.manage') && <AdminSponsorships />}{can('marketplace.manage') && <AdminFeaturedProviders />}{can('marketplace.manage') && <AdminFeaturedProducts />}</div></TabsContent>

          <TabsContent value="settings"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Settings className="w-5 h-5" />{lang === 'ar' ? 'إعدادات المنصة' : 'Platform Settings'}</CardTitle></CardHeader><CardContent><div className="grid gap-4 md:grid-cols-2">{SETTING_DEFINITIONS.map(definition => { const value = settingDrafts[definition.key] ?? ''; const isBoolean = definition.type === 'boolean'; return <div key={definition.key} className="rounded-xl border p-4"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">{lang === 'ar' ? definition.ar : definition.en}</p><p className="mt-1 text-xs text-muted-foreground">{definition.key}</p></div>{isBoolean ? <Switch checked={value === 'true'} onCheckedChange={checked => { const next = checked ? 'true' : 'false'; setSettingDrafts(draft => ({ ...draft, [definition.key]: next })); updateSetting.mutate({ key: definition.key, value: next }); }} disabled={updateSetting.isPending} /> : <div className="flex items-center gap-2"><Input className="h-8 w-28" type={definition.type === 'number' ? 'number' : 'text'} value={value} onChange={event => setSettingDrafts(draft => ({ ...draft, [definition.key]: event.target.value }))} /><Button size="sm" className="h-8 gap-1" onClick={() => updateSetting.mutate({ key: definition.key, value })} disabled={updateSetting.isPending}><Save className="h-3 w-3" />{lang === 'ar' ? 'حفظ' : 'Save'}</Button></div>}</div></div>; })}</div></CardContent></Card></TabsContent>
        </Tabs>
      </div>

      <Dialog open={Boolean(freezeTarget)} onOpenChange={open => { if (!open) { setFreezeTarget(null); setFreezeReason(''); setFreezeReasonDetail(''); } }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{(freezeTarget as any)?.accountStatus === 'frozen' ? (lang === 'ar' ? 'إلغاء تجميد المستخدم' : 'Unfreeze User') : (lang === 'ar' ? 'تجميد المستخدم' : 'Freeze User')}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{(freezeTarget as any)?.name || (freezeTarget as any)?.email}</p>{(freezeTarget as any)?.accountStatus !== 'frozen' && <div className="space-y-2"><label className="text-sm font-medium">{lang === 'ar' ? 'سبب التجميد' : 'Freeze reason'}</label><Select value={freezeReason} onValueChange={value => { setFreezeReason(value); if (value !== 'other') setFreezeReasonDetail(''); }}><SelectTrigger aria-label={lang === 'ar' ? 'سبب التجميد' : 'Freeze reason'}><SelectValue placeholder={lang === 'ar' ? 'اختر سبباً' : 'Select a reason'} /></SelectTrigger><SelectContent>{FREEZE_REASONS.map(reason => <SelectItem key={reason.value} value={reason.value}>{lang === 'ar' ? reason.ar : reason.en}</SelectItem>)}</SelectContent></Select>{freezeReason === 'other' && <Textarea rows={3} maxLength={500} placeholder={lang === 'ar' ? 'اكتب سبب التجميد' : 'Describe the freeze reason'} value={freezeReasonDetail} onChange={event => setFreezeReasonDetail(event.target.value)} />}</div>}<DialogFooter><Button variant="outline" onClick={() => { setFreezeTarget(null); setFreezeReason(''); setFreezeReasonDetail(''); }}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</Button><Button variant={(freezeTarget as any)?.accountStatus === 'frozen' ? 'default' : 'destructive'} onClick={handleFreezeSubmit} disabled={setUserFrozen.isPending || ((freezeTarget as any)?.accountStatus !== 'frozen' && (!freezeReason || (freezeReason === 'other' && !freezeReasonDetail.trim())))}>{setUserFrozen.isPending ? t('common.loading') : (lang === 'ar' ? 'تأكيد' : 'Confirm')}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(activeDispute)} onOpenChange={open => !open && setActiveDispute(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{activeDispute?.title}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{activeDispute?.description}</p><Select value={disputeStatus} onValueChange={value => setDisputeStatus(value as typeof disputeStatus)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">{formatStatus('open', lang)}</SelectItem><SelectItem value="investigating">{formatStatus('investigating', lang)}</SelectItem><SelectItem value="resolved">{formatStatus('resolved', lang)}</SelectItem><SelectItem value="rejected">{formatStatus('rejected', lang)}</SelectItem></SelectContent></Select><Textarea rows={4} placeholder={lang === 'ar' ? 'ملاحظات الحل' : 'Resolution notes'} value={resolutionNotes} onChange={event => setResolutionNotes(event.target.value)} /><DialogFooter><Button variant="outline" onClick={() => setActiveDispute(null)}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</Button><Button onClick={() => updateDispute.mutate({ disputeId: activeDispute.id, status: disputeStatus, resolutionNotes: resolutionNotes || undefined })} disabled={updateDispute.isPending}>{updateDispute.isPending ? t('common.loading') : (lang === 'ar' ? 'حفظ التحديث' : 'Save Update')}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(bulkDecision)} onOpenChange={open => { if (!open && !bulkUpdateApplicantStatus.isPending) { setBulkDecision(null); setBulkRejectionReason(''); } }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />{bulkDecision === 'approved' ? (lang === 'ar' ? 'تأكيد الاعتماد الجماعي' : 'Confirm bulk approval') : (lang === 'ar' ? 'تأكيد الرفض الجماعي' : 'Confirm bulk rejection')}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{bulkDecision === 'approved' ? (lang === 'ar' ? `سيتم اعتماد ${selectedRegistrationIds.length} طلبات تسجيل.` : `${selectedRegistrationIds.length} registration applications will be approved.`) : (lang === 'ar' ? `سيتم رفض ${selectedRegistrationIds.length} طلبات تسجيل. يمكنك إضافة سبب اختياري.` : `${selectedRegistrationIds.length} registration applications will be rejected. You may add an optional reason.`)}</p>{bulkDecision === 'rejected' && <Textarea rows={4} maxLength={2000} placeholder={lang === 'ar' ? 'سبب الرفض (اختياري)' : 'Rejection reason (optional)'} value={bulkRejectionReason} onChange={event => setBulkRejectionReason(event.target.value)} />}<DialogFooter><Button type="button" variant="outline" onClick={() => { setBulkDecision(null); setBulkRejectionReason(''); }} disabled={bulkUpdateApplicantStatus.isPending}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</Button><Button type="button" variant={bulkDecision === 'rejected' ? 'destructive' : 'default'} onClick={submitBulkDecision} disabled={bulkUpdateApplicantStatus.isPending || !selectedRegistrationIds.length}>{bulkUpdateApplicantStatus.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : bulkDecision === 'rejected' ? (lang === 'ar' ? 'تأكيد الرفض' : 'Confirm rejection') : (lang === 'ar' ? 'تأكيد الاعتماد' : 'Confirm approval')}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(createAccountType)} onOpenChange={open => !open && !createUser.isPending && !createDummyUser.isPending && setCreateAccountType(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" />{createAccountType === 'dummy' ? (lang === 'ar' ? 'إنشاء مستخدم تجريبي' : 'Create dummy user') : (lang === 'ar' ? 'إنشاء حساب بواسطة المشرف' : 'Create admin account')}</DialogTitle></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); const role = accountDraft.userRole as 'homeowner' | 'contractor' | 'engineer' | 'architect' | 'supplier' | 'project_manager'; if (createAccountType === 'dummy') createDummyUser.mutate({ name: accountDraft.name || undefined, username: accountDraft.username || undefined, userRole: role, note: accountDraft.note || undefined, password: accountDraft.password || undefined }); else createUser.mutate({ name: accountDraft.name, username: accountDraft.username, email: accountDraft.email, phone: accountDraft.phone || undefined, userRole: role, note: accountDraft.note || undefined }); }}><div className="grid gap-3 sm:grid-cols-2"><Input required placeholder={lang === 'ar' ? 'الاسم الكامل' : 'Full name'} value={accountDraft.name} onChange={event => setAccountDraft(draft => ({ ...draft, name: event.target.value }))} /><Input required={createAccountType === 'admin'} placeholder={lang === 'ar' ? 'اسم المستخدم' : 'Username'} value={accountDraft.username} onChange={event => setAccountDraft(draft => ({ ...draft, username: event.target.value }))} />{createAccountType === 'admin' && <><Input required type="email" placeholder={lang === 'ar' ? 'البريد الإلكتروني' : 'Email'} value={accountDraft.email} onChange={event => setAccountDraft(draft => ({ ...draft, email: event.target.value }))} /><Input placeholder={lang === 'ar' ? 'الهاتف (اختياري)' : 'Phone (optional)'} value={accountDraft.phone} onChange={event => setAccountDraft(draft => ({ ...draft, phone: event.target.value }))} /></>}</div><Select value={accountDraft.userRole} onValueChange={value => setAccountDraft(draft => ({ ...draft, userRole: value }))}><SelectTrigger><SelectValue placeholder={lang === 'ar' ? 'الفئة المهنية' : 'Role / professional category'} /></SelectTrigger><SelectContent>{/* 'admin' is offered by NEITHER path. Administrators are created in Admin Management, which is Super Admin only; the server rejects it here too. */}{ROLE_GROUPS.filter(group => group.key !== 'admin').map(group => <SelectItem key={group.key} value={group.key}>{lang === 'ar' ? group.ar : group.en}</SelectItem>)}</SelectContent></Select>{createAccountType === 'dummy' && <div className="space-y-1.5"><label className="text-sm font-medium">{lang === 'ar' ? 'كلمة المرور (اختياري)' : 'Password (optional)'}</label><Input type="password" minLength={8} maxLength={128} autoComplete="new-password" placeholder={lang === 'ar' ? '8 أحرف على الأقل' : 'At least 8 characters'} value={accountDraft.password} onChange={event => setAccountDraft(draft => ({ ...draft, password: event.target.value }))} /><p className="text-xs text-muted-foreground">{lang === 'ar' ? 'تُحفظ كلمة المرور بشكل مشفر ويمكن تغييرها لاحقاً من جدول المستخدمين.' : 'The password is securely hashed and can be changed later from the user table.'}</p></div>}<Textarea rows={3} placeholder={createAccountType === 'dummy' ? (lang === 'ar' ? 'ملاحظة الاختبار' : 'Testing note') : (lang === 'ar' ? 'ملاحظة إنشاء الحساب' : 'Account creation note')} value={accountDraft.note} onChange={event => setAccountDraft(draft => ({ ...draft, note: event.target.value }))} /><p className="text-xs text-muted-foreground">{createAccountType === 'dummy' ? (lang === 'ar' ? 'سيتم تمييز الحساب كتجريبي وتعطيله افتراضياً ولن يظهر في مؤشرات الأعمال.' : 'This account is marked as test data, disabled by default, and excluded from business metrics.') : (lang === 'ar' ? 'سيتمكن المستخدم من ربط هذا الحساب بتسجيل الدخول الموحد باستخدام البريد نفسه.' : 'The user can claim this account through OAuth using the same email.')}</p><DialogFooter><Button type="button" variant="outline" onClick={() => setCreateAccountType(null)}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</Button><Button type="submit" disabled={createUser.isPending || createDummyUser.isPending}>{createUser.isPending || createDummyUser.isPending ? t('common.loading') : (lang === 'ar' ? 'إنشاء' : 'Create')}</Button></DialogFooter></form></DialogContent></Dialog>
      {/* QA sign-in links. The raw token is displayed ONCE, here, and never
          again - the server stores only its sha256, so it genuinely cannot be
          shown a second time. That is stated plainly rather than left for an
          admin to discover by reopening this dialog. */}
      <Dialog open={Boolean(linkTarget)} onOpenChange={open => { if (!open) { setLinkTarget(null); setIssuedToken(null); } }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle className="flex items-center gap-2"><LinkIcon className="h-5 w-5 text-primary" />{lang === 'ar' ? 'رابط دخول لحساب اختباري' : 'QA sign-in link'}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{linkTarget?.name || linkTarget?.username}</p>
        {!testLoginEnabled && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">{lang === 'ar' ? 'تسجيل دخول الحسابات الاختبارية غير مفعّل في هذه البيئة. سيتم رفض أي رابط يتم إنشاؤه هنا. هذه هي الحماية المقصودة في بيئة الإنتاج.' : 'Test-user sign-in is switched off in this environment, so any link issued here will be refused when redeemed. That is the intended behaviour in production.'}</div>}
        {issuedToken ? <div className="space-y-2">
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3"><p className="text-xs font-semibold text-emerald-900">{lang === 'ar' ? 'انسخ هذا الرابط الآن - لن يُعرض مرة أخرى' : 'Copy this link now - it will never be shown again'}</p><code className="mt-2 block break-all rounded bg-white/80 p-2 text-[11px]">{`${window.location.origin}/auth?qaToken=${issuedToken}`}</code></div>
          <Button type="button" size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/auth?qaToken=${issuedToken}`); toast.success(lang === 'ar' ? 'تم النسخ' : 'Copied'); }}>{lang === 'ar' ? 'نسخ الرابط' : 'Copy link'}</Button>
          <p className="text-xs text-muted-foreground">{lang === 'ar' ? 'صالح لمرة واحدة فقط، وينتهي تلقائيًا، ويمكن إبطاله في أي وقت.' : 'Single use, expires automatically, and can be revoked at any time.'}</p>
        </div> : <div className="flex items-end gap-2">
          <div className="space-y-1"><label className="text-sm font-medium">{lang === 'ar' ? 'مدة الصلاحية (دقائق)' : 'Valid for (minutes)'}</label><Input type="number" min={1} max={1440} value={linkMinutes} onChange={event => setLinkMinutes(Math.max(1, Math.min(1440, Number(event.target.value) || 60)))} className="w-32" /></div>
          <Button type="button" onClick={() => linkTarget && issueTestLoginLink.mutate({ userId: linkTarget.id, expiresInMinutes: linkMinutes })} disabled={issueTestLoginLink.isPending}>{issueTestLoginLink.isPending ? t('common.loading') : (lang === 'ar' ? 'إنشاء رابط' : 'Issue link')}</Button>
        </div>}
        <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-xs"><thead><tr className="border-b border-border bg-muted/40"><th className="p-2 text-left font-medium">{lang === 'ar' ? 'أُنشئ' : 'Issued'}</th><th className="p-2 text-left font-medium">{lang === 'ar' ? 'ينتهي' : 'Expires'}</th><th className="p-2 text-left font-medium">{lang === 'ar' ? 'الحالة' : 'State'}</th><th className="p-2" /></tr></thead>
          <tbody>{(linksQuery.data ?? []).map((row: any) => { const spent = Boolean(row.usedAt); const dead = Boolean(row.revokedAt); const expired = new Date(row.expiresAt).getTime() <= Date.now(); const live = !spent && !dead && !expired; return <tr key={row.id} className="border-b border-border/50"><td className="p-2">{new Date(row.createdAt).toLocaleString()}</td><td className="p-2">{new Date(row.expiresAt).toLocaleString()}</td><td className="p-2">{dead ? (lang === 'ar' ? 'مُبطل' : 'Revoked') : spent ? (lang === 'ar' ? 'مُستخدم' : 'Used') : expired ? (lang === 'ar' ? 'منتهٍ' : 'Expired') : (lang === 'ar' ? 'صالح' : 'Live')}</td><td className="p-2 text-right">{live && <Button size="sm" variant="ghost" className="h-6 text-xs text-destructive hover:text-destructive" onClick={() => revokeTestLoginLink.mutate({ tokenId: row.id })} disabled={revokeTestLoginLink.isPending}>{lang === 'ar' ? 'إبطال' : 'Revoke'}</Button>}</td></tr>; })}
          {(linksQuery.data ?? []).length === 0 && <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">{lang === 'ar' ? 'لا توجد روابط' : 'No links issued yet'}</td></tr>}</tbody></table>
        </div>
      </DialogContent></Dialog>

      <Dialog open={Boolean(dummyPasswordTarget)} onOpenChange={open => { if (!open && !setDummyUserPassword.isPending) { setDummyPasswordTarget(null); setDummyPassword(''); } }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" />{lang === 'ar' ? 'تعيين كلمة مرور المستخدم التجريبي' : 'Set dummy-user password'}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{dummyPasswordTarget?.name || dummyPasswordTarget?.username || dummyPasswordTarget?.email}</p><div className="space-y-2"><label className="text-sm font-medium">{lang === 'ar' ? 'كلمة المرور الجديدة' : 'New password'}</label><Input type="password" minLength={8} maxLength={128} autoComplete="new-password" placeholder={lang === 'ar' ? '8 أحرف على الأقل' : 'At least 8 characters'} value={dummyPassword} onChange={event => setDummyPassword(event.target.value)} /><p className="text-xs text-muted-foreground">{lang === 'ar' ? 'يستطيع المشرف تغيير كلمة المرور في أي وقت. لا يتم عرض كلمة المرور الحالية.' : 'Administrators can change this password at any time. The current password is never displayed.'}</p></div><DialogFooter><Button type="button" variant="outline" onClick={() => { setDummyPasswordTarget(null); setDummyPassword(''); }} disabled={setDummyUserPassword.isPending}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</Button><Button type="button" onClick={() => dummyPasswordTarget && setDummyUserPassword.mutate({ userId: dummyPasswordTarget.id, password: dummyPassword })} disabled={setDummyUserPassword.isPending || dummyPassword.length < 8}>{setDummyUserPassword.isPending ? t('common.loading') : (lang === 'ar' ? 'حفظ كلمة المرور' : 'Save password')}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(auditTarget)} onOpenChange={open => !open && setAuditTarget(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle className="flex items-center gap-2"><History className="h-5 w-5 text-primary" />{lang === 'ar' ? 'سجل الحساب' : 'Account audit trail'}</DialogTitle></DialogHeader><div><p className="font-medium">{auditTarget?.name || auditTarget?.email || `#${auditTarget?.id}`}</p><p className="text-xs text-muted-foreground">@{auditTarget?.username || '—'} · {auditTarget?.email || '—'}</p></div><div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border p-3">{auditEvents.length ? auditEvents.map(event => <div key={event.id} className="border-b pb-2 last:border-0 last:pb-0"><div className="flex flex-wrap items-center justify-between gap-2"><Badge variant="secondary">{event.action}</Badge><span className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</span></div>{event.note && <p className="mt-1 text-xs text-muted-foreground">{event.note}</p>}</div>) : <p className="text-sm text-muted-foreground">{lang === 'ar' ? 'لا توجد أحداث مسجلة.' : 'No audit events recorded.'}</p>}</div><DialogFooter><Button variant="outline" onClick={() => setAuditTarget(null)}>{lang === 'ar' ? 'إغلاق' : 'Close'}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(activeDocument)} onOpenChange={open => !open && closeDocumentPreview()}><DialogContent className="max-w-4xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-primary" />{activeDocument?.fileName || (lang === 'ar' ? 'معاينة المستند' : 'Document preview')}</DialogTitle></DialogHeader><div className="flex min-h-[360px] items-center justify-center overflow-hidden rounded-xl border bg-muted/20 p-3">{documentPreviewStatus === 'loading' && <div className="text-center text-muted-foreground"><Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" /><p>{lang === 'ar' ? 'جاري تحميل المستند…' : 'Loading document…'}</p></div>}{documentPreviewStatus === 'error' && <div className="max-w-sm text-center"><AlertTriangle className="mx-auto mb-3 h-8 w-8 text-rose-500" /><p className="text-sm font-medium">{lang === 'ar' ? 'تعذر تحميل المستند' : 'Document could not be loaded'}</p><p className="mt-1 text-xs text-muted-foreground">{documentPreviewError}</p><Button type="button" size="sm" className="mt-4 gap-2" onClick={() => activeDocument && loadDocumentPreview(activeDocument)}><RefreshCw className="h-3.5 w-3.5" />{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</Button></div>}{documentPreviewStatus === 'ready' && documentPreviewSource && (activeDocument?.mimeType?.startsWith('image/') ? <img src={documentPreviewSource} alt={activeDocument.fileName} className="max-h-[65vh] max-w-full rounded-lg object-contain" onError={() => { setDocumentPreviewStatus('error'); setDocumentPreviewError(lang === 'ar' ? 'تعذر عرض صورة المستند.' : 'The document image could not be displayed.'); }} /> : <iframe src={documentPreviewSource} title={activeDocument.fileName} className="h-[65vh] w-full rounded-lg bg-background" onLoad={() => setDocumentPreviewStatus('ready')} />)}</div><DialogFooter><Button variant="outline" onClick={closeDocumentPreview}>{lang === 'ar' ? 'إغلاق' : 'Close'}</Button>{activeDocument?.url && <a href={activeDocument.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90">{lang === 'ar' ? 'فتح في تبويب جديد' : 'Open in new tab'}</a>}</DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(activeApplicant)} onOpenChange={open => !open && setActiveApplicant(null)}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-primary" />{activeApplicant?.name || activeApplicant?.email || (lang === 'ar' ? 'ملف التسجيل' : 'Registration profile')}</DialogTitle></DialogHeader><div className="space-y-5">{complianceDetail ? <><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-4"><div><p className="text-sm text-muted-foreground">{labelForRole(complianceDetail.applicant.userRole, lang)} · {complianceDetail.applicant.email || '—'}</p><p className="mt-1 text-lg font-semibold">{formatComplianceStatus(complianceDetail.applicant.onboardingStatus, lang)}</p></div><Badge className={complianceDetail.applicant.onboardingStatus === 'approved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}>{formatComplianceStatus(complianceDetail.applicant.onboardingStatus, lang)}</Badge></div><div className="space-y-3">{complianceDetail.requirements.map(requirement => { const document = complianceDetail.documents.find(item => item.documentType === requirement.type); return <div key={requirement.type} className="rounded-xl border p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{lang === 'ar' ? requirement.nameAr : requirement.name}</p>{requirement.required ? <Badge variant="outline" className="text-[10px]">{lang === 'ar' ? 'مطلوب' : 'Required'}</Badge> : <Badge variant="outline" className="text-[10px]">{lang === 'ar' ? 'اختياري' : 'Optional'}</Badge>}</div>{document ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><Badge className={document.status === 'approved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : document.status === 'rejected' || document.status === 'update_required' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-700'}>{formatComplianceStatus(document.status, lang)}</Badge><button type="button" className="inline-flex items-center gap-1 underline underline-offset-2" onClick={event => { event.stopPropagation(); loadDocumentPreview(document); }}><Eye className="h-3 w-3" />{document.fileName}</button><span className="text-muted-foreground">{(document.size / (1024 * 1024)).toFixed(1)} MB</span></div> : <p className="mt-2 text-xs text-muted-foreground">{lang === 'ar' ? 'لم يتم رفع المستند بعد' : 'Document not submitted yet'}</p>}{document?.applicantNote && <p className="mt-2 text-xs text-muted-foreground">{lang === 'ar' ? 'ملاحظة مقدم الطلب: ' : 'Applicant note: '}{document.applicantNote}</p>}{document?.reviewerNote && <p className="mt-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{lang === 'ar' ? 'ملاحظة المراجع: ' : 'Reviewer note: '}{document.reviewerNote}</p>}{complianceDetail.history?.filter(item => item.documentType === requirement.type).length > 1 && <div className="mt-3 rounded-lg bg-muted/30 p-3"><p className="mb-2 text-xs font-semibold">{lang === 'ar' ? 'سجل إعادة الرفع' : 'Re-upload history'}</p>{complianceDetail.history.filter(item => item.documentType === requirement.type).slice(0, 5).map(item => <div key={item.id} className="border-t py-2 text-xs first:border-0 first:pt-0"><div className="flex flex-wrap items-center justify-between gap-2"><span>{item.fileName}</span><span className="text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span></div>{item.applicantNote && <p className="mt-1 text-muted-foreground">{item.applicantNote}</p>}</div>)}</div>}</div>{document && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" className="gap-1 text-emerald-700" onClick={() => reviewComplianceDocument.mutate({ documentId: document.id, status: 'approved' })} disabled={reviewComplianceDocument.isPending}><CheckCircle2 className="h-3 w-3" />{lang === 'ar' ? 'اعتماد' : 'Approve'}</Button><Button size="sm" variant="outline" className="gap-1" onClick={() => reviewComplianceDocument.mutate({ documentId: document.id, status: 'update_required', reviewerNote: complianceNote || undefined })} disabled={reviewComplianceDocument.isPending}><RotateCcw className="h-3 w-3" />{lang === 'ar' ? 'طلب تحديث' : 'Request update'}</Button><Button size="sm" variant="outline" className="gap-1 text-rose-700" onClick={() => reviewComplianceDocument.mutate({ documentId: document.id, status: 'rejected', reviewerNote: complianceNote || undefined })} disabled={reviewComplianceDocument.isPending}><XCircle className="h-3 w-3" />{lang === 'ar' ? 'رفض' : 'Reject'}</Button></div>}</div></div>; })}</div><div className="rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="mb-3 text-sm font-semibold">{lang === 'ar' ? 'إرسال تحديث حالة التسجيل' : 'Send registration status update'}</p><div className="grid gap-3 md:grid-cols-[0.7fr_1.3fr]"><Select value={complianceStatus} onValueChange={value => setComplianceStatus(value as typeof complianceStatus)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="under_review">{formatComplianceStatus('under_review', lang)}</SelectItem><SelectItem value="approved">{formatComplianceStatus('approved', lang)}</SelectItem><SelectItem value="update_required">{formatComplianceStatus('update_required', lang)}</SelectItem><SelectItem value="rejected">{formatComplianceStatus('rejected', lang)}</SelectItem></SelectContent></Select><Textarea rows={2} placeholder={lang === 'ar' ? 'اكتب رسالة لمقدم الطلب أو ما الذي يجب تحديثه…' : 'Tell the applicant what to update or clarify…'} value={complianceNote} onChange={event => setComplianceNote(event.target.value)} /></div><div className="mt-3 flex justify-end"><Button onClick={() => updateApplicantStatus.mutate({ userId: complianceDetail.applicant.id, status: complianceStatus, note: complianceNote || undefined })} disabled={updateApplicantStatus.isPending} className="gap-2"><SendHorizontal className="h-4 w-4" />{updateApplicantStatus.isPending ? t('common.loading') : (lang === 'ar' ? 'إرسال التحديث' : 'Send update')}</Button></div></div><div><p className="mb-2 text-sm font-semibold">{lang === 'ar' ? 'سجل المراجعة' : 'Audit timeline'}</p><div className="space-y-2">{complianceDetail.events.map(event => <div key={event.id} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-xs"><span className="font-medium">{event.action.replaceAll('_', ' ')} · {event.status || '—'}</span><span className="text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</span>{event.note && <p className="basis-full text-muted-foreground">{event.note}</p>}</div>)}</div></div></> : <div className="py-10 text-center text-muted-foreground"><RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />{t('common.loading')}</div>}</div></DialogContent></Dialog>
    </DashboardLayout>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">{text}</div>;
}
