import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Link, useLocation } from 'wouter';
import { startLogin } from '@/const';
import { trpc } from '@/lib/trpc';
import {
  Building2, ShoppingBag, FileText, Bot, Users, ArrowRight,
  CheckCircle2, Zap, Shield, Globe, HardHat, Layers,
  Package, UserCog, ChevronRight, TrendingUp, Clock, MapPin,
  BarChart3, MessageSquare, Sparkles, Play
} from 'lucide-react';
import { Home as HomeIcon } from 'lucide-react';

const FEATURES = [
  {
    icon: ShoppingBag,
    titleKey: 'features.marketplace.title',
    descKey: 'features.marketplace.desc',
    color: 'text-blue-500',
    bg: 'bg-blue-50',
    gradient: 'from-blue-500/10 to-blue-500/5',
    href: '/marketplace',
  },
  {
    icon: FileText,
    titleKey: 'features.rfq.title',
    descKey: 'features.rfq.desc',
    color: 'text-green-500',
    bg: 'bg-green-50',
    gradient: 'from-green-500/10 to-green-500/5',
    href: '/rfq',
  },
  {
    icon: Bot,
    titleKey: 'features.ai.title',
    descKey: 'features.ai.desc',
    color: 'text-purple-500',
    bg: 'bg-purple-50',
    gradient: 'from-purple-500/10 to-purple-500/5',
    href: '/ai',
  },
  {
    icon: BarChart3,
    titleKey: 'features.pm.title',
    descKey: 'features.pm.desc',
    color: 'text-amber-500',
    bg: 'bg-amber-50',
    gradient: 'from-amber-500/10 to-amber-500/5',
    href: '/dashboard',
  },
  {
    icon: Zap,
    titleKey: 'features.matching.title',
    descKey: 'features.matching.desc',
    color: 'text-orange-500',
    bg: 'bg-orange-50',
    gradient: 'from-orange-500/10 to-orange-500/5',
    href: '/rfq',
  },
  {
    icon: MessageSquare,
    titleKey: 'features.messaging.title',
    descKey: 'features.messaging.desc',
    color: 'text-teal-500',
    bg: 'bg-teal-50',
    gradient: 'from-teal-500/10 to-teal-500/5',
    href: '/messages',
  },
];

