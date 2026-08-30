// ── THE ENQUIRY RESPONSE AND ITS AUDIT LINE, PROVEN BY BEHAVIOUR ───────────
//
// Two rules used to be pinned by matching literal source text in
// enquiryDetailFlow.test.ts and commercialAudit.test.ts:
//
//   "the response contains `return { rfq: result.rfq`"
//   "the detail matches /rfq \$\{input\.rfqId\}, \$\{result\.alreadyConsumed/"
//
// Both rules are real and worth keeping. Both assertions were the wrong
// instrument, and adding the invitation branch is what exposed it: the
// BEHAVIOUR was unchanged - the RFQ is still returned, the RFQ id is still in
// the audit line - and the tests failed anyway, because the text moved.
//
// A test that dies on formatting proves nothing about the rule it names, and
// would equally have passed if the literal had been kept while the value was
// quietly wrong. So the rules are asserted here against what the procedure
// actually returns and actually records.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ getDb: vi.fn() }));
vi.mock('./billing/enquiries', async importOriginal => ({
  ...(await importOriginal<typeof import('./billing/enquiries')>()),
  openQualifiedEnquiry: vi.fn(),
  getEnquiryUsage: vi.fn(),
}));
vi.mock('./_core/commercialAudit', () => ({ recordCommercialEvent: vi.fn() }));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';
import { openQualifiedEnquiry } from './billing/enquiries';
import { recordCommercialEvent } from './_core/commercialAudit';

const RFQ = { id: 77, title: 'Rebar', requesterId: 900, category: 'Materials' };
const USAGE = { used: 3, allowance: 20, remaining: 17, periodKey: '2026-08', resetsAt: new Date('2026-09-01') };

function providerCtx(): TrpcContext {
  return {
    user: {
      id: 42, openId: 'user-42', email: 's@test.com', name: 'Supplier',
      loginMethod: 'dummy', role: 'user', adminRole: null,
      userRole: 'supplier', accountStatus: 'active', onboardingStatus: 'approved',
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: {} as TrpcContext['res'],
  };
}

const detailOf = () => String((vi.mocked(recordCommercialEvent).mock.calls[0]?.[1] as { detail?: string })?.detail ?? '');

describe('openEnquiry - the record the vendor gets back', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue({} as never);
  });

  it('a granted outcome RETURNS THE RFQ - the record they paid for, not just a receipt', async () => {
    vi.mocked(openQualifiedEnquiry).mockResolvedValue({
      outcome: 'granted', rfq: RFQ as never, alreadyConsumed: false, usage: USAGE as never, enquiryId: 11,
    });
    const result = await appRouter.createCaller(providerCtx()).rfq.openEnquiry({ rfqId: 77 });
    // The value, not the syntax that produced it.
    expect(result.rfq).toEqual(RFQ);
    expect(result.usage).toEqual(USAGE);
  });

  it('THE RFQ ID IS KEPT IN THE AUDIT LINE as context - a charge that cannot be traced to what was charged for is not a trail', async () => {
    vi.mocked(openQualifiedEnquiry).mockResolvedValue({
      outcome: 'granted', rfq: RFQ as never, alreadyConsumed: false, usage: USAGE as never, enquiryId: 11,
    });
    await appRouter.createCaller(providerCtx()).rfq.openEnquiry({ rfqId: 77 });
    expect(detailOf()).toContain('rfq 77');
  });

  it('subjectId names the ENQUIRY row, never the RFQ - the RFQ is context and lives in detail', async () => {
    vi.mocked(openQualifiedEnquiry).mockResolvedValue({
      outcome: 'granted', rfq: RFQ as never, alreadyConsumed: false, usage: USAGE as never, enquiryId: 11,
    });
    await appRouter.createCaller(providerCtx()).rfq.openEnquiry({ rfqId: 77 });
    expect(vi.mocked(recordCommercialEvent).mock.calls[0][1]).toMatchObject({
      subjectType: 'enquiry', subjectId: 11,
    });
  });
});

describe('the audit line distinguishes THREE outcomes, because they are three different commercial facts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue({} as never);
  });

  it('a FRESH open says a credit was charged', async () => {
    vi.mocked(openQualifiedEnquiry).mockResolvedValue({
      outcome: 'granted', rfq: RFQ as never, alreadyConsumed: false, usage: USAGE as never, enquiryId: 11,
    });
    await appRouter.createCaller(providerCtx()).rfq.openEnquiry({ rfqId: 77 });
    expect(detailOf()).toContain('credit charged');
    expect(detailOf()).not.toContain('invitation');
  });

  it('a RE-OPEN says no credit was charged', async () => {
    vi.mocked(openQualifiedEnquiry).mockResolvedValue({
      outcome: 'granted', rfq: RFQ as never, alreadyConsumed: true, usage: USAGE as never, enquiryId: 11,
    });
    await appRouter.createCaller(providerCtx()).rfq.openEnquiry({ rfqId: 77 });
    expect(detailOf()).toContain('no credit charged');
  });

  it('AN INVITED OPEN SAYS IT WAS EXEMPT, and must never claim a credit was charged', async () => {
    vi.mocked(openQualifiedEnquiry).mockResolvedValue({
      outcome: 'granted', rfq: RFQ as never, alreadyConsumed: false, byInvitation: true,
      usage: USAGE as never, enquiryId: null,
    });
    await appRouter.createCaller(providerCtx()).rfq.openEnquiry({ rfqId: 77 });

    // Before the invitation branch existed this fell through to the
    // alreadyConsumed ternary and recorded "credit charged" - an audit line
    // asserting a charge that did not happen, against a qualifiedEnquiries row
    // that does not exist to point at.
    expect(detailOf()).toContain('exempt');
    expect(detailOf()).not.toContain('credit charged');
    expect(detailOf()).toContain('rfq 77');
  });

  it('the response tells the supplier the open was free, so the UI does not imply a charge they cannot find', async () => {
    vi.mocked(openQualifiedEnquiry).mockResolvedValue({
      outcome: 'granted', rfq: RFQ as never, alreadyConsumed: false, byInvitation: true,
      usage: USAGE as never, enquiryId: null,
    });
    const result = await appRouter.createCaller(providerCtx()).rfq.openEnquiry({ rfqId: 77 });
    expect(result.byInvitation).toBe(true);
  });

  it('an ordinary open is not mislabelled as an invitation', async () => {
    vi.mocked(openQualifiedEnquiry).mockResolvedValue({
      outcome: 'granted', rfq: RFQ as never, alreadyConsumed: false, usage: USAGE as never, enquiryId: 11,
    });
    const result = await appRouter.createCaller(providerCtx()).rfq.openEnquiry({ rfqId: 77 });
    expect(result.byInvitation).toBe(false);
  });
});
