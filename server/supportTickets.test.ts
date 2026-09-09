/**
 * THE SUPPORT TICKET RULES, held where they are decided.
 *
 * Three things this file exists to pin, each of which was a real decision
 * rather than a default:
 *
 *   THE ONE DOOR returns NOT FOUND for a ticket that is neither yours nor
 *   visible to you. Answering FORBIDDEN would let a stranger enumerate ticket
 *   ids by watching which ones refuse differently, which is the same reasoning
 *   this codebase applies to projects and disputes.
 *
 *   THE STATE MACHINE refuses an undeclared move and says which states were
 *   involved. The generic "any status from any state" mutation this project
 *   deleted from disputes is not recreated here, and this file is what would
 *   fail if somebody reintroduced it.
 *
 *   WHAT A REPLY MEANS is a rule, not a call-site convention: answering a
 *   ticket that was waiting on you returns it to the queue, replying to a
 *   resolved one reopens it, and closed is terminal.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  SUPPORT_CATEGORIES, SUPPORT_PRIORITIES, SUPPORT_STATUSES, SUPPORT_TRANSITIONS,
  SUPPORT_TERMINAL_STATUSES, canTransitionSupport, supportAwaitingParty,
  supportReference, parseSupportReference, supportLabel,
  SUPPORT_PRIORITY_IS_STAFF_ONLY, type SupportStatus,
} from '@shared/supportTickets';
import {
  requireTicketAccess, transitionTicket, statusAfterUserReply,
  interpretTicketSearch, SupportTicketError,
} from './supportTickets';

const SCHEMA = readSourceForAssertions(
  readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8'),
);
const ROUTERS = readSourceForAssertions(
  readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'),
);

/** A db double that answers the single ticket lookup the door makes. */
function dbWithTicket(row: unknown) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(row ? [row] : []) }),
      }),
    }),
  } as any;
}

describe('the vocabulary is one closed set, and the schema agrees with it', () => {
  it('every status the shared list declares is in the column', () => {
    const table = SCHEMA.slice(
      SCHEMA.indexOf("export const supportTickets = mysqlTable"),
      SCHEMA.indexOf("export const supportTicketMessages = mysqlTable"),
    );
    for (const status of SUPPORT_STATUSES) expect(table, status).toContain(`'${status}'`);
    for (const category of SUPPORT_CATEGORIES) expect(table, category).toContain(`'${category}'`);
    for (const priority of SUPPORT_PRIORITIES) expect(table, priority).toContain(`'${priority}'`);
  });

  it('every status and category has a label in BOTH languages', () => {
    for (const status of SUPPORT_STATUSES) {
      expect(supportLabel('status', status, 'en')).not.toBe(status);
      expect(supportLabel('status', status, 'ar')).not.toBe(status);
      expect(supportLabel('status', status, 'ar')).not.toBe(supportLabel('status', status, 'en'));
    }
    for (const category of SUPPORT_CATEGORIES) {
      expect(supportLabel('category', category, 'ar')).not.toBe(supportLabel('category', category, 'en'));
    }
  });
});

describe('the state machine is declared, and closed is terminal', () => {
  it('every status has a transition list', () => {
    for (const status of SUPPORT_STATUSES) {
      expect(SUPPORT_TRANSITIONS[status], status).toBeDefined();
    }
  });

  it('closed has no way out - it is the only terminal state', () => {
    expect(SUPPORT_TRANSITIONS.closed).toEqual([]);
    expect(SUPPORT_TERMINAL_STATUSES).toEqual(['closed']);
    for (const status of SUPPORT_STATUSES) {
      if (status === 'closed') continue;
      expect(SUPPORT_TRANSITIONS[status].length, `${status} is a dead end`).toBeGreaterThan(0);
    }
  });

  it('resolved can be reopened, because a customer may disagree', () => {
    expect(canTransitionSupport('resolved', 'in_progress')).toBe(true);
  });

  it('no transition list names a status that does not exist', () => {
    for (const [from, targets] of Object.entries(SUPPORT_TRANSITIONS)) {
      for (const to of targets) {
        expect(SUPPORT_STATUSES, `${from} -> ${to}`).toContain(to);
      }
    }
  });

  it('nothing transitions to itself', () => {
    for (const status of SUPPORT_STATUSES) {
      expect(canTransitionSupport(status, status), status).toBe(false);
    }
  });
});

