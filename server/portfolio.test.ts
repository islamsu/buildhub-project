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

  it('public listing is read-only showcase data', () => {
    expect(PORTFOLIO).toContain('list: protectedProcedure');
    const b = body('list: protectedProcedure', 'myItems: approvedProviderProcedure');
    expect(b).toContain('eq(portfolioItems.userId, input.userId)');
  });
});
