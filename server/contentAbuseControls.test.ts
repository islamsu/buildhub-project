import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { contentLimiters, resetContentLimiters } from './_core/rateLimit';

/**
 * Sign-in was bounded; what an account could DO once signed in was not.
 *
 * The production-readiness inventory recorded two gaps: rfq.create had no rate
 * limit, so one authenticated account could flood the provider feed, and none of
 * the five upload endpoints had one, so one account could fill the bucket - which
 * turns directly into a storage bill the moment S3 is configured.
 *
 * These tests cover the limiter's behaviour AND its wiring, because a correct
 * limiter nobody calls protects nothing.
 */

const SOURCE = readFileSync(new URL('../server/routers.ts', import.meta.url), 'utf8');

/**
 * The body of a named tRPC procedure, sliced by real anchors.
 *
 * THROWS when the anchor is absent. An indexOf that returns -1 slices to '' and
 * makes every subsequent assertion pass vacuously - the exact failure mode that
 * let a weak test survive its own mutation earlier in this project.
 */
function procedureBody(name: string, endBefore: string): string {
  const start = SOURCE.indexOf(name);
  if (start === -1) throw new Error(`anchor "${name}" not found in routers.ts - rewire this test`);
  const end = SOURCE.indexOf(endBefore, start);
  if (end === -1) throw new Error(`end anchor "${endBefore}" not found after "${name}" - rewire this test`);
  return SOURCE.slice(start, end);
}

describe('content rate limiter behaviour', () => {
  beforeEach(() => resetContentLimiters());

  it('allows a normal burst and then refuses', () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(contentLimiters.rfqBurst.check('42', now).allowed, `attempt ${i + 1}`).toBe(true);
    }
    expect(contentLimiters.rfqBurst.check('42', now).allowed).toBe(false);
  });

  it('reports how long the caller must wait, in whole milliseconds', () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) contentLimiters.rfqBurst.check('42', now);
    const blocked = contentLimiters.rfqBurst.check('42', now + 15_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(45_000);
  });

  it('the window expires, so a limit is never a permanent lockout', () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) contentLimiters.rfqBurst.check('42', now);
    expect(contentLimiters.rfqBurst.check('42', now).allowed).toBe(false);
    expect(contentLimiters.rfqBurst.check('42', now + 60_000).allowed).toBe(true);
  });

  it('is keyed per account, so one abuser cannot lock out everybody else', () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) contentLimiters.rfqBurst.check('42', now);
    expect(contentLimiters.rfqBurst.check('42', now).allowed).toBe(false);
    expect(contentLimiters.rfqBurst.check('43', now).allowed).toBe(true);
  });

  it('the sustained window still bites after several burst windows have passed', () => {
    // The property a burst limit alone does not give: a patient script that
    // waits out each minute is still capped over the hour.
    let now = 1_000_000;
    let allowed = 0;
    for (let minute = 0; minute < 30; minute++) {
      for (let i = 0; i < 3; i++) {
        const burst = contentLimiters.rfqBurst.check('42', now);
        const sustained = contentLimiters.rfqSustained.check('42', now);
        if (burst.allowed && sustained.allowed) allowed++;
      }
      now += 60_000;
    }
    expect(allowed).toBe(20);
  });

  it('upload budgets are larger than RFQ budgets, because one RFQ carries several files', () => {
    // A form with six attachments must not trip the limit that guards the RFQ
    // itself. If these ever invert, filling in one RFQ becomes impossible.
    const now = 1_000_000;
    let uploads = 0;
    while (contentLimiters.uploadBurst.check('42', now).allowed) uploads++;
    let rfqs = 0;
    while (contentLimiters.rfqBurst.check('43', now).allowed) rfqs++;
    expect(uploads).toBeGreaterThan(6);
    expect(uploads).toBeGreaterThan(rfqs);
  });
});

