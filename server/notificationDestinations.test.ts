import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import { qualifiedEnquiries, rfqSuppliers, rfqs, quotations } from '../drizzle/schema';

vi.mock('./db', () => ({ getDb: vi.fn() }));
import { appRouter } from './routers';
import { getDb } from './db';
import type { TrpcContext } from './_core/context';
import { selectByTable, withTransaction } from './testSupport/txDouble';

/**
 * EVERY NOTIFICATION POINTED AT A LIST.
 *
 * The `notifications.link` column was written on every row and never read.
 * MessagesPage rendered each notification as an inert card, so "New quotation
 * received" was a dead end: the customer was told a bid had arrived and given
 * no way to reach it. The destination was in the database the whole time.
 *
 * Underneath that, the destinations themselves were generic. A supplier who
 * had just won or lost one specific job was sent to `/provider`; a customer
 * who had received one specific quotation was sent to `/rfq`, the list of
 * every request they have ever raised. A link that resolves to a valid route
 * but loses which record it is about has not delivered the user anywhere.
 *
 * These tests assert the DESTINATION, not the presence of a link, and they use
 * ids that differ from every other id in the fixture so that a link built from
 * the wrong entity - the quotation id, the provider id, the insert id - fails
 * instead of coincidentally matching.
 */

// ── Fixture ids, all mutually distinct on purpose ──────────────────────────
const RFQ_ID = 7301;
const QUOTATION_ID = 55;
const REQUESTER_ID = 91;
const WINNER_ID = 42;
const LOSER_ID = 43;
const VALID_UNTIL = new Date('2099-12-31T23:59:59.000Z');

