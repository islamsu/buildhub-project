import { describe, expect, it } from 'vitest';
import { COMPLIANCE_REQUIREMENTS, getComplianceRequirements, getComplianceStatusLabel, isComplianceRole } from '../shared/compliance';

describe('registration compliance requirements', () => {
  it('recognizes only professional roles as compliance roles', () => {
    expect(isComplianceRole('contractor')).toBe(true);
    expect(isComplianceRole('supplier')).toBe(true);
    expect(isComplianceRole('project_manager')).toBe(true);
    expect(isComplianceRole('homeowner')).toBe(false);
    expect(isComplianceRole('admin')).toBe(false);
    expect(isComplianceRole(undefined)).toBe(false);
  });

  it('defines required legal documents for every professional category', () => {
    const roles = ['contractor', 'engineer', 'architect', 'supplier', 'project_manager'] as const;
    for (const role of roles) {
      const requirements = getComplianceRequirements(role);
      expect(requirements.length).toBeGreaterThanOrEqual(4);
      expect(requirements.filter(item => item.required).length).toBeGreaterThanOrEqual(3);
      expect(requirements.every(item => item.type && item.name && item.nameAr)).toBe(true);
    }
    expect(COMPLIANCE_REQUIREMENTS.supplier.some(item => item.type === 'commercial_registration')).toBe(true);
    expect(COMPLIANCE_REQUIREMENTS.engineer.some(item => item.type === 'professional_license')).toBe(true);
  });

  it('returns empty requirements for individual homeowners', () => {
    expect(getComplianceRequirements('homeowner')).toEqual([]);
    expect(getComplianceRequirements(null)).toEqual([]);
  });

  it('provides bilingual labels for the full onboarding status lifecycle', () => {
    expect(getComplianceStatusLabel('not_started')).toBe('Not started');
    expect(getComplianceStatusLabel('under_review', true)).toBe('قيد المراجعة');
    expect(getComplianceStatusLabel('update_required')).toBe('Update required');
    expect(getComplianceStatusLabel('approved', true)).toBe('تمت الموافقة');
    expect(getComplianceStatusLabel('rejected', true)).toBe('مرفوض');
  });
});
