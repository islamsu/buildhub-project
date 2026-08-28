import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';

const homeSource = readSourceForAssertions(readFileSync(resolve(process.cwd(), 'client/src/pages/Home.tsx'), 'utf8'));

/**
 * A TEST WHOSE NAME CLAIMED HONESTY AND WHOSE BODY REQUIRED THE FABRICATION.
 *
 * This file previously read:
 *
 *   it('supports keyboard and touch navigation WITHOUT FABRICATED TESTIMONIAL
 *      DATA', ...)
 *
 * while its sibling asserted `expect(homeSource).toContain('const TESTIMONIALS
 * = [')` - the array of three invented customers. The suite was pinning the
 * invented data in place under a name that said the opposite, which is why a
 * green run was never going to surface it.
 *
 * The carousel and its data are gone. The accessibility guarantees it carried
 * are kept as a CONDITIONAL: they no longer assert that a carousel exists -
 * they require that any carousel added later is navigable. Asserting the
 * presence of removed code would be the same mistake in the other direction.
 */
describe('the invented testimonials stay gone', () => {
  const body = homeSource.replace(/THE TESTIMONIALS WERE INVENTED[\s\S]*?\*\//, '');

  it('no hardcoded testimonial array', () => {
    expect(body).not.toContain('const TESTIMONIALS = [');
  });

  it('none of the three invented customers is named', () => {
    for (const name of ['Ahmed Hassan', 'Mohamed Al-Rashidi', 'Sara Khalil']) {
      expect(body).not.toContain(name);
    }
  });

  it('none of their invented performance claims survives', () => {
    for (const claim of ['saved me 15%', '3x more qualified leads', 'used to take days']) {
      expect(body).not.toContain(claim);
    }
  });

  it('no five-star rating is rendered from a literal', () => {
    // `rating: 5` on an invented record is what turned copy into a review.
    expect(body).not.toMatch(/rating:\s*5\b/);
  });
});

describe('if a carousel is ever added back, it must be usable', () => {
  const hasCarousel = homeSource.includes('aria-roledescription="carousel"');

  it('a carousel offers previous and next controls with labels', () => {
    if (!hasCarousel) return expect(hasCarousel).toBe(false);
    expect(homeSource).toContain('Previous testimonial');
    expect(homeSource).toContain('Next testimonial');
    expect(homeSource).toContain('role="tablist"');
  });

  it('a carousel is reachable by keyboard, not only by pointer', () => {
    if (!hasCarousel) return expect(hasCarousel).toBe(false);
    expect(homeSource).toContain("event.key === 'ArrowLeft'");
    expect(homeSource).toContain("event.key === 'ArrowRight'");
  });

  it('and any testimonial it shows comes from real data, not a literal', () => {
    if (!hasCarousel) return expect(hasCarousel).toBe(false);
    expect(homeSource).not.toContain('const TESTIMONIALS = [');
  });
});
