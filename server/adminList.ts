/**
 * ONE PAGED LIST, FOR EVERY ADMINISTRATION SCREEN.
 *
 * `admin.users` truncated at 250 with no count (fixed in P0-3). `admin.disputes`
 * returned every row ever filed (fixed in DSP-6). And four more were still doing
 * the first of those: `products`, `projects`, `placements` and
 * `vendorNameChanges` each read `.limit(250)`, each returned a bare array, and
 * each had a client that FILTERED THE RESULT IN THE BROWSER.
 *
 * That combination is worse than either half. A search over a truncated set
 * does not fail - it answers "no matching products" when the match is on row
 * 251, with exactly the same confidence it answers correctly. An administrator
 * has no way to tell the two apart, and the number that would have told them -
 * the real total - was never sent.
 *
 * THE INVARIANT THIS EXISTS TO MAKE UNBREAKABLE: the count and the rows are
 * filtered identically. A total taken over different conditions than the page
 * disagrees with it the moment a filter touches a joined column, and "Page 1 of
 * 4" over one page of results is a worse lie than no pager at all. Here the
 * caller supplies the `where` ONCE and it is applied to both, so forgetting is
 * not a thing a caller can do.
 */
import { sql } from 'drizzle-orm';

/** What every administration list accepts. Bounded so a caller cannot ask for everything. */
export const ADMIN_PAGE_SIZE_MAX = 100;
export const ADMIN_PAGE_SIZE_DEFAULT = 25;

export type AdminPage<T> = {
  rows: T[];
  /** The real number of matching rows, not the number returned. */
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Run one page and its matching count.
 *
 * `countQuery` and `rowsQuery` must already carry the same table and the same
 * joins - only the projection differs. The `where`, the ordering and the bounds
 * are applied here, which is the part that was getting out of step.
 */
export async function adminPage<T>(params: {
  countQuery: any;
  rowsQuery: any;
  where?: unknown;
  orderBy: unknown[];
  page: number;
  pageSize: number;
}): Promise<AdminPage<T>> {
  const { countQuery, rowsQuery, where, orderBy } = params;
  const page = Math.max(0, Math.trunc(params.page));
  const pageSize = Math.min(ADMIN_PAGE_SIZE_MAX, Math.max(1, Math.trunc(params.pageSize)));

  const [totalRow] = where ? await countQuery.where(where) : await countQuery;
  const rows = await (where ? rowsQuery.where(where) : rowsQuery)
    .orderBy(...(orderBy as any[]))
    .limit(pageSize)
    .offset(page * pageSize);

  return { rows: rows as T[], total: Number(totalRow?.count ?? 0), page, pageSize };
}

/** The count projection every caller passes, so the shape cannot drift. */
export const COUNT = { count: sql<number>`count(*)` };

/**
 * Combine filters, or nothing at all.
 *
 * An empty filter list must produce `undefined` rather than `and()` - drizzle
 * renders a bare `and()` as SQL that matches nothing, so an unfiltered list
 * would come back empty and read as "there is nothing here".
 */
export function allOf(and: (...parts: any[]) => unknown, filters: unknown[]): unknown {
  const present = filters.filter(Boolean);
  return present.length > 0 ? and(...(present as any[])) : undefined;
}

/**
 * A FILTER VALUE THE COLUMN CAN ACTUALLY HOLD, read from the column itself.
 *
 * An enum compared against a value outside its set matches nothing, and "no
 * results" is indistinguishable from "no matches" - the screen says the list is
 * empty and is believed. Dropping the filter instead shows everything, which is
 * visibly wrong rather than quietly wrong.
 *
 * The allowed set comes from `enumValues` ON THE DRIZZLE COLUMN, not from a
 * list restated here. Restating it is how the two drift: the first version of
 * this milestone hand-wrote a three-value list for a column that has five, and
 * two perfectly valid statuses would have been silently unfilterable.
 */
export function enumFilter<T>(
  column: { enumValues?: readonly string[] },
  value: string | undefined,
  eq: (col: unknown, v: never) => T,
): T | null {
  if (!value || value === 'all') return null;
  const allowed = column.enumValues ?? [];
  return allowed.includes(value) ? eq(column, value as never) : null;
}
