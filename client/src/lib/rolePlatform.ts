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

export const ROLE_PLATFORM_COPY: Record<PlatformRole, {
  titleKey: string;
  subtitleKey: string;
  accent: string;
}> = {
  homeowner: {
    titleKey: 'platform.homeowner.title',
    subtitleKey: 'platform.homeowner.subtitle',
    accent: 'from-blue-600 to-cyan-500',
  },
  contractor: {
    titleKey: 'platform.contractor.title',
    subtitleKey: 'platform.contractor.subtitle',
    accent: 'from-amber-500 to-orange-500',
  },
  engineer: {
    titleKey: 'platform.engineer.title',
    subtitleKey: 'platform.engineer.subtitle',
    accent: 'from-emerald-500 to-teal-500',
  },
  architect: {
    titleKey: 'platform.architect.title',
    subtitleKey: 'platform.architect.subtitle',
    accent: 'from-violet-600 to-fuchsia-500',
  },
  supplier: {
    titleKey: 'platform.supplier.title',
    subtitleKey: 'platform.supplier.subtitle',
    accent: 'from-orange-500 to-rose-500',
  },
  project_manager: {
    titleKey: 'platform.project_manager.title',
    subtitleKey: 'platform.project_manager.subtitle',
    accent: 'from-cyan-600 to-sky-500',
  },
};
