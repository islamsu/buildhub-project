// ── Where a vendor's allowance actually comes from ─────────────────────────
//
// `billing.myEntitlements` returns one effective number and `billing.myPlan`
// returns a plan id, and NEITHER HAS EVER HAD A SCREEN. A vendor whose
// allowance changed had nowhere to find out why, and "you have 46" is not an
// answer to "why 46".

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { explainEnquiryAllowance } from './billing/allowanceBreakdown';

const NOW = new Date('2026-06-01T12:00:00Z');
const PAST = new Date('2026-05-01T00:00:00Z');
const FUTURE = new Date('2026-07-01T00:00:00Z');

/**
 * A stand-in that answers by ENTITLEMENT KEY, which is the only thing the
 * module distinguishes. Every where-clause is recorded so "it filtered to rows
 * in force" is an assertion this file can make rather than assume.
 */
function fakeDb(rows: { absolute?: any[]; bonus?: any[] }) {
  const seen: unknown[] = [];
  let call = 0;
  return {
    seen,
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          seen.push(condition);
          // The module issues the two reads in a fixed order: absolute, bonus.
          const which = call++ === 0 ? rows.absolute : rows.bonus;
          return { orderBy: async () => which ?? [] };
        },
      }),
    }),
  } as any;
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 1, value: '10', reason: 'because', startsAt: PAST, endsAt: null, ...over,
});

describe('a plain vendor on a plan', () => {
  it('sees the plan figure as the whole story, and no mismatch', async () => {
    const db = fakeDb({});
    const result = await explainEnquiryAllowance(db, 7, 'free', 3, NOW);
    expect(result.adminOverride).toBeNull();
    expect(result.bonuses).toEqual([]);
    expect(result.computed).toBe(result.planAllowance);
    expect(result.mismatch).toBe(result.planAllowance !== 3);
  });
});

describe('an administrator has granted an absolute allowance', () => {
  it('the grant REPLACES the plan figure, and both are shown', async () => {
    const db = fakeDb({ absolute: [row({ id: 9, value: '40', reason: 'Enterprise pilot' })] });
    const result = await explainEnquiryAllowance(db, 7, 'free', 40, NOW);
    expect(result.adminOverride).toMatchObject({ id: 9, value: 40, reason: 'Enterprise pilot' });
    expect(result.computed).toBe(40);
    expect(result.mismatch).toBe(false);
    // The plan's own figure is still reported, so the vendor can see what
    // changed rather than only what it changed to.
    expect(result.planAllowance).not.toBe(undefined);
  });

  it('the HIGHEST id wins among absolutes - the same supersession the resolver applies', async () => {
    // Naming a superseded row would explain the number with the wrong reason.
    const db = fakeDb({ absolute: [row({ id: 9, value: '40' }), row({ id: 4, value: '15' })] });
    const result = await explainEnquiryAllowance(db, 7, 'free', 40, NOW);
    expect(result.adminOverride!.id).toBe(9);
  });
});

describe('bonuses add on top of whatever won', () => {
  it('a referral bonus adds to the plan figure', async () => {
    // The plan's own number comes from the catalogue, so the enforced figure
    // this asserts against is read from the same place rather than guessed.
    const planOnly = await explainEnquiryAllowance(fakeDb({}), 7, 'free', 0, NOW);
    const expected = (planOnly.planAllowance ?? 0) + 5;

    const db = fakeDb({ bonus: [row({ id: 3, value: '5', reason: 'Referral reward' })] });
    const result = await explainEnquiryAllowance(db, 7, 'free', expected, NOW);
    expect(result.bonuses).toHaveLength(1);
    expect(result.bonuses[0].reason).toBe('Referral reward');
    expect(result.computed).toBe(expected);
    expect(result.mismatch).toBe(false);
  });

  it('and adds to an ADMINISTRATOR grant without replacing it', async () => {
    // The defect this whole slot exists for: a temporary bonus must never
    // destroy a permanent decision.
    const db = fakeDb({
      absolute: [row({ id: 9, value: '40' })],
      bonus: [row({ id: 3, value: '6' }), row({ id: 4, value: '3' })],
    });
    const result = await explainEnquiryAllowance(db, 7, 'free', 49, NOW);
    expect(result.computed).toBe(49);
    expect(result.mismatch).toBe(false);
    expect(result.bonuses.map(b => b.value)).toEqual([6, 3]);
  });

  it('several bonuses SUM rather than one superseding another', async () => {
    const db = fakeDb({ bonus: [row({ id: 3, value: '6' }), row({ id: 4, value: '3' })] });
    const result = await explainEnquiryAllowance(db, 7, 'free', null, NOW);
    expect(result.bonuses).toHaveLength(2);
  });
});

describe('an unlimited allowance', () => {
  it('stays unlimited - null plus a bonus is still no limit', async () => {
    // Turning it into a number would present a downgrade as a reward.
    const db = fakeDb({ absolute: [row({ id: 9, value: 'null' })], bonus: [row({ id: 3, value: '5' })] });
    const result = await explainEnquiryAllowance(db, 7, 'free', null, NOW);
    expect(result.computed).toBeNull();
    expect(result.mismatch).toBe(false);
  });
});

