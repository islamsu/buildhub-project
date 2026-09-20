/**
 * ── THE ARITHMETIC BEHIND "TOTAL SPENT" ───────────────────────────────────
 *
 * The defect this file guards was not a wrong sum. It was a sum over the
 * wrong table: the dashboard totalled `projects.spent`, a column the product
 * has no way to fill, while the project page totalled the expense log. A
 * homeowner with EGP 2,000 of logged expenses was shown EGP 0.
 *
 * So the assertions here are about SOURCE as much as about addition:
 *
 *   a project with expenses reports their sum
 *   a project with none is ABSENT, not silently zero
 *   an empty request makes no query at all
 *   the shape handed to the client is the decimal string it already reads
 *
 * The rendered proof - two screens agreeing, a new expense moving both, and
 * a value written straight into the stored column failing to change either -
 * is evidence/zg-projectspend.mjs, which ran 3/8 before the fix.
 */
import { describe, expect, it, vi } from 'vitest';
import { spentByProject, spentFor } from './projectSpend';

/**
 * The narrowest database that can answer this question: it records what it
 * was asked and replies with rows. A real handle would prove nothing extra
 * here and would need a database to run.
 */
function fakeDb(rows: { projectId: number; total: string }[]) {
  const calls: { grouped: boolean }[] = [];
  const chain = {
    from: () => chain,
    where: () => chain,
    groupBy: () => { calls[calls.length - 1].grouped = true; return Promise.resolve(rows); },
  };
  return {
    calls,
    select: () => { calls.push({ grouped: false }); return chain; },
  } as never as Parameters<typeof spentByProject>[0] & { calls: typeof calls };
}

describe('spentByProject', () => {
  it('reports the summed expense log for each project', async () => {
    const db = fakeDb([
      { projectId: 1, total: '2000.00' },
      { projectId: 2, total: '500.50' },
    ]);
    const totals = await spentByProject(db, [1, 2]);
    expect(totals.get(1)).toBe(2000);
    expect(totals.get(2)).toBe(500.5);
  });

  it('leaves a project with no expenses OUT of the map', async () => {
    // Absent and zero are different facts, and the caller should be the one
    // deciding what to show for "nothing logged".
    const db = fakeDb([{ projectId: 1, total: '100.00' }]);
    const totals = await spentByProject(db, [1, 2]);
    expect(totals.has(2)).toBe(false);
  });

  it('asks the database ONCE for a whole list, not once per project', async () => {
    const db = fakeDb([{ projectId: 1, total: '1.00' }]);
    await spentByProject(db, [1, 2, 3, 4, 5]);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].grouped).toBe(true);
  });

  it('makes no query at all when there is nothing to ask about', async () => {
    const db = fakeDb([]);
    const totals = await spentByProject(db, []);
    expect(totals.size).toBe(0);
    expect(db.calls).toHaveLength(0);
  });
});

describe('spentFor', () => {
  it('hands back the decimal string shape the client already reads', () => {
    expect(spentFor(new Map([[1, 2000]]), 1)).toBe('2000.00');
    expect(spentFor(new Map([[1, 500.5]]), 1)).toBe('500.50');
  });

  it('says zero for a project with nothing logged', () => {
    expect(spentFor(new Map(), 9)).toBe('0.00');
  });
});

describe('the stored column is no longer a way in', () => {
  it('projects.update does not accept a spent field', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    // The input schema sat directly above the handler that destructured it;
    // both spellings are gone, so a caller sending `spent` is now rejected by
    // the schema rather than given `{ success: true }` for nothing.
    expect(source).not.toContain('spent: z.number().optional()');
    expect(source).not.toContain('spent: spent != null ? String(spent) : undefined');
  });

  it('the derived value is what list and get return', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    expect(source).toContain('spent: spentFor(totals, row.id)');
    expect(source).toContain('spent: spentFor(totals, project.id)');
  });
});
