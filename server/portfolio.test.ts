import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

/**
 * PROVIDER PORTFOLIO IS SELF-MANAGED AND OWNER-SCOPED.
 *
 * A professional manages their own portfolio. Every write must be scoped to
 * ctx.user.id, and reads of another provider's portfolio are showcase data
 * only. No provider may edit another provider's work.
 */

const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));

const PORTFOLIO = (() => {
  const start = ROUTERS.indexOf('const portfolioRouter = router({');
  const end = ROUTERS.indexOf('\nconst profileRouter', start);
  return ROUTERS.slice(start, end === -1 ? undefined : end);
})();

function body(anchor: string, endAnchor: string): string {
  const start = PORTFOLIO.indexOf(anchor);
  expect(start, anchor).toBeGreaterThan(-1);
  const end = PORTFOLIO.indexOf(endAnchor, start);
  return PORTFOLIO.slice(start, end === -1 ? undefined : end);
}

describe('portfolio router', () => {
  it('the write procedures are approved-provider gated', () => {
    expect(PORTFOLIO).toMatch(/myItems: approvedProviderProcedure/);
    expect(PORTFOLIO).toMatch(/create: approvedProviderProcedure/);
    expect(PORTFOLIO).toMatch(/update: approvedProviderProcedure/);
    expect(PORTFOLIO).toMatch(/delete: approvedProviderProcedure/);
  });

  it('create always attributes the row to the authenticated user', () => {
    const b = body('create: approvedProviderProcedure', 'update: approvedProviderProcedure');
    expect(b).toContain('userId: ctx.user.id');
    expect(b).not.toContain('userId: input');
  });

  it('update and delete refuse a row the caller does not own', () => {
    const b = body('update: approvedProviderProcedure', 'uploadImage: approvedProviderProcedure');
    expect(b).toContain('eq(portfolioItems.userId, ctx.user.id)');
    expect(b).toContain("code: 'NOT_FOUND'");
    expect(b).toContain('db.delete(portfolioItems)');
  });

  it('public listing is read-only showcase data, and now genuinely public', () => {
    /*
     * This required `protectedProcedure`, which was consistent while the
     * storefront itself needed a session. Once `/vendor/:id` became public,
     * keeping this protected rendered the Portfolio section EMPTY to a
     * signed-out buyer - a claim about the provider ("no work shown") rather
     * than about the reader.
     */
    expect(PORTFOLIO).toContain('list: publicProcedure');
    const b = body('list: publicProcedure', 'myItems: approvedProviderProcedure');
    expect(b).toContain('eq(portfolioItems.userId, input.userId)');
    // Still read-only: no write reaches the caller's rows from here.
    expect(b).not.toContain('db.insert');
    expect(b).not.toContain('db.update');
    expect(b).not.toContain('db.delete');
  });

  it('and it gained the visibility rule it never had', () => {
    /*
     * It took ANY userId and returned every row for it, with no check that the
     * account was a provider at all. That was loose behind a session and is the
     * storefront's own exposure in public, so it applies the same canonical
     * gate. NOT_FOUND rather than FORBIDDEN, so ids cannot be enumerated.
     */
    const b = body('list: publicProcedure', 'myItems: approvedProviderProcedure');
    expect(b).toContain('directoryVisibilityFilter()');
    expect(b).toContain("code: 'NOT_FOUND'");
    // Self and admin keep the access they already had.
    expect(b).toContain('viewerIsSelf');
    expect(b).toContain('viewerIsAdmin');
  });
});
