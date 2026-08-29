import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/Navbar';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useLocation } from 'wouter';
import { useMemo, useState } from 'react';
import { Search, Package, Store, PenTool, HardHat, ArrowRight, ArrowLeft, Star, BadgeCheck, TrendingUp, Sparkles } from 'lucide-react';
import { PRODUCT_CATEGORIES, DESIGN_CATEGORIES, FINISHING_CATEGORIES } from '@/lib/marketplaceData';
import { trpc } from '@/lib/trpc';

/**
 * CLOSURE PASS. The three "featured" strips and the search autocomplete on this
 * page were built from VENDORS / DESIGNERS / FINISHING_COMPANIES in
 * client/src/lib/marketplaceData.ts - hardcoded entries carrying invented
 * ratings, review counts and `verified` badges, several of them attached to
 * real named Egyptian companies with no BuildHub account.
 *
 * They now come from marketplace.vendors, the same authorized directory query
 * the vendors page uses: reputation from verified reviews, verification from
 * the compliance decision, categories declared by the vendor. The counts are
 * counts of real accounts, so an empty marketplace shows an empty marketplace.
 *
 * PRODUCT_CATEGORIES, DESIGN_CATEGORIES and FINISHING_CATEGORIES stay: they are
 * browse vocabulary, not claims about anybody.
 */
