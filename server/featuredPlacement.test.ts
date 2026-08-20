import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Slice 8 — featured placement.
 *
 * The first paid capability that changes what a customer sees, which makes it
 * the first one that can quietly corrupt the directory's meaning. Two rules
 * these tests exist to hold:
 *
 *   PAYING DOES NOT BUY ORGANIC POSITION. Phase 4B.3 §13. Featured placement is
 *   a separate labelled strip; the organic list below it is untouched, and
 *   featured vendors still appear there in their organic position.
 *
 *   PAYING DOES NOT BUY TRUST. "Sponsored" must never read as verified, rated,
 *   or endorsed. Those are earned, and the vendor cannot buy them.
 *
 * Eligibility is time-derived, like every other entitlement: a premium row whose
 * period ended last month buys nothing, however out of date the sweep is.
 */

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { getDb } from './db';
import {
  FEATURED_PLACEMENT_SLOTS, listFeaturedVendors, rotateFeatured,
} from './vendorDirectory';
import { ENTITLEMENT_ENFORCEMENT, PLANS, isEntitlementEnforced } from '@shared/billing';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const DIRECTORY_SOURCE = read('./vendorDirectory.ts');
const ROUTERS_SOURCE = read('./routers.ts');
const PAGE_SOURCE = read('../client/src/pages/VendorsDirectory.tsx');
const TRANSLATIONS = read('../client/src/contexts/LanguageContext.tsx');

const DAY = 86_400_000;

/** A subscription row shaped like the real table. */
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

/** One directory candidate: a user row joined to its subscription. */
function candidate(id: number, subscriptionOverrides: Record<string, unknown> = {}) {
  return {
    id, name: `Vendor ${id}`, bio: null, avatar: null, location: 'Cairo',
    userRole: 'contractor', verified: true, createdAt: new Date(),
    subscription: subscription({ userId: id, ...subscriptionOverrides }),
  };
}

/**
 * Stubs the two-stage query listFeaturedVendors runs: the candidate join first,
 * then the reputation and category lookups inside enrichVendorRows.
 */
