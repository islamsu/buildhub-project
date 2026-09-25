/**
 * ── THE MARKETING CENTER IS A COMPOSITION, AND A HONEST ONE ─────────────
 *
 * §89 item 16: compose the canonical systems, create no duplicate placement,
 * sponsorship, analytics or entitlement domain, and show no payment budgets,
 * CPC, CPM, GMV, revenue, ROI or fabricated conversions.
 *
 * Two failure modes this file exists to prevent, and they pull in opposite
 * directions:
 *
 *   A SECOND DOMAIN. A supplier-facing report with its own table, its own
 *   event type or its own CTR formula will disagree with the Admin report
 *   the first time either changes - and a supplier and an administrator
 *   reading different numbers for the same placement is how a commercial
 *   dispute becomes unresolvable.
 *
 *   AN INVENTED NUMBER. BuildHub has no payment provider. Any spend, ROI or
 *   projected-reach figure would be fabricated, and a supplier who acted on
 *   one would be making real decisions on something BuildHub made up.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const src = (relative: string) => readSourceForAssertions(readFileSync(join(ROOT, relative), 'utf8'));

const MARKETING = src('server/vendorMarketing.ts');
const PAGE = src('client/src/pages/MarketingCenterPage.tsx');
const ANALYTICS = src('server/placementAnalytics.ts');
const ROUTERS = src('server/routers.ts');

describe('it composes the canonical systems rather than forking them', () => {
  it('defines no table, no migration and no event type of its own', () => {
    // A new domain is the thing §89 forbids. `mysqlTable` here would be one.
    expect(MARKETING).not.toContain('mysqlTable');
    expect(MARKETING).not.toContain('ANALYTICS_EVENTS.');
    expect(src('drizzle/schema.ts')).not.toContain('vendorMarketing');
  });

  it('reads through the SAME performance function the Admin report calls', () => {
    // Not a copy of the query - the function itself, given a scope. Two
    // readers of placement performance can disagree about what a CTR is.
    expect(MARKETING).toContain("from './placementAnalytics'");
    expect(MARKETING).toContain('placementPerformance(now, { vendorId, productIds })');
    expect(ANALYTICS).toContain('export async function placementPerformance');
  });

  it('and the Admin report still calls it unscoped', () => {
    // The scope is an argument with a default, so the existing caller is
    // unchanged. If scoping had been made mandatory, the Admin screen would
    // silently have become one vendor's view.
    // `readSourceForAssertions` strips empty braces, so the default value
    // reads as `= ` here. Asserted on the parameter and its OPTIONALITY
    // separately rather than on a literal the stripper rewrites.
    expect(ANALYTICS).toContain('scope: PlacementPerformanceScope =');
    expect(ANALYTICS).toContain('export type PlacementPerformanceScope');
    expect(ROUTERS).toContain('placementPerformance(');
  });

  it('uses the canonical placement LABEL rather than a hand-written ternary', () => {
    // §18: Featured and Sponsored must never blur. A local
    // `kind === 'featured' ? ... : ...` is how they eventually do.
    expect(MARKETING).toContain("from '@shared/placement'");
    expect(MARKETING).toContain('placementLabel(row.source)');
    expect(PAGE).toContain('<PlacementBadge label={placement.label} />');
  });

  it('and the placement store is the canonical one', () => {
    expect(MARKETING).toContain('vendorSponsorships');
  });
});

describe('a supplier sees only their OWN commercial reach', () => {
  it('the procedure scopes by the session, never by an input id', () => {
    const start = ROUTERS.indexOf('marketingOverview: approvedProviderProcedure');
    const end = ROUTERS.indexOf('showcaseCandidates:', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = ROUTERS.slice(start, end);
    expect(body).toContain('ctx.user.id');
    expect(body, 'marketingOverview takes a vendorId from the caller')
      .not.toMatch(/\.input\(/);
  });

  it('a product placement counts as the supplier\'s, not only a provider one', () => {
    // Scoping on vendorId alone hides every sponsored PRODUCT a supplier has,
    // which is most of what they would come to this screen to see.
    expect(MARKETING).toContain('eq(products.supplierId, vendorId)');
    expect(MARKETING).toContain('vendorSponsorships.productId');
  });

  it('THE SCOPE IS ACTUALLY APPLIED TO THE QUERY, not merely computed', () => {
    /*
     * THIS ASSERTION EXISTS BECAUSE A MUTATION SURVIVED.
     *
     * Replacing `.where(scopeClause(scope))` with `.where(undefined)` — so
     * `placementPerformance` computes EVERY placement on the platform for
     * every supplier page view — left the browser probe at 36/36.
     *
     * The reason is worth recording: the supplier's placement LIST comes
     * from the scoped query in `vendorMarketing.ts`, and
     * `placementPerformance` only supplies metrics looked up BY ID. So an
     * over-broad result leaks nothing — the extra rows are never read.
     * Scoping there is defence-in-depth and a performance guarantee, and
     * both were invisible to every behavioural test.
     *
     * Defence-in-depth that nothing checks is just code.
     */
    expect(ANALYTICS).toContain('.where(scopeClause(scope))');
  });

  it('and the OUTER query is scoped too, which is what actually blocks the leak', () => {
    // The two layers are independent on purpose: if either is removed the
    // other still refuses. This pins the one that does the real work.
    expect(MARKETING).toContain('eq(vendorSponsorships.vendorId, vendorId)');
    const start = MARKETING.indexOf('const [rows, performance, showcase]');
    const end = MARKETING.indexOf('const byId', start);
    expect(start).toBeGreaterThan(-1);
    const read = MARKETING.slice(start, end);
    expect(read, 'the placement list is read unscoped').toContain('.where(');
    expect(read).toContain('inArrayOrNever(productIds)');
  });

  it('AND AN EMPTY SCOPE FAILS CLOSED, never open', () => {
    /*
     * THE DANGEROUS SHAPE. `inArray` over an empty list, and an empty `or()`,
     * are both DROPPED by the query builder - turning "this supplier owns
     * nothing" into "every placement on the platform", which would show one
     * supplier every other supplier's commercial performance.
     */
    expect(MARKETING).toContain('if (ids.length === 0) return sql`1 = 0`');
    const start = ANALYTICS.indexOf('function scopeClause');
    const end = ANALYTICS.indexOf('type PlacementRowLite', start);
    expect(start).toBeGreaterThan(-1);
    const clause = ANALYTICS.slice(start, end);
    expect(clause.length).toBeGreaterThan(100);
    expect(clause, 'a scope with no arms matches everything')
      .toContain('if (arms.length === 0) return sql`1 = 0`');
  });

  it('and an unscoped call is still explicitly possible, for the Admin report', () => {
    const start = ANALYTICS.indexOf('function scopeClause');
    const clause = ANALYTICS.slice(start, ANALYTICS.indexOf('type PlacementRowLite', start));
    expect(clause).toContain('return undefined');
  });
});

