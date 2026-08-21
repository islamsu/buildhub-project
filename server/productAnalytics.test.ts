import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Slice 7 — product analytics and commercial KPIs.
 *
 * BuildHub had no event stream at all. Every business metric was an ad-hoc SQL
 * aggregate over whatever timestamp column happened to be nearby, which can
 * answer "how many" but never "how many got from here to there".
 *
 * Two boundaries are what these tests mostly exist to hold:
 *
 *   ANALYTICS MUST NEVER BREAK THE PRODUCT. A recording failure cannot be
 *   allowed to fail a signup or a quotation.
 *
 *   MONEY IS NOT COMPUTED FROM A LOG. MRR comes from vendorSubscriptions and
 *   shared/billing.ts. An event stream may drop a write; an owner reporting
 *   revenue cannot be working from something that is allowed to be lossy.
 */

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { getDb } from './db';
import { recordEvent, sanitizeMetadata } from './analytics/events';
import { getChurn, getCommercialKpis, monthlyRevenueOf } from './analytics/kpis';
import { analyticsEventFor } from './billing/service';
import {
  ANALYTICS_EVENTS, ANALYTICS_EVENT_TYPES, VENDOR_FUNNEL, isAnalyticsEventType,
} from '@shared/analyticsEvents';
import { PLANS, resolvePrice } from '@shared/billing';
import {
  billingEvents as billingEventsTable,
  users as usersTable,
  vendorSubscriptions as vendorSubscriptionsTable,
} from '../drizzle/schema';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const EVENTS_SOURCE = read('./analytics/events.ts');
const KPIS_SOURCE = read('./analytics/kpis.ts');
const CATALOGUE_SOURCE = read('../shared/analyticsEvents.ts');
const SERVICE_SOURCE = read('./billing/service.ts');
const ROUTERS_SOURCE = read('./routers.ts');

function stubDb(options: { subscriptions?: unknown[]; dummyIds?: number[]; billingEvents?: unknown[] } = {}) {
  const inserted: Record<string, unknown>[] = [];

  // Tables are identified by reference, the same way the Phase 4B.3 harness
  // does it. Reading a name off the drizzle object is undocumented internals
  // and silently returns undefined, which routes every query to the wrong rows.
  const rowsFor = (table: unknown): unknown[] => {
    if (table === usersTable) return (options.dummyIds ?? []).map(id => ({ id }));
    if (table === billingEventsTable) return options.billingEvents ?? [];
    if (table === vendorSubscriptionsTable) return options.subscriptions ?? [];
    return [];
  };

  const db = {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        inserted.push(row);
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: (table: unknown) => {
        const rows = rowsFor(table);
        const promise = Promise.resolve(rows);
        // Some call sites await the builder directly (no .where), others chain
        // .where and .groupBy. Every shape resolves to the same rows.
        const builder: Record<string, unknown> = {
          where: () => builder,
          groupBy: () => promise,
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            promise.then(resolve, reject),
        };
        return builder;
      },
    }),
  };
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
  return { inserted };
}

/** A subscription row shaped like the real table. */
function subscription(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: 1,
    userId: 100,
    plan: 'professional',
    status: 'active',
    billingInterval: 'month',
    currency: 'EGP',
    priceAmount: null,
    isFounderPrice: false,
    founderPriceUsedAt: null,
    founderPriceEndsAt: null,
    trialStartedAt: null,
    trialEndsAt: null,
    currentPeriodStart: new Date(now - 5 * 86_400_000),
    currentPeriodEnd: new Date(now + 25 * 86_400_000),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    gracePeriodEndsAt: null,
    provider: null,
    providerCustomerRef: null,
    providerSubscriptionRef: null,
    providerPriceRef: null,
    createdAt: new Date(now - 30 * 86_400_000),
    updatedAt: new Date(now),
    ...overrides,
  } as never;
}

beforeEach(() => vi.clearAllMocks());

// ── §1 The catalogue is closed ─────────────────────────────────────────────

