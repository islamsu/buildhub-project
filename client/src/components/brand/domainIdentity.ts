import type { ComponentType } from 'react';
import { Package, Store, HardHat, PenTool, PaintRoller, FileText } from 'lucide-react';

/**
 * ── WHAT AM I TRYING TO FIND, AND WHICH PART OF RAKIZA ANSWERS IT ───────
 *
 * Six jobs for colour and structure in this product, kept apart:
 *
 *   BRAND      whose platform is this         navy, amber, secondary blue
 *   DOMAIN     which marketplace area         products, providers
 *   JOURNEY    what am I trying to find       this file's main list
 *   STATUS     what state is this object in   success, warning, error, info
 *   PLACEMENT  why is this emphasised         Featured, Sponsored
 *   TAXONOMY   what category is this          Tiles, Marble, Paints
 *
 * ── THE CORRECTION THIS FILE CARRIES ────────────────────────────────────
 *
 * The previous version of it reasoned: `/marketplace/vendors`,
 * `/marketplace/designers` and `/marketplace/finishing` are one directory
 * component over one provider table with different presets, therefore they are
 * ONE public destination with sub-views. So the homepage offered a single
 * "Suppliers & professionals" card described as "approved contractors,
 * engineers, architects, suppliers and project managers", with Design and
 * Finishing demoted to small chips underneath it.
 *
 * The owner reviewed that on the real site and rejected it, and the reasoning
 * was the error rather than the layout:
 *
 *   SHARED IMPLEMENTATION DOES NOT REQUIRE SHARED NAVIGATION IDENTITY.
 *
 * A visitor does not arrive thinking "I need a generic provider, and then I
 * will discover which preset RAKIZA uses internally". They arrive thinking "I
 * need a supplier", "I need a contractor", "I need design services", "I need a
 * finishing company". Those are four different questions with four different
 * outcomes, and one directory component can answer all of them through
 * different truthful filters. Data architecture is not navigation
 * architecture; collapsing distinct customer intents because their
 * implementation is shared is how a marketplace ends up describing its own
 * database to the people trying to buy from it.
 *
 * The opposite error is just as real, and this file still refuses it: nothing
 * here duplicates backend architecture to manufacture a destination. Every
 * journey below resolves to a filter that already existed or to one bounded
 * role parameter over a canonical enum column.
 *
 * ── TWO DOMAINS, FIVE JOURNEYS, ONE ACTION ──────────────────────────────
 *
 * The domain still has two members, because the architecture does: a catalogue
 * of goods and a directory of businesses. What changed is that the domain is
 * no longer what the visitor is offered. JOURNEYS are:
 *
 *   products     the catalogue                  domain: products
 *   suppliers    role = supplier                domain: providers
 *   contractors  role = contractor              domain: providers
 *   design       declared category = Design     domain: providers
 *   finishing    declared category = Renovation  domain: providers
 *   quotes       the RFQ workflow               no domain - it is an action
 *
 * ROLE AND CATEGORY ARE DIFFERENT AXES AND BOTH ARE TRUTHFUL. Suppliers and
 * Contractors ask what kind of business it is (`users.userRole`, canonical
 * since shared/roleMatrix.ts was written). Design Services and Finishing ask
 * what the provider has DECLARED they do (`vendorCategories`, the same shared
 * taxonomy RFQ targeting uses). A contractor who declares Renovation belongs
 * in Finishing, which is why Finishing is not role-filtered - filtering it by
 * role would throw away the providers the customer came for.
 *
 * ── THREE HUE FAMILIES FOR SIX CARDS, DELIBERATELY ──────────────────────
 *
 * Six destinations do not get six saturated colours. The pre-RAKIZA system had
 * ten identities across two incompatible tables and four of them collided with
 * status meanings - vendors in emerald (success), finishing in amber
 * (warning), engineer in green. That is the failure mode on one side; a single
 * flat brand tint that erases wayfinding is the failure mode on the other.
 *
 * So colour follows the DOMAIN, which is the honest thing for it to follow,
 * and the JOURNEY is carried by icon, label, copy, route and position:
 *
 *   teal     products        one domain, one hue
 *   violet   all four provider journeys - they are one domain
 *   amber    Get Quotes      the RAKIZA action colour, as a fill
 *
 * Four cards sharing the provider violet is not four cards looking identical.
 * Each has its own canonical icon, its own label, and its own line of copy
 * describing a different outcome. The icon is what actually tells a visitor
 * which card is theirs - a hard hat says contractor faster than any hue does -
 * and that is the same conclusion components/brand/roleIdentity.ts reached
 * about the six role cards. It also keeps every journey legible in grayscale,
 * which is the owner's explicit QA criterion.
 *
 * ── GET QUOTES IS NOT A DOMAIN AND NOT A COLOUR ─────────────────────────
 *
 * Amber means "this is the primary RAKIZA action" - the same thing it means on
 * Sign Up and on Search. It is not "the Get Quotes colour". It is also the one
 * accent that cannot be small text: Accent Amber's darkest permitted step is
 * 3.11:1 on white, which clears SC 1.4.11 for a glyph and fails SC 1.4.3 for a
 * 14px label. A rendered probe caught that after the source tests had passed
 * it. So the action states its accent as a FILL with a dark label at 8.26:1,
 * which also makes it the only structurally different card in the grid - the
 * highest-intent journey ranked first with no colour involved.
 *
 * ── ADDING A JOURNEY LATER ──────────────────────────────────────────────
 *
 * Add an entry here and nothing else. Pages read this list; they do not define
 * identity. A new journey needs a truthful existing filter - a role, a declared
 * category, a route that already resolves. A card that leads nowhere, or to an
 * unfiltered list it claims to have filtered, is worse than one that is
 * missing.
 */

