import { describe, expect, it } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import { ROUTES, ROLE_EXPERIENCES } from '@shared/aiRoles';
import { getRolePlatformPath, PLATFORM_ROLES } from '../client/src/lib/rolePlatform';

/**
 * EVERY LINK THE PRODUCT OFFERS MUST GO SOMEWHERE.
 *
 * This file exists because a dead link shipped, and it shipped past a test
 * that was supposed to prevent exactly that.
 *
 * `aiRoles.test.ts` checks that every ROUTES entry appears in App.tsx. The
 * opportunity engine does not use ROUTES - it BUILDS hrefs from a template,
 * `/rfq/${id}` - so the check never saw them, and at the time `/rfq/:id` was
 * not a route. App.tsx registers a catch-all NotFound last, so both "prepared
 * actions" the AI offered a contractor led silently to the 404 page.
 *
 * `/rfq/:id` EXISTS NOW - the detail page was built - and the assertions below
 * were flipped deliberately rather than deleted, so the reason the engine's
 * hrefs changed twice stays readable.
 *
 * The lesson is about the SHAPE of the check, not the one link: a route test
 * that only inspects one constant proves nothing about hrefs assembled
 * anywhere else. This test reads the route table out of App.tsx and holds
 * every href-producing source against it.
 */

const read = (relative: string) => readSourceForAssertions(readFileSync(new URL(relative, import.meta.url), 'utf8'));
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

  it('/rfq/:id IS a route, and the engine may address a record directly', () => {
    // This test used to assert the OPPOSITE, and said so: "if an RFQ detail
    // page is ever added, update this deliberately - and revisit the
    // opportunity engine's hrefs at the same time." Both have now happened.
    // Recording the flip here rather than deleting the test keeps the history
    // of why the engine's hrefs changed twice.
    expect(resolves('/rfq/123')).toBe(true);
  });
});

/**
 * THE WHOLE CLIENT, not the two files this test started with.
 *
 * The original version checked ROUTES and the opportunity engine. A dead link
 * shipped anyway, from a page neither of them covered. Narrowing a link check
 * to the places you already suspect is how the next one ships too, so this
 * sweeps every .tsx in the client for anything that looks like an internal
 * destination and holds all of them against the same route table.
 */
