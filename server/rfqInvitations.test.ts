// ── RFQ SUPPLIER INVITATIONS ───────────────────────────────────────────────
//
// The board was entirely PULL: declare a category, wait for a match. A customer
// who knew which firm they wanted could not say so. Invitations add PUSH, and
// the owner's decision was "both" - so the first thing these tests defend is
// that the open board is UNCHANGED, not replaced.
//
// Two owner decisions are encoded here and each has its own tests, because
// each is a rule somebody could quietly reverse:
//
//   an invitation is EXEMPT from the qualified-enquiry allowance
//   the requester, a project `commercial` holder, and Super Admin may invite

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { getDb } from './db';
import { TRPCError } from '@trpc/server';
import {
  OPEN_INVITATION_STATUSES, declineInvitation, hasOpenInvitation, inviteSupplier,
  invitedRfqIds, markInvitationResponded, markInvitationViewed, requireInviteRights,
  INVITED_SUPPLIER_COLUMNS,
} from './rfqInvitations';
import { rfqs, rfqSuppliers, projects, projectMembers, users } from '../drizzle/schema';

// ── A table-aware double that records writes ───────────────────────────────

function makeDb(rowsByTable: Map<unknown, Record<string, unknown>[]>) {
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];
  let duplicateOnInsert = false;

  const chain = (table: unknown): Record<string, unknown> => {
    const rows = rowsByTable.get(table) ?? [];
    const c: Record<string, unknown> = {
      where: () => c, orderBy: () => c, limit: () => c, for: () => c,
      leftJoin: () => c, innerJoin: () => c, groupBy: () => c, offset: () => c,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(rows.map(r => ({ ...r }))).then(res, rej),
    };
    return c;
  };

  const db: Record<string, unknown> = {
    select: () => ({ from: (table: unknown) => chain(table) }),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        if (duplicateOnInsert) {
          const error = new Error('duplicate') as Error & { code: string };
          error.code = 'ER_DUP_ENTRY';
          throw error;
        }
        inserts.push({ table, values });
        return [{ insertId: 501 }];
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { updates.push({ table, values }); },
      }),
    }),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };

  return {
    db,
    inserts, updates,
    into: (table: unknown) => inserts.filter(r => r.table === table).map(r => r.values),
    patched: (table: unknown) => updates.filter(r => r.table === table).map(r => r.values),
    failNextInsertAsDuplicate: () => { duplicateOnInsert = true; },
  };
}

const REQUESTER = 100;
const SUPPLIER = 200;
const STRANGER = 300;
const PM = 400;

const OPEN_RFQ = { id: 5, requesterId: REQUESTER, projectId: null, status: 'open', title: 'Rebar for slab' };

function tables(over: Partial<Record<'rfqs' | 'rfqSuppliers' | 'projects' | 'projectMembers' | 'users', Record<string, unknown>[]>> = {}) {
  return new Map<unknown, Record<string, unknown>[]>([
    [rfqs, over.rfqs ?? [OPEN_RFQ]],
    [rfqSuppliers, over.rfqSuppliers ?? []],
    [projects, over.projects ?? []],
    [projectMembers, over.projectMembers ?? []],
    [users, over.users ?? []],
  ]);
}

const asUser = (id: number, extra: Record<string, unknown> = {}) => ({ id, role: 'user', adminRole: null, ...extra });

// ── 1. Who may invite ──────────────────────────────────────────────────────