describe('transitionTicket refuses an undeclared move and says why', () => {
  const db = () => ({
    update: () => ({ set: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }) }),
    insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
  } as any);

  it('a closed ticket cannot be moved at all', async () => {
    await expect(transitionTicket(db(), {
      ticketId: 1, from: 'closed', to: 'open', actorId: 2,
    })).rejects.toThrow(/closed ticket cannot move to open/i);
  });

  it('the refusal names BOTH states, so the reader knows what to do', async () => {
    await expect(transitionTicket(db(), {
      ticketId: 1, from: 'resolved', to: 'awaiting_user', actorId: 2,
    })).rejects.toThrow(/resolved.*awaiting_user/i);
  });

  it('moving to the state it is already in is refused as such', async () => {
    await expect(transitionTicket(db(), {
      ticketId: 1, from: 'open', to: 'open', actorId: 2,
    })).rejects.toThrow(/already open/i);
  });

  it('a declared move writes the history row in the SAME call', async () => {
    const inserted: unknown[] = [];
    const fake = {
      update: () => ({ set: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }) }),
      insert: () => ({ values: (row: unknown) => { inserted.push(row); return Promise.resolve([{ insertId: 1 }]); } }),
    } as any;
    await transitionTicket(fake, { ticketId: 7, from: 'open', to: 'in_progress', actorId: 3, reason: 'picked up' });
    // History written by the transition itself, not left to the caller to
    // remember - a transition recorded only when somebody remembers is a
    // transition that will sometimes not be recorded.
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      ticketId: 7, fromStatus: 'open', toStatus: 'in_progress', actorId: 3, reason: 'picked up',
    });
  });
});

