/**
 * ── RECOGNISING A DUPLICATE KEY, WHICH IS HARDER THAN IT LOOKS ──────────
 *
 * A unique index is the only thing that actually prevents a double write, and
 * two places in this product relied on catching its error: a concurrent save to
 * a buyer's shortlist, and two simultaneous sign-ups for the same email. Both
 * checks read `error.code` and `error.message`, and BOTH FAILED - because
 * drizzle does not throw MySQL's error. It throws its own:
 *
 *   Error: Failed query: insert into `savedItems` (...) values (...)
 *   params: 1058,product,88
 *
 * No `code`. No `errno`. A message that says nothing about a duplicate. The
 * real error - `ER_DUP_ENTRY`, errno 1062 - is on `.cause`.
 *
 * So the guards were dead code that looked alive. A buyer double-tapping Save
 * got "Something went wrong. Please try again." with HTTP 500 while their
 * shortlist was perfectly correct, and the sign-up path's carefully worded
 * "That username or email was just taken" was unreachable in the race it was
 * written for. Measured with two concurrent requests
 * (evidence/zg-reliability.mjs).
 *
 * ── SO THIS WALKS THE CHAIN ─────────────────────────────────────────────
 *
 * `cause` is followed to a small depth, and each link is checked by ERROR CODE
 * first - `ER_DUP_ENTRY` / 1062, which the driver sets and no user input can
 * influence. The message is a fallback for the same reason it was there
 * before: mysql2 surfaces errors differently depending on the call path, and a
 * check that silently stopped matching is what this file exists to fix.
 */

/** How far down `cause` to look. Drizzle wraps once; two is slack, not a guess. */
const MAX_CAUSE_DEPTH = 4;

export function isDuplicateKeyError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current; depth += 1) {
    const candidate = current as { code?: unknown; errno?: unknown; message?: unknown; cause?: unknown };
    if (candidate.code === 'ER_DUP_ENTRY') return true;
    if (candidate.errno === 1062) return true;
    if (typeof candidate.message === 'string' && /duplicate entry/i.test(candidate.message)) return true;
    current = candidate.cause;
  }
  return false;
}
