import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import { ADMIN_NAV, ADMIN_ROUTES_NOT_IN_MENU, adminMenuFor } from '../client/src/lib/adminNavigation';
import { ADMIN_PERMISSIONS, ADMIN_ROLE_PERMISSIONS, permissionsForAdminRole } from '@shared/adminRoles';

/**
 * AN ADMIN SCREEN THAT IS NOT IN THE MENU IS NOT IN THE PRODUCT.
 *
 * `/admin/admins` shipped with no menu entry and no inbound link anywhere in
 * the client. It is the entire surface for the Super Admin authority model -
 * creating an administrator, changing a role, deactivating an account,
 * revoking a compromised administrator's sessions, resetting a password - and
 * the only way to reach it was to already know the URL and type it.
 *
 * Nothing leaked: every procedure behind it is `superAdminProcedure` and fails
 * closed. The defect is that the capability was unreachable, and revoking a
 * compromised admin's sessions is exactly the thing you need to find in a
 * hurry without being told where it is.
 *
 * So this file does not assert that one entry exists. It asserts the RULE:
 * every `/admin` route App.tsx registers is either in the menu or on a written
 * list of deliberate exceptions. The next admin screen cannot go missing the
 * same way without turning this red.
 */

const APP = readSourceForAssertions(
  readFileSync(new URL('../client/src/App.tsx', import.meta.url), 'utf8'),
);
const DASHBOARD = readSourceForAssertions(
  readFileSync(new URL('../client/src/pages/AdminDashboard.tsx', import.meta.url), 'utf8'),
);

