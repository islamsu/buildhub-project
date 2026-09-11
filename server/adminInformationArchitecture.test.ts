/**
 * ── THE SUPER ADMIN CONTROL PLANE, HELD AS AN INVARIANT ───────────────────
 *
 * The admin information architecture had drifted into three specific faults,
 * and this file exists to stop each of them coming back:
 *
 *   TWO ENTRY POINTS INTO ONE WORKFLOW. "Professional registration summary"
 *   and "Pending Verifications" read the SAME query - admin.complianceQueue -
 *   filtered two ways, over the same applicants, driving the same
 *   onboardingStatus lifecycle through the same mutation. Not two capabilities.
 *
 *   A MANAGEMENT CONSOLE ON A DASHBOARD. Applicant search, category and date
 *   filters, CSV export, pending selection and BULK APPROVAL sat on /admin.
 *
 *   A DOMAIN IN THE WRONG PLACE. Name Changes had its own top-level
 *   destination, though correcting a vendor's legal name is identity
 *   administration and belongs with the account it names.
 *
 * The rule underneath all three: every legitimate capability is discoverable
 * EXACTLY ONCE, and nothing legitimate stops being discoverable at all.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import { adminRegistrationSurface } from './_testing/adminSurface';
import {
  ADMIN_NAV, ADMIN_NAV_GROUPS, ADMIN_ROUTES_NOT_IN_MENU, adminMenuFor,
} from '../client/src/lib/adminNavigation';
import { ADMIN_ROLE_PERMISSIONS, ADMIN_PERMISSIONS } from '../shared/adminRoles';

const REGISTRATIONS = readSourceForAssertions(
  readFileSync(new URL('../client/src/components/AdminRegistrations.tsx', import.meta.url), 'utf8'),
);
const DASHBOARD = readSourceForAssertions(
  readFileSync(new URL('../client/src/pages/AdminDashboard.tsx', import.meta.url), 'utf8'),
);
const LANG = readFileSync(
  new URL('../client/src/contexts/LanguageContext.tsx', import.meta.url), 'utf8');

const paths = ADMIN_NAV.map(entry => entry.path);

describe('a Super Admin sees the COMPLETE control plane', () => {
  /**
   * The regression this prevents by name: `/admin/admins` existed, was the
   * only surface for revoking a compromised administrator's sessions, and the
   * Super Admin menu could not find it. A capability nobody can reach in a
   * hurry is not a capability.
   */
  const REQUIRED_DOMAINS = [
    '/admin',                 // the control panel itself
    '/admin/users',           // user & identity
    '/admin/registrations',   // professional registrations (incl. verification)
    '/admin/categories',      // the canonical taxonomy
    '/admin/placements',
    '/admin/enquiries',
    '/admin/referrals',
    '/admin/disputes',
    '/admin/support',
    '/admin/reviews',
    '/admin/billing',
    '/admin/analytics',
    '/admin/operations',
    '/admin/admins',          // administrator management - security critical
    '/admin/settings',
  ] as const;

  it('every required top-level domain is in the Super Admin menu', () => {
    const superAdminMenu = adminMenuFor([...ADMIN_ROLE_PERMISSIONS.SUPER_ADMIN]).map(entry => entry.path);
    for (const domain of REQUIRED_DOMAINS) {
      expect(superAdminMenu, `${domain} is not discoverable by a Super Admin`).toContain(domain);
    }
  });

  it('and the menu holds nothing BEYOND the declared domains', () => {
    // A destination nobody declared is how the sidebar grew into a list of
    // database tables. Adding one means adding a line above.
    expect([...paths].sort()).toEqual([...REQUIRED_DOMAINS].sort());
  });

  it('SUPER_ADMIN really does carry every permission, so the menu test is not vacuous', () => {
    expect([...ADMIN_ROLE_PERMISSIONS.SUPER_ADMIN].sort()).toEqual([...ADMIN_PERMISSIONS].sort());
  });
});

