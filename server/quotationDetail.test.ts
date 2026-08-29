// ── A quotation is a record, and a record has a page ───────────────────────
//
// Before rfq.quotation existed, a quotation could not be opened. It was
// a row inside RFQDetail for the customer and a tile in the supplier's
// workspace; it had no URL, so it could not be linked, bookmarked, or reached
// from the notification announcing it. "Supplier X responded to your RFQ" led
// to a list.
//
// The interesting part is not that the page exists, it is WHO MAY READ IT.
// Quotation ids are sequential. A supplier who bids on an RFQ holds a
// legitimate id; the rival bid on the same RFQ sits one integer away, and it
// carries the competitor's exact price, timeline and terms. That is the attack
// this file is really about, and it is the one a "does the page load" test
// would never see.
//
// ON THE DOUBLE. The db double below returns rows keyed by which TABLE was
// queried, not "the next configured value". An earlier test in this repository
// asserted "exactly one message stored" against a double that could not tell
// tables apart, so it really asserted "exactly one row stored" and passed while
// the wrong table was written. Identity comparison against the imported table
// objects is what stops that recurring here.

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
import { quotations, users } from '../drizzle/schema';
import type { TrpcContext } from './_core/context';

const REQUESTER = 501;
const AUTHOR = 502;
const RIVAL = 503;
const STRANGER = 504;

/** The row the joined quotation+rfq select yields. */
const QUOTATION_ROW = {
  id: 9001,
  rfqId: 77,
  providerId: AUTHOR,
  price: '125000.00',
  currency: 'EGP',
  timeline: 45,
  warranty: '12 months',
  paymentTerms: '50% advance',
  notes: 'Includes delivery to site.',
  attachments: null,
  status: 'pending' as const,
  createdAt: new Date('2026-08-01T10:00:00Z'),
  rfqTitle: 'Villa finishing package',
  rfqStatus: 'open' as const,
  rfqCategory: 'finishing',
  rfqRequesterId: REQUESTER,
};

const PROVIDER_ROW = {
  id: AUTHOR,
  name: 'Nile Finishing Co.',
  verified: true,
  location: 'Cairo',
  email: 'sales@nilefinishing.example',
};

/**
 * A db double that answers by table identity. `tablesQueried` is asserted in
 * its own test so a future refactor that reads a different table cannot pass
 * by accident.
 */
function makeDb(options: { quotationRows?: unknown[]; providerRows?: unknown[] } = {}) {
  const tablesQueried: unknown[] = [];
  const db = {
    select: () => ({
      from: (table: unknown) => {
        tablesQueried.push(table);
        const rows =
          table === quotations ? (options.quotationRows ?? [QUOTATION_ROW])
          : table === users ? (options.providerRows ?? [PROVIDER_ROW])
          : [];
        const chain = {
          leftJoin: () => chain,
          where: () => Promise.resolve(rows),
        };
        return chain;
      },
    }),
  };
  return { db, tablesQueried };
}

function ctxFor(id: number, userRole = 'homeowner'): TrpcContext {
  return {
    user: {
      id,
      openId: `open-${id}`,
      email: `user${id}@example.com`,
      name: `User ${id}`,
      loginMethod: 'test',
      role: 'user',
      adminRole: null,
      userRole,
      accountStatus: 'active',
      isDummy: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { clearCookie: vi.fn(), cookie: vi.fn() } as unknown as TrpcContext['res'],
  } as TrpcContext;
}

const call = (viewer: number, role = 'homeowner', id = 9001) =>
  appRouter.createCaller(ctxFor(viewer, role)).rfq.quotation({ id });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockResolvedValue(makeDb().db as never);
});

