/**
 * STRIPPING COMMENTS OUT OF SOURCE, WITHOUT EATING THE SOURCE.
 *
 * Twelve test files in this repository read a file and remove its comments
 * before asserting on it - a good habit, because this codebase explains its
 * own defects at length and an assertion that matched its own prose would pass
 * on a file that described a fix without applying it.
 *
 * Every one of them did it with `replace(/\/\*[\s\S]*?\*\//g, '')`.
 *
 * THAT IS WRONG IN AN UPLOAD-HEAVY APPLICATION. `accept="image/*,application/pdf"`
 * contains `/*`. The regex treats it as the start of a comment and runs to the
 * next `*​/` anywhere in the file - in RFQPage.tsx that swallowed 6,045
 * characters including the submit button.
 *
 * The danger is not the assertions that then fail loudly. It is
 * `expect(source).not.toContain(...)` - which PASSES, vacuously, on text that
 * was deleted before it was examined. A guardian asserting that something bad
 * is absent cannot tell "absent" from "never looked at".
 *
 * This scanner tracks string and template literals, so `/*` inside a quoted
 * attribute is left alone. Correctness comes from that, not from the size
 * check below: this codebase is deliberately comment-dense - commercialAudit.ts
 * is 58.8% documentation and opportunity.ts is 42% - so a tight proportional
 * bound produces false alarms on exactly the files that explain themselves
 * best. The bound is kept only to catch catastrophic breakage; the guarantee
 * is in sourceText.test.ts.
 */

export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (quote) {
      out += c;
      if (c === '\\') { out += source[i + 1] ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i += 1; continue; }

    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }

    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      continue;
    }

    out += c;
    i += 1;
  }
  return out;
}

/**
 * The form the JSX-reading tests want: comments gone, `{}` left behind by a
 * `{/* … *​/}` wrapper cleaned up, and a sanity bound on how much vanished.
 */
export function readSourceForAssertions(source: string, maxRemovedFraction = 0.9): string {
  const stripped = stripComments(source).replace(/\{\s*\}/g, '');
  const removed = (source.length - stripped.length) / Math.max(source.length, 1);
  if (removed > maxRemovedFraction) {
    throw new Error(
      `stripComments removed ${(removed * 100).toFixed(1)}% of the source - that is `
      + `catastrophic rather than merely surprising, and every assertion below it `
      + `would be unreliable.`,
    );
  }
  return stripped;
}
