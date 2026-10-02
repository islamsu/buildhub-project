import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';

/**
 * ── THE APPROVED HOMEPAGE, AND THE THREE PLACES IT WAS NOT COPIED ───────
 *
 * The owner approved a reference design and then ruled on where the product
 * must diverge from it. Those rulings are the interesting part, because each
 * one is a case where reproducing the picture faithfully would have shipped
 * something untrue or unusable:
 *
 *   the Projects tile      has no public destination, so it became Get Quotes
 *   the hero photograph    is an owner asset, so the slot is empty not faked
 *   the amber labels       are 2.15:1 in white, so they are dark
 *
 * A screenshot cannot hold a decision. These assertions can.
 */

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => readSourceForAssertions(read(rel));

const HOME = () => code('client/src/pages/Home.tsx');
const SEARCH = () => code('client/src/components/SourcingSearch.tsx');

describe('the hero search is real, and is the one search', () => {
  it('the homepage renders the shared component rather than its own field', () => {
    expect(HOME(), 'the homepage has no search').toContain('<SourcingSearch');
    // A second hand-rolled typeahead is how two searches drift into behaving
    // differently against the same data.
    expect(HOME(), 'the homepage grew its own suggestion list')
      .not.toMatch(/suggestions\s*=\s*useMemo/);
  });

  it('the Marketplace Hub reads the same component, not a second copy', () => {
    const hub = code('client/src/pages/MarketplaceHub.tsx');
    expect(hub).toContain('<SourcingSearch');
    expect(hub, 'the hub kept its private copy of the typeahead')
      .not.toMatch(/suggestions\s*=\s*useMemo/);
  });

  it('IT NEVER REACHES FOR THE ADMIN SEARCH', () => {
    /*
     * `platformSearch` is the only universal cross-entity search in the
     * product and it is an adminProcedure. Wiring a public hero field to it -
     * even "just to read" - would widen an authorization surface to reproduce
     * a mockup. The owner ruled that out explicitly, and this is the only
     * assertion in the file that is about security rather than design.
     */
    expect(SEARCH(), 'the public search reaches for the admin procedure')
      .not.toContain('platformSearch');
  });

  it('it draws only on what a signed-out visitor may already read', () => {
    // The public taxonomy and the vendor directory, which excludes unapproved
    // and unverified accounts server-side. Nothing else has a public listing.
    expect(SEARCH()).toContain("trpc.marketplace.categories.useQuery({ view: 'public' }");
    expect(SEARCH()).toContain('trpc.marketplace.vendors.useQuery');
  });

  it('Search actually searches, rather than closing a dropdown', () => {
    /*
     * A button that looks like a capability and is not one is worse than no
     * button. Submitting goes to the catalogue with ?q=, and
     * `marketplace.list` has always taken a `search` argument - so this is a
     * genuine server-side search, and the destination genuinely reads the
     * parameter.
     */
    expect(SEARCH()).toContain('/marketplace/products?q=');
    const market = code('client/src/pages/Marketplace.tsx');
    expect(market, 'the catalogue ignores ?q=').toContain("URLSearchParams(window.location.search).get('q')");
    expect(market, 'the parameter is read but not used').toContain('useState(initialSearch)');
  });

  it('an outage in the suggestion sources is not reported as "no matches"', () => {
    // A typeahead that answers an empty list when it could not look tells the
    // visitor this marketplace has nothing of what they asked for (§10).
    expect(SEARCH()).toContain('sourcesFailed');
    expect(SEARCH()).toContain('<LoadFailedInline');
  });

  it('the dropdown is navigable from the keyboard', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
      expect(SEARCH(), `${key} is not handled`).toContain(`'${key}'`);
    }
    // And announced as a combobox rather than a bare text field.
    expect(SEARCH()).toContain("role=\"combobox\"");
    expect(SEARCH()).toContain('aria-activedescendant');
    expect(SEARCH()).toContain("role=\"listbox\"");
  });
});

