import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import { useAuth } from '@/_core/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PROVIDER_ROLES } from '@shared/roleMatrix';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { trpc } from '@/lib/trpc';
import { useLocation, useParams } from 'wouter';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  History,
  Mail,
  MapPin,
  Phone,
  SendHorizontal,
  ShieldCheck,
  UserCheck,
  UserRound,
  UserX,
} from 'lucide-react';

const ROLE_LABELS: Record<string, [string, string]> = {
  homeowner: ['Homeowner', 'صاحب منزل'],
  contractor: ['Contractor', 'مقاول'],
  engineer: ['Engineer', 'مهندس'],
  architect: ['Architect', 'مهندس معماري'],
  supplier: ['Supplier', 'مورّد'],
  project_manager: ['Project Manager', 'مدير مشروع'],
  admin: ['Administrator', 'مشرف'],
};

const FREEZE_REASONS = [
  { value: 'policy_violation', en: 'Policy violation', ar: 'مخالفة السياسة' },
  { value: 'suspicious_activity', en: 'Suspicious activity', ar: 'نشاط مشبوه' },
  { value: 'compliance_review', en: 'Compliance review', ar: 'مراجعة الامتثال' },
  { value: 'incomplete_profile', en: 'Incomplete or invalid profile', ar: 'ملف شخصي غير مكتمل أو غير صالح' },
  { value: 'user_requested', en: 'Temporary hold requested by user', ar: 'تعليق مؤقت بطلب من المستخدم' },
  { value: 'other', en: 'Other', ar: 'سبب آخر' },
] as const;

function roleLabel(role: string | null | undefined, lang: 'en' | 'ar') {
  const found = role ? ROLE_LABELS[role] : undefined;
  return found ? found[lang === 'ar' ? 1 : 0] : role || '—';
}

function statusLabel(status: string | null | undefined, lang: 'en' | 'ar') {
  if (status === 'frozen') return lang === 'ar' ? 'معلّق' : 'Suspended';
  if (status === 'active') return lang === 'ar' ? 'نشط' : 'Active';
  return status || '—';
}

function invitationLabel(status: string | null | undefined, lang: 'en' | 'ar') {
  const labels: Record<string, [string, string]> = {
    none: ['None', 'لا توجد'],
    invitation_sent: ['Invitation Sent', 'تم إرسال الدعوة'],
    pending_setup: ['Pending Setup', 'في انتظار الإعداد'],
    password_set: ['Account Activated', 'تم تفعيل الحساب'],
    expired: ['Expired', 'منتهية'],
  };
  return status && labels[status] ? labels[status][lang === 'ar' ? 1 : 0] : status || '—';
}

