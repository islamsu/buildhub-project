/**
 * ── Individual entitlement overrides (Part 46) ─────────────────────────────
 *
 * A vendor's allowance normally comes from their plan. Sometimes it must not:
 * support grants a struggling vendor extra leads for a month, a launch partner
 * is given more categories than professional includes, a vendor is temporarily
 * throttled while an abuse report is investigated.
 *
 * THE TWO SHORTCUTS THIS EXISTS TO PREVENT, both named by the mandate:
 *
 *   Changing the PLAN. Moving a vendor to premium to give them ten more leads
 *   rewrites what they are recorded as having agreed to pay, corrupts plan
 *   distribution reporting, and hands them every other premium capability as a
 *   side effect nobody asked for.
 *
 *   Changing the ROLE. Not even the same axis. `role` is the privilege
 *   boundary every procedure branches on.
 *
 * An override changes ONE entitlement, for ONE vendor, for a stated reason,
 * optionally for a stated window, and leaves the subscription untouched.
 *
 * IT RESOLVES HERE AND NOWHERE ELSE. entitlements.ts is "THE one mechanism
 * that answers what is this vendor entitled to right now"; if overrides
 * resolved anywhere else there would be two answers, and they would drift. So
 * this module is called from inside resolveVendorEntitlements, which means
 * every existing consumer - the capability map, the qualified-enquiry
 * enforcement in enquiries.ts, the vendor-facing response - honours an
 * override without a single call site changing.
 *
 * FAILS CLOSED, matching the surrounding module: a database outage, a row
 * naming an entitlement that no longer exists, or a value that will not parse
 * yields the PLAN value. An override can never be the reason a vendor gets
 * more than their plan by accident.
 */

import { and, desc, eq, isNull, or, gt } from 'drizzle-orm';
import { vendorEntitlementOverrides } from '../../drizzle/schema';
import type { PlanEntitlements } from '@shared/billing';

/**
 * The entitlement keys an override may target.
 *
 * Derived from a value rather than written twice: PLAN_CATALOGUE's free plan
 * carries every key, so a new entitlement is overridable the moment it exists
 * and a removed one stops being addressable. Writing the list by hand is how
 * it would silently fall behind shared/billing.ts.
 */
export function overridableEntitlementKeys(freePlanEntitlements: PlanEntitlements): (keyof PlanEntitlements)[] {
  return Object.keys(freePlanEntitlements) as (keyof PlanEntitlements)[];
}

export type OverrideRow = {
  id: number;
  entitlementKey: string;
  value: string;
  previousValue: string | null;
  reason: string | null;
  actorId: number | null;
  startsAt: Date;
  endsAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

/** JSON, because an entitlement value may be a number, null, a string tier or a boolean. */
export function encodeEntitlementValue(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function decodeEntitlementValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Unparseable means "no usable override", never "unlimited". `null` is a
    // real and generous value in this schema - it means no limit - so
    // returning it on a parse failure would turn corrupt data into free
    // premium access. The sentinel is deliberately not a valid entitlement.
    return UNPARSEABLE;
  }
}

export const UNPARSEABLE = Symbol('unparseable-entitlement-value');

/**
 * The overrides in force for one vendor at `now`.
 *
 * "In force" means: the most recent row per entitlement key that has started,
 * has not ended, and has not been revoked. Rows are never updated, so the
 * superseded ones stay exactly as they were written - which is what makes the
 * history readable and Part 17's immutability a property of the storage.
 */
