export type RateLimitResult = { allowed: boolean; retryAfterMs: number };

// Fixed-window counter. Deterministic and easy to test with an injected clock; adequate for a
// single-process Express deployment with no existing distributed-cache infrastructure to lean on.
export function createRateLimiter(options: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; windowStart: number }>();

  function check(key: string, now: number = Date.now()): RateLimitResult {
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart >= options.windowMs) {
      hits.set(key, { count: 1, windowStart: now });
      if (hits.size > 10_000) sweep(now);
      return { allowed: true, retryAfterMs: 0 };
    }
    if (entry.count >= options.max) {
      return { allowed: false, retryAfterMs: options.windowMs - (now - entry.windowStart) };
    }
    entry.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  function sweep(now: number) {
    hits.forEach((entry, key) => {
      if (now - entry.windowStart >= options.windowMs) hits.delete(key);
    });
  }

  function reset(key?: string) {
    if (key) hits.delete(key);
    else hits.clear();
  }

  return { check, reset };
}

type MinimalRequest = {
  headers: { [key: string]: string | string[] | undefined };
  socket?: { remoteAddress?: string | null };
};

export function getClientIp(req: MinimalRequest): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  if (Array.isArray(forwarded) && forwarded.length > 0) return forwarded[0];
  return req.socket?.remoteAddress ?? null;
}

// ai.chat abuse protection: a short burst window catches rapid-fire scripted calls, a longer
// sustained window caps total volume; both per authenticated user and per source IP so one
// compromised/shared account or one IP running many accounts are both bounded.
export const aiChatLimiters = {
  userBurst: createRateLimiter({ windowMs: 10_000, max: 5 }),
  userSustained: createRateLimiter({ windowMs: 5 * 60_000, max: 20 }),
  ipBurst: createRateLimiter({ windowMs: 10_000, max: 10 }),
  ipSustained: createRateLimiter({ windowMs: 5 * 60_000, max: 60 }),
};

export function resetAiChatLimiters() {
  aiChatLimiters.userBurst.reset();
  aiChatLimiters.userSustained.reset();
  aiChatLimiters.ipBurst.reset();
  aiChatLimiters.ipSustained.reset();
}

// Credential-guessing protection for the two unauthenticated endpoints that accept a
// secret: password sign-in and invitation completion. Neither had any bound before -
// scrypt makes each guess costly, but nothing capped the guess RATE.
//
// Two axes, because they stop different attacks:
//  - by IP, which bounds one source spraying many accounts (or many tokens);
//  - by identifier (the username), which bounds many sources targeting ONE account,
//    the case an IP limit cannot see.
//
// The identifier window is deliberately not a lockout: it expires on its own, so an
// attacker cannot use it to keep a real user permanently locked out of their account.
// Invitation completion is keyed by IP only - keying it by token would be useless,
// since varying the token is exactly what a guessing attack does.
/**
 * Two different jobs, deliberately given very different budgets.
 *
 * `identifierSustained` is the one that protects an ACCOUNT. Ten attempts per
 * fifteen minutes against a single username or email makes password guessing
 * useless no matter how many addresses the attacker has. It is unchanged, and
 * should stay tight.
 *
 * The IP limiters do a different job: stopping one host from exhausting the
 * server or enumerating accounts wholesale. They were set to 10 per minute,
 * which is a sensible number if an IP means a person - and in Egypt it very
 * often does not. Mobile carriers here run carrier-grade NAT, so thousands of
 * subscribers share one public IPv4; so do offices, universities, and the site
 * offices BuildHub's contractors actually work from. At 10 per minute, one
 * busy NAT locks out every legitimate user behind it, and the people it fails
 * are exactly the vendors trying to sign in.
 *
 * Raising them does not weaken account security, because per-account brute
 * force is bounded by `identifierSustained` regardless of how many IP attempts
 * are permitted. Found during staging QA, where a normal automated run tripped
 * the limit within seconds from a single address.
 */
export const authLimiters = {
  ipBurst: createRateLimiter({ windowMs: 60_000, max: 60 }),
  ipSustained: createRateLimiter({ windowMs: 15 * 60_000, max: 300 }),
  identifierSustained: createRateLimiter({ windowMs: 15 * 60_000, max: 10 }),
};

export function resetAuthLimiters() {
  authLimiters.ipBurst.reset();
  authLimiters.ipSustained.reset();
  authLimiters.identifierSustained.reset();
}

// ── Authenticated content creation ─────────────────────────────────────────
//
// Sign-in was bounded; what an account could DO once signed in was not. Two
// endpoints could be driven in a loop by one authenticated caller:
//
//   rfq.create   floods the provider feed, which is the product's core surface;
//   the five upload endpoints  fill the bucket, which converts directly into a
//                              storage bill once S3 is configured.
//
// KEYED BY USER ID, NOT BY IP, and that is deliberate rather than lazy. Every
// endpoint below already requires a session, so the account is the natural
// subject: it is what an attacker has to acquire, and it is what a limit can
// meaningfully punish. Adding an IP axis would import the carrier-grade-NAT
// problem the auth limiters had to be loosened for - in Egypt thousands of
// mobile subscribers, and every site office, share one public IPv4, so an IP
// limit here would throttle a whole contractor's team for one busy colleague
// while doing nothing an account limit does not already do.
//
// Two windows, as elsewhere: the burst catches a script, the sustained window
// caps the daily damage a patient one can do.
export const contentLimiters = {
  // A human posts one RFQ at a time and thinks in between. Three a minute is
  // already generous; twenty an hour is far past any real posting behaviour.
  rfqBurst: createRateLimiter({ windowMs: 60_000, max: 3 }),
  rfqSustained: createRateLimiter({ windowMs: 60 * 60_000, max: 20 }),
  // An RFQ takes up to six attachments and registration onboarding takes
  // several documents, so a legitimate burst is real. Ten a minute covers
  // filling a form; sixty an hour covers a whole onboarding session and still
  // caps an unattended script at roughly half a gigabyte an hour at the 8MB
  // ceiling.
  uploadBurst: createRateLimiter({ windowMs: 60_000, max: 10 }),
  uploadSustained: createRateLimiter({ windowMs: 60 * 60_000, max: 60 }),
};

export function resetContentLimiters() {
  contentLimiters.rfqBurst.reset();
  contentLimiters.rfqSustained.reset();
  contentLimiters.uploadBurst.reset();
  contentLimiters.uploadSustained.reset();
}
