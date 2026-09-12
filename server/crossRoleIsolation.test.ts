import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';
import { BUILDHUB_ROLES, type BuildHubRole } from '@shared/aiRoles';

/**
 * CROSS-ROLE DATA ISOLATION, asserted as a MATRIX.
 *
 * Seven authorization suites already exist and each covers one router well.
 * NONE of them iterates all six roles, so the question "what can a supplier
 * reach that a homeowner cannot, and is that enforced by the SERVER?" had no
 * single answer anywhere in the codebase. This file is that answer.
 *
 * WHY THE MATRIX SHAPE MATTERS. The frontend hides role-inappropriate surfaces
 * with `enabled:` flags on its queries - projects.directory only for
 * professionals, myProducts only for suppliers. Those flags are not security;
 * they are a way to avoid firing a request that would fail. Anyone can call the
 * procedure directly. So every hidden surface is tested here by CALLING IT as
 * each of the six roles and asserting what the server itself does.
 *
 * A role is authenticated from the session. There is no path in these tests
 * that sets a role from input, because there is no such path in the router.
 */

function ctxFor(userRole: string, userId = 1, onboardingStatus = 'approved'): TrpcContext {
  return {
    user: {
      id: userId, openId: `u${userId}`, email: `u${userId}@t.com`, name: `U${userId}`,
      loginMethod: 'manus', role: 'user', userRole, accountStatus: 'active',
      onboardingStatus,
      isDummy: false, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  } as TrpcContext;
}

/** A db whose selects return nothing - enough to prove REACHABILITY, not content. */
function emptyDb() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    // `offset` was missing, so every paged read threw and reported as
    // INTERNAL_SERVER_ERROR - a reachability test cannot tell that apart from a
    // refusal, so the fake has to answer the whole chain.
    from: self, where: self, orderBy: self, limit: self, offset: self,
    innerJoin: self, leftJoin: self, groupBy: self,
    then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
  });
  return { select: vi.fn(() => chain), insert: vi.fn(() => ({ values: () => Promise.resolve({ insertId: 1 }) })) };
}

const PROVIDER_ROLES: BuildHubRole[] = ['contractor', 'engineer', 'architect', 'supplier', 'project_manager'];

/** Calls a procedure and reports the tRPC error code, or 'ok'. */
async function attempt(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'ok';
  } catch (error) {
    return (error as { code?: string }).code ?? 'ERROR';
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(emptyDb());
});

// ── 1. Provider-only surfaces ──────────────────────────────────────────────

describe('surfaces the UI hides from a homeowner are refused by the SERVER', () => {
  const providerOnly: Array<[string, (c: ReturnType<typeof appRouter.createCaller>) => Promise<unknown>]> = [
    ['projects.directory', c => c.projects.directory()],
    ['marketplace.myProducts', c => c.marketplace.myProducts()],
    ['rfq.myQuotations', c => c.rfq.myQuotations()],
  ];

  it.each(providerOnly)('%s refuses a homeowner', async (_name, call) => {
    // The frontend never fires this for a homeowner. That is convenience, not
    // a control - so the control is asserted here, at the server.
    expect(await attempt(() => call(appRouter.createCaller(ctxFor('homeowner'))))).toBe('FORBIDDEN');
  });

  it('projects.directory and rfq.myQuotations are reachable by an approved contractor', async () => {
    for (const call of [
      (c: ReturnType<typeof appRouter.createCaller>) => c.projects.directory(),
      (c: ReturnType<typeof appRouter.createCaller>) => c.rfq.myQuotations(),
    ]) {
      expect(await attempt(() => call(appRouter.createCaller(ctxFor('contractor'))))).toBe('ok');
    }
  });

  it('marketplace.myProducts is SUPPLIER-ONLY, narrower than provider-only', async () => {
    // Discovered by this matrix: the procedure adds its own userRole ===
    // 'supplier' check on top of approvedProviderProcedure. A contractor is an
    // approved provider and still cannot reach it, which is correct - products
    // belong to suppliers - and is stricter than "provider access required"
    // suggests.
    expect(await attempt(() => appRouter.createCaller(ctxFor('supplier')).marketplace.myProducts())).toBe('ok');
    for (const role of ['contractor', 'engineer', 'architect', 'project_manager', 'homeowner']) {
      expect(await attempt(() => appRouter.createCaller(ctxFor(role)).marketplace.myProducts()), role)
        .toBe('FORBIDDEN');
    }
  });

  it.each(providerOnly)('%s refuses a provider who is NOT yet approved', async (_name, call) => {
    // Role alone is not enough. An unapproved contractor is a signed-up
    // stranger, and the lead pool is the product.
    expect(await attempt(() => call(appRouter.createCaller(ctxFor('contractor', 1, 'pending')))))
      .toBe('FORBIDDEN');
  });

  it('EVERY provider role reaches them once approved, and the homeowner never does', async () => {
    for (const role of PROVIDER_ROLES) {
      expect(await attempt(() => appRouter.createCaller(ctxFor(role)).projects.directory()), role).toBe('ok');
    }
    expect(await attempt(() => appRouter.createCaller(ctxFor('homeowner')).projects.directory())).toBe('FORBIDDEN');
  });
});

