import { describe, expect, it } from 'vitest';
import { chooseCampaign, type CampaignRow, type ResolutionInput } from './referralCampaignResolution';
import {
  REFERRAL_REWARD_TYPES, REFERRAL_QUALIFICATION_TYPES, REFERRAL_CAMPAIGN_STATUSES,
  REFERRAL_REWARD_STATUSES, REFERRAL_STATUSES, DEFAULT_ATTRIBUTION_WINDOW_DAYS,
} from '@shared/referralRewards';
import { readFileSync } from 'node:fs';

/**
 * WHICH CAMPAIGN REWARDS THIS REFERRAL.
 *
 * The engine read `referrals.campaignId` and nothing ever wrote it, so every
 * referral short-circuited at 'no campaign' and no reward has ever been granted
 * by the product. The owner's decision is LATE BINDING AT QUALIFICATION, and
 * these are the rules that make that safe rather than arbitrary.
 */

const DAY = 24 * 60 * 60 * 1000;
const EVENT_AT = new Date('2026-06-01T12:00:00Z');

const campaign = (over: Partial<CampaignRow> = {}): CampaignRow => ({
  id: 1,
  name: 'Campaign One',
  status: 'active',
  startsAt: null,
  endsAt: null,
  eligibleInviterRoles: JSON.stringify(['supplier', 'contractor']),
  eligibleReferredRoles: JSON.stringify(['homeowner']),
  qualificationType: 'ACCOUNT_VERIFIED',
  rewardType: 'EXTRA_QUALIFIED_ENQUIRIES',
  rewardValue: '5',
  rewardDurationDays: 30,
  perInviterCap: 1,
  campaignCap: null,
  priority: 0,
  attributionWindowDays: DEFAULT_ATTRIBUTION_WINDOW_DAYS,
  ...over,
});

const input = (over: Partial<ResolutionInput> = {}): ResolutionInput => ({
  qualificationType: 'ACCOUNT_VERIFIED',
  referredAt: new Date(EVENT_AT.getTime() - 10 * DAY),
  inviterRole: 'supplier',
  referredRole: 'homeowner',
  referrerId: 42,
  eventAt: EVENT_AT,
  ...over,
});

const noUsage = () => ({ perCampaign: new Map<number, number>(), perInviter: new Map<number, number>() });
const choose = (campaigns: CampaignRow[], over: Partial<ResolutionInput> = {}, usage = noUsage()) =>
  chooseCampaign(campaigns, input(over), usage);

describe('the vocabulary matches the columns it describes', () => {
  // Three copies of each list existed - the schema enum, the ledger enum and a
  // z.enum in the router. The schema has to declare its own; this holds the
  // shared copy against it so they cannot drift.
  const SCHEMA = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');

  it.each([
    ['reward types', REFERRAL_REWARD_TYPES],
    ['qualification types', REFERRAL_QUALIFICATION_TYPES],
    ['campaign statuses', REFERRAL_CAMPAIGN_STATUSES],
    ['reward statuses', REFERRAL_REWARD_STATUSES],
    ['referral statuses', REFERRAL_STATUSES],
  ])('every %s value appears in the schema', (_label, values) => {
    for (const value of values) expect(SCHEMA, `${value} is not a column value`).toContain(`'${value}'`);
  });

  it('the schema carries the two columns late binding needs', () => {
    expect(SCHEMA).toContain("priority:             int('priority')");
    expect(SCHEMA).toContain("attributionWindowDays: int('attributionWindowDays')");
  });
});

