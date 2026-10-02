import type { ComponentType } from 'react';
import { Package, Store, FileText, PenTool, HardHat } from 'lucide-react';

/**
 * ── WHICH PART OF THE MARKETPLACE AM I IN ───────────────────────────────
 *
 * The fourth job colour does in this product, and the one the rebrand removed
 * by accident. Four jobs, kept apart:
 *
 *   BRAND      whose platform is this         navy, amber, secondary blue
 *   DOMAIN     which part of the marketplace  this file
 *   STATUS     what happened / what state     success, warning, error, info
 *   PLACEMENT  why is this emphasised         Featured, Sponsored
 *
 * Flattening every destination to one brand tint was right about the rainbow
 * and wrong about wayfinding. The pre-RAKIZA system had TEN identities across
 * two incompatible tables - six role hues in Home.tsx and lib/rolePlatform.ts,
 * four marketplace gradients in MarketplaceHub - and four of them collided
 * with status meanings: vendors in emerald (success), finishing in amber
 * (warning), engineer in green, contractor in amber. Removing that was
 * correct. Removing the signal with it was not.
 *
 * ── WHY TWO DOMAINS AND NOT SIX ─────────────────────────────────────────
 *
 * Because the architecture has two. `/marketplace/products` is the catalogue.
 * `/marketplace/vendors` is ONE directory holding all five provider roles
 * (shared/roleMatrix.ts: contractor, engineer, architect, supplier,
 * project_manager). `/marketplace/designers` and `/marketplace/finishing` are
 * that same `VendorsDirectoryView` with a CATEGORY preset - Design and
 * Renovation - not role-filtered directories and not separate architectures.
 *
 * So they are SUB-VIEWS: they inherit the provider accent and are told apart
 * by icon, label and supporting copy. Giving each a permanent hue would make
 * the visual separation stronger than the information architecture, which is
 * how a design system starts lying about the product.
 *
 * The reference design also showed Contractors and Professionals. There is no
 * contractors directory and no professionals directory. They are absent rather
 * than invented; a card that leads nowhere is worse than one that is missing.
 *
 * ── GET QUOTES IS NOT A DOMAIN ──────────────────────────────────────────
 *
 * It appears beside the two domains in the homepage gateway and it carries the
 * RAKIZA accent, but it is a WORKFLOW, not a part of the marketplace. Amber
 * there means "this is the primary RAKIZA action", which is the same thing it
 * means on Sign Up and on Search - not "the Get Quotes colour". That is why it
 * is `kind: 'workflow'` below and why it has no domain token of its own: amber
 * stops meaning anything the moment it is also a domain, a category, a warning
 * and a sponsorship.
 *
 * ── ADDING A DOMAIN LATER ───────────────────────────────────────────────
 *
 * Add an entry here. Nothing else. Pages read this list; they do not define
 * identity. A third domain earns a token when the architecture gains a real
 * third domain - a role-filtered contractors directory, say - and not before.
 */

export type DomainId = 'products' | 'providers' | 'quotes';

/** A domain is part of the marketplace; a workflow is something you do. */
export type DomainKind = 'domain' | 'workflow';

export type DomainIdentity = {
  id: DomainId;
  kind: DomainKind;
  icon: ComponentType<{ className?: string }>;
  /** Where the card goes. Every one of these routes exists. */
  href: string;
  /** i18n keys, so the label is never typed at a call site. */
  labelKey: string;
  blurbKey: string;
  /**
   * The accent, as a pair of utility class names rather than a raw colour.
   *
   * A call site asks for `domain.accent`, never for `text-teal-600`. That is
   * the whole point of a role-based token (Carbon): the component states its
   * ROLE and the theme supplies the value, so one edit here moves every
   * surface and nothing drifts.
   */
  accent: string;
  /** The icon well: the tint behind the glyph. */
  tint: string;
  /**
   * The card's call-to-action row.
   *
   * ── WHY THE WORKFLOW CANNOT WEAR ITS ACCENT AS TEXT ─────────────────
   *
   * This is where the amber/domain distinction stops being a philosophical
   * point and becomes a contrast measurement. The two domain accents are
   * 6.69:1 (teal) and 7.78:1 (violet) on a white card, so they are legal as
   * 14px text. Accent Amber's darkest permitted step is 3.11:1 - fine for a
   * glyph (SC 1.4.11 wants 3:1) and fine for large text, and a FAILURE as a
   * small label. A rendered probe caught this after a source test had passed
   * it, because no class string can see its own background.
   *
   * So the workflow states its accent the one way amber is legible: as a
   * FILL with a dark label, which is also exactly what amber means everywhere
   * else in RAKIZA - the primary action. The structural difference is a bonus
   * rather than a cost: a filled pill beside two text links ranks the money
   * journey first with no colour at all, which is the grayscale criterion.
   */
  cta: string;
};

export const DOMAIN_IDENTITIES: readonly DomainIdentity[] = [
  {
    id: 'products',
    kind: 'domain',
    icon: Package,
    href: '/marketplace/products',
    labelKey: 'domain.products',
    blurbKey: 'domain.products.blurb',
    accent: 'text-domain-products',
    tint: 'bg-domain-products-tint',
    cta: 'text-domain-products',
  },
  {
    id: 'providers',
    kind: 'domain',
    icon: Store,
    href: '/marketplace/vendors',
    labelKey: 'domain.providers',
    blurbKey: 'domain.providers.blurb',
    accent: 'text-domain-providers',
    tint: 'bg-domain-providers-tint',
    cta: 'text-domain-providers',
  },
  {
    /*
     * THE WORKFLOW. Amber is the brand's primary-action colour here, not a
     * third domain hue - see the note above. It sits beside the domains
     * because a visitor who cannot find what they need in the catalogue
     * should not have to discover the RFQ path somewhere further down.
     */
    id: 'quotes',
    kind: 'workflow',
    icon: FileText,
    href: '/rfq',
    labelKey: 'domain.quotes',
    blurbKey: 'domain.quotes.blurb',
    accent: 'text-brand-accent-600',
    tint: 'bg-brand-accent-500/12',
    /* The canonical amber pairing, identical to the `accent` Button variant:
       Accent Amber behind Text Dark at 8.26:1. Never a white label - that is
       2.15:1 and brandContrast.test.ts fails the build over it. */
    cta: 'rounded-lg bg-brand-accent-500 px-3.5 py-2 text-foreground',
  },
];

/**
 * The provider directory's category presets.
 *
 * NOT domains. They are the provider domain seen through a category filter, so
 * they take the provider accent and differ by icon and label. Rendered as
 * secondary links under the Providers card rather than as cards of their own,
 * because that is their real rank in the architecture.
 */
export const PROVIDER_PRESETS: readonly {
  id: string;
  icon: ComponentType<{ className?: string }>;
  href: string;
  labelKey: string;
}[] = [
  { id: 'design',    icon: PenTool, href: '/marketplace/designers', labelKey: 'domain.preset.design' },
  { id: 'finishing', icon: HardHat, href: '/marketplace/finishing', labelKey: 'domain.preset.finishing' },
];

/** One lookup, so a page cannot quietly keep its own copy of the list. */
export function domainById(id: DomainId): DomainIdentity {
  const found = DOMAIN_IDENTITIES.find(d => d.id === id);
  if (!found) throw new Error(`unknown domain: ${id}`);
  return found;
}