describe('the one access door', () => {
  it('the requester gets in, as the requester', async () => {
    const access = await requireTicketAccess(dbWithTicket({ id: 1, requesterId: 5, status: 'open', reference: 'SUP-2026-000001' }), 1, 5, false);
    expect(access.via).toBe('requester');
  });

  it('support staff get in, as support', async () => {
    const access = await requireTicketAccess(dbWithTicket({ id: 1, requesterId: 5, status: 'open', reference: null }), 1, 99, true);
    expect(access.via).toBe('support');
  });

  it('an ADMIN reading their OWN ticket is the requester, not support', async () => {
    // `via` is how they got in, not who they are. An administrator with a
    // billing question is a customer for the length of that ticket.
    const access = await requireTicketAccess(dbWithTicket({ id: 1, requesterId: 5, status: 'open', reference: null }), 1, 5, true);
    expect(access.via).toBe('requester');
  });

  it('a stranger gets NOT_FOUND, never FORBIDDEN', async () => {
    // FORBIDDEN would confirm the ticket exists, which is how ids get
    // enumerated. Same code as a ticket that is genuinely absent.
    await expect(requireTicketAccess(dbWithTicket({ id: 1, requesterId: 5, status: 'open', reference: null }), 1, 6, false))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(requireTicketAccess(dbWithTicket(null), 1, 6, false))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('the two refusals are indistinguishable to the caller', async () => {
    const unauthorized = await requireTicketAccess(dbWithTicket({ id: 1, requesterId: 5, status: 'open', reference: null }), 1, 6, false)
      .catch((error: SupportTicketError) => error);
    const missing = await requireTicketAccess(dbWithTicket(null), 1, 6, false)
      .catch((error: SupportTicketError) => error);
    expect((unauthorized as SupportTicketError).code).toBe((missing as SupportTicketError).code);
    expect((unauthorized as SupportTicketError).message).toBe((missing as SupportTicketError).message);
  });
});

describe('what a customer reply means', () => {
  it('answering a ticket that waited on them returns it to the queue', () => {
    expect(statusAfterUserReply('awaiting_user')).toBe('in_progress');
  });

  it('replying to a resolved ticket REOPENS it', () => {
    // Which is why resolved and closed are two states rather than one.
    expect(statusAfterUserReply('resolved')).toBe('in_progress');
  });

  it('a closed ticket is not resurrected by a reply', () => {
    expect(statusAfterUserReply('closed')).toBeNull();
  });

  it('an already-open ticket is left where it is', () => {
    expect(statusAfterUserReply('open')).toBeNull();
    expect(statusAfterUserReply('in_progress')).toBeNull();
  });

  it('every status is handled - no status falls through unconsidered', () => {
    for (const status of SUPPORT_STATUSES) {
      const next = statusAfterUserReply(status);
      if (next !== null) expect(canTransitionSupport(status, next), `${status} -> ${next}`).toBe(true);
    }
  });
});

describe('who is waiting, derived rather than stored', () => {
  it('awaiting_user is the customer, everything live is us', () => {
    expect(supportAwaitingParty('awaiting_user')).toBe('user');
    expect(supportAwaitingParty('open')).toBe('support');
    expect(supportAwaitingParty('in_progress')).toBe('support');
  });

  it('a finished ticket waits on nobody', () => {
    expect(supportAwaitingParty('resolved')).toBe('nobody');
    expect(supportAwaitingParty('closed')).toBe('nobody');
  });

  it('it is DERIVED, so it cannot disagree with the status', () => {
    // Stored, it would be a second source of truth that drifts the first time
    // a status changes without it.
    const source = readSourceForAssertions(readFileSync(new URL('../shared/supportTickets.ts', import.meta.url), 'utf8'));
    expect(source).toContain('export function supportAwaitingParty');
    expect(SCHEMA).not.toContain('awaitingParty:');
  });
});

describe('the human reference', () => {
  it('reads as SUP-YEAR-NNNNNN', () => {
    expect(supportReference(123, new Date('2026-05-01T00:00:00Z'))).toBe('SUP-2026-000123');
  });

  it('round-trips back to the id', () => {
    expect(parseSupportReference('SUP-2026-000123')).toBe(123);
    expect(parseSupportReference('sup-2026-000123')).toBe(123);
  });

  it('a bare id is accepted, because people paste those too', () => {
    expect(parseSupportReference('123')).toBe(123);
  });

  it('anything else is null rather than a guess', () => {
    expect(parseSupportReference('DSP-2026-000123')).toBeNull();
    expect(parseSupportReference('hello')).toBeNull();
    expect(parseSupportReference('')).toBeNull();
  });
});

describe('the admin search box', () => {
  it('a reference searches by id, not by text', () => {
    expect(interpretTicketSearch('SUP-2026-000042')).toEqual({ referenceId: 42, text: null });
  });

  it('free text searches as text', () => {
    expect(interpretTicketSearch('cannot log in')).toEqual({ referenceId: null, text: 'cannot log in' });
  });

  it('an empty box filters nothing rather than matching nothing', () => {
    expect(interpretTicketSearch('  ')).toEqual({ referenceId: null, text: null });
    expect(interpretTicketSearch(null)).toEqual({ referenceId: null, text: null });
  });
});

describe('priority is BuildHub’s judgement, not the customer’s', () => {
  it('the rule is a written constant, not an accident of a zod schema', () => {
    expect(SUPPORT_PRIORITY_IS_STAFF_ONLY).toBe(true);
  });

  it('createTicket does not accept a priority', () => {
    const block = ROUTERS.slice(ROUTERS.indexOf('createTicket: protectedProcedure'));
    const input = block.slice(0, block.indexOf('.mutation('));
    expect(input).toContain('category:');
    expect(input).toContain('subject:');
    expect(input, 'a requester who sets their own priority always sets urgent').not.toContain('priority');
  });

  it('and the staff-only path does', () => {
    expect(ROUTERS).toContain('setSupportTicketPriority: adminWith(\'support.manage\')');
  });
});

describe('a resolution is a record, never a bare status flip', () => {
  it('resolving without notes is refused', () => {
    const block = ROUTERS.slice(ROUTERS.indexOf('transitionSupportTicket: adminWith'));
    expect(block.slice(0, 4000)).toContain("input.to === 'resolved' && !input.resolutionNotes");
  });
});

describe('the customer thread and the internal notes are different tables', () => {
  it('the participant thread has no visibility or internal column to get wrong', () => {
    const table = SCHEMA.slice(
      SCHEMA.indexOf('export const supportTicketMessages = mysqlTable'),
      SCHEMA.indexOf('export const supportTicketAttachments = mysqlTable'),
    );
    expect(table).not.toContain('visibility');
    expect(table).not.toContain('internal');
  });

  it('internal notes reuse adminNotes rather than a second notes system', () => {
    expect(ROUTERS).toContain("subjectType: 'support_ticket'");
    expect(SCHEMA).not.toContain('supportTicketAdminNotes');
  });

  it('the thread reader does not touch adminNotes at all', () => {
    const service = readSourceForAssertions(readFileSync(new URL('./supportTickets.ts', import.meta.url), 'utf8'));
    const fn = service.slice(service.indexOf('export async function ticketThread'));
    expect(fn, 'a requester detail view must have no path to an internal note').not.toContain('adminNotes');
  });
});
