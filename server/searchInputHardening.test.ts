// ── Search and filter inputs ───────────────────────────────────────────────
//
// PHASE 1B part 20: audit search, filter and autocomplete. Two things came out
// of walking every search surface, and neither is SQL injection - Drizzle binds
// `like(column, term)` as a parameter, so the input never reaches the parser.
//
//   1. LIKE WILDCARDS WERE NOT ESCAPED. `%` and `_` are wildcards inside a LIKE
//      pattern. A visitor searching the public catalogue for "%" did not search
//      for a percent sign, they matched every row; "50_" matched 500, 501 and
//      50m. Four call sites interpolated raw input into `%...%`.
//
//   2. marketplace.list WAS UNBOUNDED. `limit: z.number().default(24)` - no
//      int, no minimum, no maximum - on a PUBLIC, unauthenticated endpoint. So
//      `limit: 100000` returned the whole catalogue in one request, `limit: -1`
//      reached MySQL as a syntax error, and `limit: 1.5` did too. Its sibling
//      marketplace.vendors, written later, already had `.int().positive()
//      .max(100)`; this one was simply never brought up to it.
//
// Both are the kind of defect that hides behind a working feature: search
// works, the page renders, and nothing looks wrong until somebody types a
// percent sign or edits a request.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { containsTerm, MAX_SEARCH_LENGTH } from './_core/searchTerms';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const ROUTERS = read('./routers.ts');
const DIRECTORY = read('./vendorDirectory.ts');

describe('containsTerm neutralises the pattern language', () => {
  it('an ordinary search still matches by substring', () => {
    expect(containsTerm('cement')).toBe('%cement%');
  });

  it('a percent sign is a percent sign, not "everything"', () => {
    expect(containsTerm('%')).toBe('%\\%%');
  });

  it('an underscore is an underscore, not "any character"', () => {
    expect(containsTerm('50_')).toBe('%50\\_%');
  });

  it('a backslash is escaped FIRST, so a typed backslash is not a new escape', () => {
    // Order matters: escaping % before \ would turn a user's "\" plus our
    // escape into "\\%", which means a literal backslash followed by the
    // wildcard - the opposite of the intent.
    expect(containsTerm('\\')).toBe('%\\\\%');
    expect(containsTerm('\\%')).toBe('%\\\\\\%%');
  });

  it('Arabic input is untouched - only the three pattern characters change', () => {
    expect(containsTerm('أسمنت')).toBe('%أسمنت%');
  });

  it('an absurdly long search is truncated rather than run', () => {
    const long = 'a'.repeat(5000);
    expect(containsTerm(long).length).toBe(MAX_SEARCH_LENGTH + 2);
  });

  it('an empty search still produces a valid pattern', () => {
    expect(containsTerm('')).toBe('%%');
  });
});

describe('no search surface builds its own LIKE pattern', () => {
  /**
   * EVERY SERVER FILE, not two of them.
   *
   * This checked `routers.ts` and `vendorDirectory.ts` only - the two files
   * that had the defect when it was written. Search then moved into services:
   * `disputeAdminView.ts` and `referralRewardView.ts` were both added with
   * hand-built `%${term}%` patterns and this suite stayed green, because the
   * files it reads were a snapshot of where searching used to happen. A guard
   * that names its files goes stale the first time the code moves.
   */
  function serverSources(): Array<[string, string]> {
    const root = new URL('./', import.meta.url).pathname;
    const found: Array<[string, string]> = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!/\.ts$/.test(entry) || /\.test\.ts$/.test(entry)) continue;
        // The escaper itself is where the pattern is legitimately built.
        if (path.endsWith('_core/searchTerms.ts')) continue;
        found.push([path.slice(root.length), readFileSync(path, 'utf8')]);
      }
    };
    walk(root);
    return found;
  }

  it('the sweep actually reads the server, including its subdirectories', () => {
    const files = serverSources();
    expect(files.length).toBeGreaterThan(40);
    expect(files.map(([name]) => name)).toEqual(
      expect.arrayContaining(['routers.ts', 'vendorDirectory.ts', 'disputeAdminView.ts']),
    );
    expect(files.some(([name]) => name.includes('/'))).toBe(true);
  });

  it('REGRESSION: nothing interpolates raw input into a %...% string', () => {
    const offenders: string[] = [];
    for (const [name, source] of serverSources()) {
      for (const match of source.matchAll(/`%\$\{[^}]+\}%`/g)) offenders.push(`${name}: ${match[0]}`);
    }
    expect(
      offenders,
      'A LIKE pattern built by hand lets a user\'s own % or _ act as a wildcard. '
      + 'Use containsTerm() from server/_core/searchTerms.ts:\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });

  it('every like() call anywhere on the server takes an escaped term', () => {
    const offenders: string[] = [];
    for (const [name, source] of serverSources()) {
      for (const match of source.matchAll(/\blike\([^,]+,\s*([^)]+)\)/g)) {
        const argument = match[1].trim();
        // A bound variable is fine when it was produced by containsTerm; the
        // names below are the ones this codebase uses for exactly that.
        if (/containsTerm\(|^(term|pattern)$/.test(argument)) continue;
        offenders.push(`${name}: like(..., ${argument})`);
      }
    }
    expect(offenders, 'a LIKE argument that is not an escaped term:\n  ' + offenders.join('\n  ')).toEqual([]);
  });
});

describe('public list endpoints are bounded', () => {
  function inputBlock(procedure: string): string {
    const start = ROUTERS.indexOf(`\n  ${procedure}: publicProcedure`);
    expect(start, `${procedure} not found`).toBeGreaterThan(-1);
    const body = ROUTERS.slice(start, start + 1200);
    return body.slice(0, body.indexOf('.query('));
  }

  it('REGRESSION: marketplace.list caps its limit', () => {
    const block = inputBlock('list');
    expect(block).toContain('limit: z.number().int().positive().max(100)');
    expect(block).not.toMatch(/limit: z\.number\(\)\.default/);
  });

  it('marketplace.list caps its string filters', () => {
    const block = inputBlock('list');
    for (const field of ['category', 'search']) {
      expect(block, `${field} is unbounded`).toMatch(new RegExp(`${field}: z\\.string\\(\\)\\.max\\(`));
    }
  });

  it('marketplace.vendors caps its string filters too', () => {
    const block = inputBlock('vendors');
    for (const field of ['category', 'location', 'search']) {
      expect(block, `${field} is unbounded`).toMatch(new RegExp(`${field}: z\\.string\\(\\)\\.max\\(`));
    }
    expect(block).toContain('limit: z.number().int().positive().max(100)');
  });

  it('the directory ALSO clamps in code, not only in the schema', () => {
    // Defence in depth that predates this change and is worth keeping: the
    // schema is the boundary, the clamp is what protects a caller that reaches
    // listDirectoryVendors by some other route.
    expect(DIRECTORY).toContain('Math.min(Math.max(filters.limit ?? 48, 1), 100)');
  });

  it('EVERY z.number limit in the router surface is bounded', () => {
    // Not just the two named above: any `limit:` input anywhere must declare a
    // maximum, or it is a way to ask the database for everything.
    const unbounded = [...ROUTERS.matchAll(/limit: z\.number\(\)((?!\.max\()[^,\n])*[,\n]/g)].map(m => m[0].trim());
    expect(unbounded, 'a limit input with no maximum').toEqual([]);
  });
});
