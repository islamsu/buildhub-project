/**
 * The /ai incident had to be diagnosed by timing HTTP requests from a GitHub
 * runner, because no onError handler was mounted on the tRPC middleware and
 * the deployment logged nothing at all when a request failed. These tests pin
 * the classification and, just as importantly, what it must never write down.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { TRPCError } from '@trpc/server';
import { classifyError, classifyErrorChain, onError } from './_core/trpcErrorLog';

const INDEX_SOURCE = readFileSync(new URL('./_core/index.ts', import.meta.url), 'utf8');

const wrap = (cause: Error) =>
  new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'anything', cause });

describe('server-side error classification', () => {
  it('separates a missing credential from every kind of provider failure', () => {
    expect(classifyError(new Error('BUILT_IN_FORGE_API_KEY is not configured')).category)
      .toBe('config-missing');
  });

  it.each([
    [401, 'provider-auth'],
    [403, 'provider-auth'],
    [429, 'provider-quota'],
    [500, 'provider-unavailable'],
    [503, 'provider-unavailable'],
    [400, 'provider-bad-request'],
  ])('classifies provider status %i as %s', (status, expected) => {
    const result = classifyError(new Error(`LLM invoke failed: ${status} Whatever – {"error":"..."}`));
    expect(result.category).toBe(expected);
    expect(result.status).toBe(status);
  });

  it('classifies an unreachable provider', () => {
    expect(classifyError(new TypeError('fetch failed')).category).toBe('provider-network');
    expect(classifyError(new Error('LLM request failed after exhausting retries')).category)
      .toBe('provider-network');
  });

  it('classifies a malformed provider reply', () => {
    expect(classifyError(new Error('Unexpected token < in JSON at position 0')).category)
      .toBe('response-parse');
  });

  it('falls through to unclassified rather than guessing', () => {
    expect(classifyError(new Error('something nobody anticipated')).category).toBe('unclassified');
  });

  describe('what reaches the log', () => {
    let logged: string[];
    beforeEach(() => {
      logged = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args.join(' ')); });
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('records the procedure and the category', () => {
      onError({ error: wrap(new Error('BUILT_IN_FORGE_API_KEY is not configured')), path: 'ai.chat', type: 'mutation' });
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain('ai.chat');
      expect(logged[0]).toContain('config-missing');
    });

    it('never writes the provider body, which can echo the user prompt', () => {
      // A provider that reflects the request would otherwise put private
      // project details and budgets into the deployment log.
      const leaky = new Error(
        'LLM invoke failed: 400 Bad Request – {"error":{"message":"invalid request","prompt":"my villa budget is 4,000,000 EGP"}}',
      );
      onError({ error: wrap(leaky), path: 'ai.chat', type: 'mutation' });
      expect(logged[0]).not.toContain('4,000,000');
      expect(logged[0]).not.toContain('villa');
      expect(logged[0]).toContain('provider-bad-request');
      expect(logged[0]).toContain('400');
    });

    it('never writes a credential even if one is interpolated into the error', () => {
      const leaky = new Error('LLM invoke failed: 401 Unauthorized – sent authorization: Bearer sk-live-SECRETVALUE');
      onError({ error: wrap(leaky), path: 'ai.chat', type: 'mutation' });
      expect(logged[0]).not.toContain('SECRETVALUE');
      expect(logged[0]).not.toContain('Bearer');
      expect(logged[0]).toContain('provider-auth');
    });

    it('stays quiet for deliberate refusals the caller already understands', () => {
      for (const code of ['SERVICE_UNAVAILABLE', 'FORBIDDEN', 'NOT_FOUND', 'TOO_MANY_REQUESTS', 'UNAUTHORIZED'] as const) {
        onError({ error: new TRPCError({ code, message: 'a deliberate refusal' }), path: 'ai.chat', type: 'mutation' });
      }
      expect(logged).toHaveLength(0);
    });
  });

  it('is actually mounted - a classifier nobody calls diagnoses nothing', () => {
    const executable = INDEX_SOURCE.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect(executable).toContain('onError');
    const mount = executable.slice(executable.indexOf('createExpressMiddleware({'));
    expect(mount.slice(0, mount.indexOf('})'))).toContain('onError');
  });
});

/**
 * WHAT AN OPERATOR ACTUALLY SAW WHEN SIGN-UP BROKE.
 *
 * Registration failed for every user on a deployment whose schema was behind.
 * The browser said "Something went wrong. Please try again." - correct - and
 * the server log said:
 *
 *   [trpc] mutation auth.signUp failed: unclassified - no classification
 *   matched - inspect the deployment logs around this line
 *
 * There was nothing around that line. The log told the operator to read the
 * log. Two separate causes: drizzle wraps the driver error, so the `database`
 * rule never saw the ER_ code one level down; and for a genuinely unrecognised
 * error nothing at all was written to identify it.
 */
