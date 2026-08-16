import { describe, expect, it } from 'vitest';
import { getRolePlatformPath, isPlatformRole, PLATFORM_ROLES } from '../client/src/lib/rolePlatform';

describe('role platform routing', () => {
  it('supports every account category shown in the role chooser', () => {
    expect(PLATFORM_ROLES).toEqual([
      'homeowner',
      'contractor',
      'engineer',
      'architect',
      'supplier',
      'project_manager',
    ]);
    for (const role of PLATFORM_ROLES) {
      expect(isPlatformRole(role)).toBe(true);
      expect(getRolePlatformPath(role)).toBe(`/platform/${role}`);
    }
  });

  it('routes admins separately and defaults unknown roles to the homeowner platform', () => {
    expect(getRolePlatformPath('admin')).toBe('/admin');
    expect(getRolePlatformPath(undefined)).toBe('/platform/homeowner');
    expect(getRolePlatformPath('unknown')).toBe('/platform/homeowner');
  });
});
