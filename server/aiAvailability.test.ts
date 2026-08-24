/**
 * The /ai incident: eight tools rendered, none of them able to answer.
 *
 * Root cause was configuration - BUILT_IN_FORGE_API_KEY was never set on
 * staging - but the reason it took a live probe to establish that is entirely
 * in the code, and that part is what these tests pin:
 *
 *   1. the guard named the WRONG variable, sending configuration effort at
 *      OPENAI_API_KEY, which this path does not read;
 *   2. an unconfigured deployment threw a bare Error, so the caller got
 *      INTERNAL_SERVER_ERROR masked to "Something went wrong. Please try
 *      again." - indistinguishable from a genuine crash;
 *   3. nothing told the client the feature was unavailable, so the page
 *      offered every tool anyway.
 *
 * Each test below fails if any of those three come back.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import type { TrpcContext } from './_core/context';
import { resetAiChatLimiters } from './_core/rateLimit';

const LLM_SOURCE = readFileSync(new URL('./_core/llm.ts', import.meta.url), 'utf8');
const PAGE_SOURCE = readFileSync(new URL('../client/src/pages/AIAssistantPage.tsx', import.meta.url), 'utf8');
const RENDER_YAML = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');

function makeCtx(userId: number | null): TrpcContext {
  return {
    user: userId === null ? null : {
      id: userId, openId: `user-${userId}`, email: `u${userId}@test.com`, name: 'U',
      loginMethod: 'password', role: 'user', userRole: 'homeowner', accountStatus: 'active',
      isDummy: false, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: 'https', headers: { 'x-forwarded-for': '9.9.9.9' } } as TrpcContext['req'],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  } as TrpcContext;
}

// The env module snapshots process.env at import time, so each case needs a
// fresh module graph rather than a mutated singleton.
async function freshRouter(forgeKey: string | undefined) {
  vi.resetModules();
  if (forgeKey === undefined) delete process.env.BUILT_IN_FORGE_API_KEY;
  else process.env.BUILT_IN_FORGE_API_KEY = forgeKey;
  const { appRouter } = await import('./routers');
  return appRouter;
}

const ORIGINAL_KEY = process.env.BUILT_IN_FORGE_API_KEY;

describe('AI availability is honest about itself', () => {
  beforeEach(() => { resetAiChatLimiters(); });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.BUILT_IN_FORGE_API_KEY;
    else process.env.BUILT_IN_FORGE_API_KEY = ORIGINAL_KEY;
  });

  it('the provider guard names the variable it actually reads', () => {
    // The defect: it threw "OPENAI_API_KEY is not configured" while testing
    // ENV.forgeApiKey. Anyone who acted on that message configured a variable
    // this path never consults - and someone did: render.yaml carried
    // OPENAI_API_KEY and no FORGE key at all.
    const guard = LLM_SOURCE.slice(LLM_SOURCE.indexOf('const assertApiKey'));
    // Executable lines only. The comment inside the guard names OPENAI_API_KEY
    // deliberately - it explains the old message - and a naive substring match
    // over the raw text passes on the comment while the throw stays wrong.
    const body = guard.slice(0, guard.indexOf('};'))
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n');
    expect(body).toContain('BUILT_IN_FORGE_API_KEY is not configured');
    expect(body).not.toContain('OPENAI_API_KEY');
  });

  it('an unconfigured deployment reports the AI assistant as unavailable', async () => {
    const router = await freshRouter(undefined);
    const caps = await router.createCaller(makeCtx(null)).auth.capabilities();
    expect(caps.aiAssistant).toBe(false);
  });

  it('a configured deployment reports the AI assistant as available', async () => {
    const router = await freshRouter('a-key-shaped-value');
    const caps = await router.createCaller(makeCtx(null)).auth.capabilities();
    expect(caps.aiAssistant).toBe(true);
  });

  it('whitespace is not a credential', async () => {
    const router = await freshRouter('   ');
    const caps = await router.createCaller(makeCtx(null)).auth.capabilities();
    expect(caps.aiAssistant).toBe(false);
  });

  it('ai.chat refuses deliberately rather than throwing an internal error', async () => {
    const router = await freshRouter(undefined);
    const caller = router.createCaller(makeCtx(7));
    await expect(caller.ai.chat({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('the refusal names no variable, provider or endpoint', async () => {
    const router = await freshRouter(undefined);
    const caller = router.createCaller(makeCtx(8));
    const error = await caller.ai.chat({ messages: [{ role: 'user', content: 'hi' }] })
      .then(() => null, (e: unknown) => e as { message: string });
    expect(error).not.toBeNull();
    for (const leak of ['BUILT_IN_FORGE', 'OPENAI_API_KEY', 'forge.manus.im', 'api.openai.com', 'Bearer']) {
      expect(error!.message).not.toContain(leak);
    }
  });

  it('an unconfigured deployment never reaches the provider at all', async () => {
    // Cost, not just correctness: the refusal must short-circuit BEFORE
    // invokeLLM, which otherwise burns five attempts and ~3.75s of backoff
    // proving something the process already knew.
    vi.resetModules();
    delete process.env.BUILT_IN_FORGE_API_KEY;
    const invokeLLM = vi.fn();
    vi.doMock('./_core/llm', async () => {
      const actual = await vi.importActual<typeof import('./_core/llm')>('./_core/llm');
      return { ...actual, invokeLLM };
    });
    const { appRouter } = await import('./routers');
    await appRouter.createCaller(makeCtx(9)).ai.chat({ messages: [{ role: 'user', content: 'hi' }] })
      .catch(() => undefined);
    expect(invokeLLM).not.toHaveBeenCalled();
    vi.doUnmock('./_core/llm');
  });

  it('the page asks whether AI is available before offering the tools', () => {
    expect(PAGE_SOURCE).toContain('trpc.auth.capabilities.useQuery()');
    expect(PAGE_SOURCE).toContain("capabilities?.aiAssistant === false");
    // The cards must be inert, not merely faded.
    expect(PAGE_SOURCE).toContain('pointer-events-none');
    // …and the composer must refuse text rather than accepting a doomed send.
    expect(PAGE_SOURCE).toContain('disabled={aiUnavailable}');
  });

  it('the tools stay usable while the capability query is still in flight', () => {
    // `=== false` and not `!capabilities?.aiAssistant`: the latter disables the
    // whole page for the first render on a perfectly healthy deployment.
    expect(PAGE_SOURCE).not.toMatch(/const aiUnavailable\s*=\s*!/);
  });

  it('render.yaml asks for the variables the AI path actually reads', () => {
    expect(RENDER_YAML).toContain('key: BUILT_IN_FORGE_API_KEY');
    expect(RENDER_YAML).toContain('key: BUILT_IN_FORGE_API_URL');
  });
});
