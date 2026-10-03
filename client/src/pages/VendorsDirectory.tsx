import { useState, useMemo } from 'react';
import { SaveButton } from '@/components/SaveButton';
import { useSavedIds } from '@/lib/useSavedIds';
import { useLocation } from 'wouter';
import { useLanguage } from '@/contexts/LanguageContext';
import LoadFailed, { loadFailedCopy } from '@/components/LoadFailed';
import { trpc } from '@/lib/trpc';
import Navbar from '@/components/Navbar';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { rfqCategoryLabel } from '@shared/rfqCategories';
import type { ProviderRole } from '@shared/roleMatrix';
import { MasterProviderSlot, PlacementBadge, ProviderSpotlight } from '@/components/MasterPlacement';
import { Search, Star, BadgeCheck, MapPin, Megaphone, Store, ChevronLeft, ChevronRight } from 'lucide-react';
import { usePageTitle } from '../hooks/usePageTitle';

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
  /**
   * ONE PROVIDER ROLE, fixed for the whole view.
   *
   * ── WHY THIS IS NOT A CATEGORY PRESET ──────────────────────────────────
   *
   * Role and declared category are different dimensions and the navigation
   * needs both. Design Services and Finishing are CATEGORY views: a contractor
   * who has declared Renovation belongs in Finishing, and filtering those by
   * role would throw away the providers the customer came for. Suppliers and
   * Contractors are ROLE views: "I need a supplier" is a question about what
   * kind of business it is, not about what service they listed.
   *
   * NOT A USER-CHANGEABLE FILTER. The category dropdown stays usable inside a
   * role view - a buyer can narrow Contractors to Renovation - but the role
   * itself is the destination's identity. A role select would turn four
   * first-class journeys back into one directory with a dropdown, which is the
   * consolidation the owner rejected.
   */
  presetRole?: ProviderRole;
  titleKey?: string;
  subtitleKey?: string;
};

/** The route component. wouter hands it route props, so it takes none of ours. */
export default function VendorsDirectory() {
  usePageTitle();
  return <VendorsDirectoryView />;
}