describe('the owner UX decisions, as invariants', () => {
  it('PROFESSIONAL REGISTRATIONS SITS IMMEDIATELY AFTER USER MANAGEMENT', () => {
    // An explicit owner instruction. Asserted on adjacency rather than on an
    // index, so inserting a group above cannot silently break it.
    const users = paths.indexOf('/admin/users');
    expect(users).toBeGreaterThanOrEqual(0);
    expect(paths[users + 1]).toBe('/admin/registrations');
  });

  it('they are in the same group, which is what makes the adjacency mean something', () => {
    const group = (path: string) => ADMIN_NAV.find(entry => entry.path === path)?.group;
    expect(group('/admin/users')).toBe('identity');
    expect(group('/admin/registrations')).toBe('identity');
  });

  it('NAME CHANGES IS NOT A TOP-LEVEL DESTINATION, and is a tab inside User Management', () => {
    expect(paths).not.toContain('/admin/name-changes');
    // One implementation, rendered inside the users section.
    expect(DASHBOARD).toContain('<AdminVendorNameChanges />');
    expect(DASHBOARD).toContain('value="name-changes"');
    expect((DASHBOARD.match(/<AdminVendorNameChanges \/>/g) ?? []).length).toBe(1);
  });

  it('PENDING VERIFICATIONS IS NOT A SECOND DESTINATION over the registration workflow', () => {
    expect(paths).not.toContain('/admin/compliance');
  });
});

describe('the consolidation is real, not a renamed duplicate', () => {
  it('there is exactly ONE component rendering the registration workflow', () => {
    expect((DASHBOARD.match(/<AdminRegistrations \/>/g) ?? []).length).toBe(1);
    // And the dashboard no longer holds the management interface itself.
    for (const moved of ['bulkUpdateApplicantStatus', 'exportRegistrationCsv', 'selectedRegistrationIds']) {
      expect(DASHBOARD, `${moved} is still on the dashboard`).not.toContain(moved);
    }
  });

  it('the dashboard preview and the management page count from the SAME query', () => {
    // If the preview had its own source the two would disagree, which is the
    // whole reason the interface moved instead of being copied.
    expect(DASHBOARD).toContain('summarizeComplianceRegistrations(complianceQueue');
    expect(REGISTRATIONS).toContain('trpc.admin.complianceQueue.useQuery');
  });

  it('both retired paths still RESOLVE, with a recorded reason', () => {
    for (const retired of ['/admin/compliance', '/admin/name-changes']) {
      expect(Object.keys(ADMIN_ROUTES_NOT_IN_MENU)).toContain(retired);
      expect(ADMIN_ROUTES_NOT_IN_MENU[retired].length).toBeGreaterThan(60);
    }
    // The alias map the section resolver uses, so a bookmark lands on the
    // capability rather than on the overview.
    expect(DASHBOARD).toContain("compliance: 'registrations'");
    expect(DASHBOARD).toContain("'name-changes': 'users'");
  });
});

/**
 * ── NO FEATURE LOSS ───────────────────────────────────────────────────────
 *
 * Every capability the two old surfaces exposed, and the token that proves it
 * survived the move. This list is the evidence for "prove each function exists
 * at the surviving destination" - deleting a line here is deleting a
 * capability, which is exactly the decision that should be hard to make by
 * accident.
 */
