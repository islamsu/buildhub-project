/**
 * WHAT A VISITOR SEES, and - more to the point - what a visitor must NOT see.
 *
 * The booking engine has its own tests for what may be SOLD. These are about
 * what is RENDERED, which is a different question with different failure
 * modes: an expired advertiser still on the page, a suspended provider whose
 * paid slot outlived their account, a Tiles promotion appearing under Lighting.
 *
 * Every test here drives the real query builder against a fake driver that
 * records the SQL fragments it is handed, so a rule that is commented but not
 * compiled into the WHERE clause fails. Asserting on the returned rows alone
 * would pass just as happily against a query with no filter at all, because
 * the fake decides what rows come back.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { getDb } from './db';
import { products, users, vendorSponsorships } from '../drizzle/schema';
import {
  SURFACE_CAPACITY,
  livePlacementRows,
  masterProduct,
  masterProvider,
  placedProducts,
  placedProviders,
} from './publicPlacement';
import { GLOBAL_PLACEMENT_SCOPE, placementLabel } from '@shared/placement';

const NOW = new Date('2026-09-02T12:00:00.000Z');

/**
 * A fake driver that answers per TABLE and records every WHERE it is given.
 *
 * `whereSql` is the whole point: it lets a test assert that the eligibility
 * filter was actually applied, rather than that the fake happened to return an
 * eligible-looking row.
 */
function makeDb(tables: {
  placements?: Record<string, unknown>[];
  users?: Record<string, unknown>[];
  products?: Record<string, unknown>[];
  reviews?: Record<string, unknown>[];
  categories?: Record<string, unknown>[];
} = {}) {
  const whereSql: string[] = [];
  const render = (condition: unknown): string => {
    // drizzle conditions carry their fragments in `queryChunks`; rendering
    // them to text is enough to assert which columns took part.
    const seen: string[] = [];
    const walk = (node: any) => {
      if (node == null) return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node === 'string') { seen.push(node); return; }
      if (typeof node === 'object') {
        if (typeof node.name === 'string' && node.table) seen.push(node.name);
        // Bound parameters too: asserting only on column names would pass a
        // query that filters `category` against the wrong value.
        if (Array.isArray(node.value)) node.value.forEach((v: unknown) => {
          if (typeof v === 'string') seen.push(v);
        });
        for (const key of ['queryChunks', 'conditions', 'left', 'right', 'value']) {
          if (key in node) walk(node[key]);
        }
      }
    };
    walk(condition);
    return seen.join(',');
  };

  const chain = (rows: unknown[]) => {
    const c: any = {
      from: () => c,
      innerJoin: () => c,
      leftJoin: () => c,
      where: (condition: unknown) => { whereSql.push(render(condition)); return c; },
      orderBy: () => c,
      groupBy: () => c,
      limit: () => Promise.resolve(rows),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return c;
  };

  const db: any = {
    select: (_columns?: unknown) => ({
      from: (table: unknown) => {
        if (table === vendorSponsorships) return chain(tables.placements ?? []);
        if (table === users) return chain(tables.users ?? []);
        if (table === products) return chain(tables.products ?? []);
        return chain([]);
      },
    }),
  };
  // enrichVendorRows issues its own reviews/categories reads through the same
  // select(); they fall through to the empty chain above, which is correct -
  // a placed vendor with no reviews has no rating, not a zero.
  return { db, whereSql };
}

const placementRow = (over: Record<string, unknown> = {}) => ({
  placementId: 1,
  vendorId: 10,
  productId: null,
  entityType: 'PROVIDER',
  surface: 'MASTER_DISCOVERY',
  source: 'PAID_SPONSORSHIP',
  package: 'PREMIER',
  category: GLOBAL_PLACEMENT_SCOPE,
  priority: 0,
  ...over,
});

// ── The label rule ─────────────────────────────────────────────────────────

describe('a paid advertiser is never presented as an editorial choice', () => {
  it('only money buys the word Sponsored', () => {
    expect(placementLabel('PAID_SPONSORSHIP')).toBe('SPONSORED');
  });

  it('every unpaid source is Featured', () => {
    expect(placementLabel('ADMIN_EDITORIAL')).toBe('FEATURED');
    expect(placementLabel('REFERRAL_REWARD')).toBe('FEATURED');
    expect(placementLabel('PROMOTIONAL_COMP')).toBe('FEATURED');
  });

  it('an unknown or missing source is Featured, never Sponsored', () => {
    // Fail-safe direction: mislabelling an ad as editorial would be a lie to
    // the reader, so the default must not be the paid word.
    expect(placementLabel(null)).toBe('FEATURED');
    expect(placementLabel('SOMETHING_NEW')).toBe('FEATURED');
  });

  it('the label travels with the row the renderer receives', async () => {
    const { db } = makeDb({
      placements: [placementRow({ source: 'REFERRAL_REWARD' })],
      users: [{ id: 10, name: 'Nile Contracting' }],
    });
    const [placed] = await placedProviders({ db, surface: 'MASTER_DISCOVERY', category: GLOBAL_PLACEMENT_SCOPE, now: NOW });
    expect(placed.label).toBe('FEATURED');
  });
});

