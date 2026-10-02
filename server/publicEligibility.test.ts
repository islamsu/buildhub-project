/**
 * ── ONE AUTHORITY FOR PUBLIC PRODUCT VISIBILITY ───────────────────────────
 *
 *   PUBLIC PRODUCT DISCOVERY
 *     = PRODUCT PUBLICLY ELIGIBLE
 *     AND SELLER PUBLICLY ELIGIBLE
 *
 * ── WHY THESE ASSERTIONS READ SQL AND NOT IMPORT LINES ────────────────────
 *
 * Because this gate has now gone missing twice, and neither time would a
 * name-check have caught it. The first time, two promotional readers both
 * imported a correctly-named filter and differed in whether the accompanying
 * join was INNER - a LEFT join left the seller clauses filtering nothing while
 * every source assertion stayed green. The second time, the organic catalogue
 * imported `publicProductFilter` and was simply asking a smaller question than
 * the promoted strips above it.
 *
 * A name tells you a function was called. The rendered SQL tells you what the
 * database will actually do, which is the only thing a visitor experiences. So
 * the predicate assertions below render real SQL through the dialect, and the
 * surfaces are proved end to end in evidence/zg-publiceligibility.mjs against
 * a live database.
 *
 * ── AND WHY A SUBQUERY RATHER THAN A JOIN ─────────────────────────────────
 *
 * The seller clauses live on `users`. Expressed as a join, every call site
 * inherits an obligation it can silently get wrong. Carried as
 * `supplierId IN (SELECT ...)`, the gate travels with the predicate: a reader
 * either has it or visibly does not. MariaDB resolves it as a semi-join - one
 * statement, an eq_ref primary-key probe per candidate row, no N+1 - and the
 * grouped category count materialises it once.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { readSourceForAssertions } from './_testing/sourceText';
import { publicMarketplaceProductFilter, eligibleSellerIds } from './publicEligibility';
import { publicProductFilter } from './productLifecycle';
import { directoryVisibilityFilter } from './vendorDirectory';
import { publiclyPromotableProductFilter } from './publicPlacement';

const DIALECT = new MySqlDialect();
const sqlOf = (condition: unknown) => DIALECT.sqlToQuery(condition as never).sql;

const ROOT = join(import.meta.dirname, '..');
const source = (rel: string) => readSourceForAssertions(readFileSync(join(ROOT, rel), 'utf8'));

describe('the canonical public marketplace predicate', () => {
  it('ASKS ABOUT THE PRODUCT AND ABOUT THE SELLER', () => {
    const sql = sqlOf(publicMarketplaceProductFilter());

    /* The product dimension, contributed by productLifecycle. */
    expect(sql, 'the product lifecycle gate is gone').toMatch(/`products`\.`status` = \?/);

    /* The seller dimension, contributed by vendorDirectory. Each clause is
       named individually: "mentions users" would pass on a single clause. */
    expect(sql, 'the seller reach is gone').toMatch(/`products`\.`supplierId` in \(select/);
    expect(sql, 'the role clause is gone').toMatch(/`users`\.`userRole` in/);
    expect(sql, 'the account-status clause is gone').toMatch(/`users`\.`accountStatus` = \?/);
    expect(sql, 'the deactivation clause is gone').toMatch(/`users`\.`deactivatedAt` is null/);
    expect(sql, 'the approval clause is gone').toMatch(/`users`\.`onboardingStatus` = \?/);
  });

  it('and it is a CONJUNCTION - neither dimension can satisfy it alone', () => {
    /*
     * §16's `or`-for-`and` mutation. Every clause above would still be
     * present, and an eligible product with a suspended seller would pass on
     * the first one.
     */
    const sql = sqlOf(publicMarketplaceProductFilter());
    const outer = sql.slice(0, sql.indexOf('in (select'));
    expect(outer, 'the two dimensions became alternatives').not.toMatch(/\bor\b/);
    expect(outer, 'the dimensions are no longer conjoined').toMatch(/\band\b/);
  });

  it('neither dimension is restated here - both come from their owners', () => {
    /*
     * The composition must contain its inputs verbatim. A hand-written copy of
     * either rule is how the two definitions drift apart, which is the failure
     * this whole module exists to prevent.
     */
    const composed = sqlOf(publicMarketplaceProductFilter());
    /* Both inputs appear VERBATIM inside the composition. Rendered from the
       composed predicate rather than from the subquery object, because a
       QueryBuilder select is not a SQL node and sqlToQuery cannot render one
       on its own - the first version of this assertion threw on that instead
       of comparing anything. */
    expect(composed, 'the product rule is being restated rather than reused')
      .toContain(sqlOf(publicProductFilter()));
    expect(composed, 'the seller rule is being restated rather than reused')
      .toContain(sqlOf(directoryVisibilityFilter()));
    expect(eligibleSellerIds(), 'the seller subquery is gone').toBeTruthy();
  });

  it('and seller eligibility is the DIRECTORY rule, not a commercial one', () => {
    /*
     * §5. Public listing is not something a plan buys or a lapsed invoice
     * removes. If any of these ever appears in the gate, a billing event has
     * become a visibility event.
     */
    const sql = sqlOf(publicMarketplaceProductFilter());
    for (const foreign of [
      'vendorSubscriptions', 'subscription', 'plan', 'entitlement', 'billing',
      'vendorSponsorships', 'marketCode', 'providerMarkets',
    ]) {
      expect(sql, `${foreign} has entered public listing eligibility`)
        .not.toMatch(new RegExp(foreign, 'i'));
    }
  });
});

