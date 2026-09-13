/**
 * ── THE MISSING HALF OF REVIEWS, HELD WHERE IT IS DECIDED ─────────────────
 *
 * Four rules this file exists to pin, each a decision rather than a default:
 *
 *   A HIDDEN REVIEW LEAVES THE AVERAGE. Hiding a review that still counts is a
 *   remedy in appearance only - the provider's score carries the same damage
 *   with the evidence removed. `visibleReviewFilter()` is the one definition
 *   of "public", and the census in vendorReputation.test.ts holds every reader
 *   to it.
 *
 *   HIDING REQUIRES A RECORDED REASON. Removing somebody's published words
 *   from a provider's page without one cannot be defended afterwards to either
 *   party.
 *
 *   UPHOLDING A REPORT DOES NOT HIDE THE REVIEW. Two decisions, deliberately
 *   uncoupled: a report can be well-founded and the review still stand, and a
 *   review can be hidden with no report at all.
 *
 *   THE RIGHT OF REPLY BELONGS TO THE REVIEWEE, once. Not the reviewer, not an
 *   administrator writing on somebody's behalf - a reply attributed to a person
 *   who did not write it is worse than no reply at all.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  REVIEW_REPORT_REASONS, REVIEW_REPORT_STATUSES, REVIEW_MODERATION_ACTIONS,
  REVIEW_RESPONSE_MAX_LENGTH, reviewLabel,
} from '@shared/reviews';
import {
  respondToReview, reportReview, moderateReview, resolveReviewReport,
  ReviewModerationError,
} from './reviewModeration';

const SCHEMA = readSourceForAssertions(
  readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8'),
);

/**
 * A db double that answers each `select(...)` in the order the service makes
 * them, and records every insert/update so the assertions are about what was
 * WRITTEN rather than about which internal branch was taken.
 */
function fakeDb(selects: unknown[][]) {
  let call = 0;
  const writes: { kind: 'insert' | 'update'; values: any }[] = [];
  const answer = () => Promise.resolve(selects[call++] ?? []);
  const db: any = {
    select: () => ({
      from: () => ({
        // LAZY, and consumed exactly once. An eager answer() here charged two
        // responses to every `.where().limit()` and every assertion below read
        // the NEXT query's rows - a harness bug that would have made real
        // failures look like passes elsewhere.
        where: () => {
          let pending: Promise<unknown> | null = null;
          const take = () => (pending ??= answer());
          return {
            limit: () => take(),
            then: (onOk: any, onErr: any) => take().then(onOk, onErr),
          };
        },
      }),
    }),
    insert: () => ({ values: (values: any) => { writes.push({ kind: 'insert', values }); return Promise.resolve(); } }),
    update: () => ({ set: (values: any) => ({ where: () => { writes.push({ kind: 'update', values }); return Promise.resolve(); } }) }),
    writes,
    get callCount() { return call; },
  };
  return db;
}

const REVIEW = { id: 7, revieweeId: 20, reviewerId: 3, hiddenAt: null };