export default function AdminUserDetail() {
  const { t, lang, dir } = useLanguage();
  const { user } = useAuth();
  const params = useParams();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const userId = Number(params.id);
  const validId = Number.isInteger(userId) && userId > 0;

  const { data: adminMe } = trpc.admin.me.useQuery(undefined, { retry: false });
  const can = (permission: string) => adminMe?.permissions.includes(permission as never) ?? false;
  /*
   * "User not found." IS A CLAIM ABOUT A PERSON, and an outage is not evidence
   * for it. The same defect as AdminProjectDetail, on the record an
   * administrator is most likely to be acting on when they reach for it.
   */
  const { data: detail, isLoading, isError: detailFailed, refetch: refetchDetail } = trpc.admin.userDetail.useQuery(
    { userId },
    { enabled: validId && can('users.read') },
  );
  // Paged: this used to receive the most recent 100 events and no total, so a
  // long-lived account's early history was silently absent.
  const { data: auditPageData } = trpc.admin.accountAudit.useQuery(
    { userId, pageSize: 50 },
    { enabled: validId && can('users.read') },
  );
  const auditEvents = auditPageData?.rows ?? [];
  const auditEventsTotal = auditPageData?.total ?? 0;
  /**
   * ONE ACCOUNT, ACROSS THE WHOLE PRODUCT.
   *
   * Counts and states per domain with the canonical link to each - never the
   * contents of another domain's records. See server/adminUser360.ts for why
   * the line is there. `retry: false` so an outage is reported as an outage
   * rather than retried into a page of zeros.
   */
  const {
    data: snapshot, isLoading: snapshotLoading, isError: snapshotFailed,
  } = trpc.admin.userSnapshot.useQuery(
    { userId },
    { enabled: validId && can('users.read'), retry: false },
  );
  const { data: userNotes = [] } = trpc.admin.userNotes.useQuery(
    { userId },
    { enabled: validId && can('users.read') },
  );
  /*
   * WHAT ACTUALLY CHANGED, old value -> new value. The account audit trail
   * above records that a field was edited and deliberately carries field NAMES
   * and never values, because it is read by a wider audience. This is the
   * narrower disclosure - `audit.recordHistory` authorizes it separately, to
   * the record's own owner and to any administrator - and it had no caller, so
   * the values BuildHub was recording could not be read by anyone.
   */
  const { data: fieldHistory = [] } = trpc.audit.recordHistory.useQuery(
    { subjectType: 'user', subjectId: userId, limit: 50 },
    { enabled: validId && can('users.read'), retry: false },
  );
  /*
   * WHY THIS VENDOR IS OR IS NOT BEING MATCHED to enquiries. The diagnostics
   * existed and nothing rendered them, so "why am I getting no enquiries?" -
   * the question a vendor actually asks support - had no answer on any screen.
   */
  const isProvider = Boolean(detail && (PROVIDER_ROLES as readonly string[]).includes(String((detail as any).userRole)));
  const { data: targeting } = trpc.admin.vendorTargeting.useQuery(
    { userId },
    { enabled: validId && can('marketplace.manage') && isProvider, retry: false },
  );

  const [freezeOpen, setFreezeOpen] = useState(false);
  const [freezeReason, setFreezeReason] = useState('');
  const [freezeReasonDetail, setFreezeReasonDetail] = useState('');
  const [editForm, setEditForm] = useState({ name: '', username: '', email: '', phone: '', userRole: 'homeowner' });
  const [noteDraft, setNoteDraft] = useState('');

  useEffect(() => {
    if (!detail) return;
    setEditForm({
      name: detail.name || '',
      username: detail.username || '',
      email: detail.email || '',
      phone: detail.phone || '',
      userRole: detail.userRole || 'homeowner',
    });
  }, [detail]);

  const verifyUser = trpc.admin.verifyUser.useMutation({
    onSuccess: () => {
      toast.success(lang === 'ar' ? 'تم تحديث حالة التحقق' : 'Verification status updated');
      utils.admin.userDetail.invalidate({ userId });
      utils.admin.users.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const setUserFrozen = trpc.admin.setUserFrozen.useMutation({
    onSuccess: (_data, variables) => {
      toast.success(lang === 'ar'
        ? (variables.frozen ? 'تم تعليق المستخدم' : 'تم إعادة تفعيل المستخدم')
        : (variables.frozen ? 'User suspended' : 'User reactivated'));
      setFreezeOpen(false);
      setFreezeReason('');
      setFreezeReasonDetail('');
      utils.admin.userDetail.invalidate({ userId });
      utils.admin.users.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const resendInvitation = trpc.admin.resendInvitation.useMutation({
    onSuccess: data => {
      toast.success(lang === 'ar' ? 'تم إعادة إرسال دعوة إعداد كلمة المرور' : 'Password setup invitation resent');
      if (data.invitationLink) {
        navigator.clipboard?.writeText?.(window.location.origin + data.invitationLink);
        toast.info(lang === 'ar' ? 'تم نسخ رابط الدعوة إلى الحافظة' : 'Invitation link copied to clipboard', { duration: 6000 });
      }
      utils.admin.userDetail.invalidate({ userId });
      utils.admin.users.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const updateUser = trpc.admin.updateUser.useMutation({
    onSuccess: () => {
      toast.success(lang === 'ar' ? 'تم حفظ بيانات المستخدم' : 'User details saved');
      utils.admin.userDetail.invalidate({ userId });
      utils.admin.users.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const addUserNote = trpc.admin.addUserNote.useMutation({
    onSuccess: () => {
      toast.success(lang === 'ar' ? 'تمت إضافة الملاحظة' : 'Note added');
      setNoteDraft('');
      utils.admin.userNotes.invalidate({ userId });
    },
    onError: error => toast.error(error.message),
  });

  const isFrozen = detail?.accountStatus === 'frozen';
  const isSelf = user?.id === userId;
  const canManageUsers = can('users.manage');
  const canResend = canManageUsers && detail?.accountSource === 'admin_created' && !detail?.isDummy && detail?.invitationStatus !== 'password_set';
  const submitFreeze = () => {
    if (!detail) return;
    if (isFrozen) {
      setUserFrozen.mutate({ userId, frozen: false });
      return;
    }
    if (!freezeReason) return;
    setUserFrozen.mutate({
      userId,
      frozen: true,
      reason: freezeReason === 'other' && freezeReasonDetail.trim() ? freezeReasonDetail.trim() : freezeReason,
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6" dir={dir}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => navigate('/admin/users')}>
              <ArrowLeft className="h-4 w-4" />
              {lang === 'ar' ? 'إدارة المستخدمين' : 'User Management'}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : detailFailed ? (
          <Card><CardContent className="py-8">
            <LoadFailed {...loadFailedCopy(lang === 'ar')} onRetry={() => void refetchDetail()} />
          </CardContent></Card>
        ) : !detail ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              {lang === 'ar' ? 'لم يتم العثور على المستخدم.' : 'User not found.'}
            </CardContent>
          </Card>
        ) : (
          <>
            <Card data-testid="admin-user-detail">
              <CardHeader>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-primary/10 p-3 text-primary">
                      <UserRound className="h-6 w-6" />
                    </div>
                    <div>
                      <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                        {detail.name || detail.email || `#${detail.id}`}
                        {detail.isDummy && <Badge className="border-violet-200 bg-violet-50 text-violet-700">{lang === 'ar' ? 'تجريبي / اختباري' : 'Dummy / Test'}</Badge>}
                      </CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">@{detail.username || '—'} · {roleLabel(detail.userRole, lang)}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canManageUsers && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5"
                        onClick={() => verifyUser.mutate({ userId, verified: !detail.verified })}
                        disabled={verifyUser.isPending}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {detail.verified ? (lang === 'ar' ? 'إلغاء التحقق' : 'Unverify') : (lang === 'ar' ? 'تحقق' : 'Verify')}
                      </Button>
                    )}
                    {canManageUsers && (
                      <Button
                        size="sm"
                        variant={isFrozen ? 'outline' : 'ghost'}
                        className={`h-8 gap-1.5 ${isFrozen ? '' : 'text-destructive hover:text-destructive'}`}
                        onClick={() => {
                          setFreezeReason('');
                          setFreezeReasonDetail('');
                          setFreezeOpen(true);
                        }}
                        disabled={setUserFrozen.isPending || isSelf}
                      >
                        {isFrozen ? <UserCheck className="h-3.5 w-3.5" /> : <UserX className="h-3.5 w-3.5" />}
                        {isFrozen ? (lang === 'ar' ? 'إعادة تفعيل' : 'Reactivate') : (lang === 'ar' ? 'تعليق' : 'Suspend')}
                      </Button>
                    )}
                    {canResend && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5"
                        onClick={() => resendInvitation.mutate({ userId })}
                        disabled={resendInvitation.isPending}
                      >
                        <SendHorizontal className="h-3.5 w-3.5" />
                        {lang === 'ar' ? 'إعادة دعوة' : 'Resend Invite'}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/*
                  ── THE 360° CONSOLE ────────────────────────────────────
                  This was one scrolling card: identity, an edit form,
                  internal notes and the audit trail, and nothing else. An
                  administrator investigating an account had to leave it and
                  search five other screens by hand to learn whether this
                  person had projects, had sent quotations, was in a dispute,
                  held a subscription, or was stuck in compliance.

                  The sections are the ones North Star §34 names. Each is a
                  real read behind `users.read`, and each ends in the
                  canonical link to the screen that OWNS that domain - the
                  summary says where to look, it does not copy another
                  domain's private data onto this page.

                  A section whose domain this account has never touched still
                  appears, saying so. An absent section reads as "BuildHub
                  does not track this", which is a different and wrong claim.
                */}
                <Tabs defaultValue="overview">
                  <TabsList className="flex-wrap">
                    <TabsTrigger value="overview" data-testid="user-tab-overview">{lang === 'ar' ? 'نظرة عامة' : 'Overview'}</TabsTrigger>
                    <TabsTrigger value="account" data-testid="user-tab-account">{lang === 'ar' ? 'الحساب' : 'Account'}</TabsTrigger>
                    <TabsTrigger value="business" data-testid="user-tab-business">{lang === 'ar' ? 'النشاط التجاري' : 'Business'}</TabsTrigger>
                    <TabsTrigger value="compliance" data-testid="user-tab-compliance">{lang === 'ar' ? 'الامتثال' : 'Compliance'}</TabsTrigger>
                    <TabsTrigger value="activity" data-testid="user-tab-activity">{lang === 'ar' ? 'النشاط' : 'Activity'}</TabsTrigger>
                    <TabsTrigger value="commercial" data-testid="user-tab-commercial">{lang === 'ar' ? 'المزايا والإحالات' : 'Benefits & Referrals'}</TabsTrigger>
                    <TabsTrigger value="trust" data-testid="user-tab-trust">{lang === 'ar' ? 'الثقة والدعم' : 'Trust & Support'}</TabsTrigger>
                    <TabsTrigger value="notes" data-testid="user-tab-notes">{lang === 'ar' ? 'ملاحظات' : 'Notes'}</TabsTrigger>
                    <TabsTrigger value="audit" data-testid="user-tab-audit">{lang === 'ar' ? 'السجل' : 'Audit'}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="space-y-6 pt-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Info icon={<Mail className="h-4 w-4" />} label={lang === 'ar' ? 'البريد الإلكتروني' : 'Email'} value={detail.email || '—'} />
                      <Info icon={<Phone className="h-4 w-4" />} label={lang === 'ar' ? 'الهاتف' : 'Phone'} value={detail.phone || '—'} />
                      <Info icon={<MapPin className="h-4 w-4" />} label={lang === 'ar' ? 'الموقع' : 'Location'} value={detail.location || '—'} />
                      <Info icon={<ShieldCheck className="h-4 w-4" />} label={lang === 'ar' ? 'التحقق' : 'Verification'} value={detail.verified ? (lang === 'ar' ? 'موثّق' : 'Verified') : (lang === 'ar' ? 'غير موثّق' : 'Unverified')} />
                      <Info icon={<UserRound className="h-4 w-4" />} label={lang === 'ar' ? 'حالة الحساب' : 'Account status'} value={statusLabel(detail.accountStatus, lang)} />
                      <Info icon={<SendHorizontal className="h-4 w-4" />} label={lang === 'ar' ? 'الدعوة' : 'Invitation'} value={invitationLabel(detail.invitationStatus, lang)} />
                      <Info icon={<CalendarDays className="h-4 w-4" />} label={lang === 'ar' ? 'تاريخ الانضمام' : 'Joined'} value={new Date(detail.createdAt).toLocaleDateString()} />
                    </div>

                    {/* WHERE THIS ACCOUNT STANDS, ACROSS THE PRODUCT. Counts
                        only, each one a link to the domain that owns it. A
                        failed read renders a dash, never a zero. */}
                    <Snapshot snapshot={snapshot} failed={snapshotFailed} loading={snapshotLoading} lang={lang} userId={userId} navigate={navigate} />
                    <BusinessIdentity detail={detail} lang={lang} navigate={navigate} />
                  </TabsContent>

                  <TabsContent value="account" className="space-y-6 pt-4">
                    {canManageUsers && detail.role !== 'admin' && (
                      <div className="rounded-xl border p-4">
                        <p className="text-sm font-medium">{lang === 'ar' ? 'تعديل بيانات الحساب' : 'Edit account details'}</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <Input value={editForm.name} onChange={event => setEditForm(prev => ({ ...prev, name: event.target.value }))} placeholder={lang === 'ar' ? 'الاسم الكامل' : 'Full name'} />
                          <Input value={editForm.username} onChange={event => setEditForm(prev => ({ ...prev, username: event.target.value }))} placeholder={lang === 'ar' ? 'اسم المستخدم' : 'Username'} />
                          <Input type="email" value={editForm.email} onChange={event => setEditForm(prev => ({ ...prev, email: event.target.value }))} placeholder={lang === 'ar' ? 'البريد الإلكتروني' : 'Email'} />
                          <Input value={editForm.phone} onChange={event => setEditForm(prev => ({ ...prev, phone: event.target.value }))} placeholder={lang === 'ar' ? 'الهاتف' : 'Phone'} />
                          <Select value={editForm.userRole} onValueChange={value => setEditForm(prev => ({ ...prev, userRole: value }))}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(ROLE_LABELS).filter(([key]) => key !== 'admin').map(([key, labels]) => (
                                <SelectItem key={key} value={key}>{labels[lang === 'ar' ? 1 : 0]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          size="sm"
                          className="mt-3"
                          disabled={updateUser.isPending || editForm.name.trim().length === 0}
                          onClick={() => updateUser.mutate({
                            userId,
                            name: editForm.name.trim(),
                            username: editForm.username.trim(),
                            email: editForm.email.trim(),
                            phone: editForm.phone.trim(),
                            userRole: editForm.userRole as 'homeowner' | 'contractor' | 'engineer' | 'architect' | 'supplier' | 'project_manager',
                          })}
                        >
                          {lang === 'ar' ? 'حفظ التعديلات' : 'Save changes'}
                        </Button>
                      </div>
                    )}
                    {!canManageUsers && (
                      <p className="text-sm text-muted-foreground">
                        {lang === 'ar'
                          ? 'ليس لديك صلاحية تعديل الحسابات.'
                          : 'You do not have permission to edit accounts.'}
                      </p>
                    )}
                  </TabsContent>

                  <TabsContent value="business" className="space-y-6 pt-4">
                    <BusinessIdentity detail={detail} lang={lang} navigate={navigate} />
                    {!detail.companyName && !detail.tradingName && (
                      <p className="text-sm text-muted-foreground" data-testid="user-no-business">
                        {lang === 'ar'
                          ? 'لا يوجد ملف تجاري لهذا الحساب.'
                          : 'This account has no business profile.'}
                      </p>
                    )}
                    <MarketplaceSection snapshot={snapshot} failed={snapshotFailed} lang={lang} />
                      {targeting && (
                        <div className="mt-4">
                          <p className="mb-2 text-sm font-medium">
                            {lang === 'ar' ? 'لماذا يظهر (أو لا يظهر) لهذا المورّد استفسارات' : 'Why this vendor is or is not matched'}
                          </p>
                          <div className="space-y-1 rounded-xl border p-3 text-xs" data-testid="vendor-targeting">
                            <p>
                              {lang === 'ar' ? 'الفئات المعلنة' : 'Declared categories'}:{' '}
                              {(targeting as any).categories?.length
                                ? (targeting as any).categories.join(', ')
                                : <span className="text-muted-foreground">{lang === 'ar' ? 'لا توجد — لن يُطابَق بأي طلب' : 'none — nothing can match them'}</span>}
                            </p>
                            <p>
                              {lang === 'ar' ? 'استهلاك الاستفسارات' : 'Enquiry usage'}:{' '}
                              {(targeting as any).usage?.used ?? 0}
                              {' / '}
                              {(targeting as any).usage?.allowance ?? (lang === 'ar' ? 'بلا حد' : 'unlimited')}
                              {(targeting as any).usage?.limitReached
                                ? ` — ${lang === 'ar' ? 'بلغ الحد' : 'limit reached'}`
                                : ''}
                            </p>
                          </div>
                        </div>
                      )}
                  </TabsContent>

                  <TabsContent value="compliance" className="space-y-4 pt-4">
                    <ComplianceSection
                      snapshot={snapshot} failed={snapshotFailed} lang={lang}
                      onboardingStatus={detail.onboardingStatus}
                      onOpen={() => navigate('/admin/compliance')}
                    />
                  </TabsContent>

                  <TabsContent value="activity" className="space-y-4 pt-4">
                    <ActivitySection snapshot={snapshot} failed={snapshotFailed} lang={lang} navigate={navigate} />
                  </TabsContent>

                  <TabsContent value="commercial" className="space-y-4 pt-4">
                    <CommercialSection snapshot={snapshot} failed={snapshotFailed} lang={lang} onOpen={() => navigate('/admin/referrals')} />
                  </TabsContent>

                  <TabsContent value="trust" className="space-y-4 pt-4">
                    <TrustSection snapshot={snapshot} failed={snapshotFailed} lang={lang} navigate={navigate} />
                  </TabsContent>

                  <TabsContent value="notes" className="space-y-4 pt-4">
                    {canManageUsers && (
                      <div className="rounded-xl border p-4">
                        <p className="text-sm font-medium">{lang === 'ar' ? 'ملاحظات المشرف الداخلية' : 'Internal Admin Notes'}</p>
                        <Textarea
                          className="mt-3"
                          rows={3}
                          maxLength={5000}
                          value={noteDraft}
                          onChange={event => setNoteDraft(event.target.value)}
                          placeholder={lang === 'ar' ? 'اكتب ملاحظة داخلية…' : 'Write an internal note…'}
                        />
                        <Button
                          size="sm"
                          className="mt-2"
                          disabled={addUserNote.isPending || noteDraft.trim().length === 0}
                          onClick={() => addUserNote.mutate({ userId, note: noteDraft.trim() })}
                        >
                          {lang === 'ar' ? 'إضافة ملاحظة' : 'Add note'}
                        </Button>
                        {userNotes.length > 0 && (
                          <div className="mt-3 space-y-2 rounded-lg border p-3">
                            {userNotes.map(note => (
                              <div key={note.id} className="border-b pb-2 last:border-0 last:pb-0">
                                <p className="text-sm">{note.note}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {note.authorName || note.authorEmail || '—'} · {new Date(note.createdAt).toLocaleString()}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="audit" className="space-y-4 pt-4">
                    <div>
                      <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                        <History className="h-4 w-4" />
                        {lang === 'ar' ? 'سجل الحساب' : 'Account audit trail'}
                      </p>
                      {auditEvents.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{lang === 'ar' ? 'لا توجد أحداث مسجلة.' : 'No audit events recorded.'}</p>
                      ) : (
                        <div className="space-y-2 rounded-xl border p-3">
                          {auditEvents.map(event => (
                            <div key={event.id} className="border-b pb-2 last:border-0 last:pb-0">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <Badge variant="secondary">{event.action.replaceAll('_', ' ')}</Badge>
                                <span className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</span>
                              </div>
                              {event.note && <p className="mt-1 text-xs text-muted-foreground">{event.note}</p>}
                            </div>
                          ))}
                        </div>
                      )}

                      {fieldHistory.length > 0 && (
                        <div className="mt-4">
                          <p className="mb-2 text-sm font-medium">
                            {lang === 'ar' ? 'ما الذي تغيّر بالضبط' : 'What actually changed'}
                          </p>
                          <div className="space-y-1 rounded-xl border p-3" data-testid="user-field-history">
                            {fieldHistory.map((row: any) => (
                              <p key={row.id} className="text-xs">
                                <span className="font-medium">{row.field}</span>
                                {': '}
                                <span className="text-muted-foreground">{row.oldValue ?? '—'}</span>
                                {' → '}
                                <span>{row.newValue ?? '—'}</span>
                                <span className="ms-2 text-muted-foreground">
                                  {new Date(row.createdAt).toLocaleString()}
                                </span>
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Dialog open={freezeOpen} onOpenChange={open => { if (!open && !setUserFrozen.isPending) setFreezeOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isFrozen ? (lang === 'ar' ? 'إعادة تفعيل المستخدم' : 'Reactivate user') : (lang === 'ar' ? 'تعليق المستخدم' : 'Suspend user')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{detail?.name || detail?.email}</p>
          {!isFrozen && (
            <div className="space-y-2">
              <label className="text-sm font-medium">{lang === 'ar' ? 'سبب التعليق' : 'Suspension reason'}</label>
              <Select value={freezeReason} onValueChange={setFreezeReason}>
                <SelectTrigger><SelectValue placeholder={lang === 'ar' ? 'اختر سبباً' : 'Select a reason'} /></SelectTrigger>
                <SelectContent>
                  {FREEZE_REASONS.map(reason => <SelectItem key={reason.value} value={reason.value}>{lang === 'ar' ? reason.ar : reason.en}</SelectItem>)}
                </SelectContent>
              </Select>
              {freezeReason === 'other' && (
                <Textarea rows={3} maxLength={500} placeholder={lang === 'ar' ? 'اكتب سبب التعليق' : 'Describe the suspension reason'} value={freezeReasonDetail} onChange={event => setFreezeReasonDetail(event.target.value)} />
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFreezeOpen(false)}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</Button>
            <Button variant={isFrozen ? 'default' : 'destructive'} onClick={submitFreeze} disabled={setUserFrozen.isPending || (!isFrozen && !freezeReason)}>
              {setUserFrozen.isPending ? t('common.loading') : (lang === 'ar' ? 'تأكيد' : 'Confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function Info({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   THE 360 SECTIONS.

   Every one of them follows the same three rules:

     a figure that was not counted renders as a dash, never as 0
     a domain with nothing in it SAYS so, rather than being hidden
     a section ends in the canonical link to the screen that owns it

   The second is the one that is easy to get wrong. Hiding an empty section
   makes the page look tidier and tells the administrator something false:
   that BuildHub does not track this, rather than that this account has none.
   ───────────────────────────────────────────────────────────────────────── */

/** A figure with its label. `undefined` is unknown and shows as a dash. */
function Stat({ label, value, tone }: { label: string; value: number | undefined; tone?: 'warn' }) {
  return (
    <div className="rounded-lg border bg-card p-3" data-testid={`user-stat-${label.replace(/\s+/g, '-').toLowerCase()}`}>
      <p className={`text-2xl font-bold tabular-nums ${tone === 'warn' && (value ?? 0) > 0 ? 'text-amber-600' : ''}`}>
        {typeof value === 'number' ? value.toLocaleString() : '—'}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * The business identity block, ONCE.
 *
 * It appeared verbatim in two tabs, which is the kind of duplicate that stops
 * being identical the first time one of them is edited. Overview carries it
 * as identity context; Business carries it as the heading of that section.
 */
function BusinessIdentity({ detail, lang, navigate }: {
  detail: any; lang: 'en' | 'ar'; navigate: (to: string) => void;
}) {
  if (!detail.companyName && !detail.tradingName) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="user-business-identity">
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 h-5 w-5 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">{detail.companyName || detail.tradingName}</p>
          {detail.companyName && detail.tradingName && detail.tradingName !== detail.companyName && (
            <p className="text-xs text-muted-foreground">{detail.tradingName}</p>
          )}
        </div>
      </div>
      <Button size="sm" variant="outline" className="h-8" onClick={() => navigate(`/vendor/${detail.id}`)}>
        {lang === 'ar' ? 'فتح إدارة المورّد' : 'Open vendor management'}
      </Button>
    </div>
  );
}

function SectionFailed({ lang }: { lang: 'en' | 'ar' }) {
  // ERROR != EMPTY. This is the sentence that stops an outage reading as an
  // account with no history.
  return (
    <p className="rounded-lg border border-dashed border-destructive/40 p-4 text-sm text-destructive" data-testid="user-section-failed">
      {lang === 'ar'
        ? 'تعذّر تحميل هذا القسم. الأرقام غير معروفة الآن — وهذا لا يعني أنها صفر.'
        : 'This section could not be loaded. The figures are unknown right now — that is not the same as zero.'}
    </p>
  );
}

function Nothing({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function OpenDomain({ label, onClick, testId }: { label: string; onClick: () => void; testId: string }) {
  return (
    <Button size="sm" variant="outline" className="h-8" data-testid={testId} onClick={onClick}>
      {label}
    </Button>
  );
}

/** The Overview strip: where this account stands, in one glance. */
function Snapshot({ snapshot, failed, loading, lang, userId, navigate }: {
  snapshot: any; failed: boolean; loading: boolean; lang: 'en' | 'ar';
  userId: number; navigate: (to: string) => void;
}) {
  const ar = lang === 'ar';
  if (failed) return <SectionFailed lang={lang} />;
  const value = (path: () => number | undefined) => (loading || !snapshot ? undefined : path());
  const openDisputes = (snapshot?.trust?.disputesByStatus ?? {});
  const unresolvedDisputes = Object.entries(openDisputes)
    .filter(([status]) => !['resolved', 'withdrawn', 'closed'].includes(String(status)))
    .reduce((sum, [, n]) => sum + Number(n), 0);

  return (
    <div className="space-y-3" data-testid="user-snapshot">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {ar ? 'النشاط عبر المنصة' : 'Activity across BuildHub'}
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={ar ? 'مشاريع' : 'Projects'} value={value(() => snapshot.projects.owned + snapshot.projects.memberOf)} />
        <Stat label={ar ? 'طلبات عروض' : 'RFQs'} value={value(() => snapshot.sourcing.rfqs)} />
        <Stat label={ar ? 'عروض أسعار' : 'Quotations'} value={value(() => snapshot.sourcing.quotations)} />
        <Stat label={ar ? 'منتجات' : 'Products'} value={value(() => snapshot.marketplace.products)} />
        <Stat label={ar ? 'نزاعات مفتوحة' : 'Open disputes'} value={value(() => unresolvedDisputes)} tone="warn" />
        <Stat label={ar ? 'تذاكر دعم' : 'Support tickets'} value={value(() => snapshot.trust.tickets)} />
      </div>
      {/* THE GRAPH, NOT A SET OF ISOLATED PAGES. An administrator who can see
          that this account is in a dispute should be one click from it. */}
      <div className="flex flex-wrap gap-2">
        <OpenDomain testId="user-open-public" label={ar ? 'الملف العام' : 'Public profile'} onClick={() => navigate(`/vendor/${userId}`)} />
        <OpenDomain testId="user-open-referrals" label={ar ? 'الإحالات' : 'Referrals'} onClick={() => navigate('/admin/referrals')} />
        <OpenDomain testId="user-open-disputes" label={ar ? 'النزاعات' : 'Disputes'} onClick={() => navigate('/admin/disputes')} />
        <OpenDomain testId="user-open-support" label={ar ? 'الدعم' : 'Support'} onClick={() => navigate('/admin/support')} />
      </div>
    </div>
  );
}

function MarketplaceSection({ snapshot, failed, lang }: { snapshot: any; failed: boolean; lang: 'en' | 'ar' }) {
  const ar = lang === 'ar';
  if (failed) return <SectionFailed lang={lang} />;
  const market = snapshot?.marketplace;
  return (
    <div className="space-y-3" data-testid="user-marketplace">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {ar ? 'ما ينشره هذا الحساب' : 'What this account lists'}
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={ar ? 'منتجات منشورة' : 'Live products'} value={market?.productsByStatus?.active ?? (market ? 0 : undefined)} />
        <Stat label={ar ? 'مسودات' : 'Drafts'} value={market?.productsByStatus?.draft ?? (market ? 0 : undefined)} />
        <Stat label={ar ? 'خدمات' : 'Services'} value={market?.services} />
        <Stat label={ar ? 'مواضع مموّلة / مختارة' : 'Placements'} value={market ? Object.values(market.placementsByKind ?? {}).reduce((a: number, b: any) => a + Number(b), 0) : undefined} />
      </div>
      {market && market.products === 0 && market.services === 0 && (
        <Nothing>{ar ? 'لا توجد منتجات أو خدمات منشورة لهذا الحساب.' : 'This account has nothing listed on the marketplace.'}</Nothing>
      )}
    </div>
  );
}

function ComplianceSection({ snapshot, failed, lang, onboardingStatus, onOpen }: {
  snapshot: any; failed: boolean; lang: 'en' | 'ar'; onboardingStatus: string | null | undefined; onOpen: () => void;
}) {
  const ar = lang === 'ar';
  if (failed) return <SectionFailed lang={lang} />;
  const compliance = snapshot?.compliance;
  const byStatus = compliance?.documentsByStatus ?? {};
  return (
    <div className="space-y-3" data-testid="user-compliance">
      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">{ar ? 'حالة التسجيل' : 'Registration status'}</p>
        <p className="text-sm font-medium">{onboardingStatus ?? (ar ? 'لا ينطبق' : 'Not applicable')}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={ar ? 'قيد المراجعة' : 'Under review'} value={compliance ? (byStatus.under_review ?? 0) + (byStatus.submitted ?? 0) : undefined} />
        <Stat label={ar ? 'مقبولة' : 'Approved'} value={compliance ? byStatus.approved ?? 0 : undefined} />
        <Stat label={ar ? 'مرفوضة' : 'Rejected'} value={compliance ? byStatus.rejected ?? 0 : undefined} tone="warn" />
        <Stat label={ar ? 'تحتاج تحديثًا' : 'Update required'} value={compliance ? byStatus.update_required ?? 0 : undefined} tone="warn" />
      </div>
      {compliance && compliance.documents === 0 && (
        <Nothing>{ar ? 'لم يقدّم هذا الحساب أي مستندات امتثال.' : 'This account has submitted no compliance documents.'}</Nothing>
      )}
      {/* THE DOCUMENTS THEMSELVES LIVE ON THE REGISTRATION RECORD, behind that
          screen's own authorization. Counts here, contents there. */}
      <OpenDomain testId="user-open-compliance" label={ar ? 'فتح سجل التسجيل المهني' : 'Open Professional Registrations'} onClick={onOpen} />
    </div>
  );
}

function ActivitySection({ snapshot, failed, lang, navigate }: {
  snapshot: any; failed: boolean; lang: 'en' | 'ar'; navigate: (to: string) => void;
}) {
  const ar = lang === 'ar';
  if (failed) return <SectionFailed lang={lang} />;
  const projectsCtx = snapshot?.projects;
  const sourcing = snapshot?.sourcing;
  return (
    <div className="space-y-5" data-testid="user-activity">
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{ar ? 'المشاريع' : 'Projects'}</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {/* OWNED AND MEMBER OF ARE DIFFERENT FACTS. A project manager
              running six projects owns none of them, and a view that counted
              only ownership would show the busiest account as having none. */}
          <Stat label={ar ? 'يملكها' : 'Owned'} value={projectsCtx?.owned} />
          <Stat label={ar ? 'عضو فيها' : 'Member of'} value={projectsCtx?.memberOf} />
        </div>
        {projectsCtx && projectsCtx.recent.length === 0 ? (
          <Nothing>{ar ? 'لا توجد مشاريع.' : 'No projects.'}</Nothing>
        ) : (
          <ul className="space-y-1">
            {(projectsCtx?.recent ?? []).map((row: any) => (
              <li key={row.id}>
                <button
                  className="text-sm text-primary hover:underline"
                  data-testid={`user-project-${row.id}`}
                  onClick={() => navigate(`/admin/projects/${row.id}`)}
                >
                  {row.title}
                </button>
                <span className="ms-2 text-xs text-muted-foreground">{row.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{ar ? 'التوريد' : 'Sourcing'}</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={ar ? 'طلبات عروض' : 'RFQs raised'} value={sourcing?.rfqs} />
          {/* THE CURRENT quotation only: a revision supersedes its
              predecessor, so counting superseded rows would report one
              quotation revised three times as four. */}
          <Stat label={ar ? 'عروض أسعار مُرسلة' : 'Quotations sent'} value={sourcing?.quotations} />
          <Stat label={ar ? 'مقبولة' : 'Accepted'} value={sourcing ? sourcing.quotationsByStatus?.accepted ?? 0 : undefined} />
          <Stat label={ar ? 'استفسارات مؤهَّلة' : 'Qualified enquiries'} value={sourcing?.qualifiedEnquiries} />
        </div>
        {sourcing && sourcing.recentRfqs.length === 0 ? (
          <Nothing>{ar ? 'لم ينشر هذا الحساب أي طلب عرض.' : 'This account has raised no RFQs.'}</Nothing>
        ) : (
          <ul className="space-y-1">
            {(sourcing?.recentRfqs ?? []).map((row: any) => (
              <li key={row.id} className="text-sm">
                {row.title}
                <span className="ms-2 text-xs text-muted-foreground">{row.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CommercialSection({ snapshot, failed, lang, onOpen }: {
  snapshot: any; failed: boolean; lang: 'en' | 'ar'; onOpen: () => void;
}) {
  const ar = lang === 'ar';
  if (failed) return <SectionFailed lang={lang} />;
  const commercial = snapshot?.commercial;
  return (
    <div className="space-y-4" data-testid="user-commercial">
      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">{ar ? 'الاشتراك' : 'Subscription'}</p>
        <p className="text-sm font-medium">
          {commercial?.subscription
            ? `${commercial.subscription.plan} · ${commercial.subscription.status}`
            : (ar ? 'لا يوجد اشتراك' : 'No subscription')}
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{ar ? 'الإحالة' : 'Referral'}</h3>
        <div className="rounded-lg border p-3 text-sm">
          {commercial?.referralCode ? (
            <>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs" data-testid="user-referral-code">{commercial.referralCode}</code>
              {/* Status in words, not colour alone, and the same vocabulary
                  the Referral Codes screen uses. */}
              <Badge
                variant={commercial.referralCodeStatus === 'active' ? 'default' : 'destructive'}
                className="ms-2 text-[10px]"
              >
                {commercial.referralCodeStatus === 'active' ? (ar ? 'نشط' : 'Active') : (ar ? 'معطّل' : 'Disabled')}
              </Badge>
            </>
          ) : (
            <span className="text-muted-foreground" data-testid="user-referral-code-none">
              {ar ? 'لا يوجد كود إحالة' : 'No referral code'}
            </span>
          )}
          {/* WAS THIS ACCOUNT ITSELF REFERRED? An attribution dispute is
              usually about the referred side, which had nowhere to be seen. */}
          {commercial?.referredBy && (
            <p className="mt-2 text-xs text-muted-foreground" data-testid="user-referred-by">
              {ar ? 'أُحيل عبر الكود' : 'Referred with code'} <code>{commercial.referredBy.code}</code>
              {' · '}{commercial.referredBy.status}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={ar ? 'إحالات مُسنَدة' : 'Referrals attributed'} value={commercial?.referralsAttributed} />
          <Stat label={ar ? 'مؤهَّلة' : 'Qualified'} value={commercial?.referralsQualified} />
          <Stat label={ar ? 'مكافآت ممنوحة' : 'Rewards granted'} value={commercial ? commercial.rewardsByStatus?.GRANTED ?? 0 : undefined} />
          <Stat label={ar ? 'مكافآت مسحوبة' : 'Rewards reversed'} value={commercial ? commercial.rewardsByStatus?.REVERSED ?? 0 : undefined} tone="warn" />
        </div>
      </div>

      <OpenDomain testId="user-open-referral-control" label={ar ? 'فتح إدارة الإحالات' : 'Open Referral Management'} onClick={onOpen} />
    </div>
  );
}

function TrustSection({ snapshot, failed, lang, navigate }: {
  snapshot: any; failed: boolean; lang: 'en' | 'ar'; navigate: (to: string) => void;
}) {
  const ar = lang === 'ar';
  if (failed) return <SectionFailed lang={lang} />;
  const trust = snapshot?.trust;
  return (
    <div className="space-y-5" data-testid="user-trust">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={ar ? 'تقييمات مستلمة' : 'Reviews received'} value={trust?.reviewsReceived} />
        <Stat label={ar ? 'تقييمات كتبها' : 'Reviews written'} value={trust?.reviewsWritten} />
        <Stat label={ar ? 'تقييمات مخفية' : 'Reviews hidden'} value={trust?.reviewsHidden} tone="warn" />
        <Stat label={ar ? 'نزاعات' : 'Disputes'} value={trust?.disputes} tone="warn" />
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{ar ? 'النزاعات' : 'Disputes'}</h3>
        {trust && trust.recentDisputes.length === 0 ? (
          <Nothing>{ar ? 'لا توجد نزاعات تخص هذا الحساب.' : 'This account is party to no disputes.'}</Nothing>
        ) : (
          <ul className="space-y-1">
            {(trust?.recentDisputes ?? []).map((row: any) => (
              <li key={row.id} className="text-sm">
                <button
                  className="text-primary hover:underline"
                  data-testid={`user-dispute-${row.id}`}
                  onClick={() => navigate('/admin/disputes')}
                >
                  {row.reference ?? `#${row.id}`}
                </button>
                <span className="ms-2">{row.title}</span>
                <span className="ms-2 text-xs text-muted-foreground">{row.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{ar ? 'تذاكر الدعم' : 'Support tickets'}</h3>
        {trust && trust.recentTickets.length === 0 ? (
          <Nothing>{ar ? 'لم يفتح هذا الحساب أي تذكرة دعم.' : 'This account has opened no support tickets.'}</Nothing>
        ) : (
          <ul className="space-y-1">
            {(trust?.recentTickets ?? []).map((row: any) => (
              <li key={row.id} className="text-sm">
                <button
                  className="text-primary hover:underline"
                  data-testid={`user-ticket-${row.id}`}
                  onClick={() => navigate('/admin/support')}
                >
                  {row.reference ?? `#${row.id}`}
                </button>
                <span className="ms-2">{row.subject}</span>
                <span className="ms-2 text-xs text-muted-foreground">{row.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
