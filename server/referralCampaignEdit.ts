/**
 * WHAT MAY BE CHANGED ON A CAMPAIGN, AND WHEN.
 *
 * `updateReferralCampaign` accepted name, status, dates and caps only. A
 * campaign owner who got the reward value or the eligible roles wrong had no
 * way to correct them: the only remedy was to end the campaign and create
 * another, which loses its history and its identity.
 *
 * THE RULE, in one place rather than spread through a mutation:
 *
 *   SCHEDULE fields govern what happens NEXT - the name, the status, the dates,
 *   the caps. Always editable. Pausing or ending a live campaign is exactly
 *   what an administrator needs to be able to do in a hurry, and a freeze that
 *   caught those would be worse than the gap it closed.
 *
 *   TERM fields are the PROMISE - who qualifies, on what event, for what
 *   reward, within what window. Editable until the campaign has granted its
 *   first reward, and fixed after.
 *
 * WHY FIXED RATHER THAN VERSIONED. The reward is snapshotted onto the ledger
 * row when it is granted, so an edit never changes what anybody already
 * received. The problem is the reading: an administrator investigating "why did
 * this vendor get 5" would open the campaign and see 9, and the ledger would
 * appear to disagree with the campaign it names. What was promised is not
 * rewritten after it has been given.
 *
 * This lives apart from the router so the rule is testable as a rule, rather
 * than only assertable as the text of a mutation.
 */

/** Governs what happens NEXT. Always editable. */
export const CAMPAIGN_SCHEDULE_FIELDS = [
  'name', 'status', 'startsAt', 'endsAt', 'perInviterCap', 'campaignCap',
] as const;

/** The promise. Editable only before the campaign has paid anything out. */
export const CAMPAIGN_TERM_FIELDS = [
  'eligibleInviterRoles', 'eligibleReferredRoles', 'qualificationType',
  'rewardType', 'rewardValue', 'rewardDurationDays', 'attributionWindowDays',
] as const;

export type CampaignScheduleField = (typeof CAMPAIGN_SCHEDULE_FIELDS)[number];
export type CampaignTermField = (typeof CAMPAIGN_TERM_FIELDS)[number];

export const TERMS_FIXED_MESSAGE =
  'This campaign has already granted rewards, so its terms are fixed. '
  + 'Its schedule and caps can still be changed, or end it and create a replacement.';

/**
 * Split a requested edit into the half that is always allowed and the half that
 * is not. Fields the caller did not supply are absent from both.
 */
export function splitCampaignEdit(
  patch: Record<string, unknown>,
): { schedule: Record<string, unknown>; terms: Record<string, unknown> } {
  const schedule: Record<string, unknown> = {};
  const terms: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if ((CAMPAIGN_TERM_FIELDS as readonly string[]).includes(key)) terms[key] = value;
    else if ((CAMPAIGN_SCHEDULE_FIELDS as readonly string[]).includes(key)) schedule[key] = value;
    // Anything else is not an editable column and is dropped rather than
    // written: a field name that is not on either list is a mistake, and
    // passing it through to `set()` would be a way to write columns this
    // procedure never meant to expose.
  }
  return { schedule, terms };
}

/**
 * Why this edit must be refused, or null if it may proceed.
 *
 * A campaign that has paid NOTHING can still be corrected. One that has cannot
 * have its promise rewritten - but only the term half is refused, and only when
 * the caller actually asked to change one.
 */
export function refuseCampaignEdit(
  terms: Record<string, unknown>,
  grantedRewards: number,
): string | null {
  if (Object.keys(terms).length === 0) return null;
  return grantedRewards > 0 ? TERMS_FIXED_MESSAGE : null;
}

/**
 * The dates must still make sense AFTER the edit, not only at creation.
 * Moving a start date past an existing end date produced a campaign that could
 * never be eligible, silently.
 */
export function refuseCampaignDates(
  startsAt: Date | string | null | undefined,
  endsAt: Date | string | null | undefined,
): string | null {
  if (!startsAt || !endsAt) return null;
  return new Date(endsAt).getTime() <= new Date(startsAt).getTime()
    ? 'Campaign end date must be after its start date'
    : null;
}