function stubDb(candidates: unknown[]) {
  const db = {
    select: () => ({
      from: () => {
        // The candidate query is the one that joins vendorSubscriptions; the
        // reputation and category lookups inside enrichVendorRows do not. That
        // is what distinguishes them, and both must be chainable AND awaitable
        // because the real call sites end on different methods.
        let joined = false;
        const rows = () => (joined ? candidates : []);
        const builder: Record<string, unknown> = {
          innerJoin: () => { joined = true; return builder; },
          where: () => builder,
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

// ── §1 Only premium is eligible ────────────────────────────────────────────

describe('§1 which plans buy a slot', () => {
  it('only premium grants featuredPlacementEligible in the catalogue', () => {
    expect(PLANS.free.entitlements.featuredPlacementEligible).toBe(false);
    expect(PLANS.professional.entitlements.featuredPlacementEligible).toBe(false);
    expect(PLANS.premium.entitlements.featuredPlacementEligible).toBe(true);
  });

  it('a premium vendor is featured', async () => {
    stubDb([candidate(1)]);
    const featured = await listFeaturedVendors();
    expect(featured.map(v => v.id)).toEqual([1]);
  });

  it('a professional vendor is NOT featured, however active their subscription', async () => {
    stubDb([candidate(1, { plan: 'professional' })]);
    expect(await listFeaturedVendors()).toEqual([]);
  });

  it('a free vendor is not featured', async () => {
    stubDb([candidate(1, { plan: 'free', status: 'free' })]);
    expect(await listFeaturedVendors()).toEqual([]);
  });
});

// ── §2 Eligibility is time-derived, not read off the row ───────────────────

describe('§2 a stale row cannot buy a slot', () => {
  it('REGRESSION: a premium row whose period ended is NOT featured', async () => {
    // The row still says plan=premium, status=active. Only the clock says
    // otherwise. Reading `plan` directly would have featured this vendor
    // indefinitely, for free, until a sweep happened to run.
    stubDb([candidate(1, {
      currentPeriodEnd: new Date(Date.now() - 400 * DAY),
      cancelAtPeriodEnd: true,
    })]);
    expect(await listFeaturedVendors()).toEqual([]);
  });

  it('a premium vendor inside their grace period is still featured', async () => {
    // Grace exists precisely so a failed payment does not instantly strip
    // access the vendor has paid for.
    stubDb([candidate(1, {
      status: 'past_due',
      gracePeriodEndsAt: new Date(Date.now() + 3 * DAY),
    })]);
    expect((await listFeaturedVendors()).map(v => v.id)).toEqual([1]);
  });

  it('a premium vendor whose grace period expired is not featured', async () => {
    stubDb([candidate(1, {
      status: 'past_due',
      gracePeriodEndsAt: new Date(Date.now() - 3 * DAY),
    })]);
    expect(await listFeaturedVendors()).toEqual([]);
  });

  it('a vendor trialing on premium IS featured — the trial grants the plan', async () => {
    stubDb([candidate(1, {
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + 10 * DAY),
    })]);
    expect((await listFeaturedVendors()).map(v => v.id)).toEqual([1]);
  });

  it('a MALFORMED subscription fails closed to free and buys nothing', async () => {
    // status=trialing with no trialEndsAt is unreadable. deriveBillingState
    // returns FREE rather than guessing, and a slot must not be the one place
    // that guesses generously.
    stubDb([candidate(1, { status: 'trialing', trialEndsAt: null })]);
    expect(await listFeaturedVendors()).toEqual([]);
  });

  it('derives from deriveBillingState rather than reading the plan column', () => {
    const featured = DIRECTORY_SOURCE.slice(DIRECTORY_SOURCE.indexOf('export async function listFeaturedVendors'));
    expect(featured).toContain('deriveBillingState(row.subscription, now)');
    expect(featured).not.toMatch(/row\.subscription\.plan\b/);
  });

  it('returns nothing rather than throwing when the database is unavailable', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await listFeaturedVendors()).toEqual([]);
  });
});

// ── §3 The slots circulate ─────────────────────────────────────────────────

describe('§3 rotation is fair and stable', () => {
  const many = Array.from({ length: 20 }, (_unused, index) => ({ id: index + 1 }));

  it('returns everyone when there are fewer vendors than slots', () => {
    const few = [{ id: 3 }, { id: 1 }, { id: 2 }];
    expect(rotateFeatured(few, 6, new Date()).map(v => v.id)).toEqual([1, 2, 3]);
  });

  it('is stable within a day — the strip must not reshuffle while you read it', () => {
    const morning = new Date('2026-08-20T08:00:00Z');
    const evening = new Date('2026-08-20T22:00:00Z');
    expect(rotateFeatured(many, 6, morning)).toEqual(rotateFeatured(many, 6, evening));
  });

  it('changes from one day to the next', () => {
    const today = rotateFeatured(many, 6, new Date('2026-08-20T12:00:00Z')).map(v => v.id);
    const tomorrow = rotateFeatured(many, 6, new Date('2026-08-21T12:00:00Z')).map(v => v.id);
    expect(today).not.toEqual(tomorrow);
  });

  it('REGRESSION: the earliest subscriber cannot own the strip permanently', () => {
    // Without rotation, ordering by id would hand vendor 1 a slot every single
    // day and vendor 20 would pay premium for nothing.
    const appearances = new Map<number, number>();
    for (let day = 0; day < 40; day++) {
      const at = new Date(Date.UTC(2026, 0, 1) + day * DAY);
      for (const vendor of rotateFeatured(many, 6, at)) {
        appearances.set(vendor.id, (appearances.get(vendor.id) ?? 0) + 1);
      }
    }
    // Everyone gets a turn...
    expect(appearances.size).toBe(20);
    // ...and roughly the same number of them.
    const counts = Array.from(appearances.values());
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('always fills exactly the number of slots asked for', () => {
    expect(rotateFeatured(many, 6, new Date()).length).toBe(6);
    expect(new Set(rotateFeatured(many, 6, new Date()).map(v => v.id)).size).toBe(6);
  });

  it('never exceeds the declared slot count, even if a caller asks for more', async () => {
    stubDb(Array.from({ length: 20 }, (_unused, index) => candidate(index + 1)));
    const featured = await listFeaturedVendors({ limit: 100 });
    expect(featured.length).toBe(FEATURED_PLACEMENT_SLOTS);
  });
});

// ── §4 The organic list is untouched (Phase 4B.3 §13) ──────────────────────

describe('§4 paying does not buy organic position', () => {
  it('the organic query reads no billing state at all', () => {
    const organic = DIRECTORY_SOURCE.slice(
      DIRECTORY_SOURCE.indexOf('function directoryVisibilityFilter'),
      DIRECTORY_SOURCE.indexOf('async function enrichVendorRows'),
    );
    for (const forbidden of ['vendorSubscriptions', 'deriveBillingState', 'getEntitlements', 'PLANS']) {
      expect(organic, forbidden).not.toContain(forbidden);
    }
    expect(organic).toContain('.orderBy(desc(users.verified), desc(users.createdAt))');
  });

  it('featured placement does not touch the organic ordering', () => {
    const featured = DIRECTORY_SOURCE.slice(DIRECTORY_SOURCE.indexOf('export async function listFeaturedVendors'));
    expect(featured).not.toContain('orderBy(desc(users.verified)');
  });

  it('both lists compute reputation through the same helper', () => {
    // Two code paths computing reputation differently is how a vendor shows
    // 4.6 stars in the strip and 4.8 in the list below it.
    expect(DIRECTORY_SOURCE.match(/enrichVendorRows\(db,/g)?.length).toBe(2);
    expect(DIRECTORY_SOURCE.match(/eq\(reviews\.verified, true\)/g)?.length).toBe(1);
  });

  it('featured vendors are subject to the same visibility rules as everyone else', () => {
    // An unapproved, frozen, deactivated or dummy account must not become
    // discoverable by paying.
    const featured = DIRECTORY_SOURCE.slice(DIRECTORY_SOURCE.indexOf('export async function listFeaturedVendors'));
    expect(featured).toContain('directoryVisibilityFilter()');
  });

  it('the featured response uses the same column allowlist', () => {
    const featured = DIRECTORY_SOURCE.slice(DIRECTORY_SOURCE.indexOf('export async function listFeaturedVendors'));
    expect(featured).toContain('DIRECTORY_VENDOR_COLUMNS');
    expect(featured).not.toContain('select().from(users)');
  });

  it('the joined subscription row is stripped before the response is built', async () => {
    // The candidate query joins vendorSubscriptions, which carries provider
    // refs and billing state. None of it may reach a public directory response.
    stubDb([candidate(1)]);
    const [vendor] = await listFeaturedVendors();
    expect(vendor).not.toHaveProperty('subscription');
    expect(JSON.stringify(vendor)).not.toContain('providerCustomerRef');
  });
});

// ── §5 Exposure and labelling ──────────────────────────────────────────────

describe('§5 sponsored is labelled as sponsored', () => {
  it('is a separate endpoint from the organic directory', () => {
    expect(ROUTERS_SOURCE).toContain('featuredVendors: publicProcedure');
    const block = ROUTERS_SOURCE.slice(ROUTERS_SOURCE.indexOf('featuredVendors: publicProcedure'));
    expect(block.slice(0, 900)).toContain('sponsored: true as const');
  });

  it('the page renders featured vendors in their own section, not merged into the grid', () => {
    expect(PAGE_SOURCE).toContain("t('vendorsDir.sponsoredSection')");
    expect(PAGE_SOURCE).toContain('featured.map(vendor => (');
    expect(PAGE_SOURCE).toContain('vendors.map(vendor => (');
  });

  it('the sponsored badge is distinct from the verified badge', () => {
    // Same component renders both lists, so the ONLY difference is the label.
    expect(PAGE_SOURCE).toContain("{t('vendorsDir.sponsored')}");
    expect(PAGE_SOURCE).toContain("{t('common.verified')}");
    expect(PAGE_SOURCE).toContain('sponsored && (');
  });

  it('the wording never implies verification, endorsement or a better rating', () => {
    const keys = ['vendorsDir.sponsored', 'vendorsDir.sponsoredSection', 'vendorsDir.sponsoredNote'];
    for (const key of keys) {
      expect(TRANSLATIONS.split(`'${key}':`).length - 1, `${key} in EN and AR`).toBe(2);
    }
    const english = TRANSLATIONS.slice(
      TRANSLATIONS.indexOf("'vendorsDir.sponsored':"),
      TRANSLATIONS.indexOf("'vendorsDir.sponsoredNote':") + 200,
    ).toLowerCase();
    for (const forbidden of ['verified', 'trusted', 'recommended', 'best', 'top-rated', 'endorsed']) {
      expect(english, forbidden).not.toContain(forbidden);
    }
    expect(english).toContain('sponsored');
  });

  it('tells the customer plainly that the placement was paid for', () => {
    const note = TRANSLATIONS.slice(TRANSLATIONS.indexOf("'vendorsDir.sponsoredNote':"));
    expect(note.slice(0, 200).toLowerCase()).toContain('paid');
  });
});

// ── §6 The honesty ledger ──────────────────────────────────────────────────

describe('§6 the ledger matches reality', () => {
  it('featuredPlacementEligible is now marked enforced, because it is', () => {
    expect(ENTITLEMENT_ENFORCEMENT.featuredPlacementEligible).toBe('slice-8');
    expect(isEntitlementEnforced('featuredPlacementEligible')).toBe(true);
  });

  it('visibilityLevel is still NOT enforced — it would buy organic position', () => {
    expect(isEntitlementEnforced('visibilityLevel')).toBe(false);
    expect(ENTITLEMENT_ENFORCEMENT.visibilityLevel).toContain('organic');
  });

  it('availability is an allowlist, so an unknown marker fails closed', () => {
    expect(isEntitlementEnforced('portfolioLevel')).toBe(false);
    expect(isEntitlementEnforced('promotionalCapability')).toBe(false);
    expect(isEntitlementEnforced('branchLimit')).toBe(false);
  });

  it('the vendor capability surface picks the change up automatically', () => {
    // featured_placement is derived from the ledger, not a second hand-kept list.
    const entitlements = read('./billing/entitlements.ts');
    expect(entitlements).toContain('featured_placement');
    expect(entitlements).toContain('enforcementKey');
  });
});
