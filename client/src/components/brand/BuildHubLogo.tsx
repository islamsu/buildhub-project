/**
 * ── THE BUILDHUB BRAND LOCK-UP ──────────────────────────────────────────
 *
 * One home for the mark, the wordmark and the horizontal lock-up.
 *
 * Before this, the logo was assembled inline in three places - Navbar, Home
 * and AuthPage - each as a `Building2` Lucide icon inside a `gradient-brand`
 * rounded square. That had two problems. A UI icon library is not a brand:
 * `Building2` is the same glyph any product can reach for, and it appears
 * elsewhere in this very codebase as an ordinary interface icon, so the logo
 * and a list bullet were the same drawing. And three copies meant three
 * sizes, three colour treatments, and three things to update.
 *
 * ── THE MARK, AND WHAT IT IS NOT ────────────────────────────────────────
 *
 * A portal frame: two posts, two beams, an open bay, and a node where the
 * structure connects. It reads as structure and connection rather than as a
 * picture of a building - which is why it is not a skyscraper silhouette, a
 * house roof, a crane, a hard hat or a hammer. Those say "construction" by
 * illustration; a frame says it by geometry, and geometry survives shrinking.
 *
 * Members are 5 units on a 32-unit grid - about 16% of the width - so at 24px
 * each bar still renders near four pixels. The centre node is a square rather
 * than a circle because a 5-unit circle loses its shape to antialiasing long
 * before a square does.
 *
 * THESE PROPORTIONS WERE CORRECTED AFTER RENDERING THEM. The first version
 * used 6-unit members and a 6-unit node, which left only 70% of the bay open -
 * and at 32px in the navbar that read as a filled rounded square with a dot,
 * not as a frame. Thinner members and a smaller node open the bay to 85%, and
 * the structure is legible at the size it is actually used. A mark can satisfy
 * a thickness rule and still fail the thing the rule exists for.
 *
 * The accent node is the one place amber appears in the identity by default.
 * That is a deliberate budget - a single small element, at the structural
 * junction, where the warm colour means "connected" rather than "decorated".
 *
 * ── THIS IS NOT FINAL TRADEMARK ARTWORK ─────────────────────────────────
 *
 * It is a considered geometric placeholder, built so replacing it is a
 * one-file change. See `BRAND_ARTWORK_NOTE`.
 */

import { cn } from '@/lib/utils';

/**
 * WHERE FINAL ARTWORK GOES.
 *
 * Replace the `<g>` inside `BuildHubMark` with the approved SVG paths,
 * keeping the 32x32 viewBox and `currentColor` so every size and tone
 * variant keeps working. Nothing else in the application changes: all three
 * former copies of the logo now render through here.
 */
export const BRAND_ARTWORK_NOTE =
  'Placeholder geometric mark. Final approved SVG replaces the <g> in BuildHubMark.';

export type BrandTone =
  /** On a light surface: brand blue mark. */
  | 'default'
  /** On a dark surface such as the homepage hero: white mark. */
  | 'inverse'
  /** One colour, inherits `currentColor`. Favicons, print, watermarks. */
  | 'mono';

export type BrandSize = 'sm' | 'md' | 'lg';

const MARK_SIZE: Record<BrandSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
};

const WORDMARK_SIZE: Record<BrandSize, string> = {
  sm: 'text-lg',
  md: 'text-xl',
  lg: 'text-2xl',
};

/**
 * The symbol alone. Square, safe down to 24px.
 *
 * `aria-hidden` by default: in the lock-up the wordmark beside it already
 * carries the accessible name, and two readings of "BuildHub" in a row is
 * worse for a screen reader than one. Pass `title` when the mark appears
 * without the wordmark - the only case where it has to speak.
 */
export function BuildHubMark({
  tone = 'default', size = 'md', className, title,
}: {
  tone?: BrandTone; size?: BrandSize; className?: string; title?: string;
}) {
  const structural =
    tone === 'inverse' ? 'text-white'
    : tone === 'mono' ? 'text-current'
    : 'text-brand-600';

  return (
    <svg
      viewBox="0 0 32 32"
      className={cn(MARK_SIZE[size], structural, className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      data-testid="buildhub-mark"
    >
      {title && <title>{title}</title>}
      {/* THE FRAME, in currentColor so one definition serves every tone. */}
      <g fill="currentColor">
        <rect x="4"  y="5"  width="5"  height="22" rx="1.4" />
        <rect x="23" y="5"  width="5"  height="22" rx="1.4" />
        <rect x="9"  y="5"  width="14" height="5"  rx="1.4" />
        <rect x="9"  y="22" width="14" height="5"  rx="1.4" />
      </g>
      {/*
        * THE CONNECTION NODE. Amber in light and inverse, because it is the
        * accent rather than part of the structure - and in `mono` it joins the
        * frame, since a one-colour mark has no second colour to spend.
        */}
      <rect
        x="13.5" y="13.5" width="5" height="5" rx="1.3"
        fill={tone === 'mono' ? 'currentColor' : 'var(--color-brand-accent-500)'}
      />
    </svg>
  );
}

/**
 * The word alone.
 *
 * Always "BuildHub" - one capital B, one capital H, no space. The casing is
 * fixed here so it cannot drift into BUILDHUB or Build Hub across surfaces,
 * and `tracking-tight` belongs to the wordmark rather than being a per-page
 * choice.
 */
export function BuildHubWordmark({
  tone = 'default', size = 'md', className,
}: {
  tone?: BrandTone; size?: BrandSize; className?: string;
}) {
  return (
    <span
      className={cn(
        'font-bold tracking-tight',
        WORDMARK_SIZE[size],
        tone === 'inverse' ? 'text-white'
          : tone === 'mono' ? 'text-current'
          : 'text-foreground',
        className,
      )}
      data-testid="buildhub-wordmark"
    >
      BuildHub
    </span>
  );
}

/**
 * The horizontal lock-up: mark + wordmark. The default for navigation,
 * authentication and the footer.
 *
 * `markOnly` is for constrained space and moves the accessible name onto the
 * mark, so the logo always has exactly one name whichever form it takes.
 */
export function BuildHubLogo({
  tone = 'default', size = 'md', markOnly = false, className,
}: {
  tone?: BrandTone; size?: BrandSize; markOnly?: boolean; className?: string;
}) {
  if (markOnly) {
    return <BuildHubMark tone={tone} size={size} className={className} title="BuildHub" />;
  }
  return (
    <span className={cn('inline-flex items-center gap-2', className)} data-testid="buildhub-logo">
      <BuildHubMark tone={tone} size={size} />
      <BuildHubWordmark tone={tone} size={size} />
    </span>
  );
}
