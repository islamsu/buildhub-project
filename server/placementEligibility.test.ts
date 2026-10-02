/**
 * ── A PLACEMENT BUYS A SLOT, NEVER AN EXEMPTION ───────────────────────────
 *
 * The owner's rule, which this file exists to keep true:
 *
 *   PUBLICLY RENDERABLE PLACEMENT
 *     = ACTIVE PLACEMENT
 *     AND TARGET EXISTS
 *     AND TARGET IS CURRENTLY PUBLICLY ELIGIBLE
 *     AND VIEWER MAY SEE TARGET
 *
 * ── THE DEFECT THAT PROMPTED IT ───────────────────────────────────────────
 *
 * Promoting a product takes TWO gates, and only one of them is about the
 * product. `publicProductFilter()` says the row is published rather than a
 * draft, off sale or archived. `directoryVisibilityFilter()` says the SELLER
 * is still a provider the marketplace lists.
 *
 * The second gate is the forgettable one, because a suspended supplier's
 * products are untouched: status stays 'active', every column reads exactly as
 * it did, and nothing about the product says its business is gone.
 * `placedProducts` joined the directory and checked it. `listFeaturedProducts`
 * checked the product only. So freezing a supplier silenced their SPONSORED
 * slot and left their FEATURED slot advertising them - two promotion surfaces,
 * one of them laxer, and no test could see the difference.
 *
 * ── WHY THE FIX IS A SHARED PREDICATE AND NOT TWO CORRECT CALL SITES ──────
 *
 * Because two call sites agreeing is not one rule. These two agreed on the
 * first gate and disagreed on the second for as long as both existed. Featured
 * and Sponsored remain separate systems with separate labels and separate
 * causes - that distinction is load-bearing elsewhere in the product - but
 * "may a visitor be shown this product in a promoted slot" is a single
 * question with a single answer, and it now lives in one function.
 *
 * ── AND WHAT WAS NOT A DEFECT ─────────────────────────────────────────────
 *
 * The originally reported failure - a DELISTED product rendering through a
 * live Sponsored placement - was a stale probe. It delisted with `update
 * products set active=0`, and `active` is the legacy boolean that
 * productLifecycle writes FROM the status and no reader consults. `status`
 * stayed 'active', so the row was genuinely eligible and the marketplace was
 * right to render it. No application path can produce that row. The assertions
 * below use the real lifecycle vocabulary for that reason.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { publiclyPromotableProductFilter } from './publicPlacement';
import { publicProductFilter } from './productLifecycle';
import { directoryVisibilityFilter } from './vendorDirectory';

const read = (rel: string) =>
  readSourceForAssertions(readFileSync(new URL(rel, import.meta.url), 'utf8'));

const PLACEMENT = read('./publicPlacement.ts');
const FEATURED = read('./featuredProducts.ts');

/**
 * One top-level declaration out of a module, by name.
 *
 * Bounded by the next top-level `export` or doc comment rather than by the
 * first `\n}`. The first version cut at `\n}` and that is the end of the
 * PARAMS TYPE LITERAL - `placedProducts(params: {\n  db: Db;\n ... \n})` -
 * so every body assertion was run against a six-line type and six of them
 * failed for the extractor's reasons rather than the product's.
 */
function declaration(module: string, name: string): string {
  const start = module.indexOf(`export async function ${name}`);
  if (start < 0) throw new Error(`${name} is gone from the module`);
  const rest = module.slice(start + 1);
  const next = rest.search(/\n(?:export |\/\*\*)/);
  return next < 0 ? rest : rest.slice(0, next);
}

/**
 * The SQL a Drizzle condition actually builds, as text.
 *
 * THE REAL QUERY, not the source line that builds it. A call site can import
 * the right function and still compose it wrongly - with `or`, or alongside a
 * clause that defeats it - and only the rendered SQL shows that.
 *
 * Rendered through the dialect rather than JSON.stringify'd: a Drizzle
 * condition holds table objects whose columns point back at their table, so
 * stringifying one throws on the circular reference. The first version of this
 * helper did exactly that and failed two assertions for its own reasons.
 */
const DIALECT = new MySqlDialect();
function sqlOf(condition: unknown): string {
  return DIALECT.sqlToQuery(condition as never).sql;
}

