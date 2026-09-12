// ── READING THE DISPUTE QUEUE ───────────────────────────────────────────────
//
// `admin.disputes` returned EVERY dispute ever filed and read EVERY USER on the
// platform into memory to resolve two names per row, with the search and status
// filter applied afterwards in the browser. These tests cover what replaced it.
//
// The failure mode being guarded against is a FILTER SILENTLY NOT APPLIED - a
// queue that answers "no matching disputes" while the match sits on a page the
// response did not carry. A fake that returns its rows regardless of the where
// clause cannot see that, so this one walks the drizzle conditions and records
// which columns each query actually constrained, the same way
// server/disputes.test.ts does.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  interpretDisputeSearch, disputeQueueFilters, listAdminDisputes,
  adminDisputeDetail, disputeStatusCounts,
} from './disputeAdminView';

/** Every column named anywhere inside a drizzle condition tree. */
function columnsIn(condition: unknown): string[] {
  const names: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.name === 'string' && node.table) names.push(node.name);
    for (const key of ['queryChunks', 'chunks']) if (Array.isArray(node[key])) node[key].forEach(walk);
    if (Array.isArray(node)) node.forEach(walk);
  };
  walk(condition);
  return names;
}

/** Every literal bound into a condition tree - what the filter is comparing to. */
function valuesIn(condition: unknown): unknown[] {
  const values: unknown[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if ('value' in node && node.encoder) values.push(node.value);
    for (const key of ['queryChunks', 'chunks']) if (Array.isArray(node[key])) node[key].forEach(walk);
    if (Array.isArray(node)) node.forEach(walk);
  };
  walk(condition);
  return values;
}

describe('what a dispute search term means', () => {
  it('reads a reference as an exact id, never as free text', () => {
    expect(interpretDisputeSearch('DSP-2026-000123')).toEqual({ referenceId: 123, text: null });
  });

  it('is case and whitespace tolerant, because people paste references', () => {
    expect(interpretDisputeSearch('  dsp-2026-000007 ')).toEqual({ referenceId: 7, text: null });
  });

  it('treats anything that is not a reference as text', () => {
    expect(interpretDisputeSearch('waterproofing')).toEqual({ referenceId: null, text: 'waterproofing' });
  });

  /*
   * A near-miss is NOT a reference. 'DSP-2026-12' has too few digits, and
   * silently reading it as dispute 12 would open somebody else's dispute
   * because a digit was dropped in transcription.
   */
  it('does not guess at a malformed reference', () => {
    expect(interpretDisputeSearch('DSP-2026-12')).toEqual({ referenceId: null, text: 'DSP-2026-12' });
  });

  it('an empty term filters nothing', () => {
    expect(interpretDisputeSearch('   ')).toEqual({ referenceId: null, text: null });
    expect(interpretDisputeSearch(undefined)).toEqual({ referenceId: null, text: null });
  });
});