describe('the vocabulary is closed, and both languages exist', () => {
  it('every report reason and status has a distinct label in EN and AR', () => {
    for (const reason of REVIEW_REPORT_REASONS) {
      expect(reviewLabel('reportReason', reason, 'en'), reason).not.toBe(reason);
      expect(reviewLabel('reportReason', reason, 'ar'), reason).not.toBe(reason);
      expect(reviewLabel('reportReason', reason, 'ar')).not.toBe(reviewLabel('reportReason', reason, 'en'));
    }
    for (const status of REVIEW_REPORT_STATUSES) {
      expect(reviewLabel('reportStatus', status, 'ar')).not.toBe(reviewLabel('reportStatus', status, 'en'));
    }
  });

  it('NO REASON MEANS "I DISAGREE" - a bad rating that is accurate is the system working', () => {
    // Offering a reason that amounts to "unflattering" would invite providers
    // to report every three-star rating, and the queue would stop meaning
    // anything. Each reason describes a review that should not have been
    // publishable at all.
    for (const reason of REVIEW_REPORT_REASONS) {
      expect(reason).not.toMatch(/disagree|unfair|wrong|inaccurate|low|negative/i);
    }
  });

  it('the schema carries every reason, status and moderation column the code writes', () => {
    const reportsTable = SCHEMA.slice(
      SCHEMA.indexOf('export const reviewReports = mysqlTable'),
      SCHEMA.indexOf('export const reviewReports = mysqlTable') + 2000,
    );
    for (const reason of REVIEW_REPORT_REASONS) expect(reportsTable, reason).toContain(`'${reason}'`);
    for (const status of REVIEW_REPORT_STATUSES) expect(reportsTable, status).toContain(`'${status}'`);

    // The three columns moderateReview writes. A missing one would fail only
    // at runtime, against a real database, in production.
    const reviewsTable = SCHEMA.slice(
      SCHEMA.indexOf('export const reviews = mysqlTable'),
      SCHEMA.indexOf('export const reviews = mysqlTable') + 2000,
    );
    for (const column of ['hiddenAt', 'hiddenBy', 'hiddenReason']) {
      expect(reviewsTable, column).toContain(column);
    }
  });
});