// ── Time ───────────────────────────────────────────────────────────────────

describe('eligibility is derived from the clock, never swept', () => {
  it('the live filter names revokedAt, startsAt and endsAt in the query itself', async () => {
    const { db, whereSql } = makeDb({ placements: [] });
    await livePlacementRows({ db, surface: 'MASTER_DISCOVERY', entityType: 'PROVIDER', category: 'Lighting', now: NOW });
    const where = whereSql.join(' | ');
    // Asserted against the compiled condition rather than the returned rows:
    // an empty result proves nothing about the filter that produced it.
    expect(where).toContain('revokedAt');
    expect(where).toContain('startsAt');
    expect(where).toContain('endsAt');
  });

  it('the surface and the entity type are both in the query', async () => {
    const { db, whereSql } = makeDb({ placements: [] });
    await livePlacementRows({ db, surface: 'TYPE_CATEGORY_SPOTLIGHT', entityType: 'PRODUCT', category: 'Lighting', now: NOW });
    expect(whereSql.join(' | ')).toContain('surface');
    expect(whereSql.join(' | ')).toContain('entityType');
  });
});

// ── Target eligibility: a placement buys a slot, not an exemption ──────────

describe('a placement never smuggles an ineligible entity onto the page', () => {
  it('a booked provider the directory filter drops does not render', async () => {
    // The placement row exists and is live. The users query returns nothing,
    // which is what the directory's visibility filter does to a suspended,
    // deactivated or unapproved account.
    const { db } = makeDb({ placements: [placementRow()], users: [] });
    const placed = await placedProviders({ db, surface: 'MASTER_DISCOVERY', category: GLOBAL_PLACEMENT_SCOPE, now: NOW });
    expect(placed).toEqual([]);
  });

  it('the provider fetch applies the directory visibility filter, not just the id list', async () => {
    const { db, whereSql } = makeDb({ placements: [placementRow()], users: [{ id: 10, name: 'Nile' }] });
    await placedProviders({ db, surface: 'MASTER_DISCOVERY', category: GLOBAL_PLACEMENT_SCOPE, now: NOW });
    const where = whereSql.join(' | ');
    expect(where).toContain('accountStatus');
    expect(where).toContain('onboardingStatus');
    expect(where).toContain('deactivatedAt');
  });

  it('the product fetch requires an active product AND an eligible supplier', async () => {
    // Two gates. Without the supplier join, a suspended seller keeps
    // advertising through rows that are still active = 1.
    const { db, whereSql } = makeDb({
      placements: [placementRow({ entityType: 'PRODUCT', vendorId: null, productId: 77 })],
      products: [{ id: 77, name: 'Rebar 12mm', supplierId: 10, supplierName: 'Nile' }],
    });
    await placedProducts({ db, surface: 'MASTER_DISCOVERY', category: GLOBAL_PLACEMENT_SCOPE, now: NOW });
    const where = whereSql.join(' | ');
    expect(where).toContain('active');
    expect(where).toContain('accountStatus');
    expect(where).toContain('onboardingStatus');
  });

  it('a booked product whose supplier is no longer eligible does not render', async () => {
    const { db } = makeDb({
      placements: [placementRow({ entityType: 'PRODUCT', vendorId: null, productId: 77 })],
      products: [],
    });
    expect(await placedProducts({ db, surface: 'MASTER_DISCOVERY', category: GLOBAL_PLACEMENT_SCOPE, now: NOW })).toEqual([]);
  });
});

// ── Scope ──────────────────────────────────────────────────────────────────

describe('paid visibility never defeats relevance', () => {
  it('the scope is matched exactly, and appears in the query', async () => {
    const { db, whereSql } = makeDb({ placements: [] });
    await livePlacementRows({ db, surface: 'TYPE_CATEGORY_SPOTLIGHT', entityType: 'PRODUCT', category: 'Lighting', now: NOW });
    expect(whereSql.join(' | ')).toContain('category');
  });

  it('the global slot asks for the GLOBAL scope, not for "any category"', async () => {
    const { db, whereSql } = makeDb({ placements: [] });
    vi.mocked(getDb).mockResolvedValue(db as never);
    await masterProvider(undefined, NOW);
    // The reserved token must reach the query as a BOUND VALUE. Without it,
    // five category Masters would all be candidates for one exclusive slot,
    // and something would have to choose between them arbitrarily - which is
    // not exclusivity, it is a lottery an advertiser paid for.
    expect(whereSql.join(' | ')).toContain(GLOBAL_PLACEMENT_SCOPE);
  });

  it('a category view asks for THAT category, not the global scope', async () => {
    const { db, whereSql } = makeDb({ placements: [] });
    vi.mocked(getDb).mockResolvedValue(db as never);
    await masterProvider('Lighting', NOW);
    const where = whereSql.join(' | ');
    expect(where).toContain('Lighting');
    // No wildcard and no fallback: a platform-wide placement must not leak
    // into a category view where its relevance was never established.
    expect(where).not.toContain(GLOBAL_PLACEMENT_SCOPE);
  });
});

