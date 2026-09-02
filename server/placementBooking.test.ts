import { describe, expect, it } from 'vitest';
import { bookPlacement, isValidPackageSurface, PACKAGE_SURFACES } from './placementBooking';
import { products, users, vendorSponsorships } from '../drizzle/schema';

function makeDb(options: {
  providerRows?: unknown[];
  productRows?: unknown[];
  masterRows?: unknown[];
  spotlightRows?: unknown[];
} = {}) {
  const inserts: unknown[] = [];
  const chain = (rows: unknown[]) => {
    const c: any = {
      where: () => c,
      limit: () => Promise.resolve(rows),
      orderBy: () => c,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return c;
  };
  const db: any = {
    select: () => ({
      from: (table: unknown) => {
        if (table === users) return chain(options.providerRows ?? [{ id: 1, userRole: 'contractor', onboardingStatus: 'approved', accountStatus: 'active' }]);
        if (table === products) return chain(options.productRows ?? [{ id: 10, active: true }]);
        if (table === vendorSponsorships) {
          return chain(options.masterRows ?? options.spotlightRows ?? []);
        }
        return chain([]);
      },
    }),
    insert: () => ({ values: () => { inserts.push({}); return Promise.resolve([{ insertId: 1 }]); } }),
  };
  return { db, inserts };
}

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

  it('rejects an overlapping exclusive Provider Master placement', async () => {
    const { db } = makeDb({ masterRows: [{ id: 1 }] });
    const result = await bookPlacement(db, {
      entityType: 'PROVIDER',
      entityId: 2,
      package: 'PREMIER',
      surface: 'MASTER_DISCOVERY',
      source: 'PAID_SPONSORSHIP',
      category: 'Saudi',
      startsAt: new Date('2026-09-05T00:00:00Z'),
      endsAt: new Date('2026-09-10T00:00:00Z'),
      grantedBy: 1,
    });
    expect(result).toMatchObject({ outcome: 'rejected', reason: 'An exclusive Master placement already overlaps this scope.' });
  });

  it('rejects a fourth Spotlight placement in the same scope', async () => {
    const { db } = makeDb({ spotlightRows: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    const result = await bookPlacement(db, {
      entityType: 'PROVIDER',
      entityId: 4,
      package: 'SPOTLIGHT',
      surface: 'TYPE_CATEGORY_SPOTLIGHT',
      source: 'PAID_SPONSORSHIP',
      category: 'Contractors',
      startsAt: new Date(),
      endsAt: null,
      grantedBy: 1,
    });
    expect(result).toMatchObject({ outcome: 'rejected', reason: 'Spotlight capacity for this scope is full.' });
  });

  it('accepts a Provider Master placement when no overlapping placement exists', async () => {
    const { db, inserts } = makeDb({ masterRows: [] });
    const result = await bookPlacement(db, {
      entityType: 'PROVIDER',
      entityId: 1,
      package: 'PREMIER',
      surface: 'MASTER_DISCOVERY',
      source: 'PAID_SPONSORSHIP',
      category: 'Saudi',
      startsAt: new Date(),
      endsAt: null,
      grantedBy: 1,
    });
    expect(result).toEqual({ outcome: 'granted', placementId: 1 });
    expect(inserts.length).toBe(1);
  });
});
