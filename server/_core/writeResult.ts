/**
 * ── HOW MANY ROWS DID THAT WRITE ACTUALLY TOUCH? ──────────────────────────
 *
 * mysql2 answers an UPDATE or a DELETE with `[ResultSetHeader, FieldPacket[]]`,
 * so the number lives at `result[0].affectedRows`. Drizzle passes that array
 * straight through. There is no `rowsAffected` anywhere in it.
 *
 * BuildHub had THREE different spellings of this read, and the drift cost a
 * real defect: `projects.removeMember` reported
 *
 *     { success: true, removed: false }
 *
 * for a removal that had genuinely happened - `removedAt` was set in the
 * database - because it read `result.rowsAffected`, which is always undefined.
 * The `removed` flag existed precisely so a caller could tell "I took somebody
 * off the project" from "that person was not on it", and it could not: both
 * answered false. Proven against the running product, not inferred.
 *
 * One reader, defensive about the shape rather than about the spelling: the
 * array form, the bare header, and a driver that returns neither all resolve
 * to a number, and an unrecognised shape is 0 rather than NaN - because
 * `NaN > 0` is false and would silently read as "nothing happened" at every
 * call site.
 */
export function affectedRows(result: unknown): number {
  if (result == null) return 0;
  const header = Array.isArray(result) ? result[0] : result;
  if (header == null || typeof header !== 'object') return 0;
  const value = (header as { affectedRows?: unknown; rowsAffected?: unknown }).affectedRows
    // `rowsAffected` is not mysql2's spelling, but it IS some drivers' - kept
    // as a fallback so this helper is about the question, not about one driver.
    ?? (header as { rowsAffected?: unknown }).rowsAffected;
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

/** Did the write change anything at all? The question most call sites are asking. */
export function changedSomething(result: unknown): boolean {
  return affectedRows(result) > 0;
}