describe('which filters a queue view actually applies', () => {
  const base = { page: 0, pageSize: 25 };

  it('applies no filter when nothing is chosen', () => {
    expect(disputeQueueFilters(base)).toEqual([]);
    expect(disputeQueueFilters({ ...base, status: 'all', priority: 'all' })).toEqual([]);
  });

  it('constrains the column each filter names', () => {
    const filters = disputeQueueFilters({
      ...base, status: 'investigating', priority: 'high', category: 'delivery', subjectType: 'rfq',
    });
    const columns = filters.flatMap(columnsIn);
    expect(columns).toEqual(expect.arrayContaining(['status', 'priority', 'category', 'subjectType']));
    expect(filters.flatMap(valuesIn)).toEqual(
      expect.arrayContaining(['investigating', 'high', 'delivery', 'rfq']),
    );
  });

  /*
   * A VALUE THE COLUMN CANNOT HOLD IS DROPPED, NOT PASSED THROUGH. An enum
   * compared against 'urgent' matches nothing, and "no results" is
   * indistinguishable from "no matches" - the screen would say the queue is
   * empty. Dropping it shows everything, which is visibly wrong.
   */
  it('drops a filter value outside the closed set', () => {
    expect(disputeQueueFilters({ ...base, status: 'urgent' })).toEqual([]);
    expect(disputeQueueFilters({ ...base, subjectType: 'invoice' })).toEqual([]);
  });

  it('searches by id when the term is a reference, and never by text as well', () => {
    const filters = disputeQueueFilters({ ...base, search: 'DSP-2026-000042' });
    expect(filters).toHaveLength(1);
    expect(columnsIn(filters[0])).toContain('id');
    expect(valuesIn(filters[0])).toContain(42);
  });

  it('searches title, reference and both parties when the term is text', () => {
    const filters = disputeQueueFilters({ ...base, search: 'Hassan' });
    const columns = columnsIn(filters[0]);
    expect(columns).toEqual(expect.arrayContaining(['title', 'reference', 'name', 'email']));
    // Reporter AND respondent: "disputes against vendor X" is the question a
    // support administrator asks, and it is answered by the respondent's name.
    expect(columns.filter(name => name === 'name')).toHaveLength(2);
  });

  it('unassigned means the column is null, not a magic id', () => {
    const filters = disputeQueueFilters({ ...base, assignment: 'unassigned' });
    expect(columnsIn(filters[0])).toContain('assignedTo');
    expect(valuesIn(filters[0])).toEqual([]);
  });

  it('mine binds to the actor it was given', () => {
    const filters = disputeQueueFilters({ ...base, assignment: 'mine', actorId: 9 });
    expect(columnsIn(filters[0])).toContain('assignedTo');
    expect(valuesIn(filters[0])).toContain(9);
  });

  /*
   * "MINE" WITH NOBODY IS NOT "EVERYBODY'S". An unfiltered list under a label
   * that says it is yours is the worst answer available here - it is wrong AND
   * it looks right.
   */
  it('refuses to widen "mine" to the whole queue when there is no actor', () => {
    const filters = disputeQueueFilters({ page: 0, pageSize: 25, assignment: 'mine' });
    expect(filters).toHaveLength(1);
    expect(columnsIn(filters[0])).not.toContain('assignedTo');
    expect(String((filters[0] as any).queryChunks?.map((chunk: any) => chunk.value ?? '').join(''))).toContain('1 = 0');
  });
});

/** ── A database stand-in that records what it was asked ──────────────────── */
function fakeDb(rows: Record<string, any[]>) {
  const asked: Array<{
    shape: string; columns: string[]; joins: string[]; limit?: number; offset?: number;
  }> = [];

  /*
   * Keyed by the TABLE, read off drizzle's own name symbol, rather than by
   * guessing from the projection. The first version of this fake inferred the
   * query from its selected columns and mapped two different reads onto the
   * same key, which made a passing assertion mean nothing.
   */
  const nameOf = (table: any) =>
    String(table?.[Symbol.for('drizzle:Name')] ?? table?._?.name ?? 'unknown');

  const db: any = {
    select: (projection?: Record<string, unknown>) => {
      const keys = Object.keys(projection ?? {});
      const counting = keys.includes('count');
      const grouped = counting && keys.includes('status');
      const entry = { shape: 'unknown', columns: [] as string[], joins: [] as string[] } as {
        shape: string; columns: string[]; joins: string[]; limit?: number; offset?: number;
      };
      let data: any[] = [];
      const chain: any = {
        from: (table: any) => {
          const name = nameOf(table);
          entry.shape = grouped ? 'statusCounts' : counting ? 'count' : name;
          data = rows[entry.shape] ?? [];
          asked.push(entry);
          return chain;
        },
        // Recorded, because WHICH TABLES A QUERY JOINS is part of whether its
        // answer is the same answer. A count that stops joining what the list
        // joins survived this suite until the joins were recorded here.
        innerJoin: (table: any) => { entry.joins.push(nameOf(table)); return chain; },
        leftJoin: (table: any) => { entry.joins.push(nameOf(table)); return chain; },
        groupBy: () => chain,
        orderBy: () => chain,
        where: (condition: unknown) => { entry.columns = columnsIn(condition); return chain; },
        limit: (value: number) => { entry.limit = value; return chain; },
        offset: (value: number) => { entry.offset = value; return chain; },
        then: (resolve: any, reject: any) => Promise.resolve(data).then(resolve, reject),
      };
      return chain;
    },
  };
  return { db, asked };
}

