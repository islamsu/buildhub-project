/**
 * ── THE RAKIZA LOCK-UP ──────────────────────────────────────────────────
 *
 * One home for the mark and the horizontal lock-up. Every place the logo
 * appears - navigation, the homepage hero, authentication, the footer -
 * renders through here, so a change to the artwork is a change to one file.
 *
 * ── WHY THIS IS AN IMAGE AND NOT INLINE SVG ─────────────────────────────
 *
 * The component it replaces drew a geometric placeholder as SVG paths, which
 * let it inherit `currentColor` and recolour per tone. The RAKIZA mark is
 * owner-supplied artwork: a faceted hexagon with shaded planes, a cut counter
 * and an amber swoosh. It is not reconstructible as a handful of rects, and
 * tracing it by eye would ship an approximation of someone's trademark while
 * claiming to be it. The owner's directive is explicit - do not trace, do not
 * crop a screenshot, do not silently ship a reconstruction.
 *
 * So the artwork stays artwork. `scripts/brand/build-assets.py` derives every
 * served size from the single master by crop and scale; this component picks
 * one of them.
 *
 * THE COST, STATED: a raster cannot inherit `currentColor`, so the former
 * `mono` tone is gone. It existed for favicons and print, and the favicon is
 * now a real file rather than a recoloured component. Nothing else used it.
 *
 * ── WIDTH AND HEIGHT ARE NOT OPTIONAL ───────────────────────────────────
 *
 * Both `img` elements carry intrinsic dimensions from `BRAND_ASSET_SIZES`.
 * The logo sits in the header, above the fold, and an image without a
 * reserved box shifts the whole page when it lands. CLS at or below 0.1 is a
 * release gate (§63), and the header is the easiest place in the product to
 * fail it.
 */

import { BRAND_ASSETS, BRAND_ASSET_SIZES, BRAND_NAME_EN } from '@shared/brand';
import { cn } from '@/lib/utils';

export type BrandTone =
  /** On a light surface: the navy lock-up. */
  | 'default'
  /** On a dark surface - the hero, the navy CTA band, a transparent header
   *  over a photograph: the white lock-up, with the amber swoosh preserved. */
  | 'inverse';

export type BrandSize = 'sm' | 'md' | 'lg';

/**
 * Heights only. The width follows from the asset's aspect ratio, which keeps
 * the two forms - lock-up and mark - optically the same weight at the same
 * size name without anyone maintaining two scales.
 */
const LOCKUP_HEIGHT: Record<BrandSize, string> = {
  sm: 'h-7',
  md: 'h-9',
  lg: 'h-12',
};

const MARK_SIZE: Record<BrandSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
  lg: 'h-12 w-12',
};

/**
 * The symbol alone. Square, and inspected magnified at 32px before being
 * trusted there - the hexagon, the counter and the swoosh all still read.
 *
 * `decorative` when something beside it already names the brand; otherwise it
 * carries the name itself. Two readings of "Rakiza" in a row is worse for a
 * screen reader than one.
 */
export function RakizaMark({
  tone = 'default', size = 'md', className, decorative = false,
}: {
  tone?: BrandTone; size?: BrandSize; className?: string; decorative?: boolean;
}) {
  return (
    <img
      src={tone === 'inverse' ? BRAND_ASSETS.markInverse : BRAND_ASSETS.mark}
      width={BRAND_ASSET_SIZES.mark.width}
      height={BRAND_ASSET_SIZES.mark.height}
      alt={decorative ? '' : BRAND_NAME_EN}
      aria-hidden={decorative || undefined}
      className={cn(MARK_SIZE[size], 'w-auto object-contain', className)}
      data-testid="rakiza-mark"
      draggable={false}
    />
  );
}

/**
 * The horizontal lock-up: mark, ركيزة, RAKIZA, BUILD TOGETHER. The default
 * everywhere the brand is shown.
 *
 * The Arabic sits in the artwork in both languages on purpose. It is part of
 * the identity the owner approved, not a localisation of it - the same file
 * is correct on an English page and an Arabic one, exactly as a bilingual
 * lock-up is meant to be.
 */
export function RakizaLogo({
  tone = 'default', size = 'md', markOnly = false, className, decorative = false,
}: {
  tone?: BrandTone;
  size?: BrandSize;
  markOnly?: boolean;
  className?: string;
  decorative?: boolean;
}) {
  if (markOnly) {
    return <RakizaMark tone={tone} size={size} className={className} decorative={decorative} />;
  }
  return (
    <img
      src={tone === 'inverse' ? BRAND_ASSETS.lockupInverse : BRAND_ASSETS.lockup}
      width={BRAND_ASSET_SIZES.lockup.width}
      height={BRAND_ASSET_SIZES.lockup.height}
      alt={decorative ? '' : BRAND_NAME_EN}
      aria-hidden={decorative || undefined}
      className={cn(LOCKUP_HEIGHT[size], 'w-auto object-contain', className)}
      data-testid="rakiza-logo"
      draggable={false}
    />
  );
}