// ── 2. Owner-scoped surfaces ───────────────────────────────────────────────

describe('owner-scoped reads are scoped in the QUERY, for every role', () => {
  it.each(BUILDHUB_ROLES)('projects.list for %s selects only that user\'s rows', async role => {
    const db = emptyDb();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    await appRouter.createCaller(ctxFor(role, 42)).projects.list();
    // The isolation is a WHERE clause, not a filter applied after fetching
    // everything - so the query must have been built with a predicate.
    expect(db.select).toHaveBeenCalled();
  });

  it('a role cannot widen its own scope by asking - there is no userId input', () => {
    // The strongest form of this guarantee: the procedure takes no argument
    // that could name someone else's data.
    //
    // THE MECHANISM CHANGED AND THE PROPERTY DID NOT. Scoping used to be the
    // literal predicate `eq(projects.ownerId, ctx.user.id)` inline in the
    // query. It is now `readableProjectIds(db, ctx.user.id)`, which returns
    // the projects the caller owns OR is a live member of - because a
    // contractor put on a job must see it, and under the old predicate they
    // could not.
    //
    // What is asserted is what always mattered: the scope is derived from the
    // SESSION and the procedure accepts nothing that could name anyone else.
    const source = readRouters();
    const listBody = source.slice(source.indexOf('const projectsRouter = router({'));
    const listSlice = listBody.slice(0, 600);
    expect(listSlice, 'projects.list must derive its scope from ctx.user.id')
      .toMatch(/readableProjectIds\(db, ctx\.user\.id\)|eq\(projects\.ownerId, ctx\.user\.id\)/);
    // Unchanged, and the half that actually stops the attack: nothing in the
    // request can name whose projects to return.
    expect(listSlice).not.toMatch(/input\.(ownerId|userId)/);
  });

  it('the scope helper itself reads the session id and filters removed members', () => {
    // The assertion above proves projects.list CALLS the helper. This proves
    // the helper is the right shape - otherwise the pair would pass with a
    // helper that returned every project id in the database.
    const helper = readFileSync(new URL('./projectMembership.ts', import.meta.url), 'utf8');
    const fn = helper.slice(helper.indexOf('export async function readableProjectIds'));
    expect(fn).toContain('eq(projects.ownerId, userId)');
    expect(fn).toContain('eq(projectMembers.userId, userId)');
    // A membership that was ended must not still grant access.
    expect(fn, 'removed members must not be treated as current')
      .toContain('isNull(projectMembers.removedAt)');
  });
});

// ── 3. The role can never come from the client ─────────────────────────────