describe('one page of the support queue', () => {
  const queueRows = [{ id: 3, reference: 'DSP-2026-000003', title: 'Late delivery', reporterName: 'Homeowner' }];

  it('returns a real total from a count, and the page it was asked for', async () => {
    const { db, asked } = fakeDb({ count: [{ count: 41 }], disputes: queueRows, statusCounts: [] });
    const page = await listAdminDisputes(db, { page: 1, pageSize: 25 });
    expect(page).toMatchObject({ total: 41, page: 1, pageSize: 25 });
    expect(page.rows).toHaveLength(1);
    // The page is bounded and offset. Neither was true before: the old
    // procedure returned every dispute ever filed.
    const listed = asked.find(entry => entry.limit !== undefined);
    expect(listed).toMatchObject({ limit: 25, offset: 25 });
  });

  /*
   * THE COUNT AND THE ROWS MUST AGREE. A total taken from an unjoined
   * `count(*)` disagrees with the page the moment a filter touches a joined
   * column, and "Page 1 of 4" over one page of results is a worse lie than no
   * pager at all. Both queries carry the same constrained columns here.
   */
  it('counts over the same filters as it lists', async () => {
    const { db, asked } = fakeDb({ count: [{ count: 2 }], disputes: queueRows });
    await listAdminDisputes(db, { page: 0, pageSize: 25, status: 'open', search: 'Hassan' });
    const counted = asked.find(entry => entry.shape === 'count');
    const listed = asked.find(entry => entry.limit !== undefined);
    expect(counted!.columns.sort()).toEqual(listed!.columns.sort());
    expect(counted!.columns).toEqual(expect.arrayContaining(['status', 'title']));
    /*
     * And over the same JOINS. The search filters on the parties' names, which
     * live in the joined user rows: a count that does not join them is not
     * counting the same thing the page lists - in MySQL it does not run at all.
     */
    expect(counted!.joins).toEqual(expect.arrayContaining(['disputeReporter', 'disputeRespondent']));
  });

  it('an unfiltered queue constrains nothing', async () => {
    const { db, asked } = fakeDb({ count: [{ count: 0 }], disputes: [] });
    await listAdminDisputes(db, { page: 0, pageSize: 25 });
    expect(asked.every(entry => entry.columns.length === 0)).toBe(true);
  });

  it('summarises the whole table by status, not the page', async () => {
    const { db } = fakeDb({ statusCounts: [{ status: 'open', count: 4 }, { status: 'resolved', count: 1 }] });
    await expect(disputeStatusCounts(db)).resolves.toEqual({
      open: 4, investigating: 0, resolved: 1, rejected: 0, withdrawn: 0,
    });
  });
});

