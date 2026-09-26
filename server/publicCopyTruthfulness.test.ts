/**
 * ── NO CLAIM BUILDHUB CANNOT EVIDENCE ──────────────────────────────────
 *
 * §75: "Do not fabricate customer logos, counts or testimonials. If real
 * proof is unavailable, use product capability and clear explanation rather
 * than fake social proof." §68: never imply endorsement, verification,
 * popularity or quality the system cannot prove.
 *
 * WHAT THIS CAUGHT. The homepage CTA read "Join thousands of users who trust
 * BuildHub to manage their construction projects", and the sign-in panel
 * carried the same sentence. Two claims in one line, both unevidenced: how
 * many people use BuildHub, and how they feel about it. Three more keys said
 * "thousands of products" and "thousands of construction professionals".
 *
 * A COUNT IS ONLY ALLOWED WHEN IT IS QUERIED. `platformStats` exposes real
 * figures and Home renders them only when they are non-zero, which is the
 * honest pattern; a hardcoded "thousands" is the dishonest one, and no
 * amount of hedging makes it true.
 *
 * The census runs over PUBLIC copy - the dictionary and the pages a visitor
 * sees without an account - because that is where an unsupported claim does
 * commercial damage.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const raw = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');
const src = (relative: string) => readSourceForAssertions(raw(relative));

/** The dictionary, plus every page a visitor can reach without an account. */
const PUBLIC_SURFACES = [
  'client/src/contexts/LanguageContext.tsx',
  'client/src/pages/Home.tsx',
  'client/src/pages/AuthPage.tsx',
  'client/src/pages/Marketplace.tsx',
  'client/src/pages/MarketplaceHub.tsx',
  'client/src/pages/VendorsDirectory.tsx',
  'client/src/pages/VendorProfile.tsx',
  'client/src/components/SourcingJourney.tsx',
];

/**
 * Claim shapes, in both languages.
 *
 * Each is a statement about SCALE, POPULARITY or SENTIMENT - the three kinds
 * of proof BuildHub has no way to produce. Deliberately NOT matching
 * "verified", which is a real compliance decision the product records, or
 * "awarded", which is an RFQ status.
 */
const UNSUPPORTED_CLAIMS: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bthousands\b/i, why: 'a scale claim with no query behind it' },
  { pattern: /\bmillions\b/i, why: 'a scale claim with no query behind it' },
  { pattern: /آلاف/, why: 'the Arabic "thousands"' },
  { pattern: /\btrusted by\b/i, why: 'a sentiment claim about third parties' },
  { pattern: /who trust BuildHub/i, why: 'a sentiment claim about users' },
  { pattern: /يثقون في/, why: 'the Arabic "who trust"' },
  { pattern: /\b(leading|#1|number one|most trusted|top-rated)\s+(b2b|marketplace|platform|supplier)/i,
    why: 'a ranking claim with nothing to rank against' },
  { pattern: /\baward-winning\b/i, why: 'an award BuildHub has not won' },
  { pattern: /\btestimonial/i, why: 'a testimonial BuildHub does not have' },
  /*
   * THE FABRICATED-BADGE FAMILY. The census first caught ONE
   * ("Award-Winning" on the designers directory) and removing it revealed
   * five more of the same shape across three directories: Top Rated,
   * Recommended, Fast Response. All were unused dictionary keys - a loaded
   * gun rather than a live lie - but a badge saying "Top Rated" is a ranking
   * BuildHub cannot defend and "Fast Response" is a response metric §68
   * allows only "where statistically valid".
   *
   * `New` is deliberately NOT here: it is derivable from a creation date,
   * so it is a claim the product can actually make.
   */
  /*
   * MATCHED ON THE KEY NAME, not the wording.
   *
   * The wording collides with something legitimate: "الأعلى تقييماً" is both
   * the badge "Top Rated" AND the sort option "Highest rated", and sorting
   * by real review data is a perfectly honest feature. Matching the value
   * text flagged four sort labels across the directories.
   *
   * The KEY name is unambiguous - a `badge*` key asserts a property of a
   * provider, a `sort*` key asserts an ordering the user asked for.
   */
  { pattern: /badge(AwardWinning|TopRated|FastResponse|Trending)/, why: 'an unprovable trust badge key' },
  { pattern: /\bjoin \d[\d,]*\+?\b/i, why: 'a hardcoded member count' },
  { pattern: /\b\d[\d,]*\+\s*(users|customers|suppliers|companies|professionals|projects)\b/i,
    why: 'a hardcoded population figure' },
];

describe('public copy claims nothing BuildHub cannot evidence', () => {
  for (const surface of PUBLIC_SURFACES) {
    it(`${surface} makes no unsupported claim`, () => {
      /*
       * COMMENTS STRIPPED, deliberately. The notes explaining what was
       * removed necessarily QUOTE the removed claim - including this file's
       * own header - and an assertion that fails on its own documentation
       * teaches people to stop writing it.
       */
      const code = src(surface);
      const hits = UNSUPPORTED_CLAIMS
        .filter(claim => claim.pattern.test(code))
        .map(claim => `${claim.pattern} — ${claim.why}`);
      expect(hits, `${surface} carries an unsupported claim`).toEqual([]);
    });
  }

  it('the census is not vacuous - it really reads the files', () => {
    // A path typo would make every assertion above pass over an empty string.
    for (const surface of PUBLIC_SURFACES) {
      expect(src(surface).length, `${surface} read as empty`).toBeGreaterThan(500);
    }
  });

  it('and it would catch the claim it was written for', () => {
    // The exact sentence that was on the homepage, checked against the rules
    // rather than against the file - so the rule is proven, not the fix.
    const removed = 'Join thousands of users who trust BuildHub to manage their construction projects.';
    const caught = UNSUPPORTED_CLAIMS.filter(claim => claim.pattern.test(removed));
    expect(caught.length, 'the original claim would pass the census').toBeGreaterThan(0);
    const arabic = 'انضم إلى آلاف المستخدمين الذين يثقون في BuildHub لإدارة مشاريعهم.';
    expect(UNSUPPORTED_CLAIMS.filter(claim => claim.pattern.test(arabic)).length,
      'the Arabic original would pass the census').toBeGreaterThan(0);
  });
});

describe('a real figure is still allowed, because it is queried', () => {
  it('Home renders platform counts from platformStats, not from copy', () => {
    const home = src('client/src/pages/Home.tsx');
    expect(home).toContain('trpc.marketplace.platformStats.useQuery');
    expect(home).toContain('publicProducts');
  });

  it('and shows a figure ONLY when it is non-zero', () => {
    // §10: a database outage or an empty platform must not render as a
    // confident "0 products" under a heading about scale.
    expect(src('client/src/pages/Home.tsx')).toMatch(/show:\s*stats\.publicProducts > 0/);
  });
});

describe('the footer does not go stale on a fixed date', () => {
  it('the copyright year is computed, not written down', () => {
    // A stale copyright line is the cheapest possible signal that a site is
    // unmaintained, and it goes stale with nobody watching.
    const home = src('client/src/pages/Home.tsx');
    expect(home).toContain('new Date().getFullYear()');
    expect(home, 'a hardcoded year is back in the footer').not.toMatch(/©\s*20\d\d/);
  });

  it('and no other public surface hardcodes a year in visible copy', () => {
    for (const surface of PUBLIC_SURFACES) {
      expect(src(surface), `${surface} hardcodes a copyright year`)
        .not.toMatch(/©\s*20\d\d|Copyright\s+20\d\d/i);
    }
  });
});