describe('an unrecognised error still tells the operator where to look', () => {
  const logged: string[] = [];
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logged.length = 0;
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args.join(' ')); });
  });
  afterEach(() => spy.mockRestore());

  const wrapped = (message: string, depth: number) => {
    let error = new Error(message);
    for (let i = 0; i < depth; i += 1) {
      error = Object.assign(new Error('DrizzleQueryError'), { name: 'DrizzleQueryError', cause: error });
    }
    return error;
  };

  it('classifies a driver error the ORM has wrapped', () => {
    // The single-level classifier returned `unclassified` for exactly this.
    const nested = wrapped("Unknown column 'messageKey' in 'field list'", 1);
    expect(classifyError(nested).category, 'the outermost error alone is unclassifiable').toBe('unclassified');
    expect(classifyErrorChain(nested).category).toBe('database');
  });

  it('follows the chain more than one level down', () => {
    expect(classifyErrorChain(wrapped('ER_NO_SUCH_TABLE: quotations', 3)).category).toBe('database');
  });

  it('does not loop forever on a self-referencing cause', () => {
    const loop = new Error('nothing recognisable') as Error & { cause?: unknown };
    loop.cause = loop;
    expect(classifyErrorChain(loop).category).toBe('unclassified');
  });

  it('a wrapped database failure is logged as `database`, not `unclassified`', () => {
    onError({
      error: new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'x', cause: wrapped('ER_BAD_FIELD_ERROR', 1) }),
      path: 'auth.signUp', type: 'mutation',
    });
    expect(logged[0]).toContain('database');
    expect(logged[0]).not.toContain('unclassified');
  });

  it('an unclassifiable error names its class and the frame that threw it', () => {
    const mystery = new Error('something nobody has a rule for');
    onError({ error: wrap(mystery), path: 'rfq.create', type: 'mutation' });
    expect(logged[0]).toContain('unclassified');
    expect(logged[0], 'the origin is the whole point of the fix').toContain('origin:');
    expect(logged[0]).toContain('Error');
    // A file and a line, written by the runtime - the thing that was missing.
    expect(logged[0]).toMatch(/origin:[^\]]*\.(ts|js|mjs|cjs):\d+/);
  });

  it('the remedy no longer tells the operator to read the log they are reading', () => {
    onError({ error: wrap(new Error('unrecognised')), path: 'rfq.create', type: 'mutation' });
    expect(logged[0]).not.toContain('inspect the deployment logs around this line');
  });

  it('the origin never carries the error message, which can hold user data', () => {
    // A driver error interpolates the offending value. `originOf` is only
    // reached when nothing classified, which is exactly when the temptation to
    // dump the message is strongest - so this is the assertion that must hold.
    const leaky = new Error("Duplicate entry 'hala.mostafa@example.com' for key 'users_email_unique'");
    Object.defineProperty(leaky, 'name', { value: 'SomeUnknownError' });
    onError({ error: wrap(leaky), path: 'auth.signUp', type: 'mutation' });
    expect(logged[0]).not.toContain('hala.mostafa@example.com');
    expect(logged[0]).not.toContain('Duplicate entry');
    expect(logged[0]).toContain('SomeUnknownError');
  });

  it('a classified error stays terse - the origin is only for the unknown case', () => {
    onError({ error: wrap(new Error('OPENAI_API_KEY is not configured')), path: 'ai.chat', type: 'mutation' });
    expect(logged[0]).toContain('config-missing');
    expect(logged[0]).not.toContain('origin:');
  });

  it('a bare string thrown from a procedure still yields a throw site', () => {
    // tRPC normalises whatever was thrown into an Error before it reaches
    // onError, so the `non-Error thrown` fallback is defensive and is not on
    // this path - what matters is that the log still names a file and a line.
    onError({
      error: new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'x', cause: 'a bare string' as unknown as Error }),
      path: 'rfq.create', type: 'mutation',
    });
    expect(logged[0]).toContain('unclassified');
    expect(logged[0]).toMatch(/origin:[^\]]*:\d+/);
    expect(logged[0], 'the thrown text is still not written down').not.toContain('a bare string');
  });
});
