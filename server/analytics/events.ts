import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { analyticsEvents, users } from '../../drizzle/schema';
import {
  ANALYTICS_EVENTS, FORBIDDEN_METADATA_KEYS, VENDOR_FUNNEL,
  type AnalyticsEventType, type VendorFunnelStage,
} from '@shared/analyticsEvents';

/**
 * ── Recording and reading product analytics (Slice 7) ──────────────────────
 *
 * Two hard rules, both enforced here rather than trusted to call sites.
 *
 * ANALYTICS NEVER BREAKS THE PRODUCT. `recordEvent` swallows every failure. If
 * the analytics table is missing, the database is down, or a value is malformed,
 * the vendor's signup still succeeds and their quotation is still submitted.
 * The alternative - an analytics write inside a business transaction - means a
 * reporting bug can stop people using the platform, which is never a trade
 * worth making.
 *
 * ANALYTICS NEVER CARRIES A CREDENTIAL OR AN IDENTITY. Metadata is filtered
 * against a forbidden-key list and truncated. A log is copied, shipped and
 * retained far more casually than the database is, and "we only put the email
 * in for debugging" is how that ends up somewhere it should not be.
 */

/** Metadata is a handful of small facts, not a payload. */
const MAX_METADATA_KEYS = 12;
const MAX_METADATA_VALUE_LENGTH = 120;
const MAX_METADATA_JSON_LENGTH = 1000;

export type RecordEventInput = {
  type: AnalyticsEventType;
  userId?: number | null;
  subjectType?: string | null;
  subjectId?: number | null;
  plan?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date;
};

/**
 * Strip anything that must not be stored, and bound what is left.
 *
 * Rejects a key whose NAME suggests a credential or an identity, rather than
 * trying to recognise a secret by its value - a token looks like any other
 * string, but nobody calls the field holding one `categoryCount`.
 */
export function sanitizeMetadata(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;

  const clean: Record<string, string | number | boolean> = {};
  let kept = 0;

  for (const [key, value] of Object.entries(metadata)) {
    if (kept >= MAX_METADATA_KEYS) break;

    const normalised = key.toLowerCase().replace(/[^a-z]/g, '');
    if ((FORBIDDEN_METADATA_KEYS as readonly string[]).some(forbidden => normalised.includes(forbidden))) {
      continue;
    }
    if (value === null || value === undefined) continue;

    if (typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
      kept++;
    } else if (typeof value === 'string') {
      clean[key] = value.slice(0, MAX_METADATA_VALUE_LENGTH);
      kept++;
    }
    // Objects and arrays are dropped entirely. Nesting is where a whole user
    // row gets spread in "just this once".
  }

  if (Object.keys(clean).length === 0) return null;
  const serialised = JSON.stringify(clean);
  return serialised.length > MAX_METADATA_JSON_LENGTH ? null : serialised;
}

/**
 * Record one event. Fire and forget: callers do not await a decision, and a
 * failure here can never surface to a user.
 */
export async function recordEvent(input: RecordEventInput): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(analyticsEvents).values({
      userId: input.userId ?? null,
      eventType: input.type,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      plan: input.plan ?? null,
      metadata: sanitizeMetadata(input.metadata),
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    });
  } catch (error) {
    console.error('[analytics] Failed to record event', input.type, error);
  }
}

/**
 * Convenience for call sites inside a request path: schedules the write and
 * returns immediately, so an analytics insert never adds latency to a
 * user-facing response.
 */
export function recordEventAsync(input: RecordEventInput): void {
  void recordEvent(input);
}

// ── Reading ────────────────────────────────────────────────────────────────

export type FunnelRow = { stage: VendorFunnelStage; event: string; users: number };

/**
 * How many distinct users ever reached each funnel stage.
 *
 * "Ever reached", not "are currently at" - a vendor who registered, verified,
 * and later cancelled still counts at every stage they passed, because the
 * question the funnel answers is where people stop, not where they are now.
 *
 * Dummy accounts are excluded by default. They exist for testing and would
 * otherwise inflate every stage of the owner's own funnel.
 */
