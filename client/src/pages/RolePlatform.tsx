import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/_core/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { getRolePlatformPath, isPlatformRole, ROLE_PLATFORM_COPY, type PlatformRole } from '@/lib/rolePlatform';
import { trpc } from '@/lib/trpc';
import { PRODUCT_CATEGORIES, isProductCategory } from '@shared/productCategories';
import ProductImport from '@/components/ProductImport';
import { isComplianceRole } from '@shared/compliance';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useEffect, useMemo, useState, useRef } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { parseLinkedRfqId } from '@shared/linkedRfq';
import { toast } from 'sonner';
import VendorProfileCard from '@/components/VendorProfileCard';
import VendorReputation from '@/components/VendorReputation';
import VendorAnalytics from '@/components/VendorAnalytics';
import VendorServiceCategories from '@/components/VendorServiceCategories';
import QualifiedEnquiries from '@/components/QualifiedEnquiries';
import VendorBilling from '@/components/VendorBilling';
import SupplierCatalogue from '@/components/SupplierCatalogue';
import { useHashSection, revealSection } from '@/hooks/useSectionAnchor';
import type { SectionId } from '@shared/roleWorkspaceSections';
import {
  ArrowUpRight, BarChart3, BriefcaseBusiness, Camera, CheckCircle2, ClipboardList,
  Clock3, DollarSign, FileText, FolderKanban, KanbanSquare, Layers3, MapPin, MessageSquare,
  Package, PackagePlus, PenTool, Plus, Send, ShoppingBag, Sparkles, Star, Users, Paperclip, X
} from 'lucide-react';


type RoleCardAction = { label: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void; tone: string };

/**
 * `section` is where this number LIVES. A KPI that counts records the reader
 * can then go and look at is navigation; one that counts records with no
 * surface is decoration. Metrics without a section stay deliberately
 * non-interactive rather than becoming a card that looks clickable and is not.
 */
