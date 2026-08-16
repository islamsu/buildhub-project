import { useAuth } from '@/_core/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { trpc } from '@/lib/trpc';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import {
  Users, FolderOpen, Package, FileText, ShieldCheck, AlertTriangle,
  TrendingUp, Settings, Search, Eye, Ban, CheckCircle2,
  MessageSquare, BarChart3, Shield, Flag, Activity, Globe, UserRound,
  UserCheck, UserX, Save, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLocation } from 'wouter';
import { startLogin } from '@/const';
import { useEffect, useMemo, useState } from 'react';

const MONTHLY_USERS = [
  { month: 'Jan', users: 120, projects: 45 },
  { month: 'Feb', users: 180, projects: 67 },
  { month: 'Mar', users: 250, projects: 89 },
  { month: 'Apr', users: 310, projects: 112 },
  { month: 'May', users: 420, projects: 145 },
  { month: 'Jun', users: 580, projects: 198 },
];

const ROLE_GROUPS = [
  { key: 'homeowner', en: 'Homeowners', ar: 'أصحاب المنازل' },
  { key: 'contractor', en: 'Contractors', ar: 'المقاولون' },
  { key: 'engineer', en: 'Engineers', ar: 'المهندسون' },
  { key: 'architect', en: 'Architects', ar: 'المهندسون المعماريون' },
  { key: 'supplier', en: 'Suppliers', ar: 'الموردون' },
  { key: 'project_manager', en: 'Project Managers', ar: 'مديرو المشاريع' },
  { key: 'admin', en: 'Administrators', ar: 'المشرفون' },
];

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

function formatStatus(status: string | null | undefined, lang: 'en' | 'ar') {
  const labels: Record<string, string> = lang === 'ar'
    ? { open: 'مفتوحة', investigating: 'قيد التحقيق', resolved: 'تم الحل', rejected: 'مرفوضة', active: 'نشط', frozen: 'مجمد', pending: 'قيد الانتظار', accepted: 'مقبول' }
    : { open: 'Open', investigating: 'Investigating', resolved: 'Resolved', rejected: 'Rejected', active: 'Active', frozen: 'Frozen', pending: 'Pending', accepted: 'Accepted' };
  return status ? labels[status] ?? status : '—';
}

