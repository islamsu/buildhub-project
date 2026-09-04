// ── The referral ledger, read truthfully ───────────────────────────────────
//
// `referralRewards.status` has an EXPIRED value and NOTHING HAS EVER WRITTEN
// IT. A bonus whose `expiresAt` passed last month still read GRANTED - to the
// administrator deciding whether to grant another, and to the vendor asking why
// their allowance had dropped.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { deriveRewardStatus, withDerivedStatus, liveRewards } from './referralRewardView';
import {
  splitCampaignEdit, refuseCampaignEdit, refuseCampaignDates,
  CAMPAIGN_TERM_FIELDS, CAMPAIGN_SCHEDULE_FIELDS, TERMS_FIXED_MESSAGE,
} from './referralCampaignEdit';

const NOW = new Date('2026-06-01T12:00:00Z');
const PAST = new Date('2026-05-01T00:00:00Z');
const FUTURE = new Date('2026-07-01T00:00:00Z');

describe('a reward that has run its course', () => {
  it('reads EXPIRED once its end date has passed, without anything having swept it', () => {
    expect(deriveRewardStatus({ status: 'GRANTED', expiresAt: PAST }, NOW)).toBe('EXPIRED');
  });

  it('is still GRANTED while the end date is ahead', () => {
    expect(deriveRewardStatus({ status: 'GRANTED', expiresAt: FUTURE }, NOW)).toBe('GRANTED');
  });

  it('expires exactly AT its end, not a moment after', () => {
    // A reward whose period closed at noon is not still running at noon.
    expect(deriveRewardStatus({ status: 'GRANTED', expiresAt: NOW }, NOW)).toBe('EXPIRED');
  });

  it('an open-ended reward never expires', () => {
    // Deriving EXPIRED from a missing date would retire every open-ended grant
    // the first time it was read.
    expect(deriveRewardStatus({ status: 'GRANTED', expiresAt: null }, NOW)).toBe('GRANTED');
    expect(deriveRewardStatus({ status: 'GRANTED' }, NOW)).toBe('GRANTED');
  });

  it('reads a date the driver handed back as a string', () => {
    // mysql2 can return a DATETIME as a string depending on configuration.
    expect(deriveRewardStatus({ status: 'GRANTED', expiresAt: '2026-05-01 00:00:00' }, NOW)).toBe('EXPIRED');
    expect(deriveRewardStatus({ status: 'GRANTED', expiresAt: '2026-07-01 00:00:00' }, NOW)).toBe('GRANTED');
  });

  it('an unparseable date leaves the reward alone rather than retiring it', () => {
    // Guessing EXPIRED from a value nobody can read would take away a benefit
    // over a data problem.
    expect(deriveRewardStatus({ status: 'GRANTED', expiresAt: 'not a date' }, NOW)).toBe('GRANTED');
  });
});

describe('a decision somebody made is not undone by time', () => {
  it.each(['REVERSED', 'REJECTED', 'PENDING', 'EXPIRED'])('%s stays as stored, even with a past end date', status => {
    expect(deriveRewardStatus({ status, expiresAt: PAST }, NOW)).toBe(status);
  });

  it('a reversed reward does not become a lapsed one', () => {
    // An administrator withdrew this. Reporting it as EXPIRED would erase the
    // fact that somebody made that decision.
    expect(deriveRewardStatus({ status: 'REVERSED', expiresAt: PAST }, NOW)).toBe('REVERSED');
  });
});

describe('what the reader is handed', () => {
  it('carries the derived status AND keeps the stored one', () => {
    const row = withDerivedStatus({ id: 1, status: 'GRANTED', expiresAt: PAST }, NOW);
    expect(row.status).toBe('EXPIRED');
    expect(row.storedStatus).toBe('GRANTED');
    // The rest of the row is untouched.
    expect(row.id).toBe(1);
  });

  it('liveRewards is what the vendor HAS, not what they once had', () => {
    const live = liveRewards([
      { id: 1, status: 'GRANTED', expiresAt: FUTURE },
      { id: 2, status: 'GRANTED', expiresAt: PAST },
      { id: 3, status: 'REVERSED', expiresAt: FUTURE },
      { id: 4, status: 'REJECTED', expiresAt: null },
    ], NOW);
    expect(live.map(r => r.id)).toEqual([1]);
  });
});

