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

/**
 * THE GUARD WAS WATCHING THE WRONG FILE.
 *
 * Everything above reads Home.tsx, and Home.tsx has been clean since the
 * carousel was removed. The TRANSLATION CATALOGUE still carried a SECOND,
 * DIFFERENT set of invented customers that no assertion here ever looked at:
 *
 *   'testimonials.title'   "Trusted by Thousands"
 *   'testimonials.1.name'  "Layla Ahmed"        / "ليلى أحمد"
 *   'testimonials.2.name'  "Khaled Mostafa"     / "خالد مصطفى"
 *   'testimonials.3.name'  "Nour Hassan"        / "نور حسن"
 *   'testimonials.2.text'  "My business has grown 40% since joining."
 *
 * Twenty-four keys, twelve English and twelve Arabic, with names, cities,
 * professions and a quantified revenue claim attributed to a person who does
 * not exist. Nothing rendered them - and that is the whole reason they
 * survived a removal that was otherwise thorough. They shipped in the bundle
 * and were one t('testimonials.1.name') away from being published.
 *
 * These tests read the catalogue, so the next set cannot hide in it either.
 */
describe('no invented endorsement survives in the translation catalogue', () => {
  const catalogue = readFileSync(new URL('../client/src/contexts/LanguageContext.tsx', import.meta.url), 'utf8');

  it('there are no testimonial keys at all', () => {
    expect([...catalogue.matchAll(/'testimonials\.[^']*'/g)]).toEqual([]);
  });

  it('none of the invented customers is named, in either language', () => {
    for (const name of [
      'Layla Ahmed', 'Khaled Mostafa', 'Nour Hassan',
      'ليلى أحمد', 'خالد مصطفى', 'نور حسن',
    ]) {
      expect(catalogue, `${name} is an invented customer`).not.toContain(name);
    }
  });

  it('no quantified business claim is attributed to anybody', () => {
    for (const claim of ['grown 40%', 'نمت أعمالي بنسبة 40%']) {
      expect(catalogue).not.toContain(claim);
    }
  });

  it('and the product does not claim to be trusted by thousands', () => {
    // A volume claim about a platform with no launched user base is the same
    // fabrication as a named quote, with the name left off.
    expect(catalogue).not.toContain('Trusted by Thousands');
    expect(catalogue).not.toContain('موثوق به من الآلاف');
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
