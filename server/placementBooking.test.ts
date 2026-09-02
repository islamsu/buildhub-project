import { describe, expect, it } from 'vitest';
import { bookPlacement, isValidPackageSurface, PACKAGE_SURFACES } from './placementBooking';

describe('commercial placement package/surface integrity', () => {
  it('defines the intended package benefit matrix', () => {
    expect(PACKAGE_SURFACES.BOOST).toEqual(['SEARCH_RESULTS_BOOST']);
    expect(PACKAGE_SURFACES.SPOTLIGHT).toEqual(['TYPE_CATEGORY_SPOTLIGHT', 'SEARCH_RESULTS_BOOST']);
    expect(PACKAGE_SURFACES.PREMIER).toEqual(['MASTER_DISCOVERY', 'TYPE_CATEGORY_SPOTLIGHT', 'SEARCH_RESULTS_BOOST']);
  });

  it('rejects BOOST with Master Discovery', () => {
    expect(isValidPackageSurface('BOOST', 'MASTER_DISCOVERY')).toBe(false);
  });

  it('rejects SPOTLIGHT with Master Discovery', () => {
    expect(isValidPackageSurface('SPOTLIGHT', 'MASTER_DISCOVERY')).toBe(false);
  });

  it('accepts PREMIER with Master Discovery', () => {
    expect(isValidPackageSurface('PREMIER', 'MASTER_DISCOVERY')).toBe(true);
  });

  it('enforces package/surface integrity in the booking engine before any DB work', async () => {
    const result = await bookPlacement({}, {
      entityType: 'PROVIDER',
      entityId: 1,
      package: 'BOOST',
      surface: 'MASTER_DISCOVERY',
      source: 'ADMIN_EDITORIAL',
      category: 'General',
      startsAt: new Date(),
      endsAt: null,
      grantedBy: 1,
    });
    expect(result).toEqual({ outcome: 'rejected', reason: 'BOOST does not include the MASTER_DISCOVERY surface.' });
  });
});
