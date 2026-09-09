/**
 * ── THE TWO PUBLIC PLACEMENT READERS ──────────────────────────────────────
 *
 * OWNER DECISION, and the reason this file exists: BuildHub has exactly TWO
 * public placement concepts, and they are not interchangeable.
 *
 *   FEATURED   editorial. BuildHub chose this provider. It cannot be bought.
 *   SPONSORED  commercial. Either a plan entitlement or an administrator's
 *              grant. It says nothing about quality.
 *
 * There used to be a third public reader, `marketplace.featuredVendors`, which
 * returned the Premium entitlement rotation under BuildHub's editorial word.
 * Three competing strips for two concepts is how a paid slot ends up wearing
 * the label a curated pick earned, so the owner retired it.
 *
 * THIS FILE IS THE GUARD ON THAT DECISION. It does not merely record that a
 * procedure was deleted - a deletion test passes forever and proves nothing
 * about what replaced it. It holds the whole shape: both survivors exist and
 * mean what they say, the commercial reader still returns BOTH routes to a
 * paid slot, a suspended vendor cannot buy past the directory's filter, a
 * vendor holding both a grant and a plan appears once, and the organic list is
 * untouched by any of it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { getDb } from './db';
import { listFeaturedProviders, listSponsoredVendors } from './vendorDirectory';
import { users, vendorSponsorships, reviews, vendorCategories } from '../drizzle/schema';
import { stripComments } from './_testing/sourceText';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const ROUTERS = read('./routers.ts');
const DIRECTORY = read('./vendorDirectory.ts');
const REACHABILITY = read('./reachability.ts');

/**
 * CODE, WITH THE PROSE TAKEN OUT.
 *
 * This codebase documents the defects it fixed, at length and by name. Two of
 * the assertions below say a retired identifier appears nowhere - and both
 * failed on first run against the comments explaining that it was retired. An
 * `not.toContain` that matches its own explanation is not a stricter test, it
 * is a broken one. Every absence assertion here reads code only.
 */
const ROUTERS_CODE = stripComments(ROUTERS);
const DIRECTORY_CODE = stripComments(DIRECTORY);
const REACHABILITY_CODE = stripComments(REACHABILITY);

const DAY = 86_400_000;

function subscription(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: 1, userId: 100, plan: 'premium', status: 'active', billingInterval: 'month',
    currency: 'EGP', priceAmount: null, isFounderPrice: false,
    founderPriceUsedAt: null, founderPriceEndsAt: null,
    trialStartedAt: null, trialEndsAt: null,
    currentPeriodStart: new Date(now - 5 * DAY), currentPeriodEnd: new Date(now + 25 * DAY),
    cancelAtPeriodEnd: false, canceledAt: null, gracePeriodEndsAt: null,
    provider: null, providerCustomerRef: null, providerSubscriptionRef: null, providerPriceRef: null,
    createdAt: new Date(now - 30 * DAY), updatedAt: new Date(now),
    ...overrides,
  };
}

function vendorRow(id: number) {
  return {
    id, name: `Vendor ${id}`, bio: null, avatar: null, location: 'Cairo',
    userRole: 'contractor', verified: true, createdAt: new Date(),
  };
}

/** A user row joined to its subscription, as the entitlement candidate query returns it. */
function candidate(id: number, subscriptionOverrides: Record<string, unknown> = {}) {
  return { ...vendorRow(id), subscription: subscription({ userId: id, ...subscriptionOverrides }) };
}

/**
 * A stub that DISPATCHES ON THE TABLE, because these readers issue four
 * different queries and a stub that returns one list for all of them would
 * make every assertion below vacuous.
 *
 * `from(users)` is deliberately ambiguous in the real code - the entitlement
 * candidate query and the granted-vendor lookup both read it - so they are
 * told apart the same way the real queries differ: only the entitlement query
 * joins vendorSubscriptions.
 */