const MOVED_CAPABILITIES: readonly (readonly [string, string])[] = [
  ['applicant search',                 'registrationSearch'],
  ['professional category filter',     'registrationRoleFilter'],
  ['submission date from/to',          'registrationDateFrom'],
  ['invalid date range warning',       'registrationDateRangeInvalid'],
  ['include test data',                'includeDummyRegistrations'],
  ['select all pending',               'toggleAllPendingRegistrations'],
  ['select one pending',               'toggleRegistrationSelection'],
  ['bulk approve / reject',            'submitBulkDecision'],
  ['bulk confirmation dialog',         'bulkDecision'],
  ['bulk rejection reason',            'bulkRejectionReason'],
  ['CSV export',                       'exportRegistrationCsv'],
  ['status chart by role',             'summarizeComplianceRegistrations'],
  ['status filter (was Pending Verifications)', 'complianceStatusFilter'],
  ['role filter (was Pending Verifications)',   'complianceRoleFilter'],
  ['applicant detail',                 'complianceApplicant'],
  ['per-document decision',            'reviewComplianceDocument'],
  ['registration status update',       'updateApplicantStatus'],
  ['reviewer note',                    'complianceNote'],
  ['document quick view',              'loadDocumentPreview'],
  ['preview loading state',            "documentPreviewStatus === 'loading'"],
  ['preview failure state',            'documentPreviewError'],
  ['audit timeline',                   'complianceDetail.events'],
  ['error is not empty',               'complianceFailed'],
];

/**
 * WORD BOUNDARIES, not substrings.
 *
 * `toContain('exportRegistrationCsv')` passes on `exportRegistrationCsvREMOVED`
 * - a mutation that renamed the capability out of use survived this guard
 * until the match was anchored. A capability is present when its identifier is
 * present, not when its name is a prefix of something else.
 */
