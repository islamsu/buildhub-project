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
};

export const ADMIN_NAV: readonly AdminNavEntry[] = [
  { path: '/admin', labelKey: 'admin.title', permission: 'users.read' },
  { path: '/admin/users', labelKey: 'admin.users', permission: 'users.read' },
  { path: '/admin/name-changes', labelKey: 'admin.name_changes', permission: 'marketplace.manage' },
  { path: '/admin/referrals', labelKey: 'admin.referrals', permission: 'marketplace.manage' },
  { path: '/admin/placements', labelKey: 'admin.placements', permission: 'marketplace.manage' },
  { path: '/admin/enquiries', labelKey: 'admin.enquiries', permission: 'marketplace.manage' },
  { path: '/admin/compliance', labelKey: 'admin.pending_verifications', permission: 'marketplace.manage' },
  { path: '/admin/disputes', labelKey: 'admin.disputes', permission: 'support.manage' },
  { path: '/admin/analytics', labelKey: 'admin.analytics', permission: 'audit.read' },
  { path: '/admin/billing', labelKey: 'adminBilling.title', permission: 'billing.read' },
  { path: '/admin/operations', labelKey: 'admin.operations', permission: 'audit.read' },
  { path: '/admin/admins', labelKey: 'admin.admins', permission: 'admins.manage' },
  { path: '/admin/settings', labelKey: 'dash.settings', permission: 'settings.manage' },
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
