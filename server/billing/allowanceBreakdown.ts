/**
 * WHERE A VENDOR'S ALLOWANCE ACTUALLY COMES FROM.
 *
 * `billing.myEntitlements` returns one effective number and `billing.myPlan`
 * returns a plan id, and NEITHER HAS A SCREEN. A vendor whose allowance changed
 * - because a referral paid out, because an administrator granted something,
 * because a bonus lapsed - had nowhere to find out why. "You have 46 qualified
 * enquiries" is not an answer to "why 46".
 *
 * The allowance is three things added up:
 *
 *   the PLAN's figure
 *   + an ADMINISTRATOR's absolute override, which REPLACES the plan's
 *   + every BONUS row in force, which ADD on top of whatever won
 *
 * ONE AUTHORITY, EXPLAINED - NOT RECOMPUTED. The number this reports is always
 * the one `resolveVendorEntitlements` enforces; the parts are read to explain
 * it. When the parts do not add up to the enforced total, that is reported as a
 * mismatch rather than shown as a tidy sum, because two code paths computing an
 * entitlement and quietly disagreeing is exactly how a vendor ends up being told
 * one number and given another.
 */
import { and, desc, eq, isNull, or, gt, lte } from 'drizzle-orm';
import { vendorEntitlementOverrides } from '../../drizzle/schema';
import { PLANS, type PlanId } from '@shared/billing';
import {
  ENQUIRY_ALLOWANCE_KEY, ENQUIRY_BONUS_KEY, decodeEntitlementValue, UNPARSEABLE,
} from './overrides';

export type AllowanceSource = {
  id: number;
  value: number | null;
  reason: string | null;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
};

export type AllowanceBreakdown = {
  planId: PlanId;
  /** What the plan alone grants. null = unlimited. */
  planAllowance: number | null;
  /** An administrator's absolute grant, which REPLACES the plan's figure. */
  adminOverride: AllowanceSource | null;
  /** Bonuses in force, which ADD to whatever won above. Referral rewards live here. */
  bonuses: AllowanceSource[];
  /** The parts, added up. */
  computed: number | null;
  /** What the platform actually enforces. */
  effective: number | null;
  /**
   * True when `computed` and `effective` disagree. Never hidden: a vendor being
   * shown a breakdown that does not match what they are given is worse than
   * being shown no breakdown at all.
   */
  mismatch: boolean;
};

const asNumber = (raw: string | null): number | null => {
  if (raw === null) return null;
  const decoded = decodeEntitlementValue(raw);
  if (decoded === UNPARSEABLE) return null;
  return typeof decoded === 'number' ? decoded : null;
};

/** The same in-force test the resolver uses: not revoked, started, not ended. */
function liveRows(db: any, userId: number, key: string, now: Date) {
  return db.select().from(vendorEntitlementOverrides).where(and(
    eq(vendorEntitlementOverrides.userId, userId),
    eq(vendorEntitlementOverrides.entitlementKey, key),
    isNull(vendorEntitlementOverrides.revokedAt),
    lte(vendorEntitlementOverrides.startsAt, now),
    or(isNull(vendorEntitlementOverrides.endsAt), gt(vendorEntitlementOverrides.endsAt, now)),
  )).orderBy(desc(vendorEntitlementOverrides.id));
}

const toSource = (row: any): AllowanceSource => ({
  id: Number(row.id),
  value: asNumber(row.value),
  reason: row.reason ?? null,
  startsAt: row.startsAt ?? null,
  endsAt: row.endsAt ?? null,
});

export async function explainEnquiryAllowance(
  db: any,
  userId: number,
  planId: PlanId,
  effective: number | null,
  now: Date = new Date(),
): Promise<AllowanceBreakdown> {
  const [absolutes, bonusRows] = await Promise.all([
    liveRows(db, userId, ENQUIRY_ALLOWANCE_KEY, now),
    liveRows(db, userId, ENQUIRY_BONUS_KEY, now),
  ]);

  const planAllowance = PLANS[planId].entitlements.qualifiedEnquiriesPerMonth;
  // HIGHEST ID WINS among absolutes - the same supersession rule the resolver
  // applies, so the explanation names the row that actually took effect and not
  // one it superseded.
  const adminOverride = absolutes.length > 0 ? toSource(absolutes[0]) : null;
  const bonuses = (bonusRows as any[]).map(toSource);

  const base = adminOverride ? adminOverride.value : planAllowance;
  /*
   * UNLIMITED STAYS UNLIMITED. null plus anything is still no limit, and
   * turning it into a number would present a downgrade as a bonus.
   */
  const computed = base === null
    ? null
    : base + bonuses.reduce((sum, bonus) => sum + (bonus.value ?? 0), 0);

  return {
    planId,
    planAllowance,
    adminOverride,
    bonuses,
    computed,
    effective,
    mismatch: computed !== effective,
  };
}
