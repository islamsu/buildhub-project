// ── The dispute state machine ──────────────────────────────────────────────
//
// `admin.updateDispute` was `db.update(disputes).set({ status, resolutionNotes })`
// - any status, from any state, by any administrator with support.manage, with
// no check that the dispute existed, no record of who did it or from what, and
// nothing told to the parties. A resolved dispute could be moved back to open
// and resolved again with different notes, and the record would show only the
// last write.
//
// These are written against the ILLEGAL moves as much as the legal ones,
// because the client will only ever offer the legal ones and that offering is
// not a control.

import { describe, expect, it } from 'vitest';
import { checkTransition, transitionColumns, DISPUTE_TRANSITIONS } from './disputeWorkflow';
import { DISPUTE_STATUSES } from '@shared/disputes';

const NOW = new Date('2026-06-01T12:00:00Z');
const ADMIN = 9;

const resolve = { resolutionType: 'resolved_by_agreement' as const, resolutionSummary: 'Agreed a new date' };

describe('the legal moves', () => {
  it('an administrator picks up an open dispute', () => {
    expect(checkTransition({ from: 'open', to: 'investigating', actor: 'admin' }).ok).toBe(true);
  });

  it('and concludes it, from either working state', () => {
    for (const from of ['open', 'investigating'] as const) {
      expect(checkTransition({ from, to: 'resolved', actor: 'admin', ...resolve }).ok, from).toBe(true);
      expect(checkTransition({ from, to: 'rejected', actor: 'admin', reason: 'Outside what we can judge' }).ok, from).toBe(true);
    }
  });

  it('the reporter withdraws their own, while it is still live', () => {
    for (const from of ['open', 'investigating'] as const) {
      expect(checkTransition({ from, to: 'withdrawn', actor: 'reporter', reason: 'Sorted it directly' }).ok, from).toBe(true);
    }
  });

  it('and either party reopens a concluded one', () => {
    for (const actor of ['reporter', 'respondent', 'admin'] as const) {
      for (const from of ['resolved', 'rejected'] as const) {
        expect(checkTransition({ from, to: 'open', actor, reason: 'New evidence' }).ok, `${actor} ${from}`).toBe(true);
      }
    }
  });
});

describe('the illegal moves, which the server refuses', () => {
  it('WITHDRAWN IS TERMINAL, and says what to do instead', () => {
    /*
     * Reopening a withdrawn dispute would let a party withdraw to stop an
     * investigation and restart it when it suited them.
     */
    for (const to of DISPUTE_STATUSES.filter(s => s !== 'withdrawn')) {
      const result = checkTransition({ from: 'withdrawn', to, actor: 'admin', reason: 'x', ...resolve });
      expect(result.ok, `withdrawn -> ${to}`).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/raise a new one instead/i);
    }
  });

  it('an administrator cannot withdraw somebody else\'s dispute', () => {
    // That would put the platform's name on a choice the reporter made.
    const result = checkTransition({ from: 'open', to: 'withdrawn', actor: 'admin', reason: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/only the reporter/i);
  });

  it('a party cannot resolve or reject their own dispute', () => {
    for (const actor of ['reporter', 'respondent'] as const) {
      expect(checkTransition({ from: 'open', to: 'resolved', actor, ...resolve }).ok, actor).toBe(false);
      expect(checkTransition({ from: 'open', to: 'rejected', actor, reason: 'x' }).ok, actor).toBe(false);
    }
  });

  it('a respondent cannot withdraw a dispute raised against them', () => {
    expect(checkTransition({ from: 'open', to: 'withdrawn', actor: 'respondent', reason: 'x' }).ok).toBe(false);
  });

  it('a concluded dispute cannot jump straight to another conclusion', () => {
    // resolved -> rejected would rewrite an outcome rather than reopen and
    // reconsider it, leaving no record that the first decision was made.
    expect(checkTransition({ from: 'resolved', to: 'rejected', actor: 'admin', reason: 'x' }).ok).toBe(false);
    expect(checkTransition({ from: 'rejected', to: 'resolved', actor: 'admin', ...resolve }).ok).toBe(false);
    expect(checkTransition({ from: 'resolved', to: 'investigating', actor: 'admin' }).ok).toBe(false);
  });

  it('a move to the same state is refused rather than written as a no-op', () => {
    for (const status of DISPUTE_STATUSES) {
      const result = checkTransition({ from: status, to: status, actor: 'admin', reason: 'x', ...resolve });
      expect(result.ok, status).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/already/i);
    }
  });

  it('a status that is not a status at all is refused', () => {
    for (const bad of ['deleted', 'closed', 'RESOLVED', '', 'open; drop table']) {
      expect(checkTransition({ from: 'open', to: bad, actor: 'admin' }).ok, bad).toBe(false);
    }
  });

  it('the refusal names both states, so a person can tell what went wrong', () => {
    const result = checkTransition({ from: 'resolved', to: 'investigating', actor: 'admin' });
    if (!result.ok) expect(result.reason).toContain('resolved');
    if (!result.ok) expect(result.reason).toContain('investigating');
  });
});