describe('respondToReview - the right of reply, and its limits', () => {
  it('the reviewee may answer a review about them', async () => {
    const db = fakeDb([[REVIEW], []]);
    await expect(respondToReview(db, { reviewId: 7, authorId: 20, body: 'We returned and finished the snagging.' }))
      .resolves.toEqual({ ok: true });
    expect(db.writes).toEqual([
      { kind: 'insert', values: { reviewId: 7, authorId: 20, body: 'We returned and finished the snagging.' } },
    ]);
  });

  it('THE REVIEWER MAY NOT ANSWER THEIR OWN REVIEW, and is told NOT FOUND rather than FORBIDDEN', async () => {
    // FORBIDDEN would confirm the review exists to somebody who may not touch
    // it, which is how ids get walked. Same reasoning as projects and disputes.
    const db = fakeDb([[REVIEW]]);
    await expect(respondToReview(db, { reviewId: 7, authorId: 3, body: 'Actually I meant five stars' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.writes).toEqual([]);
  });

  it('a stranger may not answer either', async () => {
    const db = fakeDb([[REVIEW]]);
    await expect(respondToReview(db, { reviewId: 7, authorId: 999, body: 'On behalf of the vendor' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.writes).toEqual([]);
  });

  it('a second reply EDITS the first rather than starting a thread', async () => {
    // A review page that becomes an argument helps nobody reading it, and the
    // reviewer has already had their say.
    const db = fakeDb([[REVIEW], [{ id: 41 }]]);
    await expect(respondToReview(db, { reviewId: 7, authorId: 20, body: 'Corrected reply' }))
      .resolves.toEqual({ ok: true });
    expect(db.writes).toEqual([{ kind: 'update', values: { body: 'Corrected reply' } }]);
  });

  it('a HIDDEN review cannot be answered, and the refusal says why', async () => {
    const db = fakeDb([[{ ...REVIEW, hiddenAt: new Date() }]]);
    await expect(respondToReview(db, { reviewId: 7, authorId: 20, body: 'reply' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.writes).toEqual([]);
  });

  it('a review that does not exist is NOT FOUND', async () => {
    const db = fakeDb([[]]);
    await expect(respondToReview(db, { reviewId: 7, authorId: 20, body: 'reply' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('reportReview - one report per person, and never your own', () => {
  it('a reader who is not the reviewer may report, with the reason recorded', async () => {
    const db = fakeDb([[REVIEW], []]);
    await expect(reportReview(db, { reviewId: 7, reporterId: 20, reason: 'abusive', detail: 'names a third party' }))
      .resolves.toEqual({ ok: true });
    expect(db.writes).toEqual([{
      kind: 'insert',
      values: { reviewId: 7, reporterId: 20, reason: 'abusive', detail: 'names a third party', status: 'open' },
    }]);
  });

  it('a report opens as OPEN - nothing is decided by the act of reporting', async () => {
    const db = fakeDb([[REVIEW], []]);
    await reportReview(db, { reviewId: 7, reporterId: 20, reason: 'spam' });
    expect(db.writes[0].values.status).toBe('open');
  });

  it('THE REVIEWER CANNOT REPORT THEIR OWN REVIEW', async () => {
    // A self-report is either a mistake or an attempt to get a genuine review
    // pulled without anybody weighing it.
    const db = fakeDb([[REVIEW]]);
    await expect(reportReview(db, { reviewId: 7, reporterId: 3, reason: 'other' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.writes).toEqual([]);
  });

  it('REPEAT-REPORTING IS NOT A LOUDER VOTE - the second is refused', async () => {
    const db = fakeDb([[REVIEW], [{ id: 91 }]]);
    await expect(reportReview(db, { reviewId: 7, reporterId: 20, reason: 'abusive' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(db.writes).toEqual([]);
  });

  it('reporting a review that does not exist is NOT FOUND', async () => {
    const db = fakeDb([[]]);
    await expect(reportReview(db, { reviewId: 7, reporterId: 20, reason: 'spam' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('moderateReview - hiding is a real remedy, and a recorded one', () => {
  it('HIDING WITHOUT A REASON IS REFUSED, and the refusal explains itself', async () => {
    const db = fakeDb([[{ id: 7, hiddenAt: null }]]);
    await expect(moderateReview(db, { reviewId: 7, actorId: 1, action: 'hide' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.writes).toEqual([]);
  });

  it('WHITESPACE IS NOT A REASON', async () => {
    const db = fakeDb([[{ id: 7, hiddenAt: null }]]);
    await expect(moderateReview(db, { reviewId: 7, actorId: 1, action: 'hide', reason: '   ' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.writes).toEqual([]);
  });

  it('hiding records WHO and WHY alongside WHEN', async () => {
    const db = fakeDb([[{ id: 7, hiddenAt: null }]]);
    await expect(moderateReview(db, { reviewId: 7, actorId: 5, action: 'hide', reason: '  names a third party  ' }))
      .resolves.toEqual({ ok: true, hidden: true });
    const written = db.writes[0].values;
    expect(written.hiddenBy).toBe(5);
    expect(written.hiddenReason).toBe('names a third party');
    expect(written.hiddenAt).toBeInstanceOf(Date);
  });

  it('restoring CLEARS the stamp rather than adding a second field that can disagree with it', async () => {
    const db = fakeDb([[{ id: 7, hiddenAt: new Date() }]]);
    await expect(moderateReview(db, { reviewId: 7, actorId: 5, action: 'restore' }))
      .resolves.toEqual({ ok: true, hidden: false });
    expect(db.writes).toEqual([{ kind: 'update', values: { hiddenAt: null, hiddenBy: null, hiddenReason: null } }]);
  });

  it('hiding an already-hidden review, and restoring a visible one, are both refused', async () => {
    await expect(moderateReview(fakeDb([[{ id: 7, hiddenAt: new Date() }]]), {
      reviewId: 7, actorId: 1, action: 'hide', reason: 'again',
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(moderateReview(fakeDb([[{ id: 7, hiddenAt: null }]]), {
      reviewId: 7, actorId: 1, action: 'restore',
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('moderating a review that does not exist is NOT FOUND', async () => {
    await expect(moderateReview(fakeDb([[]]), { reviewId: 7, actorId: 1, action: 'restore' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('the action set is closed to hide and restore - there is no delete', async () => {
    // A deleted review is a rating that silently changes with no explanation,
    // which is the same drift this system already refuses for stored
    // aggregates. Hidden, never deleted.
    expect([...REVIEW_MODERATION_ACTIONS]).toEqual(['hide', 'restore']);
  });
});

describe('resolveReviewReport - the second decision, kept separate from the first', () => {
  it('UPHOLDING A REPORT DOES NOT HIDE THE REVIEW', async () => {
    const db = fakeDb([[{ id: 91, status: 'open' }]]);
    await expect(resolveReviewReport(db, { reportId: 91, actorId: 5, status: 'upheld', note: 'agreed' }))
      .resolves.toEqual({ ok: true });

    // Exactly one write, and it is to the REPORT. If upholding also hid the
    // review there would be a second write here, and the moderator's judgement
    // would have been taken out of the one place it belongs.
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0].values).toMatchObject({ status: 'upheld', resolutionNote: 'agreed', resolvedBy: 5 });
    expect(db.writes[0].values.hiddenAt).toBeUndefined();
  });

  it('rejecting records the decision the same way', async () => {
    const db = fakeDb([[{ id: 91, status: 'open' }]]);
    await resolveReviewReport(db, { reportId: 91, actorId: 5, status: 'rejected' });
    expect(db.writes[0].values).toMatchObject({ status: 'rejected', resolutionNote: null, resolvedBy: 5 });
    expect(db.writes[0].values.resolvedAt).toBeInstanceOf(Date);
  });

  it('A REPORT IS DECIDED ONCE - a second resolution is refused and names the first', async () => {
    const db = fakeDb([[{ id: 91, status: 'upheld' }]]);
    await expect(resolveReviewReport(db, { reportId: 91, actorId: 5, status: 'rejected' }))
      .rejects.toThrow(/already upheld/);
    expect(db.writes).toEqual([]);
  });

  it('resolving a report that does not exist is NOT FOUND', async () => {
    await expect(resolveReviewReport(fakeDb([[]]), { reportId: 91, actorId: 5, status: 'upheld' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('the error type carries a code, so tRPC does not flatten every refusal to 500', () => {
  it('every failure above is a ReviewModerationError with one of the four codes', async () => {
    const failures = await Promise.allSettled([
      respondToReview(fakeDb([[]]), { reviewId: 1, authorId: 1, body: 'x' }),
      reportReview(fakeDb([[REVIEW]]), { reviewId: 7, reporterId: 3, reason: 'other' }),
      moderateReview(fakeDb([[{ id: 7, hiddenAt: null }]]), { reviewId: 7, actorId: 1, action: 'hide' }),
      resolveReviewReport(fakeDb([[{ id: 91, status: 'upheld' }]]), { reportId: 91, actorId: 1, status: 'upheld' }),
    ]);
    expect(failures.every(f => f.status === 'rejected')).toBe(true);
    for (const failure of failures) {
      const reason = (failure as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(ReviewModerationError);
      expect(['NOT_FOUND', 'FORBIDDEN', 'BAD_REQUEST', 'CONFLICT']).toContain(reason.code);
      // A refusal a user reads has to say something. "Error" is not a message.
      expect(String(reason.message).length).toBeGreaterThan(10);
    }
  });
});

describe('the response length limit is one number, shared by the client and the column', () => {
  it('the schema column is at least as wide as the limit the input enforces', () => {
    const responsesTable = SCHEMA.slice(
      SCHEMA.indexOf('export const reviewResponses = mysqlTable'),
      SCHEMA.indexOf('export const reviewResponses = mysqlTable') + 1200,
    );
    // `text` holds far more than the limit; a varchar narrower than the limit
    // would truncate a reply the UI accepted, which is the failure this pins.
    const varchar = /body:\s*varchar\('body',\s*\{\s*length:\s*(\d+)/.exec(responsesTable);
    if (varchar) expect(Number(varchar[1])).toBeGreaterThanOrEqual(REVIEW_RESPONSE_MAX_LENGTH);
    else expect(responsesTable).toMatch(/body:\s*text\(/);
  });
});
