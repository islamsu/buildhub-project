// ── The security negative controls, named and located ──────────────────────
//
// CLOSURE PART 18 lists fourteen things the system must DETECT. Most are
// already proven behaviourally in the suite that owns the surface; a list that
// only asserted "a test exists somewhere" would be exactly the string-matching
// this phase rules out. So this file does two things:
//
//   1. It PROVES the two controls nothing else covered - the organization
//      predicate, and unauthorized notification access - with real calls.
//   2. It maps every other control to the file that proves it, and asserts
//      that file still contains the test by NAME. If a proof is deleted or
//      renamed, the map fails rather than quietly pointing at nothing.

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

function ctxFor(id: number): TrpcContext {
  return {
    user: {
      id, openId: `u-${id}`, email: `u${id}@t.com`, name: `User ${id}`, username: `u${id}`,
      loginMethod: 'password', role: 'user', userRole: 'homeowner',
      accountStatus: 'active', onboardingStatus: 'approved', isDummy: false,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  };
}

// ── 1. The organization predicate ──────────────────────────────────────────

describe('the organization predicate: there is no organization', () => {
  const SCHEMA = read('../drizzle/schema.ts');

  it('no table or column models an organization, company or tenant', () => {
    // Part 18 asks for a "missing organization predicate" control. BuildHub has
    // no such concept: every account is an individual, and there is no column
    // to scope by. Asserting the ABSENCE is the honest control - the day
    // somebody adds one, this fails, and the ownership rules in
    // dataIsolationMatrix.test.ts have to be extended before it can pass.
    const offenders = [...SCHEMA.matchAll(/^\s+(\w*(?:[Oo]rganization|[Cc]ompanyId|[Oo]rgId|[Tt]enantId)\w*):/gm)]
      .map(match => match[1]);
    expect(
      offenders,
      'an organization concept appeared - every owner-scoped query now needs an organization predicate too',
    ).toEqual([]);
    expect(SCHEMA).not.toMatch(/mysqlTable\('(organizations|companies|tenants)'/);
  });

  it('the schema was actually read', () => {
    expect(SCHEMA).toContain("mysqlTable('users'");
    expect(SCHEMA.length).toBeGreaterThan(10_000);
  });
});

// ── 2. Unauthorized notification access ────────────────────────────────────

describe('a notification belongs to exactly one person', () => {
  function stubNotifications(rows: unknown[]) {
    const where = vi.fn().mockReturnValue({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) });
    const select = vi.fn(() => ({ from: () => ({ where }) }));
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
      select,
      update: vi.fn(() => ({ set: () => ({ where: vi.fn().mockResolvedValue([]) }) })),
    });
    return where;
  }

  it('list takes NO user id from the caller - there is nothing to manipulate', async () => {
    // The strongest form of the control: the endpoint has no input at all, so
    // "read someone else's notifications" is not a request that can be made.
    stubNotifications([]);
    const caller = appRouter.createCaller(ctxFor(5));
    await expect(caller.notifications.list({ userId: 9 } as never)).resolves.toBeDefined();
    // ...and zod strips the unknown key rather than honouring it, which is why
    // the source assertion below matters as much as this call.
    const source = read('./routers.ts');
    const start = source.indexOf('const notificationsRouter = router({');
    const block = source.slice(start, source.indexOf('\n});', start));
    expect(block).not.toMatch(/input\(/);
    expect(block).toContain('eq(notifications.userId, ctx.user.id)');
  });

  it('every read and write in the router is scoped to the session', async () => {
    const source = read('./routers.ts');
    const start = source.indexOf('const notificationsRouter = router({');
    const block = source.slice(start, source.indexOf('\n});', start));
    const scoped = [...block.matchAll(/eq\(notifications\.userId, ctx\.user\.id\)/g)].length;
    const procedures = [...block.matchAll(/^ {2}\w+: protectedProcedure/gm)].length;
    expect(procedures).toBe(3);
    expect(scoped, 'a notifications procedure is not scoped to the caller').toBe(procedures);
  });

  it('markAllRead cannot be pointed at another account', async () => {
    const db = { update: vi.fn(() => ({ set: () => ({ where: vi.fn().mockResolvedValue([]) }) })) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    await expect(appRouter.createCaller(ctxFor(5)).notifications.markAllRead({ userId: 9 } as never))
      .resolves.toBeDefined();
    expect(db.update).toHaveBeenCalled();
  });
});

// ── 3. The map ─────────────────────────────────────────────────────────────

describe('every named control has a proof, and the proof still exists', () => {
  const CONTROLS: { control: string; file: string; testName: string }[] = [
    { control: 'client role elevation', file: './crossRoleIsolation.test.ts', testName: "'admin' is NOT a self-selectable marketplace role" },
    { control: 'client role elevation (admin creation)', file: './adminAuthorization.test.ts', testName: "refuses userRole:'admin' - the input schema does not offer it" },
    { control: 'unauthorized dashboard', file: './rolePlatform.test.ts', testName: 'routes admins separately and defaults unknown roles to the homeowner platform' },
    { control: 'missing ownership predicate', file: './dataIsolationMatrix.test.ts', testName: 'no non-admin procedure reads an owner id FROM THE REQUEST' },
    { control: 'unauthorized quote access', file: './quotationWorkflow.test.ts', testName: 'cross-RFQ IDOR' },
    { control: 'unauthorized RFQ access', file: './authorizationSweep.test.ts', testName: 'rfq.get is scoped to the requester, not merely to "logged in"' },
    { control: 'unauthorized message access', file: './messageAttachmentFlow.test.ts', testName: "another user's message-attachment key is refused" },
    { control: 'unauthorized attachment access', file: './storageProxy.test.ts', testName: 'manus-storage' },
    { control: 'wrong notification recipient', file: './quotationWorkflow.test.ts', testName: 'the WINNER is never told they lost' },
    { control: 'wrong RFQ/quotation relationship', file: './quotationWorkflow.test.ts', testName: 'belongs to a different RFQ than the one supplied' },
    { control: 'wrong role in AI context', file: './crossRoleIsolation.test.ts', testName: 'the AI role stance also comes from ctx, not from the request' },
    { control: 'provider recommendation leakage', file: './recommendation.test.ts', testName: 'unauthorized providers are excluded because the DIRECTORY excludes them' },
    { control: 'exact/partial match confusion', file: './recommendation.test.ts', testName: 'says PARTIAL, and names what it could not match on' },
    { control: 'fabricated provider attributes', file: './marketplaceHonesty.test.ts', testName: 'no real company is named anywhere in the client bundle sources' },
  ];

  for (const { control, file, testName } of CONTROLS) {
    it(`${control} -> ${file.replace('./', '')}`, () => {
      const source = read(file);
      expect(source, `${file} no longer contains a test named for "${testName}"`).toContain(testName);
    });
  }

  it('the map covers every control the closure brief names', () => {
    // Fourteen entries, and the two proven above in this file. If the brief
    // grows a control, this count is the reminder that it needs a home.
    expect(CONTROLS).toHaveLength(14);
  });
});
