import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

vi.mock('./db', () => ({ getDb: vi.fn() }));
import { featureVendor, featuredVendorIds } from './vendorSponsorship';
import { users, vendorSponsorships } from '../drizzle/schema';

/**
 * EDITORIAL FEATURED ≠ PAID SPONSORSHIP.
 *
 * Featured is an admin-curated state and must be a real, persisted, auditable
 * record that is independently distinguishable from sponsorship - never the
 * top of the organic directory, and never a hard-coded list.
 */

const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));

const VENDOR = 80;
const ADMIN = 90;
const NOW = new Date('2026-06-15T12:00:00Z');

function stubDb(vendor: Record<string, unknown> | null = {
  id: VENDOR, userRole: 'supplier', onboardingStatus: 'approved', accountStatus: 'active',
}) {
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {
      where: () => c, orderBy: () => c, limit: () => c,
      then: (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res),
    };
    return c;
  };
  const db: Record<string, unknown> = {
    select: () => ({
      from: (table: unknown) => {
        if (table === users) return chain(vendor ? [vendor] : []);
        if (table === vendorSponsorships) return chain([]);
        return chain([]);
      },
    }),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => { inserts.push({ table, values }); return [{ insertId: 700 }]; },
    }),
  };
  return { db, into: (t: unknown) => inserts.filter(r => r.table === t).map(r => r.values) };
}

describe('featureVendor - a real editorial record', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes kind=featured and no commercial reason', async () => {
    const rec = stubDb();
    const result = await featureVendor({ db: rec.db, vendorId: VENDOR, category: 'Design', featuredBy: ADMIN, now: NOW });
    expect(result).toEqual({ outcome: 'granted', sponsorshipId: 700 });
    expect(rec.into(vendorSponsorships)[0]).toMatchObject({ vendorId: VENDOR, category: 'Design', kind: 'featured' });
    expect(rec.into(vendorSponsorships)[0]).not.toHaveProperty('grantedReason');
  });

  it('refuses an unapproved provider exactly like sponsorship does', async () => {
    const rec = stubDb({ id: VENDOR, userRole: 'supplier', onboardingStatus: 'under_review', accountStatus: 'active' });
    await expect(featureVendor({ db: rec.db, vendorId: VENDOR, category: 'Design', featuredBy: ADMIN, now: NOW }))
      .resolves.toMatchObject({ outcome: 'rejected' });
    expect(rec.into(vendorSponsorships)).toEqual([]);
  });
});

describe('the admin and marketplace surfaces', () => {
  it('featured administration is gated on marketplace.manage', () => {
    expect(ROUTERS).toMatch(/featureVendor: adminWith\('marketplace\.manage'\)/);
    expect(ROUTERS).toMatch(/unfeatureVendor: adminWith\('marketplace\.manage'\)/);
    expect(ROUTERS).toMatch(/featuredProviders: adminWith\('marketplace\.manage'\)/);
  });

  it('the public featured endpoint is separate from sponsored and organic', () => {
    expect(ROUTERS).toContain('featuredProviders: publicProcedure');
    expect(ROUTERS).toMatch(/listFeaturedProviders\(input/);
  });

  it('the commercial distinction is persisted as a kind column', () => {
    const schema = readSourceForAssertions(readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8'));
    expect(schema).toContain("kind:     varchar('kind', { length: 20 }).notNull().default('sponsored')");
  });
});

describe('featuredVendorIds - ids only, filtered by kind', () => {
  it('returns the id set the directory resolves through its own filter', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            then: (res: (v: unknown) => unknown) => Promise.resolve([{ vendorId: VENDOR }, { vendorId: VENDOR }]).then(res),
          }),
        }),
      }),
    };
    await expect(featuredVendorIds(db as never, 'Design', NOW)).resolves.toEqual([VENDOR]);
  });
});