function stubDb(world: {
  /** Vendor ids with a LIVE admin grant in the queried category. */
  grantedIds?: number[];
  /** Vendor rows the directory's visibility filter actually lets through. */
  visible?: ReturnType<typeof vendorRow>[];
  /** Candidates for the entitlement rotation, pre-visibility-filtered. */
  candidates?: ReturnType<typeof candidate>[];
}) {
  const db = {
    select: () => ({
      from: (table: unknown) => {
        let joined = false;
        const rows = () => {
          if (table === vendorSponsorships) {
            return (world.grantedIds ?? []).map(vendorId => ({ vendorId }));
          }
          if (table === users) {
            return joined ? (world.candidates ?? []) : (world.visible ?? []);
          }
          // enrichVendorRows: no reputation and no categories seeded. Both are
          // additive, and neither can change WHICH vendors appear.
          if (table === reviews || table === vendorCategories) return [];
          throw new Error(`unstubbed table in query: ${String(table)}`);
        };
        const builder: Record<string, unknown> = {
          innerJoin: () => { joined = true; return builder; },
          leftJoin: () => builder,
          where: () => builder,
          orderBy: () => builder,
          limit: () => builder,
          groupBy: () => Promise.resolve(rows()),
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(rows()).then(resolve, reject),
        };
        return builder;
      },
    }),
  };
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
}

beforeEach(() => vi.clearAllMocks());

// ── The public architecture ───────────────────────────────────────────────

describe('the public placement architecture is exactly two readers', () => {
  it('featuredProviders exists and is the EDITORIAL reader', () => {
    expect(ROUTERS).toContain('featuredProviders: publicProcedure');
    const block = ROUTERS.slice(ROUTERS.indexOf('featuredProviders: publicProcedure'), ROUTERS.indexOf('featuredProviders: publicProcedure') + 400);
    expect(block).toContain('listFeaturedProviders');
    // It reads editorial rows and nothing else. `kind = 'featured'` is the
    // whole distinction; without it the editorial reader would return paid
    // grants under BuildHub's own word.
    const fn = DIRECTORY_CODE.slice(DIRECTORY_CODE.indexOf('export async function listFeaturedProviders'));
    expect(fn.slice(0, 900)).toContain("eq(vendorSponsorships.kind, 'featured')");
  });

  it('sponsoredVendors exists and is the COMMERCIAL reader', () => {
    expect(ROUTERS).toContain('sponsoredVendors: publicProcedure');
    const fn = DIRECTORY_CODE.slice(DIRECTORY_CODE.indexOf('export async function listSponsoredVendors'));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    // Both commercial routes, and only commercial routes.
    expect(body).toContain('sponsoredVendorIds(');
    expect(body).toContain('listEntitlementSponsoredVendors(');
    expect(body).not.toContain('listFeaturedProviders(');
  });

  it('the redundant public featuredVendors reader no longer exists', () => {
    // The retired procedure, asserted absent by the exact string a tRPC
    // definition would have to use.
    expect(ROUTERS_CODE).not.toContain('featuredVendors: publicProcedure');
    // ...and it is not hiding behind a different procedure builder either.
    expect(ROUTERS_CODE).not.toMatch(/\bfeaturedVendors:\s*\w*[Pp]rocedure/);
  });

  it('it is gone because it was REMOVED, not because it was allowlisted', () => {
    // A retired procedure that reappears on the "uncalled by design" list is
    // the same defect wearing a different hat: still shipped, still public,
    // still a third strip - just no longer counted.
    expect(REACHABILITY_CODE).not.toContain("procedure: 'marketplace.featuredVendors'");
  });

  it('the entitlement helper survives as INTERNAL commercial logic', () => {
    // Retiring the public reader must not have deleted the working
    // entitlement calculation underneath it.
    expect(DIRECTORY_CODE).toContain('export async function listEntitlementSponsoredVendors');
    // Internal means internal: the router neither imports it nor re-exports it
    // as a public reader under a new name.
    expect(ROUTERS_CODE).not.toContain('listEntitlementSponsoredVendors');
  });

  it('no source still calls plan-bought placement "featured"', () => {
    // The name was the documentation, and it said the wrong thing for most of
    // this project's life.
    expect(DIRECTORY_CODE).not.toContain('listFeaturedVendors');
  });
});

// ── What the commercial reader actually returns ───────────────────────────

