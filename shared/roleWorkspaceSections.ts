/**
 * WHAT EACH ROLE'S WORKSPACE ACTUALLY CONTAINS.
 *
 * The sidebar used to list Overview / Pipeline / Projects / Performance as four
 * separate destinations and give all four the SAME path - `/platform/:role`.
 * Clicking any of them while already on that page did nothing at all: no
 * navigation, no scroll, no change of any kind, and all four rendered as the
 * active item simultaneously. A live click audit confirmed thirty such controls
 * across the five professional workspaces.
 *
 * The cause was that the menu named sections nobody had checked existed. This
 * file is the single place that mapping lives, so the menu, the shortcut cards
 * and the page itself all read the SAME list, and a test can assert that every
 * id named here is actually rendered by the workspace it belongs to.
 *
 * Adding a menu entry for a section that does not exist is now a test failure,
 * not something a user discovers by clicking.
 */

export const WORKSPACE_ROLES = [
  'homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager',
] as const;
export type WorkspaceRole = typeof WORKSPACE_ROLES[number];

/** Anchor ids. The DOM element carrying one must exist whenever the role's workspace renders. */
export const SECTION_IDS = [
  'role-overview',
  'role-pipeline',
  'role-catalogue',
  'role-documents',
  'role-portfolio',
  'role-queue',
  'role-quotations',
  'role-rfqs',
  'role-projects',
  'role-billing',
  'role-enquiries',
  'role-performance',
  'role-profile',
] as const;
export type SectionId = typeof SECTION_IDS[number];

export function isSectionId(value: string): value is SectionId {
  return (SECTION_IDS as readonly string[]).includes(value);
}

/**
 * Sections every professional workspace renders, in render order. These come
 * from the shared `isProfessional` block in RolePlatform, not from the
 * per-role workspace component.
 */
const PROFESSIONAL_TAIL: SectionId[] = ['role-billing', 'role-enquiries', 'role-performance'];

/**
 * The sections each role's workspace renders, in the order they appear on the
 * page. `role-overview` is the hero at the top of every workspace.
 */
export const ROLE_SECTIONS: Record<WorkspaceRole, SectionId[]> = {
  homeowner: ['role-overview', 'role-projects', 'role-profile'],
  contractor: ['role-overview', 'role-pipeline', 'role-quotations', 'role-projects', ...PROFESSIONAL_TAIL],
  engineer: ['role-overview', 'role-documents', 'role-rfqs', 'role-projects', ...PROFESSIONAL_TAIL],
  architect: ['role-overview', 'role-portfolio', 'role-rfqs', 'role-projects', ...PROFESSIONAL_TAIL],
  supplier: ['role-overview', 'role-catalogue', 'role-rfqs', 'role-quotations', 'role-projects', ...PROFESSIONAL_TAIL],
  project_manager: ['role-overview', 'role-queue', 'role-rfqs', ...PROFESSIONAL_TAIL],
};

export function hasSection(role: WorkspaceRole, section: SectionId): boolean {
  return ROLE_SECTIONS[role].includes(section);
}

/**
 * The workspace URL for a section. A section the role does not have resolves to
 * the bare workspace rather than an anchor that would silently do nothing.
 */
export function workspaceHref(role: WorkspaceRole, section?: SectionId): string {
  const base = `/platform/${role}`;
  if (!section || !hasSection(role, section) || section === 'role-overview') return base;
  return `${base}#${section}`;
}
