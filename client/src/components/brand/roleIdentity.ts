/**
 * ── SIX ROLES, ONE ECOSYSTEM ────────────────────────────────────────────
 *
 * The homepage and the signup screen each carried their own copy of the role
 * list, and both assigned a different strong colour per role: blue, amber,
 * green, purple, orange, teal. Six saturated hues across six cards, twice.
 *
 * Two problems with that, and the second is the one that matters.
 *
 * The visible problem is the rainbow. Six competing colours in one section
 * read as six unrelated products sitting next to each other, and none of them
 * reads as BuildHub - the brand blue becomes just one of the six.
 *
 * The real problem is that green, amber and purple already mean something in
 * this product. Green is success, amber is warning, red is destructive. A
 * green "Engineer" card and a green "Approved" badge on the same page are the
 * same colour carrying unrelated meanings, which is how a status vocabulary
 * stops being trusted.
 *
 * ── WHAT REPLACES IT ────────────────────────────────────────────────────
 *
 * One neutral card, one brand-blue icon container, one border, one hover.
 * Differentiation stays - it just moves to where it belongs: the ICON, which
 * is what actually tells a visitor which role is theirs. A hard hat says
 * contractor faster than amber does.
 *
 * The accent is spent on exactly one thing: `emphasis`, which marks the roles
 * that transact commercially. That is a real distinction in the product rather
 * than decoration, and it is a single token so it cannot spread.
 */

import type { ComponentType } from 'react';
import { Home as HomeIcon, HardHat, Layers, Building2, Package, UserCog } from 'lucide-react';

export type RoleId =
  | 'homeowner' | 'contractor' | 'engineer' | 'architect' | 'supplier' | 'project_manager';

export type RoleIdentity = {
  id: RoleId;
  icon: ComponentType<{ className?: string }>;
  /**
   * Whether this role's icon container carries the warm accent.
   *
   * True for the two roles whose primary relationship with BuildHub is
   * commercial - a supplier selling and a contractor bidding. It is a quiet
   * nod, not a category colour, and it is the only variation in the set.
   */
  emphasis?: boolean;
};

/**
 * THE ONE LIST. Order is deliberate: it runs from the person with the
 * requirement to the people who fulfil it, which is the same direction as the
 * sourcing journey above it on the homepage.
 */
export const ROLE_IDENTITIES: readonly RoleIdentity[] = [
  { id: 'homeowner',       icon: HomeIcon },
  { id: 'contractor',      icon: HardHat,   emphasis: true },
  { id: 'engineer',        icon: Layers },
  { id: 'architect',       icon: Building2 },
  { id: 'supplier',        icon: Package,   emphasis: true },
  { id: 'project_manager', icon: UserCog },
];

/**
 * The icon container's classes.
 *
 * Returned from here rather than written per card so the homepage and the
 * signup screen cannot drift apart again - which is what happened when each
 * owned its own colour table.
 */
export function roleIconClasses(role: RoleIdentity): string {
  return role.emphasis
    ? 'bg-brand-accent-500/12 text-brand-accent-600'
    : 'bg-brand-50 text-brand-600';
}

/** The card's classes. Identical for every role, by design. */
export const ROLE_CARD_CLASSES =
  'border border-border bg-card hover:border-brand-300 hover:shadow-sm transition-all';
