// ── Evidence, messages, and the boundary between them ─────────────────────
//
// A dispute had no way to attach anything and no way to answer it: the
// respondent could be named and had no means of replying anywhere the record
// would show it. The only writable text on a dispute was the resolution notes,
// which the parties read - so an administrator working one had no private place
// to record what they had checked.
//
// The rule these exist for: A PARTICIPANT IN DISPUTE A MUST NOT FETCH DISPUTE
// B'S FILE, and a reporter must never see an administrator's internal note.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  DISPUTE_EVIDENCE_CONTENT_TYPES, isAllowedDisputeEvidenceType,
  MAX_DISPUTE_EVIDENCE_SIZE, MAX_DISPUTE_EVIDENCE_FILES, MAX_DISPUTE_MESSAGE_LENGTH,
  DISPUTE_OPEN_STATUSES, DISPUTE_STATUSES,
} from '@shared/disputes';

const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));
const PROXY = readFileSync(new URL('./_core/storageProxy.ts', import.meta.url), 'utf8');
const SCHEMA = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');

const disputeRouter = (() => {
  const start = ROUTERS.indexOf('const disputesRouter = router({');
  const end = ROUTERS.indexOf('// ── Provider Portfolio', start);
  return ROUTERS.slice(start, end === -1 ? undefined : end);
})();

describe('what may be attached', () => {
  it('only formats the server can actually VERIFY', () => {
    /*
     * The project-document list once accepted `text/*` and any `image/*` while
     * the byte sniffer immediately afterwards accepted only the formats with a
     * magic number - so a .txt passed validation and came back rejected, after
     * the user had already picked the file. A declared type nothing can verify
     * is not a capability.
     */
    const sniffer = readFileSync(new URL('./_core/fileType.ts', import.meta.url), 'utf8');
    for (const contentType of DISPUTE_EVIDENCE_CONTENT_TYPES) {
      expect(sniffer, `${contentType} is offered but cannot be verified`).toContain(contentType);
    }
  });

  it('and nothing else', () => {
    for (const bad of ['text/plain', 'image/svg+xml', 'application/zip', 'text/html',
      'application/octet-stream', 'application/x-msdownload', '']) {
      expect(isAllowedDisputeEvidenceType(bad), bad).toBe(false);
    }
    for (const good of DISPUTE_EVIDENCE_CONTENT_TYPES) expect(isAllowedDisputeEvidenceType(good)).toBe(true);
  });

  it('the DECLARED type is checked against the BYTES, not trusted', () => {
    // A content type is a label the caller controls both sides of.
    expect(disputeRouter).toContain('assertUploadedFileMatches(input.contentType, bytes, DISPUTE_EVIDENCE_CONTENT_TYPES)');
  });

  it('with a size limit, a file-count limit and a rate limit', () => {
    expect(MAX_DISPUTE_EVIDENCE_SIZE).toBe(10 * 1024 * 1024);
    expect(MAX_DISPUTE_EVIDENCE_FILES).toBeGreaterThan(0);
    expect(disputeRouter).toContain('MAX_DISPUTE_EVIDENCE_SIZE');
    expect(disputeRouter).toContain('MAX_DISPUTE_EVIDENCE_FILES');
    // Without this an authenticated party can push 10MB per request in a loop.
    expect(disputeRouter).toContain('enforceUploadRateLimit(ctx.user.id)');
  });

  it('the file-count limit counts only files still attached', () => {
    // Counting withdrawn files toward the limit would let a party fill a
    // dispute, withdraw everything, and leave the other side unable to attach.
    expect(disputeRouter).toContain('isNull(disputeEvidence.removedAt)');
  });
});

describe('who may fetch an evidence file', () => {
  const category = PROXY.slice(PROXY.indexOf("key.startsWith('dispute-evidence/')"));

  it('the storage proxy classifies the prefix at all', () => {
    // Anything it cannot classify fails closed, so an unclassified prefix would
    // make every evidence file unreachable rather than public - but it would
    // also mean the feature did not work.
    expect(PROXY).toContain("key.startsWith('dispute-evidence/')");
  });

  it('and resolves the KEY to its dispute before deciding', () => {
    // Unpredictability of a key is never the control.
    expect(category).toContain('eq(disputeEvidence.storageKey, key)');
  });

  it('then applies the SAME eligibility rule the dispute API uses', () => {
    /*
     * A second copy of the rule here is how a supplier who lost a bid ends up
     * able to read the evidence in the dispute the winner is in: the API says
     * no and the file proxy, written separately, says yes.
     */
    expect(category).toContain('canReadDispute(db, dispute as never, user.id)');
  });

  it('a withdrawn file is not served, so the withdrawal is not cosmetic', () => {
    expect(category).toContain('if (!file || file.removedAt) return false;');
  });

  it('a file whose dispute has vanished is refused rather than served', () => {
    expect(category).toContain('if (!dispute) return false;');
  });

  it('the proxy still fails closed on everything it cannot classify', () => {
    // The new branch must not have been added after the catch-all.
    const evidenceAt = PROXY.indexOf("key.startsWith('dispute-evidence/')");
    const failsClosedAt = PROXY.indexOf('// Anything outside the classified categories above');
    expect(evidenceAt).toBeGreaterThan(-1);
    expect(evidenceAt, 'the evidence branch is unreachable, after the catch-all').toBeLessThan(failsClosedAt);
  });
});