describe('§1 the event catalogue', () => {
  it('every funnel stage names a real event', () => {
    for (const { event } of VENDOR_FUNNEL) {
      expect(isAnalyticsEventType(event)).toBe(true);
    }
  });

  it('rejects an event name that is not in the catalogue', () => {
    expect(isAnalyticsEventType('user.did_something_undefined')).toBe(false);
    expect(isAnalyticsEventType(42)).toBe(false);
  });

  it('covers the whole lifecycle the funnel reports on, end to end', () => {
    // Registration through subscription, which is the sequence that shows the
    // owner where the business is losing people.
    for (const required of [
      ANALYTICS_EVENTS.USER_REGISTERED,
      ANALYTICS_EVENTS.VENDOR_VERIFIED,
      ANALYTICS_EVENTS.ENQUIRY_OPENED,
      ANALYTICS_EVENTS.QUOTATION_SUBMITTED,
      ANALYTICS_EVENTS.SUBSCRIPTION_TRIAL_STARTED,
      ANALYTICS_EVENTS.SUBSCRIPTION_ACTIVATED,
      ANALYTICS_EVENTS.SUBSCRIPTION_LAPSED,
    ]) {
      expect(ANALYTICS_EVENT_TYPES).toContain(required);
    }
  });

  it('names are unique — two stages sharing an event would silently merge', () => {
    expect(new Set(ANALYTICS_EVENT_TYPES).size).toBe(ANALYTICS_EVENT_TYPES.length);
  });

  it('states in the file itself that events are not the money record', () => {
    expect(CATALOGUE_SOURCE).toMatch(/NO EVENT IS A MONEY RECORD/);
  });
});

// ── §2 Recording never harms the request it describes ──────────────────────

describe('§2 recordEvent is safe by construction', () => {
  it('does not throw when the database is unavailable', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(recordEvent({ type: ANALYTICS_EVENTS.USER_REGISTERED, userId: 1 })).resolves.toBeUndefined();
  });

  it('does not throw when the insert itself fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
      insert: () => ({ values: () => Promise.reject(new Error('table analyticsEvents does not exist')) }),
    });
    await expect(recordEvent({ type: ANALYTICS_EVENTS.USER_REGISTERED, userId: 1 })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('writes the event with its subject and plan', async () => {
    const { inserted } = stubDb();
    await recordEvent({
      type: ANALYTICS_EVENTS.ENQUIRY_OPENED,
      userId: 7, subjectType: 'rfq', subjectId: 42, plan: 'professional',
    });
    expect(inserted[0]).toMatchObject({
      eventType: 'enquiry.opened', userId: 7, subjectType: 'rfq', subjectId: 42, plan: 'professional',
    });
  });

  it('call sites use the fire-and-forget wrapper, so analytics adds no latency', () => {
    expect(ROUTERS_SOURCE).toContain('recordEventAsync(');
    expect(EVENTS_SOURCE).toContain('export function recordEventAsync');
    expect(EVENTS_SOURCE).toContain('void recordEvent(input)');
  });
});

// ── §3 No credential or identity reaches the event stream ──────────────────

