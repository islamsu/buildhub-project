/**
 * The OpenAI provider boundary.
 *
 * BuildHub AI was migrated off the Manus Forge gateway to the OpenAI Responses
 * API. These tests pin the request shape, the failure taxonomy, and - most
 * importantly - the two ways this integration can quietly lie: returning an
 * empty answer as a success, and letting a credential escape.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const AI_SOURCE = readFileSync(new URL('./_core/ai.ts', import.meta.url), 'utf8');

const ORIGINAL = {
  key: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
  base: process.env.OPENAI_BASE_URL,
};

/** Fresh module graph per case: ENV snapshots process.env at import time. */
async function loadAi(env: { key?: string; model?: string; base?: string } = {}) {
  vi.resetModules();
  if (env.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = env.key;
  if (env.model === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = env.model;
  if (env.base === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = env.base;
  return import('./_core/ai');
}

/**
 * One APIError class, shared by the mocked module and by the tests that throw
 * it. This matters: `ai.ts` classifies with `error instanceof APIError`, so a
 * test that throws a DIFFERENT class - say, one pulled through require() past
 * the mock - lands in the network branch and every status assertion fails for
 * a reason that has nothing to do with the code under test.
 */
class FakeAPIError extends Error {
  status?: number; code?: string | null; type?: string | null;
  constructor(status?: number, error?: { code?: string | null; type?: string | null }, message?: string) {
    super(message ?? 'api error');
    this.status = status; this.code = error?.code ?? null; this.type = error?.type ?? null;
  }
}

/** Stand in for the SDK so no test can reach the network or spend money. */
function mockSdk(impl: (args: any) => any) {
  const create = vi.fn(impl);
  const ctor = vi.fn(function (this: any) { this.responses = { create }; });
  vi.doMock('openai', () => ({
    __esModule: true,
    default: ctor,
    APIError: FakeAPIError,
  }));
  return { create, ctor };
}

describe('the OpenAI provider', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => {
    vi.doUnmock('openai');
    for (const [k, v] of [['OPENAI_API_KEY', ORIGINAL.key], ['OPENAI_MODEL', ORIGINAL.model], ['OPENAI_BASE_URL', ORIGINAL.base]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  describe('configuration', () => {
    it('is unconfigured with no key', async () => {
      const ai = await loadAi({});
      expect(ai.isAiConfigured()).toBe(false);
    });

    it('is configured with a key, and defaults to gpt-5.6-luna', async () => {
      const ai = await loadAi({ key: 'sk-test' });
      expect(ai.isAiConfigured()).toBe(true);
      expect(ai.aiModelName()).toBe('gpt-5.6-luna');
    });

    it('honours OPENAI_MODEL so the model can change without a code change', async () => {
      // Asserted on the REQUEST, not on the getter. A version of this test that
      // only checked aiModelName() passed happily while the request body sent a
      // hard-coded literal - the getter reported the configured model and the
      // provider was asked for a different one.
      const { create } = mockSdk(() => ({ output_text: 'ok', status: 'completed' }));
      const ai = await loadAi({ key: 'sk-test', model: 'gpt-5.6-terra' });
      expect(ai.aiModelName()).toBe('gpt-5.6-terra');
      await ai.generateAIResponse({ messages: [{ role: 'user', content: 'hi' }] });
      expect(create.mock.calls[0][0].model).toBe('gpt-5.6-terra');
    });

    it('whitespace is not a credential', async () => {
      const ai = await loadAi({ key: '   ' });
      expect(ai.isAiConfigured()).toBe(false);
    });

    it('refuses before constructing a client when unconfigured', async () => {
      const { ctor } = mockSdk(() => ({ output_text: 'hi', status: 'completed' }));
      const ai = await loadAi({});
      await expect(ai.generateAIResponse({ messages: [{ role: 'user', content: 'hi' }] }))
        .rejects.toMatchObject({ category: 'config-missing' });
      expect(ctor).not.toHaveBeenCalled();
    });
  });

  describe('the request it actually sends', () => {
    it('uses the Responses API with the configured model', async () => {
      const { create } = mockSdk(() => ({ output_text: 'ok', status: 'completed' }));
      const ai = await loadAi({ key: 'sk-test' });
      await ai.generateAIResponse({ messages: [{ role: 'user', content: 'How much to finish 150m2?' }] });
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0]).toMatchObject({ model: 'gpt-5.6-luna' });
    });

    it('NEVER sends temperature - GPT-5 models reject it', async () => {
      // This is not a style preference. The GPT-5 family are reasoning models
      // and do not accept `temperature`; sending it turns every request into a
      // 400 and the assistant is dead again.
      const { create } = mockSdk(() => ({ output_text: 'ok', status: 'completed' }));
      const ai = await loadAi({ key: 'sk-test' });
      await ai.generateAIResponse({ messages: [{ role: 'user', content: 'hi' }] });
      expect(create.mock.calls[0][0]).not.toHaveProperty('temperature');
      expect(AI_SOURCE.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')).not.toContain('temperature:');
    });

    it('carries the system prompt as instructions, not as a conversation turn', async () => {
      const { create } = mockSdk(() => ({ output_text: 'ok', status: 'completed' }));
      const ai = await loadAi({ key: 'sk-test' });
      await ai.generateAIResponse({ messages: [
        { role: 'system', content: 'You are BuildHub AI.' },
        { role: 'user', content: 'hello' },
      ] });
      const sent = create.mock.calls[0][0];
      expect(sent.instructions).toContain('You are BuildHub AI.');
      expect(sent.input).toEqual([{ role: 'user', content: 'hello' }]);
    });

    it('bounds the output so one request cannot run away with the budget', async () => {
      const { create } = mockSdk(() => ({ output_text: 'ok', status: 'completed' }));
      const ai = await loadAi({ key: 'sk-test' });
      await ai.generateAIResponse({ messages: [{ role: 'user', content: 'hi' }] });
      expect(typeof create.mock.calls[0][0].max_output_tokens).toBe('number');
      expect(create.mock.calls[0][0].max_output_tokens).toBeLessThanOrEqual(8192);
    });

    it('bounds retries - three attempts total, not a retry storm', async () => {
      const { ctor } = mockSdk(() => ({ output_text: 'ok', status: 'completed' }));
      const ai = await loadAi({ key: 'sk-test' });
      await ai.generateAIResponse({ messages: [{ role: 'user', content: 'hi' }] });
      const options = ctor.mock.calls[0][0];
      expect(options.maxRetries).toBeLessThanOrEqual(2);
      expect(typeof options.timeout).toBe('number');
    });

    it('passes conversation content and nothing else', async () => {
      // No user id, no session, no database rows, no environment: the provider
      // sees the chat and the system prompt, full stop.
      const { create } = mockSdk(() => ({ output_text: 'ok', status: 'completed' }));
      const ai = await loadAi({ key: 'sk-test' });
      await ai.generateAIResponse({ messages: [{ role: 'user', content: 'hi' }] });
      const sent = JSON.stringify(create.mock.calls[0][0]);
      for (const forbidden of ['sk-test', 'OPENAI_API_KEY', 'JWT', 'cookie', 'session', 'password']) {
        expect(sent).not.toContain(forbidden);
      }
    });
  });

  describe('the answer it returns', () => {
    it('returns only { text } - no provider object escapes', async () => {
      mockSdk(() => ({
        output_text: 'Roughly 450,000 EGP.',
        status: 'completed',
        id: 'resp_123', model: 'gpt-5.6-luna', usage: { input_tokens: 10, output_tokens: 20 },
      }));
      const ai = await loadAi({ key: 'sk-test' });
      const result = await ai.generateAIResponse({ messages: [{ role: 'user', content: 'hi' }] });
      expect(Object.keys(result)).toEqual(['text']);
      expect(result.text).toBe('Roughly 450,000 EGP.');
    });

    it('treats a truncated reasoning-only response as a FAILURE, not an empty success', async () => {
      // The documented trap: when max_output_tokens is consumed by reasoning,
      // the response is status "incomplete" with no message item, so
      // output_text is empty - and the request is still billed. Returning that
      // as success shows the user a blank answer and calls the feature working.
      mockSdk(() => ({ output_text: '', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }));
      const ai = await loadAi({ key: 'sk-test' });
      await expect(ai.generateAIResponse({ messages: [{ role: 'user', content: 'hi' }] }))
        .rejects.toMatchObject({ category: 'response-empty' });
    });

    it('treats whitespace-only text as empty', async () => {
      mockSdk(() => ({ output_text: '   \n  ', status: 'completed' }));
      const ai = await loadAi({ key: 'sk-test' });
      await expect(ai.generateAIResponse({ messages: [{ role: 'user', content: 'hi' }] }))
        .rejects.toMatchObject({ category: 'response-empty' });
    });

    it('treats a missing output_text as empty rather than returning undefined', async () => {
      mockSdk(() => ({ status: 'completed' }));
      const ai = await loadAi({ key: 'sk-test' });
      await expect(ai.generateAIResponse({ messages: [{ role: 'user', content: 'hi' }] }))
        .rejects.toMatchObject({ category: 'response-empty' });
    });
  });

  describe('the failure taxonomy', () => {
    const cases: Array<[number, string | null, string]> = [
      [401, null, 'provider-auth'],
      [403, null, 'provider-auth'],
      [429, 'rate_limit_exceeded', 'provider-rate-limit'],
      [429, 'insufficient_quota', 'provider-quota'],
      [400, null, 'provider-bad-request'],
      [404, null, 'provider-bad-request'],
      [500, null, 'provider-unavailable'],
      [503, null, 'provider-unavailable'],
    ];

    it.each(cases)('status %i (%s) -> %s', async (status, code, expected) => {
      mockSdk(() => { throw new FakeAPIError(status, { code }, 'provider said no'); });
      const ai = await loadAi({ key: 'sk-test' });
      await expect(ai.generateAIResponse({ messages: [{ role: 'user', content: 'hi' }] }))
        .rejects.toMatchObject({ category: expected, status });
    });

    it('classifies a timeout separately from a generic network failure', async () => {
      mockSdk(() => { throw new Error('Request timed out.'); });
      const ai = await loadAi({ key: 'sk-test' });
      await expect(ai.generateAIResponse({ messages: [{ role: 'user', content: 'hi' }] }))
        .rejects.toMatchObject({ category: 'provider-timeout' });
    });

    it('classifies an unreachable provider', async () => {
      mockSdk(() => { throw new TypeError('fetch failed'); });
      const ai = await loadAi({ key: 'sk-test' });
      await expect(ai.generateAIResponse({ messages: [{ role: 'user', content: 'hi' }] }))
        .rejects.toMatchObject({ category: 'provider-network' });
    });

    it('no thrown error carries the credential or the provider body', async () => {
      mockSdk(() => { throw new FakeAPIError(401, { code: 'invalid_api_key' }, 'Incorrect API key provided: sk-test-SECRET123'); });
      const ai = await loadAi({ key: 'sk-test-SECRET123' });
      const error = await ai.generateAIResponse({ messages: [{ role: 'user', content: 'hi' }] })
        .then(() => null, (e: Error) => e);
      expect(error).not.toBeNull();
      expect(error!.message).not.toContain('SECRET123');
      expect(error!.message).not.toContain('Bearer');
      expect(error!.message).not.toContain('Incorrect API key');
    });
  });

  describe('the Manus gateway is gone from this path', () => {
    it('the provider module names no Forge variable and no Manus host', () => {
      for (const gone of ['BUILT_IN_FORGE_API_KEY', 'BUILT_IN_FORGE_API_URL', 'forge.manus.im', 'forgeApiKey', 'forgeApiUrl']) {
        expect(AI_SOURCE).not.toContain(gone);
      }
    });

    it('the old modules no longer exist', async () => {
      await expect(import('./_core/llm')).rejects.toBeTruthy();
      await expect(import('./openaiIntegration')).rejects.toBeTruthy();
    });
  });
});