describe('withdrawing a file', () => {
  it('is soft - the row survives so the record shows it existed', () => {
    /*
     * Deleting it outright would let a party quietly retract evidence the other
     * side had already answered.
     */
    expect(disputeRouter).toContain('.set({ removedAt: new Date(), removedBy: ctx.user.id })');
    expect(disputeRouter).not.toContain('delete(disputeEvidence)');
  });

  it('and only by the person who attached it', () => {
    // Removing the other side's evidence is not a thing a party gets to do.
    expect(disputeRouter).toContain('if (Number(file.uploadedBy) !== ctx.user.id)');
    expect(disputeRouter).toContain('Only the person who attached a file can withdraw it.');
  });

  it('an unknown id is NOT_FOUND before anything else, so it cannot be probed', () => {
    const remove = disputeRouter.slice(disputeRouter.indexOf('removeEvidence: protectedProcedure'));
    const notFoundAt = remove.indexOf("message: 'Evidence not found'");
    const accessAt = remove.indexOf('requireDisputeAccess');
    expect(notFoundAt).toBeGreaterThan(-1);
    expect(notFoundAt).toBeLessThan(accessAt);
  });

  it('withdrawing twice is a no-op rather than a second audit entry', () => {
    expect(disputeRouter).toContain('if (file.removedAt) return { success: true as const, changed: false };');
  });
});

describe('a concluded dispute takes no more input', () => {
  it('neither messages nor evidence', () => {
    /*
     * Adding to a concluded dispute would put unanswered words after a
     * decision. Reopening is the route, and that has its own reason and its own
     * record.
     */
    const guards = disputeRouter.split('DISPUTE_OPEN_STATUSES.includes(dispute.status)').length - 1;
    expect(guards, 'both postMessage and addEvidence must guard on the status').toBe(2);
  });

  it('and "open" means exactly the two working states', () => {
    expect([...DISPUTE_OPEN_STATUSES]).toEqual(['open', 'investigating']);
    for (const concluded of DISPUTE_STATUSES.filter(s => !DISPUTE_OPEN_STATUSES.includes(s))) {
      expect(['resolved', 'rejected', 'withdrawn'], concluded).toContain(concluded);
    }
  });

  it('the refusal says how to proceed rather than only refusing', () => {
    expect(disputeRouter).toContain('Reopen it if there is more to say.');
  });
});

describe('participant messages and internal notes are different things', () => {
  it('they are separate TABLES, not one table with a flag', () => {
    /*
     * A forgotten `where visibility='participants'` would show a reporter what
     * an administrator wrote about them, and a rule that can be got wrong by
     * omitting a clause eventually will be. Internal notes are not in the
     * participant table at all, so no query against it can leak one.
     */
    const messages = SCHEMA.slice(
      SCHEMA.indexOf('export const disputeMessages = mysqlTable'),
      SCHEMA.indexOf('export const disputeStatusHistory = mysqlTable'),
    );
    expect(messages).not.toContain('visibility');
    expect(messages).not.toContain('internal');
  });

  it("the participant read selects from disputeMessages and nothing else", () => {
    const get = disputeRouter.slice(disputeRouter.indexOf('get: protectedProcedure'), disputeRouter.indexOf('postMessage:'));
    expect(get).toContain('.from(disputeMessages)');
    // The one thing that would break the separation.
    expect(get, 'the participant view reads admin notes').not.toContain('adminNotes');
  });

  it('internal notes are written to adminNotes under a support permission', () => {
    // The enum has always allowed 'dispute' and nothing had ever written one.
    const admin = ROUTERS.slice(ROUTERS.indexOf('disputeNotes: adminWith'), ROUTERS.indexOf('assignDispute: adminWith'));
    expect(admin).toContain("adminWith('support.manage')");
    expect(admin).toContain("eq(adminNotes.subjectType, 'dispute')");
    expect(admin).toContain("subjectType: 'dispute'");
  });

  it('and writing one notifies nobody, which is the point of it being internal', () => {
    const add = ROUTERS.slice(ROUTERS.indexOf('addDisputeNote: adminWith'), ROUTERS.indexOf('assignDispute: adminWith'));
    expect(add).not.toContain('notifyUser');
    expect(add).not.toContain('recordAccountEvent');
  });

  it('a note against a dispute that does not exist is refused, not orphaned', () => {
    const add = ROUTERS.slice(ROUTERS.indexOf('addDisputeNote: adminWith'), ROUTERS.indexOf('assignDispute: adminWith'));
    expect(add).toContain("message: 'Dispute not found'");
  });
});

describe('the participant read never leaks a withheld key', () => {
  it('a withdrawn file comes back with no URL to fetch it by', () => {
    const get = disputeRouter.slice(disputeRouter.indexOf('get: protectedProcedure'), disputeRouter.indexOf('postMessage:'));
    expect(get).toContain('url: row.removedAt ? null : `/manus-storage/${row.storageKey}`');
    // And the raw key is stripped, so it cannot be reassembled by hand.
    expect(get).toContain('storageKey: undefined');
  });

  it('a message is bounded so one party cannot flood the record', () => {
    expect(MAX_DISPUTE_MESSAGE_LENGTH).toBe(5000);
    expect(disputeRouter).toContain('.max(MAX_DISPUTE_MESSAGE_LENGTH)');
  });

  it('and the other side is told, because a message nobody hears is a note to self', () => {
    expect(disputeRouter).toContain("messageKey: 'notif.dispute.message'");
    // Never to yourself.
    expect(disputeRouter).toContain('if (userId == null || Number(userId) === ctx.user.id) continue;');
  });
});