describe('§3 metadata sanitisation', () => {
  it('drops anything whose key names a credential', () => {
    const clean = sanitizeMetadata({ password: 'hunter2', token: 'abc', apiKey: 'k', plan: 'premium' });
    expect(clean).toBe(JSON.stringify({ plan: 'premium' }));
  });

  it('drops anything whose key names an identity', () => {
    const clean = sanitizeMetadata({ email: 'a@b.c', phone: '0100', openId: 'x', role: 'contractor' });
    expect(clean).toBe(JSON.stringify({ role: 'contractor' }));
  });

  it('is not fooled by casing or punctuation in the key', () => {
    for (const key of ['Password', 'PASSWORD_HASH', 'user-email', 'session_id', 'Authorization']) {
      expect(sanitizeMetadata({ [key]: 'sensitive' })).toBeNull();
    }
  });

  it('drops nested objects entirely — nesting is how a whole user row gets in', () => {
    expect(sanitizeMetadata({ user: { id: 1, email: 'a@b.c' } })).toBeNull();
    expect(sanitizeMetadata({ items: ['a', 'b'] })).toBeNull();
  });

  it('keeps small scalar facts', () => {
    const clean = JSON.parse(sanitizeMetadata({ category: 'Materials', count: 3, founder: true }) ?? '{}');
    expect(clean).toEqual({ category: 'Materials', count: 3, founder: true });
  });

  it('truncates a long value rather than storing an essay', () => {
    const clean = JSON.parse(sanitizeMetadata({ note: 'x'.repeat(500) }) ?? '{}');
    expect(clean.note.length).toBeLessThanOrEqual(120);
  });

  it('bounds the number of keys', () => {
    const wide = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(JSON.parse(sanitizeMetadata(wide) ?? '{}')).length).toBeLessThanOrEqual(12);
  });

  it('a sanitised event actually stores the filtered form, not the original', async () => {
    const { inserted } = stubDb();
    await recordEvent({
      type: ANALYTICS_EVENTS.USER_REGISTERED,
      userId: 1,
      metadata: { role: 'contractor', password: 'hunter2', email: 'vendor@example.com' },
    });
    const stored = String(inserted[0].metadata);
    expect(stored).toContain('contractor');
    expect(stored).not.toContain('hunter2');
    expect(stored).not.toContain('vendor@example.com');
  });
});

// ── §4 Revenue comes from the financial record ─────────────────────────────

describe('§4 MRR is priced from the catalogue, never hardcoded', () => {
  it('a monthly professional subscription contributes its catalogue price', () => {
    const expected = resolvePrice('professional', 'month', false);
    expect(monthlyRevenueOf(subscription())).toBe(expected);
    expect(expected).toBe(PLANS.professional.standard.month);
  });

  it('an annual subscription is spread across twelve months', () => {
    const annual = resolvePrice('premium', 'year', false)!;
    const row = subscription({ plan: 'premium', billingInterval: 'year' });
    expect(monthlyRevenueOf(row)).toBeCloseTo(annual / 12, 6);
  });

  it('founder pricing is applied when it is active', () => {
    const row = subscription({
      isFounderPrice: true,
      founderPriceEndsAt: new Date(Date.now() + 60 * 86_400_000),
    });
    expect(monthlyRevenueOf(row)).toBe(resolvePrice('professional', 'month', true));
  });

  it('a trial contributes nothing — the most common way a business lies to itself', () => {
    const row = subscription({
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + 10 * 86_400_000),
    });
    expect(monthlyRevenueOf(row)).toBe(0);
  });

  it('a lapsed subscription contributes nothing even while its row still says active', () => {
    // The lifecycle sweep may not have run yet. Revenue is time-derived, so a
    // late sweep can never inflate MRR.
    const row = subscription({
      currentPeriodEnd: new Date(Date.now() - 365 * 86_400_000),
      cancelAtPeriodEnd: true,
    });
    expect(monthlyRevenueOf(row)).toBe(0);
  });

  it('a free subscription contributes nothing', () => {
    expect(monthlyRevenueOf(subscription({ plan: 'free', status: 'free' }))).toBe(0);
  });

  it('a malformed row contributes nothing rather than a guess', () => {
    const row = subscription({ status: 'trialing', trialEndsAt: null });
    expect(monthlyRevenueOf(row)).toBe(0);
  });

  it('no price literal appears anywhere in the KPI module', () => {
    const code = KPIS_SOURCE.split('\n').filter(line => !line.trim().startsWith('*') && !line.trim().startsWith('//')).join('\n');
    for (const price of ['499', '999', '4990', '9990', '299', '699']) {
      expect(code).not.toContain(price);
    }
    expect(code).toContain('resolvePrice(');
  });

  it('the KPI module reads subscriptions, not the event stream', () => {
    expect(KPIS_SOURCE).toContain('vendorSubscriptions');
    const code = KPIS_SOURCE.split('\n').filter(line => !line.trim().startsWith('*') && !line.trim().startsWith('//')).join('\n');
    expect(code).not.toContain('analyticsEvents');
  });
});

