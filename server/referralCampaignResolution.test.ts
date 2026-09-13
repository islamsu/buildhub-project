import { describe, expect, it } from 'vitest';
import { chooseCampaign, type CampaignRow, type ResolutionInput } from './referralCampaignResolution';
import {
  REFERRAL_REWARD_TYPES, REFERRAL_QUALIFICATION_TYPES, REFERRAL_CAMPAIGN_STATUSES,
  REFERRAL_REWARD_STATUSES, REFERRAL_STATUSES, DEFAULT_ATTRIBUTION_WINDOW_DAYS,
  GLOBAL_REFERRAL_REWARD_CAP,
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

describe('a cap counts rewards that HAPPENED', () => {
  /*
   * A live probe found this: a REJECTED reward - one the application path
   * refused, so nothing was ever paid - consumed the inviter's one slot on
   * that campaign, and they could never be paid by it. A campaign
   * misconfiguration silently burned a vendor's entitlement.
   *
   * chooseCampaign takes the counts already tallied, so the rule lives in
   * capUsage; these pin the vocabulary that decides it.
   */
  it('names exactly the states that consume a cap', async () => {
    const source = readFileSync(new URL('./referralCampaignResolution.ts', import.meta.url), 'utf8');
    expect(source).toContain("new Set(['PENDING', 'GRANTED', 'EXPIRED', 'REVERSED'])");
    expect(source).not.toMatch(/COUNTS_TOWARD_CAP = new Set\(\[[^\]]*'REJECTED'/);
  });

  it('and the tally filters on that set rather than counting every row', () => {
    const source = readFileSync(new URL('./referralCampaignResolution.ts', import.meta.url), 'utf8');
    expect(source).toContain('if (!COUNTS_TOWARD_CAP.has(String(row.status))) continue;');
    // Grouping has to include status, or the filter has nothing to read.
    expect(source).toContain('referralRewards.status');
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
    expect(ENGINE).toContain('resolveReferralCampaign(');
  });

  it('and resolves UNDER THE LOCK, not on a loose connection', () => {
    /*
     * This read `resolveReferralCampaign(db, {`. The handle changed to `tx`
     * when the check-then-act race was closed - counting an inviter's rewards
     * and inserting the row that consumes the cap are now one locked step - so
     * the literal went stale while the behaviour it stood for got stronger.
     *
     * Restated to assert the stronger property directly: the count that decides
     * eligibility must happen on the transaction that holds the inviter's row,
     * or two simultaneous events both read "cap intact" and both pay out.
     */
    expect(ENGINE).toContain('resolveReferralCampaign(tx, {');
    expect(ENGINE).toContain("where(eq(users.id, referral.referrerId)).for('update')");
    // And the insert that consumes the cap is on the same handle.
    expect(ENGINE).toContain('await tx.insert(referralRewards).values({');
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

// ── ANTI-ABUSE ─────────────────────────────────────────────────────────────

describe('the platform-wide brake', () => {
  /*
   * Campaign caps each bound ONE campaign. Nothing bounded an account across
   * all of them, so somebody running many invitations through a rotation of
   * campaigns collected without limit while every campaign correctly reported
   * its own cap intact.
   */
  const many = () => [campaign({ id: 1, perInviterCap: 100 }), campaign({ id: 2, priority: 5, perInviterCap: 100 })];
  const usageWith = (globalForInviter: number) => ({ ...noUsage(), globalForInviter });

  it('lets a normal inviter through', () => {
    const result = choose(many(), {}, usageWith(3));
    expect(result.ok).toBe(true);
  });

  it('stops an account that has collected the platform limit, on EVERY campaign', () => {
    const result = choose(many(), {}, usageWith(GLOBAL_REFERRAL_REWARD_CAP));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Every candidate is refused for the SAME stated reason, so an
    // administrator reading it knows which rule fired.
    expect(result.rejections.map(r => r.reason)).toEqual(['global_cap_reached', 'global_cap_reached']);
  });

  it('the limit is a ceiling, not a target - one below still qualifies', () => {
    expect(choose(many(), {}, usageWith(GLOBAL_REFERRAL_REWARD_CAP - 1)).ok).toBe(true);
  });

  it('a caller that supplies no global count is not silently capped at zero', () => {
    // Older callers pass the two per-campaign maps only. Treating a missing
    // count as 0 used, rather than as "at the cap", is the safe default: the
    // per-campaign caps still apply.
    expect(chooseCampaign(many(), input(), noUsage()).ok).toBe(true);
  });

  it('the brake sits far above any campaign cap, so it never shapes a campaign', () => {
    expect(GLOBAL_REFERRAL_REWARD_CAP).toBeGreaterThan(10);
  });
});

describe('the cap query does not scan the whole ledger', () => {
  const SOURCE = readFileSync(new URL('./referralCampaignResolution.ts', import.meta.url), 'utf8');
  const capUsage = SOURCE.slice(SOURCE.indexOf('async function capUsage'), SOURCE.indexOf('export function chooseCampaign'));

  it('the per-campaign count is restricted to the candidates', () => {
    // This grouped the WHOLE reward ledger and filtered in JavaScript, on the
    // hot path of a real user action.
    expect(capUsage).toContain('inArray(referralRewards.campaignId, campaignIds)');
  });

  it('and the global count is restricted to the one inviter', () => {
    expect(capUsage).toContain('eq(referralRewards.recipientUserId, referrerId)');
  });

  it('both use the same rule about which states consume a cap', () => {
    // A REJECTED reward never happened; counting it globally but not per
    // campaign would make the two disagree about the same row.
    expect(capUsage).toContain('COUNTS_TOWARD_CAP.has(String(row.status))');
  });
});

describe('a referral code that goes nowhere is recorded', () => {
  const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
  const signup = ROUTERS.slice(ROUTERS.indexOf('const ownReferralCode = generateReferralCode();'));
  const branch = signup.slice(0, signup.indexOf('const [created] ='));

  it('the signup branch was actually found', () => {
    expect(branch).toContain('input.referralCode');
    expect(branch.length).toBeLessThan(4000);
  });

  it('an unusable code writes an audit event instead of being dropped in silence', () => {
    expect(branch).toContain("action: 'referral_code_unusable'");
  });

  it('it distinguishes a code nobody holds from a self-referral', () => {
    // Two different problems. One is somebody walking the code space; the other
    // is a user misreading their own screen.
    expect(branch).toContain('Self-referral attempted with own code');
    expect(branch).toContain('No account holds referral code');
  });

  it('and the signup still succeeds - it does not throw or refuse', () => {
    // Refusing would block a real registration over a typo in an optional
    // field, and telling the user would make signup an oracle for which codes
    // exist, which is exactly what a code-walker wants.
    expect(branch).not.toContain('TRPCError');
    expect(branch).not.toContain('referral code is not valid');
  });

  it('the action is in the closed audit vocabulary, so it can actually be written', () => {
    const audit = readFileSync(new URL('./_core/accountAudit.ts', import.meta.url), 'utf8');
    expect(audit).toContain("'referral_code_unusable'");
  });
});
