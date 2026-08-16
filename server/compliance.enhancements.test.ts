import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { summarizeComplianceRegistrations } from '../shared/compliance';

const projectRoot = resolve(import.meta.dirname, '..');
const source = (relativePath: string) => readFileSync(resolve(projectRoot, relativePath), 'utf8');

describe('compliance queue enhancements', () => {
  it('summarizes pending and approved professional registrations by role', () => {
    const summary = summarizeComplianceRegistrations([
      { userRole: 'contractor', onboardingStatus: 'under_review' },
      { userRole: 'contractor', onboardingStatus: 'approved' },
      { userRole: 'supplier', onboardingStatus: 'update_required' },
      { userRole: 'homeowner', onboardingStatus: 'approved' },
    ]);

    expect(summary.find(row => row.role === 'contractor')).toEqual({ role: 'contractor', label: 'Contractors', pending: 1, approved: 1 });
    expect(summary.find(row => row.role === 'supplier')).toEqual({ role: 'supplier', label: 'Suppliers', pending: 1, approved: 0 });
    expect(summary.find(row => row.role === 'engineer')).toMatchObject({ pending: 0, approved: 0 });
    expect(summarizeComplianceRegistrations([{ userRole: 'architect', onboardingStatus: 'approved' }], true).find(row => row.role === 'architect')?.label).toBe('المهندسون المعماريون');
  });

  it('wires applicant notes into the upload payload and renders submission history', () => {
    const router = source('server/routers.ts');
    const page = source('client/src/pages/CompliancePage.tsx');
    expect(router).toContain('registrationDocumentSubmissions');
    expect(router).toContain('applicantNote: input.applicantNote');
    expect(page).toContain('applicantNote: applicantNote.trim() || undefined');
    expect(page).toContain('Document submission history');
    expect(page).toContain('submission.applicantNote');
  });

  it('keeps document quick view inside the admin queue workflow', () => {
    const admin = source('client/src/pages/AdminDashboard.tsx');
    expect(admin).toContain('activeDocument');
    expect(admin).toContain('setActiveDocument(document)');
    expect(admin).toContain("setActiveDocument(previewDocument)");
    expect(admin).toContain('Quick view');
    expect(admin).toContain('Document preview');
    expect(admin).toContain('activeDocument?.mimeType?.startsWith(\'image/\')');
    expect(admin).toContain('Re-upload history');
    expect(admin).toContain('item.applicantNote');
  });
});
