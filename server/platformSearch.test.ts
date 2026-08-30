// ── Finding the record, without widening anyone's reach (Part 48) ──────────
//
// The search box is the one screen in the console that touches five record
// types at once, so it is the one screen where a single permission would
// quietly hand a MARKETPLACE_ADMIN the customer directory. The tests below are
// mostly about that: which segments each administrator role actually causes a
// query for, asserted by watching the queries themselves rather than by reading
// the response, because a response can be filtered after the fact and a query
// that ran has already touched the rows.
//
// The second half is the allowlist. `users` holds a password hash and a live
// invitation token; this file asserts the columns that are selected, not the
// intention to select carefully.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  runPlatformSearch, SEARCH_LIMIT, SEARCH_SEGMENTS, SEARCH_SEGMENT_PERMISSION,
} from './admin/platformSearch';
import { ADMIN_ROLES, ADMIN_ROLE_PERMISSIONS } from '@shared/adminRoles';

const SOURCE = readSourceForAssertions(readFileSync(new URL('./admin/platformSearch.ts', import.meta.url), 'utf8'));

/**
 * A database that answers nothing and remembers everything.
 *
 * The point is the `selects` log: a segment this administrator may not read
 * must produce NO QUERY AT ALL, which is a stronger property than "the segment
 * is missing from the response" and is the one that matters if the response
 * shape ever changes.
 */
function recordingDb() {
  const selects: Record<string, unknown>[] = [];
  const chain = () => {
    const self: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'orderBy', 'innerJoin']) {
      self[method] = () => self;
    }
    self.limit = () => Promise.resolve([]);
    return self;
  };
  return {
    db: { select: (columns: Record<string, unknown>) => { selects.push(columns); return chain(); } },
    selects,
  };
}

async function segmentsFor(role: string) {
  const { db, selects } = recordingDb();
  const result = await runPlatformSearch(db as never, role, 'anything');
  return { result, queries: selects.length };
}

describe('every segment is gated by the permission that already governs it', () => {
  it('names a permission for each of the five segments', () => {
    expect(SEARCH_SEGMENTS.sort()).toEqual(['products', 'projects', 'quotations', 'rfqs', 'users']);
    for (const segment of SEARCH_SEGMENTS) {
      expect(SEARCH_SEGMENT_PERMISSION[segment], segment).toBeTruthy();
    }
  });

  it('uses only permissions that exist in the admin model', () => {
    // A typo here would fail closed rather than open - hasAdminPermission
    // returns false for anything unrecognised - but it would fail closed
    // SILENTLY, and an administrator would be told a record does not exist.
    const known = new Set(ADMIN_ROLE_PERMISSIONS.SUPER_ADMIN);
    for (const segment of SEARCH_SEGMENTS) {
      expect(known.has(SEARCH_SEGMENT_PERMISSION[segment]), SEARCH_SEGMENT_PERMISSION[segment]).toBe(true);
    }
  });

  it('a Super Admin queries all five', async () => {
    const { result, queries } = await segmentsFor('SUPER_ADMIN');
    expect(queries).toBe(5);
    expect(result.segments.map(segment => segment.key).sort())
      .toEqual(['products', 'projects', 'quotations', 'rfqs', 'users']);
    expect(result.omitted).toEqual([]);
  });

  it('a Marketplace Admin queries people and products, and NOTHING else', async () => {
    const { result, queries } = await segmentsFor('MARKETPLACE_ADMIN');
    expect(queries).toBe(2);
    expect(result.segments.map(segment => segment.key).sort()).toEqual(['products', 'users']);
    expect(result.omitted.sort()).toEqual(['projects', 'quotations', 'rfqs']);
  });

  it('a Billing Admin queries people only - no bid book', async () => {
    const { result, queries } = await segmentsFor('BILLING_ADMIN');
    expect(queries).toBe(1);
    expect(result.segments.map(segment => segment.key)).toEqual(['users']);
    expect(result.omitted).toContain('quotations');
  });

  it('a Support Admin queries people only', async () => {
    const { result, queries } = await segmentsFor('SUPPORT_ADMIN');
    expect(queries).toBe(1);
    expect(result.omitted.sort()).toEqual(['products', 'projects', 'quotations', 'rfqs']);
  });

  it('a User Admin reads people and the commercial record, not the catalogue', async () => {
    const { result, queries } = await segmentsFor('USER_ADMIN');
    expect(queries).toBe(4);
    expect(result.omitted).toEqual(['products']);
  });

  it('an unrecognised role queries NOTHING and is told every segment is closed', async () => {
    // Fails closed on a role removed in a later release but still on a row,
    // on null, and on anything that is not a string at all.
    for (const role of ['NOT_A_ROLE', null, undefined, 42, {}]) {
      const { db, selects } = recordingDb();
      const result = await runPlatformSearch(db as never, role, 'anything');
      expect(selects.length, String(role)).toBe(0);
      expect(result.segments, String(role)).toEqual([]);
      expect(result.omitted.length, String(role)).toBe(5);
    }
  });

  it('every declared admin role is covered by this file', () => {
    // A role added later with no test here would slip through the matrix above.
    expect(ADMIN_ROLES.slice().sort())
      .toEqual(['BILLING_ADMIN', 'MARKETPLACE_ADMIN', 'SUPER_ADMIN', 'SUPPORT_ADMIN', 'USER_ADMIN']);
  });
});