const ROLES = [
  { id: 'homeowner', icon: HomeIcon, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', href: '/auth' },
  { id: 'contractor', icon: HardHat, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', href: '/auth' },
  { id: 'engineer', icon: Layers, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', href: '/auth' },
  { id: 'architect', icon: Building2, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', href: '/auth' },
  { id: 'supplier', icon: Package, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200', href: '/auth' },
  { id: 'project_manager', icon: UserCog, color: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-200', href: '/auth' },
];

/**
 * THE COUNTERS UNDER THE HEADLINE.
 *
 * These were four hardcoded strings - "10K+ Registered Users", "5K+ Active
 * Projects", "2K+ Verified Providers", "98% Satisfaction Rate" - presented as
 * fact to somebody deciding whether to trust the platform with a construction
 * budget. None came from anywhere. The satisfaction figure is worth naming
 * twice: there were no reviews in the database at all, so it was not stale or
 * rounded - no such measurement existed.
 *
 * They now come from marketplace.platformStats. A figure that does not exist
 * yet is not rendered, following the rule this codebase already applies to
 * provider ratings: an absent number is shown as absent, never as a number.
 */
const STAT_LABELS = {
  registeredUsers: { en: 'Registered Users', ar: 'مستخدم مسجل' },
  activeProjects: { en: 'Active Projects', ar: 'مشروع نشط' },
  verifiedProviders: { en: 'Verified Providers', ar: 'مزود موثق' },
  satisfaction: { en: 'Average Rating', ar: 'متوسط التقييم' },
} as const;

/**
 * THE TESTIMONIALS WERE INVENTED.
 *
 * Three named individuals - "Ahmed Hassan, Homeowner, Cairo", "Mohamed
 * Al-Rashidi, Contractor, Dubai", "Sara Khalil, Interior Architect, Riyadh" -
 * each with a five-star rating and a specific quantitative claim: that the AI
 * cost estimator "saved me 15% on my budget", that BuildHub delivers "3x more
 * qualified leads than any other platform". No such people, reviews, or
 * measurements existed anywhere in the product. The reviews table was empty.
 *
 * Fabricated endorsements attributed to named people, carrying performance
 * claims, shown to prospective customers, are a different order of problem
 * from a rounded user count, and they are removed rather than adjusted.
 *
 * They are NOT replaced with invented honest-looking copy, and they are not
 * wired to the real `reviews` table either: a review a vendor's customer left
 * on that vendor's profile was not given for use as site-wide marketing, and
 * deciding otherwise is the owner's call, not an engineering one.
 *
 * OWNER DECISION: what belongs in this section before launch - real
 * testimonials with the reviewers' consent, or nothing.
 */

const HOW_IT_WORKS = [
  { step: '01', titleEn: 'Create Your Account', titleAr: 'أنشئ حسابك', descEn: 'Sign up and select your role — homeowner, contractor, engineer, or supplier.', descAr: 'سجّل واختر دورك — صاحب منزل، مقاول، مهندس، أو مورد.' },
  { step: '02', titleEn: 'Post or Browse', titleAr: 'انشر أو تصفح', descEn: 'Create a project, post an RFQ, or browse the marketplace for materials and services.', descAr: 'أنشئ مشروعاً أو انشر طلب عرض أو تصفح السوق للمواد والخدمات.' },
  { step: '03', titleEn: 'Connect & Collaborate', titleAr: 'تواصل وتعاون', descEn: 'Get matched with the best providers, compare quotes, and manage everything in one place.', descAr: 'تواصل مع أفضل المزودين وقارن العروض وأدر كل شيء في مكان واحد.' },
  { step: '04', titleEn: 'Build with Confidence', titleAr: 'ابنِ بثقة', descEn: 'Track progress, manage budgets, and leave verified reviews when your project is done.', descAr: 'تتبع التقدم وأدر الميزانيات واترك تقييمات موثقة عند اكتمال مشروعك.' },
];

export default function Home() {
  const { t, lang, dir } = useLanguage();
  const [, navigate] = useLocation();

  /**
   * A figure is rendered only if it is a real, non-zero count. Zero is not a
   * headline anybody needs to read, and it is not a placeholder either - the
   * tile simply does not appear. Nothing here invents a number when the query
   * has not resolved or the database is unreachable.
   */
  const { data: stats } = trpc.marketplace.platformStats.useQuery();
  const liveStats = !stats ? [] : [
    { key: 'registeredUsers', value: stats.registeredUsers.toLocaleString(), label: STAT_LABELS.registeredUsers, show: stats.registeredUsers > 0 },
    { key: 'activeProjects', value: stats.activeProjects.toLocaleString(), label: STAT_LABELS.activeProjects, show: stats.activeProjects > 0 },
    { key: 'verifiedProviders', value: stats.verifiedProviders.toLocaleString(), label: STAT_LABELS.verifiedProviders, show: stats.verifiedProviders > 0 },
    // Null until somebody has actually left a review. It is an average out of
    // five, not a satisfaction percentage - the percentage measured nothing.
    { key: 'satisfaction', value: `${stats.satisfaction?.averageRating ?? 0}/5`, label: STAT_LABELS.satisfaction, show: stats.satisfaction !== null },
  ].filter(stat => stat.show);

  const roleLabels: Record<string, string> = {
    homeowner: t('roles.homeowner'),
    contractor: t('roles.contractor'),
    engineer: t('roles.engineer'),
    architect: t('roles.architect'),
    supplier: t('roles.supplier'),
    project_manager: lang === 'ar' ? 'مدير المشروع' : 'Project Manager',
  };

  const roleDescs: Record<string, string> = {
    homeowner: t('roles.homeowner.desc'),
    contractor: t('roles.contractor.desc'),
    engineer: t('roles.engineer.desc'),
    architect: t('roles.architect.desc'),
    supplier: t('roles.supplier.desc'),
    project_manager: lang === 'ar' ? 'أدر مشاريع البناء من البداية للنهاية.' : 'Manage construction projects end-to-end.',
  };

  return (
    <div className="min-h-screen bg-background" dir={dir}>
      <Navbar />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center gradient-hero overflow-hidden">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 w-72 h-72 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-10 w-96 h-96 bg-white rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-white rounded-full blur-3xl opacity-50" />
        </div>

        {/* Grid overlay */}
        <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />

        <div className="container relative z-10 pt-24 pb-16">
          <div className="max-w-4xl mx-auto text-center text-white">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/15 backdrop-blur-sm border border-white/20 text-sm font-medium mb-6 animate-fade-in">
              <Sparkles className="w-4 h-4" />
              {t('hero.badge')}
            </div>

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-tight mb-6 tracking-tight">
              {t('hero.title')}
            </h1>

            <p className="text-lg sm:text-xl text-white/75 max-w-2xl mx-auto mb-10 leading-relaxed">
              {t('hero.subtitle')}
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
              <Button
                size="lg"
                className="bg-white text-primary hover:bg-white/90 shadow-xl shadow-black/20 gap-2 text-base px-8 h-12"
                onClick={() => navigate('/auth')}
              >
                {t('hero.cta.primary')} <ArrowRight className="w-4 h-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-white/30 text-white bg-white/10 hover:bg-white/20 backdrop-blur-sm gap-2 text-base px-8 h-12"
                onClick={() => navigate('/marketplace')}
              >
                {t('hero.cta.secondary')}
              </Button>
            </div>

            {/* Stats - real counts, and nothing where there is no count yet. */}
            {liveStats.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-2xl mx-auto" data-testid="platform-stats">
                {liveStats.map(stat => (
                  <div key={stat.key} className="text-center">
                    <p className="text-3xl font-bold text-white">{stat.value}</p>
                    <p className="text-sm text-white/60 mt-1">{lang === 'ar' ? stat.label.ar : stat.label.en}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Wave divider */}
        <div className="absolute bottom-0 inset-x-0">
          <svg viewBox="0 0 1440 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
            <path d="M0 80L48 66.7C96 53.3 192 26.7 288 20C384 13.3 480 26.7 576 33.3C672 40 768 40 864 33.3C960 26.7 1056 13.3 1152 16.7C1248 20 1344 40 1392 50L1440 60V80H1392C1344 80 1248 80 1152 80C1056 80 960 80 864 80C768 80 672 80 576 80C480 80 384 80 288 80C192 80 96 80 48 80H0Z" fill="hsl(var(--background))"/>
          </svg>
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────────────────── */}
      <section className="py-24 bg-background">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="secondary" className="mb-4 text-sm px-4 py-1">{lang === 'ar' ? 'المميزات' : 'Features'}</Badge>
            <h2 className="text-4xl font-bold mb-4">{t('features.title')}</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">{t('features.subtitle')}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feature) => (
              <Card
                key={feature.titleKey}
                className="card-hover group cursor-pointer border-border hover:border-primary/20 overflow-hidden"
                onClick={() => navigate(feature.href)}
              >
                <CardContent className="p-6">
                  <div className={`w-12 h-12 rounded-xl ${feature.bg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-200`}>
                    <feature.icon className={`w-6 h-6 ${feature.color}`} />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{t(feature.titleKey)}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{t(feature.descKey)}</p>
                  <div className={`flex items-center gap-1 mt-4 text-sm font-medium ${feature.color} opacity-0 group-hover:opacity-100 transition-opacity`}>
                    {lang === 'ar' ? 'اعرف أكثر' : 'Learn more'} <ChevronRight className="w-4 h-4" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section className="py-24 bg-muted/30">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="secondary" className="mb-4 text-sm px-4 py-1">{lang === 'ar' ? 'كيف يعمل' : 'How It Works'}</Badge>
            <h2 className="text-4xl font-bold mb-4">{lang === 'ar' ? 'أربع خطوات للنجاح' : 'Four Steps to Success'}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={step.step} className="relative">
                {i < HOW_IT_WORKS.length - 1 && (
                  <div className="hidden lg:block absolute top-8 left-full w-full h-0.5 bg-gradient-to-r from-primary/30 to-transparent z-0" style={{ width: 'calc(100% - 2rem)' }} />
                )}
                <div className="relative z-10">
                  <div className="w-16 h-16 rounded-2xl gradient-brand flex items-center justify-center mb-4 shadow-lg shadow-primary/20">
                    <span className="text-white font-bold text-lg">{step.step}</span>
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{lang === 'ar' ? step.titleAr : step.titleEn}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{lang === 'ar' ? step.descAr : step.descEn}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── USER TYPES ───────────────────────────────────────────────────── */}
      <section className="py-24 bg-background">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="secondary" className="mb-4 text-sm px-4 py-1">{lang === 'ar' ? 'لمن هذا؟' : 'Who Is It For?'}</Badge>
            <h2 className="text-4xl font-bold mb-4">{t('roles.title')}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {ROLES.map(role => (
              <Card
                key={role.id}
                className={`card-hover cursor-pointer border-2 ${role.border} hover:border-primary/40 group`}
                onClick={() => navigate(role.href)}
              >
                <CardContent className="p-6">
                  <div className={`w-12 h-12 rounded-xl ${role.bg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-200`}>
                    <role.icon className={`w-6 h-6 ${role.color}`} />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{roleLabels[role.id]}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-4">{roleDescs[role.id]}</p>
                  <Button variant="ghost" size="sm" className={`gap-1 ${role.color} p-0 h-auto font-medium`}>
                    {lang === 'ar' ? 'ابدأ الآن' : 'Get Started'} <ChevronRight className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>


      {/* ── CTA BANNER ───────────────────────────────────────────────────── */}
      <section className="py-24 gradient-hero relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-1/4 w-64 h-64 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-white rounded-full blur-3xl" />
        </div>
        <div className="container relative z-10 text-center text-white">
          <h2 className="text-4xl sm:text-5xl font-bold mb-4">
            {lang === 'ar' ? 'جاهز لبدء مشروعك؟' : 'Ready to Start Building?'}
          </h2>
          <p className="text-white/70 text-lg max-w-xl mx-auto mb-8">
            {lang === 'ar'
              ? 'انضم إلى آلاف المستخدمين الذين يثقون في BuildHub لإدارة مشاريعهم.'
              : 'Join thousands of users who trust BuildHub to manage their construction projects.'}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              className="bg-white text-primary hover:bg-white/90 gap-2 px-8 h-12 text-base"
              onClick={() => navigate('/auth')}
            >
              {t('nav.signup')} <ArrowRight className="w-4 h-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white/30 text-white bg-white/10 hover:bg-white/20 gap-2 px-8 h-12 text-base"
              onClick={() => navigate('/marketplace')}
            >
              {t('hero.cta.secondary')}
            </Button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="bg-foreground text-background py-16">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
            {/* Brand */}
            <div className="md:col-span-1">
              <Link href="/" className="flex items-center gap-2 mb-4" data-testid="brand-home-footer">
                <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
                  <Building2 className="w-4 h-4 text-white" />
                </div>
                <span className="font-bold text-xl text-background">BuildHub</span>
              </Link>
              <p className="text-background/60 text-sm leading-relaxed">
                {lang === 'ar'
                  ? 'نظام تشغيل البناء الذكي — يربط الجميع في منظومة واحدة.'
                  : 'The AI-powered Construction OS — connecting everyone in one ecosystem.'}
              </p>
            </div>

            {/* Links */}
            {[
              {
                title: lang === 'ar' ? 'المنصة' : 'Platform',
                links: [
                  { label: t('nav.marketplace'), href: '/marketplace' },
                  { label: t('nav.rfq'), href: '/rfq' },
                  { label: t('dash.ai'), href: '/ai' },
                  { label: lang === 'ar' ? 'المشاريع' : 'Projects', href: '/dashboard' },
                ],
              },
              {
                title: lang === 'ar' ? 'للمحترفين' : 'For Professionals',
                links: [
                  { label: t('roles.contractor'), href: '/auth' },
                  { label: t('roles.engineer'), href: '/auth' },
                  { label: t('roles.architect'), href: '/auth' },
                  { label: t('roles.supplier'), href: '/auth' },
                ],
              },
              /* THE "COMPANY" COLUMN IS GONE, ON PURPOSE.
                 It listed About Us, Contact, Privacy Policy and Terms of
                 Service. All four pointed at href '/' - the page the reader was
                 already on - so all four did nothing. A live click audit
                 confirmed it from every page of the site.
                 Three of them cannot be fixed in code: an about page, a support
                 address and two legal documents are things BuildHub has to
                 decide and publish, and writing a privacy policy or terms of
                 service on the owner's behalf would be inventing a commitment
                 the company has not made. Advertising them and delivering
                 nothing is worse than not advertising them, so they are
                 withdrawn until there is something to link to. Recorded as an
                 OWNER DECISION in the zero-gap audit. */
            ].map(col => (
              <div key={col.title}>
                <h4 className="font-semibold text-background mb-4 text-sm uppercase tracking-wide">{col.title}</h4>
                <ul className="space-y-2">
                  {col.links.map(link => (
                    <li key={link.label}>
                      <Link href={link.href} className="text-background/60 hover:text-background text-sm transition-colors">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="border-t border-background/10 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-background/40 text-sm">
              © 2025 BuildHub. {lang === 'ar' ? 'جميع الحقوق محفوظة.' : 'All rights reserved.'}
            </p>
            <div className="flex items-center gap-4 text-sm text-background/40">
              <span className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" /> {lang === 'ar' ? 'آمن ومشفر' : 'Secure & Encrypted'}</span>
              <span className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> {lang === 'ar' ? 'متاح بالعربية والإنجليزية' : 'AR / EN'}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