describe('the derived status agrees with the cap rule', () => {
  it('EXPIRED still counts toward a campaign cap, so deriving it changes no entitlement', () => {
    // referralCampaignResolution counts PENDING, GRANTED, EXPIRED and REVERSED
    // toward a cap. If EXPIRED did NOT count, deriving it here would silently
    // hand every inviter their cap back the moment a reward lapsed.
    const source = readFileSync(new URL('./referralCampaignResolution.ts', import.meta.url), 'utf8');
    const line = source.match(/COUNTS_TOWARD_CAP = new Set\(\[([^\]]*)\]/);
    expect(line, 'the cap set was not found').toBeTruthy();
    expect(line![1]).toContain("'EXPIRED'");
    expect(line![1]).toContain("'GRANTED'");
    // REJECTED never happened, so it must NOT consume a cap.
    expect(line![1]).not.toContain("'REJECTED'");
  });
});

describe("an inviter's own reward history names nobody they invited", () => {
  /*
   * A referral code can be posted publicly. Anyone who signs up through it
   * becomes a row in the inviter's history, and rendering their name or address
   * would hand a stranger's identity to whoever posted the code - which is not
   * something they agreed to by clicking a link.
   *
   * MUTATION PROOF: add `referredName: users.name` to the select in
   * listMyReferralRewards and the first assertion fails naming the column.
   */
  const SOURCE = readFileSync(new URL('./referralRewardView.ts', import.meta.url), 'utf8');
  // Bounded to the one function, for the reason spelled out below.
  const selfScoped = SOURCE.slice(
    SOURCE.indexOf('export async function listMyReferralRewards'),
    SOURCE.indexOf('export async function myReferralCounts'),
  );

  it('the self-scoped query was actually found', () => {
    expect(selfScoped.length).toBeGreaterThan(200);
    expect(selfScoped).toContain('referralRewards.recipientUserId');
  });

  it('selects no column that identifies another person', () => {
    for (const column of ['users.name', 'users.email', 'users.phone', 'users.username', 'referrals.referredId']) {
      expect(selfScoped, `${column} would expose somebody the inviter did not agree to name`)
        .not.toContain(column);
    }
  });

  it('is scoped to the caller by the recipient column, not by an input', () => {
    // A userId in the input would be a field a client could change.
    expect(selfScoped).toContain('eq(referralRewards.recipientUserId, userId)');
  });
});

describe('the administrator surfaces do not truncate silently', () => {
  const SOURCE = readFileSync(new URL('./referralRewardView.ts', import.meta.url), 'utf8');

  /*
   * ONE FUNCTION, BOUNDED.
   *
   * The first version of this sliced from a function's name to the END OF THE
   * FILE, so an assertion about `listReferralRewards` was satisfied by
   * `listAdminReferrals` further down. Deleting the total from the first
   * function passed. A source assertion is only as good as the region it reads.
   */
  function bodyOf(name: string): string {
    const start = SOURCE.indexOf(`export async function ${name}`);
    expect(start, `${name} not found`).toBeGreaterThan(-1);
    const next = SOURCE.indexOf('\nexport ', start + 1);
    return SOURCE.slice(start, next === -1 ? SOURCE.length : next);
  }

  it('the extraction reads ONE function, not everything after it', () => {
    // The bug this helper exists to prevent, asserted directly.
    expect(bodyOf('listReferralRewards')).not.toContain('listAdminReferrals');
    expect(bodyOf('listMyReferralRewards')).not.toContain('myReferralCounts');
  });

  it.each(['listReferralRewards', 'listAdminReferrals'])('%s returns a total beside its rows', name => {
    const body = bodyOf(name);
    expect(body).toContain('count(*)');
    expect(body).toContain('total:');
    expect(body).toContain('.offset(');
  });

  it('the referral list filters in the QUERY, not over the page it fetched', () => {
    // Filtering client-side over a truncated result answers "no matches" for a
    // row it never loaded - confidently, and wrongly.
    const body = bodyOf('listAdminReferrals');
    expect(body).toContain('like(users.name');
    expect(body).toContain('eq(referrals.status');
  });

  it('the referral list reads rewards in a SECOND query, so one referral is one row', () => {
    // A join would multiply a referral across its reward rows, turning one
    // invitation into two lines in a list an administrator counts.
    expect(bodyOf('listAdminReferrals')).toContain('inArray(referralRewards.referralId, ids)');
  });
});