describe('§4b the aggregate', () => {
  it('sums MRR across paying vendors and reports ARR as twelve times it', async () => {
    stubDb({ subscriptions: [subscription({ userId: 1 }), subscription({ userId: 2, id: 2 })] });
    const kpis = await getCommercialKpis();
    const monthly = resolvePrice('professional', 'month', false)!;
    expect(kpis.payingVendors).toBe(2);
    expect(kpis.mrr).toBe(monthly * 2);
    expect(kpis.arr).toBe(monthly * 24);
  });

  it('reports ARPV as null with no paying vendors, never 0', async () => {
    stubDb({ subscriptions: [] });
    const kpis = await getCommercialKpis();
    expect(kpis.arpv).toBeNull();
    expect(kpis.mrr).toBe(0);
  });

  it('counts trials separately from paying vendors', async () => {
    stubDb({
      subscriptions: [
        subscription({ userId: 1 }),
        subscription({ userId: 2, id: 2, status: 'trialing', trialEndsAt: new Date(Date.now() + 5 * 86_400_000) }),
      ],
    });
    const kpis = await getCommercialKpis();
    expect(kpis.payingVendors).toBe(1);
    expect(kpis.trialingVendors).toBe(1);
    expect(kpis.mrr).toBe(resolvePrice('professional', 'month', false));
  });

  it('surfaces malformed rows rather than hiding them', async () => {
    stubDb({ subscriptions: [subscription({ status: 'trialing', trialEndsAt: null })] });
    const kpis = await getCommercialKpis();
    expect(kpis.dataIntegrityIssues).toBe(1);
  });

  it('excludes dummy accounts, which would otherwise inflate the owner\'s own numbers', async () => {
    stubDb({ subscriptions: [subscription({ userId: 100 })], dummyIds: [100] });
    const kpis = await getCommercialKpis();
    expect(kpis.payingVendors).toBe(0);
    expect(kpis.mrr).toBe(0);
  });

  it('returns a zeroed shape when the database is unavailable rather than throwing', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const kpis = await getCommercialKpis();
    expect(kpis.mrr).toBe(0);
    expect(kpis.arpv).toBeNull();
    expect(kpis.byPlan).toHaveLength(3);
  });
});

// ── §5 Churn ───────────────────────────────────────────────────────────────

describe('§5 churn', () => {
  const from = new Date(Date.now() - 30 * 86_400_000);
  const to = new Date();

  it('counts a paid subscription that ended', async () => {
    stubDb({
      subscriptions: [subscription({ userId: 1 })],
      billingEvents: [{ userId: 1, fromStatus: 'active', toStatus: 'canceled', createdAt: new Date() }],
    });
    const churn = await getChurn({ from, to });
    expect(churn.churned).toBe(1);
  });

  it('does NOT count a trial expiring — nobody was paying, so nothing was lost', async () => {
    stubDb({
      subscriptions: [subscription({ userId: 1 })],
      billingEvents: [{ userId: 1, fromStatus: 'trialing', toStatus: 'expired', createdAt: new Date() }],
    });
    const churn = await getChurn({ from, to });
    expect(churn.churned).toBe(0);
  });

  it('counts a vendor once however many transitions they produced', async () => {
    stubDb({
      subscriptions: [subscription({ userId: 1 })],
      billingEvents: [
        { userId: 1, fromStatus: 'active', toStatus: 'canceled', createdAt: new Date() },
        { userId: 1, fromStatus: 'past_due', toStatus: 'expired', createdAt: new Date() },
      ],
    });
    expect((await getChurn({ from, to })).churned).toBe(1);
  });

  it('reports null rather than 0% when there was nothing to churn', async () => {
    stubDb({ subscriptions: [], billingEvents: [] });
    const churn = await getChurn({ from, to });
    // 0% would read as perfect retention. Undefined is the truth.
    expect(churn.ratePercent).toBeNull();
  });

  it('excludes dummy accounts', async () => {
    stubDb({
      subscriptions: [subscription({ userId: 100 })],
      dummyIds: [100],
      billingEvents: [{ userId: 100, fromStatus: 'active', toStatus: 'canceled', createdAt: new Date() }],
    });
    expect((await getChurn({ from, to })).churned).toBe(0);
  });
});