export default function AdminDashboard() {
  const { t, lang, dir } = useLanguage();
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const [userSearch, setUserSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [freezeTarget, setFreezeTarget] = useState<any | null>(null);
  const [freezeReason, setFreezeReason] = useState('');
  const [activeDispute, setActiveDispute] = useState<any | null>(null);
  const [disputeStatus, setDisputeStatus] = useState<'open' | 'investigating' | 'resolved' | 'rejected'>('investigating');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>({});
  const isAdmin = isAuthenticated && (user as any)?.role === 'admin';
  const utils = trpc.useUtils();

  const { data: stats } = trpc.admin.stats.useQuery(undefined, { enabled: isAdmin });
  const { data: allUsers = [], isLoading: usersLoading } = trpc.admin.users.useQuery(undefined, { enabled: isAdmin });
  const { data: disputes = [], isLoading: disputesLoading } = trpc.admin.disputes.useQuery(undefined, { enabled: isAdmin });
  const { data: settings } = trpc.admin.settings.useQuery(undefined, { enabled: isAdmin });

  useEffect(() => {
    if (settings) setSettingDrafts(settings);
  }, [settings]);

  const verifyUser = trpc.admin.verifyUser.useMutation({
    onSuccess: () => { toast.success(lang === 'ar' ? 'تم تحديث حالة التحقق' : 'Verification status updated'); utils.admin.users.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const setUserFrozen = trpc.admin.setUserFrozen.useMutation({
    onSuccess: (_data, variables) => {
      toast.success(lang === 'ar' ? (variables.frozen ? 'تم تجميد المستخدم' : 'تم إلغاء تجميد المستخدم') : (variables.frozen ? 'User frozen' : 'User unfrozen'));
      setFreezeTarget(null);
      setFreezeReason('');
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

  const openDisputes = disputes.filter(dispute => dispute.status === 'open').length;

  if (loading) return null;
  if (!isAuthenticated) { startLogin(); return null; }
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir={dir}>
        <div className="text-center">
          <AlertTriangle className="w-16 h-16 mx-auto mb-4 text-destructive" />
          <h2 className="text-2xl font-bold mb-2">{lang === 'ar' ? 'غير مصرح' : 'Access Denied'}</h2>
          <p className="text-muted-foreground">{lang === 'ar' ? 'ليس لديك صلاحيات المشرف.' : 'You do not have admin privileges.'}</p>
          <Button className="mt-4" onClick={() => navigate('/dashboard')}>{lang === 'ar' ? 'الذهاب للوحة التحكم' : 'Go to Dashboard'}</Button>
        </div>
      </div>
    );
  }

  const statCards = [
    { label: lang === 'ar' ? 'إجمالي المستخدمين' : 'Total Users', value: stats?.users ?? 0, icon: Users, color: 'text-blue-500', bg: 'bg-blue-50' },
    { label: lang === 'ar' ? 'المشاريع النشطة' : 'Active Projects', value: stats?.projects ?? 0, icon: FolderOpen, color: 'text-green-500', bg: 'bg-green-50' },
    { label: lang === 'ar' ? 'المنتجات المدرجة' : 'Products Listed', value: stats?.products ?? 0, icon: Package, color: 'text-amber-500', bg: 'bg-amber-50' },
    { label: lang === 'ar' ? 'النزاعات المفتوحة' : 'Open Disputes', value: openDisputes, icon: MessageSquare, color: 'text-purple-500', bg: 'bg-purple-50' },
  ];

  const handleFreezeSubmit = () => {
    if (!freezeTarget) return;
    setUserFrozen.mutate({ userId: freezeTarget.id, frozen: (freezeTarget as any).accountStatus !== 'frozen', reason: freezeReason || undefined });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6" dir={dir}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-2xl font-bold mb-1">{t('admin.title')}</h2><p className="text-muted-foreground">{lang === 'ar' ? 'مراقبة وإدارة منصة BuildHub' : 'Monitor and manage the BuildHub platform'}</p></div>
          <div className="flex items-center gap-2"><Badge className="badge-success text-xs px-3 py-1">{lang === 'ar' ? 'المنصة تعمل بشكل جيد' : 'Platform Healthy'}</Badge><Badge className="badge-info text-xs px-3 py-1 flex items-center gap-1"><Activity className="w-3 h-3" /> {lang === 'ar' ? 'مباشر' : 'Live'}</Badge></div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map(stat => <Card key={stat.label}><CardContent className="p-5"><div className={`w-10 h-10 rounded-xl ${stat.bg} flex items-center justify-center mb-3`}><stat.icon className={`w-5 h-5 ${stat.color}`} /></div><p className="text-2xl font-bold">{stat.value.toLocaleString()}</p><p className="text-sm text-muted-foreground">{stat.label}</p></CardContent></Card>)}
        </div>

        <Tabs defaultValue="users">
          <TabsList className="flex-wrap h-auto gap-1 mb-6">
            <TabsTrigger value="users" className="gap-1.5"><Users className="w-4 h-4" /> {lang === 'ar' ? 'المستخدمون' : 'Users'}</TabsTrigger>
            <TabsTrigger value="analytics" className="gap-1.5"><BarChart3 className="w-4 h-4" /> {lang === 'ar' ? 'التحليلات' : 'Analytics'}</TabsTrigger>
            <TabsTrigger value="disputes" className="gap-1.5"><MessageSquare className="w-4 h-4" /> {lang === 'ar' ? 'النزاعات' : 'Disputes'} ({openDisputes})</TabsTrigger>
            <TabsTrigger value="fraud" className="gap-1.5"><Shield className="w-4 h-4" /> {lang === 'ar' ? 'كشف الاحتيال' : 'Fraud Detection'}</TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5"><Settings className="w-4 h-4" /> {lang === 'ar' ? 'الإعدادات' : 'Settings'}</TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <Card>
              <CardHeader className="space-y-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" />{lang === 'ar' ? 'إدارة المستخدمين حسب المجموعة' : 'User Management by Group'}</CardTitle><div className="relative w-full lg:w-72"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input className="pl-9 h-9 text-sm" placeholder={lang === 'ar' ? 'بحث بالاسم أو البريد...' : 'Search by name or email...'} value={userSearch} onChange={event => setUserSearch(event.target.value)} /></div></div><div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8"><button type="button" onClick={() => setSelectedGroup('all')} className={`rounded-lg border p-3 text-start transition-colors ${selectedGroup === 'all' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}><p className="text-xs text-muted-foreground">{lang === 'ar' ? 'الكل' : 'All Users'}</p><p className="text-lg font-semibold">{allUsers.length}</p></button>{ROLE_GROUPS.map(group => <button type="button" key={group.key} onClick={() => setSelectedGroup(group.key)} className={`rounded-lg border p-3 text-start transition-colors ${selectedGroup === group.key ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}><p className="truncate text-xs text-muted-foreground">{lang === 'ar' ? group.ar : group.en}</p><p className="text-lg font-semibold">{groupCounts[group.key] ?? 0}</p></button>)}</div></CardHeader>
              <CardContent><div className="mb-3 flex items-center justify-between text-sm text-muted-foreground"><span>{selectedGroup === 'all' ? (lang === 'ar' ? 'كل المجموعات' : 'All groups') : labelForRole(selectedGroup, lang)}</span>{usersLoading && <RefreshCw className="h-4 w-4 animate-spin" />}</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border"><th className="text-left py-3 px-2 font-medium text-muted-foreground">{lang === 'ar' ? 'الاسم' : 'Name'}</th><th className="text-left py-3 px-2 font-medium text-muted-foreground">{lang === 'ar' ? 'البريد الإلكتروني' : 'Email'}</th><th className="text-left py-3 px-2 font-medium text-muted-foreground">{lang === 'ar' ? 'المجموعة' : 'Group'}</th><th className="text-left py-3 px-2 font-medium text-muted-foreground">{lang === 'ar' ? 'الحالة' : 'Status'}</th><th className="text-left py-3 px-2 font-medium text-muted-foreground">{lang === 'ar' ? 'الانضمام' : 'Joined'}</th><th className="text-left py-3 px-2 font-medium text-muted-foreground">{t('admin.actions')}</th></tr></thead><tbody>{filteredUsers.map(userRow => { const status = (userRow as any).accountStatus ?? 'active'; const isFrozen = status === 'frozen'; const isSelf = userRow.id === (user as any).id; return <tr key={userRow.id} className="border-b border-border/50 hover:bg-muted/30"><td className="py-3 px-2 font-medium"><div className="flex items-center gap-2"><UserRound className="h-4 w-4 text-muted-foreground" />{userRow.name ?? '—'}</div></td><td className="py-3 px-2 text-muted-foreground">{userRow.email ?? '—'}</td><td className="py-3 px-2"><Badge variant="secondary">{labelForRole((userRow as any).userRole ?? userRow.role, lang)}</Badge></td><td className="py-3 px-2"><Badge variant={isFrozen ? 'destructive' : 'outline'}>{formatStatus(status, lang)}{!isFrozen && ` · ${formatStatus((userRow as any).verified ? 'accepted' : 'pending', lang)}`}</Badge></td><td className="py-3 px-2 text-muted-foreground">{new Date(userRow.createdAt).toLocaleDateString()}</td><td className="py-3 px-2"><div className="flex flex-wrap items-center gap-1"><Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => verifyUser.mutate({ userId: userRow.id, verified: !(userRow as any).verified })} disabled={verifyUser.isPending}><ShieldCheck className="w-3 h-3" />{(userRow as any).verified ? (lang === 'ar' ? 'إلغاء التحقق' : 'Unverify') : (lang === 'ar' ? 'تحقق' : 'Verify')}</Button><Button size="sm" variant={isFrozen ? 'outline' : 'ghost'} className={`text-xs h-7 gap-1 ${isFrozen ? '' : 'text-destructive hover:text-destructive'}`} onClick={() => { setFreezeTarget(userRow); setFreezeReason((userRow as any).frozenReason ?? ''); }} disabled={isSelf}>{isFrozen ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}{isFrozen ? (lang === 'ar' ? 'إلغاء التجميد' : 'Unfreeze') : (lang === 'ar' ? 'تجميد' : 'Freeze')}</Button></div></td></tr>; })}{filteredUsers.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">{lang === 'ar' ? 'لا يوجد مستخدمون في هذه المجموعة' : 'No users in this group'}</td></tr>}</tbody></table></div></CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analytics"><div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><Card><CardHeader><CardTitle className="text-base">{lang === 'ar' ? 'نمو المستخدمين' : 'User Growth'}</CardTitle></CardHeader><CardContent><ResponsiveContainer width="100%" height={220}><LineChart data={MONTHLY_USERS}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /><Tooltip /><Line type="monotone" dataKey="users" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></CardContent></Card><Card><CardHeader><CardTitle className="text-base">{lang === 'ar' ? 'المشاريع المنشأة' : 'Projects Created'}</CardTitle></CardHeader><CardContent><ResponsiveContainer width="100%" height={220}><BarChart data={MONTHLY_USERS}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /><Tooltip /><Bar dataKey="projects" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></CardContent></Card></div></TabsContent>

          <TabsContent value="disputes"><Card><CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5" />{lang === 'ar' ? 'إدارة النزاعات' : 'Dispute Management'}</CardTitle></CardHeader><CardContent>{disputesLoading ? <div className="py-10 text-center text-muted-foreground"><RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />{t('common.loading')}</div> : disputes.length === 0 ? <EmptyState text={lang === 'ar' ? 'لا توجد نزاعات مسجلة' : 'No disputes have been filed'} /> : <div className="space-y-3">{disputes.map(dispute => <div key={dispute.id} className="rounded-xl border p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="font-semibold text-sm">{dispute.title}</h3><Badge variant={dispute.priority === 'high' ? 'destructive' : 'outline'}>{dispute.priority}</Badge><Badge variant="secondary">{formatStatus(dispute.status, lang)}</Badge></div><p className="text-sm text-muted-foreground line-clamp-2">{dispute.description}</p><p className="mt-2 text-xs text-muted-foreground">{dispute.reporterName || `#${dispute.reporterId}`} {dispute.respondentName ? ` · ${dispute.respondentName}` : ''} · {dispute.type} · {new Date(dispute.createdAt).toLocaleDateString()}</p></div><Button size="sm" variant="outline" className="h-8 shrink-0 gap-1" onClick={() => { setActiveDispute(dispute); setDisputeStatus(dispute.status); setResolutionNotes(dispute.resolutionNotes ?? ''); }}><Eye className="w-3 h-3" />{lang === 'ar' ? 'مراجعة' : 'Review'}</Button></div></div>)}</div>}</CardContent></Card></TabsContent>

          <TabsContent value="fraud"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5 text-destructive" />{lang === 'ar' ? 'تنبيهات الاحتيال' : 'Fraud Detection Alerts'}</CardTitle></CardHeader><CardContent><EmptyState text={lang === 'ar' ? 'سيتم عرض التنبيهات الآلية هنا عند توفرها' : 'Automated fraud alerts will appear here when available'} /></CardContent></Card></TabsContent>

          <TabsContent value="settings"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Settings className="w-5 h-5" />{lang === 'ar' ? 'إعدادات المنصة' : 'Platform Settings'}</CardTitle></CardHeader><CardContent><div className="grid gap-4 md:grid-cols-2">{SETTING_DEFINITIONS.map(definition => { const value = settingDrafts[definition.key] ?? ''; const isBoolean = definition.type === 'boolean'; return <div key={definition.key} className="rounded-xl border p-4"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">{lang === 'ar' ? definition.ar : definition.en}</p><p className="mt-1 text-xs text-muted-foreground">{definition.key}</p></div>{isBoolean ? <Switch checked={value === 'true'} onCheckedChange={checked => { const next = checked ? 'true' : 'false'; setSettingDrafts(draft => ({ ...draft, [definition.key]: next })); updateSetting.mutate({ key: definition.key, value: next }); }} disabled={updateSetting.isPending} /> : <div className="flex items-center gap-2"><Input className="h-8 w-28" type={definition.type === 'number' ? 'number' : 'text'} value={value} onChange={event => setSettingDrafts(draft => ({ ...draft, [definition.key]: event.target.value }))} /><Button size="sm" className="h-8 gap-1" onClick={() => updateSetting.mutate({ key: definition.key, value })} disabled={updateSetting.isPending}><Save className="h-3 w-3" />{lang === 'ar' ? 'حفظ' : 'Save'}</Button></div>}</div></div>; })}</div></CardContent></Card></TabsContent>
        </Tabs>
      </div>

      <Dialog open={Boolean(freezeTarget)} onOpenChange={open => !open && setFreezeTarget(null)}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{(freezeTarget as any)?.accountStatus === 'frozen' ? (lang === 'ar' ? 'إلغاء تجميد المستخدم' : 'Unfreeze User') : (lang === 'ar' ? 'تجميد المستخدم' : 'Freeze User')}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{(freezeTarget as any)?.name || (freezeTarget as any)?.email}</p>{(freezeTarget as any)?.accountStatus !== 'frozen' && <Input placeholder={lang === 'ar' ? 'سبب التجميد (اختياري)' : 'Reason for freezing (optional)'} value={freezeReason} onChange={event => setFreezeReason(event.target.value)} />}</DialogContent><DialogFooter><Button variant="outline" onClick={() => setFreezeTarget(null)}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</Button><Button variant={(freezeTarget as any)?.accountStatus === 'frozen' ? 'default' : 'destructive'} onClick={handleFreezeSubmit} disabled={setUserFrozen.isPending}>{setUserFrozen.isPending ? t('common.loading') : (lang === 'ar' ? 'تأكيد' : 'Confirm')}</Button></DialogFooter></Dialog>
      <Dialog open={Boolean(activeDispute)} onOpenChange={open => !open && setActiveDispute(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{activeDispute?.title}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{activeDispute?.description}</p><Select value={disputeStatus} onValueChange={value => setDisputeStatus(value as typeof disputeStatus)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">{formatStatus('open', lang)}</SelectItem><SelectItem value="investigating">{formatStatus('investigating', lang)}</SelectItem><SelectItem value="resolved">{formatStatus('resolved', lang)}</SelectItem><SelectItem value="rejected">{formatStatus('rejected', lang)}</SelectItem></SelectContent></Select><Textarea rows={4} placeholder={lang === 'ar' ? 'ملاحظات الحل' : 'Resolution notes'} value={resolutionNotes} onChange={event => setResolutionNotes(event.target.value)} /><DialogFooter><Button variant="outline" onClick={() => setActiveDispute(null)}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</Button><Button onClick={() => updateDispute.mutate({ disputeId: activeDispute.id, status: disputeStatus, resolutionNotes: resolutionNotes || undefined })} disabled={updateDispute.isPending}>{updateDispute.isPending ? t('common.loading') : (lang === 'ar' ? 'حفظ التحديث' : 'Save Update')}</Button></DialogFooter></DialogContent></Dialog>
    </DashboardLayout>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">{text}</div>;
}