describe('requireInviteRights - the one place the invite rule lives', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the RFQ requester may invite', async () => {
    const { db } = makeDb(tables());
    await expect(requireInviteRights(db, 5, asUser(REQUESTER))).resolves.toMatchObject({ rfqId: 5 });
  });

  it('a Super Admin may invite, for support acting on the customer\'s behalf', async () => {
    const { db } = makeDb(tables());
    await expect(requireInviteRights(db, 5, asUser(STRANGER, { role: 'admin', adminRole: 'SUPER_ADMIN' })))
      .resolves.toMatchObject({ rfqId: 5 });
  });

  it('a sub-admin who is NOT Super Admin may not', async () => {
    const { db } = makeDb(tables());
    await expect(requireInviteRights(db, 5, asUser(STRANGER, { role: 'admin', adminRole: 'SUPPORT_ADMIN' })))
      .rejects.toThrow(TRPCError);
  });

  it('a project MANAGER on the linked project may invite - the same capability that lets them raise the RFQ', async () => {
    const { db } = makeDb(tables({
      rfqs: [{ ...OPEN_RFQ, projectId: 9 }],
      projects: [{ id: 9, ownerId: REQUESTER }],
      projectMembers: [{ projectId: 9, userId: PM, projectRole: 'manager', removedAt: null }],
    }));
    await expect(requireInviteRights(db, 5, asUser(PM))).resolves.toMatchObject({ rfqId: 5 });
  });

  it('a project CONTRACTOR on the linked project may NOT - they report progress, they do not commit spend', async () => {
    const { db } = makeDb(tables({
      rfqs: [{ ...OPEN_RFQ, projectId: 9 }],
      projects: [{ id: 9, ownerId: REQUESTER }],
      projectMembers: [{ projectId: 9, userId: PM, projectRole: 'contractor', removedAt: null }],
    }));
    await expect(requireInviteRights(db, 5, asUser(PM))).rejects.toThrow(TRPCError);
  });

  /**
   * A REMOVED PROJECT MEMBER MUST NOT KEEP INVITE RIGHTS - and that is
   * DELIBERATELY NOT TESTED HERE.
   *
   * The rule lives in `liveMembership`'s WHERE clause
   * (`isNull(projectMembers.removedAt)`), and the double above ignores WHERE
   * clauses entirely - it answers every query for a table with the same rows.
   * A test written against it would pass whether the filter was present or
   * not, which is the vacuous assertion this codebase has been bitten by
   * before: a guard whose removal leaves the suite green is not tested.
   *
   * Making the double filter removed rows itself would be worse, not better -
   * it would then pass with the production filter DELETED, which is precisely
   * the mutation it is supposed to catch.
   *
   * So it is proven where the WHERE clause is real: against MariaDB in
   * evidence/zg-rfqinvite.mjs, where a project manager is removed and their
   * invite attempt is then refused.
   */

  it('an unrelated user is refused as NOT_FOUND, not FORBIDDEN - a refusal must not confirm the RFQ exists', async () => {
    const { db } = makeDb(tables());
    await expect(requireInviteRights(db, 5, asUser(STRANGER)))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('an RFQ that does not exist gives the SAME answer as one the caller may not touch', async () => {
    const { db: missing } = makeDb(tables({ rfqs: [] }));
    const absent = await requireInviteRights(missing, 5, asUser(REQUESTER)).catch(e => e);
    const { db: forbidden } = makeDb(tables());
    const denied = await requireInviteRights(forbidden, 5, asUser(STRANGER)).catch(e => e);
    // Identical code AND identical message: a difference in either lets an
    // outsider map which RFQ ids are real by watching the error change.
    expect(absent.code).toBe(denied.code);
    expect(absent.message).toBe(denied.message);
  });
});

// ── 2. Inviting, and not inviting twice ────────────────────────────────────

describe('inviteSupplier - idempotent by the unique index, not by hope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the invitation and records who sent it', async () => {
    const rec = makeDb(tables());
    const result = await inviteSupplier({ db: rec.db, rfqId: 5, supplierId: SUPPLIER, invitedBy: REQUESTER });
    expect(result).toEqual({ outcome: 'invited', invitationId: 501 });
    expect(rec.into(rfqSuppliers)[0]).toMatchObject({ rfqId: 5, supplierId: SUPPLIER, invitedBy: REQUESTER });
  });

  it('a second invitation for the same pair writes NOTHING - one invitation, one notification', async () => {
    const rec = makeDb(tables({ rfqSuppliers: [{ id: 1, rfqId: 5, supplierId: SUPPLIER, status: 'invited' }] }));
    const result = await inviteSupplier({ db: rec.db, rfqId: 5, supplierId: SUPPLIER, invitedBy: REQUESTER });
    expect(result).toEqual({ outcome: 'already_invited' });
    expect(rec.into(rfqSuppliers)).toEqual([]);
  });

  it('losing the race to a concurrent invitation is reported as already_invited, not as a failure', async () => {
    const rec = makeDb(tables());
    rec.failNextInsertAsDuplicate();
    // The check-then-write above found nothing; the database's unique index is
    // what actually decides. A caller must not be told to retry something that
    // has already succeeded for someone else.
    await expect(inviteSupplier({ db: rec.db, rfqId: 5, supplierId: SUPPLIER, invitedBy: REQUESTER }))
      .resolves.toEqual({ outcome: 'already_invited' });
  });
});