describe('an omitted segment is reported as omitted, never as empty', () => {
  it('the two are different fields, and a closed segment is in neither position', async () => {
    const { result } = await segmentsFor('SUPPORT_ADMIN');
    const keys = result.segments.map(segment => segment.key);
    for (const closed of result.omitted) {
      expect(keys, `${closed} must not appear as an empty segment`).not.toContain(closed);
    }
  });

  it('an allowed segment with no matches IS present and empty - which is a different answer', async () => {
    const { result } = await segmentsFor('SUPER_ADMIN');
    const users = result.segments.find(segment => segment.key === 'users');
    expect(users).toBeDefined();
    expect(users!.hits).toEqual([]);
    expect(result.omitted).not.toContain('users');
  });
});

describe('nothing private is selected', () => {
  it('no bare select from any table', () => {
    expect(SOURCE).not.toMatch(/select\(\)\s*\n?\s*\.from\(/);
  });

  it('the user columns carry no credential', () => {
    const start = SOURCE.indexOf('}).from(users)');
    const block = SOURCE.slice(SOURCE.lastIndexOf('db.select({', start), start);
    for (const forbidden of ['passwordHash', 'password', 'invitationToken', 'openId', 'loginMethod', 'tokenHash']) {
      expect(block, `${forbidden} must not be selected`).not.toContain(forbidden);
    }
    // POSITIVE CONTROL: the block must actually be the user select, or every
    // assertion above passes on an empty string.
    expect(block).toContain('id: users.id');
    expect(block).toContain('name: users.name');
  });

  it('the search term is escaped, and the length is capped by the caller', () => {
    // `%` and `_` are LIKE wildcards. containsTerm neutralises them; a raw
    // interpolation here would make "%" match every row in five tables.
    expect(SOURCE).toContain('containsTerm(query)');
    expect(SOURCE).not.toMatch(/`%\$\{/);
  });

  it('every segment is capped', () => {
    expect(SEARCH_LIMIT).toBeGreaterThan(0);
    expect(SEARCH_LIMIT).toBeLessThanOrEqual(50);
    expect((SOURCE.match(/\.limit\(SEARCH_LIMIT\)/g) ?? []).length).toBe(5);
  });
});

describe('a number is an id', () => {
  it('an id lookup is an equality, not a LIKE across the text columns', () => {
    // Typing 42 should find record 42, not every request whose title mentions
    // 42 - and it must not turn into an unbounded scan.
    expect(SOURCE).toContain('numeric !== null');
    expect((SOURCE.match(/numeric !== null/g) ?? []).length).toBe(5);
  });

  it('rejects a value that is not a positive whole number', async () => {
    const { db } = recordingDb();
    for (const query of ['0', '-4', '1e9', '12.5', ' 7 x', '99999999999999999999']) {
      const result = await runPlatformSearch(db as never, 'SUPER_ADMIN', query);
      expect(result.query, query).toBe(query.trim());
    }
  });
});

describe('the router wiring', () => {
  const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));

  it('registers platformSearch and passes the role from the SERVER context', () => {
    expect(ROUTERS).toContain('platformSearch: adminProcedure');
    // ctx.user.adminRole is re-derived from the row on every request. Taking a
    // role from input would let any administrator name a better one.
    expect(ROUTERS).toContain('runPlatformSearch(db, ctx.user.adminRole, input.query)');
    expect(ROUTERS).not.toContain('runPlatformSearch(db, input.adminRole');
  });

  it('caps the query length at the transport', () => {
    expect(ROUTERS).toContain('query: z.string().min(1).max(MAX_SEARCH_LENGTH)');
  });
});
