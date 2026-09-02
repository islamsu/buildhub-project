/**
 * MIGRATIONS THAT CANNOT RUN ARE NOT MIGRATIONS.
 *
 * Four consecutive migrations - referrals, referral campaigns, the commercial
 * placement columns and product placement - shipped without the statement
 * delimiter drizzle-kit splits on. drizzle hands a file to the driver as ONE
 * query when it finds no delimiter, and MySQL/MariaDB refuse a multi-statement
 * query, so the first of them failed on its second statement and the runner
 * stopped there. Everything after it was unreachable too.
 *
 * Nothing caught it, because every other kind of test mocks the driver. The
 * schema in drizzle/schema.ts described columns that existed in TypeScript and
 * in no database anywhere, and the features built on them typechecked, passed
 * their unit tests, and could not have worked against a real server.
 *
 * This is the cheap, permanent check: any migration with more than one
 * statement must carry the delimiter between them.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
const BREAKPOINT = ['-->', 'statement-breakpoint'].join(' ');

/** Statement-terminating semicolons, ignoring `--` comment lines. */
function countStatements(sql: string): number {
  return sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .length;
}

const files = readdirSync(DRIZZLE_DIR).filter(name => name.endsWith('.sql')).sort();

describe('every migration can actually be applied', () => {
  it('finds the migration files at all', () => {
    // A sweep over an empty list passes vacuously and proves nothing.
    expect(files.length).toBeGreaterThan(20);
  });

  it('a multi-statement migration separates its statements with the delimiter', () => {
    const offenders: string[] = [];
    for (const name of files) {
      const sql = readFileSync(join(DRIZZLE_DIR, name), 'utf8');
      const statements = countStatements(sql);
      const breakpoints = sql.split(BREAKPOINT).length - 1;
      // N statements need N-1 delimiters. More is harmless; fewer means the
      // driver receives two statements in one query and rejects the file.
      if (statements > 1 && breakpoints < statements - 1) {
        offenders.push(`${name}: ${statements} statements, ${breakpoints} delimiters`);
      }
    }
    expect(offenders, 'these migrations would be sent to the driver as one multi-statement query and refused').toEqual([]);
  });

  it('the journal lists exactly the migration files on disk', () => {
    // A file with no journal entry never runs; a journal entry with no file
    // aborts the runner. Both have happened in this repository.
    const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'));
    const tags: string[] = journal.entries.map((entry: { tag: string }) => entry.tag).sort();
    const onDisk = files.map(name => name.replace(/\.sql$/, '')).sort();
    expect(tags).toEqual(onDisk);
  });
});