export function VendorsDirectoryView({
  presetCategory, presetRole, titleKey, subtitleKey,
}: VendorsDirectoryProps) {
  const { lang, t } = useLanguage();
  const ar = lang === 'ar';
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(presetCategory ?? 'all');
  const [location, setLocation] = useState('');

  /*
   * A failed directory query rendered neither the count nor the loading line -
   * just an empty page with no explanation of why. §64: every substantial data
   * surface must distinguish loading, ready, empty and error.
   */
  const { data: vendors = [], isLoading, isError: vendorsFailed, refetch: refetchVendors } =
    trpc.marketplace.vendors.useQuery({
    search: search.trim() || undefined,
    category: category === 'all' ? undefined : category,
    location: location.trim() || undefined,
    // Enforced SERVER-SIDE, not by filtering the response. A role view that
    // fetched everything and hid the rest would still ship other roles'
    // provider records to the browser, and its result count would describe a
    // list the page does not show.
    role: presetRole,
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
  /*
   * ── PLACEMENT IS SOLD BY CATEGORY, SO IT IS NOT SHOWN ON A ROLE VIEW ───
   *
   * Every placement surface - Master, Spotlight, Sponsored, editorial Featured
   * - is scoped by CATEGORY or globally. None of them is sold per role, which
   * leaves exactly two ways to render them on a Suppliers or Contractors page
   * and both are wrong:
   *
   *   SHOW THEM UNFILTERED and the page that promises Suppliers opens with a
   *   contractor in a paid slot. That is the generic all-provider directory
   *   wearing a role label, which is the consolidation being corrected.
   *
   *   FILTER THEM CLIENT-SIDE and an advertiser silently loses impressions on
   *   a surface they did bring relevance to, with no record of it. Narrowing
   *   what a booking delivers is a commercial change, and placement
   *   eligibility is frozen.
   *
   * So a role view renders the ORGANIC role-filtered directory only. Nothing
   * about placement changes: the bookings keep their category scope and keep
   * appearing in full on /marketplace/vendors, on the category views and on
   * the marketplace hub. They are simply not surfaced on a view whose axis
   * they were never sold against.
   */
  const placementsApply = !presetRole;
  const { data: featured = [] } = trpc.marketplace.sponsoredVendors.useQuery({
    category: category === 'all' ? undefined : category,
    location: location.trim() || undefined,
  }, { enabled: placementsApply });
  // EDITORIAL FEATURED is separate from paid sponsorship. When this directory
  // is category-preset (Designers/Finishing), fetch only that category's picks;
  // the general vendors directory shows all editorial picks.
  const { data: editorialFeatured = [] } = trpc.marketplace.featuredProviders.useQuery({
    category: presetCategory,
  }, { enabled: placementsApply });

  /**
   * WHICH OF THESE IS ALREADY SAVED - ONE QUERY FOR THE PAGE.
   *
   * Across all three strips, because the same provider can appear as an
   * editorial pick AND organically, and two reads would let the same card
   * show a filled bookmark in one place and an empty one in the other.
   *
   * Not a `saved` flag on the public directory rows: a per-viewer fact
   * inside a cacheable public response is how a shared cache ends up showing
   * one buyer another's shortlist.
   */
  const allVendorIds = useMemo(
    () => Array.from(new Set([...vendors, ...featured, ...editorialFeatured].map(v => Number(v.id)))),
    [vendors, featured, editorialFeatured],
  );
  const savedIds = useSavedIds('provider', allVendorIds);

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

        {vendorsFailed && (
          <LoadFailed
            text={loadFailedCopy(lang === 'ar').text}
            retryText={loadFailedCopy(lang === 'ar').retryText}
            onRetry={() => void refetchVendors()}
          />
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

        {/*
          FEATURED FIRST, then sponsored, then organic.

          This block used to sit BELOW the Master and Spotlight slots, which
          are the placements BuildHub sells. The owner's decision is that
          editorial Featured is PRIME and must never be pushed below a
          commercial row: a curated pick is BuildHub vouching for a provider,
          and a visitor who sees a paid slot first has been shown an
          advertisement before a recommendation.

          Sponsored is not hidden or weakened by this - it keeps its slot, its
          label and its position above the organic list, immediately below.
        */}
        {editorialFeatured.length > 0 && (
          <section className="mb-8" aria-label={t('market.featured')} data-testid="vendors-editorial-featured" data-placement-kind="featured">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <h2 className="text-sm font-semibold">{t('market.featured')}</h2>
              <p className="text-xs text-muted-foreground">{t('vendorsDir.editorialNote')}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {editorialFeatured.map(vendor => (
                <VendorCard key={`editorial-${vendor.id}`} vendor={vendor} lang={lang} t={t} isSaved={savedIds.has(vendor.id)} onOpen={id => navigate(`/vendor/${id}`)} />
              ))}
            </div>
            <div className="mt-4 h-px bg-border" />
          </section>
        )}

        {/* MASTER DISCOVERY. The scope is whichever category is selected; with
            none chosen it is the platform-wide slot, which is what a visitor
            sees before they narrow to a provider type. Renders nothing at all
            when no eligible Master is booked. */}
        {placementsApply && <MasterProviderSlot category={category === 'all' ? undefined : category} />}

        {/* SPOTLIGHT, once a provider type is chosen. Master belongs to root
            discovery and Spotlight to the chosen type; only one of the two ever
            renders, because each asks for a different scope. Capped at three,
            with the organic list below rather than an advertising wall. */}
        {placementsApply && <ProviderSpotlight category={category === 'all' ? undefined : category} />}

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
                <VendorCard key={`featured-${vendor.id}`} vendor={vendor} sponsored lang={lang} t={t} isSaved={savedIds.has(vendor.id)} onOpen={id => navigate(`/vendor/${id}`)} />
              ))}
            </div>
            <div className="mt-4 h-px bg-border" />
          </section>
        )}

        {/* THE ORGANIC LIST, which may now contain BOOSTED rows. Boost changes
            a provider's POSITION in this list and nothing else - it never adds
            one - so a boosted row is an ordinary card carrying its own honest
            label rather than a separate section. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vendors.map(vendor => (
            <div key={vendor.id} className="relative">
              {vendor.boosted && vendor.label && (
                <div className="mb-1.5" data-testid="boosted-vendor">
                  <PlacementBadge label={vendor.label} />
                </div>
              )}
              <VendorCard vendor={vendor} lang={lang} t={t} isSaved={savedIds.has(vendor.id)} onOpen={id => navigate(`/vendor/${id}`)} />
            </div>
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
  vendor, sponsored = false, lang, t, onOpen, isSaved,
}: {
  vendor: DirectoryVendorCard;
  sponsored?: boolean;
  lang: string;
  t: (key: string) => string;
  onOpen: (id: number) => void;
  /** From the page's ONE batched savedState read, not a per-card query. */
  isSaved?: boolean;
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
            {/* Neutral, for the same reason as the canonical badge in
                MasterPlacement: amber is now the brand accent, and a paid slot
                must not be able to read as RAKIZA's own emphasis. The word and
                the Megaphone carry the disclosure; the colour carries none of
                it. */}
            <Badge variant="outline" className="border-border bg-muted text-muted-foreground text-[10px] font-medium">
              <Megaphone className="w-2.5 h-2.5 me-1" />{t('vendorsDir.sponsored')}
            </Badge>
          </div>
        )}
        {/*
          THE BUSINESS LEADS, WHERE THERE IS ONE.

          This card showed `users.name` and nothing else, so a supplier
          trading as a registered company appeared in a B2B marketplace under
          the name of whoever opened the account - and a buyer comparing
          suppliers was reading personal names with no way to tell which of
          them were businesses at all.

          A provider with no registered business still leads with their own
          name, which is the honest presentation of an independent
          professional rather than a gap. The person stays visible underneath
          when both exist: procurement talks to people.
        */}
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0">
            {((vendor as any).businessName || vendor.name || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            {/* NO WRAP. With `flex-wrap` a long business name pushed the
                Verified badge onto a second line, which made that one card
                taller than the others and left the row ragged. The name
                truncates instead and the badge holds its place, so every
                card's header is the same height whatever it is called. */}
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-semibold truncate" data-testid={`vendor-primary-name-${vendor.id}`}>
                {(vendor as any).businessName || vendor.name}
              </span>
              {vendor.verified && (
                <Badge className="shrink-0 border-0 bg-success-50 text-success-700 text-xs">
                  <BadgeCheck className="w-3 h-3 me-0.5" />{t('common.verified')}
                </Badge>
              )}
            </div>
            {(vendor as any).businessName && vendor.name && (
              <div className="text-xs text-muted-foreground truncate" data-testid={`vendor-contact-name-${vendor.id}`}>
                {vendor.name}
              </div>
            )}
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
                  /* accent-600, not amber-400: 3.11:1 rather than 1.67:1
                     against the card, and a token rather than a raw hue. */
                  ? 'fill-brand-accent-600 text-brand-accent-600'
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

        {/* THE ACTIONS A BUYER TAKES FROM DISCOVERY (§22). Opening the
            storefront is the card itself; saving is a separate gesture and
            must not navigate, which is why SaveButton stops the event. */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-primary font-medium">{t('vendorsDir.viewProfile')}</span>
          <SaveButton kind="provider" itemId={vendor.id} saved={isSaved} variant="icon" />
        </div>
      </Card>
  );
}