describe('sponsoredVendors returns both commercial routes', () => {
  it('includes a vendor whose PLAN entitles them to a slot', async () => {
    stubDb({ candidates: [candidate(7)] });
    const rows = await listSponsoredVendors({ category: 'Plumbing' });
    expect(rows.map(r => r.id)).toEqual([7]);
    expect(rows[0].sponsorshipSource).toBe('entitlement');
  });

  it("includes a vendor an ADMINISTRATOR granted a slot", async () => {
    stubDb({ grantedIds: [3], visible: [vendorRow(3)] });
    const rows = await listSponsoredVendors({ category: 'Plumbing' });
    expect(rows.map(r => r.id)).toEqual([3]);
    expect(rows[0].sponsorshipSource).toBe('granted');
  });

  it('puts the deliberate admin grant BEFORE the rotating entitlement', async () => {
    stubDb({ grantedIds: [3], visible: [vendorRow(3)], candidates: [candidate(7)] });
    const rows = await listSponsoredVendors({ category: 'Plumbing' });
    expect(rows.map(r => r.id)).toEqual([3, 7]);
  });

  it('a vendor holding BOTH a grant and a plan appears ONCE, as granted', async () => {
    // Two cards for one firm reads as two firms, and the more specific fact -
    // somebody chose them for this category - is the truthful label.
    stubDb({ grantedIds: [5], visible: [vendorRow(5)], candidates: [candidate(5)] });
    const rows = await listSponsoredVendors({ category: 'Plumbing' });
    expect(rows.map(r => r.id)).toEqual([5]);
    expect(rows[0].sponsorshipSource).toBe('granted');
  });

  it('a grant whose vendor the visibility filter rejects yields an empty strip', async () => {
    // Suspended, deactivated, unapproved or dummy: the grant row still exists,
    // and the vendor still does not. Sponsorship buys a slot, never an
    // exemption - so the id resolves to nothing and the strip stays empty
    // rather than falling back to showing the vendor anyway.
    stubDb({ grantedIds: [9], visible: [] });
    expect(await listSponsoredVendors({ category: 'Plumbing' })).toEqual([]);
  });

  it('EVERY directory reader applies the visibility filter, not just this one', () => {
    // WHY THIS IS A SOURCE CHECK AND THE ONE ABOVE IS NOT.
    //
    // The test above was mutation-tested by deleting `directoryVisibilityFilter()`
    // from the granted-vendor lookup, and it SURVIVED. It had to: the fake
    // above cannot execute a WHERE clause, so it returns the rows it was
    // handed whether or not the query filtered them. A behavioural assertion
    // against a fake cannot see a dropped filter, and reporting it as coverage
    // would be reporting a pass that proves nothing.
    //
    // So the filter is held structurally, and held for the CLASS rather than
    // this instance: every query in the directory that returns the public
    // vendor card must resolve it through the same visibility rule. A fourth
    // reader added later without one fails here on the day it is written.
    // Scoped to the enclosing exported function, not to the statement: the
    // organic list legitimately seeds `conditions` with the filter twenty
    // lines above its own where(), and a statement-width window would call
    // that a violation. The unit that must contain the filter is the reader.
    const bounds = [...DIRECTORY_CODE.matchAll(/\nexport (?:async )?function (\w+)/g)];
    const readers = bounds
      .map((match, index) => ({
        name: match[1],
        body: DIRECTORY_CODE.slice(
          match.index!,
          index + 1 < bounds.length ? bounds[index + 1].index! : undefined,
        ),
      }))
      .filter(fn => fn.body.includes('DIRECTORY_VENDOR_COLUMNS') && fn.body.includes('.from(users)'));

    expect(readers.map(r => r.name).sort(), 'the reader census changed - review it, do not widen it')
      .toEqual(['listDirectoryVendors', 'listEntitlementSponsoredVendors', 'listFeaturedProviders', 'listSponsoredVendors']);
    for (const reader of readers) {
      expect(reader.body, `${reader.name} returns public vendor cards without the visibility filter`)
        .toContain('directoryVisibilityFilter()');
    }
  });

  it('an ENTITLED vendor whose period has ended does not appear', async () => {
    const ended = { currentPeriodEnd: new Date(Date.now() - DAY), status: 'canceled' };
    stubDb({ candidates: [candidate(7, ended)] });
    expect(await listSponsoredVendors({ category: 'Plumbing' })).toEqual([]);
  });

  it('with no category chosen there are no admin grants, only entitlement', async () => {
    // A grant is scoped to one category, so there is no such thing as an
    // uncategorised granted slot. Reading one would be inventing it.
    stubDb({ grantedIds: [3], visible: [vendorRow(3)], candidates: [candidate(7)] });
    const rows = await listSponsoredVendors({});
    expect(rows.map(r => r.id)).toEqual([7]);
    expect(rows[0].sponsorshipSource).toBe('entitlement');
  });

  it('nothing sponsored returns an empty list, never filler', async () => {
    stubDb({});
    expect(await listSponsoredVendors({ category: 'Plumbing' })).toEqual([]);
  });
});