// ── 3. The exemption, and what it must not corrupt ─────────────────────────

describe('the invitation is exempt from the qualified-enquiry allowance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('an invited supplier has an OPEN invitation', async () => {
    const { db } = makeDb(tables({ rfqSuppliers: [{ rfqId: 5, supplierId: SUPPLIER, status: 'invited' }] }));
    await expect(hasOpenInvitation(db, 5, SUPPLIER)).resolves.toBe(true);
  });

  it('a supplier who already VIEWED still has an open invitation - viewing is not answering', async () => {
    const { db } = makeDb(tables({ rfqSuppliers: [{ rfqId: 5, supplierId: SUPPLIER, status: 'viewed' }] }));
    await expect(hasOpenInvitation(db, 5, SUPPLIER)).resolves.toBe(true);
  });

  it('a supplier who DECLINED does not - a decline has to change something', async () => {
    const { db } = makeDb(tables({ rfqSuppliers: [{ rfqId: 5, supplierId: SUPPLIER, status: 'declined' }] }));
    await expect(hasOpenInvitation(db, 5, SUPPLIER)).resolves.toBe(false);
  });

  it('an UNINVITED supplier has none, so nothing about the open board changes for them', async () => {
    const { db } = makeDb(tables({ rfqSuppliers: [] }));
    await expect(hasOpenInvitation(db, 5, STRANGER)).resolves.toBe(false);
  });

  it('only invited and viewed count as open - the two states a supplier can still act from', () => {
    expect([...OPEN_INVITATION_STATUSES]).toEqual(['invited', 'viewed']);
  });

  it('invitedRfqIds returns only actionable invitations, so a declined one never re-appears on the board', async () => {
    const { db } = makeDb(tables({ rfqSuppliers: [
      { rfqId: 5, supplierId: SUPPLIER, status: 'invited' },
      { rfqId: 6, supplierId: SUPPLIER, status: 'viewed' },
      { rfqId: 7, supplierId: SUPPLIER, status: 'declined' },
      { rfqId: 8, supplierId: SUPPLIER, status: 'responded' },
    ] }));
    await expect(invitedRfqIds(db, SUPPLIER)).resolves.toEqual([5, 6]);
  });
});

// ── 4. The invitation's own state machine ──────────────────────────────────

