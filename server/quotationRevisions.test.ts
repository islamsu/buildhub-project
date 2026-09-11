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

/**
 * ── WHAT A REVISION CHANGED ───────────────────────────────────────────────
 *
 * The revision MODEL was built some time ago: a later bid supersedes the
 * previous version, the older row stays, and the readers filter on
 * `supersededAt IS NULL`. What was never finished is the half the owner's
 * backlog asks for by name - the CHANGE audit.
 *
 * Every field was recorded with `oldValue: null`, including on revision 4, so
 * the trail said "price was nothing, now 145,000" where the truth was "was
 * 125,000, now 145,000". That is the single question a revised bid raises -
 * what moved, and by how much - and it was the one question the trail could
 * not answer.
 */
describe('a revision records what it changed, not a change from nothing', () => {
  const SUBMIT = submitBlock();
  /**
   * THE RAW SOURCE, COMMENTS INTACT.
   *
   * `readSourceForAssertions` strips comments - which is right for every other
   * assertion in this file and exactly wrong for one about a COMMENT. The
   * stale-marker test below passed vacuously against the stripped text: the
   * marker was not there because no comment was.
   */
  const RAW = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');

  it('the superseded row is loaded WHOLE, not just its id and version', () => {
    // A field-change trail cannot contrast against an id. This is the change
    // that made the rest possible.
    const load = SUBMIT.slice(SUBMIT.indexOf('const [current] = await tx'));
    expect(load.slice(0, 200)).toContain('.select()');
    expect(load.slice(0, 200)).not.toContain('revisionNumber: quotations.revisionNumber }');
  });

  it('and carried out of the transaction, so the trail can name what moved', () => {
    expect(SUBMIT).toContain('previous: current ?? null');
  });

  it('EVERY audited field contrasts against the previous version', () => {
    // Not one or two of them: a trail that reports the price honestly and the
    // timeline as "from nothing" is harder to read than one that is uniformly
    // wrong, because only one of its rows is a lie.
    const changes = SUBMIT.slice(SUBMIT.indexOf('await recordFieldChanges(db, {'));
    const fields = [...changes.matchAll(/\{ field: '(\w+)', oldValue: ([^,]+),/g)];
    expect(fields.length).toBeGreaterThanOrEqual(7);
    for (const [, field, oldValue] of fields) {
      expect(oldValue.trim(), `${field} still reports a change from nothing`).not.toBe('null');
    }
  });

  it('a FIRST bid still contrasts against null, because nothing came before it', () => {
    expect(SUBMIT).toContain('previous ? previous[field] ?? null : null');
  });

  it('the price is compared as a NUMBER, so "125000.00" is not a change', () => {
    // The column is a decimal string and the input is a number. Compared raw,
    // every revision would report a price change whether or not one happened.
    const changes = SUBMIT.slice(SUBMIT.indexOf('await recordFieldChanges(db, {'));
    expect(changes).toContain('Number(previous.price)');
  });

  it('the reason names the revision, so the trail reads without arithmetic', () => {
    expect(SUBMIT).toContain('quotation revised to revision');
  });

  it('THE STALE MARKER IS GONE. It outlived the decision by several changes', () => {
    // A comment saying "not decided" sends the next reader off to decide
    // something that was decided and built. That is a defect in its own right.
    //
    // Asserted against RAW, not ROUTERS: the stripped source contains no
    // comments at all, so this passed while the marker was still in the file.
    expect(RAW).not.toContain('KNOWN GAP, deliberately not decided here');
    // A UNIQUE sentence. The first version asserted on 'ONE CURRENT QUOTATION
    // PER SUPPLIER PER RFQ', which appears in a SECOND comment further down the
    // same procedure - so deleting the replacement entirely still passed, the
    // other occurrence standing in for it.
    expect(RAW).toContain('THE REVISION MODEL, SETTLED');
    expect([...RAW.matchAll(/THE REVISION MODEL, SETTLED/g)]).toHaveLength(1);
  });

  it('a de-duplicated resubmission still records NOTHING', () => {
    // The same offer sent twice is not a revision, and must not appear in the
    // trail as one. The early return is what keeps that true.
    expect(SUBMIT).toContain('if (submission.deduplicated) return');
    const dedupe = SUBMIT.indexOf('if (submission.deduplicated) return');
    expect(dedupe).toBeLessThan(SUBMIT.indexOf('await recordFieldChanges(db, {'));
  });
});

/**
 * ── A DUPLICATE IS THE SAME OFFER, NOT THE SAME PRICE ─────────────────────
 *
 * The de-duplication matched on `price` alone, while the comment two lines
 * above it described "the same price and the same timeline". The code did not
 * do what its own comment said, and the consequence was commercial:
 *
 *   A supplier submits 145,000 over 45 days, notices the timeline is wrong and
 *   immediately resubmits 145,000 over 60 days. BuildHub returns `success:
 *   true` and hands back the FIRST quotation. The corrected timeline is
 *   discarded and the customer never sees it.
 *
 * Correcting a mistake is the likeliest reason to resubmit within seconds,
 * which is exactly the window the old rule swallowed it in.
 */
describe('de-duplication compares the whole offer', () => {
  const SUBMIT = submitBlock();

  it('EVERY commercial term is compared, not just the price', () => {
    const dedupe = SUBMIT.slice(SUBMIT.indexOf('const sameOffer ='), SUBMIT.indexOf('if (sameOffer)'));
    for (const field of ['price', 'currency', 'timeline', 'warranty', 'commercialTerms', 'paymentTerms', 'notes', 'validUntil', 'attachments']) {
      expect(dedupe, `${field} is not part of the duplicate test`).toContain(field);
    }
  });

  it('the SQL no longer narrows on price, so a changed offer reaches the comparison', () => {
    // The old predicate could not see a resubmission at the same price at all.
    const lookup = SUBMIT.slice(SUBMIT.indexOf('const [recent] = await tx'), SUBMIT.indexOf('const sameOffer ='));
    expect(lookup).not.toContain('eq(quotations.price');
  });

  it('the CURRENCY is compared against its column default', () => {
    // The column defaults to EGP, so a bid sent without one reads back as
    // 'EGP' and never equalled its own input - which made every such
    // resubmission look like a revision.
    expect(SUBMIT).toContain("(input.currency ?? 'EGP')");
  });

  it('and validUntil TO THE SECOND, because MySQL has no milliseconds', () => {
    // Compared raw, the value read back is never identical to the ISO string
    // that produced it, so every offer differed from itself.
    expect(SUBMIT).toContain('seconds(recent.validUntil) === seconds(input.validUntil)');
    expect(SUBMIT).toContain('Math.floor(value.getTime() / 1000)');
  });

  it('the comparison is in JS, so a NULL on both sides means EQUAL', () => {
    // SQL `=` makes the whole comparison null instead, which is why five of
    // these terms could not simply be added to the WHERE clause.
    expect(SUBMIT).toContain('?? null) === (');
  });

  it('and the doc comment now describes what the code does', () => {
    const RAW = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    expect(RAW).not.toContain('the same price\n       * and the same timeline within seconds');
    expect(RAW).toContain('the SAME\n       * OFFER within seconds');
  });
});