/** Every `path={...}` App.tsx registers under `/admin`. */
function registeredAdminRoutes(): string[] {
  return [...APP.matchAll(/path=\{?["']([^"']+)["']/g)]
    .map(match => match[1])
    .filter(route => route === '/admin' || route.startsWith('/admin/'));
}

describe('the route table was parsed', () => {
  // Without this, every assertion below passes vacuously on an empty list -
  // which is the failure mode that let the original defect through a suite
  // that was supposed to catch it.
  it('finds the admin routes App.tsx actually registers', () => {
    const routes = registeredAdminRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(6);
    expect(routes).toContain('/admin');
    expect(routes).toContain('/admin/admins');
  });
});

describe('every admin route is reachable, or its absence is written down', () => {
  const menuPaths = new Set(ADMIN_NAV.map(entry => entry.path));

  it.each(registeredAdminRoutes())('%s is in the menu or on the exceptions list', route => {
    const reachable = menuPaths.has(route);
    const excepted = Object.prototype.hasOwnProperty.call(ADMIN_ROUTES_NOT_IN_MENU, route);
    expect(
      reachable || excepted,
      `${route} is registered in App.tsx but is in neither ADMIN_NAV nor ADMIN_ROUTES_NOT_IN_MENU. `
      + 'Add it to the menu, or record why it is deliberately absent.',
    ).toBe(true);
  });

  it('the Super Admin authority console is in the menu, not merely excepted', () => {
    // Named explicitly as well as covered by the rule above: an exception
    // entry for this one would satisfy the rule and reinstate the defect.
    expect(menuPaths.has('/admin/admins')).toBe(true);
    expect(ADMIN_ROUTES_NOT_IN_MENU['/admin/admins']).toBeUndefined();
  });

  it('every exception carries a reason, not an empty string', () => {
    for (const [route, reason] of Object.entries(ADMIN_ROUTES_NOT_IN_MENU)) {
      expect(reason.trim().length, `${route} has no recorded reason`).toBeGreaterThan(10);
    }
  });

  it('no menu entry points at a route App.tsx does not register', () => {
    // The mirror of the rule above. A menu entry to nowhere is a dead control,
    // which is the same defect pointed the other way.
    const registered = registeredAdminRoutes();
    const patterns = registered
      .filter(route => route.includes(':'))
      .map(route => new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+')}$`));
    for (const entry of ADMIN_NAV) {
      const resolves = registered.includes(entry.path) || patterns.some(p => p.test(entry.path));
      expect(resolves, `${entry.path} is in the menu but App.tsx registers no such route`).toBe(true);
    }
  });
});

describe('the menu names permissions the product actually has', () => {
  it('every entry names a real permission', () => {
    for (const entry of ADMIN_NAV) {
      expect(ADMIN_PERMISSIONS).toContain(entry.permission);
    }
  });

  it('/admin/admins is gated on admins.manage, which only SUPER_ADMIN holds', () => {
    const entry = ADMIN_NAV.find(item => item.path === '/admin/admins');
    expect(entry?.permission).toBe('admins.manage');
    const holders = Object.entries(ADMIN_ROLE_PERMISSIONS)
      .filter(([, permissions]) => (permissions as readonly string[]).includes('admins.manage'))
      .map(([role]) => role);
    expect(holders).toEqual(['SUPER_ADMIN']);
  });
});

describe('adminMenuFor filters on the viewer, not on the fact that they are an admin', () => {
  it('a Super Admin is offered every entry', () => {
    const offered = adminMenuFor(permissionsForAdminRole('SUPER_ADMIN')).map(e => e.path);
    expect(offered).toEqual(ADMIN_NAV.map(e => e.path));
  });

  it('a MARKETPLACE_ADMIN is not offered Disputes, which they cannot open', () => {
    // The behaviour this fixes: the entry rendered for every admin, and an
    // administrator without support.manage clicked it and got an empty screen.
    const offered = adminMenuFor(permissionsForAdminRole('MARKETPLACE_ADMIN')).map(e => e.path);
    expect(offered).not.toContain('/admin/disputes');
    expect(offered).toContain('/admin/placements');
  });

  it('no non-super role is offered the authority console', () => {
    for (const role of Object.keys(ADMIN_ROLE_PERMISSIONS)) {
      if (role === 'SUPER_ADMIN') continue;
      const offered = adminMenuFor(permissionsForAdminRole(role)).map(e => e.path);
      expect(offered, `${role} was offered /admin/admins`).not.toContain('/admin/admins');
    }
  });

  it('an unresolved permission list offers nothing rather than guessing', () => {
    // The moment before `admin.me` resolves. Showing fewer destinations for an
    // instant is honest; showing one the viewer does not have is not.
    expect(adminMenuFor([])).toEqual([]);
  });
});

/**
 * ── ARRIVING SOMEWHERE HAS TO LOOK LIKE ARRIVING SOMEWHERE ────────────────
 *
 * The sibling defect to an unreachable screen, and it was reported from real
 * use: clicking Analytics in the sidebar "is not taking me any where".
 *
 * It was taking you there. The URL changed, the sidebar highlighted, and the
 * right tab panel became active. What did not change was the SCREEN. The
 * console rendered, above the tabs and therefore on every section alike:
 *
 *   - a heading hard-coded to `t('admin.title')` - "Admin Control Panel"
 *   - four KPI cards
 *   - the whole "Professional registration summary" applicant queue
 *
 * So Analytics opened on a first viewport byte-identical to the one you left,
 * with its own content pushed below the fold. A person cannot tell that from a
 * dead link, and they should not have to.
 *
 * Both halves are held here. The heading must be derived from ADMIN_NAV - the
 * same list the menu is built from, so the sidebar and the page cannot name
 * the section differently - and the overview's own content must live inside
 * the overview tab rather than above all of them.
 */
describe('a section you navigate to looks different from the one you left', () => {
  it('the heading is derived from the nav list, not hard-coded to one title', () => {
    expect(DASHBOARD).toContain('ADMIN_NAV.find(item => item.path === `/admin/${adminSection}`)');
    expect(DASHBOARD).toContain('data-testid="admin-section-heading"');
    expect(DASHBOARD).toContain('{t(adminSectionLabelKey)}');
  });

  it('every menu destination has a label the heading can actually resolve', () => {
    // A section whose labelKey is missing would silently fall back to the
    // console title and reintroduce the defect for that one screen.
    for (const entry of ADMIN_NAV) {
      expect(entry.labelKey, `${entry.path} has no labelKey`).toBeTruthy();
    }
    // ...and the labels must be distinct, or two sections would render the
    // same heading and be indistinguishable again.
    const labels = ADMIN_NAV.map(entry => entry.labelKey);
    expect(new Set(labels).size, `duplicate heading labels: ${labels.join(', ')}`).toBe(labels.length);
  });

  it("the overview's own content is inside the overview tab, not above every tab", () => {
    // The KPI grid and the applicant-registration queue are overview content.
    // Rendered above <Tabs> they appear on Analytics, Billing and Disputes too.
    const tabsAt = DASHBOARD.indexOf('<Tabs value={adminSection}');
    expect(tabsAt, 'the Tabs root moved - review this guard').toBeGreaterThan(-1);
    const aboveTheTabs = DASHBOARD.slice(0, tabsAt);
    expect(aboveTheTabs, 'the KPI cards render above every section again')
      .not.toContain('admin-kpi-');
    expect(aboveTheTabs, 'the applicant registration queue renders above every section again')
      .not.toContain('Professional registration summary');
  });
});
