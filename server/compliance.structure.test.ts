import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');

function source(relativePath: string) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

describe('compliance workflow structure', () => {
  it('supports the submitted document state in shared labels and applicant UI', () => {
    const shared = source('shared/compliance.ts');
    const page = source('client/src/pages/CompliancePage.tsx');
    expect(shared).toContain("submitted: ['Submitted', 'تم الإرسال']");
    expect(page).toContain('getComplianceStatusLabel(documentStatus');
  });

  it('exposes role and status filters in the admin compliance queue', () => {
    const admin = source('client/src/pages/AdminDashboard.tsx');
    expect(admin).toContain('complianceRoleFilter');
    expect(admin).toContain('complianceStatusFilter');
    expect(admin).toContain('filteredComplianceQueue');
    expect(admin).toContain('Filter by role');
    expect(admin).toContain('Filter by status');
  });

  it('guards provider workflows until onboarding is approved', () => {
    const router = source('server/routers.ts');
    const platform = source('client/src/pages/RolePlatform.tsx');
    expect(router).toContain('Professional registration approval is required. Visit /compliance.');
    expect(router).toContain('const approvedProviderProcedure');
    expect(platform).toContain("onboardingStatus !== 'approved'");
  });
});