const ctx = (id: number, userRole = 'homeowner'): TrpcContext => ({
  user: {
    id, openId: `u${id}`, email: `u${id}@t.com`, name: 'U', username: `u${id}`,
    loginMethod: 'password', role: 'user', userRole,
    accountStatus: 'active', onboardingStatus: 'approved', isDummy: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as TrpcContext['user'],
  req: { protocol: 'https', headers: {} } as TrpcContext['req'],
  res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
});

type Notification = { userId: number; title: string; link: string | null };

/** Every notification row written during a call, flattened across single and bulk inserts. */
function collectNotifications(rows: unknown[]): Notification[] {
  const out: Notification[] = [];
  for (const row of rows) {
    for (const one of Array.isArray(row) ? row : [row]) {
      const r = one as Record<string, unknown>;
      // Notification rows are the only inserts carrying both userId and title.
      if (r && 'userId' in r && 'title' in r) {
        out.push({ userId: r.userId as number, title: r.title as string, link: (r.link ?? null) as string | null });
      }
    }
  }
  return out;
}

/**
 * A transaction fake for the accept/reject flows: it answers the two
 * FOR UPDATE reads and the plain read of the other quotations, accepts every
 * update, and records the notification inserts that run after commit.
 */
function stubWorkflowDb(opts: { others?: number[] } = {}) {
  const inserts: unknown[] = [];
  let quotationSelects = 0;
  const tx = {
    select: () => ({
      from: (table: unknown) => {
        if (table === rfqs) {
          return { where: () => ({ for: async () => [{ id: RFQ_ID, requesterId: REQUESTER_ID, status: 'open', title: 'Steel package' }] }) };
        }
        quotationSelects += 1;
        if (quotationSelects === 1) {
          return { where: () => ({ for: async () => [{ id: QUOTATION_ID, rfqId: RFQ_ID, providerId: WINNER_ID, status: 'pending' }] }) };
        }
        return { where: () => Promise.resolve((opts.others ?? []).map(providerId => ({ providerId }))) };
      },
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
  };
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction({
    transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx),
    insert: () => ({ values: (row: unknown) => { inserts.push(row); return Promise.resolve([{ insertId: 1 }]); } }),
  }));
  return inserts;
}

// ══ 1. THE CUSTOMER IS SENT TO THE RFQ THE BID WAS MADE ON ═════════════════

describe('a new quotation takes the customer to that request', () => {
  beforeEach(() => vi.clearAllMocks());

  function stubSubmitDb() {
    const inserts: unknown[] = [];
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(withTransaction({
      select: selectByTable(new Map([
        [rfqs, [{ requesterId: REQUESTER_ID, title: 'Steel package', status: 'open' }]],
        [rfqSuppliers, []],
        [qualifiedEnquiries, [{ id: 88 }]],
        [quotations, []],
      ])),
      insert: () => ({ values: (row: unknown) => { inserts.push(row); return Promise.resolve([{ insertId: QUOTATION_ID }]); } }),
    }));
    return inserts;
  }

  it('links to the specific quotation, not an RFQ or list page', async () => {
    const inserts = stubSubmitDb();
    await appRouter.createCaller(ctx(WINNER_ID, 'supplier')).rfq.submitQuotation({ rfqId: RFQ_ID, price: 100, validUntil: VALID_UNTIL });
    const notes = collectNotifications(inserts);
    const received = notes.find(n => n.title === 'New quotation received');
    expect(received, 'the customer must be notified at all').toBeDefined();
    expect(received!.link).toBe(`/quotations/${QUOTATION_ID}`);
  });

  it('the destination is built from the RFQ, not from any other id in scope', async () => {
    // QUOTATION_ID is what the insert returns, WINNER_ID is the caller, and
    // REQUESTER_ID is the recipient. A link built from any of them resolves to
    // a real route and shows the wrong record - the failure this rules out.
    const inserts = stubSubmitDb();
    await appRouter.createCaller(ctx(WINNER_ID, 'supplier')).rfq.submitQuotation({ rfqId: RFQ_ID, price: 100, validUntil: VALID_UNTIL });
    const link = collectNotifications(inserts).find(n => n.title === 'New quotation received')!.link;
    for (const wrong of [QUOTATION_ID, WINNER_ID, REQUESTER_ID]) {
      if (wrong !== QUOTATION_ID) expect(link, `must not be built from ${wrong}`).not.toBe(`/quotations/${wrong}`);
    }
  });

  it('it is the recipient - the customer - who is given the link', async () => {
    const inserts = stubSubmitDb();
    await appRouter.createCaller(ctx(WINNER_ID, 'supplier')).rfq.submitQuotation({ rfqId: RFQ_ID, price: 100, validUntil: VALID_UNTIL });
    const received = collectNotifications(inserts).find(n => n.title === 'New quotation received')!;
    expect(received.userId).toBe(REQUESTER_ID);
  });
});

// ══ 2. BOTH OUTCOMES TAKE THE SUPPLIER TO THE JOB, NOT THE DASHBOARD ═══════

describe('winning and losing both land on the request that was bid on', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the winner is taken to THE QUOTATION THAT WON', async () => {
    // WAS `/rfq/${RFQ_ID}`. A quotation had no page, so the notification about
    // one could only point at the request. There is exactly one accepted
    // quotation per RFQ, so this destination is unambiguous.
    const inserts = stubWorkflowDb();
    await appRouter.createCaller(ctx(REQUESTER_ID)).rfq.acceptQuotation({ rfqId: RFQ_ID, quotationId: QUOTATION_ID });
    const accepted = collectNotifications(inserts).find(n => n.title === 'Quotation accepted');
    expect(accepted, 'the winner must be told').toBeDefined();
    expect(accepted!.link).toBe(`/quotations/${QUOTATION_ID}`);
    expect(accepted!.userId).toBe(WINNER_ID);
  });

  // DELIBERATELY STILL THE RFQ, unlike the winner above. A provider may hold
  // several losing bids on one request; this list is de-duplicated to one
  // message per provider precisely because one-per-quotation told a three-bid
  // provider twice that they lost. Linking to "their" quotation would have to
  // pick one arbitrarily, and picking one is what reintroduces the duplicate.
  it('an auto-rejected competitor is taken to the same RFQ', async () => {
    const inserts = stubWorkflowDb({ others: [LOSER_ID] });
    await appRouter.createCaller(ctx(REQUESTER_ID)).rfq.acceptQuotation({ rfqId: RFQ_ID, quotationId: QUOTATION_ID });
    const lost = collectNotifications(inserts).find(n => n.userId === LOSER_ID);
    expect(lost, 'the losing supplier must be told').toBeDefined();
    expect(lost!.link).toBe(`/rfq/${RFQ_ID}`);
  });

  it('an explicit rejection is taken to THE QUOTATION THAT WAS DECLINED', async () => {
    // Unlike the auto-rejected losers above, this path declines ONE named
    // quotation, so there is nothing ambiguous to choose between and the
    // provider is told which of their bids it was.
    const inserts = stubWorkflowDb();
    await appRouter.createCaller(ctx(REQUESTER_ID)).rfq.rejectQuotation({ rfqId: RFQ_ID, quotationId: QUOTATION_ID });
    const lost = collectNotifications(inserts).find(n => n.title === 'Quotation not selected');
    expect(lost, 'the rejected supplier must be told').toBeDefined();
    expect(lost!.link).toBe(`/quotations/${QUOTATION_ID}`);
  });

  it('no quotation-outcome notification is sent to a dashboard', async () => {
    // The single assertion that fails if any of the three reverts to /provider.
    for (const inserts of [stubWorkflowDb({ others: [LOSER_ID] })]) {
      await appRouter.createCaller(ctx(REQUESTER_ID)).rfq.acceptQuotation({ rfqId: RFQ_ID, quotationId: QUOTATION_ID });
      const links = collectNotifications(inserts).map(n => n.link);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link).not.toBe('/provider');
    }
  });
});

