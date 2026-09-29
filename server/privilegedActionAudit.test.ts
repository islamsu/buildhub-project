// ── NO PRIVILEGED ACTION CHANGES THE PRODUCT WITHOUT SAYING WHO ────────────
//
// adminEntityLinks asks this of the mutations that write to `users`. This asks
// it of ALL of them: every admin-gated mutation in the router that writes to
// the database has to leave a record somewhere an investigator can read.
//
// The sweep was wrong before the product was. Its first run reported nine
// silent mutations, and seven of them were not silent at all - they wrote to
// domain tables the sweep had never heard of, registrationReviewEvents and
// disputeStatusHistory among them. A census that knows about three of the
// product's audit surfaces reports the other six as defects, and "the test
// found nine problems" is exactly as misleading as "the test found none".
// RECORDERS and TABLES below are that list, and the positive control fails if
// either of them stops matching anything.
//
// The two that survived the correction were real:
//
//   setSupportTicketPriority  took no ctx at all - it could not have recorded
//                             an actor if it had wanted to - so a ticket could
//                             be moved down the queue with no trace.
//   updateSetting             wrote `updatedBy` onto the row, which says who
//                             touched a setting LAST and nothing about the
//                             hour registration was closed and reopened.
//
// WHAT THIS DOES NOT CLAIM. Finding a recorder in a mutation's body does not
// prove the row it writes is correct, or that it is written on every path
// through the function. It proves the mutation has an audit surface at all,
// which is the thing that was missing. The specific shapes - which action,
// which actor, which subject - are asserted for each family in its own file.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const SERVER = new URL('./', import.meta.url);
const ROUTERS = readFileSync(new URL('routers.ts', SERVER), 'utf8');

/**
 * The whole server, for checking that the names this sweep looks for still
 * exist. Not every one of them appears in the router: supportTicketStatusHistory
 * is written inside transitionTicket, and the billing recorder is called from
 * the billing service. Scoping the check to routers.ts reported both as
 * missing, which would have been a rename this sweep could not survive.
 */
function serverSource(): string {
  const parts: string[] = [];
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) { walk(child); continue; }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
      parts.push(readFileSync(child, 'utf8'));
    }
  };
  walk(SERVER);
  return parts.join('\n');
}
const ALL_SERVER = serverSource();

/** Helpers that write an audit row. */
const RECORDERS = [
  'recordAccountEvent', 'recordCommercialEvent', 'recordFieldChange',
  'recordFieldChanges', 'recordChangedFields', 'recordBillingEvent',
  'recordPlacementEvent', 'recordEvent',
];

/**
 * Tables the product treats as a trail, written directly rather than through a
 * helper. These are the six the first sweep did not know about, plus the ones
 * it did.
 */
const TABLES = [
  'userAccountAuditEvents', 'commercialAuditEvents', 'registrationReviewEvents',
  'disputeStatusHistory', 'supportTicketStatusHistory', 'fieldValueHistory',
  'billingEvents', 'adminNotes', 'analyticsEvents',
];

/**
 * A mutation that writes through a module-level helper rather than inline.
 * `transitionTicket` writes the ticket AND its history row in one call, by
 * design - "a transition that is recorded only when the caller remembers to is
 * a transition that will sometimes not be recorded" - so a call to it is an
 * audit surface as much as an insert would be.
 */
const DELEGATES = ['transitionTicket'];

type Mutation = { name: string; guard: string; body: string };

function adminMutations(): Mutation[] {
  const out: Mutation[] = [];
  const header = /^ {2}(\w+): (adminProcedure|superAdminProcedure|adminWith\([^)]*\)|complianceProcedure)/gm;
  const boundary = /^ {2}\w+: (publicProcedure|protectedProcedure|adminProcedure|superAdminProcedure|approvedProviderProcedure|complianceProcedure|adminWith\()/m;
  for (const match of ROUTERS.matchAll(header)) {
    const start = match.index ?? 0;
    const rest = ROUTERS.slice(start + 10);
    const next = boundary.exec(rest);
    const body = ROUTERS.slice(start, start + 10 + (next ? next.index : 6000));
    if (!body.includes('.mutation(')) continue;
    out.push({ name: match[1], guard: match[2], body });
  }
  return out;
}

const writesToDatabase = (m: Mutation) => /\bdb\.(update|insert|delete)\(/.test(m.body);
const hasAuditSurface = (m: Mutation) =>
  RECORDERS.some(r => m.body.includes(`${r}(`))
  || TABLES.some(t => m.body.includes(t))
  || DELEGATES.some(d => m.body.includes(`${d}(`));

describe('the sweep sees the router it is sweeping', () => {
  it('finds the admin-gated mutations', () => {
    // POSITIVE CONTROL. A regex that matched nothing would pass every
    // assertion below, and the numbers are deliberately concrete: a sweep that
    // silently halves its own scope is the failure mode this guards.
    const all = adminMutations();
    expect(all.length).toBeGreaterThan(40);
    const names = all.map(m => m.name);
    expect(names).toContain('updateSetting');
    expect(names).toContain('setSupportTicketPriority');
    expect(names).toContain('bulkUpdateApplicantStatus');
    expect(all.filter(writesToDatabase).length).toBeGreaterThan(25);
  });

  it('every recorder and every table it looks for is real', () => {
    // If a helper is renamed, this sweep must fail loudly rather than quietly
    // stop finding it and start reporting its callers as silent.
    for (const name of [...RECORDERS, ...TABLES, ...DELEGATES]) {
      expect(ALL_SERVER.includes(name), `${name} appears nowhere in the server`).toBe(true);
    }
  });
});

describe('no admin-gated mutation writes without a trail', () => {
  it('the sweep can see a silent mutation when there is one', () => {
    // POSITIVE CONTROL: the exact shape setSupportTicketPriority had.
    const silent: Mutation = {
      name: 'x', guard: "adminWith('support.manage')",
      body: ".mutation(async ({ input }) => { await db.update(supportTickets).set({}); })",
    };
    expect(writesToDatabase(silent)).toBe(true);
    expect(hasAuditSurface(silent)).toBe(false);
  });

  it('none of them is silent', () => {
    const silent = adminMutations()
      .filter(m => writesToDatabase(m) && !hasAuditSurface(m))
      .map(m => `${m.name} (${m.guard})`);
    expect(silent, `these change the product and record nothing:\n  ${silent.join('\n  ')}`)
      .toEqual([]);
  });

  it('a privileged mutation that records takes an actor to record', () => {
    // recordAccountEvent's actorId has to come from the session. A mutation
    // that destructures only `input` cannot name who acted, which is how the
    // priority change came to have no actor: it never had ctx in scope.
    const actorless = adminMutations()
      .filter(m => m.body.includes('recordAccountEvent('))
      .filter(m => !/\{\s*ctx\b|\{[^}]*\bctx\b[^}]*\}\s*\)\s*=>/.test(m.body))
      .map(m => m.name);
    expect(actorless, `these record an event with no session to name an actor from:\n  ${actorless.join('\n  ')}`)
      .toEqual([]);
  });
});