describe('who may open a quotation', () => {
  it('the RFQ requester can - it is a bid addressed to them', async () => {
    const result = await call(REQUESTER);
    expect(result.id).toBe(9001);
    expect(result.viewerRole).toBe('requester');
  });

  it('the supplier who wrote it can', async () => {
    const result = await call(AUTHOR, 'supplier');
    expect(result.id).toBe(9001);
    expect(result.viewerRole).toBe('author');
  });

  it('A RIVAL SUPPLIER WHO BID ON THE SAME RFQ CANNOT', async () => {
    // The whole point. The rival holds a valid quotation id from their own bid
    // and the competitor's is adjacent. Reading it would hand over the exact
    // price they are bidding against.
    await expect(call(RIVAL, 'supplier')).rejects.toThrow(/not found/i);
  });

  it('an unrelated authenticated user cannot', async () => {
    await expect(call(STRANGER)).rejects.toThrow(/not found/i);
  });

  it('an anonymous caller cannot - it is a protected procedure', async () => {
    const anonymous = {
      user: null,
      req: { protocol: 'https', headers: {} },
      res: { clearCookie: vi.fn(), cookie: vi.fn() },
    } as unknown as TrpcContext;
    await expect(
      appRouter.createCaller(anonymous).rfq.quotation({ id: 9001 }),
    ).rejects.toThrow();
  });
});

describe('the refusal does not leak that the record exists', () => {
  it('an unauthorized reader gets NOT_FOUND, not FORBIDDEN', async () => {
    // FORBIDDEN would confirm "a bid with this id exists and is not yours",
    // which tells a rival that a competing bid was placed - the very
    // competitive intelligence the ownership check protects.
    await expect(call(RIVAL, 'supplier')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('and a genuinely missing quotation is indistinguishable from a forbidden one', async () => {
    vi.mocked(getDb).mockResolvedValue(makeDb({ quotationRows: [] }).db as never);
    await expect(call(REQUESTER)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('the two readers do not see the same thing', () => {
  it('the requester gets the supplier contact address', async () => {
    const result = await call(REQUESTER);
    expect(result.provider?.email).toBe('sales@nilefinishing.example');
  });

  it('the supplier reading their OWN bid gets no customer contact route', async () => {
    // A supplier already knows their own address; what they must not gain from
    // this page is a channel to the customer that the product did not grant.
    const result = await call(AUTHOR, 'supplier');
    expect(result.provider?.email).toBeNull();
  });

  it('neither reader receives the requester id', async () => {
    // It is used for the authorization decision and then dropped. Returning it
    // would hand a supplier the customer's user id, which is the input to every
    // id-taking procedure in the API.
    for (const [viewer, role] of [[REQUESTER, 'homeowner'], [AUTHOR, 'supplier']] as const) {
      const result = await call(viewer, role);
      expect(result).not.toHaveProperty('rfqRequesterId');
    }
  });
});

describe('the double is answering honestly', () => {
  it('reads the quotations table and the users table, in that order', async () => {
    const { db, tablesQueried } = makeDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    await call(REQUESTER);
    expect(tablesQueried).toEqual([quotations, users]);
  });

  it('a caller refused by ownership never reaches the users table', async () => {
    // Proves the check runs BEFORE the provider lookup rather than filtering
    // the answer afterwards.
    const { db, tablesQueried } = makeDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(call(RIVAL, 'supplier')).rejects.toThrow();
    expect(tablesQueried).toEqual([quotations]);
  });
});

describe('the selected columns are an allowlist', () => {
  // A db double returns whatever it is handed, so it cannot exercise the
  // select list. This reads the procedure instead - the one thing a double
  // structurally cannot check.
  const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
  const start = ROUTERS.indexOf('  quotation: protectedProcedure');
  const body = ROUTERS.slice(start, ROUTERS.indexOf('  submitQuotation:', start));

  it('the procedure exists and is protected', () => {
    expect(start).toBeGreaterThan(-1);
  });

  it('selects named columns, never a bare select()', () => {
    expect(body).not.toMatch(/\.select\(\)\s*\.from\(quotations\)/);
  });

  it('never reads a credential or session column from users', () => {
    for (const forbidden of [
      'passwordHash', 'passwordResetToken', 'sessionsInvalidBefore',
      'openId', 'adminRole', 'testLoginToken',
    ]) {
      expect(body, `quotation detail selects users.${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the ownership predicate names both permitted readers and nothing else', () => {
    expect(body).toMatch(/rfqRequesterId === ctx\.user\.id/);
    expect(body).toMatch(/providerId === ctx\.user\.id/);
    expect(body).toMatch(/if \(!isRequester && !isAuthor\)/);
  });
});
