// ── FRONTEND VISIBILITY IS NOT AUTHORIZATION ──────────────────────────────
//
// A mutation that takes somebody's record id and writes to it has to prove the
// caller is entitled to that record. Hiding the button is not proof: the call
// is one fetch away for anybody who can read the network tab, and the id of
// the next record along is usually this one plus one.
//
// The sweep here is deliberately narrow, because a broad one is worse than
// none. It looks at non-admin mutations that BOTH take a record id AND write
// to the database, and asks whether the caller's own id is ever used as a
// PREDICATE rather than merely written down.
//
// THAT DISTINCTION IS THE WHOLE TEST. `ctx.user.id` appears in all thirty of
// them, and a sweep that stopped at "the mutation mentions the caller" would
// have reported thirty passes and proved nothing at all - stamping
// `uploaderId: ctx.user.id` onto a row in somebody else's project is exactly
// the defect, and it mentions the caller. So a mention only counts when it
// reaches a guard, a where clause or a comparison.
//
// Two rounds of false positives shaped the lists below, and both are worth
// keeping because a later reader will hit them again:
//
//   A GUARD CALLED WITH A NAMED OBJECT. requireDocumentAccess takes
//   `{ documentId, userId: ctx.user.id, capability }`, which is
//   indistinguishable from stamping if you only look for `key: ctx.user.id`.
//   replaceDocument is one of the better-guarded mutations in the router and
//   the first version of this reported it.
//
//   A CREATE THAT REFERENCES A CATEGORY. services.create takes a categoryId,
//   writes `providerId: ctx.user.id`, and has no prior record to be entitled
//   to - the caller can only ever create their own. "Takes an id" is not the
//   same as "acts on somebody's record".
//
// WHAT THIS DOES NOT CLAIM. Finding a guard call does not prove the guard is
// correct, or that it covers every path through the function. It proves the
// mutation asks the question at all. Whether requireProjectAccess answers it
// properly is asserted where that helper lives.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');

/**
 * Helpers that decide whether THIS caller may touch THAT record. Each one
 * takes the caller's id, positionally or as a named field.
 */
const GUARDS = [
  'requireProjectAccess', 'requireDocumentAccess', 'requireDisputeAccess',
  'requireTicketAccess', 'requireSubjectParty', 'requireOwnedService',
  'requireInviteRights',
];

/** The caller's id used to DECIDE something, rather than to fill a column. */
const PREDICATES = [
  /eq\([^()]*,\s*ctx\.user\.id\s*\)/,
  /ctx\.user\.id\s*(===|!==|==|!=)/,
  /(===|!==|==|!=)\s*ctx\.user\.id/,
  /inArray\([^()]*,\s*\[[^\]]*ctx\.user\.id/,
  /\.includes\(ctx\.user\.id\)/,
  /canRetireDocument\([^;]*ctx\.user\.id/,
];

/**
 * Mutations that take an id but act on nothing that belongs to anyone yet.
 * Each one creates a record owned by the caller; the id it takes points at a
 * catalogue entry, not at somebody's property. Listed by name with the reason,
 * so adding to this list is a deliberate act rather than a quiet exemption.
 */
const CREATES_ITS_OWN: Record<string, string> = {
  create: 'services.create - takes a categoryId and writes providerId: ctx.user.id; there is no prior record to be entitled to',
};

type Mutation = { name: string; guard: string; body: string; line: number };

function candidateMutations(): Mutation[] {
  const out: Mutation[] = [];
  const header = /^ {2}(\w+): (protectedProcedure|approvedProviderProcedure|complianceProcedure)/gm;
  const boundary = /^ {2}\w+: (publicProcedure|protectedProcedure|adminProcedure|superAdminProcedure|approvedProviderProcedure|complianceProcedure|adminWith\()/m;
  for (const match of ROUTERS.matchAll(header)) {
    const start = match.index ?? 0;
    const rest = ROUTERS.slice(start + 10);
    const next = boundary.exec(rest);
    const body = ROUTERS.slice(start, start + 10 + (next ? next.index : 6000));
    if (!body.includes('.mutation(')) continue;
    if (!/(\w*[Ii]d)\s*:\s*z\.(?:number|string)/.test(body)) continue;
    if (!/\bdb\.(update|insert|delete)\(/.test(body)) continue;
    out.push({
      name: match[1], guard: match[2], body,
      line: ROUTERS.slice(0, start).split('\n').length,
    });
  }
  return out;
}

const asksTheQuestion = (m: Mutation) =>
  GUARDS.some(g => new RegExp(`${g}\\s*\\([^;]{0,200}ctx\\.user\\.id`, 's').test(m.body))
  || PREDICATES.some(p => p.test(m.body));

describe('the sweep sees what it claims to sweep', () => {
  it('finds the mutations that take a record id and write', () => {
    // POSITIVE CONTROL. Concrete numbers, because a sweep that silently halves
    // its own scope passes every assertion below.
    const all = candidateMutations();
    expect(all.length).toBeGreaterThan(20);
    const names = all.map(m => m.name);
    expect(names).toContain('replaceDocument');
    expect(names).toContain('addMilestone');
  });

  it('every guard it recognises is a real function', () => {
    // A renamed guard must fail loudly here rather than quietly stop matching
    // and start reporting its callers as unguarded.
    for (const guard of GUARDS) {
      expect(ROUTERS.includes(`${guard}(`), `${guard} appears nowhere in the router`).toBe(true);
    }
  });

  it('stamping the caller onto a row does not count as asking', () => {
    // The defect this whole file exists for: a write into somebody else's
    // record that records the caller as its author.
    const stamped: Mutation = {
      name: 'x', guard: 'protectedProcedure', line: 0,
      body: `.mutation(async ({ ctx, input }) => { await db.insert(documents).values({ projectId: input.projectId, uploaderId: ctx.user.id }); })`,
    };
    expect(asksTheQuestion(stamped)).toBe(false);
  });

  it('a guard called with a named object does count', () => {
    const guarded: Mutation = {
      name: 'y', guard: 'protectedProcedure', line: 0,
      body: `.mutation(async ({ ctx, input }) => { await requireDocumentAccess(db, { documentId: input.documentId, userId: ctx.user.id, capability: 'report' }); })`,
    };
    expect(asksTheQuestion(guarded)).toBe(true);
  });
});

describe('every mutation that writes to a record proves the caller may', () => {
  it('none of them writes on the id alone', () => {
    const unproven = candidateMutations()
      .filter(m => !asksTheQuestion(m))
      .filter(m => !(m.name in CREATES_ITS_OWN))
      .map(m => `routers.ts:${m.line} ${m.name} (${m.guard})`);
    expect(unproven, `these write to a record named by the caller without proving the caller may:\n  ${unproven.join('\n  ')}`)
      .toEqual([]);
  });

  it('the exemptions are still exempt for the reason given', () => {
    // An exemption that stops being true is worse than no exemption. If
    // services.create ever starts writing a providerId it was handed, this
    // fails rather than continuing to excuse it.
    const create = candidateMutations().find(m => m.name === 'create' && m.guard === 'complianceProcedure');
    expect(create, 'services.create is no longer in the sweep - re-check the exemption').toBeTruthy();
    expect(create!.body).toContain('providerId: ctx.user.id');
    expect(create!.body).not.toMatch(/providerId:\s*input\./);
  });
});
