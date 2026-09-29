// ── A REFERRAL REWARD IS DESCRIBED, NEVER SPELLED ─────────────────────────
//
// The invite screen printed the stored enum at the reader:
//
//   EXTRA_QUALIFIED_ENQUIRIES: 7
//
// That is a database column shown to a customer as the product's own
// language. It cannot be translated - an Arabic reader got the same
// SCREAMING_SNAKE_CASE - and it asks them to work out what they were given,
// which is the one thing a rewards screen exists to answer. The admin console
// did the same with the reward and the qualification event.
//
// Two rules, the same pair the placement vocabulary uses:
//
//   THE VOCABULARY COVERS WHAT EXISTS. Every reward type and every
//   qualification event the server can produce reads as a sentence in both
//   languages, so adding one cannot quietly leave it untranslated.
//
//   NO RAW TOKEN REACHES A SCREEN. Nothing under client/ renders one as text.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { REFERRAL_REWARD_TYPES, REFERRAL_QUALIFICATION_TYPES } from '../shared/referralRewards';
import {
  qualificationLabel, referralStateLabel, rewardSentence, rewardStatusLabel,
} from '../client/src/lib/referralLabels';

const CLIENT = new URL('../client/src/', import.meta.url);
const ARABIC = /[؀-ۿ]/;

function clientFiles(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: URL, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) { walk(child, `${prefix}${entry.name}/`); continue; }
      if (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts')) continue;
      out.push({ path: `${prefix}${entry.name}`, text: readFileSync(child, 'utf8') });
    }
  };
  walk(CLIENT, '');
  return out;
}

describe('every referral value the server can produce reads as words', () => {
  it('the vocabularies are not empty', () => {
    // POSITIVE CONTROL. Empty source arrays would satisfy every loop below.
    expect(REFERRAL_REWARD_TYPES.length).toBe(3);
    expect(REFERRAL_QUALIFICATION_TYPES.length).toBeGreaterThan(3);
  });

  it('each reward type is a sentence, in both languages, carrying its unit', () => {
    for (const type of REFERRAL_REWARD_TYPES) {
      const en = rewardSentence(type, 7, 'en');
      const ar = rewardSentence(type, 7, 'ar');
      expect(en, `${type} in English`).not.toContain(type);
      expect(ar, `${type} in Arabic`).toMatch(ARABIC);
      // The number alone does not say seven of WHAT, so the unit is in the
      // sentence rather than in a column heading beside it.
      expect(en.length, `${type} says more than a number`).toBeGreaterThan(String(7).length + 4);
      expect(en).toContain('7');
    }
  });

  it('each qualification event says what the person DID', () => {
    for (const type of REFERRAL_QUALIFICATION_TYPES) {
      const en = qualificationLabel(type, 'en');
      const ar = qualificationLabel(type, 'ar');
      expect(en, `${type} in English`).toBeTruthy();
      expect(en, `${type} still spells the token`).not.toContain(type);
      expect(ar, `${type} in Arabic`).toMatch(ARABIC);
    }
  });

  it('referral and reward states read in both languages', () => {
    for (const state of ['registered', 'qualified', 'rewarded', 'expired', 'revoked']) {
      expect(referralStateLabel(state, 'en')).not.toBe(state);
      expect(referralStateLabel(state, 'ar')).toMatch(ARABIC);
    }
    for (const state of ['PENDING', 'GRANTED', 'EXPIRED', 'REVERSED', 'REJECTED']) {
      expect(rewardStatusLabel(state, 'en')).not.toBe(state);
      expect(rewardStatusLabel(state, 'ar')).toMatch(ARABIC);
    }
  });

  it('an unknown reward is shown as stored rather than hidden behind a dash', () => {
    // A reward this table has not learned about is a gap in the table. Someone
    // who can see the raw token can at least ask about it; a dash would say
    // the same thing as "no reward", which is certainly wrong.
    expect(rewardSentence('FUTURE_REWARD', 3, 'en')).toContain('FUTURE_REWARD');
    expect(rewardSentence('FUTURE_REWARD', null, 'ar')).toContain('FUTURE_REWARD');
  });
});

describe('no referral token reaches a screen', () => {
  const TOKENS = [...REFERRAL_REWARD_TYPES, ...REFERRAL_QUALIFICATION_TYPES];

  it('the sweep can see a rendered token when there is one', () => {
    // POSITIVE CONTROL - the exact shape both screens had.
    const rendered = '<td>{row.rewardType}: {row.rewardValue}</td>';
    const bound = '<Select value={rewardType} onValueChange={setRewardType}>';
    const pattern = />\s*\{\s*(?:\w+\.)*(rewardType|qualificationType)\s*\}/;
    expect(pattern.test(rendered), 'a rendered token must be caught').toBe(true);
    expect(pattern.test(bound), 'a prop binding must NOT be caught').toBe(false);
  });

  it('no client file renders a reward or qualification token as text', () => {
    const offenders: string[] = [];
    for (const file of clientFiles()) {
      if (file.path === 'lib/referralLabels.ts') continue;
      for (const token of TOKENS) {
        if (file.text.includes(`>${token}<`)) offenders.push(`${file.path}: >${token}<`);
      }
      /*
       * `{row.rewardType}` printed straight into markup, which is how the
       * token got onto both screens in the first place.
       *
       * PRECEDED BY `>`, so it is JSX CHILDREN rather than a prop. The first
       * version matched any occurrence and reported
       * `<Select value={rewardType}>` in the campaign form - a binding that
       * renders nothing and is exactly how that form should be written. A
       * sweep that cries wolf about correct code gets switched off.
       */
      for (const match of file.text.matchAll(/>\s*\{\s*(?:\w+\.)*(rewardType|qualificationType)\s*\}/g)) {
        offenders.push(`${file.path}: ${match[0].trim()} rendered as text`);
      }
    }
    expect(offenders, `a stored referral token shown as the product's own words:\n  ${offenders.join('\n  ')}`)
      .toEqual([]);
  });
});