describe('promotional eligibility is a SUBSET, structurally', () => {
  it('PROMOTION COMPOSES THE MARKETPLACE PREDICATE, it does not replace it', () => {
    /*
     * §10. Proved by SQL equality rather than by reading the call chain: the
     * promotional base IS the marketplace predicate, so each promotional
     * surface can only narrow it by ANDing its own condition. "Promoted,
     * therefore visible" is not expressible.
     */
    expect(sqlOf(publiclyPromotableProductFilter())).toBe(sqlOf(publicMarketplaceProductFilter()));
  });

  it('and each promotional surface adds its own condition on top', () => {
    const featured = source('server/featuredProducts.ts');
    const placement = source('server/publicPlacement.ts');
    expect(featured, 'Featured stopped being editorial').toContain('eq(products.featured, true)');
    expect(featured, 'the editorial reader started reading commercial bookings')
      .not.toMatch(/vendorSponsorships/);
    expect(placement, 'the paid path stopped requiring a live booking')
      .toContain('isNull(vendorSponsorships.revokedAt)');
  });

  it('and eligibility no longer depends on remembering a join', () => {
    /*
     * THE REGRESSION THIS BLOCKS IS THE ORIGINAL BUG. Eligibility used to
     * require an INNER join to `users`; a LEFT join disabled it in silence.
     * Both readers still join `users` - for the seller's NAME - but the gate
     * travels in the predicate, so the two are independent. Asserted by
     * rendering the predicate with no FROM clause at all: if it still names
     * every seller clause, no join is carrying the rule.
     */
    const sql = sqlOf(publiclyPromotableProductFilter());
    expect(sql).toMatch(/in \(select `id` from `users` where/);
    expect(sql, 'the predicate leans on an outer query for its seller clauses')
      .not.toMatch(/^\s*(inner |left )?join/i);
  });
});

describe('the public surfaces use the one authority, the private ones do not', () => {
  /**
   * A census, because the defect was a reader that used the smaller predicate.
   * Classification is the point: applying public discovery rules to an owner's
   * own inventory or to an administrator's investigation would be a different
   * defect in the opposite direction.
   */
  const PUBLIC_READERS: Array<[string, string]> = [
    ['server/sitemap.ts', 'product URLs for crawlers'],
    ['server/seoEntityName.ts', 'public page titles'],
    ['server/platformStats.ts', 'the public product count'],
    ['server/categoryService.ts', 'public category counts'],
    ['server/savedItems.ts', 'the shortlist, which mirrors what is browsable'],
    ['server/featuredProducts.ts', 'editorial Featured'],
    ['server/publicPlacement.ts', 'commercial placement'],
    ['server/supplierShowcase.ts', 'the public storefront emphasis'],
  ];

  it.each(PUBLIC_READERS)('%s reads the canonical predicate (%s)', (file) => {
    /*
     * EITHER NAME COUNTS, and that is not a loophole. The promotional readers
     * go through `publiclyPromotableProductFilter`, which the test above pins
     * by rendered SQL to BE the marketplace predicate - so reaching it by that
     * name is reaching the same authority, and it keeps the promotional
     * surfaces able to state what they mean.
     */
    const text = source(file);
    const usesCanonical = /publicMarketplaceProductFilter|publiclyPromotableProductFilter/.test(text);
    expect(usesCanonical, `${file} is not reading the public eligibility authority`).toBe(true);
  });

  it('the three PUBLIC product endpoints all use it', () => {
    const routers = source('server/routers.ts');
    /* Each endpoint's own body, so a correct import elsewhere in a 12k-line
       file cannot vouch for a reader that never calls it. */
    const slice = (name: string) => {
      const start = routers.indexOf(`  ${name}: publicProcedure`);
      expect(start, `${name} is no longer a publicProcedure`).toBeGreaterThan(-1);
      const rest = routers.slice(start + 1);
      const next = rest.search(/\n  [a-zA-Z][a-zA-Z0-9_]*: (public|protected|admin|approved)/);
      return next < 0 ? rest : rest.slice(0, next);
    };
    for (const endpoint of ['list', 'vendorProducts', 'get']) {
      expect(slice(endpoint), `marketplace.${endpoint} is not using the public authority`)
        .toContain('publicMarketplaceProductFilter()');
    }
    /* §7: the storefront page already refuses an unlisted provider, but this
       endpoint takes the vendor id directly and must refuse independently. */
    expect(slice('vendorProducts'), 'the secondary route reverted to the product gate alone')
      .not.toMatch(/publicProductFilter\(\)/);
  });

  it('AND THE OWNER AND ADMIN PATHS ARE DELIBERATELY LEFT ALONE', () => {
    /*
     * The opposite failure, which would be just as real: a supplier unable to
     * see their own inventory or their own question inbox while suspended, or
     * an administrator unable to investigate the catalogue they just froze.
     * Each of these is scoped to one user id or sits behind an admin
     * permission, and each keeps the product-only gate.
     */
    const showcase = source('server/supplierShowcase.ts');
    expect(showcase, "the supplier's own showcase picker lost its owner rule")
      .toMatch(/eq\(products\.supplierId, userId\), publicProductFilter\(\)/);
    const routers = source('server/routers.ts');
    expect(routers, "the supplier's own question inbox lost its owner rule")
      .toMatch(/eq\(products\.supplierId, ctx\.user\.id\), publicProductFilter\(\)/);
  });

  it('and no public product reader was missed', () => {
    /*
     * THE BACKSTOP. Everything above names a file; this one asks whether any
     * file still reads `products` through the product gate alone without being
     * one of the three known owner-scoped exceptions. A new public reader added
     * later fails here rather than shipping with half a rule.
     */
    const ALLOWED = new Set([
      /* The writer's validator and the supplier's own picker - both scoped to
         `userId`, both must keep working while an account is suspended. */
      'server/supplierShowcase.ts',
      /* The supplier's own Q&A inbox, scoped to ctx.user.id. */
      'server/routers.ts',
      /* Where the product gate is DEFINED, and where it is composed. */
      'server/productLifecycle.ts',
      'server/publicEligibility.ts',
    ]);
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
      }
      return out;
    };
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, 'server'))) {
      const rel = file.slice(ROOT.length + 1);
      if (ALLOWED.has(rel)) continue;
      const text = readSourceForAssertions(readFileSync(file, 'utf8'));
      if (/\bpublicProductFilter\(\)/.test(text)) offenders.push(rel);
    }
    expect(offenders, 'a reader is using the product gate without the seller gate')
      .toEqual([]);
  });
});

describe('composing eligibility, not corrupting lifecycle state', () => {
  it('NOTHING REWRITES A PRODUCT WHEN ITS SELLER CHANGES STANDING', () => {
    /*
     * §2 and §11. The tempting shortcut is to archive or deactivate a
     * suspended seller's products so the ordinary filters hide them. That
     * destroys one dimension to express the other: the lifecycle state becomes
     * a lie, the supplier's own catalogue is wrecked, and reinstating the
     * seller cannot restore it without inventing transitions.
     *
     * So the account mutations must not touch `products` at all.
     */
    const routers = source('server/routers.ts');
    const freeze = routers.slice(routers.indexOf('  setUserFrozen:'));
    const body = freeze.slice(0, freeze.search(/\n  [a-zA-Z][a-zA-Z0-9_]*: /));
    expect(body, 'freezing an account is rewriting its products').not.toMatch(/update\(products\)/);
    expect(body, 'freezing an account is touching the product lifecycle')
      .not.toMatch(/transitionProduct/);
  });
});