describe('the limiter is actually wired to the endpoints that needed it', () => {
  it('rfq.create enforces the RFQ limit before it writes anything', () => {
    const body = procedureBody('  create: protectedProcedure', 'uploadAttachment: protectedProcedure');
    expect(body, 'rfq.create is unbounded again').toContain('enforceRfqRateLimit(ctx.user.id)');
    // The write moved inside a transaction when RFQ items were added, so the
    // insert is `tx.insert(rfqs)` now. The rule under test is unchanged: the
    // limiter runs BEFORE anything is written.
    const writeAt = body.indexOf('insert(rfqs)');
    expect(writeAt, 'the RFQ insert must still be findable in this procedure').toBeGreaterThan(-1);
    expect(
      body.indexOf('enforceRfqRateLimit'),
      'the limit must be checked before the insert, not after',
    ).toBeLessThan(writeAt);
  });

  it('every upload path enforces the upload limit, named upload* or not', () => {
    // Counted rather than spot-checked: the gap was identical at every one of
    // them, and a fix applied to four out of five is not a fix.
    // NINE now: bulk product import accepts a file too, and an unbounded
    // import endpoint is the cheapest way to fill a database.
    // TEN limits over NINE endpoints, and the extra one is not a miscount:
    // bulk product import accepts a file without being named upload*, so it
    // takes a limit of its own. Portfolio image upload is the ninth endpoint,
    // added with provider portfolios.
    // ELEVEN over TEN endpoints since dispute evidence became an upload path:
    // an authenticated party can otherwise push 10MB per request in a loop, and
    // the dispute they are pushing into is one they are entitled to write to.
    // TWELVE over TEN endpoints since a project document can be replaced:
    // `replaceDocument` accepts a file without being named upload*, exactly
    // like bulk product import, so it takes a limit of its own. An
    // authenticated member could otherwise push 8MB per request in a loop
    // into a project they are entitled to write to.
    const wired = SOURCE.match(/enforceUploadRateLimit\(ctx\.user\.id\)/g) ?? [];
    expect(wired).toHaveLength(12);

    const uploadEndpoints = SOURCE.match(/^\s+upload[A-Za-z]+:/gm) ?? [];
    expect(
      uploadEndpoints,
      'an upload endpoint was added or removed - it needs a rate limit too',
    ).toHaveLength(9);
  });

  it('the limit runs before the file is decoded, not after', () => {
    // Decoding an 11MB base64 payload is the expensive part. Checking the limit
    // afterwards would still let an attacker burn CPU and memory at will.
    const body = procedureBody('  uploadAttachment: protectedProcedure\n', 'myQuotations:');
    const limit = body.indexOf('enforceUploadRateLimit');
    const decode = body.indexOf('Buffer.from(input.base64');
    expect(limit).toBeGreaterThan(-1);
    expect(decode).toBeGreaterThan(-1);
    expect(limit).toBeLessThan(decode);
  });

  it('content limits are keyed by user id only, never by IP', () => {
    // Deliberate. Every endpoint here already requires a session, and an IP axis
    // would import the carrier-grade-NAT problem the auth limiters had to be
    // loosened for: in Egypt one public IPv4 can front a whole mobile carrier or
    // a site office, so an IP limit throttles a contractor's entire team.
    const helper = procedureBody('function enforceContentRateLimit', 'const authRouter');
    expect(helper).not.toContain('getClientIp');
    expect(helper).toContain('String(userId)');
  });

  it('a blocked request is TOO_MANY_REQUESTS, matching the auth limiter', () => {
    const helper = procedureBody('function enforceContentRateLimit', 'const authRouter');
    expect(helper).toContain("code: 'TOO_MANY_REQUESTS'");
  });
});

/**
 * ── MESSAGES, THE ONE CONTENT ENDPOINT THAT HAD NO BOUND ──────────────────
 *
 * BuildHub deliberately does NOT require a prior relationship before one
 * account may message another: a customer is meant to be able to contact a
 * vendor they have just found, and whether that should change is recorded as
 * an owner decision. That policy is precisely why the send has to be bounded.
 * With no relationship gate, the rate limit is the only thing between one
 * stolen account and every vendor in the directory.
 *
 * Proven over the real endpoint before any of this existed
 * (evidence/zg-messageflood.mjs, 4/7): seventy-eight messages to twelve
 * strangers in a few seconds, every one delivered and every one notified.
 *
 * Two axes, because volume and breadth are different abuses, and the tests
 * below keep them separable - a breadth rule that only ever fires because the
 * volume rule fired first is a rule nobody has tested.
 */