describe('the screens read the real reward, not the dead columns', () => {
  const ADMIN = readFileSync(new URL('../client/src/components/AdminReferrals.tsx', import.meta.url), 'utf8');

  it('AdminReferrals renders the joined reward ledger', () => {
    // `referrals.rewardType` / `.rewardValue` / `.rewardExpiresAt` are never
    // written, so the old Reward column was permanently "-" on every row.
    // The referral row now renders the joined ledger instead.
    expect(ADMIN).toContain('<td className="p-2">{rewardSummary(row)}</td>');
    expect(ADMIN).toContain('const list = (row.rewards ?? []) as any[];');
    // `rewardExpiresAt` belongs to `referrals` alone, so unlike `rewardType`
    // - which the reward LEDGER also has - its presence anywhere in this file
    // can only be a read of a dead column.
    expect(ADMIN).not.toContain('rewardExpiresAt');
  });

  it('and the server never selects the dead referral columns either', () => {
    // The screen is only as honest as the query behind it.
    const SOURCE = readFileSync(new URL('./referralRewardView.ts', import.meta.url), 'utf8');
    const start = SOURCE.indexOf('export async function listAdminReferrals');
    const next = SOURCE.indexOf('\nexport ', start + 1);
    const body = SOURCE.slice(start, next === -1 ? SOURCE.length : next);
    for (const dead of ['referrals.rewardType', 'referrals.rewardValue', 'referrals.rewardExpiresAt']) {
      expect(body, `${dead} has never been written by anything`).not.toContain(dead);
    }
  });

  it('and it can withdraw one, which no screen could do before', () => {
    expect(ADMIN).toContain('trpc.admin.referralRewards.useQuery');
    expect(ADMIN).toContain('trpc.admin.reverseReferralReward.useMutation');
    expect(ADMIN).toContain('trpc.admin.qualifyReferral.useMutation');
  });

  it('a failed fetch is shown as a failure, not as an empty programme', () => {
    expect(ADMIN).toContain('referrals.isError ? (');
    expect(ADMIN).toContain('rewards.isError ? (');
    expect(ADMIN).toContain('<LoadFailed');
  });

  it('and it states no record count until it actually has one', () => {
    /*
     * `total ?? 0` printed a confident "0 records" while the query was still in
     * flight - and on a failed query too, since the pager renders outside the
     * error branch. An administrator glancing at that reads "no referrals":
     * the same defect as an empty state standing in for a failure, in a smaller
     * place. Found by a live browser probe, which caught the loading state.
     */
    expect(ADMIN).not.toContain('total={referrals.data?.total ?? 0}');
    expect(ADMIN).not.toContain('total={rewards.data?.total ?? 0}');
    expect(ADMIN).toContain('total={referrals.data?.total ?? null}');
    expect(ADMIN).toContain('total={rewards.data?.total ?? null}');
    /*
     * The control itself is now SHARED - the dispute queue needs the same one,
     * and a second copy would be a second place for this correction to be
     * missing from. Asserted where it lives, and asserted that this screen
     * still uses that one rather than having grown its own back.
     */
    const PAGER = readFileSync(new URL('../client/src/components/Pager.tsx', import.meta.url), 'utf8');
    expect(PAGER).toContain('total === null');
    expect(PAGER).toContain("'Counting…'");
    expect(PAGER).toContain("'جارٍ الحساب…'");
    expect(ADMIN).toContain("import { Pager } from '@/components/Pager'");
    expect(ADMIN).not.toContain('function Pager(');
  });

  it("the inviter's own screen shows the rewards, and does not promise one", () => {
    const MINE = readFileSync(new URL('../client/src/components/ReferralInviteEarn.tsx', import.meta.url), 'utf8');
    expect(MINE).toContain('data.rewards');
    expect(MINE).toContain('referral-rewards');
    // Zero rewards is a real answer, stated plainly.
    expect(MINE).toContain('No referral reward has been granted to you yet.');
    expect(MINE).toContain('لم تُمنح لك أي مكافأة إحالة حتى الآن.');
  });
});

