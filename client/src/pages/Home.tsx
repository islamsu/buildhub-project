import { useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import SourcingSearch from '@/components/SourcingSearch';
import LoadFailed, { loadFailedCopy } from '@/components/LoadFailed';
import SourcingJourney from '@/components/SourcingJourney';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Link, useLocation } from 'wouter';
import { startLogin } from '@/const';
import { trpc } from '@/lib/trpc';
import {
  ShoppingBag, FileText, Bot, Users, ArrowRight,
  CheckCircle2, Zap, Shield, Globe,
  ChevronRight, TrendingUp, Clock, MapPin,
  BarChart3, MessageSquare, Sparkles, Play
} from 'lucide-react';
import { usePageTitle } from '../hooks/usePageTitle';
import { RakizaLogo } from '@/components/brand/RakizaLogo';
import { ROLE_IDENTITIES, ROLE_CARD_CLASSES, roleIconClasses } from '@/components/brand/roleIdentity';

/* THE ROLE LIST MOVED. Six per-role colours lived here and again in
   AuthPage, where green, amber and purple collided with the success,
   warning and destructive meanings those hues already carry elsewhere in
   the product. One source now, in components/brand/roleIdentity.ts.
   Every role still links to /auth, which is a property of this page
   rather than of the role. */
const ROLE_HREF = '/auth';

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
  // The owner asked for the size of the catalogue back on the front door.
  // Counted server-side with the marketplace's own visibility rule, so the
  // number is one a visitor can go and browse.
  publicProducts: { en: 'Products Listed', ar: 'منتج معروض' },
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