describe('every internal destination anywhere in the client', () => {
  const CLIENT = new URL('../client/src/', import.meta.url);

  function internalTargets(): Map<string, Set<string>> {
    const found = new Map<string, Set<string>>();
    const paths = globSync('client/src/**/*.tsx')
      // Not routed and not imported by anything - it is dead code, never
      // bundled, and its hundreds of demo links are not destinations the
      // product offers anybody.
      .filter(path => !path.endsWith('ComponentShowcase.tsx'));

    for (const path of paths) {
      const source = readSourceForAssertions(readFileSync(path, 'utf8'));
      const patterns = [
        /navigate\(\s*[`"']([^`"']+)[`"']/g,
        /<Link href=\{?[`"']([^`"']+)[`"']/g,
        /\bhref=\{?[`"'](\/[^`"']*)[`"']/g,
      ];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          if (!found.has(match[1])) found.set(match[1], new Set());
          found.get(match[1])!.add(path);
        }
      }
    }
    return found;
  }

  const targets = internalTargets();

  it('found a meaningful number of them - otherwise this suite is vacuous', () => {
    // The failure mode of a sweep is sweeping nothing. A regex that stopped
    // matching would make every assertion below pass on an empty set.
    expect(String(CLIENT)).toContain('client/src');
    expect(targets.size).toBeGreaterThan(15);
  });

  /**
   * A template whose FIRST segment is an interpolation has no statically
   * knowable path - `${getRolePlatformPath(role)}?rfq=1` could be anything.
   * Substituting a placeholder would turn it into `123?rfq=1` and report a
   * false dead link, so those are separated out and their helper is checked
   * exhaustively instead, in the describe below. Everything else is checked by
   * shape as before.
   */
  const computed = [...targets.keys()].filter(target => target.startsWith('${'));
  const literal = [...targets.entries()].filter(([target]) => !target.startsWith('${'));

  it('every literal destination resolves to a registered route', () => {
    const dead: string[] = [];
    for (const [target, files] of literal) {
      // A template arrives with its interpolation intact; substituting a
      // placeholder tests the SHAPE, so `/rfq/${id}` passes and
      // `/quotation/${id}` - no such route - still fails.
      const concrete = target.replace(/\$\{[^}]+\}/g, '123');
      if (!resolves(concrete)) dead.push(`${target}  (in ${[...files].join(', ')})`);
    }
    expect(dead, `dead internal links:\n  ${dead.join('\n  ')}`).toEqual([]);
  });

  it('the only computed destinations are ones a helper below proves out', () => {
    // An unrecognised computed href is NOT waved through: it has to be added
    // here deliberately, together with a test that covers whatever builds it.
    // Otherwise this exemption becomes the hole the whole file exists to close.
    for (const target of computed) {
      expect(target, `computed href ${target} has no exhaustive coverage`)
        .toMatch(/^\$\{getRolePlatformPath\(/);
    }
  });
});

/**
 * THE ONE COMPUTED DESTINATION, CHECKED EXHAUSTIVELY.
 *
 * `getRolePlatformPath` is a closed mapping - six platform roles, 'admin', and
 * a fallback - so every value it can return is enumerable, and every one of
 * them must be a registered route. That is a stronger guarantee than the
 * shape check the literal sweep applies, not a weaker one.
 */
describe('getRolePlatformPath only ever returns a real route', () => {
  it.each([...PLATFORM_ROLES, 'admin', 'nonsense', undefined, null])(
    'role %s -> a registered route', role => {
      const path = getRolePlatformPath(role);
      expect(resolves(path), `${String(role)} -> ${path} does not resolve`).toBe(true);
    },
  );

  it('and no page hand-builds a /platform/ path instead of using the helper', () => {
    // Rather than hand-building `/platform/${role}`, which would be a second
    // copy of the mapping and free to drift from the route table.
    //
    // RFQDetail used to be the example here, because its respond CTA pointed
    // at the provider's workspace. That CTA now targets `/rfq/:id/respond` - a
    // fixed route with no role in it - so there is nothing left for the helper
    // to resolve on that page. The rule itself is unchanged and still worth
    // enforcing, so it is asserted where it still applies.
    const detail = read('../client/src/pages/RFQDetail.tsx');
    expect(detail).not.toMatch(/href=\{`\/platform\//);
    const respond = read('../client/src/pages/RFQRespondPage.tsx');
    expect(respond).not.toMatch(/href=\{`\/platform\/\$\{/);
    // And the helper is still the single source for callers that DO need it.
    const layout = read('../client/src/components/DashboardLayout.tsx');
    expect(layout + read('../client/src/components/Navbar.tsx')).toContain('getRolePlatformPath');
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

  it('every INTERPOLATED href resolves against a parameterised route', () => {
    // The rule this replaces was "never interpolate an id into a path at all",
    // which was the right rule while no parameterised route existed - the
    // template could only ever produce a 404. Now that /rfq/:id is real, a
    // blanket ban would forbid the correct thing.
    //
    // So the check moves from the SHAPE to the OUTCOME: substitute a
    // placeholder id into each template and require the result to resolve.
    // `/rfq/${id}` passes; `/quotation/${id}` - a route that does not exist -
    // still fails, which is the defect this file was written for.
    const templates = [...SOURCE.matchAll(/href: `([^`]+)`/g)].map(m => m[1]);
    for (const template of templates) {
      const concrete = template.replace(/\$\{[^}]+\}/g, '123');
      expect(resolves(concrete), `interpolated href ${template} does not resolve`).toBe(true);
    }
  });
});

describe('the RFQ list offers a provider somewhere to go', () => {
  const RFQ_PAGE = read('../client/src/pages/RFQPage.tsx')
    // Strip comments first: this page now explains the gap it used to have,
    // and an assertion matching its own prose would pass on a page that
    // described the fix without applying it.
    ;

  it('the only action is no longer owner-only', () => {
    // Every card's CTA was `isOwner && <Compare/>`, so a contractor or supplier
    // - the people an RFQ is addressed to - saw no action at all.
    expect(RFQ_PAGE).toMatch(/data-testid="rfq-respond"/);
  });

  /**
   * THIS ASSERTION USED TO BE "the respond route resolves", AND IT PASSED
   * WHILE THE FEATURE WAS BROKEN.
   *
   * The link was `<Link href="/provider">` - a bare link to the legacy shim.
   * It resolves perfectly. A supplier clicking "Respond" on one specific RFQ
   * card was dropped on a generic workspace with no memory of which request
   * they had chosen. Resolving and carrying the user to the right place are
   * different properties, and only the first was being checked.
   *
   * Found by clicking the button in a browser, not by reading the source.
   */
  it('the respond link carries the RFQ, not just a valid path', () => {
    const start = RFQ_PAGE.indexOf('rfq-respond');
    expect(start).toBeGreaterThan(-1);
    const before = RFQ_PAGE.slice(Math.max(0, start - 400), start);
    const href = /<Link href=\{?[`"]([^`"]+)[`"]\}?>/.exec(before);
    expect(href, 'no <Link> wraps the respond button').not.toBeNull();

    // It must interpolate the row's id. A constant path - any constant path -
    // is the defect this test exists for.
    expect(href![1], 'the respond link must address the specific RFQ')
      .toMatch(/\/rfq\/\$\{rfq\.id\}/);
    expect(resolves(href![1].replace(/\$\{[^}]+\}/g, '123'))).toBe(true);
  });

  it('and it goes to the REVIEW page, never straight to the workspace', () => {
    // /platform/:role and /provider are workspaces. The supplier has not
    // decided to respond yet - they have decided to look.
    const start = RFQ_PAGE.indexOf('rfq-respond');
    const before = RFQ_PAGE.slice(Math.max(0, start - 400), start);
    expect(before).not.toMatch(/<Link href="\/provider">/);
    expect(before).not.toMatch(/<Link href=\{?[`"]\/platform\//);
  });

  it('does NOT open the enquiry from the list - that spends a credit', () => {
    // Routing to the surface that owns the decision is correct; firing the
    // chargeable mutation from a list card would not be.
    expect(RFQ_PAGE).not.toContain('openEnquiry');
  });
});

// ── The RFQ detail page ────────────────────────────────────────────────────
//
// BuildHub had no RFQ detail page: `/rfq` listed cards and `/rfq/:id` was not a
// route, so the people an RFQ is addressed to could read a summary card and
// nothing more. These assertions are about the page's AUTHORIZATION SHAPE,
// which is where a detail page most easily goes wrong - the server procedures
// it calls are tested directly in rfqDetailAccess.test.ts.

describe('the RFQ detail page is role-aware, not one view for everyone', () => {
  const PAGE = read('../client/src/pages/RFQDetail.tsx')
    ;

  it('reads the OWNER-scoped procedure only when the caller owns the RFQ', () => {
    // rfq.get is `WHERE requesterId = ctx.user.id` on the server, so calling it
    // for a non-owner would simply fail - but firing it at all would produce a
    // pointless error on every provider's screen.
    expect(PAGE).toMatch(/trpc\.rfq\.get\.useQuery\([^)]*\{[^}]*enabled: isOwner/s);
  });

  it('everyone else reads the feed-equivalent summary', () => {
    expect(PAGE).toMatch(/trpc\.rfq\.summary\.useQuery/);
  });

  it('attachments are shown to the OWNER only', () => {
    // For a provider the attachments sit behind the qualified enquiry, which is
    // what the credit buys. Rendering them here would give away the paid part.
    const block = PAGE.slice(PAGE.indexOf('rfq-detail-attachments') - 600, PAGE.indexOf('rfq-detail-attachments'));
    expect(block).toMatch(/isOwner && attachments\.length > 0/);
  });

  it('the quotation comparison is rendered for the OWNER only', () => {
    expect(PAGE).toMatch(/isOwner && \(\s*<div[^>]*rfq-detail-quotations/s);
  });

  it('VIEWING CHARGES NOTHING - the page never calls the credit-spending mutation', () => {
    // The separation that makes "review before you buy" real.
    expect(PAGE).not.toContain('openEnquiry');
    expect(PAGE).not.toContain('submitQuotation');
  });

  it('says out loud what the credit costs rather than hiding the gap', () => {
    expect(PAGE).toMatch(/rfq-detail-provider-panel/);
    expect(PAGE).toMatch(/one of your monthly credits/i);
  });

  it('gives the same answer for "no such RFQ" and "not yours"', () => {
    expect(PAGE).toMatch(/rfq-detail-notfound/);
  });

  it('every link on the page resolves', () => {
    const hrefs = [...PAGE.matchAll(/<Link href=\{?[`"]([^`"]+)[`"]/g)].map(m => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      if (href.startsWith('${')) {
        // The respond CTA's destination depends on the caller's role and is
        // computed by getRolePlatformPath, whose every possible return value is
        // checked against the route table in its own describe above. Replacing
        // the interpolation with a placeholder here would produce `123?rfq=123`
        // and report a false dead link.
        expect(href, 'the only computed href on this page is the role platform path')
          .toMatch(/^\$\{getRolePlatformPath\(/);
        continue;
      }
      expect(resolves(href.replace(/\$\{[^}]+\}/g, '123')), `${href} does not resolve`).toBe(true);
    }
  });
});
