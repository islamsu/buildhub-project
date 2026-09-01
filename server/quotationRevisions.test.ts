import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

/**
 * ONE CURRENT QUOTATION PER SUPPLIER PER RFQ, WITH REVISION HISTORY.
 *
 * The owner's preferred model: a later bid supersedes the previous version
 * (immutable history) instead of accumulating unrelated quotations.
 */

const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));
const SCHEMA = readSourceForAssertions(readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8'));
const MIGRATION = readFileSync(new URL('../drizzle/0033_quotation_revisions.sql', import.meta.url), 'utf8');

function submitBlock(): string {
  const start = ROUTERS.indexOf('submitQuotation: approvedProviderProcedure');
  const end = ROUTERS.indexOf('withdrawRFQ:', start);
  return ROUTERS.slice(start, end === -1 ? undefined : end);
}

describe('quotation revision model', () => {
  it('the migration adds revisionNumber and supersededAt without rewriting data', () => {
    expect(MIGRATION).toContain("ADD `revisionNumber` int NOT NULL DEFAULT 1");
    expect(MIGRATION).toContain("ADD `supersededAt` timestamp NULL");
    expect(MIGRATION).not.toMatch(/DROP|DELETE|TRUNCATE/i);
  });

  it('a later submission supersedes the current version and increments the revision', () => {
    const b = submitBlock();
    expect(b).toContain('isNull(quotations.supersededAt)');
    expect(b).toContain('set({ supersededAt: new Date() })');
    expect(b).toContain('revisionNumber: current ? current.revisionNumber + 1 : 1');
  });

  it('the supplier and requester lists expose only the current version', () => {
    expect(ROUTERS).toMatch(/where\(and\(eq\(quotations\.providerId, ctx\.user\.id\), isNull\(quotations\.supersededAt\)\)\)/);
    expect(ROUTERS).toMatch(/where\(and\(eq\(quotations\.rfqId, input\.rfqId\), isNull\(quotations\.supersededAt\)\)\)/);
  });

  it('the schema carries revisionNumber and supersededAt', () => {
    expect(SCHEMA).toContain("revisionNumber: int('revisionNumber').notNull().default(1)");
    expect(SCHEMA).toContain("supersededAt: timestamp('supersededAt')");
  });
});