export async function activeOverridesFor(
  db: {
    select: (...args: unknown[]) => {
      from: (table: unknown) => {
        where: (...args: unknown[]) => { orderBy: (...args: unknown[]) => Promise<OverrideRow[]> } | Promise<OverrideRow[]>;
      };
    };
  },
  userId: number,
  now: Date = new Date(),
): Promise<Map<string, OverrideRow>> {
  const rows = await (db as never as {
    select: () => { from: (t: unknown) => { where: (c: unknown) => { orderBy: (o: unknown) => Promise<OverrideRow[]> } } };
  }).select().from(vendorEntitlementOverrides).where(
    and(
      eq(vendorEntitlementOverrides.userId, userId),
      isNull(vendorEntitlementOverrides.revokedAt),
      // An expiry in the past means the grant has lapsed on its own, with no
      // sweep required. Reading it as expired is what makes "temporary"
      // actually temporary even if nothing ever runs to clean it up.
      or(isNull(vendorEntitlementOverrides.endsAt), gt(vendorEntitlementOverrides.endsAt, now)),
    ),
  ).orderBy(desc(vendorEntitlementOverrides.id));

  const active = new Map<string, OverrideRow>();
  for (const row of rows) {
    // Ordered newest first, so the first row seen for a key is the one in
    // force and later (older) rows for the same key are its history.
    if (active.has(row.entitlementKey)) continue;
    if (row.startsAt && new Date(row.startsAt).getTime() > now.getTime()) continue;
    active.set(row.entitlementKey, row);
  }
  return active;
}

/**
 * Apply overrides to a plan's entitlements.
 *
 * Pure, so the precedence rule is testable without a database: PLAN value
 * first, then an override for that key if one is in force. An override for a
 * key that is not part of PlanEntitlements is ignored rather than added -
 * otherwise a stale row could inject a field no consumer validates.
 */
export function applyOverrides(
  planEntitlements: PlanEntitlements,
  overrides: Map<string, OverrideRow>,
): { entitlements: PlanEntitlements; applied: string[] } {
  const entitlements = { ...planEntitlements };
  const applied: string[] = [];
  for (const key of Object.keys(planEntitlements) as (keyof PlanEntitlements)[]) {
    const row = overrides.get(key);
    if (!row) continue;
    const value = decodeEntitlementValue(row.value);
    if (value === UNPARSEABLE) continue;
    // The override must be type-compatible with the plan value it replaces.
    // Without this a row saying `"lots"` would land a string where every
    // consumer expects a number, and the comparison `used >= allowance` would
    // then be false for every value - an unlimited allowance created by a typo.
    if (!isCompatible(planEntitlements[key], value)) continue;
    (entitlements as Record<string, unknown>)[key] = value;
    applied.push(key);
  }
  return { entitlements, applied };
}

/**
 * `null` is legal for every nullable entitlement and means "no limit", so it is
 * accepted wherever the plan value is a number or already null. Everything else
 * must match the plan value's own type.
 */
function isCompatible(planValue: unknown, next: unknown): boolean {
  if (next === null) return planValue === null || typeof planValue === 'number';
  if (typeof planValue === 'number' || planValue === null) return typeof next === 'number' && Number.isFinite(next);
  return typeof next === typeof planValue;
}

// ── The qualified-enquiry allowance, as an administrator sees and sets it ───
//
// Part 45 is explicit that this is a required capability: VIEW LIMIT, VIEW
// USED, VIEW REMAINING, INCREASE, DECREASE, SET, VIEW HISTORY. Before this
// there was no per-vendor limit at all - the allowance came from the plan
// constant and nothing could move it without moving the vendor's plan, which
// is exactly the shortcut the mandate forbids.

import { and as sqlAnd, eq as sqlEq, desc as sqlDesc } from 'drizzle-orm';
import { PLANS, type PlanId } from '@shared/billing';
import { users, qualifiedEnquiries } from '../../drizzle/schema';
import { sql as rawSql } from 'drizzle-orm';

/** A sane ceiling. Guards Part 45's "overflow = denied" and keeps the column an int. */
export const MAX_ENQUIRY_ALLOWANCE = 100_000;

export const ENQUIRY_ALLOWANCE_KEY = 'qualifiedEnquiriesPerMonth';