type Metric = { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; tone: string; section?: SectionId };

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
  /**
   * `?rfq=<id>` - the request a provider followed here from `/rfq/:id`.
   *
   * The RFQ detail page used to send them to a bare `/provider`, which meant
   * arriving on a dashboard and having to find the request again in a list.
   * The id travels with them now. It is used only to bring that row into view
   * and to preselect the quotation form: nothing is opened, nothing is charged,
   * and the server still decides everything about eligibility.
   */
  const linkedRfqId = parseLinkedRfqId(useSearch());
  const account = user as { userRole?: string; role?: string; onboardingStatus?: string } | null;
  const rawRole = account?.userRole;
  const accountRole = account?.role;
  const onboardingStatus = account?.onboardingStatus;
  const role: PlatformRole = isPlatformRole(rawRole) ? rawRole : 'homeowner';
  const requestedRole = typeof window !== 'undefined' ? window.location.pathname.split('/').pop() : '';

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate('/auth?mode=login');
    if (!loading && isAuthenticated && (rawRole === 'admin' || accountRole === 'admin')) navigate('/admin');
    if (!loading && isAuthenticated && isComplianceRole(rawRole) && onboardingStatus !== 'approved') navigate('/compliance');
    if (!loading && isAuthenticated && isPlatformRole(rawRole) && requestedRole !== rawRole) {
      navigate(getRolePlatformPath(rawRole));
    }
  }, [loading, isAuthenticated, rawRole, accountRole, onboardingStatus, requestedRole, navigate]);

  const isProfessional = role !== 'homeowner';
  const isSupplier = role === 'supplier';
  const utils = trpc.useUtils();
  const copy = ROLE_PLATFORM_COPY[role];
  const { data: projects = [] } = trpc.projects.list.useQuery(undefined, { enabled: isAuthenticated && role === 'homeowner' });
  const { data: projectDirectory = [] } = trpc.projects.directory.useQuery(undefined, { enabled: isAuthenticated && isProfessional });
  const { data: rfqs = [] } = trpc.rfq.list.useQuery(undefined, { enabled: isAuthenticated });
  const { data: myQuotations = [] } = trpc.rfq.myQuotations.useQuery(undefined, { enabled: isAuthenticated && isProfessional });
  const { data: products = [] } = trpc.marketplace.myProducts.useQuery(undefined, { enabled: isAuthenticated && isSupplier });
  // Own vendor profile, used only to pass this account's id to VendorReputation below -
  // VendorProfileCard fetches/renders the same query itself (react-query dedupes the
  // identical call into one request; this is not a second profile implementation).
  const { data: ownProfile } = trpc.profile.getOwn.useQuery(undefined, { enabled: isAuthenticated && isProfessional });
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  // Preselected from `?rfq=` so a provider who followed a link from the request
  // does not have to find it again in the list.
  const [quoteForm, setQuoteForm] = useState({ rfqId: linkedRfqId ?? 0, price: '', timeline: '', warranty: '', notes: '' });
  /**
   * The supplier's supporting files for this quotation.
   *
   * Until this existed a supplier could send a price, a timeline, a warranty
   * string and free text - and no proposal, specification, certificate or
   * photograph. A customer comparing two numbers with no documents behind them
   * is not really comparing anything.
   */
  const [quoteFiles, setQuoteFiles] = useState<{ key: string; url: string; name: string; type: string; size: number }[]>([]);
  const [quoteUploading, setQuoteUploading] = useState(false);
  const quoteFileInput = useRef<HTMLInputElement | null>(null);
  const uploadQuoteFile = trpc.rfq.uploadQuotationAttachment.useMutation();

  async function attachQuoteFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setQuoteUploading(true);
    for (const file of Array.from(files).slice(0, 6 - quoteFiles.length)) {
      // Mirrors the server's own limits so the answer arrives before the
      // upload, not after it. The server repeats both and its verdict counts.
      if (file.size > 8 * 1024 * 1024) {
        toast.error(lang === 'ar' ? `${file.name}: الحد الأقصى 8 ميجابايت` : `${file.name}: maximum 8MB`);
        continue;
      }
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
          reader.onerror = () => reject(new Error('read failed'));
          reader.readAsDataURL(file);
        });
        const uploaded = await uploadQuoteFile.mutateAsync({
          fileName: file.name, contentType: file.type, base64,
        });
        setQuoteFiles(prev => [...prev, uploaded]);
      } catch (error) {
        // The server owns the refusal reason - wrong bytes, too large, rate
        // limited, storage unconfigured. Its message is shown, not a guess.
        toast.error((error as { message?: string })?.message
          ?? (lang === 'ar' ? `تعذر رفع ${file.name}` : `Could not upload ${file.name}`));
      }
    }
    setQuoteUploading(false);
    if (quoteFileInput.current) quoteFileInput.current.value = '';
  }
  // The request the open quotation form is actually about. A form that says
  // only "Your price" is a way to bid on the wrong thing.
  const quoteTarget = rfqs.find(rfq => rfq.id === quoteForm.rfqId);

  const submitQuote = trpc.rfq.submitQuotation.useMutation({
    onSuccess: () => {
      toast.success(lang === 'ar' ? 'تم تقديم عرض السعر' : 'Quotation submitted');
      setQuoteDialogOpen(false);
      setQuoteForm({ rfqId: 0, price: '', timeline: '', warranty: '', notes: '' });
      setQuoteFiles([]);
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
    { label: lang === 'ar' ? 'إجمالي المشاريع' : 'Total Projects', value: projects.length, icon: FolderKanban, tone: 'text-blue-600 bg-blue-50', section: 'role-projects' },
    { label: t('dash.active_projects'), value: activeProjects.length, icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50', section: 'role-projects' },
    { label: t('project.budget'), value: `${t('common.egp')} ${compactNumber(projects.reduce((sum, project) => sum + Number(project.budget ?? 0), 0))}`, icon: DollarSign, tone: 'text-amber-600 bg-amber-50' },
    { label: t('dash.total_spent'), value: `${t('common.egp')} ${compactNumber(projects.reduce((sum, project) => sum + Number(project.spent ?? 0), 0))}`, icon: BarChart3, tone: 'text-violet-600 bg-violet-50' },
  ] : role === 'supplier' ? [
    { label: lang === 'ar' ? 'المنتجات المدرجة' : 'Listed Products', value: products.length, icon: Package, tone: 'text-orange-600 bg-orange-50', section: 'role-catalogue' },
    { label: lang === 'ar' ? 'طلبات مفتوحة' : 'Open Requests', value: matchingRfqs.length, icon: ClipboardList, tone: 'text-blue-600 bg-blue-50', section: 'role-rfqs' },
    { label: lang === 'ar' ? 'مخزون منخفض' : 'Low Stock', value: products.filter(product => Number(product.stock ?? 0) < 10).length, icon: PackagePlus, tone: 'text-rose-600 bg-rose-50', section: 'role-catalogue' },
    { label: lang === 'ar' ? 'عروض الأسعار' : 'My Quotations', value: myQuotations.length, icon: FileText, tone: 'text-violet-600 bg-violet-50', section: 'role-quotations' },
  ] : role === 'project_manager' ? [
    { label: t('platform.projects'), value: projectDirectory.length, icon: FolderKanban, tone: 'text-cyan-600 bg-cyan-50', section: 'role-queue' },
    { label: t('dash.active_projects'), value: projectDirectory.filter(project => project.status === 'active').length, icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50', section: 'role-queue' },
    { label: lang === 'ar' ? 'متوسط الإنجاز' : 'Average Progress', value: `${averageProgress}%`, icon: BarChart3, tone: 'text-violet-600 bg-violet-50', section: 'role-queue' },
    { label: lang === 'ar' ? 'الطلبات المفتوحة' : 'Open Requests', value: matchingRfqs.length, icon: ClipboardList, tone: 'text-amber-600 bg-amber-50', section: 'role-rfqs' },
  ] : [
    // The contractor's requests card is the pipeline; engineer and architect
    // carry role-rfqs. All three now render a quotations surface, so all three
    // quotation KPIs lead to it - previously only the contractor's did, because
    // only the contractor had somewhere for them to go.
    { label: lang === 'ar' ? 'الطلبات المؤهلة' : 'Qualified Requests', value: matchingRfqs.length, icon: ClipboardList, tone: 'text-blue-600 bg-blue-50', section: role === 'contractor' ? 'role-pipeline' : 'role-rfqs' },
    { label: lang === 'ar' ? 'عروض الأسعار' : 'My Quotations', value: myQuotations.length, icon: FileText, tone: 'text-violet-600 bg-violet-50', section: 'role-quotations' },
    { label: lang === 'ar' ? 'العروض المقبولة' : 'Accepted Quotes', value: awardedQuotes.length, icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50', section: 'role-quotations' },
    { label: lang === 'ar' ? 'مشاريع متاحة' : 'Project Opportunities', value: projectDirectory.length, icon: BriefcaseBusiness, tone: 'text-amber-600 bg-amber-50', section: 'role-projects' },
  ];

  const actions: RoleCardAction[] = role === 'homeowner' ? [
    { label: t('dash.create_project'), icon: Plus, onClick: () => navigate('/dashboard'), tone: 'text-blue-600' },
    { label: t('dash.get_quotes'), icon: FileText, onClick: () => navigate('/rfq'), tone: 'text-emerald-600' },
    { label: t('dash.explore_market'), icon: ShoppingBag, onClick: () => navigate('/marketplace'), tone: 'text-amber-600' },
    { label: t('dash.ask_ai'), icon: Sparkles, onClick: () => navigate('/ai'), tone: 'text-violet-600' },
  ] : role === 'supplier' ? [
    { label: t('platform.new_listing'), icon: PackagePlus, onClick: () => navigate('/products/new'), tone: 'text-orange-600' },
    { label: t('platform.review_requests'), icon: ClipboardList, onClick: () => navigate('/rfq'), tone: 'text-blue-600' },
    { label: t('platform.projects'), icon: BriefcaseBusiness, onClick: () => goToSection('role-projects'), tone: 'text-cyan-600' },
    { label: t('dash.messages'), icon: MessageSquare, onClick: () => navigate('/messages'), tone: 'text-violet-600' },
  ] : role === 'project_manager' ? [
    { label: t('platform.project_queue'), icon: KanbanSquare, onClick: () => goToSection('role-queue'), tone: 'text-cyan-600' },
    { label: t('platform.team'), icon: Users, onClick: () => navigate('/messages'), tone: 'text-violet-600' },
    /* "Documents" used to sit here and scroll to the project list. A project
       manager's documents live on a project, not on this page, and a shortcut
       that lands somewhere other than its label is the same defect as one that
       lands nowhere. The open requests ARE on this page. */
    { label: t('provider.open_rfqs'), icon: ClipboardList, onClick: () => goToSection('role-rfqs'), tone: 'text-amber-600' },
    { label: t('dash.ai'), icon: Sparkles, onClick: () => navigate('/ai'), tone: 'text-emerald-600' },
  ] : role === 'contractor' ? [
    /* The contractor's requests card is the PIPELINE, not a generic RFQ list:
       it carries id="role-pipeline" and there is no role-rfqs on this
       workspace, so the old shared shortcut scrolled to an element that does
       not exist here. */
    { label: t('platform.pipeline'), icon: ClipboardList, onClick: () => goToSection('role-pipeline'), tone: 'text-blue-600' },
    { label: t('platform.projects'), icon: BriefcaseBusiness, onClick: () => goToSection('role-projects'), tone: 'text-amber-600' },
    { label: t('dash.messages'), icon: MessageSquare, onClick: () => navigate('/messages'), tone: 'text-violet-600' },
    { label: t('dash.ai'), icon: Sparkles, onClick: () => navigate('/ai'), tone: 'text-emerald-600' },
  ] : [
    { label: t('platform.review_requests'), icon: ClipboardList, onClick: () => goToSection('role-rfqs'), tone: 'text-blue-600' },
    { label: t('platform.projects'), icon: BriefcaseBusiness, onClick: () => goToSection('role-projects'), tone: 'text-amber-600' },
    { label: t('dash.messages'), icon: MessageSquare, onClick: () => navigate('/messages'), tone: 'text-violet-600' },
    { label: t('dash.ai'), icon: Sparkles, onClick: () => navigate('/ai'), tone: 'text-emerald-600' },
  ];

  // LANDING ON THE SECTION THE URL NAMES.
  //
  // The workspace is one long page, so its sections are addressed by hash.
  // Arriving at /platform/supplier#role-catalogue must put the catalogue in
  // front of the reader, and so must clicking Catalogue again from the
  // sidebar. The sections are rendered by queries that resolve after the first
  // paint, so a single attempt on mount lands on a page that is still short;
  // this retries briefly until the element exists.
  // Pushing the section into the URL rather than only scrolling: the address
  // bar then names what the reader is looking at, back/forward work, and the
  // link is shareable. revealSection also highlights, so a section already on
  // screen still acknowledges the click.
  const goToSection = (section: SectionId) => {
    const next = `${window.location.pathname}#${section}`;
    if (window.location.pathname + window.location.hash !== next) {
      window.history.pushState(null, '', next);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
    revealSection(section);
  };

  const hashSection = useHashSection();
  useEffect(() => {
    if (!hashSection) return;
    let attempts = 0;
    const tick = () => {
      if (revealSection(hashSection) || ++attempts > 20) return;
      window.setTimeout(tick, 150);
    };
    tick();
  }, [hashSection]);

  if (loading || !isAuthenticated || rawRole === 'admin' || accountRole === 'admin') return null;

  return (
    <DashboardLayout>
      <div className="space-y-6" dir={dir}>
        <section id="role-overview" className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${copy.accent} p-6 text-white shadow-lg`}>
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
            <Card
              key={metric.label}
              {...(metric.section ? {
                role: 'button' as const,
                tabIndex: 0,
                'data-testid': `kpi-${metric.section}`,
                className: 'cursor-pointer transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                onClick: () => goToSection(metric.section!),
                onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); goToSection(metric.section!); } },
              } : {})}
            >
              {/* Stacks below `sm`. Two columns minus a fixed 44px icon, the gap
                  and the padding left about 63px for the label, and `truncate`
                  then clipped it: measured at 375px, "Total Projects" wanted
                  72px, "Active Projects" 79px. English degraded to a guessable
                  "Total Projec...", but Arabic - longer words, and the label is
                  the only thing naming the number - degraded to "إجمالي ال...",
                  which identifies nothing. A metric whose label is unreadable is
                  not a metric. The label now wraps instead of clipping. */}
              <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${metric.tone}`}><metric.icon className="h-5 w-5" /></div>
                <div className="w-full min-w-0"><p className="truncate text-lg font-bold">{metric.value}</p><p className="text-xs text-muted-foreground">{metric.label}</p></div>
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
          <>
          <HomeownerWorkspace projects={projects} t={t} lang={lang} navigate={navigate} />
          {/* A homeowner's own profile was editable nowhere: the sidebar's
              "Settings" entry pointed at this page, which had no settings on
              it, and the profile editor was rendered only inside the
              professional-only performance block. It is the same self-scoped
              card and the same self-only backend - there was never a reason
              for it to be provider-only. */}
          </>
        ) : role === 'supplier' ? (
          <>
          {/* Full catalogue management: edit, images, publish/delist, and the
              answer side of the product Q&A. The workspace card below is a
              read-only summary; this is where a supplier actually works. */}
          <div id="role-catalogue"><SupplierCatalogue /></div>
          {/* Bulk import: a vendor with a real catalogue cannot add products
              one dialog at a time. Preview first, then commit. */}
          <ProductImport onImported={() => { void utils.marketplace.myProducts.invalidate(); }} />
          <SupplierWorkspace products={products} rfqs={matchingRfqs} projects={projectDirectory} quotations={myQuotations} t={t} lang={lang} navigate={navigate} onQuote={(rfqId) => { setQuoteForm(form => ({ ...form, rfqId })); setQuoteDialogOpen(true); }} />
          </>
        ) : role === 'contractor' ? (
          <ContractorWorkspace rfqs={matchingRfqs} projects={projectDirectory} quotations={myQuotations} t={t} lang={lang} navigate={navigate} onQuote={(rfqId: number) => { setQuoteForm(form => ({ ...form, rfqId })); setQuoteDialogOpen(true); }} />
        ) : role === 'engineer' ? (
          <EngineerWorkspace rfqs={matchingRfqs} projects={projectDirectory} quotations={myQuotations} t={t} lang={lang} navigate={navigate} onQuote={(rfqId: number) => { setQuoteForm(form => ({ ...form, rfqId })); setQuoteDialogOpen(true); }} />
        ) : role === 'architect' ? (
          <ArchitectWorkspace rfqs={matchingRfqs} projects={projectDirectory} quotations={myQuotations} t={t} lang={lang} navigate={navigate} ownProfileId={ownProfile?.id} onQuote={(rfqId: number) => { setQuoteForm(form => ({ ...form, rfqId })); setQuoteDialogOpen(true); }} />
        ) : (
          <ProjectManagerWorkspace projects={projectDirectory} rfqs={matchingRfqs} t={t} lang={lang} navigate={navigate} />
        )}

        {/* Phase 4B.3: service-category declaration + the qualified-enquiry
            inbox. Placed in the vendor's own reachable workspace, the same
            surface Phase 4A.6.4 established as the real vendor dashboard. */}
        {/* Phase 4B Slice 2: the vendor's own plan and billing state. Placed
            directly above the enquiry inbox, because the allowance shown there
            is a consequence of the plan shown here. */}
        {isProfessional && (
          <section id="role-enquiries">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{lang === 'ar' ? 'الطلبات وفئات الخدمة' : 'Enquiries & service categories'}</h2>
            </div>
            {/* The INBOX stays here and the category declaration moved to
                Settings. Splitting them is deliberate: which categories you
                serve is configuration, but these are your leads, and this is
                where the `?rfq=` deep link in a notification lands. Putting a
                notification's destination behind Settings would break the one
                journey that notification exists to complete. */}
            <QualifiedEnquiries highlightRfqId={linkedRfqId} />
          </section>
        )}

        {isProfessional && (
          <section id="role-performance">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t('platform.performance')}</h2>
            </div>
            <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Camera className="h-4 w-4" /> {t('profile.title')}</CardTitle></CardHeader>
                <CardContent><VendorProfileCard /></CardContent>
              </Card>
              <div className="space-y-6">
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Star className="h-4 w-4" /> {t('reputation.title')}</CardTitle></CardHeader>
                  <CardContent>{ownProfile ? <VendorReputation userId={ownProfile.id} /> : <div className="text-sm text-muted-foreground py-4">{t('common.loading')}</div>}</CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4" /> {t('analytics.title')}</CardTitle></CardHeader>
                  <CardContent><VendorAnalytics /></CardContent>
                </Card>
              </div>
            </div>
          </section>
        )}

        <Dialog open={quoteDialogOpen} onOpenChange={setQuoteDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('platform.create_quote')}</DialogTitle>
              {quoteTarget && (
                <p className="text-sm text-muted-foreground" data-testid="quote-target">
                  {lang === 'ar' ? 'رداً على' : 'In response to'}: <span className="font-medium text-foreground">{quoteTarget.title}</span>
                  {' '}(#{quoteTarget.id})
                </p>
              )}
            </DialogHeader>
            <div className="space-y-3">
              <Input placeholder={lang === 'ar' ? 'السعر بالجنيه' : 'Your price (EGP)'} type="number" value={quoteForm.price} onChange={e => setQuoteForm(form => ({ ...form, price: e.target.value }))} />
              <Input placeholder={lang === 'ar' ? 'المدة بالأيام' : 'Timeline in days'} type="number" value={quoteForm.timeline} onChange={e => setQuoteForm(form => ({ ...form, timeline: e.target.value }))} />
              <Input placeholder={t('common.warranty')} value={quoteForm.warranty} onChange={e => setQuoteForm(form => ({ ...form, warranty: e.target.value }))} />
              <Textarea placeholder={t('common.notes')} rows={3} value={quoteForm.notes} onChange={e => setQuoteForm(form => ({ ...form, notes: e.target.value }))} />

              {/* Supporting files: proposal, specification, certificate, photos. */}
              <div>
                <input
                  ref={quoteFileInput}
                  type="file"
                  className="hidden"
                  multiple
                  accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
                  onChange={event => attachQuoteFiles(event.target.files)}
                  data-testid="quote-file-input"
                />
                <Button
                  type="button" variant="outline" size="sm" className="w-full gap-2"
                  onClick={() => quoteFileInput.current?.click()}
                  disabled={quoteUploading || quoteFiles.length >= 6}
                  data-testid="quote-attach"
                >
                  <Paperclip className="h-4 w-4" />
                  {quoteUploading
                    ? (lang === 'ar' ? 'جاري الرفع…' : 'Uploading…')
                    : (lang === 'ar' ? 'إرفاق ملفات (عرض فني، شهادات، صور)' : 'Attach files (proposal, certificates, photos)')}
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">
                  {lang === 'ar'
                    ? 'صور أو ملفات PDF، حتى 6 ملفات، 8 ميجابايت لكل ملف. يراها صاحب الطلب فقط.'
                    : 'Images or PDFs, up to 6 files, 8MB each. Only the customer who posted the request can see them.'}
                </p>
                {quoteFiles.length > 0 && (
                  <div className="mt-2 space-y-1" data-testid="quote-attachments">
                    {quoteFiles.map((file, index) => (
                      <div key={file.key} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-xs">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => setQuoteFiles(prev => prev.filter((_, i) => i !== index))}
                          aria-label={lang === 'ar' ? `إزالة ${file.name}` : `Remove ${file.name}`}
                          className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                          data-testid="quote-remove-attachment"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Button className="w-full gap-2" onClick={() => submitQuote.mutate({ rfqId: quoteForm.rfqId, price: Number(quoteForm.price), timeline: quoteForm.timeline ? Number(quoteForm.timeline) : undefined, warranty: quoteForm.warranty || undefined, notes: quoteForm.notes || undefined, attachments: quoteFiles.length > 0 ? quoteFiles : undefined })} disabled={submitQuote.isPending || quoteUploading || !quoteForm.price || !quoteForm.rfqId}><Send className="h-4 w-4" />{submitQuote.isPending ? t('common.loading') : t('platform.create_quote')}</Button>
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
      <Card id="role-projects"><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="flex items-center gap-2"><FolderKanban className="h-5 w-5" />{t('dash.recent_projects')}</CardTitle><Button variant="outline" size="sm" onClick={() => navigate('/dashboard')}>{t('dash.view_all')}</Button></CardHeader><CardContent>{projects.length === 0 ? <EmptyState text={t('dash.no_projects')} /> : <div className="space-y-3">{projects.slice(0, 5).map(project => <div key={project.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{project.title}</p><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{project.location || (lang === 'ar' ? 'لم يحدد الموقع' : 'Location not set')}</p></div><Badge variant="secondary">{localizedStatus(project.status, t)}</Badge></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${project.progress ?? 0}%` }} /></div><div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>{t('project.progress')}</span><span>{project.progress ?? 0}%</span></div></div>)}</div>}</CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-500" />{t('dash.ask_ai')}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{lang === 'ar' ? 'احصل على تقدير أولي للتكلفة ونصائح للمواد والجدول الزمني.' : 'Get an early cost estimate and practical guidance on materials and timelines.'}</p><Button className="mt-4 w-full" onClick={() => navigate('/ai')}>{t('dash.ask_ai')}</Button></CardContent></Card>
    </div>
  );
}

/**
 * A PROVIDER'S OWN SUBMITTED RESPONSES.
 *
 * Both the contractor and the supplier bid, and both had a "My Quotations"
 * count on their dashboard; only the contractor had anywhere to see what the
 * count referred to, and even there the tiles could not be clicked. A number
 * that counts records with no surface is not a KPI, it is a rumour.
 *
 * Each tile opens the request it answers, which is where the response and its
 * outcome actually live.
 */
function QuotationTiles({ quotations, t, lang, navigate }: { quotations: any[]; t: (key: string) => string; lang: 'en' | 'ar'; navigate: (path: string) => void }) {
  if (quotations.length === 0) return <EmptyState text={t('platform.no_items')} />;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {quotations.slice(0, 6).map(quote => (
        <div
          key={quote.id}
          role="button"
          tabIndex={0}
          data-testid="my-quotation"
          /* Opens THE QUOTATION, not the RFQ. This tile is the supplier's own
             bid, and it used to navigate to the request instead - the nearest
             page that existed, because a quotation had none. A control should
             open the record it depicts. */
          className="rounded-xl border p-3 cursor-pointer transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => navigate(`/quotations/${quote.id}`)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') navigate(`/quotations/${quote.id}`); }}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium">{quote.rfqTitle || `RFQ #${quote.rfqId}`}</p>
            <Badge variant={quote.status === 'accepted' ? 'default' : 'secondary'}>{localizedStatus(quote.status, t)}</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('common.egp')} {Number(quote.price).toLocaleString()} · {quote.timeline || '—'} {t('common.days')}
          </p>
        </div>
      ))}
    </div>
  );
}

function ContractorWorkspace({ rfqs, projects, quotations, t, lang, navigate, onQuote }: { rfqs: any[]; projects: any[]; quotations: any[]; t: (key: string) => string; lang: 'en' | 'ar'; navigate: (path: string) => void; onQuote: (rfqId: number) => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
      <Card id="role-pipeline"><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />{lang === 'ar' ? 'مسار استلام طلبات الأسعار' : 'Contractor RFQ Pipeline'}</CardTitle><Button variant="outline" size="sm" onClick={() => navigate('/rfq')}>{t('platform.view')}</Button></CardHeader><CardContent>{rfqs.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="space-y-3">{rfqs.slice(0, 6).map(rfq => <div key={rfq.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{rfq.title}</p>
<Link href={`/rfq/${rfq.id}`}><a className="font-mono text-xs text-primary underline-offset-2 hover:underline" data-testid="rfq-number">#{rfq.id}</a></Link><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{rfq.description}</p><div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">{rfq.category && <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{rfq.category}</span>}{rfq.budget && <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />{t('common.egp')} {Number(rfq.budget).toLocaleString()}</span>}{rfq.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{rfq.location}</span>}</div></div><Button size="sm" className="shrink-0 gap-1.5" onClick={() => onQuote(rfq.id)}><Send className="h-3.5 w-3.5" />{t('platform.create_quote')}</Button></div></div>)}</div>}</CardContent></Card>
      <Card id="role-projects"><CardHeader><CardTitle className="flex items-center gap-2"><BriefcaseBusiness className="h-5 w-5" />{lang === 'ar' ? 'إدارة المشاريع الميدانية' : 'Active Field Projects'}</CardTitle></CardHeader><CardContent>{projects.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="space-y-3">{projects.slice(0, 5).map(project => <div key={project.id} className="rounded-xl border p-3"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{project.title}</p><Badge variant="outline">{localizedStatus(project.status, t)}</Badge></div><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{project.location || (lang === 'ar' ? 'الموقع غير محدد' : 'Location not set')}</span><span>{project.progress ?? 0}%</span></div></div>)}</div>}</CardContent></Card>
      <Card id="role-quotations" className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />{lang === 'ar' ? 'عروض أسعار المقاول' : 'Submitted Quotations & Team Execution'}</CardTitle></CardHeader><CardContent><QuotationTiles quotations={quotations} t={t} lang={lang} navigate={navigate} /></CardContent></Card>
    </div>
  );
}

function EngineerWorkspace({ rfqs, projects, quotations, t, lang, navigate, onQuote }: { rfqs: any[]; projects: any[]; quotations: any[]; t: (key: string) => string; lang: 'en' | 'ar'; navigate: (path: string) => void; onQuote: (rfqId: number) => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
      <Card id="role-documents"><CardHeader><CardTitle className="flex items-center gap-2"><PenTool className="h-5 w-5" />{lang === 'ar' ? 'المستندات الهندسية وجداول الكميات' : 'Technical Deliverables & BOQ Review'}</CardTitle></CardHeader><CardContent><div className="space-y-3"><div className="rounded-xl border p-4"><p className="font-medium">{lang === 'ar' ? 'مراجعة المخططات الإنشائية' : 'Structural Calculations & Drawing Review'}</p><p className="mt-1 text-sm text-muted-foreground">{lang === 'ar' ? 'أرفق المخططات أو جدول الكميات وسيقرأها المساعد الفني ويوضّح الكود الذي يحكم كل بند. البناء هنا لا يعتمد المخططات ولا يوقّع عليها.' : 'Attach a drawing or a BOQ and the technical assistant reads it, naming the code that governs each requirement. BuildHub does not approve or sign off drawings.'}</p><Button size="sm" className="mt-3 gap-2" onClick={() => navigate('/ai')}><Sparkles className="h-4 w-4" />{lang === 'ar' ? 'تحليل بالذكاء الاصطناعي' : 'Run AI Analysis'}</Button></div><div className="rounded-xl border p-4"><p className="font-medium">{lang === 'ar' ? 'مراجعة مواصفات المواد' : 'Material Specification Review'}</p><p className="mt-1 text-sm text-muted-foreground">{lang === 'ar' ? 'قارن المواصفة المعلنة من المورّد بالمعيار الذي ينطبق عليها. البناء هنا لا يفحص المواد ولا يصدر شهادات جودة - المراجعة تتم بأدوات المساعد الفني.' : "Compare a supplier's stated specification against the standard that applies to it. BuildHub does not test materials or issue quality certificates - the review happens with the technical assistant's tools."}</p><Button size="sm" variant="outline" className="mt-3 gap-2" onClick={() => navigate('/ai')}><Sparkles className="h-4 w-4" />{lang === 'ar' ? 'افتح المساعد الفني' : 'Open the technical assistant'}</Button></div></div></CardContent></Card>
      <Card id="role-rfqs"><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />{lang === 'ar' ? 'الطلبات الهندسية' : 'Engineering RFQs'}</CardTitle></CardHeader><CardContent>{rfqs.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="space-y-3">{rfqs.slice(0, 5).map(rfq => <div key={rfq.id} className="rounded-xl border p-3"><p className="truncate text-sm font-medium">{rfq.title}</p>
<Link href={`/rfq/${rfq.id}`}><a className="font-mono text-xs text-primary underline-offset-2 hover:underline" data-testid="rfq-number">#{rfq.id}</a></Link><div className="mt-2 flex items-center justify-between"><span className="text-xs text-muted-foreground">{rfq.category || 'Engineering'}</span><Button size="sm" onClick={() => onQuote(rfq.id)}>{t('platform.create_quote')}</Button></div></div>)}</div>}</CardContent></Card>
      {/* THE BID YOU SUBMITTED HAD NOWHERE TO BE SEEN.
          An engineer or architect can quote - the Design/Engineering RFQ cards
          carry a Create Quotation button, and rfq.submitQuotation accepts them
          - but only the contractor and supplier workspaces rendered the
          quotations they had sent. myQuotations was fetched for every
          professional and then discarded for these two roles, so a submitted
          bid vanished from the person who submitted it. Found by driving the
          whole workflow per role, not by reading the source. */}
      <Card id="role-quotations" className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />{t('platform.my_quotations')}</CardTitle></CardHeader><CardContent><QuotationTiles quotations={quotations} t={t} lang={lang} navigate={navigate} /></CardContent></Card>
      <Card id="role-projects" className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><BriefcaseBusiness className="h-5 w-5" />{lang === 'ar' ? 'المشاريع الهندسية النشطة' : 'Active Engineering Projects'}</CardTitle></CardHeader><CardContent>{projects.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="grid gap-3 md:grid-cols-3">{projects.slice(0, 6).map(project => <div key={project.id} className="rounded-xl border p-3"><p className="font-medium">{project.title}</p><p className="mt-1 text-xs text-muted-foreground">{project.location || '—'}</p><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{t('project.progress')}</span><span>{project.progress ?? 0}%</span></div></div>)}</div>}</CardContent></Card>
    </div>
  );
}

function ArchitectWorkspace({ rfqs, projects, quotations, t, lang, navigate, onQuote, ownProfileId }: { rfqs: any[]; projects: any[]; quotations: any[]; t: (key: string) => string; lang: 'en' | 'ar'; navigate: (path: string) => void; onQuote: (rfqId: number) => void; ownProfileId?: number }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
      <Card id="role-portfolio"><CardHeader><CardTitle className="flex items-center gap-2"><PenTool className="h-5 w-5" />{lang === 'ar' ? 'معرض التصاميم وتقديم الأفكار' : 'Design Portfolio & Concept Presentation'}</CardTitle></CardHeader><CardContent><div className="space-y-3"><div className="rounded-xl border p-4"><p className="font-medium">{lang === 'ar' ? 'تطوير الفكرة التصميمية' : 'Developing the design concept'}</p><p className="mt-1 text-sm text-muted-foreground">{lang === 'ar' ? 'ناقش الفكرة والمواد والتشطيبات مع مساعد التصميم، أو أرفق مخططاً ليقرأه.' : 'Work through concept, materials and finishes with the design assistant, or attach a drawing for it to read.'}</p><Button size="sm" className="mt-3 gap-2" onClick={() => navigate('/ai')}><Sparkles className="h-4 w-4" />{lang === 'ar' ? 'افتح مساعد التصميم' : 'Open the design assistant'}</Button></div><div className="rounded-xl border border-dashed p-4"><p className="font-medium">{lang === 'ar' ? 'معرض الأعمال - غير متاح بعد' : 'Portfolio hosting - not available yet'}</p><p className="mt-1 text-sm text-muted-foreground">{lang === 'ar' ? 'لا يستضيف البناء هنا حتى الآن اللوحات التقديمية أو الصور ثلاثية الأبعاد. ما هو متاح فعلاً هو ملفك العام الذي يراه العملاء، وهو معروض أسفل هذه الصفحة.' : 'BuildHub does not yet host renderings or client mood boards. What does exist is your public profile, the page clients actually see, further down this workspace.'}</p><Button size="sm" variant="outline" className="mt-3 gap-2" data-testid="architect-public-profile" onClick={() => { if (ownProfileId) navigate(`/vendor/${ownProfileId}`); else revealSection('role-performance'); }}>{lang === 'ar' ? 'اذهب إلى ملفي العام' : 'Go to my public profile'}</Button></div></div></CardContent></Card>
      <Card id="role-rfqs"><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />{lang === 'ar' ? 'فرص التصميم والتشطيب' : 'Design RFQs'}</CardTitle></CardHeader><CardContent>{rfqs.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="space-y-3">{rfqs.slice(0, 5).map(rfq => <div key={rfq.id} className="rounded-xl border p-3"><p className="truncate text-sm font-medium">{rfq.title}</p>
<Link href={`/rfq/${rfq.id}`}><a className="font-mono text-xs text-primary underline-offset-2 hover:underline" data-testid="rfq-number">#{rfq.id}</a></Link><div className="mt-2 flex items-center justify-between"><span className="text-xs text-muted-foreground">{rfq.category || 'Architecture'}</span><Button size="sm" onClick={() => onQuote(rfq.id)}>{t('platform.create_quote')}</Button></div></div>)}</div>}</CardContent></Card>
      {/* THE BID YOU SUBMITTED HAD NOWHERE TO BE SEEN.
          An engineer or architect can quote - the Design/Engineering RFQ cards
          carry a Create Quotation button, and rfq.submitQuotation accepts them
          - but only the contractor and supplier workspaces rendered the
          quotations they had sent. myQuotations was fetched for every
          professional and then discarded for these two roles, so a submitted
          bid vanished from the person who submitted it. Found by driving the
          whole workflow per role, not by reading the source. */}
      <Card id="role-quotations" className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />{t('platform.my_quotations')}</CardTitle></CardHeader><CardContent><QuotationTiles quotations={quotations} t={t} lang={lang} navigate={navigate} /></CardContent></Card>
      <Card id="role-projects" className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><FolderKanban className="h-5 w-5" />{lang === 'ar' ? 'مشاريع التصميم المعماري' : 'Active Architectural Projects'}</CardTitle></CardHeader><CardContent>{projects.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="grid gap-3 md:grid-cols-3">{projects.slice(0, 6).map(project => <div key={project.id} className="rounded-xl border p-3"><p className="font-medium">{project.title}</p><p className="mt-1 text-xs text-muted-foreground">{project.location || '—'}</p><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{t('project.progress')}</span><span>{project.progress ?? 0}%</span></div></div>)}</div>}</CardContent></Card>
    </div>
  );
}

function SupplierWorkspace({ products, rfqs, projects, quotations, t, lang, navigate, onQuote }: { products: any[]; rfqs: any[]; projects: any[]; quotations: any[]; t: (key: string) => string; lang: 'en' | 'ar'; navigate: (path: string) => void; onQuote: (rfqId: number) => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="flex items-center gap-2"><Package className="h-5 w-5" />{t('platform.catalogue')}</CardTitle><Button variant="outline" size="sm" onClick={() => navigate('/marketplace/products')}>{t('platform.view')}</Button></CardHeader><CardContent>{products.length === 0 ? <EmptyState text={lang === 'ar' ? 'أضف أول منتج إلى كتالوجك' : 'Add your first product to the catalogue'} /> : <div className="space-y-3">{products.slice(0, 6).map(product => <div key={product.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{lang === 'ar' && product.nameAr ? product.nameAr : product.name}</p><p className="mt-1 text-xs text-muted-foreground">{product.category} · {product.stock ?? 0} {product.unit || (lang === 'ar' ? 'وحدة' : 'units')}</p></div><span className="text-sm font-semibold">{product.price ? `${t('common.egp')} ${Number(product.price).toLocaleString()}` : '—'}</span></div>)}</div>}</CardContent></Card>
      <Card id="role-rfqs"><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />{t('platform.review_requests')}</CardTitle></CardHeader><CardContent>{rfqs.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="space-y-3">{rfqs.slice(0, 5).map(rfq => <div key={rfq.id} className="rounded-xl border p-3"><p className="truncate text-sm font-medium">{rfq.title}</p>
<Link href={`/rfq/${rfq.id}`}><a className="font-mono text-xs text-primary underline-offset-2 hover:underline" data-testid="rfq-number">#{rfq.id}</a></Link><div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{rfq.category || (lang === 'ar' ? 'عام' : 'General')}</span><Button size="sm" onClick={() => onQuote(rfq.id)} className="gap-1.5"><Send className="h-3 w-3" />{t('platform.create_quote')}</Button></div></div>)}</div>}</CardContent></Card>
      {/* A supplier who bids had a "My Quotations" count and nowhere to see
          what it counted. Same record, same destination as the contractor's. */}
      <Card id="role-quotations" className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />{lang === 'ar' ? 'عروض الأسعار المقدمة' : 'Submitted Quotations'}</CardTitle></CardHeader><CardContent><QuotationTiles quotations={quotations} t={t} lang={lang} navigate={navigate} /></CardContent></Card>
      <Card id="role-projects" className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><BriefcaseBusiness className="h-5 w-5" />{t('platform.projects')}</CardTitle></CardHeader><CardContent>{projects.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="grid gap-3 md:grid-cols-2">{projects.slice(0, 6).map(project => <div key={project.id} className="rounded-xl border p-3"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{project.title}</p><Badge variant="outline">{localizedStatus(project.status, t)}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{project.location || (lang === 'ar' ? 'الموقع غير محدد' : 'Location not set')}</p><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{t('project.progress')}</span><span>{project.progress ?? 0}%</span></div></div>)}</div>}</CardContent></Card>
    </div>
  );
}

function ProjectManagerWorkspace({ projects, rfqs, t, lang, navigate }: { projects: any[]; rfqs: any[]; t: (key: string) => string; lang: 'en' | 'ar'; navigate: (path: string) => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
      <Card id="role-queue"><CardHeader><CardTitle className="flex items-center gap-2"><KanbanSquare className="h-5 w-5" />{t('platform.project_queue')}</CardTitle></CardHeader><CardContent>{projects.length === 0 ? <EmptyState text={t('platform.no_items')} /> : <div className="grid gap-3 md:grid-cols-2">{projects.slice(0, 8).map(project => <div key={project.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-2"><p className="font-medium">{project.title}</p><Badge variant="outline">{localizedStatus(project.status, t)}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{project.location || (lang === 'ar' ? 'الموقع غير محدد' : 'Location not set')}</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-cyan-500" style={{ width: `${project.progress ?? 0}%` }} /></div><div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>{t('project.progress')}</span><span>{project.progress ?? 0}%</span></div></div>)}</div>}</CardContent></Card>
      <Card id="role-rfqs"><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />{lang === 'ar' ? 'نظرة على الطلبات' : 'Request Overview'}</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{rfqs.length}</p><p className="mt-1 text-sm text-muted-foreground">{lang === 'ar' ? 'طلبات مفتوحة يمكن متابعتها مع الفرق' : 'open requests to coordinate with delivery teams'}</p><Button size="sm" variant="outline" className="mt-4 gap-2" onClick={() => navigate('/messages')}><Users className="h-4 w-4" />{lang === 'ar' ? 'راسل أصحاب المصلحة' : 'Message stakeholders'}</Button></CardContent></Card>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">{text}</div>;
}
