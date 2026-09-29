/**
 * ── WHAT A PROJECT HAS ACTUALLY COST, FROM THE ONLY RECORD OF IT ─────────
 *
 * There were two answers to one question. The project page summed the EXPENSE
 * LOG - the rows a homeowner enters, each with an amount, a date and often a
 * receipt. The dashboard summed `projects.spent`, a stored column that NO
 * SCREEN IN THE PRODUCT EVER WRITES. It is settable only through an optional
 * field on projects.update that nothing sends.
 *
 * So the column was always its default, and a homeowner who had logged real
 * expenses was told, on the first screen they land on, that they had spent
 * nothing. Proven in a browser before this file existed: the project page
 * read EGP 2,000 and the dashboard beside it read EGP 0.
 *
 * WHICH ONE IS TRUE IS NOT A MATTER OF TASTE HERE. One of them is a record of
 * entries a person made; the other is a column the product has never had a
 * way to fill. The expense log is the only source that can be right, so every
 * screen now reads it, through this one function.
 *
 * THE STORED COLUMN IS LEFT ALONE, NOT DROPPED. Whether a project should also
 * accept a manually stated total - for work invoiced in a lump, or a figure
 * carried over from before the project was on BuildHub - is the owner's call,
 * and it needs a visible marker saying the number was typed rather than
 * totalled. Dropping the column would quietly foreclose that. It is simply no
 * longer READ, so a value left in it from before cannot appear as somebody's
 * spend.
 *
 * ONE QUERY, NOT ONE PER PROJECT. The dashboard asks about every project a
 * person can see, so this groups rather than looping - a list of thirty
 * projects is one aggregate, not thirty round trips.
 */
import { inArray, sql } from 'drizzle-orm';
import { expenses } from '../drizzle/schema';
import type { requireDb } from './_core/requireDb';

/** The connected database handle, as requireDb() hands it over. */
type Db = Awaited<ReturnType<typeof requireDb>>;

/**
 * The total logged against each of `projectIds`.
 *
 * A project with no expenses is ABSENT from the map rather than present with
 * a zero, so a caller has to decide what "nothing logged" means for its own
 * screen instead of inheriting a number it did not ask for. `spentFor` below
 * makes that decision once for the shape the client expects.
 */
export async function spentByProject(
  db: Db, projectIds: readonly number[],
): Promise<Map<number, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({
      projectId: expenses.projectId,
      // COALESCE because SUM over an empty group is NULL, and a NULL that
      // reaches Number() becomes 0 silently rather than loudly.
      total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)`,
    })
    .from(expenses)
    .where(inArray(expenses.projectId, [...projectIds]))
    .groupBy(expenses.projectId);
  return new Map(rows.map(row => [Number(row.projectId), Number(row.total)]));
}

/**
 * The same shape the client already reads - a decimal string, as the column
 * returned - so no screen has to learn a new type to stop being wrong.
 */
export function spentFor(totals: Map<number, number>, projectId: number): string {
  return (totals.get(projectId) ?? 0).toFixed(2);
}