describe('a conclusion is never a bare status flip', () => {
  it('resolving requires a resolution TYPE', () => {
    const result = checkTransition({ from: 'open', to: 'resolved', actor: 'admin', resolutionSummary: 'Done' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/a bare status change is not a resolution/i);
  });

  it('and a summary', () => {
    expect(checkTransition({
      from: 'open', to: 'resolved', actor: 'admin', resolutionType: 'resolved_by_platform',
    }).ok).toBe(false);
    // Whitespace is not a summary.
    expect(checkTransition({
      from: 'open', to: 'resolved', actor: 'admin', resolutionType: 'resolved_by_platform', resolutionSummary: '   ',
    }).ok).toBe(false);
  });

  it('rejecting requires a reason - a verdict without grounds is not one', () => {
    expect(checkTransition({ from: 'open', to: 'rejected', actor: 'admin' }).ok).toBe(false);
    expect(checkTransition({ from: 'open', to: 'rejected', actor: 'admin', reason: '  ' }).ok).toBe(false);
  });

  it('withdrawing and reopening both require a reason', () => {
    expect(checkTransition({ from: 'open', to: 'withdrawn', actor: 'reporter' }).ok).toBe(false);
    expect(checkTransition({ from: 'resolved', to: 'open', actor: 'reporter' }).ok).toBe(false);
  });
});

describe('what a transition writes', () => {
  it('a resolution records the type, the summary, and who decided', () => {
    expect(transitionColumns({ to: 'resolved', actorId: ADMIN, now: NOW, ...resolve })).toEqual({
      status: 'resolved',
      resolutionType: 'resolved_by_agreement',
      resolutionNotes: 'Agreed a new date',
      resolvedBy: ADMIN,
      resolvedAt: NOW,
    });
  });

  it('a rejection records its reason AS the resolution record', () => {
    // A party told only "rejected" has been given a verdict without grounds.
    const patch = transitionColumns({ to: 'rejected', actorId: ADMIN, now: NOW, reason: 'Not something we can judge' });
    expect(patch).toMatchObject({
      status: 'rejected', resolutionType: 'out_of_scope',
      resolutionNotes: 'Not something we can judge', resolvedBy: ADMIN,
    });
  });

  it('reopening CLEARS the previous resolution', () => {
    /*
     * A dispute that reads "open" while still carrying "resolved by agreement"
     * tells two different stories at once - and the second is the one an
     * administrator would quote back to a party.
     */
    const patch = transitionColumns({ to: 'open', actorId: ADMIN, now: NOW, reason: 'New evidence' });
    expect(patch).toMatchObject({
      status: 'open', reopenedBy: ADMIN, reopenedAt: NOW, reopenReason: 'New evidence',
      resolutionType: null, resolvedBy: null, resolvedAt: null,
    });
  });

  it('a withdrawal is stamped and keeps the reporter\'s reason', () => {
    const patch = transitionColumns({ to: 'withdrawn', actorId: 10, now: NOW, reason: 'Sorted directly' });
    expect(patch).toMatchObject({ status: 'withdrawn', withdrawnAt: NOW, resolutionNotes: 'Sorted directly' });
  });

  it('a long reopen reason is trimmed to its column rather than failing the move', () => {
    const patch = transitionColumns({ to: 'open', actorId: ADMIN, now: NOW, reason: 'x'.repeat(900) });
    expect(String(patch.reopenReason).length).toBe(500);
  });
});

describe('the table itself', () => {
  it('declares no transition INTO a state that is not a status', () => {
    for (const transition of DISPUTE_TRANSITIONS) {
      expect(DISPUTE_STATUSES, `${transition.from} -> ${transition.to}`).toContain(transition.to);
      expect(DISPUTE_STATUSES).toContain(transition.from);
    }
  });

  it('every transition names at least one actor who may make it', () => {
    // A transition nobody may make is a state the dispute can never leave.
    for (const transition of DISPUTE_TRANSITIONS) {
      expect(transition.actors.length, `${transition.from} -> ${transition.to}`).toBeGreaterThan(0);
    }
  });

  it('every non-terminal state has a way out', () => {
    // A dispute stuck forever is worse than one that ends badly.
    for (const status of DISPUTE_STATUSES) {
      if (status === 'withdrawn') continue; // terminal by design
      expect(DISPUTE_TRANSITIONS.some(t => t.from === status), `${status} is a dead end`).toBe(true);
    }
  });

  it('and every concluding move demands a stated outcome', () => {
    for (const transition of DISPUTE_TRANSITIONS) {
      if (['resolved', 'rejected', 'withdrawn'].includes(transition.to)) {
        expect(
          transition.requiresReason || transition.requiresResolution,
          `${transition.from} -> ${transition.to} can end a dispute silently`,
        ).toBe(true);
      }
    }
  });
});
