import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/Navbar';
import { FeaturedProductCard } from '@/components/FeaturedProductCard';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLocation } from 'wouter';
import { useMemo, useState } from 'react';
import { Search, Package, Store, PenTool, HardHat, ArrowRight, ArrowLeft, Star, BadgeCheck, TrendingUp, Sparkles } from 'lucide-react';
import { DESIGN_CATEGORIES, FINISHING_CATEGORIES } from '@/lib/marketplaceData';
import { trpc } from '@/lib/trpc';
import { usePageTitle } from '../hooks/usePageTitle';

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
 * DESIGN_CATEGORIES and FINISHING_CATEGORIES stay: they are browse vocabulary
 * for the two provider directories, not claims about anybody.
 *
 * PRODUCT_CATEGORIES DID NOT. It was a third product-category list - 33 browse
 * chips sharing NO values with the 19 the write path accepted - so a shopper
 * clicking any chip here could never find a product: nothing could be listed
 * under those names. The chips now come from the same taxonomy a supplier
 * lists against, and carry the canonical name the marketplace filter uses.
 */
export default function MarketplaceHub() {
  usePageTitle();
  const { lang, t } = useLanguage();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const ar = lang === 'ar';
  const Arrow = ar ? ArrowLeft : ArrowRight;

  // One authorized query. The directory already excludes unapproved and
  // unverified accounts, so nothing here can show a provider the marketplace
  // itself would not list.
  const { data: directory = [], isLoading: directoryLoading, isError: directoryFailed } =
    trpc.marketplace.vendors.useQuery({ limit: 100 }, { retry: false });
  /** The one taxonomy, in its public view. Not a copy compiled into this page. */
  const { data: taxonomy, isLoading: taxonomyLoading, isError: taxonomyFailed } =
    trpc.marketplace.categories.useQuery({ view: 'public', withCounts: true }, { retry: false });
  const productCategories = taxonomy?.categories ?? [];
  /**
   * HOW MANY ITEMS THE CATALOGUE ACTUALLY HOLDS.
   *
   * The Products card's headline figure was the number of CATEGORIES - the
   * browse vocabulary - sitting in the slot the three cards beside it use for
   * a count of real entities. Nineteen categories and an empty catalogue read
   * as "19 Products" to anybody scanning the row.
   *
   * `publicProducts` is counted server-side with the marketplace's own
   * visibility predicate, so the headline is a promise the next page keeps.
   * The category count stays, demoted to the secondary line where it is a
   * true statement about the vocabulary rather than about the catalogue.
   */
  const { data: platformStats, isLoading: statsLoading, isError: statsFailed } =
    trpc.marketplace.platformStats.useQuery(undefined, { retry: false });
  /*
   * A COUNT IS A CLAIM, AND SO IS A ZERO.
   *
   * The headline figures on the section cards were fixed once already, when
   * two of them counted a constant compiled into the page. They still counted
   * an EMPTY ARRAY the same way: a failed or in-flight request left
   * `directory` at its `= []` default, and a public page told a visitor that
   * BuildHub has 0 vendors and 0 designers - a statement about the size of the
   * business, made because a request did not come back.
   *
   * `null` is the third answer that was missing. The card renders a dash for
   * "not known right now", which is neither a number nor a lie, and the count
   * only appears once a real response has arrived.
   */
  const countOrUnknown = (failed: boolean, loading: boolean, value: number) =>
    (failed || loading ? '—' : String(value));

  /**
   * WHAT A BUYER SEES FIRST IS WHAT BUILDHUB CAN ACTUALLY SUPPLY.
   *
   * Stock-bearing categories lead, ties broken by the taxonomy's own order so
   * the grid does not reshuffle on every render. Empty categories are not
   * hidden - a buyer sourcing marble should learn that BuildHub has none
   * rather than be unable to find the category at all - they simply do not
   * take the first twelve slots from categories that have listings.
   */
  /**
   * "1 listings" IS A DEFECT, AND SO IS "2 منتج".
   *
   * English needs a singular. Arabic needs four forms - singular, dual, the
   * plural used for 3-10 and the accusative singular used from 11 - and a
   * marketplace that gets its own product noun wrong in its own language is
   * not treating Arabic as a first-class product language.
   */
  const listingsLabel = (n: number) => {
    const key = !ar
      ? (n === 1 ? 'marketHub.listingsCountOne' : 'marketHub.listingsCount')
      : n === 1 ? 'marketHub.listingsCountOne'
      : n === 2 ? 'marketHub.listingsCountTwo'
      : n % 100 >= 3 && n % 100 <= 10 ? 'marketHub.listingsCount'
      : 'marketHub.listingsCountMany';
    return t(key).replace('{n}', String(n));
  };

  const browseCategories = useMemo(() => {
    const ordered = [...productCategories];
    ordered.sort((a: any, b: any) => (b.listedProducts ?? 0) - (a.listedProducts ?? 0));
    return ordered.slice(0, 12);
  }, [productCategories]);

  const designers = directory.filter(v => v.categories?.includes('Design'));
  const finishing = directory.filter(v => v.categories?.includes('Renovation'));

  // AI-style autocomplete: search across products categories, vendors, designers, companies
  const suggestions = useMemo(() => {
    if (!search.trim() || search.trim().length < 2) return [];
    const q = search.trim().toLowerCase();
    const out: { type: string; label: string; href: string }[] = [];
    // The link carries the CANONICAL English name, which is what the
    // marketplace filter and products.category both hold. It used to carry a
    // slug from a different vocabulary, which matched no filter at all.
    productCategories
      .filter(c => c.nameEn.toLowerCase().includes(q) || c.nameAr.includes(q))
      .slice(0, 4)
      .forEach(c => out.push({
        type: t('marketHub.suggestionProductCategory'),
        label: ar ? c.nameAr : c.nameEn,
        href: `/marketplace/products?cat=${encodeURIComponent(c.nameEn)}`,
      }));
    // Suggestions are drawn from the SAME authorized directory rows that the
    // strips below render - never a second, looser source.
    // /vendor/:id, not /marketplace/vendors/:id. The latter renders the whole
    // directory and drops the id, so picking one vendor out of the suggestions
    // delivered a page listing all of them. The designer and finishing
    // suggestions immediately below already used the canonical route; this one
    // was the odd branch out.
    directory.filter(v => (v.name ?? '').toLowerCase().includes(q)).slice(0, 3).forEach(v =>
      out.push({ type: t('marketHub.suggestionVendor'), label: v.name ?? `#${v.id}`, href: `/vendor/${v.id}` }));
    designers.filter(d => (d.name ?? '').toLowerCase().includes(q)).slice(0, 3).forEach(d =>
      out.push({ type: t('marketHub.suggestionDesigner'), label: d.name ?? `#${d.id}`, href: `/vendor/${d.id}` }));
    finishing.filter(f => (f.name ?? '').toLowerCase().includes(q)).slice(0, 3).forEach(f =>
      out.push({ type: t('marketHub.suggestionFinishingCompany'), label: f.name ?? `#${f.id}`, href: `/vendor/${f.id}` }));
    return out.slice(0, 8);
  }, [search, ar, t, directory, designers, finishing, productCategories]);

  const sections = [
    {
      id: 'products',
      href: '/marketplace/products',
      icon: Package,
      gradient: 'from-blue-600 to-cyan-500',
      title: t('marketHub.sectionProductsTitle'),
      desc: t('marketHub.sectionProductsDesc'),
      stat: countOrUnknown(statsFailed, statsLoading, platformStats?.publicProducts ?? 0),
      statLabel: t('marketHub.productsLabel'),
      // Secondary, and only once the taxonomy has really answered: a dash in
      // the headline with "19 categories" underneath would be the same
      // substitution in a smaller font.
      secondary: taxonomyFailed || taxonomyLoading || productCategories.length === 0
        ? null
        : `${productCategories.length} ${t('marketHub.categoriesLabel').toLowerCase()}`,
      chips: productCategories.slice(0, 4).map(c => (ar ? c.nameAr : c.nameEn)),
    },
    {
      id: 'vendors',
      href: '/marketplace/vendors',
      icon: Store,
      gradient: 'from-emerald-600 to-teal-500',
      title: t('marketHub.sectionVendorsTitle'),
      desc: t('marketHub.sectionVendorsDesc'),
      stat: countOrUnknown(directoryFailed, directoryLoading, directory.length),
      statLabel: t('marketHub.vendorsLabel'),
      secondary: null,
      chips: directory.slice(0, 3).map(v => v.name ?? `#${v.id}`),
    },
    {
      id: 'designers',
      href: '/marketplace/designers',
      icon: PenTool,
      gradient: 'from-violet-600 to-purple-500',
      title: t('marketHub.sectionDesignersTitle'),
      desc: t('marketHub.sectionDesignersDesc'),
      /**
       * A REAL COUNT, like the card beside it.
       *
       * This was `DESIGN_CATEGORIES.length` - a constant compiled into the
       * page - sitting in the same slot as the vendors card's count of real
       * accounts. With no designer on the platform the card still read "14
       * disciplines", which is a number that cannot move, presented as one
       * that can. `designers` is already computed above from the authorized
       * directory; it was used for the suggestions and the featured strip and
       * not for the headline figure.
       */
      stat: countOrUnknown(directoryFailed, directoryLoading, designers.length),
      statLabel: t('marketHub.providersLabel'),
      secondary: null,
      chips: DESIGN_CATEGORIES.slice(0, 4).map(c => (ar ? c.ar : c.en)),
    },
    {
      id: 'finishing',
      href: '/marketplace/finishing',
      icon: HardHat,
      gradient: 'from-orange-600 to-amber-500',
      title: t('marketHub.sectionFinishingTitle'),
      desc: t('marketHub.sectionFinishingDesc'),
      // The same correction, for the same reason.
      stat: countOrUnknown(directoryFailed, directoryLoading, finishing.length),
      statLabel: t('marketHub.providersLabel'),
      secondary: null,
      chips: FINISHING_CATEGORIES.slice(0, 4).map(c => (ar ? c.ar : c.en)),
    },
  ];

  // EDITORIAL FEATURED is a real admin-curated state, not the top of the
  // organic ranking. Each row carries its `featuredCategory`, so the hub maps
  // one source onto Featured Vendors, Featured Designers and Featured Finishing.
  //
  // ONE READER, AND IT IS THE EDITORIAL ONE. The hub calls no commercial
  // reader: these strips carry BuildHub's own word, so a paid slot must not
  // reach them. Commercial placement is rendered on the vendors directory,
  // in its own section, under the Sponsored label.
  const { data: featured = [] } = trpc.marketplace.featuredProviders.useQuery();
  /* The editorial product picks, for the strip beside the provider ones. */
  const { data: featuredProducts = [] } = trpc.marketplace.featuredProducts.useQuery({ limit: 4 });
  const featuredVendors = featured
    .filter(v => !['Design', 'Renovation'].includes(v.featuredCategory)).slice(0, 4);
  const featuredDesigners = featured.filter(v => v.featuredCategory === 'Design').slice(0, 3);
  const featuredCompanies = featured.filter(v => v.featuredCategory === 'Renovation').slice(0, 3);

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

        {/*
          ── THE ORDER OF THIS PAGE IS THE HIERARCHY ─────────────────────

          MACRO VERTICALS first: what can be sourced here at all.
          Then FEATURED - BuildHub's own editorial picks, labelled as such.
          Then the taxonomy, SUBORDINATE to Products rather than above it.
          Then the RFQ path, for a buyer the catalogue cannot serve.

          The taxonomy used to sit ABOVE the four vertical cards, which put
          browse vocabulary ahead of the question this page exists to answer.
        */}

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
                <div className="flex h-full flex-col p-6 md:p-8">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${s.gradient} flex items-center justify-center text-white shadow-lg`}>
                      <s.icon className="w-7 h-7" />
                    </div>
                    <div className="text-end">
                      <div className="text-2xl font-bold" data-testid={`hub-stat-${s.id}`}>{s.stat}</div>
                      <div className="text-xs text-muted-foreground" data-testid={`hub-statlabel-${s.id}`}>{s.statLabel}</div>
                      {s.secondary && (
                        <div className="text-[11px] text-muted-foreground/70 mt-0.5" data-testid={`hub-secondary-${s.id}`}>{s.secondary}</div>
                      )}
                    </div>
                  </div>
                  <h2 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">{s.title}</h2>
                  <p className="text-sm text-muted-foreground mb-4">{s.desc}</p>
                  {/* The chips DESCRIBE the section - they are not filters,
                      and the card as a whole is what navigates. On the two
                      provider sections they are browse vocabulary rather than
                      a claim about anybody, which is why they are allowed to
                      be a constant while the count beside them is not. */}
                  <div className="flex flex-wrap gap-1.5 mb-5" data-testid={`hub-chips-${s.id}`}>
                    {s.chips.map((c, i) => (
                      <Badge key={i} variant="secondary" className="text-xs font-normal">{c}</Badge>
                    ))}
                    <Badge variant="outline" className="text-xs font-normal">+{t('marketHub.more')}</Badge>
                  </div>
                  {/* mt-auto: the grid stretches all four cards to the
                      tallest, and without this the shorter ones ended in a
                      band of empty card. The action now sits on the floor of
                      every card, which is also where the eye looks for it. */}
                  <div className="mt-auto flex items-center gap-1 text-sm font-medium text-primary">
                    {t('marketHub.explore')} <Arrow className="w-4 h-4 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform" />
                  </div>
                </div>
              </Card>
            ))}
          </div>

        </div>
        {/* Prime Featured content: directly beneath discovery, before the
            category cards. Hidden when there is no real curated record. */}
        {featured.length > 0 && (
          <div className="container pt-10 pb-2">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <BadgeCheck className="w-5 h-5 text-emerald-600" /> {t('marketHub.featuredVendors')}
              </h2>
              <button className="text-sm text-primary font-medium hover:underline" onClick={() => navigate('/marketplace/vendors')}>
                {t('marketHub.viewAll')}
              </button>
            </div>
            {/* A HEADING IS A PROMISE. The outer block already hides itself
                when nothing at all is curated, but each of these three lists is
                filtered independently - picks in Design and none in Renovation
                left a "Featured Finishing Companies" heading standing over an
                empty grid. Naming the absence is the honest answer; padding it
                with anything else would be filler. */}
            {featuredVendors.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('marketHub.noneYet')}</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {featuredVendors.map(vendor => (
                  <DirectoryCard key={vendor.id} vendor={vendor} t={t} onOpen={() => navigate(`/vendor/${vendor.id}`)} />
                ))}
              </div>
            )}

            <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-violet-600" /> {t('marketHub.featuredDesigners')}
                  </h2>
                  <button className="text-sm text-primary font-medium hover:underline" onClick={() => navigate('/marketplace/designers')}>
                    {t('marketHub.viewAll')}
                  </button>
                </div>
                {featuredDesigners.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('marketHub.noneYet')}</p>
                ) : (
                  <div className="space-y-3">
                    {featuredDesigners.map(vendor => (
                      <DirectoryCard key={vendor.id} vendor={vendor} t={t} onOpen={() => navigate(`/vendor/${vendor.id}`)} />
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <HardHat className="w-5 h-5 text-orange-600" /> {t('marketHub.featuredCompanies')}
                  </h2>
                  <button className="text-sm text-primary font-medium hover:underline" onClick={() => navigate('/marketplace/finishing')}>
                    {t('marketHub.viewAll')}
                  </button>
                </div>
                {featuredCompanies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('marketHub.noneYet')}</p>
                ) : (
                  <div className="space-y-3">
                    {featuredCompanies.map(vendor => (
                      <DirectoryCard key={vendor.id} vendor={vendor} t={t} onOpen={() => navigate(`/vendor/${vendor.id}`)} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/*
          FEATURED PRODUCTS, beside Featured Providers and above the section
          cards - the owner's decision that Featured is PRIME.

          `products.featured` had existed for a long time and did exactly one
          thing: it broke ties in the catalogue's ORDER BY. A product BuildHub
          had deliberately chosen appeared slightly higher in a list and
          nowhere else, so the editorial decision was invisible to the person
          it was made for.

          EDITORIAL, AND SAID SO. The badge names it, in words and with an
          icon, because a paid placement and a curated one must never be
          distinguishable by hue alone. The paid slots have their own
          components and their own label, deliberately unshared.

          Hidden entirely when nothing is curated. No heading over an empty
          grid, and no invented product - a fabricated editorial pick is a
          claim BuildHub made about a supplier it never chose.
        */}
        {featuredProducts.length > 0 && (
          <div className="container pt-8 pb-2" data-testid="hub-featured-products">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <BadgeCheck className="w-5 h-5 text-emerald-600" />
                {lang === 'ar' ? 'منتجات مختارة' : 'Featured Products'}
              </h2>
              <button
                className="text-sm text-primary font-medium hover:underline"
                onClick={() => navigate('/marketplace/products')}
              >
                {t('marketHub.viewAll')}
              </button>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {featuredProducts.map(product => (
                <FeaturedProductCard
                  key={product.id}
                  product={product as any}
                  lang={lang}
                  onOpen={() => navigate(`/marketplace/products/${product.id}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/*
          CATEGORY DISCOVERY - SUBORDINATE TO PRODUCTS.

          The taxonomy was already loaded on this page and used for exactly two
          things: a number in a stat tile, and the search autocomplete. A
          visitor who did not already know what they wanted had no way to
          browse into one.

          ONE TAXONOMY, the canonical public one. No second hard-coded array:
          a category shown here is a category the catalogue can filter by, and
          the link carries `cat` because that is the parameter the products
          page reads.

          TWO THINGS CHANGED HERE.

          The tiles carried an EMOJI, from `productCategories.icon`. Marble and
          Granite were issued the same rock glyph, half the taxonomy had no
          icon at all and fell back to a parcel box, and the service categories
          rendered as the replacement character on a machine without the font.
          A B2B procurement catalogue is not a picker of pictograms, and the
          owner named this directly. The tile now leads with the category and
          the one fact a buyer sourcing in it wants: HOW MANY LISTINGS IT HOLDS.

          That count is real - `withCounts` on the taxonomy query, resolved
          server-side by the canonical `categoryUsage` aggregate against the
          same lifecycle status the catalogue lists by. A category with nothing
          in it says so rather than promising a page of results, and the
          categories that DO hold stock sort to the front, which is what makes
          this a sourcing surface instead of an alphabet.
        */}
        {productCategories.length > 0 && (
          <div className="container pt-8 pb-2" data-testid="hub-category-discovery">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold">{lang === 'ar' ? 'تصفّح حسب الفئة' : 'Browse by category'}</h2>
              <button
                className="text-sm font-medium text-primary hover:underline"
                onClick={() => navigate('/marketplace/products')}
              >
                {t('marketHub.viewAll')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {browseCategories.map((category: any) => (
                <button
                  key={category.id ?? category.slug ?? category.nameEn}
                  data-testid={`hub-category-${category.slug ?? category.nameEn}`}
                  onClick={() => navigate(`/marketplace/products?cat=${encodeURIComponent(category.nameEn)}`)}
                  className="group flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-start transition-colors hover:border-primary/40 hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="line-clamp-2 text-sm font-medium group-hover:text-primary">
                    {lang === 'ar' ? (category.nameAr || category.nameEn) : category.nameEn}
                  </span>
                  {/* A COUNT, OR NOTHING. `listedProducts` is absent while the
                      taxonomy query is in flight or if it failed, and a
                      confident "0 listings" assembled from a missing response
                      is the same defect as the stat tiles above. */}
                  {typeof category.listedProducts === 'number' && (
                    <span
                      className={`shrink-0 text-xs tabular-nums ${category.listedProducts > 0 ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}
                      data-testid={`hub-category-count-${category.slug ?? category.nameEn}`}
                    >
                      {category.listedProducts > 0
                        ? listingsLabel(category.listedProducts)
                        : t('marketHub.noListingsYet')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/*
          THE OTHER WAY TO SOURCE.

          Browsing is one of the two buyer paths, and the weaker one for
          anything specified rather than catalogued. The RFQ path had no entry
          point in the body of this page at all: a buyer the grid could not
          serve had nowhere to go but back to the navbar.
        */}
        <div className="border-t bg-muted/30">
          <div className="container py-10">
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div className="max-w-xl">
                <h2 className="text-xl font-bold">{t('marketHub.rfqTitle')}</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">{t('marketHub.rfqDesc')}</p>
              </div>
              <Button size="lg" className="shrink-0" data-testid="hub-rfq-cta" onClick={() => navigate('/rfq')}>
                {t('marketHub.rfqCta')} <Arrow className="ms-2 w-4 h-4" />
              </Button>
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
