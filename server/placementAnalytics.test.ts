/**
 * COMMERCIAL ANALYTICS THAT AN ADVERTISER COULD BE SHOWN.
 *
 * These numbers are the thing BuildHub intends to sell against, so the tests
 * are mostly about the ways a number could become untrue: an event recorded for
 * a placement that does not exist, a browser asserting its own conversions, a
 * rate rendered as 0% when nothing was observed at all, or an impression
 * counted because a component re-rendered.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ getDb: vi.fn() }));
vi.mock('./analytics/events', () => ({ recordEvent: vi.fn(async () => undefined) }));

import { getDb } from './db';
import { recordEvent } from './analytics/events';
import { analyticsEvents, products, users, vendorSponsorships } from '../drizzle/schema';
import {
  attributePlacementEnquiry,
  placementPerformance,
  recordPlacementEvent,
} from './placementAnalytics';
import { ANALYTICS_EVENTS } from '@shared/analyticsEvents';
import {
  IMPRESSION_DWELL_MS,
  IMPRESSION_VISIBLE_FRACTION,
  PLACEMENT_CLIENT_EVENTS,
  PLACEMENT_METRIC_FORMULAS,
  isPlacementClientEvent,
  rate,
} from '@shared/placementAnalytics';

const NOW = new Date('2026-09-02T12:00:00.000Z');

function makeDb(tables: {
  placements?: Record<string, unknown>[];
  events?: Record<string, unknown>[];
  users?: Record<string, unknown>[];
  products?: Record<string, unknown>[];
} = {}) {
  const chain = (rows: unknown[]) => {
    const c: any = {
      from: () => c, where: () => c, orderBy: () => c, groupBy: () => c,
      limit: () => Promise.resolve(rows),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return c;
  };
  const db: any = {
    select: () => ({
      from: (table: unknown) => {
        if (table === vendorSponsorships) return chain(tables.placements ?? []);
        if (table === analyticsEvents) return chain(tables.events ?? []);
        if (table === users) return chain(tables.users ?? []);
        if (table === products) return chain(tables.products ?? []);
        return chain([]);
      },
    }),
  };
  return db;
}

const livePlacement = (over = {}) => ({
  id: 7, surface: 'MASTER_DISCOVERY', entityType: 'PROVIDER',
  vendorId: 10, productId: null, ...over,
});

// ── The impression rule ────────────────────────────────────────────────────

describe('an impression is a definition, not a fetch', () => {
  it('the rule is stated as constants the client and the tests share', () => {
    // Half visible, for a continuous second. Written down so that what
    // BuildHub sells is a defined thing rather than a number of unexplained
    // origin.
    expect(IMPRESSION_VISIBLE_FRACTION).toBe(0.5);
    expect(IMPRESSION_DWELL_MS).toBe(1000);
  });

  it('QUALIFIED_ENQUIRY IS NOT CLIENT-REPORTABLE', () => {
    // The single most important line in this file. A visitor who can post
    // their own conversions can manufacture an advertiser's performance
    // report.
    expect(PLACEMENT_CLIENT_EVENTS).toEqual(['IMPRESSION', 'ENTITY_VIEW', 'CTA_CLICK']);
    expect(isPlacementClientEvent('QUALIFIED_ENQUIRY')).toBe(false);
    expect(isPlacementClientEvent('placement.qualified_enquiry')).toBe(false);
  });

  it('rejects an invented event type', () => {
    expect(isPlacementClientEvent('SALE')).toBe(false);
    expect(isPlacementClientEvent('REVENUE')).toBe(false);
    expect(isPlacementClientEvent('')).toBe(false);
    expect(isPlacementClientEvent(null)).toBe(false);
  });
});

// ── Recording ──────────────────────────────────────────────────────────────

describe('a reported event is checked against a real, live placement', () => {
  it('records an impression against a live placement', async () => {
    vi.mocked(getDb).mockResolvedValue(makeDb({ placements: [livePlacement()] }) as never);
    const result = await recordPlacementEvent({ placementId: 7, event: 'IMPRESSION', now: NOW });
    expect(result.recorded).toBe(true);
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: ANALYTICS_EVENTS.PLACEMENT_IMPRESSION,
      subjectType: 'placement',
      subjectId: 7,
    }));
  });

  it('REFUSES an id with no live placement behind it', async () => {
    // The query returns nothing for a fabricated id, an expired campaign or a
    // revoked one - all three are the same answer to a reporter.
    vi.mocked(getDb).mockResolvedValue(makeDb({ placements: [] }) as never);
    vi.mocked(recordEvent).mockClear();
    const result = await recordPlacementEvent({ placementId: 999999, event: 'IMPRESSION', now: NOW });
    expect(result.recorded).toBe(false);
    expect(result.reason).toBe('no_live_placement');
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('takes the surface and entity from the PLACEMENT ROW, never from the caller', async () => {
    vi.mocked(getDb).mockResolvedValue(makeDb({
      placements: [livePlacement({ surface: 'SEARCH_RESULTS_BOOST', entityType: 'PRODUCT', vendorId: null, productId: 42 })],
    }) as never);
    vi.mocked(recordEvent).mockClear();
    await recordPlacementEvent({ placementId: 7, event: 'CTA_CLICK', now: NOW });
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ surface: 'SEARCH_RESULTS_BOOST', entityType: 'PRODUCT', entityId: 42 }),
    }));
  });

  it('records an anonymous report without inventing an identity for it', async () => {
    vi.mocked(getDb).mockResolvedValue(makeDb({ placements: [livePlacement()] }) as never);
    vi.mocked(recordEvent).mockClear();
    await recordPlacementEvent({ placementId: 7, event: 'ENTITY_VIEW', now: NOW });
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });

  it('carries nothing personal - no address, agent or fingerprint', async () => {
    vi.mocked(getDb).mockResolvedValue(makeDb({ placements: [livePlacement()] }) as never);
    vi.mocked(recordEvent).mockClear();
    await recordPlacementEvent({ placementId: 7, event: 'IMPRESSION', userId: 5, now: NOW });
    const call = vi.mocked(recordEvent).mock.calls[0][0];
    const keys = Object.keys(call.metadata ?? {});
    expect(keys.sort()).toEqual(['entityId', 'entityType', 'surface']);
  });

  it('records nothing when there is no database, rather than throwing', async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    const result = await recordPlacementEvent({ placementId: 7, event: 'IMPRESSION', now: NOW });
    expect(result.recorded).toBe(false);
  });
});

describe('attribution is a server-side fact about a real relationship', () => {
  it('records an attributed enquiry against the placement', async () => {
    vi.mocked(getDb).mockResolvedValue(makeDb({ placements: [{ id: 7, surface: 'MASTER_DISCOVERY' }] }) as never);
    vi.mocked(recordEvent).mockClear();
    const result = await attributePlacementEnquiry({
      placementId: 7, userId: 5, subjectType: 'rfq', subjectId: 88, now: NOW,
    });
    expect(result.recorded).toBe(true);
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: ANALYTICS_EVENTS.PLACEMENT_QUALIFIED_ENQUIRY,
      subjectType: 'placement',
      subjectId: 7,
    }));
  });

  it('still credits a placement that expired between the click and the enquiry', async () => {
    // The journey began while it was live. Stripping the credit because the
    // campaign ended in between would understate what it earned.
    vi.mocked(getDb).mockResolvedValue(makeDb({ placements: [{ id: 7, surface: 'MASTER_DISCOVERY' }] }) as never);
    const result = await attributePlacementEnquiry({
      placementId: 7, userId: 5, subjectType: 'enquiry', subjectId: 3, now: NOW,
    });
    expect(result.recorded).toBe(true);
  });

  it('records nothing for a placement that never existed', async () => {
    vi.mocked(getDb).mockResolvedValue(makeDb({ placements: [] }) as never);
    vi.mocked(recordEvent).mockClear();
    const result = await attributePlacementEnquiry({
      placementId: 12345, userId: 5, subjectType: 'rfq', subjectId: 1, now: NOW,
    });
    expect(result.recorded).toBe(false);
    expect(recordEvent).not.toHaveBeenCalled();
  });
});

// ── The report ─────────────────────────────────────────────────────────────

describe('performance is counted, never estimated', () => {
  it('counts each event type from real rows', async () => {
    vi.mocked(getDb).mockResolvedValue(makeDb({
      placements: [livePlacement()],
      events: [
        { subjectId: 7, eventType: ANALYTICS_EVENTS.PLACEMENT_IMPRESSION, total: 200 },
        { subjectId: 7, eventType: ANALYTICS_EVENTS.PLACEMENT_ENTITY_VIEW, total: 50 },
        { subjectId: 7, eventType: ANALYTICS_EVENTS.PLACEMENT_CTA_CLICK, total: 20 },
        { subjectId: 7, eventType: ANALYTICS_EVENTS.PLACEMENT_QUALIFIED_ENQUIRY, total: 5 },
      ],
      users: [{ id: 10, name: 'Nile Contracting' }],
    }) as never);
    const [row] = await placementPerformance(NOW);
    expect(row.impressions).toBe(200);
    expect(row.entityViews).toBe(50);
    expect(row.ctaActions).toBe(20);
    expect(row.qualifiedEnquiries).toBe(5);
    // CTA / impressions, views / impressions, enquiries / views.
    expect(row.ctr).toBe(10);
    expect(row.viewRate).toBe(25);
    expect(row.conversionRate).toBe(10);
  });

  it('names the business, not the row id', async () => {
    vi.mocked(getDb).mockResolvedValue(makeDb({
      placements: [livePlacement()], events: [], users: [{ id: 10, name: 'Nile Contracting' }],
    }) as never);
    const [row] = await placementPerformance(NOW);
    expect(row.entityName).toBe('Nile Contracting');
  });

  it('A PLACEMENT NOBODY SAW REPORTS ZEROS AND NULL RATES', async () => {
    // Null, not 0%. "0% clicked" asserts that people saw it and did not click;
    // with no impressions the truth is that there is nothing to compute.
    vi.mocked(getDb).mockResolvedValue(makeDb({
      placements: [livePlacement()], events: [], users: [{ id: 10, name: 'Nile' }],
    }) as never);
    const [row] = await placementPerformance(NOW);
    expect(row.impressions).toBe(0);
    expect(row.ctr).toBeNull();
    expect(row.viewRate).toBeNull();
    expect(row.conversionRate).toBeNull();
  });

  it('never invents a row for a placement that does not exist', async () => {
    vi.mocked(getDb).mockResolvedValue(makeDb({ placements: [], events: [] }) as never);
    expect(await placementPerformance(NOW)).toEqual([]);
  });

  it('reports NO revenue, GMV, commission or order figure', async () => {
    // BuildHub observes none of these - payments are deferred - and a field is
    // an invitation to fill it in.
    vi.mocked(getDb).mockResolvedValue(makeDb({
      placements: [livePlacement()], events: [], users: [{ id: 10, name: 'Nile' }],
    }) as never);
    const [row] = await placementPerformance(NOW);
    for (const forbidden of ['revenue', 'gmv', 'commission', 'orders', 'sales', 'earnings']) {
      expect(Object.keys(row).map(k => k.toLowerCase())).not.toContain(forbidden);
    }
  });
});

describe('the formulas are stated, not implied', () => {
  it('every rate has a written definition', () => {
    expect(PLACEMENT_METRIC_FORMULAS.ctr).toBe('CTA actions ÷ impressions');
    expect(PLACEMENT_METRIC_FORMULAS.viewRate).toBe('entity views ÷ impressions');
    expect(PLACEMENT_METRIC_FORMULAS.conversionRate).toBe('attributed qualified enquiries ÷ entity views');
  });

  it('rate() returns null on a zero denominator, and a percentage otherwise', () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(5, 0)).toBeNull();
    expect(rate(1, 3)).toBe(33.3);
    expect(rate(0, 100)).toBe(0);   // a real zero: 100 saw it, none clicked
  });
});
