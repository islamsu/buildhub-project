/**
 * ── A CURATED PRODUCT, PRESENTED AS A PRODUCT ─────────────────────────────
 *
 * The first version of the featured strip reused the generic card: a badge, a
 * name, a brand and a price. That is a row from a table with a ribbon on it.
 *
 * A PRODUCT IS NOT A PROVIDER, and the two premium cards should not be the
 * same component with different fields poured into it. A provider card
 * answers "who is this business, what do they do, where" and sends you to a
 * profile. A product card answers "what is this, who sells it, what does it
 * cost" and sends you to the product - so this one leads with the IMAGE,
 * names the SUPPLIER, says which CATEGORY it belongs to, and carries its own
 * action.
 *
 * NOTHING IS INVENTED. No rating, no review count, no stock position, no
 * delivery promise, no discount. A placement is a more VISIBLE card, never a
 * more inventive one, and every field here comes from the product's own row.
 * A product with no image gets an honest placeholder rather than a stock
 * photograph of somebody else's work.
 *
 * ONE COMPONENT, TWO SURFACES. The marketplace home and the category page
 * render the same card, so a curated product cannot come to look like two
 * different things depending on where a visitor meets it.
 */
import { BadgeCheck, ImageOff, Store } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { parseProductImages } from '@shared/productImages';

export type FeaturedProductCardData = {
  id: number;
  name: string;
  nameAr?: string | null;
  brand?: string | null;
  category?: string | null;
  price?: string | null;
  currency?: string | null;
  unit?: string | null;
  images?: string | null;
  supplierName?: string | null;
};

export function FeaturedProductCard({
  product, lang, onOpen,
}: {
  product: FeaturedProductCardData;
  lang: 'en' | 'ar';
  onOpen: () => void;
}) {
  const ar = lang === 'ar';
  const title = (ar && product.nameAr) ? product.nameAr : product.name;
  const image = parseProductImages(product.images ?? null)[0] ?? null;

  return (
    <Card
      data-testid={`featured-product-${product.id}`}
      data-placement-kind="featured"
      onClick={onOpen}
      className="group flex cursor-pointer flex-col overflow-hidden border-emerald-200 bg-emerald-50/40 ring-1 ring-emerald-500/20 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl dark:border-emerald-900 dark:bg-emerald-950/20"
    >
      {/* THE IMAGE LEADS, because a product is looked at before it is read. */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-8 w-8" aria-hidden="true" />
          </div>
        )}
        {/* The claim, in WORDS and with an icon - never hue alone, which a
            colour-blind reader and a greyscale print both lose. */}
        <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">
          <BadgeCheck className="h-3 w-3" aria-hidden="true" />
          {ar ? 'مختار' : 'Featured'}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="line-clamp-2 font-semibold leading-snug group-hover:text-primary">{title}</p>

        {product.supplierName && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Store className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{product.supplierName}</span>
          </p>
        )}

        {product.category && (
          <p className="text-xs text-muted-foreground">{product.category}</p>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          {product.price ? (
            <p className="text-sm font-semibold">
              {product.currency ?? 'EGP'} {Number(product.price).toLocaleString()}
              {product.unit ? <span className="font-normal text-muted-foreground"> / {product.unit}</span> : null}
            </p>
          ) : (
            /* NO PRICE IS A REAL ANSWER. "Price on request" is what the row
               says; inventing a number would be inventing a commitment. */
            <p className="text-xs text-muted-foreground">{ar ? 'السعر عند الطلب' : 'Price on request'}</p>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 text-xs"
            data-testid={`featured-product-open-${product.id}`}
            onClick={event => { event.stopPropagation(); onOpen(); }}
          >
            {ar ? 'عرض' : 'View'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default FeaturedProductCard;
