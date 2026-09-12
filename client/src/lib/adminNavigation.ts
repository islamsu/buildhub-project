/**
 * THE ADMIN NAVIGATION, AS DATA.
 *
 * This lives apart from DashboardLayout for one reason: the menu is the only
 * way into most admin screens, so "is every screen in the menu?" has to be
 * answerable by a test, and a test cannot cheaply import a component that
 * pulls in the entire sidebar and icon set. Holding the destinations here
 * makes that question a real assertion about the real list rather than a grep
 * over a .tsx file, which dies on formatting and passes on wrong values.
 *
 * WHY IT MATTERS. `/admin/admins` was missing from the menu and had no inbound
 * link anywhere in the client. It is the whole surface for the Super Admin
 * authority model - creating an administrator, changing a role, deactivating
 * an account, revoking a compromised administrator's sessions, resetting a
 * password. The only way to reach it was to already know the URL. That is not
 * a discoverability nitpick: revoking a compromised admin's sessions is
 * exactly the thing you need to find in a hurry, without being told.
 */
import type { AdminPermission } from '@shared/adminRoles';

export type AdminNavEntry = {
  /** The route, exactly as App.tsx registers it. */
  path: string;
  /** Translation key for the label. */
  labelKey: string;
  /**
   * The permission the destination's own procedures require.
   *
   * Read off `adminWith(...)` in server/routers.ts, not guessed: an entry
   * offered to an administrator who lacks the permission leads to a refusal or
   * an empty screen, which reads as a broken product rather than a boundary.
   */
  permission: AdminPermission;
  /** Which sidebar group this destination belongs to. Exactly one. */
  group: AdminNavGroup;
};

/**
 * THE GROUPS, in the order the sidebar renders them.
 *
 * A flat list of sixteen destinations is a list, not an information
 * architecture: an administrator hunting for Placements read every label. The
 * groups are domains, not database tables, and a destination belongs to
 * exactly one - ambiguous ownership is what produced two entry points into the
 * registration workflow in the first place.
 */
export const ADMIN_NAV_GROUPS = [
  { key: 'control', labelKey: 'adminNav.control' },
  { key: 'identity', labelKey: 'adminNav.identity' },
  { key: 'marketplace', labelKey: 'adminNav.marketplace' },
  { key: 'trust', labelKey: 'adminNav.trust' },
  { key: 'commercial', labelKey: 'adminNav.commercial' },
  { key: 'insights', labelKey: 'adminNav.insights' },
  { key: 'administration', labelKey: 'adminNav.administration' },
] as const;

export type AdminNavGroup = (typeof ADMIN_NAV_GROUPS)[number]['key'];

export const ADMIN_NAV: readonly AdminNavEntry[] = [
  { path: '/admin', labelKey: 'admin.title', permission: 'users.read', group: 'control' },

  // USER & IDENTITY. Professional Registrations sits IMMEDIATELY after User
  // Management by explicit owner decision, and the adjacency is asserted in
  // server/adminInformationArchitecture.test.ts so a later edit cannot drift it.
  { path: '/admin/users', labelKey: 'admin.users', permission: 'users.read', group: 'identity' },
  { path: '/admin/registrations', labelKey: 'admin.registrations', permission: 'marketplace.manage', group: 'identity' },

  { path: '/admin/categories', labelKey: 'admin.categories', permission: 'marketplace.manage', group: 'marketplace' },
  { path: '/admin/placements', labelKey: 'admin.placements', permission: 'marketplace.manage', group: 'marketplace' },
  { path: '/admin/enquiries', labelKey: 'admin.enquiries', permission: 'marketplace.manage', group: 'marketplace' },
  { path: '/admin/referrals', labelKey: 'admin.referrals', permission: 'marketplace.manage', group: 'marketplace' },

  { path: '/admin/disputes', labelKey: 'admin.disputes', permission: 'support.manage', group: 'trust' },
  { path: '/admin/support', labelKey: 'admin.support', permission: 'support.manage', group: 'trust' },
  { path: '/admin/reviews', labelKey: 'admin.reviews', permission: 'support.manage', group: 'trust' },

  // "Vendor Billing" described a page that holds plans, entitlements, manual
  // overrides and benefits - and no payments, which remain owner-deferred.
  // Named for what it is, so nothing implies revenue this platform does not
  // process.
  { path: '/admin/billing', labelKey: 'admin.billing_benefits', permission: 'billing.read', group: 'commercial' },

  { path: '/admin/analytics', labelKey: 'admin.analytics', permission: 'audit.read', group: 'insights' },
  { path: '/admin/operations', labelKey: 'admin.operations', permission: 'audit.read', group: 'insights' },

  // ADMINISTRATOR MANAGEMENT STAYS TOP LEVEL, deliberately, even though it is
  // "users" in the loosest sense. Revoking a compromised administrator's
  // sessions is a security-critical action somebody needs to find in a hurry,
  // and managing marketplace users and managing platform administrators are
  // different security boundaries.
  { path: '/admin/admins', labelKey: 'admin.admins', permission: 'admins.manage', group: 'administration' },
  { path: '/admin/settings', labelKey: 'dash.settings', permission: 'settings.manage', group: 'administration' },
] as const;

/**
 * `/admin` routes deliberately absent from the menu, each with its reason.
 *
 * A route may be missing from the menu only by appearing here, which turns the
 * omission into a decision somebody wrote down instead of an oversight nobody
 * noticed. The route-coverage test holds App.tsx against ADMIN_NAV plus this
 * list and fails on anything in neither.
 */
export const ADMIN_ROUTES_NOT_IN_MENU: Readonly<Record<string, string>> = {
  '/admin/login': 'the administrator sign-in screen, reached by someone with no session and therefore no menu',
  '/admin/accept-invitation': 'opened from the invitation email by someone who is not yet an administrator, and so has no admin menu to find it in',
  '/admin/users/:id': 'a detail page, reached by clicking a row in the user list',
  '/admin/projects/:id': 'a detail page, reached by clicking a row in the project list',
  '/admin/:section': 'the section catch-all; every section it serves is listed in ADMIN_NAV',
  '/admin/compliance': 'ALIAS. Pending Verifications and the Professional Registration Summary were two views of ONE query (admin.complianceQueue), over the same applicants, driving the same onboardingStatus lifecycle through the same updateApplicantStatus mutation - not two capabilities. Consolidated into /admin/registrations; this path still resolves there so saved bookmarks land on the capability.',
  '/admin/name-changes': 'ALIAS. Correcting a vendor legal or display name is identity administration, so the queue is a tab inside User Management rather than a separate domain. This path resolves to /admin/users with that tab open.',
  '/admin/:section/:record': 'the record catch-all behind the section screens',
};

/**
 * The entries this viewer may actually use.
 *
 * An empty permission list yields only what needs nothing, which is what the
 * menu shows for the moment before `admin.me` resolves. Briefly showing fewer
 * destinations is honest; briefly showing one the viewer does not have is not.
 */
export function adminMenuFor(permissions: readonly string[]): AdminNavEntry[] {
  return ADMIN_NAV.filter(entry => permissions.includes(entry.permission));
}
