/**
 * The /ai incident had to be diagnosed by timing HTTP requests from a GitHub
 * runner, because no onError handler was mounted on the tRPC middleware and
 * the deployment logged nothing at all when a request failed. These tests pin
 * the classification and, just as importantly, what it must never write down.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { TRPCError } from '@trpc/server';
import { classifyError, onError } from './_core/trpcErrorLog';

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
