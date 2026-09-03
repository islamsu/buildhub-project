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
