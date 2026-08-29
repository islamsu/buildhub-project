// ── The RFQ state machine, as the enum actually defines it ─────────────────
//
// rfqs.status is open | closed | awarded. Three states, not the nine an audit
// checklist might imagine, and the tests below are written against the three
// that exist rather than against a wished-for machine.
//
// Until now only ONE transition was reachable: open -> awarded, via accepting a
// quotation. `closed` was declared by the enum and by the `rfq_closed` audit
// action, and nothing wrote it. A customer could not withdraw a request. It
// stayed open collecting bids, and since opening an enquiry costs a supplier a
// lead credit, it kept charging providers for a job that no longer existed.
//
// WHAT THESE TESTS ARE FOR. Not "close works" - that is the easy half. The
// half that matters is that the ILLEGAL transitions are refused BY THE SERVER,
// because the client has always filtered the pipeline to status === 'open' and
// that filtering is not a control. Each refusal below is reachable only by
// calling the API directly, which is exactly how it would be reached in anger.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({
  getDb: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserByUsername: vi.fn(),
  normalizeEmail: (v: string | null | undefined) => v?.trim().toLowerCase() || null,
  normalizeUsername: (v: string | null | undefined) => v?.trim().toLowerCase() || null,
}));

import { appRouter } from './routers';
import { getDb } from './db';
import { quotations, rfqs } from '../drizzle/schema';
import type { TrpcContext } from './_core/context';

const OWNER = 601;
const STRANGER = 602;
const BIDDER_A = 603;
const BIDDER_B = 604;

/**
 * A transactional db double.
 *
 * It records the UPDATES by table so a test can assert WHAT was written and not
 * merely that something was. The distinction is the point: an earlier double in
 * this repository could not tell tables apart, so "one message stored" was
 * really "one row stored" and passed while the wrong table was written.
 */
function makeDb(options: {
  rfqStatus?: 'open' | 'closed' | 'awarded';
  requesterId?: number;
  bidders?: number[];
} = {}) {
  const status = options.rfqStatus ?? 'open';
  const requesterId = options.requesterId ?? OWNER;
  const bidders = options.bidders ?? [BIDDER_A, BIDDER_B];
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];
  const inserts: { table: unknown; values: unknown }[] = [];

  const tx = {
    select: () => ({
      from: (table: unknown) => {
        const rows = table === rfqs
          ? [{ id: 42, requesterId, status, title: 'Villa finishing' }]
          : bidders.map((providerId, i) => ({ id: 900 + i, providerId, rfqId: 42, status: 'pending' }));
        const chain = {
          where: () => ({ for: () => Promise.resolve(rows), then: (r: (v: unknown) => void) => r(rows) }),
        };
        return chain;
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => { updates.push({ table, values }); return Promise.resolve(); },
      }),
    }),
  };

  const db = {
    transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    insert: (table: unknown) => ({ values: (values: unknown) => { inserts.push({ table, values }); return Promise.resolve(); } }),
  };
  return { db, updates, inserts };
}