const mentions = (source: string, token: string) => {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w$])${escaped}([^\\w$]|$)`).test(source);
};

describe('every capability that moved still exists at the surviving destination', () => {
  it.each(MOVED_CAPABILITIES)('%s', (_name, token) => {
    expect(mentions(REGISTRATIONS, token), `${token} is not present as an identifier`).toBe(true);
  });

  it('the list is the real one - a shrunken manifest would pass vacuously', () => {
    expect(MOVED_CAPABILITIES.length).toBeGreaterThanOrEqual(23);
  });

  it('and the whole surface still satisfies them, wherever a future split puts them', () => {
    const surface = adminRegistrationSurface();
    for (const [name, token] of MOVED_CAPABILITIES) {
      expect(mentions(surface, token), name).toBe(true);
    }
  });
});

describe('least privilege: a restricted administrator sees only their own control plane', () => {
  it.each([
    // USER_ADMIN carries audit.read, so Analytics and Operations are theirs by
    // the permission they already hold - this is the real bundle, not a wish.
    ['USER_ADMIN', ['/admin', '/admin/users', '/admin/analytics', '/admin/operations']],
    ['MARKETPLACE_ADMIN', ['/admin', '/admin/users', '/admin/registrations', '/admin/categories', '/admin/placements', '/admin/enquiries', '/admin/referrals']],
    ['SUPPORT_ADMIN', ['/admin', '/admin/users', '/admin/disputes', '/admin/support', '/admin/reviews']],
  ] as const)('%s', (role, expected) => {
    const menu = adminMenuFor([...ADMIN_ROLE_PERMISSIONS[role]]).map(entry => entry.path);
    expect([...menu].sort()).toEqual([...expected].sort());
  });

  it('NOBODY BUT A SUPER ADMIN is offered Administrator Management', () => {
    // Creating administrators and revoking their sessions is a different
    // security boundary from administering marketplace users.
    for (const role of ['USER_ADMIN', 'MARKETPLACE_ADMIN', 'SUPPORT_ADMIN'] as const) {
      expect(adminMenuFor([...ADMIN_ROLE_PERMISSIONS[role]]).map(e => e.path)).not.toContain('/admin/admins');
    }
  });

  it('the menu is a courtesy, not the boundary - the page re-checks the permission itself', () => {
    expect(REGISTRATIONS).toContain("can('marketplace.manage')");
  });
});

describe('every destination and group is named in BOTH languages', () => {
  // The two halves of `translations`, which is one object keyed by language.
  const enBlock = LANG.slice(LANG.indexOf('\n  en: {'), LANG.indexOf('\n  ar: {'));
  const arBlock = LANG.slice(LANG.indexOf('\n  ar: {'));

  it.each(ADMIN_NAV.map(entry => entry.labelKey))('%s has EN and AR', key => {
    expect(enBlock, `${key} missing in English`).toContain(`'${key}':`);
    expect(arBlock, `${key} missing in Arabic`).toContain(`'${key}':`);
  });

  it.each(ADMIN_NAV_GROUPS.map(group => group.labelKey))('%s has EN and AR', key => {
    expect(enBlock, `${key} missing in English`).toContain(`'${key}':`);
    expect(arBlock, `${key} missing in Arabic`).toContain(`'${key}':`);
  });

  it('every entry declares a group, and every group is declared', () => {
    const declared = new Set(ADMIN_NAV_GROUPS.map(group => group.key));
    for (const entry of ADMIN_NAV) {
      expect(declared, `${entry.path} has an undeclared group`).toContain(entry.group);
    }
    // And no group is empty - an empty heading is a heading nobody can use.
    for (const group of ADMIN_NAV_GROUPS) {
      expect(ADMIN_NAV.some(entry => entry.group === group.key), `${group.key} has no destinations`).toBe(true);
    }
  });
});

describe('the dashboard is a dashboard', () => {
  it('/admin links to the management page rather than being one', () => {
    expect(DASHBOARD).toContain("navigate('/admin/registrations')");
  });

  it('its registration KPIs deep-link to the FILTERED subset, not the bare page', () => {
    expect(DASHBOARD).toContain('/admin/registrations?status=');
  });
});

describe('a section may not hold a capability its own permission cannot reach', () => {
  /**
   * THE DEFECT THIS NAMES, found by walking permissions rather than labels.
   *
   * Operations held AdminSponsorships, AdminFeaturedProviders and
   * AdminFeaturedProducts - all gated on `marketplace.manage` - inside a
   * section the sidebar offers on `audit.read`. No role but SUPER_ADMIN holds
   * both, so placement curation was reachable by a Super Admin and by nobody
   * else: a MARKETPLACE_ADMIN, whose job it is, never saw Operations at all.
   *
   * A section's own permission must be able to USE what the section contains.
   */
  const sectionBody = (name: string) => {
    const open = DASHBOARD.indexOf(`<TabsContent value="${name}"`);
    expect(open, `${name} section not found`).toBeGreaterThan(-1);
    return DASHBOARD.slice(open, DASHBOARD.indexOf('</TabsContent>', open));
  };

  it('placement curation lives in Placements, where marketplace.manage reaches it', () => {
    const placements = sectionBody('placements');
    for (const component of ['AdminSponsorships', 'AdminFeaturedProviders', 'AdminFeaturedProducts']) {
      expect(placements, `${component} is not in Placements`).toContain(component);
    }
  });

  it('and Operations no longer holds any of it', () => {
    const operations = sectionBody('operations');
    for (const component of ['AdminSponsorships', 'AdminFeaturedProviders', 'AdminFeaturedProducts']) {
      expect(operations, `${component} is still in Operations`).not.toContain(component);
    }
  });

  it('EXACTLY ONE of each - moved, not copied', () => {
    for (const component of ['AdminSponsorships', 'AdminFeaturedProviders', 'AdminFeaturedProducts']) {
      expect((DASHBOARD.match(new RegExp(`<${component} ?/>`, 'g')) ?? []).length, component).toBe(1);
    }
  });

  it('the role that curates the marketplace can now reach the curation surface', () => {
    const menu = adminMenuFor([...ADMIN_ROLE_PERMISSIONS.MARKETPLACE_ADMIN]).map(entry => entry.path);
    expect(menu).toContain('/admin/placements');
    // The proof the move mattered: they still cannot see Operations.
    expect(menu).not.toContain('/admin/operations');
  });
});