export default function Home() {
  usePageTitle();
  const { t, lang, dir } = useLanguage();
  const ar = lang === 'ar';
  const [, navigate] = useLocation();

  /**
   * A figure is rendered only if it is a real, non-zero count. Zero is not a
   * headline anybody needs to read, and it is not a placeholder either - the
   * tile simply does not appear. Nothing here invents a number when the query
   * has not resolved or the database is unreachable.
   */
  const { data: stats } = trpc.marketplace.platformStats.useQuery();
  const liveStats = !stats ? [] : [
    { key: 'publicProducts', value: stats.publicProducts.toLocaleString(), label: STAT_LABELS.publicProducts, show: stats.publicProducts > 0 },
    { key: 'registeredUsers', value: stats.registeredUsers.toLocaleString(), label: STAT_LABELS.registeredUsers, show: stats.registeredUsers > 0 },
    { key: 'activeProjects', value: stats.activeProjects.toLocaleString(), label: STAT_LABELS.activeProjects, show: stats.activeProjects > 0 },
    { key: 'verifiedProviders', value: stats.verifiedProviders.toLocaleString(), label: STAT_LABELS.verifiedProviders, show: stats.verifiedProviders > 0 },
    // Null until somebody has actually left a review. It is an average out of
    // five, not a satisfaction percentage - the percentage measured nothing.
    { key: 'satisfaction', value: `${stats.satisfaction?.averageRating ?? 0}/5`, label: STAT_LABELS.satisfaction, show: stats.satisfaction !== null },
  ].filter(stat => stat.show);

  /**
   * THE CATEGORY RAIL, FROM THE ONE TAXONOMY.
   *
   * `view: 'public'` and `withCounts` - the same read the Marketplace Hub
   * makes, not a list compiled into this page. Categories that actually have
   * listings lead, because what a buyer sees first should be what Rakiza can
   * actually supply.
   */
  const {
    data: taxonomy,
    isError: categoriesFailed,
    refetch: refetchCategories,
  } = trpc.marketplace.categories.useQuery({ view: 'public', withCounts: true }, { retry: false });

  const browseCategories = useMemo(() => {
    const rows = [...(taxonomy?.categories ?? [])];
    rows.sort((a: any, b: any) => (b.listedProducts ?? 0) - (a.listedProducts ?? 0));
    return rows.slice(0, 9);
  }, [taxonomy]);

  /*
   * "1 listings" IS A DEFECT, AND SO IS "2 منتج". English needs a singular;
   * Arabic needs four forms. The hub already solved this - the same keys are
   * read here rather than a second, simpler rule being written.
   */
  const listedLabel = (n: number) => {
    const key = !ar
      ? (n === 1 ? 'marketHub.listingsCountOne' : 'marketHub.listingsCount')
      : n === 1 ? 'marketHub.listingsCountOne'
      : n === 2 ? 'marketHub.listingsCountTwo'
      : n % 100 >= 3 && n % 100 <= 10 ? 'marketHub.listingsCount'
      : 'marketHub.listingsCountMany';
    return t(key).replace('{n}', String(n));
  };

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
      {/*
        THE SPLIT THE OWNER APPROVED, BUILT NOW, PHOTOGRAPH PENDING.

        The reference puts copy and a search field on the left and an
        architectural photograph on the right, with "From Planning to
        Completion" set over it. The photograph is an owner asset that has not
        arrived, and §57 forbids filling the slot with irrelevant stock or a
        stretched low-resolution image to make the page look populated.

        So the LAYOUT is the approved one and the right panel carries a
        restrained brand treatment until the image lands - one file and one
        <img> away from being the reference. What is NOT done is pretending:
        there is no placeholder photograph of somebody else's building.

        No longer `min-h-screen`. It was, and with the flex min-size defect
        fixed in R5 that now genuinely means a full viewport - which pushes
        every other section of the homepage below the fold. The reference hero
        is roughly half a screen.
      */}
      <section className="relative overflow-hidden gradient-hero">
        {/* Grid overlay. The only decoration: §73 names gradient-heavy,
            blurred-blob surfaces as the generated-interface look. The three
            blurred white circles that used to sit here are gone. */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          aria-hidden="true"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />

        <div className="container relative z-10 pt-28 pb-14 lg:pt-32 lg:pb-20">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.78fr)]">
            {/* ── LEFT: the proposition, and the way in ──────────────────── */}
            <div className="text-white">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur-sm">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {t('hero.badge')}
              </div>

              <h1 className="mb-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
                {t('hero.title')}
              </h1>

              <p className="mb-8 max-w-xl text-lg leading-relaxed text-white/75">
                {t('hero.subtitle')}
              </p>

              {/* THE SEARCH IS THE PRIMARY ACTION, which is the reference's
                  whole argument: a visitor who knows what they need should not
                  have to pick a role first. */}
              <SourcingSearch variant="hero" className="max-w-xl" />

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 gap-2 border-white/30 bg-white/10 px-7 text-base text-white backdrop-blur-sm hover:bg-white/20 hover:text-white"
                  onClick={() => navigate('/rfq')}
                  data-testid="hero-cta-rfq"
                >
                  {t('hero.cta.primary')} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 gap-2 border-white/30 bg-transparent px-7 text-base text-white hover:bg-white/10 hover:text-white"
                  onClick={() => navigate('/marketplace')}
                  data-testid="hero-cta-marketplace"
                >
                  {t('hero.cta.secondary')}
                </Button>
              </div>
            </div>

            {/* ── RIGHT: the panel the photograph will occupy ─────────────── */}
            <div className="hidden lg:block">
              <div
                className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/15 bg-brand-900/40"
                data-testid="hero-visual"
              >
                <div
                  className="absolute inset-0 opacity-20"
                  aria-hidden="true"
                  style={{
                    backgroundImage:
                      'linear-gradient(135deg, rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(45deg, rgba(255,255,255,0.35) 1px, transparent 1px)',
                    backgroundSize: '44px 44px',
                  }}
                />
                <div className="absolute inset-0 flex flex-col justify-end p-8">
                  <span className="h-1 w-16 rounded-full bg-brand-accent-500" aria-hidden="true" />
                  <p className="mt-4 text-2xl font-semibold leading-snug text-white">
                    {t('hero.overlay')}
                  </p>
                  <RakizaLogo tone="inverse" size="sm" className="mt-5 opacity-70" decorative />
                </div>
              </div>
            </div>
          </div>

          {/* ── THE TRUST STRIP ──────────────────────────────────────────
              Four capability statements, not four counts. Every one names
              something the product does and the next page can be checked
              against; §15 and §68 both forbid a trust signal the system
              cannot prove, and a verification badge nobody earned is the
              worst thing a marketplace can put on its front door. */}
          <ul
            className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/15 bg-white/10 sm:grid-cols-2 lg:grid-cols-4"
            data-testid="home-trust-strip"
          >
            {[
              { icon: Shield, key: 'verified' },
              { icon: BarChart3, key: 'compare' },
              { icon: FileText, key: 'free' },
              { icon: MessageSquare, key: 'oneplace' },
            ].map(item => (
              <li key={item.key} className="bg-brand-950/40 px-5 py-5 backdrop-blur-sm">
                {/* data-on-dark: amber as a foreground colour is
                    forbidden by brandContrast.test.ts because it is
                    2.15:1 on white. This strip is brand-950 over the
                    navy hero, where the same amber is 8.9:1. The
                    attribute is the deliberate, greppable exception -
                    a class string cannot see its own background. */}
                <item.icon
                  data-on-dark="true"
                  className="mb-3 h-5 w-5 text-brand-accent-500"
                  aria-hidden="true"
                />
                <p className="text-sm font-semibold text-white">{t(`home.trust.${item.key}`)}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/60">
                  {t(`home.trust.${item.key}.note`)}
                </p>
              </li>
            ))}
          </ul>

          {/* Real counts, and nothing where there is no count yet. */}
          {liveStats.length > 0 && (
            <div
              className="mt-12 grid grid-cols-2 gap-6 border-t border-white/10 pt-8 sm:grid-cols-4"
              data-testid="platform-stats"
            >
              {liveStats.map(stat => (
                <div key={stat.key}>
                  <p className="text-3xl font-bold text-white">{stat.value}</p>
                  <p className="mt-1 text-sm text-white/60">
                    {lang === 'ar' ? stat.label.ar : stat.label.en}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── BROWSE BY CATEGORY, AND THE OTHER WAY IN ─────────────────────
          The reference shows a nine-card image-top category rail whose last
          tile is Projects. There is no public projects listing - /projects/:id
          is membership-gated - so a Projects tile would lead nowhere, and the
          owner's direction was explicit: do not invent a destination and do
          not relabel /rfq as Projects. The rail ends with Get Quotes, which is
          the real buyer action that tile implied.

          Category imagery is an owner asset that has not arrived. Rather than
          stretch stock photography across nine tiles, each category carries a
          restrained brand surface and its own real listing count. */}
      <section className="border-b bg-background py-20" data-testid="home-browse">
        <div className="container">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-xl">
              <h2 className="text-3xl font-bold sm:text-4xl">{t('home.browse.title')}</h2>
              <p className="mt-3 text-muted-foreground">{t('home.browse.subtitle')}</p>
            </div>
            <Button variant="outline" onClick={() => navigate('/service-categories')} data-testid="home-browse-all">
              {t('home.browse.viewAll')} <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          {categoriesFailed ? (
            <LoadFailed
              text={loadFailedCopy(lang === 'ar').text}
              retryText={loadFailedCopy(lang === 'ar').retryText}
              onRetry={() => void refetchCategories()}
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {browseCategories.map((category: any) => (
                <button
                  key={category.nameEn}
                  type="button"
                  onClick={() => navigate(`/marketplace/products?cat=${encodeURIComponent(category.nameEn)}`)}
                  className="group flex flex-col rounded-xl border border-border bg-card p-4 text-start transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  data-testid="home-category-tile"
                >
                  {/* NO ICON. Nine identical package glyphs in a row is the
                      filler §73 names - an icon that distinguishes nothing is
                      decoration. A thin brand rule marks the tile as a
                      category without pretending to illustrate it, and the
                      name does the identifying until the owner's category
                      imagery arrives. */}
                  <span
                    aria-hidden="true"
                    className="mb-4 h-1 w-8 rounded-full bg-brand-200 transition-colors group-hover:bg-brand-accent-500"
                  />
                  <span className="text-sm font-semibold leading-snug">
                    {lang === 'ar' ? category.nameAr : category.nameEn}
                  </span>
                  {/* A count only where there is one. An empty category still
                      appears - a buyer sourcing marble should learn that
                      Rakiza has none, rather than be unable to find it. */}
                  {(category.listedProducts ?? 0) > 0 && (
                    <span className="mt-1 text-xs text-muted-foreground">
                      {listedLabel(category.listedProducts)}
                    </span>
                  )}
                </button>
              ))}

              {/* THE OTHER WAY IN, as a peer of the categories rather than a
                  banner below them: a buyer the catalogue cannot serve
                  describes the job once and suppliers answer. */}
              <button
                type="button"
                onClick={() => navigate('/rfq')}
                className="group flex flex-col rounded-xl border border-brand-accent-500/40 bg-brand-accent-500/10 p-4 text-start transition-all hover:-translate-y-0.5 hover:border-brand-accent-500 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="home-get-quotes-tile"
              >
                <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-accent-500 text-foreground">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold leading-snug">{t('home.browse.quotes')}</span>
                <span className="mt-1 text-xs text-muted-foreground">{t('home.browse.quotesNote')}</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── THE CONNECTED JOURNEY ────────────────────────────────────────
          This replaced TWO card grids - a six-card "Features" wall and a
          four-card "Four Steps to Success" wall - which between them listed
          capabilities twice and connected none of them. A reader learned
          that BuildHub HAS an RFQ system, not that posting one puts their
          requirement in front of matching suppliers and brings back
          comparable prices. §89 item 19 asks for the connected proposition;
          §73 names two walls of equal cards as the shape to avoid. */}
      <SourcingJourney />

      {/* ── USER TYPES ───────────────────────────────────────────────────── */}
      <section className="py-24 bg-background">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="secondary" className="mb-4 text-sm px-4 py-1">{lang === 'ar' ? 'لمن هذا؟' : 'Who Is It For?'}</Badge>
            <h2 className="text-4xl font-bold mb-4">{t('roles.title')}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {ROLE_IDENTITIES.map(role => (
              <Card
                key={role.id}
                className={`card-hover cursor-pointer group ${ROLE_CARD_CLASSES}`}
                onClick={() => navigate(ROLE_HREF)}
              >
                <CardContent className="p-6">
                  {/* The icon container is the only thing that varies, and it
                      varies between two brand treatments rather than six hues.
                      The icon itself does the identifying. */}
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-transform duration-200 group-hover:scale-105 ${roleIconClasses(role)}`}>
                    <role.icon className="w-6 h-6" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{roleLabels[role.id]}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-4">{roleDescs[role.id]}</p>
                  {/* One CTA colour across all six - the brand's. Six different
                      link colours was the rainbow's loudest symptom. */}
                  <Button variant="ghost" size="sm" className="gap-1 text-brand-600 p-0 h-auto font-medium">
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
          {/* CAPABILITY, NOT SCALE (§75).
              This read "Join thousands of users who trust BuildHub" - a
              claim about how many people use the platform and how they feel
              about it, and BuildHub can evidence neither. The replacement
              says what the product DOES, which a visitor can verify by
              using it rather than by believing it. */}
          <p className="text-white/70 text-lg max-w-xl mx-auto mb-8">
            {lang === 'ar'
              ? 'انشر متطلبك، وقارن عروض أسعار حقيقية من موردين موثّقين، وأدر المشروع بالكامل في مكان واحد.'
              : 'Post your requirement, compare real quotations from verified suppliers, and run the whole project in one place.'}
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
                <RakizaLogo tone="inverse" size="md" />
              </Link>
              {/* POSITIONING, NOT ARCHITECTURE. This read "The AI-powered
                  Construction OS", which describes the implementation to a
                  customer who came to source materials. AI is an enabling
                  capability here, not the reason the product exists, so the
                  line now says what BuildHub does for them. */}
              <p className="text-background/60 text-sm leading-relaxed">
                {lang === 'ar'
                  ? 'من التوريد إلى موقع التنفيذ — نربط رحلة مشروعك في منصة واحدة.'
                  : 'From sourcing to site, Rakiza connects your construction journey.'}
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
            {/* THE CURRENT YEAR, not a year that was current when this was
                written. A stale copyright line is the cheapest possible
                signal that a site is unmaintained, and it goes stale on a
                fixed date with nobody watching. */}
            <p className="text-background/40 text-sm" data-testid="footer-copyright">
              © {new Date().getFullYear()} {lang === 'ar' ? 'ركيزة' : 'Rakiza'}. {lang === 'ar' ? 'جميع الحقوق محفوظة.' : 'All rights reserved.'}
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