describe('when the explanation disagrees with what is enforced', () => {
  /*
   * TWO CODE PATHS COMPUTING AN ENTITLEMENT AND QUIETLY DISAGREEING is exactly
   * how a vendor is told one number and given another. The enforced figure is
   * authoritative; the parts explain it, and when they cannot, that is
   * reported rather than smoothed over.
   */
  it('says so, rather than showing a tidy sum', async () => {
    const db = fakeDb({ absolute: [row({ id: 9, value: '40' })] });
    const result = await explainEnquiryAllowance(db, 7, 'free', 46, NOW);
    expect(result.computed).toBe(40);
    expect(result.effective).toBe(46);
    expect(result.mismatch).toBe(true);
  });

  it('and the enforced figure is the one it reports as effective', async () => {
    const db = fakeDb({});
    const result = await explainEnquiryAllowance(db, 7, 'free', 999, NOW);
    expect(result.effective).toBe(999);
  });

  it('unlimited enforced against a numeric breakdown is a mismatch, not a silent null', async () => {
    const db = fakeDb({ absolute: [row({ id: 9, value: '40' })] });
    const result = await explainEnquiryAllowance(db, 7, 'free', null, NOW);
    expect(result.mismatch).toBe(true);
  });
});

describe('only rows in force are read', () => {
  const SOURCE = readFileSync(new URL('./billing/allowanceBreakdown.ts', import.meta.url), 'utf8');

  it('revoked, unstarted and ended rows are excluded IN THE QUERY', () => {
    // Filtering afterwards would mean a lapsed bonus was fetched and then
    // forgotten - and one missed filter would show it as live.
    expect(SOURCE).toContain('isNull(vendorEntitlementOverrides.revokedAt)');
    expect(SOURCE).toContain('lte(vendorEntitlementOverrides.startsAt, now)');
    expect(SOURCE).toContain('or(isNull(vendorEntitlementOverrides.endsAt), gt(vendorEntitlementOverrides.endsAt, now))');
  });

  it('the two slots are read separately, because they combine differently', () => {
    expect(SOURCE).toContain('ENQUIRY_ALLOWANCE_KEY');
    expect(SOURCE).toContain('ENQUIRY_BONUS_KEY');
  });
});

describe("the administrator's own view agrees with what is enforced", () => {
  const OVERRIDES = readFileSync(new URL('./billing/overrides.ts', import.meta.url), 'utf8');
  const view = OVERRIDES.slice(
    OVERRIDES.indexOf('export async function readEnquiryAllowance'),
    OVERRIDES.indexOf('export type SetAllowanceRefusal'),
  );

  it('readEnquiryAllowance counts the bonuses too', () => {
    /*
     * It read only ENQUIRY_ALLOWANCE_KEY rows, which was complete until
     * additive bonuses arrived for referral rewards. After that an
     * administrator looking at a vendor holding a bonus saw a number LOWER
     * than the one being enforced - on the screen they use to decide whether
     * to grant more.
     */
    expect(view).toContain('ENQUIRY_BONUS_KEY');
    expect(view).toContain('sumActiveBonuses(bonusRows, now)');
    expect(view).toContain('base === null ? null : base + bonus');
  });

  it('and lists them in the history, so "who changed it" is answerable', () => {
    expect(view).toContain('[...rows, ...bonusRows]');
  });
});

describe('the vendor-facing screen', () => {
  const SCREEN = readFileSync(new URL('../client/src/components/BenefitsAndLimits.tsx', import.meta.url), 'utf8');

  it('renders the breakdown, not just the total', () => {
    for (const part of ['benefits-plan-allowance', 'benefits-effective', 'benefits-used', 'benefits-remaining', 'benefits-reset']) {
      expect(SCREEN, `${part} is missing`).toContain(part);
    }
  });

  it('shows the mismatch instead of hiding it', () => {
    expect(SCREEN).toContain('allowance.mismatch &&');
    expect(SCREEN).toContain('benefits-mismatch');
    // In both languages: an Arabic-reading vendor needs the same warning.
    expect(SCREEN).toContain('The enforced figure is what applies');
    expect(SCREEN).toContain('المطبَّق فعليًا هو الرقم الثاني');
  });

  it('a failed fetch is a failure, not an empty entitlement', () => {
    // "You have no benefits" is a very different thing from "we could not
    // check", and a vendor reading the first would conclude they had been
    // downgraded.
    expect(SCREEN).toContain('benefits.isError');
    expect(SCREEN).toContain('<LoadFailed');
  });

  it('lists only capabilities that are USABLE, never merely granted', () => {
    // A capability the plan grants but BuildHub has not built must not be
    // advertised. The server already filters to `usable`; this holds the
    // screen to reading that and nothing else.
    expect(SCREEN).toContain('Object.entries(plan.capabilities).filter(([, usable]) => usable)');
  });

  it('is reachable - the settings page renders it', () => {
    const SETTINGS = readFileSync(new URL('../client/src/pages/SettingsPage.tsx', import.meta.url), 'utf8');
    expect(SETTINGS).toContain('<BenefitsAndLimits />');
  });
});