/** Which marketplace area answers a journey. An action belongs to neither. */
export type DomainId = 'products' | 'providers';

export type JourneyId =
  | 'products' | 'suppliers' | 'contractors' | 'design' | 'finishing' | 'quotes';

/**
 * `discovery` browses a marketplace area; `action` starts a workflow.
 *
 * Typed rather than inferred from the id, because the distinction decides the
 * card's treatment and must not depend on remembering which name is which.
 */
export type JourneyKind = 'discovery' | 'action';

export type JourneyIdentity = {
  id: JourneyId;
  kind: JourneyKind;
  /** The marketplace area behind it - null for an action. */
  domain: DomainId | null;
  icon: ComponentType<{ className?: string }>;
  /** Where the card goes. Every one of these routes exists in App.tsx. */
  href: string;
  /**
   * HOW THE DESTINATION NARROWS, in the product's own vocabulary.
   *
   * Recorded on the identity rather than left implicit at the route, so the
   * claim a card makes and the filter it applies are stated in one place and
   * can be tested against each other. `none` is the unfiltered catalogue or a
   * workflow entry point.
   */
  filter: { by: 'role'; value: string } | { by: 'category'; value: string } | { by: 'none' };
  /** i18n keys, so no label is ever typed at a call site. */
  labelKey: string;
  blurbKey: string;
  /** The accent, as utility class names: the component names its ROLE. */
  accent: string;
  /** The icon well behind the glyph. */
  tint: string;
  /** The call-to-action row. Differs in KIND for the action - see above. */
  cta: string;
  /** The CTA's own label key, because a form is not a listing. */
  ctaKey: string;
};

const PRODUCTS_ACCENT = 'text-domain-products';
const PRODUCTS_TINT = 'bg-domain-products-tint';
const PROVIDER_ACCENT = 'text-domain-providers';
const PROVIDER_TINT = 'bg-domain-providers-tint';

