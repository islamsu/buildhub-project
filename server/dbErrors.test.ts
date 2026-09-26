/**
 * ── THE GUARD THAT LOOKED ALIVE AND WAS NOT ─────────────────────────────
 *
 * Two places caught a unique-index violation to turn it into a sensible
 * answer - a buyer double-tapping Save, and two simultaneous sign-ups for one
 * email. Both read `error.code` and `error.message`, and neither ever matched,
 * because drizzle throws its own error:
 *
 *   Error: Failed query: insert into `savedItems` (...) values (...)
 *
 * with MySQL's ER_DUP_ENTRY on `.cause`. So the buyer got HTTP 500 while their
 * shortlist was correct, and the sign-up path's "That username or email was
 * just taken" was unreachable in the race it was written for.
 *
 * The shapes below are the REAL ones, copied from what the driver produced.
 */
import { describe, expect, it } from 'vitest';
import { isDuplicateKeyError } from './_core/dbErrors';

/** What drizzle actually threw, measured, with mysql2's error on the cause. */
function drizzleWrapped() {
  const mysqlError = Object.assign(
    new Error("Duplicate entry '1058-product-88' for key 'savedItems_user_item_unique'"),
    { code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000' },
  );
  return Object.assign(
    new Error('Failed query: insert into `savedItems` (`id`, `userId`, `itemKind`, `itemId`) values (default, ?, ?, ?)'),
    { cause: mysqlError },
  );
}

describe('recognising a duplicate key', () => {
  it('sees through drizzle\'s wrapper to the driver error - the case that was broken', () => {
    const error = drizzleWrapped();
    // The proof that this is the case that mattered: the wrapper itself says
    // nothing about a duplicate, so a message test on it alone cannot pass.
    expect(/duplicate/i.test(error.message)).toBe(false);
    expect((error as { code?: string }).code).toBeUndefined();
    expect(isDuplicateKeyError(error)).toBe(true);
  });

  it('recognises the driver error on its own', () => {
    expect(isDuplicateKeyError(Object.assign(new Error('x'), { code: 'ER_DUP_ENTRY' }))).toBe(true);
    expect(isDuplicateKeyError(Object.assign(new Error('x'), { errno: 1062 }))).toBe(true);
  });

  it('falls back to the message, because mysql2 does not always set the code', () => {
    expect(isDuplicateKeyError(new Error("Duplicate entry 'a' for key 'b'"))).toBe(true);
    expect(isDuplicateKeyError(new Error('DUPLICATE ENTRY for key'))).toBe(true);
  });

  it('follows more than one level of wrapping', () => {
    const inner = Object.assign(new Error('mysql'), { code: 'ER_DUP_ENTRY' });
    const middle = Object.assign(new Error('drizzle'), { cause: inner });
    const outer = Object.assign(new Error('service'), { cause: middle });
    expect(isDuplicateKeyError(outer)).toBe(true);
  });

  it('is FALSE for every other database error, so a real fault is not swallowed', () => {
    for (const error of [
      Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 }),
      Object.assign(new Error('fk'), { code: 'ER_NO_REFERENCED_ROW_2', errno: 1452 }),
      Object.assign(new Error('Unknown column `x` in field list'), { code: 'ER_BAD_FIELD_ERROR' }),
      Object.assign(new Error('Failed query: insert into `x`'), {
        cause: Object.assign(new Error('Data too long for column'), { code: 'ER_DATA_TOO_LONG', errno: 1406 }),
      }),
      new Error('connect ECONNREFUSED'),
    ]) {
      expect(isDuplicateKeyError(error), String((error as { code?: string }).code ?? error.message)).toBe(false);
    }
  });

  it('is FALSE for nothing at all, rather than throwing', () => {
    for (const value of [null, undefined, 0, '', 'ER_DUP_ENTRY']) {
      expect(isDuplicateKeyError(value)).toBe(false);
    }
  });

  it('terminates on a cause cycle', () => {
    // A self-referencing cause is pathological rather than expected; what
    // matters is that the walk is bounded and does not hang a request.
    const error: { message: string; cause?: unknown } = { message: 'loop' };
    error.cause = error;
    expect(isDuplicateKeyError(error)).toBe(false);
  });
});

describe('the two callers use it', () => {
  it('the shortlist save answers with the state, not a 500', async () => {
    const source = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('./savedItems.ts', import.meta.url), 'utf8'));
    expect(source).toContain('isDuplicateKeyError(error)');
    // And the answer is the state the race produced, re-counted rather than
    // assumed from a number read before the other call committed.
    expect(source).toContain('saved: true, total: await countSaved(db, params.userId)');
  });

  it('sign-up answers CONFLICT, not a 500', async () => {
    const source = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));
    expect(source).toContain('isDuplicateKeyError(error)');
    expect(source).not.toMatch(/\/duplicate\|ER_DUP_ENTRY\/i\.test\(error\.message\)/);
  });
});