describe('one rule decides whether a product may be promoted', () => {
  it('THE SHARED FILTER CARRIES BOTH GATES, NOT JUST THE PRODUCT ONE', () => {
    const shared = sqlOf(publiclyPromotableProductFilter());
    const productGate = sqlOf(publicProductFilter());
    const sellerGate = sqlOf(directoryVisibilityFilter());

    /* Each gate contributes its own distinguishing column. The product gate is
       about `products.status`; the seller gate is about `users`. If either
       disappears from the composition, one of these is absent. */
    expect(productGate, 'the product gate stopped naming the product status')
      .toMatch(/`products`\.`status`/);
    expect(sellerGate, 'the seller gate stopped naming onboardingStatus')
      .toMatch(/`users`\.`onboardingStatus`/);

    expect(shared, 'the shared filter dropped the product lifecycle gate')
      .toMatch(/`products`\.`status`/);
    expect(shared, 'the shared filter dropped the SELLER gate - the forgettable one')
      .toMatch(/`users`\.`onboardingStatus`/);
    expect(shared, 'the shared filter stopped checking the account status')
      .toMatch(/`users`\.`accountStatus`/);
    expect(shared, 'the shared filter stopped excluding deactivated sellers')
      .toMatch(/`users`\.`deactivatedAt` is null/);
  });

  it('and it is an AND, so neither gate can be satisfied alone', () => {
    /*
     * THE MUTATION THIS CATCHES: `or(...)` in place of `and(...)`. Every
     * assertion above would still pass - both gates are present - while an
     * eligible product with a suspended seller sails through on the first
     * clause. The owner's §8 names this case specifically.
     */
    const shared = sqlOf(publiclyPromotableProductFilter());
    expect(shared, 'the two gates became alternatives instead of requirements')
      .not.toMatch(/\bor\b/);
    expect(shared, 'the gates are no longer conjoined').toMatch(/\band\b/);
  });
});

describe('every public promotion surface reads that one rule', () => {
  it('SPONSORED resolves its target through the shared filter', () => {
    /* placedProducts is the paid path: masterProduct and spotlightProducts
       both go through it. */
    const body = declaration(PLACEMENT, 'placedProducts');
    expect(body, 'the paid path stopped using the shared filter')
      .toContain('publiclyPromotableProductFilter()');
    expect(body, 'the paid path is restating the gates instead of sharing them')
      .not.toMatch(/publicProductFilter\(\)[\s\S]{0,80}directoryVisibilityFilter\(\)/);
    expect(body, 'the seller join became outer, which filters nothing')
      .toContain('innerJoin(users');
  });

  it('FEATURED resolves its target through the SAME shared filter', () => {
    expect(FEATURED, 'the editorial path stopped using the shared filter')
      .toContain('publiclyPromotableProductFilter()');
    /* The original defect, pinned: the editorial reader checked the product
       and nothing else. */
    expect(FEATURED, 'the editorial path went back to the product gate alone')
      .not.toMatch(/conditions = \[publicProductFilter\(\)/);
    expect(FEATURED, 'a LEFT join lets the seller clauses filter nothing')
      .not.toContain('leftJoin(users');
    expect(FEATURED, 'the editorial path lost its inner join to the seller')
      .toContain('innerJoin(users');
  });

  it('and Featured is still EDITORIAL - sharing a gate is not merging the systems', () => {
    /*
     * Worth pinning because the fix moves them closer. Featured must keep
     * selecting on `products.featured` - an editorial flag - and must not
     * start reading the commercial placement table. One shared eligibility
     * answer, two unrelated causes.
     */
    expect(FEATURED, 'the editorial flag stopped deciding what is Featured')
      .toContain('eq(products.featured, true)');
    expect(FEATURED, 'the editorial reader started reading commercial bookings')
      .not.toMatch(/vendorSponsorships/);
  });

  it('a malformed placement row is skipped rather than rendered', () => {
    /* §4, fail closed. A row whose target id is null never reaches the entity
       fetch at all. */
    const body = declaration(PLACEMENT, 'livePlacementRows');
    expect(body, 'a null target id is no longer skipped')
      .toMatch(/entityId == null\) continue/);
  });

  it('and an entity the eligibility query dropped is never emitted', () => {
    /*
     * THE STRUCTURAL REASON THE RULE HOLDS. Both resolvers build a map from
     * the ELIGIBLE rows and then walk the BOOKED rows, emitting only what the
     * map contains. A booked-but-ineligible target is a map miss, so it is
     * dropped by construction rather than by remembering to check.
     *
     * The mutation this catches is the plausible one: emitting the booking's
     * own data when the lookup misses, as a "graceful fallback". That would
     * render every ineligible target.
     */
    for (const name of ['placedProducts', 'placedProviders']) {
      const body = declaration(PLACEMENT, name);
      expect(body, `${name} no longer drops a target the filter removed`)
        .toMatch(/if \(!(product|vendor)\) continue;/);
    }
  });
});

describe('the placement record outlives the rendering decision', () => {
  it('eligibility is re-checked on READ, so nothing has to be swept', () => {
    /*
     * §3: if the target becomes ineligible after activation, public rendering
     * must stop WITHOUT the placement record being deleted. That is only true
     * because the eligibility join happens at read time - there is no
     * denormalised "renderable" column to go stale, and no job to miss.
     */
    expect(PLACEMENT, 'a cached renderability flag would make this stale')
      .not.toMatch(/\brenderable\b|isVisible|cachedEligib/i);
    expect(declaration(PLACEMENT, 'placedProducts'), 'the eligibility check left the read path')
      .toMatch(/\.where\(and\(/);
  });

  it('and revocation is a timestamp, not a delete', () => {
    expect(PLACEMENT).toContain('isNull(vendorSponsorships.revokedAt)');
  });
});