export async function getVendorFunnel(options: { includeDummy?: boolean; since?: Date } = {}): Promise<FunnelRow[]> {
  const db = await getDb();
  if (!db) return VENDOR_FUNNEL.map(({ stage, event }) => ({ stage, event, users: 0 }));

  const excludedIds = options.includeDummy
    ? []
    : (await db.select({ id: users.id }).from(users).where(eq(users.isDummy, true))).map(row => row.id);

  const conditions = [
    inArray(analyticsEvents.eventType, VENDOR_FUNNEL.map(entry => entry.event) as unknown as string[]),
    ...(options.since ? [gte(analyticsEvents.occurredAt, options.since)] : []),
  ];

  const rows = await db
    .select({
      eventType: analyticsEvents.eventType,
      users: sql<number>`count(distinct ${analyticsEvents.userId})`,
    })
    .from(analyticsEvents)
    .where(and(...conditions))
    .groupBy(analyticsEvents.eventType);

  // Dummy exclusion is applied as a second pass rather than a NOT IN clause, so
  // an empty dummy list cannot produce `NOT IN ()` - which MySQL treats as
  // always-false and would silently zero the whole funnel.
  const dummyCounts = new Map<string, number>();
  if (excludedIds.length > 0) {
    const dummyRows = await db
      .select({
        eventType: analyticsEvents.eventType,
        users: sql<number>`count(distinct ${analyticsEvents.userId})`,
      })
      .from(analyticsEvents)
      .where(and(...conditions, inArray(analyticsEvents.userId, excludedIds)))
      .groupBy(analyticsEvents.eventType);
    for (const row of dummyRows) dummyCounts.set(row.eventType, Number(row.users));
  }

  const counts = new Map(rows.map(row => [row.eventType, Number(row.users) - (dummyCounts.get(row.eventType) ?? 0)]));
  return VENDOR_FUNNEL.map(({ stage, event }) => ({
    stage,
    event,
    users: Math.max(0, counts.get(event) ?? 0),
  }));
}

export type EventCountRow = { eventType: string; count: number };

/** Raw event volume in a window, for the owner to see what is actually happening. */
export async function getEventCounts(options: { since?: Date; until?: Date } = {}): Promise<EventCountRow[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [
    ...(options.since ? [gte(analyticsEvents.occurredAt, options.since)] : []),
    ...(options.until ? [lt(analyticsEvents.occurredAt, options.until)] : []),
  ];
  const rows = await db
    .select({ eventType: analyticsEvents.eventType, count: sql<number>`count(*)` })
    .from(analyticsEvents)
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(analyticsEvents.eventType);
  return rows
    .map(row => ({ eventType: row.eventType, count: Number(row.count) }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Median days from registration to a given milestone, per user.
 *
 * Median rather than mean, because one vendor who signed up in January and
 * verified in August drags an average far enough to make it meaningless.
 * Returns null when nobody has completed the milestone - which is the honest
 * answer, not zero.
 */
export async function getMedianDaysToMilestone(
  milestone: AnalyticsEventType,
  options: { includeDummy?: boolean } = {},
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const excluded = options.includeDummy
    ? []
    : (await db.select({ id: users.id }).from(users).where(eq(users.isDummy, true))).map(row => row.id);

  const rows = await db
    .select({
      userId: analyticsEvents.userId,
      eventType: analyticsEvents.eventType,
      occurredAt: analyticsEvents.occurredAt,
    })
    .from(analyticsEvents)
    .where(inArray(analyticsEvents.eventType, [ANALYTICS_EVENTS.USER_REGISTERED, milestone]));

  const registered = new Map<number, number>();
  const reached = new Map<number, number>();
  for (const row of rows) {
    if (row.userId === null || excluded.includes(row.userId)) continue;
    const at = new Date(row.occurredAt).getTime();
    const target = row.eventType === ANALYTICS_EVENTS.USER_REGISTERED ? registered : reached;
    // Earliest occurrence wins, which is what makes this "time to FIRST".
    const existing = target.get(row.userId);
    if (existing === undefined || at < existing) target.set(row.userId, at);
  }

  const durations: number[] = [];
  for (const [userId, reachedAt] of Array.from(reached.entries())) {
    const registeredAt = registered.get(userId);
    if (registeredAt === undefined || reachedAt < registeredAt) continue;
    durations.push((reachedAt - registeredAt) / 86_400_000);
  }
  if (durations.length === 0) return null;

  durations.sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  const median = durations.length % 2 === 0
    ? (durations[middle - 1] + durations[middle]) / 2
    : durations[middle];
  return Math.round(median * 10) / 10;
}
