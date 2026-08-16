import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/_core/hooks/useAuth';
import { startLogin } from '@/const';
import { useLanguage } from '@/contexts/LanguageContext';
import { getRolePlatformPath, isPlatformRole, ROLE_PLATFORM_COPY, type PlatformRole } from '@/lib/rolePlatform';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import {
  ArrowUpRight, BarChart3, BriefcaseBusiness, CheckCircle2, ClipboardList,
  Clock3, DollarSign, FileText, FolderKanban, KanbanSquare, Layers3, MapPin, MessageSquare,
  Package, PackagePlus, PenTool, Plus, Send, ShoppingBag, Sparkles, Users,
} from 'lucide-react';

const PRODUCT_CATEGORIES = ['Materials', 'Furniture', 'Lighting', 'Electrical', 'Plumbing', 'HVAC', 'Paint', 'Ceramics', 'Granite', 'Marble', 'Wood', 'Doors', 'Windows', 'Roofing', 'Glass', 'Steel', 'Concrete', 'Solar', 'Smart Home'];

type RoleCardAction = { label: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void; tone: string };

type Metric = { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; tone: string };

function compactNumber(value: number): string {
  return value.toLocaleString();
}

function localizedStatus(status: string | null | undefined, t: (key: string) => string): string {
  const keys: Record<string, string> = {
    planning: 'common.status.planning',
    active: 'common.status.active',
    on_hold: 'common.status.on_hold',
    completed: 'common.status.completed',
    cancelled: 'common.status.cancelled',
    pending: 'common.pending',
    accepted: 'common.accepted',
    rejected: 'common.rejected',
  };
  return status ? t(keys[status] ?? 'common.status') : t('platform.no_items');
}

function roleLabel(role: PlatformRole, lang: 'en' | 'ar'): string {
  const labels = {
    homeowner: lang === 'ar' ? 'مالك المنزل' : 'Homeowner',
    contractor: lang === 'ar' ? 'مقاول' : 'Contractor',
    engineer: lang === 'ar' ? 'مهندس' : 'Engineer',
    architect: lang === 'ar' ? 'مهندس معماري' : 'Architect',
    supplier: lang === 'ar' ? 'مورد' : 'Supplier',
    project_manager: lang === 'ar' ? 'مدير مشروع' : 'Project Manager',
  };
  return labels[role];
}