describe('a campaign is chosen from what is eligible NOW', () => {
  it('picks the only eligible campaign', () => {
    const result = choose([campaign()]);
    expect(result.ok && result.campaign.id).toBe(1);
  });

  it('reports no campaign when the taxonomy of events has none', () => {
    const result = choose([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.considered).toBe(0);
  });
});

describe('THE SAME INPUT ALWAYS SELECTS THE SAME CAMPAIGN', () => {
  it('higher priority wins', () => {
    const result = choose([campaign({ id: 1, priority: 0 }), campaign({ id: 2, priority: 10 })]);
    expect(result.ok && result.campaign.id).toBe(2);
  });

  it('a tie breaks on id, not on the order the rows arrived in', () => {
    // The failure this prevents: resolution depending on whatever order the
    // database happened to return. A vendor asking why they got one reward and
    // not another must get a reproducible answer.
    const forwards = choose([campaign({ id: 7 }), campaign({ id: 3 })]);
    const backwards = choose([campaign({ id: 3 }), campaign({ id: 7 })]);
    expect(forwards.ok && forwards.campaign.id).toBe(3);
    expect(backwards.ok && backwards.campaign.id).toBe(3);
  });

  it('the answer is stable across repeated calls', () => {
    const rows = [campaign({ id: 5, priority: 2 }), campaign({ id: 9, priority: 2 }), campaign({ id: 1, priority: 1 })];
    const answers = new Set(Array.from({ length: 20 }, () => {
      const r = chooseCampaign(rows, input(), noUsage());
      return r.ok ? r.campaign.id : 0;
    }));
    expect(answers).toEqual(new Set([5]));
  });
});

describe('ELIGIBILITY FIRST, PRIORITY SECOND', () => {
  it('an EXHAUSTED campaign cannot win on priority', () => {
    /*
     * The rule that makes caps part of eligibility rather than a later check.
     * If the exhausted high-priority campaign won here, the referral would be
     * bound to a campaign that owes it nothing - qualified, with no reward, and
     * unable to try the campaign that would have paid.
     */
    const usage = { perCampaign: new Map<number, number>(), perInviter: new Map([[2, 1]]) };
    const result = choose([campaign({ id: 1, priority: 0 }), campaign({ id: 2, priority: 99 })], {}, usage);
    expect(result.ok && result.campaign.id).toBe(1);
  });

  it('a campaign at its overall cap is not a candidate', () => {
    const usage = { perCampaign: new Map([[2, 50]]), perInviter: new Map<number, number>() };
    const result = choose([campaign({ id: 1 }), campaign({ id: 2, priority: 99, campaignCap: 50 })], {}, usage);
    expect(result.ok && result.campaign.id).toBe(1);
  });

  it('a cap counts THIS inviter, not everyone', () => {
    // Another inviter having taken the campaign's rewards must not exclude
    // this one while the overall cap has room.
    const usage = { perCampaign: new Map([[1, 40]]), perInviter: new Map<number, number>() };
    expect(choose([campaign({ id: 1, campaignCap: 100 })], {}, usage).ok).toBe(true);
  });

  it.each([
    ['a draft campaign', { status: 'draft' }, 'not_active'],
    ['a paused campaign', { status: 'paused' }, 'not_active'],
    ['an ended campaign', { status: 'ended' }, 'not_active'],
    ['one for a different event', { qualificationType: 'FIRST_VALID_RFQ' }, 'qualification_mismatch'],
    ['one that has not started', { startsAt: new Date(EVENT_AT.getTime() + DAY) }, 'not_started'],
    ['one whose window has closed', { endsAt: new Date(EVENT_AT.getTime() - DAY) }, 'ended'],
    ['one the inviter\'s role is not eligible for', { eligibleInviterRoles: JSON.stringify(['engineer']) }, 'inviter_role'],
    ['one the referred role is not eligible for', { eligibleReferredRoles: JSON.stringify(['architect']) }, 'referred_role'],
  ])('%s is not a candidate, and says why', (_label, over, reason) => {
    const result = choose([campaign(over as Partial<CampaignRow>)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejections[0].reason).toBe(reason);
  });
});

describe('the attribution window is part of eligibility', () => {
  it('a referral inside the window qualifies', () => {
    expect(choose([campaign({ attributionWindowDays: 90 })],
      { referredAt: new Date(EVENT_AT.getTime() - 89 * DAY) }).ok).toBe(true);
  });

  it('a referral OLDER than the window does not', () => {
    // A signup from two years ago must not earn a reward because somebody
    // finally verified their email.
    const result = choose([campaign({ attributionWindowDays: 90 })],
      { referredAt: new Date(EVENT_AT.getTime() - 400 * DAY) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejections[0].reason).toBe('outside_attribution_window');
  });

  it('the window is measured from the REFERRAL, not from the campaign', () => {
    // A campaign that started yesterday still honours a referral from within
    // its window - the window is a property of the invitation's age.
    expect(choose([campaign({ attributionWindowDays: 30, startsAt: new Date(EVENT_AT.getTime() - DAY) })],
      { referredAt: new Date(EVENT_AT.getTime() - 20 * DAY) }).ok).toBe(true);
  });

  it('a campaign may set a shorter window than the default and it is respected', () => {
    const result = choose([campaign({ attributionWindowDays: 7 })],
      { referredAt: new Date(EVENT_AT.getTime() - 10 * DAY) });
    expect(result.ok).toBe(false);
  });
});

describe('the refusal is actionable, not just "no campaign"', () => {
  it('names every campaign it considered and why each was refused', () => {
    const result = choose([
      campaign({ id: 1, name: 'Ended one', status: 'ended' }),
      campaign({ id: 2, name: 'Wrong event', qualificationType: 'FIRST_VALID_RFQ' }),
      campaign({ id: 3, name: 'Too old', attributionWindowDays: 1 }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.considered).toBe(3);
      // Note the two distinct reasons a campaign can be "over": status 'ended'
      // is not_active (an administrator closed it), while `ended` is the DATE
      // check (its own endsAt has passed). Collapsing them would lose which.
      expect(result.rejections.map(r => r.reason).sort())
        .toEqual(['not_active', 'outside_attribution_window', 'qualification_mismatch']);
      expect(result.rejections.map(r => r.name)).toContain('Too old');
    }
  });
});

describe('the engine actually binds what the resolver returns', () => {
  const ENGINE = readFileSync(new URL('./referralEngine.ts', import.meta.url), 'utf8');

  it('calls the resolver rather than reading a campaignId nobody writes', () => {
    expect(ENGINE).toContain('resolveReferralCampaign(db, {');
  });

  it('WRITES the resolved campaign onto the referral', () => {
    // The whole defect in one line: without this the row still has no campaign
    // and the next event resolves all over again.
    expect(ENGINE).toContain('campaignId: campaign.id,');
  });

  it('honours a campaignId that is already set rather than overriding it', () => {
    expect(ENGINE).toContain('if (referral.campaignId) {');
  });

  it('refuses to re-qualify a referral that already holds a reward', () => {
    // ONE REFERRAL, ONE CAMPAIGN, ONE REWARD - and this is the check that stops
    // a better campaign tomorrow from moving a referral that already paid.
    const guard = ENGINE.slice(ENGINE.indexOf('const [rewardCount]'), ENGINE.indexOf('const [referrerRow'));
    expect(guard).toContain("already_qualified");
  });
});