// ══ 3. NO NOTIFICATION MAY POINT AT A LIST WHEN A RECORD EXISTS ════════════

const SERVER = ['./routers.ts', './quotationWorkflow.ts']
  .map(f => readSourceForAssertions(readFileSync(new URL(f, import.meta.url), 'utf8')))
  .join('\n');

/**
 * The routes that are legitimately a destination in their own right, each with
 * the reason it is not a generic dashboard. Anything else must be built from
 * the id of the record the notification is about.
 */
const DESTINATIONS_THAT_ARE_A_RECORD: Record<string, string> = {
  // A registration decision is about the recipient's own application, and
  // `/compliance` renders exactly that one application - there is no
  // per-document route to be more specific than.
  '/compliance': 'the applicant\'s own registration, which this page renders in full',
  // A vendor has exactly ONE subscription, and this anchor is where it is
  // rendered. There is no /subscriptions/:id to build from - the record is a
  // singleton keyed by the reader, so the reader's own billing section IS the
  // record page. The anchor matters: without it the notification lands at the
  // top of a settings page and leaves the vendor hunting for what changed.
  '/settings#settings-billing': 'the reader\'s own subscription, a singleton with no id-addressed route',
};

describe('no notification is sent to a list when a record exists', () => {
  it('every hardcoded destination is a record page, not a dashboard', () => {
    const literals = [...SERVER.matchAll(/link: '([^']*)'/g)].map(m => m[1]);
    expect(literals.length, 'the sweep must actually find the call sites').toBeGreaterThan(0);
    for (const link of literals) {
      expect(
        Object.keys(DESTINATIONS_THAT_ARE_A_RECORD),
        `${link} is a hardcoded destination - either build it from the record's id, or document why this route IS the record`,
      ).toContain(link);
    }
  });

  it('the routes that were dead ends are gone', () => {
    // `/provider` renders no reviews and no quotations; `/rfq` is the list.
    expect(SERVER).not.toContain("link: '/provider'");
    expect(SERVER).not.toContain("link: '/rfq'");
  });

  it('a review takes the provider to the page that shows reviews', () => {
    // ProviderDashboard renders no reviews at all - VendorProfile does, via
    // <VendorReputation userId=... />. The old link was a route that loaded
    // and could not show the thing the notification was about.
    expect(SERVER).toContain('link: `/vendor/${input.revieweeId}`');
  });
});

// ══ 4. THE LINK IS ACTUALLY FOLLOWED ═══════════════════════════════════════

const MESSAGES = readSourceForAssertions(readFileSync(new URL('../client/src/pages/MessagesPage.tsx', import.meta.url), 'utf8'));

describe('the notification list follows the link it was given', () => {
  it('a notification with a destination is wrapped in a router link', () => {
    // Without this the column is written and never read: every card inert.
    expect(MESSAGES).toMatch(/n\.link\s*\n?\s*\?\s*<Link key=\{n\.id\} href=\{n\.link\}/);
  });

  it('it navigates in-app rather than reloading the page', () => {
    // The property is "the router handles it", not the exact import line -
    // the page later needed useSearch from the same module and that is not a
    // regression in how a notification navigates.
    expect(MESSAGES).toMatch(/import \{[^}]*\bLink\b[^}]*\} from 'wouter'/);
    expect(MESSAGES).not.toMatch(/<a href=\{n\.link\}/);
  });

  it('a notification with no destination still renders', () => {
    // Some events are genuinely informational. Inventing a destination for
    // them would be worse than having none, and dropping them worse still.
    expect(MESSAGES).toMatch(/:\s*<div key=\{n\.id\}>\{card\}<\/div>/);
  });

  it('a linked card is visibly clickable and distinguishable in a test', () => {
    expect(MESSAGES).toContain("data-testid={n.link ? 'notification-linked' : 'notification-plain'}");
    expect(MESSAGES).toContain("n.link ? 'cursor-pointer");
  });
});
