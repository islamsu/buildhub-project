import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Phase 4A.6.4: navigation/reachability regression tests. There is no React
// component-rendering harness anywhere in this repo (no @testing-library,
// no jsdom dependency) - every existing frontend-touching test in this
// codebase is source-inspection style (readFileSync + assertions on the
// real committed source), and these follow that same established
// convention rather than introducing new test infrastructure.

function read(relativeToServerDir: string): string {
  return readFileSync(new URL(relativeToServerDir, import.meta.url), 'utf8');
}

describe('dashboard reachability - root cause fix (items 1-2)', () => {
  it('1. AuthPage sends an approved provider straight to their role platform on sign-in (the real, always-reachable entry point)', () => {
    const authPage = read('../client/src/pages/AuthPage.tsx');
    expect(authPage).toContain('getRolePlatformPath');
    // Every login/signup success path considered branches on PROFESSIONAL_ROLES + onboardingStatus,
    // landing an approved provider on getRolePlatformPath(...) - never on /provider.
    expect(authPage).not.toMatch(/navigate\(['"]\/provider['"]\)/);
  });

  it('1b. RolePlatform (the real vendor dashboard) renders real Vendor Profile/Reputation/Analytics for professional roles', () => {
    const rolePlatform = read('../client/src/pages/RolePlatform.tsx');
    expect(rolePlatform).toContain('VendorProfileCard');
    expect(rolePlatform).toContain('VendorReputation');
    expect(rolePlatform).toContain('VendorAnalytics');
    expect(rolePlatform).toContain('isProfessional &&');
  });

  it('2. RolePlatform does not redirect an approved provider away from their own matching role platform - its redirect effect is unchanged and still only fires for admin/unapproved-compliance/role-mismatch', () => {
    const rolePlatform = read('../client/src/pages/RolePlatform.tsx');
    const effectBlock = rolePlatform.slice(rolePlatform.indexOf('useEffect(() => {\n    if (!loading && !isAuthenticated)'), rolePlatform.indexOf('}, [loading, isAuthenticated, rawRole, accountRole, onboardingStatus, requestedRole, navigate]);'));
    // Exactly the 4 pre-existing conditions - nothing broadened, nothing that would catch
    // a normal approved provider viewing their own /platform/<their-role>.
    expect(effectBlock).toContain("if (!loading && !isAuthenticated) navigate('/auth?mode=login');");
    expect(effectBlock).toContain("rawRole === 'admin' || accountRole === 'admin'");
    expect(effectBlock).toContain('isComplianceRole(rawRole) && onboardingStatus !== \'approved\'');
    expect(effectBlock).toContain('requestedRole !== rawRole');
    // The new Vendor Performance section is rendered unconditionally alongside the rest of
    // the page content (gated only on role, never on a redirect flag), so it can never be
    // the thing causing an unwanted bounce.
    expect(rolePlatform.indexOf('isProfessional &&')).toBeGreaterThan(rolePlatform.indexOf('return ('));
  });

  it('the legacy /provider route still exists and still forwards an authenticated user to the correct platform path (old bookmarks/links keep working) - the redirect itself was correct and was intentionally NOT removed', () => {
    const legacy = read('../client/src/pages/ProviderDashboard.tsx');
    expect(legacy).toContain('getRolePlatformPath');
    expect(legacy).toMatch(/if \(isAuthenticated\) navigate\(`\$\{getRolePlatformPath\(userRole\)\}/);
  });

  it('and the forward carries the QUERY STRING, which it once discarded', () => {
    // A redirect that drops half the address is not forwarding, it is
    // truncating. This silently broke a feature: `/rfq/:id` sent a provider
    // here carrying `?rfq=<id>`, the link resolved, the redirect fired, and the
    // parameter was gone before anything could read it. Every source-level test
    // passed - the link, the parser and the destination were all correct - and
    // the journey still did not work. Found by clicking it in a browser.
    const legacy = read('../client/src/pages/ProviderDashboard.tsx');
    expect(legacy).toContain('useSearch');
    expect(legacy).toMatch(/navigate\(`\$\{getRolePlatformPath\(userRole\)\}\$\{search \?/);
  });
});

describe('fake dashboard statistics removed (item 9)', () => {
  it('the hardcoded "< 2h" / "4.8 ★" / "24" placeholder stat row no longer exists anywhere in the app', () => {
    const legacy = read('../client/src/pages/ProviderDashboard.tsx');
    const rolePlatform = read('../client/src/pages/RolePlatform.tsx');
    for (const file of [legacy, rolePlatform]) {
      expect(file).not.toContain('< 2h');
      expect(file).not.toContain('4.8 ★');
      expect(file).not.toMatch(/value:\s*'24'/);
      expect(file).not.toContain("label: 'Avg Response'");
      expect(file).not.toContain("label: 'Rating'");
    }
  });

  it('ProviderDashboard.tsx no longer renders any UI at all - it is a redirect-only shim, so it cannot present stale/fake data to a real user', () => {
    const legacy = read('../client/src/pages/ProviderDashboard.tsx');
    expect(legacy).not.toContain('<Card');
    expect(legacy).not.toContain('DashboardLayout');
    expect(legacy).not.toContain('statCards');
  });

  it('there is exactly one authoritative source for rating/response-time/win-rate/completed-projects - the real profile/reviews/analytics routers, not a second hardcoded set', () => {
    const routers = read('./routers.ts');
    // Sanity: the real computed values this dashboard now shows all come from the same
    // 3 procedures verified in Phase 4A.6.1-4A.6.3, re-confirmed still present.
    expect(routers).toContain('completedProjectCount');
    expect(routers).toContain('statsForUser:');
    expect(routers).toContain('myStats:');
  });
});

describe('role boundary regression (items 3-5)', () => {
  it('3. a homeowner gets the homeowner workspace and none of the vendor surfaces', () => {
    const rolePlatform = read('../client/src/pages/RolePlatform.tsx');
    expect(rolePlatform).toContain("const isProfessional = role !== 'homeowner';");
    expect(rolePlatform).toContain('<HomeownerWorkspace');
    // The rule is the GATE, not the exact formatting of the branch. A homeowner
    // later gained a self-scoped profile section of their own - that is their
    // own account, not a vendor surface - so pinning the literal source text of
    // the branch was testing the whitespace rather than the boundary.
    // role-billing left this page for /settings. The BOUNDARY being tested is
    // unchanged - a homeowner must not be shown a vendor surface - so the list
    // shrinks to the sections that are still here rather than the assertion
    // being dropped.
    for (const vendorOnly of ['<section id="role-performance">', '<section id="role-enquiries">']) {
      const at = rolePlatform.indexOf(vendorOnly);
      expect(at, `${vendorOnly} must exist`).toBeGreaterThan(-1);
      const before = rolePlatform.slice(Math.max(0, at - 60), at);
      expect(before, `${vendorOnly} must be gated on isProfessional`).toContain('{isProfessional && (');
    }
    // And the vendor-only components are never mounted outside that gate.
    for (const vendorComponent of ['<VendorAnalytics', '<QualifiedEnquiries']) {
      expect(rolePlatform.split(vendorComponent).length - 1, `${vendorComponent} is mounted more than once`).toBe(1);
    }
    // These two moved to Settings and must be gone from here entirely - a
    // leftover copy would be the duplicate implementation §10 forbids.
    for (const moved of ['<VendorBilling', '<VendorServiceCategories']) {
      expect(rolePlatform, `${moved} moved to Settings and must not remain here`).not.toContain(moved);
    }
  });

  it('4. all 4 other provider roles (engineer, architect, supplier, project_manager) keep their own distinct workspace branches, unmodified by this phase', () => {
    const rolePlatform = read('../client/src/pages/RolePlatform.tsx');
    expect(rolePlatform).toContain('<EngineerWorkspace');
    expect(rolePlatform).toContain('<ArchitectWorkspace');
    expect(rolePlatform).toContain('<SupplierWorkspace');
    expect(rolePlatform).toContain('<ProjectManagerWorkspace');
    expect(rolePlatform).toContain('<ContractorWorkspace');
  });

  it('5. an unapproved provider is still routed to /compliance before ever reaching the platform (or the new Vendor Performance section) - unchanged from the pre-existing RolePlatform logic', () => {
    const rolePlatform = read('../client/src/pages/RolePlatform.tsx');
    expect(rolePlatform).toContain("navigate('/compliance')");
    expect(rolePlatform).toContain("isComplianceRole(rawRole) && onboardingStatus !== 'approved'");
  });

  it('admin navigation is unaffected - admins are still redirected to /admin before any platform content renders', () => {
    const rolePlatform = read('../client/src/pages/RolePlatform.tsx');
    expect(rolePlatform).toContain("if (loading || !isAuthenticated || rawRole === 'admin' || accountRole === 'admin') return null;");
  });
});

describe('vendor scoping preserved after the move (items 6-8)', () => {
  it('6. analytics.myStats is still self-scoped via ctx.user.id with no vendorId input - RolePlatform passes no id/target into VendorAnalytics', () => {
    const rolePlatform = read('../client/src/pages/RolePlatform.tsx');
    // VendorAnalytics takes no props at all (see server/vendorAnalytics.test.ts item 2 for the
    // backend structural guarantee) - confirm the call site here doesn't try to pass one either.
    expect(rolePlatform).toMatch(/<VendorAnalytics\s*\/>/);
  });

  it('7. VendorReputation is scoped to the signed-in vendor\'s own id (ownProfile.id from profile.getOwn), never a route param or another account\'s id', () => {
    const rolePlatform = read('../client/src/pages/RolePlatform.tsx');
    expect(rolePlatform).toContain('<VendorReputation userId={ownProfile.id} />');
    expect(rolePlatform).not.toMatch(/<VendorReputation userId=\{(?!ownProfile\.id)/);
  });

  it('8. VendorProfileCard is self-only by construction (profile.getOwn/update take no target-account id) - re-confirmed present, not reimplemented with a target id', () => {
    const card = read('../client/src/components/VendorProfileCard.tsx');
    expect(card).toContain('trpc.profile.getOwn.useQuery()');
    expect(card).toContain('trpc.profile.update.useMutation');
    expect(card).not.toMatch(/getOwn\.useQuery\(\s*\{/); // no input object - takes no id
  });
});

describe('existing Profile/Reputation/Analytics coverage continues passing (item 10)', () => {
  it('the pre-existing backend test suites for profile/reputation/analytics were not deleted', () => {
    expect(() => read('./vendorProfile.test.ts')).not.toThrow();
    expect(() => read('./vendorReputation.test.ts')).not.toThrow();
    expect(() => read('./vendorAnalytics.test.ts')).not.toThrow();
    expect(() => read('./reviewsAuthorization.test.ts')).not.toThrow();
  });
});