describe('invitation status transitions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opening an RFQ moves invited -> viewed and stamps the time', async () => {
    const rec = makeDb(tables({ rfqSuppliers: [{ id: 1, rfqId: 5, supplierId: SUPPLIER, status: 'invited', viewedAt: null }] }));
    await markInvitationViewed(rec.db, 5, SUPPLIER);
    expect(rec.patched(rfqSuppliers)[0]).toMatchObject({ status: 'viewed' });
    expect(rec.patched(rfqSuppliers)[0].viewedAt).toBeInstanceOf(Date);
  });

  it('viewedAt is stamped ONCE - a second visit must not overwrite when they first saw it', async () => {
    const first = new Date('2026-01-01');
    const rec = makeDb(tables({ rfqSuppliers: [{ id: 1, rfqId: 5, supplierId: SUPPLIER, status: 'viewed', viewedAt: first }] }));
    await markInvitationViewed(rec.db, 5, SUPPLIER);
    // A dispute about a missed deadline turns on when the supplier actually
    // first saw the request. Re-stamping destroys the only record of it.
    expect(rec.patched(rfqSuppliers)).toEqual([]);
  });

  it('an inconsistent row - still "invited" but already carrying a viewedAt - is left alone', async () => {
    // The two guards in markInvitationViewed defend DIFFERENT things, and
    // testing only the ordinary path proves only one of them. The status check
    // catches an invitation that has moved on; the viewedAt check catches a row
    // where the two disagree, which is what a hand-edit or a partial write
    // leaves behind. Without this case the viewedAt guard could be deleted and
    // the suite would stay green.
    const first = new Date('2026-01-01');
    const rec = makeDb(tables({ rfqSuppliers: [{ id: 1, rfqId: 5, supplierId: SUPPLIER, status: 'invited', viewedAt: first }] }));
    await markInvitationViewed(rec.db, 5, SUPPLIER);
    expect(rec.patched(rfqSuppliers)).toEqual([]);
  });

  it('a DECLINED invitation is not dragged back to viewed', async () => {
    const rec = makeDb(tables({ rfqSuppliers: [{ id: 1, rfqId: 5, supplierId: SUPPLIER, status: 'declined', viewedAt: null }] }));
    await markInvitationViewed(rec.db, 5, SUPPLIER);
    expect(rec.patched(rfqSuppliers)).toEqual([]);
  });

  it('quoting moves the invitation to responded', async () => {
    const rec = makeDb(tables({ rfqSuppliers: [{ id: 1, rfqId: 5, supplierId: SUPPLIER, status: 'viewed' }] }));
    await markInvitationResponded(rec.db, 5, SUPPLIER);
    expect(rec.patched(rfqSuppliers)[0]).toMatchObject({ status: 'responded' });
  });

  it('quoting twice does not re-stamp respondedAt', async () => {
    const rec = makeDb(tables({ rfqSuppliers: [{ id: 1, rfqId: 5, supplierId: SUPPLIER, status: 'responded' }] }));
    await markInvitationResponded(rec.db, 5, SUPPLIER);
    expect(rec.patched(rfqSuppliers)).toEqual([]);
  });

  it('quoting when there was no invitation writes nothing - the ordinary open-board case', async () => {
    const rec = makeDb(tables({ rfqSuppliers: [] }));
    await markInvitationResponded(rec.db, 5, STRANGER);
    expect(rec.patched(rfqSuppliers)).toEqual([]);
  });

  it('a supplier can decline', async () => {
    const rec = makeDb(tables({ rfqSuppliers: [{ id: 1, rfqId: 5, supplierId: SUPPLIER, status: 'invited' }] }));
    await expect(declineInvitation(rec.db, 5, SUPPLIER)).resolves.toBe(true);
    expect(rec.patched(rfqSuppliers)[0]).toMatchObject({ status: 'declined' });
  });

  it('a supplier who ALREADY QUOTED cannot un-quote by declining', async () => {
    const rec = makeDb(tables({ rfqSuppliers: [{ id: 1, rfqId: 5, supplierId: SUPPLIER, status: 'responded' }] }));
    // The quotation is a commercial act that exists independently of this row.
    await expect(declineInvitation(rec.db, 5, SUPPLIER)).resolves.toBe(false);
    expect(rec.patched(rfqSuppliers)).toEqual([]);
  });

  it('declining an invitation that is not yours does nothing - the WHERE is the authorization', async () => {
    const rec = makeDb(tables({ rfqSuppliers: [] }));
    await expect(declineInvitation(rec.db, 5, STRANGER)).resolves.toBe(false);
    expect(rec.patched(rfqSuppliers)).toEqual([]);
  });
});

// ── 5. What a requester may see about the firms they approached ────────────

describe('INVITED_SUPPLIER_COLUMNS - an allowlist, not a select star', () => {
  it('carries no credential, token or hash', () => {
    const names = Object.keys(INVITED_SUPPLIER_COLUMNS);
    for (const forbidden of ['passwordHash', 'password', 'invitationToken', 'passwordResetToken', 'openId']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('carries what a customer actually needs to judge a supplier, and nothing more', () => {
    expect(Object.keys(INVITED_SUPPLIER_COLUMNS).sort())
      .toEqual(['id', 'location', 'name', 'rating', 'reviewCount', 'userRole', 'verified']);
  });

  it('does not expose the supplier\'s email or phone - contact is what a qualified enquiry buys', () => {
    const names = Object.keys(INVITED_SUPPLIER_COLUMNS);
    expect(names).not.toContain('email');
    expect(names).not.toContain('phone');
  });
});
