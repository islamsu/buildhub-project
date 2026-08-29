import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import { getPlatformStats, resetPlatformStatsCache } from './platformStats';

/**
 * THE FRONT DOOR STATED FOUR THINGS THAT WERE NOT TRUE.
 *
 * The landing page and the sign-up page both showed, as fact:
 *
 *   10K+ Registered Users     5K+ Active Projects
 *   2K+ Verified Providers    98% Satisfaction Rate
 *
 * and three named testimonials - "Ahmed Hassan, Homeowner, Cairo" and two
 * others - each five stars, each carrying a specific quantitative claim ("the
 * AI cost estimator alone saved me 15% on my budget", "3x more qualified leads
 * than any other platform").
 *
 * None of it came from anywhere. The satisfaction rate is the one to name
 * twice: the reviews table was EMPTY, so 98% was not stale or rounded - there
 * was no such measurement in existence. These are claims made to a person
 * deciding whether to trust a construction marketplace with a budget.
 *
 * The counters are real now. The testimonials are gone rather than replaced,
 * because inventing better-looking copy is the same defect, and turning real
 * vendor reviews into site-wide marketing is the owner's decision to make.
 */

const HOME = readSourceForAssertions(readFileSync(new URL('../client/src/pages/Home.tsx', import.meta.url), 'utf8'));
const AUTH = readSourceForAssertions(readFileSync(new URL('../client/src/pages/AuthPage.tsx', import.meta.url), 'utf8'));

/** A db whose four counting queries answer with the numbers given. */
function stubDb(counts: { users: number; projects: number; providers: number; reviews: number; average?: number }) {
  let call = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => {
          call += 1;
          if (call === 1) return Promise.resolve([{ n: counts.users }]);
          if (call === 2) return Promise.resolve([{ n: counts.projects }]);
          return Promise.resolve([{ n: counts.providers }]);
        },
        // The reviews aggregate has no WHERE - it is awaited directly.
        then: (resolve: (rows: unknown[]) => unknown) =>
          resolve([{ n: counts.reviews, average: counts.average ?? null }]),
      }),
    }),
  } as any;
}

describe('the counters are counts', () => {
  beforeEach(() => resetPlatformStatsCache());

  it('reports the real numbers, not round marketing ones', async () => {
    const stats = await getPlatformStats(stubDb({ users: 86, projects: 3, providers: 48, reviews: 0 }));
    expect(stats.registeredUsers).toBe(86);
    expect(stats.activeProjects).toBe(3);
    expect(stats.verifiedProviders).toBe(48);
  });

  it('reports NO satisfaction figure when nobody has reviewed anything', async () => {
    // The whole defect in one assertion: 98% where there were zero reviews.
    const stats = await getPlatformStats(stubDb({ users: 86, projects: 3, providers: 48, reviews: 0 }));
    expect(stats.satisfaction).toBeNull();
  });

  it('reports a real average once reviews exist', async () => {
    const stats = await getPlatformStats(stubDb({ users: 86, projects: 3, providers: 48, reviews: 7, average: 4.42 }));
    expect(stats.satisfaction).toEqual({ averageRating: 4.4, reviewCount: 7 });
  });

  it('a small number is still the number - it is never rounded up', async () => {
    const stats = await getPlatformStats(stubDb({ users: 2, projects: 0, providers: 1, reviews: 1, average: 5 }));
    expect(stats.registeredUsers).toBe(2);
    expect(stats.verifiedProviders).toBe(1);
    expect(stats.activeProjects).toBe(0);
  });
});

describe('the pages render an absent figure as absent', () => {
  it('the landing page no longer carries the four hardcoded strings', () => {
    for (const claim of ["'10K+'", "'5K+'", "'2K+'", "'98%'"]) {
      expect(HOME, `${claim} was presented to visitors as fact`).not.toContain(claim);
    }
  });

  it('the sign-up page no longer carries them either', () => {
    for (const claim of ['>10K+<', '>5K+<', '>2K+<']) {
      expect(AUTH).not.toContain(claim);
    }
  });

  it('both pages read the same real source', () => {
    expect(HOME).toContain('trpc.marketplace.platformStats.useQuery');
    expect(AUTH).toContain('trpc.marketplace.platformStats.useQuery');
  });

  it('a zero count is not rendered at all', () => {
    // Not "0 Registered Users", and not a placeholder either.
    expect(HOME).toContain('.filter(stat => stat.show)');
    expect(AUTH).toContain('.filter(stat => stat.show)');
  });

  it('the satisfaction tile is gated on a real measurement existing', () => {
    expect(HOME).toContain('stats.satisfaction !== null');
  });

  it('the tiles are absent entirely rather than rendering an empty row', () => {
    expect(HOME).toContain('liveStats.length > 0');
    expect(AUTH).toContain('authStats.length > 0');
  });
});

describe('the invented testimonials are gone', () => {
  it.each([
    ['Ahmed Hassan'],
    ['Mohamed Al-Rashidi'],
    ['Sara Khalil'],
  ])('%s is not presented as a real customer', (name) => {
    // These were named people with cities, ratings and quotes. Nothing in the
    // product ever produced them.
    expect(HOME.replace(/THE TESTIMONIALS WERE INVENTED[\s\S]*?\*\//, '')).not.toContain(name);
  });

  it('the specific performance claims are gone with them', () => {
    const body = HOME.replace(/THE TESTIMONIALS WERE INVENTED[\s\S]*?\*\//, '');
    expect(body).not.toContain('saved me 15%');
    expect(body).not.toContain('3x more qualified leads');
  });

  it('they were not replaced with different invented copy', () => {
    const body = HOME.replace(/THE TESTIMONIALS WERE INVENTED[\s\S]*?\*\//, '');
    expect(body).not.toContain('TESTIMONIALS');
    expect(body).not.toContain('What Our Users Say');
  });

  it('and not wired to real vendor reviews either - that is an owner decision', () => {
    // A review left on a vendor's profile was not given for use as site-wide
    // marketing. Repurposing it silently would be a privacy decision made by
    // an engineer.
    expect(HOME).not.toContain('trpc.reviews');
  });
});