function ctxFor(id: number): TrpcContext {
  return {
    user: {
      id, openId: `open-${id}`, email: `u${id}@example.com`, name: `User ${id}`,
      loginMethod: 'test', role: 'user', adminRole: null, userRole: 'homeowner',
      accountStatus: 'active', isDummy: false,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { clearCookie: vi.fn(), cookie: vi.fn() } as unknown as TrpcContext['res'],
  } as TrpcContext;
}

const close = (viewer: number) => appRouter.createCaller(ctxFor(viewer)).rfq.close({ id: 42 });

beforeEach(() => vi.clearAllMocks());

describe('open -> closed, the transition that was missing', () => {
  it('the requester can withdraw their own open request', async () => {
    const { db, updates } = makeDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    const result = await close(OWNER);
    expect(result.success).toBe(true);

    const rfqWrites = updates.filter(u => u.table === rfqs);
    expect(rfqWrites).toHaveLength(1);
    expect(rfqWrites[0].values).toEqual({ status: 'closed' });
  });

  it('and the outstanding bids are NOT marked rejected', async () => {
    // "Not selected" is a statement about a bid. Withdrawing is a statement
    // about the request. Saying the first when the second happened tells
    // suppliers they lost a competition that was never decided.
    const { db, updates } = makeDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    await close(OWNER);
    expect(updates.filter(u => u.table === quotations)).toEqual([]);
  });

  it('every bidder is told, once each', async () => {
    const { db, inserts } = makeDb({ bidders: [BIDDER_A, BIDDER_B] });
    vi.mocked(getDb).mockResolvedValue(db as never);
    const result = await close(OWNER);
    expect(result.notifiedProviders).toBe(2);
  });

  it('a provider holding several bids is told ONCE, not once per bid', async () => {
    // The same de-duplication the losing-competitor path needs, and the same
    // reason: one provider, several quotations on one request.
    const { db } = makeDb({ bidders: [BIDDER_A, BIDDER_A, BIDDER_A] });
    vi.mocked(getDb).mockResolvedValue(db as never);
    const result = await close(OWNER);
    expect(result.notifiedProviders).toBe(1);
  });
});

describe('the transitions that must be refused', () => {
  it('a stranger cannot close somebody else\'s request', async () => {
    const { db, updates } = makeDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(close(STRANGER)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(updates, 'nothing may be written on a refused close').toEqual([]);
  });

  it('an AWARDED request cannot be closed - that would erase who won', async () => {
    const { db, updates } = makeDb({ rfqStatus: 'awarded' });
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(close(OWNER)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(updates).toEqual([]);
  });

  it('a CLOSED request cannot be closed again', async () => {
    // Idempotency by refusal rather than by silent success: a second close
    // would emit a second round of "request withdrawn" notifications.
    const { db, updates } = makeDb({ rfqStatus: 'closed' });
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(close(OWNER)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(updates).toEqual([]);
  });
});

describe('the machine is closed against the other two doors', () => {
  const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
  const WORKFLOW = readFileSync(new URL('./quotationWorkflow.ts', import.meta.url), 'utf8');

  it('submitQuotation refuses any RFQ that is not open', () => {
    // So closing a request stops new bids without submitQuotation needing to
    // learn about the new state at all.
    const start = ROUTERS.indexOf('  submitQuotation: approvedProviderProcedure');
    const body = ROUTERS.slice(start, start + 3000);
    expect(body).toContain("rfq.status !== 'open'");
  });

  it('acceptQuotationSecure refuses any RFQ that is not open', () => {
    const start = WORKFLOW.indexOf('export async function acceptQuotationSecure');
    const body = WORKFLOW.slice(start, WORKFLOW.indexOf('export async function', start + 10));
    expect(body).toContain("rfq.status !== 'open'");
  });

  it('every write to rfqs.status lives in quotationWorkflow.ts', () => {
    // One module owns the machine. A status write appearing anywhere else is
    // a second implementation of the rules, which is how they drift apart.
    const offenders: string[] = [];
    for (const file of ['./routers.ts', './db.ts', './opportunity.ts']) {
      let source = '';
      try { source = readFileSync(new URL(file, import.meta.url), 'utf8'); } catch { continue; }
      if (/update\(rfqs\)\s*\.set\(\s*\{[^}]*status/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('the close path takes the row lock before it reads anything off it', () => {
    // A close racing an accept must serialize. Without FOR UPDATE an RFQ could
    // be awarded and closed in the same instant.
    const start = WORKFLOW.indexOf('export async function closeRfqSecure');
    const body = WORKFLOW.slice(start);
    const select = body.indexOf('.for(\'update\')');
    const update = body.indexOf('update(rfqs)');
    expect(select).toBeGreaterThan(-1);
    expect(select, 'the lock must come before the write').toBeLessThan(update);
  });

  it('it records an audit event naming the transition', () => {
    const start = WORKFLOW.indexOf('export async function closeRfqSecure');
    const body = WORKFLOW.slice(start);
    expect(body).toContain("action: 'rfq_closed'");
    expect(body).toContain('open -> closed');
  });
});

describe('the control is reachable by a person, not only by the API', () => {
  const PAGE = readFileSync(new URL('../client/src/pages/RFQDetail.tsx', import.meta.url), 'utf8');

  it('the owner is offered it on their own request', () => {
    expect(PAGE).toContain('data-testid="rfq-detail-close"');
    expect(PAGE).toMatch(/isOwner && isOpen/);
  });

  it('it actually calls the mutation, rather than being a decorative button', () => {
    expect(PAGE).toMatch(/onClick=\{\(\) => closeMutation\.mutate\(\{ id: rfqId \}\)\}/);
  });

  it('and it is not offered once the request is no longer open', () => {
    // `isOpen` is derived from the status the server returned, so an awarded or
    // already-closed request shows no withdraw control.
    const at = PAGE.indexOf('data-testid="rfq-detail-close-panel"');
    expect(at).toBeGreaterThan(-1);
    const guard = PAGE.slice(Math.max(0, at - 400), at);
    expect(guard).toMatch(/isOwner && isOpen/);
  });
});