export type EnquiryAllowanceView = {
  userId: number;
  planId: PlanId;
  /** What the vendor's plan alone would grant. null = unlimited. */
  planAllowance: number | null;
  /** What is actually in force - the override if there is one, otherwise the plan. */
  effectiveAllowance: number | null;
  overridden: boolean;
  used: number;
  /** null = unlimited. NEVER NEGATIVE - see the clamp below. */
  remaining: number | null;
  periodKey: string;
  history: {
    id: number;
    value: number | null;
    previousValue: number | null;
    reason: string | null;
    actorId: number | null;
    startsAt: Date;
    endsAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }[];
};

const asAllowance = (raw: string | null): number | null => {
  if (raw === null) return null;
  const decoded = decodeEntitlementValue(raw);
  if (decoded === UNPARSEABLE) return null;
  return typeof decoded === 'number' ? decoded : null;
};

/**
 * Everything an administrator needs to answer "what is this vendor allowed,
 * what have they used, and who changed it" - in one read, with the history.
 */
export async function readEnquiryAllowance(
  db: never,
  userId: number,
  planId: PlanId,
  used: number,
  periodKey: string,
  now: Date = new Date(),
): Promise<EnquiryAllowanceView> {
  const anyDb = db as unknown as {
    select: (c?: unknown) => { from: (t: unknown) => { where: (c: unknown) => { orderBy: (o: unknown) => Promise<OverrideRow[]> } } };
  };
  const rows = await anyDb.select().from(vendorEntitlementOverrides).where(
    sqlAnd(
      sqlEq(vendorEntitlementOverrides.userId, userId),
      sqlEq(vendorEntitlementOverrides.entitlementKey, ENQUIRY_ALLOWANCE_KEY),
    ),
  ).orderBy(sqlDesc(vendorEntitlementOverrides.id));

  const planAllowance = PLANS[planId].entitlements.qualifiedEnquiriesPerMonth;
  const active = rows.find(row =>
    !row.revokedAt
    && (!row.endsAt || new Date(row.endsAt).getTime() > now.getTime())
    && (!row.startsAt || new Date(row.startsAt).getTime() <= now.getTime()));

  const effectiveAllowance = active ? asAllowance(active.value) : planAllowance;
  return {
    userId,
    planId,
    planAllowance,
    effectiveAllowance,
    overridden: Boolean(active),
    used,
    // CLAMPED AT ZERO, deliberately. A vendor whose limit was lowered after
    // they had already consumed more than the new figure is at zero remaining,
    // never at minus three. The consumed rows are the record of what actually
    // happened and are never rewritten to make an arithmetic result tidy.
    remaining: effectiveAllowance === null ? null : Math.max(0, effectiveAllowance - used),
    periodKey,
    history: rows.map(row => ({
      id: row.id,
      value: asAllowance(row.value),
      previousValue: asAllowance(row.previousValue),
      reason: row.reason,
      actorId: row.actorId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    })),
  };
}

export type SetAllowanceRefusal =
  | { ok: false; reason: 'negative' }
  | { ok: false; reason: 'overflow'; max: number }
  | { ok: false; reason: 'below_usage'; used: number; requested: number; periodKey: string };

export type SetAllowanceResult = { ok: true; overrideId: number; previous: number | null } | SetAllowanceRefusal;

/**
 * Set one vendor's qualified-enquiry allowance.
 *
 * THE OWNER'S DECISION, TAKEN EXPLICITLY: a limit BELOW current usage is
 * REFUSED. The mandate said not to invent this, and the alternatives were
 * genuinely open - accept it and let remaining sit at zero, or refuse. Refusing
 * means an administrator cannot create an over-consumed state at all, and the
 * error names the usage so they can see why and choose a real number. Nothing
 * consumed is ever revoked, refunded or renumbered either way.
 *
 * APPEND-ONLY: a change inserts a new row carrying the value it replaced, and
 * revokes the previous one. No row is ever updated in place, so the history
 * Part 45 asks for is the storage rather than a reconstruction.
 *
 * CONCURRENCY: the vendor's own users row is locked FOR UPDATE first, the same
 * pattern that fixed the double-charge in enquiries.ts. Two administrators
 * setting a limit at the same moment serialise; the second sees the first's
 * value as its `previousValue` instead of both writing over one another.
 */
