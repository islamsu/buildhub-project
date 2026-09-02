import { useAuth } from '@/_core/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
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
  const { data: detail, isLoading } = trpc.admin.userDetail.useQuery(
    { userId },
    { enabled: validId && can('users.read') },
  );
  const { data: auditEvents = [] } = trpc.admin.accountAudit.useQuery(
    { userId },
    { enabled: validId && can('users.read') },
  );

  const [freezeOpen, setFreezeOpen] = useState(false);
  const [freezeReason, setFreezeReason] = useState('');
  const [freezeReasonDetail, setFreezeReasonDetail] = useState('');
  const [editForm, setEditForm] = useState({ name: '', username: '', email: '', phone: '', userRole: 'homeowner' });

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
              <CardContent className="space-y-6">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Info icon={<Mail className="h-4 w-4" />} label={lang === 'ar' ? 'البريد الإلكتروني' : 'Email'} value={detail.email || '—'} />
                  <Info icon={<Phone className="h-4 w-4" />} label={lang === 'ar' ? 'الهاتف' : 'Phone'} value={detail.phone || '—'} />
                  <Info icon={<MapPin className="h-4 w-4" />} label={lang === 'ar' ? 'الموقع' : 'Location'} value={detail.location || '—'} />
                  <Info icon={<ShieldCheck className="h-4 w-4" />} label={lang === 'ar' ? 'التحقق' : 'Verification'} value={detail.verified ? (lang === 'ar' ? 'موثّق' : 'Verified') : (lang === 'ar' ? 'غير موثّق' : 'Unverified')} />
                  <Info icon={<UserRound className="h-4 w-4" />} label={lang === 'ar' ? 'حالة الحساب' : 'Account status'} value={statusLabel(detail.accountStatus, lang)} />
                  <Info icon={<SendHorizontal className="h-4 w-4" />} label={lang === 'ar' ? 'الدعوة' : 'Invitation'} value={invitationLabel(detail.invitationStatus, lang)} />
                  <Info icon={<CalendarDays className="h-4 w-4" />} label={lang === 'ar' ? 'تاريخ الانضمام' : 'Joined'} value={new Date(detail.createdAt).toLocaleDateString()} />
                </div>

                {(detail.companyName || detail.tradingName) && (
                  <div className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
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
                )}

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
                </div>
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
