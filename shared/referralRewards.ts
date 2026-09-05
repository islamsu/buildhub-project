/**
 * THE REFERRAL VOCABULARY.
 *
 * Every one of these lists was written out THREE times - once in
 * drizzle/schema.ts as a mysqlEnum, once again for the reward ledger, and a
 * third time as a `z.enum([...])` in the admin router. Three copies of a closed
 * set, edited apart, is the same architecture that produced four disagreeing
 * category vocabularies; this is the same fix applied before it costs anything.
 *
 * The schema's enums stay as they are - a Drizzle column has to declare its own
 * values - but everything else reads from here, and a test holds the two in
 * agreement.
 */

/** What a campaign can award. Non-cash by construction: payment is owner-deferred. */
export const REFERRAL_REWARD_TYPES = [
  /** More qualified enquiries this month, on top of the plan's allowance. */
  'EXTRA_QUALIFIED_ENQUIRIES',
  /** A Spotlight placement for a bounded period. */
  'TEMPORARY_FEATURED',
  /** More time on an EXISTING subscription period. Never a payment, never an invoice. */
  'SUBSCRIPTION_EXTENSION',
] as const;
export type ReferralRewardType = (typeof REFERRAL_REWARD_TYPES)[number];

/**
 * The real BuildHub events a campaign can qualify on.
 *
 * Each is a thing that ACTUALLY HAPPENS in the product, observed where it
 * happens - not a synthetic milestone invented so a reward has something to
 * fire on.
 */
export const REFERRAL_QUALIFICATION_TYPES = [
  'ACCOUNT_VERIFIED',
  'PROVIDER_APPROVED',
  'PROFILE_COMPLETED',
  'FIRST_VALID_RFQ',
  'FIRST_VALID_QUOTATION_RESPONSE',
] as const;
export type ReferralQualificationType = (typeof REFERRAL_QUALIFICATION_TYPES)[number];

export const REFERRAL_CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'ended'] as const;
export type ReferralCampaignStatus = (typeof REFERRAL_CAMPAIGN_STATUSES)[number];

/**
 * A reward's life.
 *
 * PENDING is not decoration: a reward becomes GRANTED only once its EFFECT has
 * committed. A row that says GRANTED while the entitlement it promises does not
 * exist is worse than no row at all, because it is the one an administrator
 * quotes back to a vendor.
 */
export const REFERRAL_REWARD_STATUSES = ['PENDING', 'GRANTED', 'EXPIRED', 'REVERSED', 'REJECTED'] as const;
export type ReferralRewardStatus = (typeof REFERRAL_REWARD_STATUSES)[number];

export const REFERRAL_STATUSES = ['registered', 'qualified', 'rewarded', 'expired', 'revoked'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

/**
 * How long after signup a referral can still qualify, when a campaign does not
 * say otherwise.
 *
 * A campaign with no window would reward a signup from two years ago the moment
 * somebody finally verified their email, which is not what "referral campaign"
 * means to the person who budgeted it.
 */
export const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 90;

/** The bounds an administrator may choose within. */
export const MIN_ATTRIBUTION_WINDOW_DAYS = 1;
export const MAX_ATTRIBUTION_WINDOW_DAYS = 730;

/**
 * ── THE PLATFORM-WIDE BRAKE ────────────────────────────────────────────────
 *
 * Campaign caps bound ONE campaign. Nothing bounded an account across all of
 * them, so somebody running many invitations through a rotation of campaigns
 * could collect without limit - each campaign correctly reporting that its own
 * cap was intact.
 *
 * This is a fraud brake, not a business parameter: it sits far above what any
 * legitimate inviter reaches, and its job is to make a runaway visible rather
 * than to shape a campaign. The number a campaign owner actually tunes is
 * `perInviterCap`, per campaign, which is unchanged.
 *
 * NOT ADMINISTRABLE YET, and said plainly rather than faked: BuildHub has no
 * platform-settings table, and inventing one for a single number would be a
 * second configuration system beside the campaign rows that already exist.
 * When a settings surface lands this becomes a row in it.
 */
export const GLOBAL_REFERRAL_REWARD_CAP = 25;
