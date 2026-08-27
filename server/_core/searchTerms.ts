/**
 * Turning user input into a LIKE pattern, safely.
 *
 * Drizzle binds `like(column, term)` as a parameter, so there is no SQL
 * injection here and never was. What there IS, is a smaller and much more
 * likely problem: `%` and `_` are WILDCARDS inside a LIKE pattern, and user
 * input was being interpolated into one unescaped.
 *
 * A visitor searching the catalogue for "%" therefore did not search for a
 * percent sign - they matched every row. On a public, unauthenticated endpoint
 * that also accepted an unbounded `limit`, that was a one-request full-table
 * scan of the whole catalogue. "50_" matched "500", "501" and "50m".
 *
 * MySQL and MariaDB take `\` as the default LIKE escape character, so escaping
 * the three characters below is enough and needs no explicit ESCAPE clause.
 * (This assumes sql_mode does not include NO_BACKSLASH_ESCAPES, which is the
 * default and which BuildHub does not set.)
 */

/** Longest search string worth accepting. Anything past this is not a search. */
export const MAX_SEARCH_LENGTH = 120;

/**
 * `%term%` with the user's own wildcards neutralised.
 *
 * The backslash has to be escaped FIRST, or escaping `%` afterwards would
 * double-escape a backslash the user typed.
 */
export function containsTerm(raw: string): string {
  const escaped = raw
    .slice(0, MAX_SEARCH_LENGTH)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
  return `%${escaped}%`;
}