describe('messaging is bounded on volume AND on breadth', () => {
  beforeEach(() => resetContentLimiters());

  it('lets a fast conversation run without interruption', () => {
    const now = 2_000_000;
    // A negotiation is a sentence at a time. Fifteen in a minute has to be
    // comfortable or the limit becomes a product defect of its own.
    for (let i = 0; i < 15; i++) {
      expect(contentLimiters.messageBurst.check('7', now).allowed, `message ${i + 1}`).toBe(true);
    }
    expect(contentLimiters.messageBurst.check('7', now).allowed).toBe(false);
  });

  it('caps the hour well above any real conversation', () => {
    const now = 2_000_000;
    for (let i = 0; i < 150; i++) {
      expect(contentLimiters.messageSustained.check('7', now).allowed, `message ${i + 1}`).toBe(true);
    }
    expect(contentLimiters.messageSustained.check('7', now).allowed).toBe(false);
  });

  it('counts new conversations separately and much more tightly', () => {
    const now = 2_000_000;
    for (let i = 0; i < 20; i++) {
      expect(contentLimiters.messageNewThread.check('7', now).allowed, `approach ${i + 1}`).toBe(true);
    }
    expect(contentLimiters.messageNewThread.check('7', now).allowed).toBe(false);
    // And the breadth ceiling must sit BELOW the volume ceiling, or it can
    // never be the rule that fires - which is how an untested rule survives.
    expect(contentLimiters.messageBurst.check('8', now).allowed).toBe(true);
  });

  it('one account running out does not touch another', () => {
    const now = 2_000_000;
    for (let i = 0; i < 20; i++) contentLimiters.messageNewThread.check('7', now);
    expect(contentLimiters.messageNewThread.check('7', now).allowed).toBe(false);
    expect(contentLimiters.messageNewThread.check('99', now).allowed).toBe(true);
  });

  it('resetContentLimiters clears the message limiters too', () => {
    const now = 2_000_000;
    for (let i = 0; i < 15; i++) contentLimiters.messageBurst.check('7', now);
    expect(contentLimiters.messageBurst.check('7', now).allowed).toBe(false);
    resetContentLimiters();
    expect(contentLimiters.messageBurst.check('7', now).allowed).toBe(true);
  });
});

describe('the message limits are wired to messages.send', () => {
  const SEND = procedureBody('  send: protectedProcedure', '  uploadAttachment: protectedProcedure');

  it('checks the volume limit before it touches the database', () => {
    expect(SEND, 'messages.send is unbounded again').toContain('enforceMessageRateLimit(ctx.user.id)');
    const limit = SEND.indexOf('enforceMessageRateLimit');
    const db = SEND.indexOf('await getDb()');
    expect(db, 'the db handle must still be findable in this procedure').toBeGreaterThan(-1);
    expect(limit, 'a flood should cost the server nothing').toBeLessThan(db);
  });

  it('charges the breadth limit only when there is no history', () => {
    expect(SEND).toContain('enforceNewConversationRateLimit(ctx.user.id)');
    // Guarded on the absence of a prior message, so an established thread is
    // never charged for the threads that came before it.
    expect(SEND).toContain('if (!priorContact) enforceNewConversationRateLimit');
  });

  it('treats a reply as history, not as a new conversation', () => {
    // The pair is looked up in BOTH directions: a vendor answering a customer
    // who wrote first is continuing a conversation, and charging them a cold
    // approach for it would throttle exactly the behaviour the product wants.
    expect(SEND).toContain('eq(messages.senderId, ctx.user.id), eq(messages.receiverId, input.receiverId)');
    expect(SEND).toContain('eq(messages.senderId, input.receiverId), eq(messages.receiverId, ctx.user.id)');
  });

  it('refuses before the row is written, not after', () => {
    const breadth = SEND.indexOf('enforceNewConversationRateLimit(ctx.user.id)');
    const write = SEND.indexOf('db.insert(messages)');
    expect(write, 'the message insert must still be findable').toBeGreaterThan(-1);
    expect(breadth).toBeLessThan(write);
  });

  it('the pair lookup is indexed, in both directions', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const schema = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');
    // Without these the check scans an active account's whole correspondence
    // on every send, and the cost grows with the account's own history.
    expect(schema).toContain("index('messages_sender_receiver_idx').on(table.senderId, table.receiverId)");
    expect(schema).toContain("index('messages_receiver_sender_idx').on(table.receiverId, table.senderId)");
  });
});