export async function setEnquiryAllowance(args: {
  db: never;
  userId: number;
  /** null = unlimited. */
  limit: number | null;
  reason: string | null;
  /**
   * Who granted it. NULL means the platform itself - a referral reward has no
   * administrator behind it, and recording the beneficiary as the actor made a
   * vendor the author of his own entitlement. The column has always been
   * nullable; only this parameter was not.
   */
  actorId: number | null;
  endsAt?: Date | null;
  now?: Date;
}): Promise<SetAllowanceResult> {
  const { userId, limit, reason, actorId } = args;
  const now = args.now ?? new Date();

  if (limit !== null) {
    if (!Number.isInteger(limit) || limit < 0) return { ok: false, reason: 'negative' };
    if (limit > MAX_ENQUIRY_ALLOWANCE) return { ok: false, reason: 'overflow', max: MAX_ENQUIRY_ALLOWANCE };
  }

  const db = args.db as unknown as {
    transaction: <T>(fn: (tx: never) => Promise<T>) => Promise<T>;
  };

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as {
      select: (c?: unknown) => { from: (t: unknown) => {
        where: (c: unknown) => {
          for: (m: string) => Promise<unknown[]>;
          orderBy: (o: unknown) => { limit: (n: number) => Promise<OverrideRow[]> };
          then: never;
        } & Promise<{ count: number }[]>;
      } };
      insert: (t: unknown) => { values: (v: unknown) => Promise<{ insertId: number }[] | { insertId: number }> };
      update: (t: unknown) => { set: (v: unknown) => { where: (c: unknown) => Promise<unknown> } };
    };

    // Serialise per vendor. Same lock, same ordering as the enquiry spend path.
    await tx.select({ id: users.id }).from(users).where(sqlEq(users.id, userId)).for('update');

    const periodKey = allowancePeriodKey(now);
    const [usageRow] = await tx.select({ count: rawSql<number>`count(*)` }).from(qualifiedEnquiries)
      .where(sqlAnd(sqlEq(qualifiedEnquiries.userId, userId), sqlEq(qualifiedEnquiries.yearMonth, periodKey))) as unknown as { count: number }[];
    const used = Number(usageRow?.count ?? 0);

    if (limit !== null && limit < used) {
      return { ok: false, reason: 'below_usage', used, requested: limit, periodKey };
    }

    const previousRows = await tx.select().from(vendorEntitlementOverrides).where(
      sqlAnd(
        sqlEq(vendorEntitlementOverrides.userId, userId),
        sqlEq(vendorEntitlementOverrides.entitlementKey, ENQUIRY_ALLOWANCE_KEY),
      ),
    ).orderBy(sqlDesc(vendorEntitlementOverrides.id)).limit(1) as unknown as OverrideRow[];
    const previousActive = previousRows.find(row => !row.revokedAt);
    const previous = previousActive ? asAllowance(previousActive.value) : null;

    if (previousActive) {
      await tx.update(vendorEntitlementOverrides)
        .set({ revokedAt: now, revokedBy: actorId })
        .where(sqlEq(vendorEntitlementOverrides.id, previousActive.id));
    }

    const inserted = await tx.insert(vendorEntitlementOverrides).values({
      userId,
      entitlementKey: ENQUIRY_ALLOWANCE_KEY,
      value: encodeEntitlementValue(limit),
      previousValue: previousActive ? previousActive.value : null,
      reason,
      actorId,
      startsAt: now,
      endsAt: args.endsAt ?? null,
    });
    const overrideId = Number((Array.isArray(inserted) ? inserted[0] : inserted)?.insertId ?? 0);
    return { ok: true, overrideId, previous };
  });
}

/** 'YYYY-MM' in UTC - the same period key qualifiedEnquiries.yearMonth carries. */
export function allowancePeriodKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