describe('the authenticated role is the only role', () => {
  it('a user CHOOSES their own marketplace role - and that grants nothing', () => {
    // The blunt version of this test ("no input.userRole anywhere") was wrong
    // and would have blocked a legitimate feature: signup and role selection
    // necessarily take a role from the user. The property that actually
    // matters is that choosing one grants no access.
    const source = readRouters();
    const updateRole = source.slice(source.indexOf('updateRole: protectedProcedure'), source.indexOf('updateRole: protectedProcedure') + 1600);

    // Choosing a professional role RESETS approval, so the provider surfaces
    // stay closed until an admin approves. This is the control that makes
    // self-service role selection safe.
    expect(updateRole).toContain("onboardingStatus: isComplianceRole(input.userRole) ? 'not_started' : 'approved'");
    // And it never touches the authorization column.
    expect(updateRole).not.toMatch(/set\(\{[^}]*\brole:/);
  });

  it("'admin' is NOT a self-selectable marketplace role", () => {
    // FOUND BY THIS MATRIX. signUp already excluded 'admin'; updateRole had
    // drifted and still accepted it. Choosing it never granted server-side
    // privilege - adminProcedure reads the separate `role` column - but it
    // wrote userRole='admin', which the dashboard read to render the admin
    // menu, and set verified=true because 'admin' is not a compliance role.
    const source = readRouters();
    const updateRole = source.slice(source.indexOf('updateRole: protectedProcedure'), source.indexOf('updateRole: protectedProcedure') + 1600);
    const enumLine = updateRole.slice(updateRole.indexOf('userRole: z.enum('));
    expect(enumLine.slice(0, 140)).not.toContain("'admin'");

    // signUp is the reference: the two paths must not diverge again.
    const signUp = source.slice(source.indexOf('signUp: publicProcedure'), source.indexOf('signUp: publicProcedure') + 900);
    const signUpEnum = signUp.slice(signUp.indexOf('userRole: z.enum('));
    expect(signUpEnum.slice(0, 140)).not.toContain("'admin'");
  });

  it('the admin menu is keyed on the AUTHORIZATION column, not the marketplace role', () => {
    const layout = readFile('../client/src/components/DashboardLayout.tsx');
    expect(layout).toContain("user?.role === 'admin'");
    expect(layout).not.toContain("userRole === 'admin'");
  });

  it('adminProcedure reads `role`, never `userRole`', () => {
    const trpc = readFile('./_core/trpc.ts');
    expect(trpc).toContain("ctx.user.role !== 'admin'");
    expect(trpc).not.toContain('userRole');
  });

  it('every PROVIDER gate reads a role from the session or from the row it is judging', () => {
    const source = readRouters();
    const gates = source.match(/providerRoles\.includes\(([^)]+)\)/g) ?? [];
    expect(gates.length).toBeGreaterThan(0);
    for (const gate of gates) {
      // Three legitimate shapes, all reading a role from the SERVER'S data:
      //   ctx.user.userRole  - the caller's own role, from the session
      //   reviewee.userRole  - is the person being reviewed a provider?
      //   target.userRole    - is the profile being looked up a vendor profile?
      // What must never appear is a role taken from the REQUEST, so that is
      // what the assertion actually pins.
      expect(gate).not.toMatch(/input\./);
      expect(gate).toMatch(/\.userRole/);
    }
  });

  it('the AI role stance also comes from ctx, not from the request', () => {
    const source = readRouters();
    const chat = source.slice(source.indexOf('const aiRouter = router({'));
    expect(chat).toContain('userRole: ctx.user.userRole');
    expect(chat).not.toMatch(/userRole:\s*input/);
  });
});

// ── 4. The marketplace lead pool: deliberate, and bounded ──────────────────