// ── §6 The billing bridge ──────────────────────────────────────────────────

describe('§6 billing transitions map to the analytics vocabulary', () => {
  it('a first payment is an activation and a repeat is a renewal', () => {
    expect(analyticsEventFor({ userId: 1, action: 'subscription_activated', fromStatus: 'trialing', toStatus: 'active' }))
      .toBe(ANALYTICS_EVENTS.SUBSCRIPTION_ACTIVATED);
    expect(analyticsEventFor({ userId: 1, action: 'subscription_activated', fromStatus: 'active', toStatus: 'active' }))
      .toBe(ANALYTICS_EVENTS.SUBSCRIPTION_RENEWED);
  });

  it('a reconciliation that ends paid access is a lapse', () => {
    expect(analyticsEventFor({ userId: 1, action: 'lifecycle_reconciled', fromStatus: 'active', toStatus: 'expired' }))
      .toBe(ANALYTICS_EVENTS.SUBSCRIPTION_LAPSED);
  });

  it('a reconciliation that changes nothing commercial is not a lapse', () => {
    expect(analyticsEventFor({ userId: 1, action: 'lifecycle_reconciled', fromStatus: 'active', toStatus: 'active' }))
      .not.toBe(ANALYTICS_EVENTS.SUBSCRIPTION_LAPSED);
  });

  it('every lifecycle action has a mapping', () => {
    for (const action of [
      'trial_started', 'cancellation_requested', 'cancellation_reversed', 'plan_changed',
      'payment_failed', 'payment_recovered', 'subscription_activated', 'lifecycle_reconciled',
    ]) {
      const mapped = analyticsEventFor({ userId: 1, action, fromStatus: 'free', toStatus: 'active' });
      expect(isAnalyticsEventType(mapped)).toBe(true);
    }
  });

  it('is emitted from the single choke point, not from eight call sites', () => {
    expect(SERVICE_SOURCE).toContain('export async function recordBillingEvent');
    expect(SERVICE_SOURCE).toContain('recordEventAsync({');
    const lifecycle = read('./billing/lifecycle.ts');
    expect(lifecycle).not.toContain('recordEventAsync');
  });

  it('the billing audit trail is still written independently of analytics', () => {
    const block = SERVICE_SOURCE.slice(SERVICE_SOURCE.indexOf('export async function recordBillingEvent'));
    expect(block.indexOf('db.insert(billingEvents)')).toBeLessThan(block.indexOf('recordEventAsync({'));
  });
});

// ── §7 The funnel is instrumented where it claims to be ────────────────────