describe('the rail ends with a real action, not a dead tile', () => {
  it('Get Quotes replaced the reference Projects tile', () => {
    /*
     * The reference's ninth tile is Projects. `/projects/:id` is membership
     * gated and there is no public listing, so that tile would lead nowhere -
     * and the owner was explicit that /rfq must NOT be relabelled Projects to
     * fill the hole. Get Quotes is the buyer action the tile implied, under
     * its own name, on the canonical route.
     */
    expect(HOME()).toContain('home-get-quotes-tile');
    expect(HOME()).toContain("navigate('/rfq')");
  });

  it('and the homepage advertises no public projects destination', () => {
    const home = HOME();
    expect(home, 'a public projects listing is being advertised')
      .not.toMatch(/navigate\('\/projects'\)|href="\/projects"/);
  });

  it('the categories come from the one taxonomy, with real counts', () => {
    expect(HOME()).toContain("trpc.marketplace.categories.useQuery({ view: 'public', withCounts: true }");
    // An empty category still appears; it just does not claim a count.
    expect(HOME()).toContain('(category.listedProducts ?? 0) > 0');
  });

  it('a failed taxonomy read says so instead of showing an empty rail', () => {
    expect(HOME()).toContain('categoriesFailed');
    expect(HOME()).toContain('<LoadFailed');
  });
});

describe('the trust strip is capability, not arithmetic', () => {
  it('every item states something the product does', () => {
    const copy = code('client/src/contexts/LanguageContext.tsx');
    for (const key of ['verified', 'compare', 'free', 'oneplace']) {
      expect(copy, `home.trust.${key} is missing`).toContain(`'home.trust.${key}'`);
      expect(copy, `home.trust.${key} has no supporting note`).toContain(`'home.trust.${key}.note'`);
    }
  });

  it('and it makes no numeric claim at all', () => {
    /*
     * §15 and §68: a trust signal must be earned and explainable. A capability
     * is checkable on the next page. A number on a marketing strip is a
     * promise that moves, and "10,000+ verified suppliers" was exactly the
     * class of claim this product already had to remove once.
     *
     * Real counts still appear on this page - they come from platformStats and
     * are rendered only when non-zero. The rule is about the STRIP.
     */
    /*
     * ASSERTED ON THE COPY, NOT ON THE JSX. The first version scanned the
     * markup and tripped on `grid-cols-2` and `mt-12` - a rule that cannot
     * tell a Tailwind class from a claim is a rule that teaches people to
     * delete it. The claim lives in the eight strings, so that is what is
     * read.
     */
    const copy = read('client/src/contexts/LanguageContext.tsx');
    const values = [...copy.matchAll(/'home\.trust\.[a-zA-Z.]+':\s*'([^']*)'/g)].map(m => m[1]);
    expect(values.length, 'the trust strings could not be found').toBe(16);
    for (const value of values) {
      expect(value, `"${value}" puts a number on the trust strip`).not.toMatch(/\d/);
    }
  });
});

describe('the hero slot is honest about the missing photograph', () => {
  it('no stock image was dropped in to make the page look populated', () => {
    /*
     * §57 forbids irrelevant stock and stretched low-resolution imagery, and
     * the owner's asset direction is that a development placeholder must be
     * clearly temporary rather than a photograph of somebody else's building.
     * The layout is the approved split; the panel simply carries brand until
     * the owner's image arrives.
     */
    const home = HOME();
    expect(home).toContain('hero-visual');
    expect(home, 'a photograph was substituted into the hero slot')
      .not.toMatch(/unsplash|pexels|placeholder\.com|picsum|<img[^>]+hero/i);
  });

  it('the hero is no longer a full viewport', () => {
    // It was `min-h-screen`, which did nothing while the flex min-size defect
    // was live and would now genuinely push every other section below the
    // fold. The reference hero is about half a screen.
    const home = HOME();
    const hero = home.slice(home.indexOf('<section'), home.indexOf('home-browse'));
    expect(hero, 'the hero is a full viewport again').not.toContain('min-h-screen');
  });
});

describe('the navigation stays legible once you scroll', () => {
  it('transparency depends on scroll position, not only on the route', () => {
    /*
     * It was `location === '/'` alone, so the bar stayed transparent for the
     * WHOLE homepage: scroll past the navy hero and white links sat on a white
     * section. A visitor scrolling back up to navigate found no navigation.
     */
    const navbar = code('client/src/components/Navbar.tsx');
    expect(navbar).toContain("const isTransparent = location === '/' && !scrolled;");
    expect(navbar).toContain("window.addEventListener('scroll'");
  });
});