export default function MarketplaceHub() {
  const { lang, t } = useLanguage();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const ar = lang === 'ar';
  const Arrow = ar ? ArrowLeft : ArrowRight;

  // One authorized query. The directory already excludes unapproved and
  // unverified accounts, so nothing here can show a provider the marketplace
  // itself would not list.
  const { data: directory = [] } = trpc.marketplace.vendors.useQuery({ limit: 100 });
  const designers = directory.filter(v => v.categories?.includes('Design'));
  const finishing = directory.filter(v => v.categories?.includes('Renovation'));

  // AI-style autocomplete: search across products categories, vendors, designers, companies
  const suggestions = useMemo(() => {
    if (!search.trim() || search.trim().length < 2) return [];
    const q = search.trim().toLowerCase();
    const out: { type: string; label: string; href: string }[] = [];
    PRODUCT_CATEGORIES.filter(c => c.en.toLowerCase().includes(q) || c.ar.includes(q)).slice(0, 4).forEach(c =>
      out.push({ type: t('marketHub.suggestionProductCategory'), label: ar ? c.ar : c.en, href: `/marketplace/products?cat=${c.id}` }));
    // Suggestions are drawn from the SAME authorized directory rows that the
    // strips below render - never a second, looser source.
    directory.filter(v => (v.name ?? '').toLowerCase().includes(q)).slice(0, 3).forEach(v =>
      out.push({ type: t('marketHub.suggestionVendor'), label: v.name ?? `#${v.id}`, href: `/marketplace/vendors/${v.id}` }));
    designers.filter(d => (d.name ?? '').toLowerCase().includes(q)).slice(0, 3).forEach(d =>
      out.push({ type: t('marketHub.suggestionDesigner'), label: d.name ?? `#${d.id}`, href: `/vendor/${d.id}` }));
    finishing.filter(f => (f.name ?? '').toLowerCase().includes(q)).slice(0, 3).forEach(f =>
      out.push({ type: t('marketHub.suggestionFinishingCompany'), label: f.name ?? `#${f.id}`, href: `/vendor/${f.id}` }));
    return out.slice(0, 8);
  }, [search, ar, t]);

  const sections = [
    {
      id: 'products',
      href: '/marketplace/products',
      icon: Package,
      gradient: 'from-blue-600 to-cyan-500',
      title: t('marketHub.sectionProductsTitle'),
      desc: t('marketHub.sectionProductsDesc'),
      stat: `${PRODUCT_CATEGORIES.length}+`,
      statLabel: t('marketHub.categoriesLabel'),
      chips: PRODUCT_CATEGORIES.slice(0, 4).map(c => (ar ? c.ar : c.en)),
    },
    {
      id: 'vendors',
      href: '/marketplace/vendors',
      icon: Store,
      gradient: 'from-emerald-600 to-teal-500',
      title: t('marketHub.sectionVendorsTitle'),
      desc: t('marketHub.sectionVendorsDesc'),
      stat: `${directory.length}`,
      statLabel: t('marketHub.vendorsLabel'),
      chips: directory.slice(0, 3).map(v => v.name ?? `#${v.id}`),
    },
    {
      id: 'designers',
      href: '/marketplace/designers',
      icon: PenTool,
      gradient: 'from-violet-600 to-purple-500',
      title: t('marketHub.sectionDesignersTitle'),
      desc: t('marketHub.sectionDesignersDesc'),
      stat: `${DESIGN_CATEGORIES.length}`,
      statLabel: t('marketHub.disciplinesLabel'),
      chips: DESIGN_CATEGORIES.slice(0, 4).map(c => (ar ? c.ar : c.en)),
    },
    {
      id: 'finishing',
      href: '/marketplace/finishing',
      icon: HardHat,
      gradient: 'from-orange-600 to-amber-500',
      title: t('marketHub.sectionFinishingTitle'),
      desc: t('marketHub.sectionFinishingDesc'),
      stat: `${FINISHING_CATEGORIES.length}`,
      statLabel: t('marketHub.servicesLabel'),
      chips: FINISHING_CATEGORIES.slice(0, 4).map(c => (ar ? c.ar : c.en)),
    },
  ];

  // "Featured" here means the top of the organic directory order, which is
  // verified-first then newest. It is NOT paid placement: that is a separate,
  // labelled concept served by marketplace.featuredVendors, and mixing the two
  // is precisely how a paid slot ends up rendered as an editorial pick.
  const featuredVendors = directory.slice(0, 4);
  const featuredDesigners = designers.slice(0, 3);
  const featuredCompanies = finishing.slice(0, 3);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-16">
        {/* Hero + universal search */}
        <div className="bg-gradient-to-br from-primary via-primary/90 to-primary/70 text-primary-foreground py-16 relative overflow-hidden">
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 25% 30%, white 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
          <div className="container relative">
            <Badge className="bg-white/15 text-white border-0 mb-4 backdrop-blur">
              <Sparkles className="w-3.5 h-3.5 me-1" /> {t('marketHub.discoveryHub')}
            </Badge>
            <h1 className="text-4xl md:text-5xl font-bold mb-3">{t('marketHub.exploreTitle')}</h1>
            <p className="text-primary-foreground/80 text-lg max-w-2xl mb-8">
              {t('marketHub.heroSubtitle')}
            </p>
            <div className="relative max-w-2xl">
              <Search className="absolute start-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              {/* aria-label, not placeholder. A placeholder is not an
                  accessible name: it disappears the moment there is text in the
                  field, so a screen-reader user reviewing what they typed hears
                  an unnamed edit box. */}
              <Input
                aria-label={t('marketHub.searchPlaceholder')}
                className="ps-12 h-14 text-base bg-white text-foreground shadow-xl rounded-xl"
                placeholder={t('marketHub.searchPlaceholder')}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {suggestions.length > 0 && (
                <div className="absolute top-full mt-2 inset-x-0 bg-popover text-popover-foreground rounded-xl shadow-2xl border border-border overflow-hidden z-50">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted text-start transition-colors"
                      onClick={() => { setSearch(''); navigate(s.href); }}
                    >
                      <span className="font-medium text-sm">{s.label}</span>
                      <Badge variant="secondary" className="text-xs">{s.type}</Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Four premium section cards */}
        <div className="container py-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {sections.map(s => (
              <Card
                key={s.id}
                className="group cursor-pointer overflow-hidden border-border hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 relative"
                onClick={() => navigate(s.href)}
              >
                <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${s.gradient}`} />
                <div className="p-6 md:p-8">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${s.gradient} flex items-center justify-center text-white shadow-lg`}>
                      <s.icon className="w-7 h-7" />
                    </div>
                    <div className="text-end">
                      <div className="text-2xl font-bold">{s.stat}</div>
                      <div className="text-xs text-muted-foreground">{s.statLabel}</div>
                    </div>
                  </div>
                  <h2 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">{s.title}</h2>
                  <p className="text-sm text-muted-foreground mb-4">{s.desc}</p>
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {s.chips.map((c, i) => (
                      <Badge key={i} variant="secondary" className="text-xs font-normal">{c}</Badge>
                    ))}
                    <Badge variant="outline" className="text-xs font-normal">+{t('marketHub.more')}</Badge>
                  </div>
                  <div className="flex items-center gap-1 text-sm font-medium text-primary">
                    {t('marketHub.explore')} <Arrow className="w-4 h-4 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform" />
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Featured vendors strip */}
          <div className="mt-14">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <BadgeCheck className="w-5 h-5 text-emerald-600" /> {t('marketHub.featuredVendors')}
              </h3>
              <button className="text-sm text-primary font-medium hover:underline" onClick={() => navigate('/marketplace/vendors')}>
                {t('marketHub.viewAll')}
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {featuredVendors.map(vendor => (
                <DirectoryCard key={vendor.id} vendor={vendor} t={t} onOpen={() => navigate(`/vendor/${vendor.id}`)} />
              ))}
              {featuredVendors.length === 0 && (
                <p className="col-span-full text-sm text-muted-foreground">{t('marketHub.noneYet')}</p>
              )}
            </div>
          </div>

          {/* Designers and finishing companies, from the same directory rows. */}
          <div className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-violet-600" /> {t('marketHub.featuredDesigners')}
                </h3>
                <button className="text-sm text-primary font-medium hover:underline" onClick={() => navigate('/marketplace/designers')}>
                  {t('marketHub.viewAll')}
                </button>
              </div>
              <div className="space-y-3">
                {featuredDesigners.map(vendor => (
                  <DirectoryCard key={vendor.id} vendor={vendor} t={t} onOpen={() => navigate(`/vendor/${vendor.id}`)} />
                ))}
                {featuredDesigners.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('marketHub.noneYet')}</p>
                )}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <HardHat className="w-5 h-5 text-orange-600" /> {t('marketHub.featuredCompanies')}
                </h3>
                <button className="text-sm text-primary font-medium hover:underline" onClick={() => navigate('/marketplace/finishing')}>
                  {t('marketHub.viewAll')}
                </button>
              </div>
              <div className="space-y-3">
                {featuredCompanies.map(vendor => (
                  <DirectoryCard key={vendor.id} vendor={vendor} t={t} onOpen={() => navigate(`/vendor/${vendor.id}`)} />
                ))}
                {featuredCompanies.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('marketHub.noneYet')}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One card for a real directory row, used by all three strips.
 *
 * Renders only fields the server actually returns. `averageRating` is NULL
 * until a vendor has a verified review, and that renders as "no reviews yet" -
 * never as 0, and never as a number the marketplace does not have. That
 * distinction is the whole reason the fabricated lists were a problem.
 */
function DirectoryCard({
  vendor, t, onOpen,
}: {
  vendor: { id: number; name: string | null; avatar: string | null; location: string | null; verified: boolean | null; categories: string[]; averageRating: number | null; reviewCount: number };
  t: (key: string) => string;
  onOpen: () => void;
}) {
  return (
    <Card className="p-4 cursor-pointer hover:shadow-lg transition-shadow" onClick={onOpen}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
          {vendor.avatar
            ? <img src={vendor.avatar} alt="" className="w-full h-full object-cover" />
            : <Store className="w-5 h-5 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate flex items-center gap-1">
            {vendor.name ?? `#${vendor.id}`}
            {vendor.verified && <BadgeCheck className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {vendor.categories.length > 0 ? vendor.categories.slice(0, 2).join(' · ') : (vendor.location ?? '')}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 text-xs mt-2">
        {vendor.averageRating != null ? (
          <>
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            <span className="font-medium">{vendor.averageRating}</span>
            <span className="text-muted-foreground">({vendor.reviewCount})</span>
          </>
        ) : (
          <span className="text-muted-foreground">{t('marketHub.noReviewsYet')}</span>
        )}
      </div>
    </Card>
  );
}
