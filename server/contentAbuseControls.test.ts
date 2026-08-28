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
    expect(
      body.indexOf('enforceRfqRateLimit'),
      'the limit must be checked before the insert, not after',
    ).toBeLessThan(body.indexOf('db.insert(rfqs)'));
  });

  it('all eight upload endpoints enforce the upload limit', () => {
    // Counted rather than spot-checked: the gap was identical at every one of
    // them, and a fix applied to four out of five is not a fix.
    const wired = SOURCE.match(/enforceUploadRateLimit\(ctx\.user\.id\)/g) ?? [];
    expect(wired).toHaveLength(8);

    const uploadEndpoints = SOURCE.match(/^\s+upload[A-Za-z]+:/gm) ?? [];
    expect(
      uploadEndpoints,
      'an upload endpoint was added or removed - it needs a rate limit too',
    ).toHaveLength(8);
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
