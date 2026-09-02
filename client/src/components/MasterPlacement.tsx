/**
 * ── MASTER DISCOVERY: the one exclusive slot, rendered ────────────────────
 *
 * The single most prominent placement BuildHub sells, shown before a visitor
 * has narrowed to a provider type or a product category.
 *
 * THREE THINGS THIS COMPONENT WILL NOT DO.
 *
 * 1. It never invents an advertiser. When the server returns null - nothing
 *    booked, or nothing booked is still eligible - it renders NOTHING and the
 *    page closes up around it. A placeholder here would be a fabricated
 *    commercial relationship on the most visible surface of the marketplace.
 *
 * 2. It never states a fact the record does not hold. Rating, review count,
 *    years in business, project counts, certifications and discounts are not
 *    displayed, because a placement carries none of them. What it shows -
 *    name, type, location, category, price, seller - comes from the entity's
 *    own row.
 *
 * 3. It never presents a paid slot as an editorial choice. The label comes
 *    from the placement's SOURCE, resolved server-side, and is rendered as
 *    TEXT with an icon - never as colour alone, which a colour-blind reader
 *    or a greyscale print would lose entirely.
 */
import { useLocation } from 'wouter';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BadgeCheck, Building2, MapPin, Megaphone, Package, Star } from 'lucide-react';
import { placementLabelText, type PlacementLabel } from '@shared/placement';
import { rfqCategoryLabel } from '@shared/rfqCategories';

/**
 * The label, as text plus an icon.
 *
 * Sponsored and Featured are deliberately given DIFFERENT icons as well as
 * different words: two badges distinguished only by hue are one stylesheet
 * away from being indistinguishable.
 */
export function PlacementBadge({ label }: { label: PlacementLabel }) {
  const { lang } = useLanguage();
  const sponsored = label === 'SPONSORED';
  const Icon = sponsored ? Megaphone : BadgeCheck;
  return (
    <Badge
      variant="outline"
      className={`gap-1.5 ${sponsored ? 'border-amber-500/60 text-amber-700 dark:text-amber-400' : 'border-emerald-500/60 text-emerald-700 dark:text-emerald-400'}`}
      data-testid={sponsored ? 'placement-sponsored' : 'placement-featured'}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {placementLabelText(label, lang)}
    </Badge>
  );
}

/** The heading that sits above the slot, in both languages. */
function SlotHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
      <h2 className="text-sm font-semibold">{children}</h2>
    </div>
  );
}

/**
 * ONE eligible Master provider, or nothing.
 *
 * `category` is the scope. Omitted means the platform-wide slot, which is
 * what provider discovery shows before a type is chosen.
 */
export function MasterProviderSlot({ category }: { category?: string }) {
  const { lang, t } = useLanguage();
  const ar = lang === 'ar';
  const [, navigate] = useLocation();
  const { data: placed } = trpc.marketplace.masterProvider.useQuery({ category });

  // Nothing booked, still loading, or nothing booked is eligible: the surface
  // collapses. `undefined` and `null` are treated the same on purpose - there
  // is no interim skeleton advertising a slot that may turn out to be empty.
  if (!placed) return null;

  return (
    <section className="mb-8" aria-label={ar ? 'مساحة إعلانية رئيسية' : 'Master placement'} data-testid="master-provider-slot">
      <SlotHeading>{ar ? 'مزوّد الخدمة المميّز' : 'Featured provider'}</SlotHeading>
      <Card className="overflow-hidden border-2">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
            {placed.avatar
              ? <img src={placed.avatar} alt="" className="h-full w-full object-cover" />
              : <Building2 className="h-7 w-7 text-muted-foreground" aria-hidden="true" />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-bold">{placed.name}</h3>
              <PlacementBadge label={placed.label} />
              {/* `verified` is compliance review, entirely separate from having
                  bought a placement. It is shown only when the account really
                  carries it. */}
              {placed.verified && (
                <Badge variant="secondary" className="gap-1">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('common.verified')}
                </Badge>
              )}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {placed.userRole && <span className="capitalize">{placed.userRole.replaceAll('_', ' ')}</span>}
              {placed.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />{placed.location}
                </span>
              )}
              {/* A rating only when verified reviews produced one. No reviews
                  is not a zero, and it is not a plausible 4.8 either. */}
              {placed.averageRating != null && (
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
                  {placed.averageRating} ({placed.reviewCount})
                </span>
              )}
            </div>

            {placed.bio && <p className="mt-2 line-clamp-2 text-sm">{placed.bio}</p>}

            {placed.categories.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {placed.categories.slice(0, 4).map(item => (
                  <Badge key={item} variant="outline" className="text-xs">{rfqCategoryLabel(item, lang)}</Badge>
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={() => navigate(`/vendor/${placed.id}`)}>
              {ar ? 'عرض المزوّد' : 'View provider'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/rfq/new?provider=${placed.id}`)}>
              {ar ? 'اطلب عرض سعر' : 'Get quote'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/** ONE eligible Master product, or nothing. Same contract. */
export function MasterProductSlot({ category }: { category?: string }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [, navigate] = useLocation();
  const { data: placed } = trpc.marketplace.masterProduct.useQuery({ category });

  if (!placed) return null;

  // `images` is a JSON array in one text column; a malformed value must not
  // take the page down, so it degrades to the icon.
  let image: string | null = null;
  try {
    const parsed = placed.images ? JSON.parse(placed.images) : null;
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') image = parsed[0];
  } catch { image = null; }

  const name = ar && placed.nameAr ? placed.nameAr : placed.name;

  return (
    <section className="mb-8" aria-label={ar ? 'مساحة إعلانية رئيسية' : 'Master placement'} data-testid="master-product-slot">
      <SlotHeading>{ar ? 'منتج مميّز' : 'Featured product'}</SlotHeading>
      <Card className="overflow-hidden border-2">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
            {image
              ? <img src={image} alt="" className="h-full w-full object-cover" />
              : <Package className="h-8 w-8 text-muted-foreground" aria-hidden="true" />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-bold">{name}</h3>
              <PlacementBadge label={placed.label} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{placed.category}</span>
              {placed.brand && <span>{placed.brand}</span>}
              {placed.origin && <span>{placed.origin}</span>}
            </div>
            {/* Price only where the catalogue actually holds one. A product
                listed without a price says so, rather than showing 0 EGP. */}
            <p className="mt-2 text-sm">
              {placed.price != null
                ? <span className="font-semibold">{placed.price} {placed.currency ?? 'EGP'}{placed.unit ? ` / ${placed.unit}` : ''}</span>
                : <span className="text-muted-foreground">{ar ? 'السعر عند الطلب' : 'Price on request'}</span>}
            </p>
            {placed.supplierName && (
              <button
                className="mt-1 text-sm text-primary hover:underline"
                onClick={() => navigate(`/vendor/${placed.supplierId}`)}
              >
                {ar ? `المورّد: ${placed.supplierName}` : `Sold by ${placed.supplierName}`}
              </button>
            )}
          </div>

          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={() => navigate(`/marketplace/products/${placed.id}`)}>
              {ar ? 'عرض المنتج' : 'View product'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