describe('§7 emission points exist', () => {
  it('registration, sign-in, profile completion, review and verification', () => {
    for (const event of [
      'ANALYTICS_EVENTS.USER_REGISTERED',
      'ANALYTICS_EVENTS.USER_SIGNED_IN',
      'ANALYTICS_EVENTS.VENDOR_PROFILE_COMPLETED',
      'ANALYTICS_EVENTS.VENDOR_SUBMITTED_FOR_REVIEW',
      'ANALYTICS_EVENTS.VENDOR_VERIFIED',
    ]) {
      expect(ROUTERS_SOURCE).toContain(event);
    }
  });

  it('RFQ posting, quotation submission and acceptance', () => {
    for (const event of [
      'ANALYTICS_EVENTS.RFQ_POSTED',
      'ANALYTICS_EVENTS.QUOTATION_SUBMITTED',
      'ANALYTICS_EVENTS.QUOTATION_ACCEPTED',
    ]) {
      expect(ROUTERS_SOURCE).toContain(event);
    }
  });

  it('enquiry opened and the limit being hit — the clearest upgrade signal', () => {
    const enquiries = read('./billing/enquiries.ts');
    expect(enquiries).toContain('ANALYTICS_EVENTS.ENQUIRY_OPENED');
    expect(enquiries).toContain('ANALYTICS_EVENTS.ENQUIRY_LIMIT_REACHED');
  });

  it('re-opening an already-paid enquiry does not record a second open', () => {
    const enquiries = read('./billing/enquiries.ts');
    expect(enquiries).toContain('if (!duplicate) {');
  });

  it('no reviewer note, applicant note or document name is ever passed as metadata', () => {
    // These are free text about real people; the funnel needs only that the
    // transition happened.
    const emissions = ROUTERS_SOURCE.match(/recordEventAsync\(\{[\s\S]*?\}\);/g) ?? [];
    expect(emissions.length).toBeGreaterThan(5);
    for (const emission of emissions) {
      expect(emission).not.toContain('input.note');
      expect(emission).not.toContain('applicantNote');
      expect(emission).not.toContain('fileName');
      expect(emission).not.toContain('input.email');
      expect(emission).not.toContain('input.password');
    }
  });
});

// ── §8 The admin surface ───────────────────────────────────────────────────

describe('§8 exposure', () => {
  it('both analytics procedures are admin-only', () => {
    for (const procedure of ['productAnalytics:', 'commercialKpis:']) {
      const index = ROUTERS_SOURCE.indexOf(procedure);
      expect(index).toBeGreaterThan(-1);
      expect(ROUTERS_SOURCE.slice(index, index + 60)).toContain('adminProcedure');
    }
  });

  it('they return aggregates, never a per-user event list', () => {
    const block = ROUTERS_SOURCE.slice(ROUTERS_SOURCE.indexOf('productAnalytics:'), ROUTERS_SOURCE.indexOf('commercialKpis:'));
    expect(block).toContain('getVendorFunnel');
    expect(block).toContain('getEventCounts');
    // A behavioural dossier on identifiable people has no operational purpose.
    expect(block).not.toContain('select().from(analyticsEvents)');
  });

  it('REGRESSION: analyticsSummary no longer invents a month label', () => {
    // It used to return a single row labelled '2026-07' whenever there was
    // nothing to aggregate - a hardcoded month no data supported.
    const block = ROUTERS_SOURCE.slice(ROUTERS_SOURCE.indexOf('analyticsSummary:'), ROUTERS_SOURCE.indexOf('productAnalytics:'));
    expect(block).not.toContain("month: '2026-07'");
    expect(block).toContain('if (sortedMonths.length === 0) return [];');
  });

  it('the dashboard renders null figures as an em dash, not as zero', () => {
    const component = read('../client/src/components/AdminCommercialAnalytics.tsx');
    expect(component).toContain("value === null || value === undefined ? '—'");
    expect(component).toContain('kpi.noBasis');
    expect(component).toContain('kpi.noEvents');
  });

  it('the dashboard says which source each panel comes from', () => {
    const component = read('../client/src/components/AdminCommercialAnalytics.tsx');
    expect(component).toContain('kpi.revenueSource');
    expect(component).toContain('kpi.funnelSource');
  });

  it('every label the dashboard uses is translated in both languages', () => {
    const component = read('../client/src/components/AdminCommercialAnalytics.tsx');
    const translations = read('../client/src/contexts/LanguageContext.tsx');
    const keys = new Set((component.match(/t\('(kpi\.[a-zA-Z.]+)'\)/g) ?? [])
      .map(match => match.replace(/^t\('|'\)$/g, '')));
    // Funnel labels are looked up dynamically from a map, so add them too.
    for (const { stage } of VENDOR_FUNNEL) keys.add(`kpi.funnel.${stage}`);
    expect(keys.size).toBeGreaterThan(15);
    for (const key of Array.from(keys)) {
      const occurrences = translations.split(`'${key}':`).length - 1;
      expect(occurrences, `${key} should appear in both EN and AR`).toBe(2);
    }
  });
});
