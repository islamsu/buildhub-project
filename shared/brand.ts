/**
 * ── THE RAKIZA BRAND, IN ONE PLACE ──────────────────────────────────────
 *
 * The product was called BuildHub. The owner approved RAKIZA / ركيزة with the
 * tagline BUILD TOGETHER, and the name now appears in roughly a hundred
 * customer-visible strings across the client, the SEO layer, notifications and
 * the knowledge corpus the AI assistant answers from.
 *
 * Those strings are sentences, not tokens, so they are not generated from here
 * - a brand name spliced into Arabic by string concatenation produces broken
 * agreement, and English copy reads better written than assembled. What lives
 * here is the IDENTITY: the exact forms, so nothing drifts into "RAKIZA Ltd",
 * "Rakeza", "rakiza" or a transliteration nobody approved, and so a single
 * import can be asserted against.
 *
 * ── CASE IS NOT COSMETIC ────────────────────────────────────────────────
 *
 * RAKIZA in full capitals is the LOGOTYPE - it is drawn, not typed, and it
 * lives in the artwork under client/public/brand.
 *
 * Rakiza in title case is the PROSE form, and it is what belongs in a
 * sentence. The approved homepage design uses exactly this split: the lock-up
 * reads RAKIZA, the section heading reads "How Rakiza Works" and the button
 * reads "Join Rakiza". Setting a product name in capitals inside running text
 * shouts, and §55 forbids it.
 *
 * ── WHAT IS DELIBERATELY NOT RENAMED ────────────────────────────────────
 *
 * The customer-facing product is RAKIZA. The machinery underneath is still
 * named buildhub, on the owner's explicit instruction, because renaming it
 * would be risk with no customer benefit:
 *
 *   buildhub_lang            renaming resets every returning visitor's language
 *   __Host-buildhub_*        renaming breaks sign-up and OAuth already in flight
 *   BUILDHUB_* env vars      a deployment-coordination change, not a brand one
 *   buildhub-staging         a Render service with a disk; a rename destroys it
 *   buildhub (db / user)     same
 *   'buildhub_policy'        a stored discriminant in the compliance model
 *   drizzle/                 applied migrations; editing them desynchronises
 *   buildhub.eg              DOMAIN MIGRATION IS A SEPARATE RELEASE
 *
 * brandGuards.test.ts fails the build if any of those move. The split is the
 * point: a brand is what customers read, and an identifier is what systems
 * depend on. Conflating them is how a rebrand becomes an outage.
 */

/** The logotype. Drawn artwork - use it for the lock-up, never inside a sentence. */
export const BRAND_LOGOTYPE = 'RAKIZA';

/** The prose form. This is the one that belongs in copy. */
export const BRAND_NAME_EN = 'Rakiza';

/** The Arabic brand. A real word - "pillar", "foundation" - not a transliteration. */
export const BRAND_NAME_AR = 'ركيزة';

/** The tagline, as set in the lock-up. Letterspaced capitals there; sentence case in copy. */
export const BRAND_TAGLINE_EN = 'Build together';
export const BRAND_TAGLINE_AR = 'نبني معًا';

/**
 * Marketing line. NOT part of the mandatory lock-up - the owner was explicit
 * that this is copy, so it belongs on marketing surfaces and nowhere in the
 * logo component.
 */
export const BRAND_PROMISE_EN = 'Your Project. Our Foundation.';
export const BRAND_PROMISE_AR = 'مشروعك. أساسنا.';

/** Served asset paths. One list, so a path change is one edit. */
export const BRAND_ASSETS = {
  lockup: '/brand/rakiza-lockup.png',
  lockupInverse: '/brand/rakiza-lockup-inverse.png',
  mark: '/brand/rakiza-mark.png',
  markInverse: '/brand/rakiza-mark-inverse.png',
  favicon32: '/brand/favicon-32.png',
  favicon64: '/brand/favicon-64.png',
  appleTouchIcon: '/brand/apple-touch-icon.png',
  socialCard: '/brand/rakiza-og.png',
} as const;

/**
 * Intrinsic pixel dimensions of the two lock-up assets, so every `img` can
 * carry width and height and reserve its box before the file arrives. An image
 * without them is a layout shift, and CLS is a release gate (§63).
 */
export const BRAND_ASSET_SIZES = {
  lockup: { width: 880, height: 276 },
  mark: { width: 256, height: 256 },
} as const;

/**
 * ASSET PROVENANCE, recorded because "where did this binary come from" is a
 * question a future reader will have.
 *
 * Every file under client/public/brand is DERIVED from the single master the
 * owner supplied - brand-source/rakiza-master.png - by
 * scripts/brand/build-assets.py, which crops, scales, recolours and composites
 * it. Nothing is traced, redrawn or approximated. Re-run that script after
 * replacing the master and every served size regenerates consistently.
 *
 * STILL WANTED: a vector master (SVG/AI); see brand-source/README.md.
 * Raster is sufficient for every size
 * the site serves today - the 32px favicon was inspected magnified and the mark
 * is legible - but print, very large hero treatments and arbitrary recolouring
 * want curves. Its absence does not block engineering.
 */
export const BRAND_ASSET_PROVENANCE =
  'Derived from brand-source/rakiza-master.png by scripts/brand/build-assets.py. '
  + 'Vector master still wanted for print; raster is sufficient for all served sizes.';
