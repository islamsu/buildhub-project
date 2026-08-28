import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROUTES, ROLE_EXPERIENCES } from '@shared/aiRoles';

/**
 * EVERY LINK THE PRODUCT OFFERS MUST GO SOMEWHERE.
 *
 * This file exists because a dead link shipped, and it shipped past a test
 * that was supposed to prevent exactly that.
 *
 * `aiRoles.test.ts` checks that every ROUTES entry appears in App.tsx. The
 * opportunity engine does not use ROUTES - it BUILDS hrefs from a template,
 * `/rfq/${id}` - so the check never saw them, and `/rfq/:id` is not a route.
 * App.tsx registers `/rfq` and ends with a catch-all NotFound, so both
 * "prepared actions" the AI offered a contractor led to the 404 page.
 *
 * The lesson is about the SHAPE of the check, not the one link: a route test
 * that only inspects one constant proves nothing about hrefs assembled
 * anywhere else. This test reads the route table out of App.tsx and holds
 * every href-producing source against it.
 */

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const APP = read('../client/src/App.tsx');

/**
 * The routes App.tsx actually registers, as concrete paths plus the patterns
 * that take a parameter.
 */
function registeredRoutes(): { exact: Set<string>; patterns: RegExp[] } {
  const declared = [...APP.matchAll(/path=\{?["']([^"']+)["']/g)].map(m => m[1]);
  const exact = new Set<string>();
  const patterns: RegExp[] = [];
  for (const route of declared) {
    if (route.includes(':')) {
      // `/marketplace/vendors/:id` -> matches `/marketplace/vendors/<anything>`
      patterns.push(new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+')}$`));
    } else {
      exact.add(route);
    }
  }
  return { exact, patterns };
}

const { exact, patterns } = registeredRoutes();

const resolves = (href: string): boolean => {
  const path = href.split('?')[0].split('#')[0];
  return exact.has(path) || patterns.some(pattern => pattern.test(path));
};

describe('the route table itself', () => {
  it('was parsed - if this breaks, every other test here is vacuous', () => {
    // A parser that silently returned nothing would make `resolves()` false for
    // everything and the suite would fail loudly rather than pass quietly, but
    // the premise is asserted rather than assumed either way.
    expect(exact.size).toBeGreaterThan(10);
    expect(exact.has('/rfq')).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);
  });

  it('has a catch-all, which is WHY an unmatched href is silently a 404', () => {
    // Without the catch-all a bad link would blank the page and be noticed.
    // With it, a dead link looks like a working link to a "not found" screen.
    expect(APP).toMatch(/<Route component=\{?NotFound/);
  });

  it('confirms /rfq/:id is NOT a route', () => {
    // The premise of the bug this file was written for. If an RFQ detail page
    // is ever added, this test should be updated deliberately - and the
    // opportunity engine's hrefs revisited at the same time.
    expect(resolves('/rfq/123')).toBe(false);
  });
});

describe('every route the AI role experiences offer', () => {
  it.each(Object.entries(ROUTES))('ROUTES.%s -> %s resolves', (_name, href) => {
    expect(resolves(href)).toBe(true);
  });

  it.each(Object.values(ROLE_EXPERIENCES).flatMap(experience =>
    experience.actions.map(action => [experience.role, action.id, action.href] as const),
  ))('%s action "%s" -> %s resolves', (_role, _id, href) => {
    expect(resolves(href)).toBe(true);
  });
});

describe('every href the opportunity engine builds', () => {
  const SOURCE = read('./opportunity.ts');

  /**
   * Pull the href literals out of the source. Deliberately reads the SOURCE
   * rather than calling the function: the point is to catch a template that
   * interpolates an id into a path that has no parameterised route, and a
   * runtime value would hide the template's shape.
   */
  const hrefs = [...SOURCE.matchAll(/href: ['"`]([^'"`]+)['"`]/g)].map(m => m[1]);

  it('emits at least one href - otherwise the checks below are vacuous', () => {
    expect(hrefs.length).toBeGreaterThan(0);
  });

  it.each(hrefs)('%s resolves to a real route', href => {
    // A template like `/rfq/${id}` arrives here as `/rfq/` after the
    // interpolation is stripped, which does not resolve - so the shape is
    // caught, not just a literal typo.
    expect(resolves(href)).toBe(true);
  });

  it('builds no href by interpolating an id into a path', () => {
    // The specific defect, named. `/rfq/${entry.row.id}` looked like a detail
    // link and was a 404.
    expect(SOURCE).not.toMatch(/href: `[^`]*\$\{/);
  });
});

describe('the RFQ list offers a provider somewhere to go', () => {
  const RFQ_PAGE = read('../client/src/pages/RFQPage.tsx')
    // Strip comments first: this page now explains the gap it used to have,
    // and an assertion matching its own prose would pass on a page that
    // described the fix without applying it.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('the only action is no longer owner-only', () => {
    // Every card's CTA was `isOwner && <Compare/>`, so a contractor or supplier
    // - the people an RFQ is addressed to - saw no action at all.
    expect(RFQ_PAGE).toMatch(/data-testid="rfq-respond"/);
  });

  it('the respond route resolves', () => {
    const match = /data-testid="rfq-respond"[\s\S]{0,400}?<\/Link>/.exec(RFQ_PAGE)
      ?? /<Link href="([^"]+)">[\s\S]{0,400}?data-testid="rfq-respond"/.exec(RFQ_PAGE);
    expect(match).not.toBeNull();
    const href = /<Link href="([^"]+)">/.exec(
      RFQ_PAGE.slice(Math.max(0, RFQ_PAGE.indexOf('rfq-respond') - 300), RFQ_PAGE.indexOf('rfq-respond')),
    );
    expect(href).not.toBeNull();
    expect(resolves(href![1])).toBe(true);
  });

  it('does NOT open the enquiry from the list - that spends a credit', () => {
    // Routing to the surface that owns the decision is correct; firing the
    // chargeable mutation from a list card would not be.
    expect(RFQ_PAGE).not.toContain('openEnquiry');
  });
});
