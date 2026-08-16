import { describe, expect, it } from 'vitest';
import { buildRegistrationMetricsCsv, filterRegistrationApplicants } from '../shared/registrationMetrics';

describe('registration metric filters and export', () => {
  const applicants = [
    { id: 1, name: 'Amina Contractor', email: 'amina@example.com', userRole: 'contractor', onboardingStatus: 'under_review', createdAt: new Date('2026-08-01T10:00:00Z'), documents: [{ url: 'https://cdn.example.com/contractor.pdf', createdAt: new Date('2026-08-10T10:00:00Z') }] },
    { id: 2, name: 'Omar Engineer', email: 'omar@example.com', userRole: 'engineer', onboardingStatus: 'approved', createdAt: new Date('2026-07-01T10:00:00Z'), onboardingReviewedAt: new Date('2026-08-12T10:00:00Z'), documents: [{ url: 'https://cdn.example.com/engineer.pdf', createdAt: new Date('2026-07-20T10:00:00Z') }] },
    { id: 3, name: 'Supplier, Inc.', email: 'supplier@example.com', userRole: 'supplier', onboardingStatus: 'update_required', createdAt: new Date('2026-08-01T10:00:00Z'), documents: [{ url: 'https://cdn.example.com/supplier.pdf', createdAt: new Date('2026-08-20T10:00:00Z') }] },
  ];

  it('combines professional category and pending submission date filters without removing approved comparisons', () => {
    expect(filterRegistrationApplicants(applicants, { role: 'contractor', from: '2026-08-01', to: '2026-08-15' })).toHaveLength(1);
    expect(filterRegistrationApplicants(applicants, { role: 'supplier', from: '2026-08-01', to: '2026-08-15' })).toHaveLength(0);
    expect(filterRegistrationApplicants(applicants, { role: 'all', from: '2026-08-01', to: '2026-08-15' }).map(applicant => applicant.id)).toEqual([1, 2]);
    expect(filterRegistrationApplicants(applicants, { from: '2026-08-20', to: '2026-08-01' })).toEqual([]);
  });

  it('exports metrics with pending/approved flags, categories, and relevant dates', () => {
    const csv = buildRegistrationMetricsCsv(applicants, role => ({ contractor: 'Contractors', engineer: 'Engineers', supplier: 'Suppliers' }[role || ''] || 'Unknown'));
    expect(csv).toContain('Professional Category');
    expect(csv).toContain('Pending Applications');
    expect(csv).toContain('Approved Applications');
    expect(csv).toContain('2026-08-10');
    expect(csv).toContain('2026-08-12');
    expect(csv).toContain('"Supplier, Inc."');
  });
});
