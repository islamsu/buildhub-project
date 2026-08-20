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
export const authLimiters = {
  ipBurst: createRateLimiter({ windowMs: 60_000, max: 10 }),
  ipSustained: createRateLimiter({ windowMs: 15 * 60_000, max: 60 }),
  identifierSustained: createRateLimiter({ windowMs: 15 * 60_000, max: 10 }),
};

export function resetAuthLimiters() {
  authLimiters.ipBurst.reset();
  authLimiters.ipSustained.reset();
  authLimiters.identifierSustained.reset();
}
