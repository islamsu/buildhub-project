import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from './_testing/sourceText';

/**
 * SUBSCRIPTION_EXTENSION - the owner's third decision.
 *
 * "This reward may extend a legitimate existing subscription period, but it
 * must NEVER fabricate: payment, invoice, transaction, revenue, GMV,
 * commission, card charge, payment confirmation, paid renewal. Do not extend
 * from Date.now() when the user already has unused subscription time. Never
 * shorten current/paid/manually granted subscription period."
 *
 * The date arithmetic is checked behaviourally below; these hold the SHAPE of
 * the implementation against the parts of that decision a unit test can see -
 * chiefly that it invents no money.
 */

const LIFECYCLE = stripComments(readFileSync(new URL('./billing/lifecycle.ts', import.meta.url), 'utf8'));
const ENGINE = stripComments(readFileSync(new URL('./referralEngine.ts', import.meta.url), 'utf8'));
const block = LIFECYCLE.slice(
  LIFECYCLE.indexOf('export async function extendSubscriptionPeriod'),
  LIFECYCLE.indexOf('export async function recordPaymentFailure'),
);

describe('the extension exists and is reachable from the reward', () => {
  it('the lifecycle exports it', () => {
    expect(block.length).toBeGreaterThan(200);
  });

  it('and the referral engine actually calls it', () => {
    expect(ENGINE).toContain('extendSubscriptionPeriod({');
    expect(ENGINE).toContain("campaign.rewardType === 'SUBSCRIPTION_EXTENSION'");
  });

  it('SUBSCRIPTION_EXTENSION is no longer refused as unimplemented', () => {
    expect(ENGINE).not.toContain('is not yet applied by BuildHub');
  });
});

describe('IT FABRICATES NO MONEY', () => {
  it.each([
    'amount', 'price', 'invoice', 'payment', 'paid', 'charge', 'revenue',
    'commission', 'transaction', 'renewal', 'receipt', 'refund',
  ])('the extension writes no %s field', (field) => {
    // Matched as an ASSIGNMENT, so the words may still appear in a refusal
    // message or a variable read - what must not happen is this function
    // writing one.
    expect(block, `the extension appears to write a ${field}`)
      .not.toMatch(new RegExp(`\\b${field}\\w*\\s*:`, 'i'));
  });

  it('writes only the two date columns, and no other subscription field', () => {
    /*
     * Checked against the REAL column list rather than by pattern-matching the
     * return statements - the first version of this test did the latter and
     * missed the ternary that carries the actual patch, so it was asserting
     * the shape of the guard clauses instead of the shape of the write.
     */
    expect(block).toContain('{ trialEndsAt: extended }');
    expect(block).toContain('{ currentPeriodEnd: extended }');

    const SCHEMA = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');
    const table = SCHEMA.slice(SCHEMA.indexOf('export const vendorSubscriptions = mysqlTable'));
    const columns = Array.from(table.slice(0, table.indexOf('}, table =>')).matchAll(/^\s{2}(\w+):/gm))
      .map(m => m[1])
      .filter(name => name !== 'trialEndsAt' && name !== 'currentPeriodEnd');
    expect(columns.length, 'the column sweep found nothing - the rule would be vacuous').toBeGreaterThan(5);

    // Scoped to the DECIDE CALLBACK, which is where the patch is built. The
    // whole function also declares its own params - `userId: number` there is
    // an argument, not a column being written, and scanning it flagged that.
    const decide = block.slice(block.indexOf('async (locked, at) => {'));
    const written = columns.filter(name => new RegExp(`\\b${name}\\s*:`).test(decide));
    expect(written, `the extension writes subscription fields it should not: ${written.join(', ')}`).toEqual([]);
  });

  it('its history action is named for what happened, not for a renewal', () => {
    expect(block).toContain("'subscription_extended'");
    expect(block).not.toContain("'payment_succeeded'");
    expect(block).not.toContain("'subscription_renewed'");
  });
});

describe('THE THREE RULES', () => {
  it('extends from the EXISTING end date, never from now', () => {
    // Extending from `now` would confiscate a vendor's unused time and call it
    // a reward. The anchor is the stored end date.
    expect(block).toContain('anchorDate.getTime() + params.days');
    expect(block).not.toMatch(/now\.getTime\(\)\s*\+\s*params\.days/);
  });

  it('prefers the TRIAL end date while a trial is running', () => {
    // Extending a trial is extending the access the vendor actually has;
    // moving currentPeriodEnd instead would change nothing they can feel.
    expect(block).toContain('current.inTrial && locked.trialEndsAt');
  });

  it('REFUSES when there is no finite period, rather than inventing one', () => {
    expect(block).toContain('no finite subscription period to extend');
    // The refusal says why in the product's own terms, not "null".
    expect(block).toContain('granting paid access nobody decided to give');
  });

  it('cannot move a period BACKWARDS, however it is called', () => {
    expect(block).toContain('extended.getTime() <= anchorDate.getTime()');
    expect(block).toContain('would not move the period forward');
  });

  it('refuses a non-positive or fractional number of days before taking the lock', () => {
    expect(block).toContain('!Number.isInteger(params.days) || params.days <= 0');
  });

  it('requires a reason, which lands in billing history', () => {
    expect(block).toContain('An extension requires a reason');
  });
});

describe('the reward reads the campaign value as DAYS', () => {
  const applied = ENGINE.slice(
    ENGINE.indexOf("campaign.rewardType === 'SUBSCRIPTION_EXTENSION'"),
    ENGINE.indexOf('A reward type with no implementation'),
  );

  it('refuses a reward value that is not a whole number of days', () => {
    expect(applied).toContain('is not a whole number of days');
  });

  it('and does not confuse it with rewardDurationDays', () => {
    // rewardDurationDays is how long the REWARD stays in force; an extension's
    // effect is permanent once applied. Reading one for the other would grant
    // the wrong number of days and expire something that cannot expire.
    expect(applied).toContain('Number(campaign.rewardValue)');
    expect(applied).not.toContain('campaign.rewardDurationDays');
  });

  it('records the refusal rather than reporting a grant that did not happen', () => {
    expect(applied).toContain("extension.outcome !== 'applied'");
    expect(applied).toContain('Subscription extension refused');
  });
});
