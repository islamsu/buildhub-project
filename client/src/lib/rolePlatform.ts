export type PlatformRole = 'homeowner' | 'contractor' | 'engineer' | 'architect' | 'supplier' | 'project_manager';

export const PLATFORM_ROLES: PlatformRole[] = [
  'homeowner',
  'contractor',
  'engineer',
  'architect',
  'supplier',
  'project_manager',
];

export function isPlatformRole(role: unknown): role is PlatformRole {
  return typeof role === 'string' && PLATFORM_ROLES.includes(role as PlatformRole);
}

export function getRolePlatformPath(role: unknown): string {
  if (role === 'admin') return '/admin';
  if (isPlatformRole(role)) return `/platform/${role}`;
  return '/platform/homeowner';
}

/**
 * ── ONE BRAND, SIX ROLES ────────────────────────────────────────────────
 *
 * `accent` used to be a per-role two-colour gradient: blue-to-cyan,
 * amber-to-orange, emerald-to-teal, violet-to-fuchsia, orange-to-rose,
 * cyan-to-sky. Twelve hues across six pages, which made `/platform/engineer`
 * and `/platform/architect` look like two different products rather than two
 * views of BuildHub - and left the brand blue as merely one of the six.
 *
 * It now resolves to one brand gradient for every role. The pages still differ
 * where it matters: their title, their subtitle, their content and their
 * icons. What they no longer differ in is whose product they belong to.
 *
 * `accent` is kept as a field rather than inlined at the single call site,
 * because a per-role visual treatment may legitimately return - a subtle one -
 * and the seam for it should stay where the role is described.
 */
export const ROLE_PLATFORM_ACCENT = 'from-brand-700 to-brand-500';

export const ROLE_PLATFORM_COPY: Record<PlatformRole, {
  titleKey: string;
  subtitleKey: string;
  accent: string;
}> = {
  homeowner: {
    titleKey: 'platform.homeowner.title',
    subtitleKey: 'platform.homeowner.subtitle',
    accent: ROLE_PLATFORM_ACCENT,
  },
  contractor: {
    titleKey: 'platform.contractor.title',
    subtitleKey: 'platform.contractor.subtitle',
    accent: ROLE_PLATFORM_ACCENT,
  },
  engineer: {
    titleKey: 'platform.engineer.title',
    subtitleKey: 'platform.engineer.subtitle',
    accent: ROLE_PLATFORM_ACCENT,
  },
  architect: {
    titleKey: 'platform.architect.title',
    subtitleKey: 'platform.architect.subtitle',
    accent: ROLE_PLATFORM_ACCENT,
  },
  supplier: {
    titleKey: 'platform.supplier.title',
    subtitleKey: 'platform.supplier.subtitle',
    accent: ROLE_PLATFORM_ACCENT,
  },
  project_manager: {
    titleKey: 'platform.project_manager.title',
    subtitleKey: 'platform.project_manager.subtitle',
    accent: ROLE_PLATFORM_ACCENT,
  },
};
