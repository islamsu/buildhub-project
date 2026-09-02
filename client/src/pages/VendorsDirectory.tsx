import { useState } from 'react';
import { useLocation } from 'wouter';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import Navbar from '@/components/Navbar';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { rfqCategoryLabel } from '@shared/rfqCategories';
import { MasterProviderSlot } from '@/components/MasterPlacement';
import { Search, Star, BadgeCheck, MapPin, Megaphone, Store, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Phase 4B.3: the real, database-backed vendor directory.
 *
 * This page previously rendered a hard-coded array of fictional vendors from
 * client/src/lib/marketplaceData.ts. It now reads genuine provider accounts
 * through marketplace.vendors, which returns an explicit server-side column
 * allowlist - no private account fields ever reach this page.
 *
 * Every value shown is real: reputation is the same live AVG/COUNT over
 * verified reviews used everywhere else in BuildHub, and categories are the
 * vendor's own declarations from the shared RFQ taxonomy. Nothing is
 * fabricated - fields the mock used to invent (order counts, years in
 * business, delivery coverage, "recommended" badges) simply do not exist for
 * real accounts and are therefore not displayed.
 *
 * Ordering is organic only. A paid plan does not buy a higher position here;
 * paid placement is a separate, clearly-labelled concept for a later phase.
 */
/**
 * CLOSURE PASS: the Designers and Finishing directories used to render a
 * hardcoded list - invented ratings, review counts, team sizes and "verified"
 * badges, some of them attached to real named Egyptian companies that have no
 * BuildHub account. They now render THIS component with a category preset, so
 * there is one directory reading one source, and an empty category shows an
 * empty state rather than a fiction.
 */
export type VendorsDirectoryProps = {
  /** A category from the shared RFQ taxonomy to start filtered on. */
  presetCategory?: string;
  titleKey?: string;
  subtitleKey?: string;
};

/** The route component. wouter hands it route props, so it takes none of ours. */
export default function VendorsDirectory() {
  return <VendorsDirectoryView />;
}

export function VendorsDirectoryView({ presetCategory, titleKey, subtitleKey }: VendorsDirectoryProps) {
  const { lang, t } = useLanguage();
  const ar = lang === 'ar';
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(presetCategory ?? 'all');
  const [location, setLocation] = useState('');

  const { data: vendors = [], isLoading } = trpc.marketplace.vendors.useQuery({
    search: search.trim() || undefined,
    category: category === 'all' ? undefined : category,
    location: location.trim() || undefined,
  });
  const { data: categories = [] } = trpc.marketplace.vendorCategories.useQuery();
  // Sponsored placement is fetched SEPARATELY from the organic list, matching
  // how the server exposes it. One combined query would invite rendering a paid
  // slot as an organic result.
  //
  // `sponsoredVendors` rather than `featuredVendors`: BuildHub now sells a slot
  // two ways - a Premium entitlement, and an administrator's grant for one
  // service category - and a reader should not have to care which. The server
  // merges both and labels each with `sponsorshipSource`; an admin grant is
  // category-scoped, so it only ever appears when a category is selected.
  const { data: featured = [] } = trpc.marketplace.sponsoredVendors.useQuery({
    category: category === 'all' ? undefined : category,
    location: location.trim() || undefined,
  });
  // EDITORIAL FEATURED is separate from paid sponsorship. When this directory
  // is category-preset (Designers/Finishing), fetch only that category's picks;
  // the general vendors directory shows all editorial picks.
  const { data: editorialFeatured = [] } = trpc.marketplace.featuredProviders.useQuery({
    category: presetCategory,
  });

  const Back = ar ? ChevronRight : ChevronLeft;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container max-w-6xl pt-24 pb-16">
        <Button variant="ghost" size="sm" className="mb-4 gap-1.5" onClick={() => navigate('/marketplace')}>
          <Back className="w-4 h-4" />{t('common.back_to_marketplace')}
        </Button>

        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold">{t(titleKey ?? 'vendorsDir.title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">{t(subtitleKey ?? 'vendorsDir.subtitle')}</p>
        </div>

        {/* Filters */}
        <div className="grid gap-3 sm:grid-cols-3 mb-6">
          <div className="relative sm:col-span-1">
            <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-muted-foreground" />
            <Input
              className="ps-9"
              aria-label={t('vendorsDir.searchLabel')}
              placeholder={t('vendorsDir.searchPlaceholder')}
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger aria-label={t('vendorsDir.allCategories')}>
              <SelectValue placeholder={t('vendorsDir.allCategories')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('vendorsDir.allCategories')}</SelectItem>
              {categories.map(item => (
                <SelectItem key={item} value={item}>{rfqCategoryLabel(item, lang)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label={t('common.location')}
            placeholder={t('vendorsDir.locationPlaceholder')}
            value={location}
            onChange={event => setLocation(event.target.value)}
          />
        </div>

        {/* Organic ordering is a commitment, so it is stated plainly rather
            than left implicit: nothing on this page is bought. */}
        {!isLoading && vendors.length > 0 && (
          <p className="text-xs text-muted-foreground mb-4">
            {vendors.length} {t('vendorsDir.countSuffix')} · {t('vendorsDir.organicNote')}
          </p>
        )}

        {isLoading && (
          <div className="py-16 text-center text-muted-foreground">{t('common.loading')}</div>
        )}

        {!isLoading && vendors.length === 0 && (
          <div className="rounded-xl border border-dashed py-16 text-center">
            <Store className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="font-medium">{t('vendorsDir.emptyTitle')}</p>
            <p className="text-sm text-muted-foreground mt-1">{t('vendorsDir.emptyHint')}</p>
          </div>
        )}

        {/* MASTER DISCOVERY, above everything. The scope is whichever category
            is selected; with no category chosen it is the platform-wide slot,
            which is what a visitor sees before they narrow to a provider type.
            Renders nothing at all when no eligible Master is booked. */}
        <MasterProviderSlot category={category === 'all' ? undefined : category} />

        {/* Editorial Featured: platform-curated recognition, distinct from paid
            sponsorship. Shown before sponsored and organic so the strongest
            providers are immediately visible. */}
        {editorialFeatured.length > 0 && (
          <section className="mb-8" aria-label={t('market.featured')}>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <h2 className="text-sm font-semibold">{t('market.featured')}</h2>
              <p className="text-xs text-muted-foreground">{t('vendorsDir.editorialNote')}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {editorialFeatured.map(vendor => (
                <VendorCard key={`editorial-${vendor.id}`} vendor={vendor} lang={lang} t={t} onOpen={id => navigate(`/vendor/${id}`)} />
              ))}
            </div>
            <div className="mt-4 h-px bg-border" />
          </section>
        )}

        {/* Sponsored strip (Slice 8). A SEPARATE, labelled section - never a
            reordering of the organic list below, which still ranks by
            verification and recency exactly as it did before. These vendors
            also appear in that list, in their organic position. */}
        {featured.length > 0 && (
          <section className="mb-8" aria-label={t('vendorsDir.sponsoredSection')}>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <h2 className="text-sm font-semibold">{t('vendorsDir.sponsoredSection')}</h2>
              <p className="text-xs text-muted-foreground">{t('vendorsDir.sponsoredNote')}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map(vendor => (
                <VendorCard key={`featured-${vendor.id}`} vendor={vendor} sponsored lang={lang} t={t} onOpen={id => navigate(`/vendor/${id}`)} />
              ))}
            </div>
            <div className="mt-4 h-px bg-border" />
          </section>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vendors.map(vendor => (
            <VendorCard key={vendor.id} vendor={vendor} lang={lang} t={t} onOpen={id => navigate(`/vendor/${id}`)} />
          ))}
        </div>
      </main>
    </div>
  );
}

type DirectoryVendorCard = {
  id: number;
  name: string | null;
  bio: string | null;
  location: string | null;
  userRole: string | null;
  verified: boolean | null;
  categories: string[];
  averageRating: number | null;
  reviewCount: number;
};

/**
 * One directory card. Extracted in Slice 8 so the sponsored strip renders
 * vendors identically to the organic list - same reputation, same categories,
 * same layout. The ONLY visual difference is the sponsored label, which is the
 * point: a paid slot must look like what it is, not like a better vendor.
 */
function VendorCard({
  vendor, sponsored = false, lang, t, onOpen,
}: {
  vendor: DirectoryVendorCard;
  sponsored?: boolean;
  lang: string;
  t: (key: string) => string;
  onOpen: (id: number) => void;
}) {
  return (
      <Card
        role="button"
        tabIndex={0}
        className="p-4 card-hover cursor-pointer transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onClick={() => onOpen(vendor.id)}
        onKeyDown={event => { if (event.key === 'Enter') onOpen(vendor.id); }}
      >
        {sponsored && (
          <div className="mb-2.5 flex items-center gap-1.5">
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900 text-[10px] font-medium">
              <Megaphone className="w-2.5 h-2.5 me-1" />{t('vendorsDir.sponsored')}
            </Badge>
          </div>
        )}
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0">
            {(vendor.name ?? '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold truncate">{vendor.name}</span>
              {vendor.verified && (
                <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs">
                  <BadgeCheck className="w-3 h-3 me-0.5" />{t('common.verified')}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground capitalize mt-0.5">
              {(vendor.userRole ?? '').replace('_', ' ')}
            </div>
            {vendor.location && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate">{vendor.location}</span>
              </div>
            )}
          </div>
        </div>

        {/* Reputation - live from verified reviews, never a stored aggregate. */}
        <div className="flex items-center gap-1.5 mt-3" aria-label={t('vendorsDir.ratingLabel')}>
          {[1, 2, 3, 4, 5].map(star => (
            <Star
              key={star}
              className={`w-3.5 h-3.5 ${
                vendor.averageRating !== null && star <= Math.round(vendor.averageRating)
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-muted-foreground/30'
              }`}
            />
          ))}
          <span className="text-xs text-muted-foreground">
            {vendor.averageRating === null
              ? t('vendorsDir.noRating')
              : `${vendor.averageRating.toFixed(1)} · ${vendor.reviewCount} ${t('vendorsDir.reviewsSuffix')}`}
          </span>
        </div>

        {vendor.bio && (
          <p className="text-sm text-muted-foreground mt-3 line-clamp-2 leading-relaxed">{vendor.bio}</p>
        )}

        {vendor.categories.length > 0 && (
          <div className="mt-3">
            <span className="sr-only">{t('vendorsDir.categoriesLabel')}</span>
            <div className="flex flex-wrap gap-1">
              {vendor.categories.map(item => (
                <Badge key={item} variant="outline" className="text-[10px]">
                  {rfqCategoryLabel(item, lang)}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3 text-xs text-primary font-medium">{t('vendorsDir.viewProfile')}</div>
      </Card>
  );
}