describe('every figure is a count of something that happened', () => {
  it('NO BUDGET, CPC, CPM, SPEND, REVENUE, GMV OR ROI anywhere', () => {
    /*
     * BuildHub has no payment provider. Each of these would be invented to
     * make the screen look commercial, and a supplier who acted on a
     * fabricated ROI figure would be making real business decisions on
     * something BuildHub made up (§10, §30).
     */
    const forbidden = [
      'budget', 'cpc', 'cpm', 'spend', 'revenue', 'gmv', 'roi',
      'costPer', 'projected', 'estimatedReach', 'trending',
    ];
    for (const term of forbidden) {
      expect(MARKETING.toLowerCase(), `vendorMarketing invents a ${term} figure`)
        .not.toContain(term.toLowerCase());
    }
    // The page may NAME them only to say they are absent, so the check there
    // is on computation rather than on the word.
    for (const term of ['cpc', 'cpm', 'gmv', 'roi']) {
      expect(PAGE, `the page computes a ${term}`)
        .not.toMatch(new RegExp(`${term}\\s*[:=]\\s*[^'"\`]`, 'i'));
    }
  });

  it('a rate with no denominator is NOT ENOUGH DATA, never 0%', () => {
    // §68: where a metric has insufficient data, prefer omission or "Not
    // enough data" over a misleading percentage. "0.0%" reads as "nobody
    // clicks this", which is a different and false claim.
    expect(PAGE).toContain("? (ar ? 'لا توجد بيانات كافية' : 'Not enough data')");
    expect(MARKETING).toContain('ctr: metrics?.ctr ?? null');
    expect(MARKETING).toContain('viewRate: metrics?.viewRate ?? null');
    expect(MARKETING).toContain('conversionRate: metrics?.conversionRate ?? null');
  });

  it('an OUTAGE is not reported as no promotion', () => {
    // §10, §64: a database failure that renders as "0 impressions" tells a
    // supplier their placements are not working, which is a commercial claim
    // made on no evidence.
    expect(MARKETING).toContain('requireDb');
    expect(PAGE).toContain('overview.isError');
    expect(PAGE).toContain('<LoadFailed');
  });

  it('and the empty state does not invent a way to buy placement', () => {
    // There is no payment provider. A "Buy a placement" button would promise
    // a transaction the product cannot complete (§30). The legitimate next
    // actions are the ones that exist.
    expect(PAGE).toContain('data-testid="marketing-empty"');
    expect(PAGE).toContain('data-testid="marketing-empty-showcase"');
    for (const invented of ['Buy ', 'Upgrade to sponsor', 'Purchase placement', 'Boost for']) {
      expect(PAGE, `the empty state offers to sell something: ${invented}`)
        .not.toContain(invented);
    }
  });
});