// ── Capacity and order ─────────────────────────────────────────────────────

describe('the exclusive slot is exclusive, and order follows the booking', () => {
  it('Master capacity is one', () => {
    expect(SURFACE_CAPACITY.MASTER_DISCOVERY).toBe(1);
  });

  it('Spotlight capacity matches what the booking engine sells', () => {
    // If these ever diverge, oversold inventory truncates rather than
    // overflows - but they should not diverge, so it is asserted.
    expect(SURFACE_CAPACITY.TYPE_CATEGORY_SPOTLIGHT).toBe(3);
  });

  it('two live Master bookings still yield exactly one rendered provider', async () => {
    const { db } = makeDb({
      placements: [placementRow({ placementId: 1, vendorId: 10 }), placementRow({ placementId: 2, vendorId: 11 })],
      users: [{ id: 10, name: 'First' }, { id: 11, name: 'Second' }],
    });
    const placed = await placedProviders({ db, surface: 'MASTER_DISCOVERY', category: GLOBAL_PLACEMENT_SCOPE, now: NOW });
    expect(placed).toHaveLength(1);
    // The FIRST by the booking's own order, not whichever the driver returned
    // first - `inArray` makes no promise about row order.
    expect(placed[0].id).toBe(10);
  });

  it('one vendor holding two overlapping bookings appears once, not twice', async () => {
    const { db } = makeDb({
      placements: [placementRow({ placementId: 1, vendorId: 10 }), placementRow({ placementId: 2, vendorId: 10 })],
      users: [{ id: 10, name: 'Nile' }],
    });
    const placed = await placedProviders({
      db, surface: 'TYPE_CATEGORY_SPOTLIGHT', category: 'Lighting', now: NOW,
    });
    expect(placed).toHaveLength(1);
  });

  it('a malformed row with no entity id is skipped rather than rendered', async () => {
    const { db } = makeDb({ placements: [placementRow({ vendorId: null })], users: [{ id: 10 }] });
    expect(await placedProviders({ db, surface: 'MASTER_DISCOVERY', category: GLOBAL_PLACEMENT_SCOPE, now: NOW })).toEqual([]);
  });
});

// ── Emptiness is an answer ─────────────────────────────────────────────────

describe('nothing booked renders nothing', () => {
  it('masterProvider returns null rather than a substitute', async () => {
    const { db } = makeDb({ placements: [] });
    vi.mocked(getDb).mockResolvedValue(db as never);
    expect(await masterProvider(undefined, NOW)).toBeNull();
  });

  it('masterProduct returns null rather than a substitute', async () => {
    const { db } = makeDb({ placements: [] });
    vi.mocked(getDb).mockResolvedValue(db as never);
    expect(await masterProduct('Lighting', NOW)).toBeNull();
  });

  it('no database is not an excuse to invent an advertiser', async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    expect(await masterProvider(undefined, NOW)).toBeNull();
    expect(await masterProduct(undefined, NOW)).toBeNull();
  });
});

// ── The public payload ─────────────────────────────────────────────────────

describe('the public placement payload carries no commercial record', () => {
  it('a placed product exposes catalogue columns and nothing more', async () => {
    const { db } = makeDb({
      placements: [placementRow({ entityType: 'PRODUCT', vendorId: null, productId: 77 })],
      products: [{
        id: 77, supplierId: 10, name: 'Rebar 12mm', nameAr: null, category: 'Materials',
        brand: 'EZZ', origin: 'Egypt', price: '18500.00', currency: 'EGP', unit: 'tonne',
        images: null, supplierName: 'Nile Steel',
      }],
    });
    const [placed] = await placedProducts({ db, surface: 'MASTER_DISCOVERY', category: GLOBAL_PLACEMENT_SCOPE, now: NOW });
    // What a card needs, in order to be a real card about a real product.
    expect(placed.name).toBe('Rebar 12mm');
    expect(placed.supplierName).toBe('Nile Steel');
    expect(placed.label).toBe('SPONSORED');
    // What must never travel to an anonymous reader.
    for (const forbidden of ['grantedBy', 'grantedReason', 'revokedBy', 'startsAt', 'endsAt', 'priority', 'package']) {
      expect(placed).not.toHaveProperty(forbidden);
    }
  });
});