export default function RolePlatform() {
  const { user, isAuthenticated, loading } = useAuth();
  const { t, lang, dir } = useLanguage();
  const [, navigate] = useLocation();
  const account = user as { userRole?: string; role?: string } | null;
  const rawRole = account?.userRole;
  const accountRole = account?.role;
  const role: PlatformRole = isPlatformRole(rawRole) ? rawRole : 'homeowner';
  const requestedRole = typeof window !== 'undefined' ? window.location.pathname.split('/').pop() : '';

  useEffect(() => {
    if (!loading && !isAuthenticated) startLogin();
    if (!loading && isAuthenticated && (rawRole === 'admin' || accountRole === 'admin')) navigate('/admin');
    if (!loading && isAuthenticated && isPlatformRole(rawRole) && requestedRole !== rawRole) {
      navigate(getRolePlatformPath(rawRole));
    }
  }, [loading, isAuthenticated, rawRole, accountRole, requestedRole, navigate]);

  const isProfessional = role !== 'homeowner';
  const isSupplier = role === 'supplier';
  const copy = ROLE_PLATFORM_COPY[role];
  const { data: projects = [] } = trpc.projects.list.useQuery(undefined, { enabled: isAuthenticated && role === 'homeowner' });
  const { data: projectDirectory = [] } = trpc.projects.directory.useQuery(undefined, { enabled: isAuthenticated && isProfessional });
  const { data: rfqs = [] } = trpc.rfq.list.useQuery(undefined, { enabled: isAuthenticated });
  const { data: myQuotations = [] } = trpc.rfq.myQuotations.useQuery(undefined, { enabled: isAuthenticated && isProfessional });
  const { data: products = [] } = trpc.marketplace.myProducts.useQuery(undefined, { enabled: isAuthenticated && isSupplier });
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [productForm, setProductForm] = useState({ name: '', nameAr: '', category: '', description: '', brand: '', price: '', stock: '', unit: '', deliveryDays: '' });
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [quoteForm, setQuoteForm] = useState({ rfqId: 0, price: '', timeline: '', warranty: '', notes: '' });

  const createProduct = trpc.marketplace.create.useMutation({
    onSuccess: () => {
      toast.success(lang === 'ar' ? 'تمت إضافة المنتج إلى الكتالوج' : 'Product added to your catalogue');
      setProductDialogOpen(false);
      setProductForm({ name: '', nameAr: '', category: '', description: '', brand: '', price: '', stock: '', unit: '', deliveryDays: '' });
    },
    onError: (error) => toast.error(error.message),
  });
  const submitQuote = trpc.rfq.submitQuotation.useMutation({
    onSuccess: () => {
      toast.success(lang === 'ar' ? 'تم تقديم عرض السعر' : 'Quotation submitted');
      setQuoteDialogOpen(false);
      setQuoteForm({ rfqId: 0, price: '', timeline: '', warranty: '', notes: '' });
    },
    onError: (error) => toast.error(error.message),
  });

  const matchingRfqs = useMemo(() => {
    if (role === 'engineer') return rfqs.filter(rfq => /engineer|engineering|technical|consult/i.test(`${rfq.category ?? ''} ${rfq.title}`));
    if (role === 'architect') return rfqs.filter(rfq => /design|architect|interior|finishing/i.test(`${rfq.category ?? ''} ${rfq.title}`));
    return rfqs.filter(rfq => rfq.status === 'open');
  }, [rfqs, role]);

  const activeProjects = projects.filter(project => project.status === 'active');
  const awardedQuotes = myQuotations.filter(quote => quote.status === 'accepted');
  const averageProgress = projectDirectory.length > 0
    ? Math.round(projectDirectory.reduce((sum, project) => sum + Number(project.progress ?? 0), 0) / projectDirectory.length)
    : 0;

  const metrics: Metric[] = role === 'homeowner' ? [
    { label: lang === 'ar' ? 'إجمالي المشاريع' : 'Total Projects', value: projects.length, icon: FolderKanban, tone: 'text-blue-600 bg-blue-50' },
    { label: t('dash.active_projects'), value: activeProjects.length, icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50' },
    { label: t('project.budget'), value: `${t('common.egp')} ${compactNumber(projects.reduce((sum, project) => sum + Number(project.budget ?? 0), 0))}`, icon: DollarSign, tone: 'text-amber-600 bg-amber-50' },
    { label: t('dash.total_spent'), value: `${t('common.egp')} ${compactNumber(projects.reduce((sum, project) => sum + Number(project.spent ?? 0), 0))}`, icon: BarChart3, tone: 'text-violet-600 bg-violet-50' },
  ] : role === 'supplier' ? [
    { label: lang === 'ar' ? 'المنتجات المدرجة' : 'Listed Products', value: products.length, icon: Package, tone: 'text-orange-600 bg-orange-50' },
    { label: lang === 'ar' ? 'طلبات مفتوحة' : 'Open Requests', value: matchingRfqs.length, icon: ClipboardList, tone: 'text-blue-600 bg-blue-50' },
    { label: lang === 'ar' ? 'مخزون منخفض' : 'Low Stock', value: products.filter(product => Number(product.stock ?? 0) < 10).length, icon: PackagePlus, tone: 'text-rose-600 bg-rose-50' },
    { label: lang === 'ar' ? 'عروض الأسعار' : 'My Quotations', value: myQuotations.length, icon: FileText, tone: 'text-violet-600 bg-violet-50' },
  ] : role === 'project_manager' ? [
    { label: t('platform.projects'), value: projectDirectory.length, icon: FolderKanban, tone: 'text-cyan-600 bg-cyan-50' },
    { label: t('dash.active_projects'), value: projectDirectory.filter(project => project.status === 'active').length, icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50' },
    { label: lang === 'ar' ? 'متوسط الإنجاز' : 'Average Progress', value: `${averageProgress}%`, icon: BarChart3, tone: 'text-violet-600 bg-violet-50' },
    { label: lang === 'ar' ? 'الطلبات المفتوحة' : 'Open Requests', value: matchingRfqs.length, icon: ClipboardList, tone: 'text-amber-600 bg-amber-50' },
  ] : [
    { label: lang === 'ar' ? 'الطلبات المؤهلة' : 'Qualified Requests', value: matchingRfqs.length, icon: ClipboardList, tone: 'text-blue-600 bg-blue-50' },
    { label: lang === 'ar' ? 'عروض الأسعار' : 'My Quotations', value: myQuotations.length, icon: FileText, tone: 'text-violet-600 bg-violet-50' },
    { label: lang === 'ar' ? 'العروض المقبولة' : 'Accepted Quotes', value: awardedQuotes.length, icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50' },
    { label: lang === 'ar' ? 'مشاريع متاحة' : 'Project Opportunities', value: projectDirectory.length, icon: BriefcaseBusiness, tone: 'text-amber-600 bg-amber-50' },
  ];

  const actions: RoleCardAction[] = role === 'homeowner' ? [
    { label: t('dash.create_project'), icon: Plus, onClick: () => navigate('/dashboard'), tone: 'text-blue-600' },
    { label: t('dash.get_quotes'), icon: FileText, onClick: () => navigate('/rfq'), tone: 'text-emerald-600' },
    { label: t('dash.explore_market'), icon: ShoppingBag, onClick: () => navigate('/marketplace'), tone: 'text-amber-600' },
    { label: t('dash.ask_ai'), icon: Sparkles, onClick: () => navigate('/ai'), tone: 'text-violet-600' },
  ] : role === 'supplier' ? [
    { label: t('platform.new_listing'), icon: PackagePlus, onClick: () => setProductDialogOpen(true), tone: 'text-orange-600' },
    { label: t('platform.review_requests'), icon: ClipboardList, onClick: () => navigate('/rfq'), tone: 'text-blue-600' },
    { label: t('platform.projects'), icon: BriefcaseBusiness, onClick: () => document.getElementById('role-projects')?.scrollIntoView({ behavior: 'smooth' }), tone: 'text-cyan-600' },
    { label: t('dash.messages'), icon: MessageSquare, onClick: () => navigate('/messages'), tone: 'text-violet-600' },
  ] : role === 'project_manager' ? [
    { label: t('platform.project_queue'), icon: KanbanSquare, onClick: () => document.getElementById('role-projects')?.scrollIntoView({ behavior: 'smooth' }), tone: 'text-cyan-600' },
    { label: t('platform.team'), icon: Users, onClick: () => navigate('/messages'), tone: 'text-violet-600' },
    { label: t('platform.documents'), icon: FileText, onClick: () => document.getElementById('role-projects')?.scrollIntoView({ behavior: 'smooth' }), tone: 'text-amber-600' },
    { label: t('dash.ai'), icon: Sparkles, onClick: () => navigate('/ai'), tone: 'text-emerald-600' },
  ] : [
    { label: t('platform.review_requests'), icon: ClipboardList, onClick: () => document.getElementById('role-rfqs')?.scrollIntoView({ behavior: 'smooth' }), tone: 'text-blue-600' },
    { label: t('platform.projects'), icon: BriefcaseBusiness, onClick: () => document.getElementById('role-projects')?.scrollIntoView({ behavior: 'smooth' }), tone: 'text-amber-600' },
    { label: t('dash.messages'), icon: MessageSquare, onClick: () => navigate('/messages'), tone: 'text-violet-600' },
    { label: t('dash.ai'), icon: Sparkles, onClick: () => navigate('/ai'), tone: 'text-emerald-600' },
  ];

  if (loading || !isAuthenticated || rawRole === 'admin' || accountRole === 'admin') return null;

  return (
    <DashboardLayout>
      <div className="space-y-6" dir={dir}>
        <section className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${copy.accent} p-6 text-white shadow-lg`}>
          <div className="absolute -right-12 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm text-white/80"><Layers3 className="h-4 w-4" /> {t('platform.workspace')}</div>
              <h1 className="text-3xl font-bold tracking-tight">{t(copy.titleKey)}</h1>
              <p className="mt-2 max-w-2xl text-sm text-white/80">{t(copy.subtitleKey)}</p>
            </div>
            <Badge className="w-fit border-white/30 bg-white/15 text-white hover:bg-white/20">{roleLabel(role, lang)}</Badge>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {metrics.map(metric => (
            <Card key={metric.label}>
              <CardContent className="flex items-center gap-3 p-5">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${metric.tone}`}><metric.icon className="h-5 w-5" /></div>
                <div className="min-w-0"><p className="truncate text-lg font-bold">{metric.value}</p><p className="truncate text-xs text-muted-foreground">{metric.label}</p></div>
              </CardContent>
            </Card>
          ))}
        </div>

        <section>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">{t('dash.quick_actions')}</h2><span className="text-xs text-muted-foreground">{roleLabel(role, lang)}</span></div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {actions.map(action => (
              <button key={action.label} type="button" onClick={action.onClick} className="group rounded-xl border bg-card p-4 text-start transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
                <action.icon className={`mb-3 h-5 w-5 ${action.tone}`} />
                <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{action.label}</span><ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></div>
              </button>
            ))}
          </div>
        </section>

        {role === 'homeowner' ? (
          <HomeownerWorkspace projects={projects} t={t} lang={lang} navigate={navigate} />
        ) : role === 'supplier' ? (
          <SupplierWorkspace products={products} rfqs={matchingRfqs} projects={projectDirectory} t={t} lang={lang} navigate={navigate} onQuote={(rfqId) => { setQuoteForm(form => ({ ...form, rfqId })); setQuoteDialogOpen(true); }} />
        ) : role === 'contractor' ? (
          <ContractorWorkspace rfqs={matchingRfqs} projects={projectDirectory} quotations={myQuotations} t={t} lang={lang} navigate={navigate} onQuote={(rfqId: number) => { setQuoteForm(form => ({ ...form, rfqId })); setQuoteDialogOpen(true); }} />
        ) : role === 'engineer' ? (
          <EngineerWorkspace rfqs={matchingRfqs} projects={projectDirectory} t={t} lang={lang} navigate={navigate} onQuote={(rfqId: number) => { setQuoteForm(form => ({ ...form, rfqId })); setQuoteDialogOpen(true); }} />
        ) : role === 'architect' ? (
          <ArchitectWorkspace rfqs={matchingRfqs} projects={projectDirectory} t={t} lang={lang} navigate={navigate} onQuote={(rfqId: number) => { setQuoteForm(form => ({ ...form, rfqId })); setQuoteDialogOpen(true); }} />
        ) : (
          <ProjectManagerWorkspace projects={projectDirectory} rfqs={matchingRfqs} t={t} lang={lang} />
        )}

        <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{t('platform.new_listing')}</DialogTitle></DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder={lang === 'ar' ? 'اسم المنتج' : 'Product name'} value={productForm.name} onChange={e => setProductForm(form => ({ ...form, name: e.target.value }))} />
              <Input placeholder={lang === 'ar' ? 'الاسم بالعربية' : 'Arabic name'} value={productForm.nameAr} onChange={e => setProductForm(form => ({ ...form, nameAr: e.target.value }))} />
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={productForm.category} onChange={e => setProductForm(form => ({ ...form, category: e.target.value }))}><option value="">{lang === 'ar' ? 'اختر الفئة' : 'Choose category'}</option>{PRODUCT_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}</select>
              <Input placeholder={lang === 'ar' ? 'العلامة التجارية' : 'Brand'} value={productForm.brand} onChange={e => setProductForm(form => ({ ...form, brand: e.target.value }))} />
              <Input placeholder={lang === 'ar' ? 'السعر بالجنيه' : 'Price in EGP'} type="number" value={productForm.price} onChange={e => setProductForm(form => ({ ...form, price: e.target.value }))} />
              <Input placeholder={lang === 'ar' ? 'المخزون' : 'Stock'} type="number" value={productForm.stock} onChange={e => setProductForm(form => ({ ...form, stock: e.target.value }))} />
              <Input placeholder={lang === 'ar' ? 'الوحدة' : 'Unit'} value={productForm.unit} onChange={e => setProductForm(form => ({ ...form, unit: e.target.value }))} />
              <Input placeholder={lang === 'ar' ? 'أيام التوصيل' : 'Delivery days'} type="number" value={productForm.deliveryDays} onChange={e => setProductForm(form => ({ ...form, deliveryDays: e.target.value }))} />
              <Textarea className="sm:col-span-2" placeholder={lang === 'ar' ? 'وصف المنتج' : 'Product description'} rows={3} value={productForm.description} onChange={e => setProductForm(form => ({ ...form, description: e.target.value }))} />
            </div>
            <Button onClick={() => createProduct.mutate({ name: productForm.name, nameAr: productForm.nameAr || undefined, category: productForm.category, description: productForm.description || undefined, brand: productForm.brand || undefined, price: productForm.price ? Number(productForm.price) : undefined, stock: productForm.stock ? Number(productForm.stock) : undefined, unit: productForm.unit || undefined, deliveryDays: productForm.deliveryDays ? Number(productForm.deliveryDays) : undefined })} disabled={createProduct.isPending || !productForm.name || !productForm.category} className="w-full gap-2"><PackagePlus className="h-4 w-4" />{createProduct.isPending ? t('common.loading') : t('platform.new_listing')}</Button>
          </DialogContent>
        </Dialog>

        <Dialog open={quoteDialogOpen} onOpenChange={setQuoteDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{t('platform.create_quote')}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder={lang === 'ar' ? 'السعر بالجنيه' : 'Your price (EGP)'} type="number" value={quoteForm.price} onChange={e => setQuoteForm(form => ({ ...form, price: e.target.value }))} />
              <Input placeholder={lang === 'ar' ? 'المدة بالأيام' : 'Timeline in days'} type="number" value={quoteForm.timeline} onChange={e => setQuoteForm(form => ({ ...form, timeline: e.target.value }))} />
              <Input placeholder={t('common.warranty')} value={quoteForm.warranty} onChange={e => setQuoteForm(form => ({ ...form, warranty: e.target.value }))} />
              <Textarea placeholder={t('common.notes')} rows={3} value={quoteForm.notes} onChange={e => setQuoteForm(form => ({ ...form, notes: e.target.value }))} />
              <Button className="w-full gap-2" onClick={() => submitQuote.mutate({ rfqId: quoteForm.rfqId, price: Number(quoteForm.price), timeline: quoteForm.timeline ? Number(quoteForm.timeline) : undefined, warranty: quoteForm.warranty || undefined, notes: quoteForm.notes || undefined })} disabled={submitQuote.isPending || !quoteForm.price}><Send className="h-4 w-4" />{submitQuote.isPending ? t('common.loading') : t('platform.create_quote')}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

function HomeownerWorkspace({ projects, t, lang, navigate }: { projects: any[]; t: (key: string) => string; lang: 'en' | 'ar'; navigate: (path: string) => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
      <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="flex items-center gap-2"><FolderKanban className="h-5 w-5" />{t('dash.recent_projects')}</CardTitle><Button variant="outline" size="sm" onClick={() => navigate('/dashboard')}>{t('dash.view_all')}</Button></CardHeader><CardContent>{projects.length === 0 ? <EmptyState text={t('dash.no_projects')} /> : <div className="space-y-3">{projects.slice(0, 5).map(project => <div key={project.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{project.title}</p><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{project.location || (lang === 'ar' ? 'لم يحدد الموقع' : 'Location not set')}</p></div><Badge variant="secondary">{localizedStatus(project.status, t)}</Badge></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${project.progress ?? 0}%` }} /></div><div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>{t('project.progress')}</span><span>{project.progress ?? 0}%</span></div></div>)}</div>}</CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-500" />{t('dash.ask_ai')}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{lang === 'ar' ? 'احصل على تقدير أولي للتكلفة ونصائح للمواد والجدول الزمني.' : 'Get an early cost estimate and practical guidance on materials and timelines.'}</p><Button className="mt-4 w-full" onClick={() => navigate('/ai')}>{t('dash.ask_ai')}</Button></CardContent></Card>
    </div>
  );
}

function ContractorWorkspace({ rfqs, projects, quotations, t, lang, navigate, onQuote }: { rfqs: any[]; projects: any[]; quotations: any[]; t: (key: string) => string; lang: 'en' | 'ar'; navigate: (path: string) => void; onQuote: (rfqId: number) => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
      <Card id="role-rfqs"><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />{lang === 'ar' ? 'مسار استلام طلبات الأسعار' : 'Contractor RFQ Pipeline'}</CardTitle><Button variant="outline" size="sm" onClick={() => navigate('/rfq')}>{t('platform.view')}</Button></CardHeader><CardContent>{rfqs.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="space-y-3">{rfqs.slice(0, 6).map(rfq => <div key={rfq.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{rfq.title}</p><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{rfq.description}</p><div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">{rfq.category && <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{rfq.category}</span>}{rfq.budget && <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />{t('common.egp')} {Number(rfq.budget).toLocaleString()}</span>}{rfq.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{rfq.location}</span>}</div></div><Button size="sm" className="shrink-0 gap-1.5" onClick={() => onQuote(rfq.id)}><Send className="h-3.5 w-3.5" />{t('platform.create_quote')}</Button></div></div>)}</div>}</CardContent></Card>
      <Card id="role-projects"><CardHeader><CardTitle className="flex items-center gap-2"><BriefcaseBusiness className="h-5 w-5" />{lang === 'ar' ? 'إدارة المشاريع الميدانية' : 'Active Field Projects'}</CardTitle></CardHeader><CardContent>{projects.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="space-y-3">{projects.slice(0, 5).map(project => <div key={project.id} className="rounded-xl border p-3"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{project.title}</p><Badge variant="outline">{localizedStatus(project.status, t)}</Badge></div><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{project.location || (lang === 'ar' ? 'الموقع غير محدد' : 'Location not set')}</span><span>{project.progress ?? 0}%</span></div></div>)}</div>}</CardContent></Card>
      <Card className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />{lang === 'ar' ? 'عروض أسعار المقاول' : 'Submitted Quotations & Team Execution'}</CardTitle></CardHeader><CardContent>{quotations.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="grid gap-3 md:grid-cols-2">{quotations.slice(0, 6).map(quote => <div key={quote.id} className="rounded-xl border p-3"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{quote.rfqTitle || `RFQ #${quote.rfqId}`}</p><Badge variant={quote.status === 'accepted' ? 'default' : 'secondary'}>{localizedStatus(quote.status, t)}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{t('common.egp')} {Number(quote.price).toLocaleString()} · {quote.timeline || '—'} {t('common.days')}</p></div>)}</div>}</CardContent></Card>
    </div>
  );
}

function EngineerWorkspace({ rfqs, projects, t, lang, navigate, onQuote }: { rfqs: any[]; projects: any[]; t: (key: string) => string; lang: 'en' | 'ar'; navigate: (path: string) => void; onQuote: (rfqId: number) => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><PenTool className="h-5 w-5" />{lang === 'ar' ? 'المستندات الهندسية وجداول الكميات' : 'Technical Deliverables & BOQ Review'}</CardTitle></CardHeader><CardContent><div className="space-y-3"><div className="rounded-xl border p-4"><p className="font-medium">{lang === 'ar' ? 'مراجعة المخططات الإنشائية' : 'Structural Calculations & Drawing Review'}</p><p className="mt-1 text-sm text-muted-foreground">{lang === 'ar' ? 'تحقق من الأحمال وجداول التسليح للمشاريع النشطة.' : 'Validate load requirements and reinforcement schedules for active builds.'}</p><Button size="sm" className="mt-3 gap-2" onClick={() => navigate('/ai')}><Sparkles className="h-4 w-4" />{lang === 'ar' ? 'تحليل بالذكاء الاصطناعي' : 'Run AI Analysis'}</Button></div><div className="rounded-xl border p-4"><p className="font-medium">{lang === 'ar' ? 'فحص جودة المواد' : 'Material Quality Inspection'}</p><p className="mt-1 text-sm text-muted-foreground">{lang === 'ar' ? 'تدقيق مطابقة الموردين للمواصفات الفنية.' : 'Audit supplier specifications against engineering standards.'}</p></div></div></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />{lang === 'ar' ? 'الطلبات الهندسية' : 'Engineering RFQs'}</CardTitle></CardHeader><CardContent>{rfqs.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="space-y-3">{rfqs.slice(0, 5).map(rfq => <div key={rfq.id} className="rounded-xl border p-3"><p className="truncate text-sm font-medium">{rfq.title}</p><div className="mt-2 flex items-center justify-between"><span className="text-xs text-muted-foreground">{rfq.category || 'Engineering'}</span><Button size="sm" onClick={() => onQuote(rfq.id)}>{t('platform.create_quote')}</Button></div></div>)}</div>}</CardContent></Card>
      <Card className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><BriefcaseBusiness className="h-5 w-5" />{lang === 'ar' ? 'المشاريع الهندسية النشطة' : 'Active Engineering Projects'}</CardTitle></CardHeader><CardContent>{projects.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="grid gap-3 md:grid-cols-3">{projects.slice(0, 6).map(project => <div key={project.id} className="rounded-xl border p-3"><p className="font-medium">{project.title}</p><p className="mt-1 text-xs text-muted-foreground">{project.location || '—'}</p><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{t('project.progress')}</span><span>{project.progress ?? 0}%</span></div></div>)}</div>}</CardContent></Card>
    </div>
  );
}

function ArchitectWorkspace({ rfqs, projects, t, lang, navigate, onQuote }: { rfqs: any[]; projects: any[]; t: (key: string) => string; lang: 'en' | 'ar'; navigate: (path: string) => void; onQuote: (rfqId: number) => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><PenTool className="h-5 w-5" />{lang === 'ar' ? 'معرض التصاميم وتقديم الأفكار' : 'Design Portfolio & Concept Presentation'}</CardTitle></CardHeader><CardContent><div className="space-y-3"><div className="rounded-xl border p-4"><p className="font-medium">{lang === 'ar' ? 'إدارة تصاميم الفلل والتشطيبات الفاخرة' : 'Luxury Villa & Finishing Concept Deck'}</p><p className="mt-1 text-sm text-muted-foreground">{lang === 'ar' ? 'اعرض مقترحاتك المعمارية وعروض العميل مباشرة عبر المنصة.' : 'Present architectural renderings and client mood boards directly in workspace.'}</p><Button size="sm" className="mt-3 gap-2" onClick={() => navigate('/ai')}><Sparkles className="h-4 w-4" />{lang === 'ar' ? 'توليد أفكار التصميم' : 'AI Design Ideation'}</Button></div></div></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />{lang === 'ar' ? 'فرص التصميم والتشطيب' : 'Design RFQs'}</CardTitle></CardHeader><CardContent>{rfqs.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="space-y-3">{rfqs.slice(0, 5).map(rfq => <div key={rfq.id} className="rounded-xl border p-3"><p className="truncate text-sm font-medium">{rfq.title}</p><div className="mt-2 flex items-center justify-between"><span className="text-xs text-muted-foreground">{rfq.category || 'Architecture'}</span><Button size="sm" onClick={() => onQuote(rfq.id)}>{t('platform.create_quote')}</Button></div></div>)}</div>}</CardContent></Card>
      <Card className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><FolderKanban className="h-5 w-5" />{lang === 'ar' ? 'مشاريع التصميم المعماري' : 'Active Architectural Projects'}</CardTitle></CardHeader><CardContent>{projects.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="grid gap-3 md:grid-cols-3">{projects.slice(0, 6).map(project => <div key={project.id} className="rounded-xl border p-3"><p className="font-medium">{project.title}</p><p className="mt-1 text-xs text-muted-foreground">{project.location || '—'}</p><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{t('project.progress')}</span><span>{project.progress ?? 0}%</span></div></div>)}</div>}</CardContent></Card>
    </div>
  );
}

function SupplierWorkspace({ products, rfqs, projects, t, lang, navigate, onQuote }: { products: any[]; rfqs: any[]; projects: any[]; t: (key: string) => string; lang: 'en' | 'ar'; navigate: (path: string) => void; onQuote: (rfqId: number) => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="flex items-center gap-2"><Package className="h-5 w-5" />{t('platform.catalogue')}</CardTitle><Button variant="outline" size="sm" onClick={() => navigate('/marketplace/products')}>{t('platform.view')}</Button></CardHeader><CardContent>{products.length === 0 ? <EmptyState text={lang === 'ar' ? 'أضف أول منتج إلى كتالوجك' : 'Add your first product to the catalogue'} /> : <div className="space-y-3">{products.slice(0, 6).map(product => <div key={product.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{lang === 'ar' && product.nameAr ? product.nameAr : product.name}</p><p className="mt-1 text-xs text-muted-foreground">{product.category} · {product.stock ?? 0} {product.unit || (lang === 'ar' ? 'وحدة' : 'units')}</p></div><span className="text-sm font-semibold">{product.price ? `${t('common.egp')} ${Number(product.price).toLocaleString()}` : '—'}</span></div>)}</div>}</CardContent></Card>
      <Card id="role-rfqs"><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />{t('platform.review_requests')}</CardTitle></CardHeader><CardContent>{rfqs.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="space-y-3">{rfqs.slice(0, 5).map(rfq => <div key={rfq.id} className="rounded-xl border p-3"><p className="truncate text-sm font-medium">{rfq.title}</p><div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{rfq.category || (lang === 'ar' ? 'عام' : 'General')}</span><Button size="sm" onClick={() => onQuote(rfq.id)} className="gap-1.5"><Send className="h-3 w-3" />{t('platform.create_quote')}</Button></div></div>)}</div>}</CardContent></Card>
      <Card id="role-projects" className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><BriefcaseBusiness className="h-5 w-5" />{t('platform.projects')}</CardTitle></CardHeader><CardContent>{projects.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="grid gap-3 md:grid-cols-2">{projects.slice(0, 6).map(project => <div key={project.id} className="rounded-xl border p-3"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{project.title}</p><Badge variant="outline">{localizedStatus(project.status, t)}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{project.location || (lang === 'ar' ? 'الموقع غير محدد' : 'Location not set')}</p><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{t('project.progress')}</span><span>{project.progress ?? 0}%</span></div></div>)}</div>}</CardContent></Card>
    </div>
  );
}

function ProjectManagerWorkspace({ projects, rfqs, t, lang }: { projects: any[]; rfqs: any[]; t: (key: string) => string; lang: 'en' | 'ar' }) {
  return (
    <div id="role-projects" className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><KanbanSquare className="h-5 w-5" />{t('platform.project_queue')}</CardTitle></CardHeader><CardContent>{projects.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="grid gap-3 md:grid-cols-2">{projects.slice(0, 8).map(project => <div key={project.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-2"><p className="font-medium">{project.title}</p><Badge variant="outline">{localizedStatus(project.status, t)}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{project.location || (lang === 'ar' ? 'الموقع غير محدد' : 'Location not set')}</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-cyan-500" style={{ width: `${project.progress ?? 0}%` }} /></div><div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>{t('project.progress')}</span><span>{project.progress ?? 0}%</span></div></div>)}</div>}</CardContent></Card>
      <Card id="role-rfqs"><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />{lang === 'ar' ? 'نظرة على الطلبات' : 'Request Overview'}</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{rfqs.length}</p><p className="mt-1 text-sm text-muted-foreground">{lang === 'ar' ? 'طلبات مفتوحة يمكن متابعتها مع الفرق' : 'open requests to coordinate with delivery teams'}</p><div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Users className="h-4 w-4" />{lang === 'ar' ? 'التنسيق مع أصحاب المصلحة' : 'Coordinate with stakeholders'}</div></CardContent></Card>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">{text}</div>;
}