export const JOURNEY_IDENTITIES: readonly JourneyIdentity[] = [
  {
    id: 'products',
    kind: 'discovery',
    domain: 'products',
    icon: Package,
    href: '/marketplace/products',
    filter: { by: 'none' },
    labelKey: 'journey.products',
    blurbKey: 'journey.products.blurb',
    accent: PRODUCTS_ACCENT,
    tint: PRODUCTS_TINT,
    cta: PRODUCTS_ACCENT,
    ctaKey: 'journey.cta.browse',
  },
  {
    id: 'suppliers',
    kind: 'discovery',
    domain: 'providers',
    icon: Store,
    href: '/marketplace/suppliers',
    /* `users.userRole`, enforced server-side by marketplace.vendors' role
       enum - not a client-side filter over the full list. */
    filter: { by: 'role', value: 'supplier' },
    labelKey: 'journey.suppliers',
    blurbKey: 'journey.suppliers.blurb',
    accent: PROVIDER_ACCENT,
    tint: PROVIDER_TINT,
    cta: PROVIDER_ACCENT,
    ctaKey: 'journey.cta.find',
  },
  {
    id: 'contractors',
    kind: 'discovery',
    domain: 'providers',
    icon: HardHat,
    href: '/marketplace/contractors',
    filter: { by: 'role', value: 'contractor' },
    labelKey: 'journey.contractors',
    blurbKey: 'journey.contractors.blurb',
    accent: PROVIDER_ACCENT,
    tint: PROVIDER_TINT,
    cta: PROVIDER_ACCENT,
    ctaKey: 'journey.cta.find',
  },
  {
    /*
     * DESIGN SERVICES, and the label is an owner decision rather than a
     * synonym. The customer is looking for a SERVICE; "Professionals" or
     * "Design Professionals" would name the database role of whoever supplies
     * it. The destination is the declared-category view, so an architect, an
     * engineer or a design studio appears here when they have declared Design
     * - which is the existing truthful mechanism, not a role test.
     */
    id: 'design',
    kind: 'discovery',
    domain: 'providers',
    icon: PenTool,
    href: '/marketplace/designers',
    filter: { by: 'category', value: 'Design' },
    labelKey: 'journey.design',
    blurbKey: 'journey.design.blurb',
    accent: PROVIDER_ACCENT,
    tint: PROVIDER_TINT,
    cta: PROVIDER_ACCENT,
    ctaKey: 'journey.cta.find',
  },
  {
    /*
     * FINISHING maps to the declared category 'Renovation', which is the
     * closest value the shared RFQ taxonomy carries - there is no separate
     * 'Finishing' category. That mapping predates this pass and is unchanged;
     * it is a one-word edit if the owner decides the taxonomy should gain its
     * own value, and it invents nothing in the meantime.
     */
    id: 'finishing',
    kind: 'discovery',
    domain: 'providers',
    icon: PaintRoller,
    href: '/marketplace/finishing',
    filter: { by: 'category', value: 'Renovation' },
    labelKey: 'journey.finishing',
    blurbKey: 'journey.finishing.blurb',
    accent: PROVIDER_ACCENT,
    tint: PROVIDER_TINT,
    cta: PROVIDER_ACCENT,
    ctaKey: 'journey.cta.find',
  },
  {
    id: 'quotes',
    kind: 'action',
    domain: null,
    icon: FileText,
    href: '/rfq',
    filter: { by: 'none' },
    labelKey: 'journey.quotes',
    blurbKey: 'journey.quotes.blurb',
    accent: 'text-brand-accent-600',
    tint: 'bg-brand-accent-500/12',
    /* The canonical amber pairing, identical to the `accent` Button variant:
       Accent Amber behind Text Dark at 8.26:1. Never a white label - that is
       2.15:1 and brandContrast.test.ts fails the build over it. */
    cta: 'rounded-lg bg-brand-accent-500 px-3.5 py-2 text-foreground',
    ctaKey: 'journey.cta.quotes',
  },
];

/** One lookup, so a page cannot quietly keep its own copy of the list. */
export function journeyById(id: JourneyId): JourneyIdentity {
  const found = JOURNEY_IDENTITIES.find(journey => journey.id === id);
  if (!found) throw new Error(`unknown journey: ${id}`);
  return found;
}

/**
 * The accent pair for one marketplace DOMAIN.
 *
 * For surfaces that are about an area rather than a journey - the marketplace
 * hub's macro cards read their journey's identity, but a page that needs the
 * domain itself asks here instead of hard-coding a token name.
 */
export function domainAccent(domain: DomainId): { accent: string; tint: string; bar: string } {
  return domain === 'products'
    ? { accent: PRODUCTS_ACCENT, tint: PRODUCTS_TINT, bar: 'bg-domain-products' }
    : { accent: PROVIDER_ACCENT, tint: PROVIDER_TINT, bar: 'bg-domain-providers' };
}