describe('one dispute, for the administrator working it', () => {
  const dispute = {
    id: 5, reference: 'DSP-2026-000005', reporterId: 10, respondentId: 11,
    assignedTo: 12, assignedBy: 12, resolvedBy: null, reopenedBy: null,
    subjectType: 'project', subjectId: 0, status: 'investigating',
  };

  function detailDb(over: Record<string, any[]> = {}) {
    return fakeDb({
      disputes: [dispute],
      disputeStatusHistory: [{ id: 1, fromStatus: 'none', toStatus: 'open', actorId: 10 }],
      disputeMessages: [{ id: 2, authorId: 11, body: 'It arrived short.' }],
      disputeEvidence: [{ id: 3, uploadedBy: 10, fileName: 'note.pdf', storageKey: 'dispute-evidence/5/a.pdf', removedAt: null }],
      adminNotes: [{ id: 4, authorId: 12, note: 'Called the supplier.' }],
      users: [
        { id: 10, name: 'Homeowner' }, { id: 11, name: 'Supplier' }, { id: 12, name: 'Support' },
      ],
      ...over,
    });
  }

  it('names every id on the record', async () => {
    const { db } = detailDb();
    const detail = await adminDisputeDetail(db, 5);
    expect(detail!.dispute).toMatchObject({
      reporterName: 'Homeowner', respondentName: 'Supplier', assigneeName: 'Support',
    });
    expect(detail!.history[0].actorName).toBe('Homeowner');
    expect(detail!.messages[0].authorName).toBe('Supplier');
    expect(detail!.notes[0].authorName).toBe('Support');
  });

  /*
   * ONE QUERY FOR THE NAMES. The procedure this replaces read EVERY user on the
   * platform to resolve two names per row. This test fails if that comes back:
   * the user lookup must be bounded by the ids the record actually mentions.
   */
  it('reads the users it needs, not the user table', async () => {
    const { db, asked } = detailDb();
    await adminDisputeDetail(db, 5);
    const lookups = asked.filter(entry => entry.shape === 'users');
    expect(lookups).toHaveLength(1);
    expect(lookups[0].columns).toContain('id');
  });

  it('is null for a dispute that does not exist, rather than a blank record', async () => {
    const { db } = detailDb({ disputes: [] });
    await expect(adminDisputeDetail(db, 5)).resolves.toBeNull();
  });

  /*
   * A pre-0046 row with nothing to backfill a subject from reports NO SUBJECT
   * rather than "project 0", which would be a fabricated relationship.
   */
  it('does not invent a subject for a row that never had one', async () => {
    const { db } = detailDb();
    const detail = await adminDisputeDetail(db, 5);
    expect(detail!.subjectLabel).toBeNull();
  });

  it('withholds the key of a withdrawn file, for an administrator too', async () => {
    const { db } = detailDb({
      disputeEvidence: [{ id: 3, uploadedBy: 10, fileName: 'gone.pdf', storageKey: 'dispute-evidence/5/g.pdf', removedAt: new Date() }],
    });
    const detail = await adminDisputeDetail(db, 5);
    // The row is KEPT - the record shows the file existed and who withdrew it -
    // but the storage proxy refuses a removed key to every caller, so a url
    // here would be a link that 403s.
    expect(detail!.evidence[0]).toMatchObject({ fileName: 'gone.pdf', url: null });
    expect(detail!.evidence[0].storageKey).toBeUndefined();
  });

  it('never hands back a storage key, even for a live file', async () => {
    const { db } = detailDb();
    const detail = await adminDisputeDetail(db, 5);
    expect(detail!.evidence[0].url).toBe('/manus-storage/dispute-evidence/5/a.pdf');
    expect(detail!.evidence[0].storageKey).toBeUndefined();
  });

  /*
   * INTERNAL NOTES COME FROM A DIFFERENT TABLE. `adminNotes` and
   * `disputeMessages` are separate precisely so a forgotten visibility clause
   * cannot show a reporter what an administrator wrote about them - and this
   * asserts the admin detail reads BOTH, since the participants' `disputes.get`
   * reads only the second.
   */
  it('reads the internal notes and the participant messages as separate sets', async () => {
    const { db, asked } = detailDb();
    const detail = await adminDisputeDetail(db, 5);
    expect(detail!.notes.map(row => row.note)).toEqual(['Called the supplier.']);
    expect(detail!.messages.map((row: any) => row.body)).toEqual(['It arrived short.']);
    expect(asked.filter(entry => entry.shape === 'adminNotes')).toHaveLength(1);
    expect(asked.filter(entry => entry.shape === 'disputeMessages')).toHaveLength(1);
  });
});

/**
 * ── WHAT BEHAVIOUR CANNOT SEE ──────────────────────────────────────────────
 *
 * That the router uses this service rather than restating the queries. A
 * behavioural test of the service passes whether or not anything calls it.
 */
describe('the router reads the queue through this service', () => {
  const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');

  it('calls the service and no longer scans the user table for names', () => {
    expect(source).toContain('listAdminDisputes(db,');
    expect(source).toContain('adminDisputeDetail(db,');
    expect(source).not.toContain('const userRows = await db.select({ id: users.id, name: users.name }).from(users);');
  });

  /*
   * The assignee dropdown must offer EXACTLY the set `assignDispute` accepts.
   * Offering a name the mutation then refuses is a control that fails after the
   * administrator has used it.
   */
  it('offers only assignees the assign mutation would accept', () => {
    const offered = source.slice(source.indexOf('disputeAssignees:'), source.indexOf('disputeAssignees:') + 500);
    expect(offered).toContain("hasAdminPermission(admin.adminRole as any, 'support.manage')");
    const assigning = source.slice(source.indexOf('assignDispute:'), source.indexOf('assignDispute:') + 1500);
    expect(assigning).toContain("hasAdminPermission(assignee.adminRole as any, 'support.manage')");
  });
});