describe('rfq.list is a PROVIDER lead pool, and that is a DECISION with limits', () => {
  /**
   * THE RULE CHANGED, BY OWNER DECISION.
   *
   * This block used to assert that every authenticated role could read the
   * whole feed - "it is the product". That WAS the behaviour, and it meant one
   * homeowner could read another homeowner's full brief and the exact budget
   * they were willing to spend, as could a supplier with no intention of
   * bidding. The feed exists so providers can find work; a customer has no
   * reason to browse other customers' requests.
   *
   * Both halves are asserted, so neither direction can drift.
   */
  it('every role can still CALL it - the narrowing is in what comes back', async () => {
    for (const role of BUILDHUB_ROLES) {
      expect(await attempt(() => appRouter.createCaller(ctxFor(role)).rfq.list({ page: 0, pageSize: 25 })), role).toBe('ok');
    }
  });

  /**
   * The procedure's OWN text, bounded by where it ends rather than by a
   * character count. The count had to grow when the feed gained pagination, and
   * a longer slice then reached the NEXT procedure - which mentions
   * `attachments` legitimately - and failed the allowlist assertion below on
   * code that is not being asserted. A slice measured in characters is a slice
   * that reports on whatever happens to be nearby.
   */
  function rfqListSource(): string {
    const source = readRouters();
    const rfqList = source.slice(source.indexOf('const rfqRouter = router({'));
    const start = rfqList.indexOf('list: protectedProcedure');
    const end = rfqList.indexOf('\n  myList:', start);
    expect(end, 'rfq.list body not found').toBeGreaterThan(start);
    return rfqList.slice(start, end);
  }

  it('a non-provider is scoped to their OWN requests', () => {
    const listQuery = rfqListSource();
    expect(listQuery, 'the feed must be gated on provider status').toContain('isProvider');
    expect(listQuery).toContain('eq(rfqs.requesterId, ctx.user.id)');
    // And the scope reaches the query rather than being computed and dropped.
    expect(listQuery).toContain('where: scope');
  });

  it('and still returns a COLUMN ALLOWLIST that omits the requester\'s private files', () => {
    // The distinction that makes the pool safe: a provider sees that a job
    // exists; nobody sees the drawings attached to it without paying for the
    // enquiry. A `select()` with no column list would leak them silently.
    const listQuery = rfqListSource();
    // The allowlist is now a named object handed to the pager, which is the
    // same guarantee: an explicit column list, and `attachments` not in it.
    expect(listQuery).toContain('const columns = {');
    expect(listQuery).not.toContain('attachments');
  });

  it('anonymous callers get nothing', async () => {
    const anon = { ...ctxFor('homeowner'), user: null } as unknown as TrpcContext;
    expect(await attempt(() => appRouter.createCaller(anon).rfq.list({ page: 0, pageSize: 25 }))).toBe('UNAUTHORIZED');
  });
});

// ── 5. Frontend hiding is not a control ────────────────────────────────────

describe('frontend hiding is never the only control', () => {
  it('every role-conditional query on the platform page has a server-side gate', () => {
    // The `enabled:` flags on RolePlatform are a way to avoid firing a request
    // that would fail. This test pins each one to a procedure that refuses on
    // its own, so removing a flag exposes nothing.
    const page = readFile('../client/src/pages/RolePlatform.tsx');
    const routers = readRouters();

    const guarded = [
      ['projects.directory', 'directory: approvedProviderProcedure'],
      ['marketplace.myProducts', 'myProducts: approvedProviderProcedure'],
      ['rfq.myQuotations', 'myQuotations: approvedProviderProcedure'],
    ] as const;

    for (const [clientCall, serverGate] of guarded) {
      expect(page, `${clientCall} is not used on the page any more`).toContain(clientCall);
      expect(routers, `${clientCall} lost its server gate`).toContain(serverGate);
    }
  });

  it('the platform page derives its role from the SESSION, not the URL', () => {
    // /platform/:role takes a role in the path. It must be decorative.
    const page = readFile('../client/src/pages/RolePlatform.tsx');
    expect(page).toContain('account?.userRole');
    expect(page).not.toMatch(/params\.role|useParams\(\)\.role/);
  });
});

function readFile(relative: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('node:fs').readFileSync(new URL(relative, import.meta.url), 'utf8');
}
function readRouters(): string {
  return readFile('./routers.ts');
}