describe('Featured, Sponsored and Showcase stay three different things', () => {
  it('Featured and Sponsored are counted separately, never summed', () => {
    // An editorial pick's impressions are not advertising inventory, and one
    // combined total would report BuildHub as selling what it gave away.
    expect(MARKETING).toContain("activeFeatured: placements.filter(p => p.active && p.label === 'FEATURED').length");
    expect(MARKETING).toContain("activeSponsored: placements.filter(p => p.active && p.label === 'SPONSORED').length");
    expect(MARKETING, 'Featured and Sponsored are added into one figure')
      .not.toMatch(/activeFeatured\s*\+\s*activeSponsored/);
    expect(PAGE).toContain('data-testid="marketing-active-featured"');
    expect(PAGE).toContain('data-testid="marketing-active-sponsored"');
  });

  it('and the two are described by WHO decided them', () => {
    // The distinction a supplier needs is not the word but the authority
    // behind it: BuildHub chose this one, BuildHub granted that one.
    expect(PAGE).toMatch(/editorial selection/i);
    expect(PAGE).toMatch(/Commercial placement, granted by BuildHub/i);
  });

  it('the Showcase is reported as the supplier\'s own, and NOT as ranking', () => {
    // Reported beside promotion, it could be read as something they were
    // granted. It is not: it is their own emphasis on their own page.
    expect(PAGE).toContain('data-testid="marketing-showcase-note"');
    expect(PAGE).toMatch(/does not change your marketplace ranking/i);
    expect(MARKETING).toContain('showcaseCount: showcase.cards.length');
  });

  it('and the showcase count is never folded into a placement total', () => {
    expect(MARKETING, 'the showcase is counted as promotion')
      .not.toMatch(/showcaseCount\s*\+|(\+\s*showcaseCount)/);
  });
});

describe('scope and expiry are answered, and derived rather than stored', () => {
  it('an elapsed or revoked placement is not reported as active', () => {
    // The same fail-closed rule `liveSponsorshipFilter` applies: a placement
    // that elapsed last night is not active this morning whether or not
    // anything ran to tidy it up.
    expect(MARKETING).toContain('active: row.revokedAt == null');
    expect(MARKETING).toContain('new Date(row.endsAt) > now');
  });

  it('and an open-ended placement says so rather than reading as expired', () => {
    // `endsAt` NULL means "until revoked", which is a different fact from
    // "the end date has passed".
    expect(PAGE).toMatch(/Open-ended until revoked/);
  });

  it('the scope a supplier is shown is surface, taxonomy and period', () => {
    expect(MARKETING).toContain('surface: vendorSponsorships.surface');
    expect(MARKETING).toContain('category: vendorSponsorships.category');
    expect(MARKETING).toContain('startsAt: vendorSponsorships.startsAt');
    expect(PAGE).toContain('data-testid={`marketing-period-${placement.placementId}`}');
  });
});

describe('the capability is reachable', () => {
  it('it has a route', () => {
    expect(src('client/src/App.tsx')).toContain('path={"/marketing"}');
  });

  it('and EVERY provider role can find it in the menu', () => {
    // All five can hold a placement, so all five need the destination. A
    // capability one role cannot reach is a dead capability for that role.
    const layout = src('client/src/components/DashboardLayout.tsx');
    const occurrences = layout.split("path: '/marketing'").length - 1;
    expect(occurrences, 'a provider role cannot reach the Marketing Center').toBe(5);
  });

  it('and its label is translated in both languages', () => {
    const lang = readFileSync(join(ROOT, 'client/src/contexts/LanguageContext.tsx'), 'utf8');
    expect(lang).toContain("'nav.marketing': 'Marketing Center'");
    expect(lang).toContain("'nav.marketing': 'مركز التسويق'");
  });
});