// ── Campaign administration ────────────────────────────────────────────────

describe('a campaign can be corrected, but not rewritten after it has paid', () => {
  /*
   * THESE WERE SOURCE ASSERTIONS AND THEY DID NOT HOLD.
   *
   * The first version checked that the update procedure's TEXT contained a
   * count query and a message. Replacing the condition with `if (false)` -
   * letting a paid-out campaign's terms be rewritten - left both strings in
   * place and the tests passed. So did moving `status` into the frozen half,
   * which would have stopped an administrator pausing a live campaign.
   *
   * The rule now lives in server/referralCampaignEdit.ts as code, and these
   * exercise it. A mutation of the predicate or of either field list fails a
   * real assertion rather than slipping past a grep.
   */
  const schedule = { name: 'New name', status: 'paused', perInviterCap: 3 };
  const promise = { rewardValue: '9', qualificationType: 'FIRST_VALID_RFQ' };

  it('splits an edit into the half that is always allowed and the half that is not', () => {
    const split = splitCampaignEdit({ ...schedule, ...promise });
    expect(Object.keys(split.schedule).sort()).toEqual(['name', 'perInviterCap', 'status']);
    expect(Object.keys(split.terms).sort()).toEqual(['qualificationType', 'rewardValue']);
  });

  it('drops a field that is on neither list rather than writing it', () => {
    // Passing an unlisted name through to `set()` would be a way to write
    // columns this procedure never meant to expose.
    const split = splitCampaignEdit({ name: 'ok', createdBy: 99, id: 1, totallyMadeUp: true });
    expect(split.schedule).toEqual({ name: 'ok' });
    expect(split.terms).toEqual({});
  });

  it('ignores fields the caller did not supply', () => {
    expect(splitCampaignEdit({ name: undefined, rewardValue: undefined })).toEqual({ schedule: {}, terms: {} });
  });

  it('a campaign that has paid NOTHING can have its terms corrected', () => {
    expect(refuseCampaignEdit(splitCampaignEdit(promise).terms, 0)).toBeNull();
  });

  it('a campaign that HAS paid cannot, and is told why', () => {
    const refusal = refuseCampaignEdit(splitCampaignEdit(promise).terms, 1);
    expect(refusal).toBe(TERMS_FIXED_MESSAGE);
    expect(refusal).toMatch(/schedule and caps can still be changed/i);
  });

  it('ONE granted reward is enough - the freeze is not a threshold', () => {
    expect(refuseCampaignEdit({ rewardValue: '9' }, 1)).not.toBeNull();
  });

  it('and the schedule stays editable on a campaign that has paid out', () => {
    /*
     * The freeze must not become a blanket lock. Pausing or ending a live
     * campaign is exactly what an administrator needs to do in a hurry, and a
     * freeze that caught those would be worse than the gap it closed.
     */
    const split = splitCampaignEdit(schedule);
    expect(split.terms).toEqual({});
    expect(refuseCampaignEdit(split.terms, 500)).toBeNull();
    expect(split.schedule.status).toBe('paused');
  });

  it('every term field is actually frozen, one by one', () => {
    for (const field of CAMPAIGN_TERM_FIELDS) {
      const split = splitCampaignEdit({ [field]: 'x' });
      expect(Object.keys(split.terms), `${field} is not treated as a term`).toEqual([field]);
      expect(refuseCampaignEdit(split.terms, 1), `${field} is not frozen`).toBe(TERMS_FIXED_MESSAGE);
    }
  });

  it('and every schedule field is actually free, one by one', () => {
    for (const field of CAMPAIGN_SCHEDULE_FIELDS) {
      const split = splitCampaignEdit({ [field]: 'x' });
      expect(Object.keys(split.schedule), `${field} is not treated as schedule`).toEqual([field]);
      expect(refuseCampaignEdit(split.terms, 999), `${field} was frozen`).toBeNull();
    }
  });

  it('the two lists do not overlap', () => {
    // A field on both would be silently frozen or silently free depending on
    // which check ran first.
    const overlap = (CAMPAIGN_TERM_FIELDS as readonly string[])
      .filter(field => (CAMPAIGN_SCHEDULE_FIELDS as readonly string[]).includes(field));
    expect(overlap).toEqual([]);
  });

  it('the dates are re-checked AFTER an edit, not only at creation', () => {
    // Moving a start date past an existing end date produced a campaign that
    // could never be eligible, silently.
    expect(refuseCampaignDates(new Date('2026-06-01'), new Date('2026-05-01'))).toMatch(/after its start date/);
    expect(refuseCampaignDates(new Date('2026-06-01'), new Date('2026-06-01'))).toMatch(/after its start date/);
    expect(refuseCampaignDates(new Date('2026-06-01'), new Date('2026-07-01'))).toBeNull();
    // An open-ended campaign is not a date error.
    expect(refuseCampaignDates(new Date('2026-06-01'), null)).toBeNull();
    expect(refuseCampaignDates(null, new Date('2026-07-01'))).toBeNull();
  });

  it('the router routes through the rule rather than restating it', () => {
    // The one thing a behavioural test cannot see: that the procedure calls it.
    const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const update = ROUTERS.slice(
      ROUTERS.indexOf('updateReferralCampaign: adminWith'),
      ROUTERS.indexOf('referralRewards: adminWith'),
    );
    expect(update).toContain('splitCampaignEdit({');
    expect(update).toContain('refuseCampaignEdit(terms, grantedRewards)');
    expect(update).toContain('refuseCampaignDates(');
    // And the count it passes is the campaign's own granted rewards.
    expect(update).toContain('.from(referralRewards).where(eq(referralRewards.campaignId, input.campaignId))');
  });

  it('the attribution window is settable at creation, not only defaulted', () => {
    // Every campaign ever created took the column default, so a short-lived
    // promotion could not say so.
    const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const create = ROUTERS.slice(
      ROUTERS.indexOf('createReferralCampaign: adminWith'),
      ROUTERS.indexOf('updateReferralCampaign: adminWith'),
    );
    expect(create).toContain('attributionWindowDays: z.number()');
    expect(create).toContain('attributionWindowDays: input.attributionWindowDays');
  });

  it('the campaign screen exists and can change a status', () => {
    const ADMIN = readFileSync(new URL('../client/src/components/AdminReferrals.tsx', import.meta.url), 'utf8');
    expect(ADMIN).toContain('trpc.admin.referralCampaigns.useQuery');
    expect(ADMIN).toContain('trpc.admin.updateReferralCampaign.useMutation');
    expect(ADMIN).toContain('tab-referral-campaigns');
    // And it states the freeze rule, so an administrator learns it before
    // trying rather than from an error.
    expect(ADMIN).toContain('campaign-terms-note');
    expect(ADMIN).toContain('fixed once it has granted its first reward');
  });

  it('with a truthful empty state that says WHY it matters', () => {
    const ADMIN = readFileSync(new URL('../client/src/components/AdminReferrals.tsx', import.meta.url), 'utf8');
    // No campaigns is not a neutral fact: it is the reason no reward can be
    // granted, which is the state this whole subsystem was found in.
    expect(ADMIN).toContain('No referral campaigns exist. No reward can be granted');
  });
});
