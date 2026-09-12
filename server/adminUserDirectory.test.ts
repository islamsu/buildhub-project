import { describe, expect, it } from 'vitest';
import { listAdminUsers, ADMIN_DIRECTORY_COLUMNS } from './adminUserDirectory';

/**
 * THE DIRECTORY WAS `.limit(250)` WITH THE SCREEN DOING THE REST.
 *
 * Under 250 accounts that is merely wasteful. Past it the screen is WRONG in a
 * way nothing announces: accounts become invisible to administration, a search
 * for one of them reads as "no such user" rather than "not in the page I was
 * given", and the group tiles report counts of a truncated sample as counts of
 * the platform.
 *
 * These tests drive the module with a fake db that RECORDS what it was asked,
 * because the point is which work happens in the database. A test that only
 * checked the returned shape would pass just as happily on the old code with a
 * bigger limit.
 */

type Recorded = { limit?: number; offset?: number; grouped?: boolean; where?: unknown };

function fakeDb(rows: any[], counts: { group: string | null; total: number; dummy: number }[]) {
  const seen: Recorded[] = [];
  const chain = (record: Recorded, result: any) => {
    const self: any = {
      from: () => self,
      where: (w: unknown) => { record.where = w; return self; },
      orderBy: () => self,
      groupBy: () => { record.grouped = true; return self; },
      limit: (n: number) => { record.limit = n; return self; },
      offset: (n: number) => { record.offset = n; return self; },
      then: (resolve: (value: any) => void) => resolve(result),
    };
    return self;
  };
  let call = 0;
  return {
    seen,
    select: (shape: any) => {
      const record: Recorded = {};
      seen.push(record);
      // Call order within Promise.all: rows, total, group counts.
      const result = call === 0 ? rows : call === 1 ? [{ count: rows.length }] : counts;
      call += 1;
      return chain(record, result);
    },
  };
}

const query = { group: 'all', sort: 'newest' as const, page: 0, pageSize: 10 };

describe('the row shape never carries a credential', () => {
  it('has no password, hash or token column', () => {
    const columns = Object.keys(ADMIN_DIRECTORY_COLUMNS);
    for (const forbidden of ['password', 'passwordHash', 'tokenHash', 'sessionToken', 'resetToken']) {
      expect(columns).not.toContain(forbidden);
    }
    // Positive control: the allowlist is not simply empty.
    expect(columns).toContain('email');
    expect(columns).toContain('accountStatus');
  });
});

describe('paging happens in the database', () => {
  it('asks for exactly one page, offset to it', async () => {
    const db = fakeDb([{ id: 1 }], []);
    await listAdminUsers(db as any, { ...query, page: 3, pageSize: 25 });
    expect(db.seen[0].limit).toBe(25);
    expect(db.seen[0].offset).toBe(75);
  });

  it('does not fetch the table and slice it - the row read is always bounded', async () => {
    // The first select is the one that returns ROWS; the other two are a
    // COUNT and a GROUP BY, which are bounded by being aggregates. Only the
    // row read can drag the table into memory, and it is the one the old
    // code left at a flat 250 with the screen slicing the result.
    const db = fakeDb([], []);
    await listAdminUsers(db as any, { ...query, pageSize: 10 });
    expect(db.seen[0].limit).toBe(10);
    expect(db.seen[0].grouped).toBeUndefined();
    // And the page size is what was ASKED for, not a constant: a hardcoded
    // limit would satisfy the line above on the default page size alone.
    const wider = fakeDb([], []);
    await listAdminUsers(wider as any, { ...query, pageSize: 37 });
    expect(wider.seen[0].limit).toBe(37);
  });
});

describe('counts come from one grouped query, not one query per role', () => {
  it('groups in SQL', async () => {
    const db = fakeDb([], [{ group: 'supplier', total: 4, dummy: 1 }]);
    await listAdminUsers(db as any, query);
    expect(db.seen.some(record => record.grouped)).toBe(true);
    // Three reads total: the page, its total, and the grouped counts. If a
    // future change adds a COUNT per role this becomes eight and fails.
    expect(db.seen.length).toBe(3);
  });

  it('reports totals, real and dummy from those groups', async () => {
    const db = fakeDb([], [
      { group: 'supplier', total: 10, dummy: 4 },
      { group: 'homeowner', total: 6, dummy: 0 },
    ]);
    const page = await listAdminUsers(db as any, query);
    expect(page.counts.all).toBe(16);
    expect(page.counts.dummy).toBe(4);
    expect(page.counts.real).toBe(12);
    expect(page.counts.byRole).toEqual({ supplier: 10, homeowner: 6 });
    expect(page.counts.byRoleReal).toEqual({ supplier: 6, homeowner: 6 });
  });

  it('ignores a null group rather than inventing a bucket for it', async () => {
    const db = fakeDb([], [{ group: null, total: 3, dummy: 0 }, { group: 'supplier', total: 2, dummy: 0 }]);
    const page = await listAdminUsers(db as any, query);
    expect(page.counts.byRole).toEqual({ supplier: 2 });
    // It still counts toward the platform total: the account exists.
    expect(page.counts.all).toBe(5);
  });
});

describe('the filter', () => {
  it('restricts by group when the group is a real role', async () => {
    const db = fakeDb([], []);
    await listAdminUsers(db as any, { ...query, group: 'supplier' });
    expect(db.seen[0].where).toBeDefined();
  });

  it("treats 'all' as no restriction", async () => {
    const db = fakeDb([], []);
    await listAdminUsers(db as any, { ...query, group: 'all' });
    expect(db.seen[0].where).toBeUndefined();
  });

  it('treats an unknown group as no restriction rather than matching nothing', async () => {
    // A client sending a stale role key must see the directory, not an empty
    // screen that looks like the platform has no users.
    const db = fakeDb([], []);
    await listAdminUsers(db as any, { ...query, group: 'not-a-role' });
    expect(db.seen[0].where).toBeUndefined();
  });

  it('applies a search as a database condition', async () => {
    const db = fakeDb([], []);
    await listAdminUsers(db as any, { ...query, search: 'ahmed' });
    expect(db.seen[0].where).toBeDefined();
  });

  it('ignores a blank search rather than filtering on emptiness', async () => {
    const db = fakeDb([], []);
    await listAdminUsers(db as any, { ...query, search: '   ' });
    expect(db.seen[0].where).toBeUndefined();
  });

  it('counts the same filter it lists - total is of the filter, not the table', async () => {
    const db = fakeDb([{ id: 1 }], []);
    await listAdminUsers(db as any, { ...query, group: 'supplier' });
    expect(db.seen[1].where).toBe(db.seen[0].where);
  });

  it('but the tile counts are unfiltered, so a tile does not report the filter back', async () => {
    const db = fakeDb([], []);
    await listAdminUsers(db as any, { ...query, group: 'supplier' });
    const grouped = db.seen.find(record => record.grouped);
    expect(grouped?.where).toBeUndefined();
  });
});