// ── What the editorial reader actually returns ────────────────────────────

describe('featuredProviders returns editorial picks only', () => {
  it('returns the curated provider with the category it was picked in', async () => {
    stubDb({ grantedIds: [], visible: [vendorRow(4)] });
    // The editorial query reads vendorSponsorships directly rather than
    // through sponsoredVendorIds, so it is stubbed by the same table branch.
    const db = {
      select: () => ({
        from: (table: unknown) => {
          const rows = () => {
            if (table === vendorSponsorships) return [{ vendorId: 4, category: 'Design' }];
            if (table === users) return [vendorRow(4)];
            return [];
          };
          const builder: Record<string, unknown> = {
            where: () => builder,
            orderBy: () => builder,
            groupBy: () => Promise.resolve(rows()),
            then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
              Promise.resolve(rows()).then(resolve, reject),
          };
          return builder;
        },
      }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const rows = await listFeaturedProviders({ category: 'Design' });
    expect(rows.map(r => r.id)).toEqual([4]);
    expect(rows[0].featuredCategory).toBe('Design');
    // An editorial row carries NO commercial source field. If it ever did, the
    // two concepts would be one field away from being rendered identically.
    expect(rows[0]).not.toHaveProperty('sponsorshipSource');
  });

  it('applies the directory visibility filter to editorial picks too', () => {
    const fn = DIRECTORY_CODE.slice(DIRECTORY_CODE.indexOf('export async function listFeaturedProviders'));
    expect(fn.slice(0, 1400)).toContain('directoryVisibilityFilter()');
  });
});

// ── The labels, and the organic list underneath them ──────────────────────

describe('Featured and Sponsored stay separately labelled', () => {
  const PAGE = stripComments(read('../client/src/pages/VendorsDirectory.tsx'));

  it('the directory fetches the two readers separately and renders two sections', () => {
    expect(PAGE).toContain('trpc.marketplace.featuredProviders.useQuery');
    expect(PAGE).toContain('trpc.marketplace.sponsoredVendors.useQuery');
    expect(PAGE).toContain("t('market.featured')");
    expect(PAGE).toContain("t('vendorsDir.sponsoredSection')");
  });

  it('editorial is rendered ABOVE sponsored, which is above the organic grid', () => {
    // Owner requirement: FEATURED -> SPONSORED -> ORGANIC. Featured is never
    // buried below organic results.
    const editorial = PAGE.indexOf('editorialFeatured.map(vendor => (');
    const sponsored = PAGE.indexOf('featured.map(vendor => (');
    const organic = PAGE.indexOf('vendors.map(vendor => (');
    expect(editorial).toBeGreaterThan(-1);
    expect(sponsored).toBeGreaterThan(-1);
    expect(organic).toBeGreaterThan(-1);
    expect(editorial).toBeLessThan(sponsored);
    expect(sponsored).toBeLessThan(organic);
  });

  it('the two sections never share one list or one label', () => {
    // A single merged array would make the labels decorative.
    expect(PAGE).not.toContain('[...editorialFeatured, ...featured]');
    expect(PAGE).not.toContain('editorialFeatured.concat(featured)');
  });

  it('commercial placement does not touch organic ordering', () => {
    // The organic list is its own query with its own ordering, and neither
    // commercial reader is an input to it.
    expect(PAGE).toContain('trpc.marketplace.vendors.useQuery');
    const organicFn = DIRECTORY_CODE.slice(DIRECTORY_CODE.indexOf('export async function listDirectoryVendors'));
    const body = organicFn.slice(0, organicFn.indexOf('\nexport '));
    expect(body).not.toContain('vendorSponsorships');
    expect(body).not.toContain('listEntitlementSponsoredVendors');
  });
});
