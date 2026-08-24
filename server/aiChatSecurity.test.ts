import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));
vi.mock('./_core/llm', () => ({
  invokeLLM: vi.fn(),
  // This suite is about authorization, rate limiting and payload handling on a
  // deployment that HAS a provider. ai.chat now refuses before invoking when
  // none is configured, so the mock has to say which of the two worlds these
  // tests live in. The unconfigured world is covered by aiAvailability.test.ts.
  isLlmConfigured: () => true,
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { invokeLLM } from './_core/llm';
import { resetAiChatLimiters } from './_core/rateLimit';

function makeCtx(userId: number | null, ip = '1.2.3.4'): TrpcContext {
  return {
    user: userId === null ? null : {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@test.com`,
      name: `User ${userId}`,
      loginMethod: 'manus',
      role: 'user',
      userRole: 'homeowner',
      accountStatus: 'active',
      isDummy: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: 'https', headers: { 'x-forwarded-for': ip } } as TrpcContext['req'],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  } as TrpcContext;
}

const CANNED_RESPONSE = {
  choices: [{ message: { role: 'assistant', content: 'Hello!' } }],
};

describe('ai.chat (live production route)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiChatLimiters();
    (invokeLLM as ReturnType<typeof vi.fn>).mockResolvedValue(CANNED_RESPONSE);
  });

  it('an authenticated user can use the endpoint', async () => {
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.ai.chat({ messages: [{ role: 'user', content: 'Hi' }] })).resolves.toEqual({ content: 'Hello!' });
  });

  it('unauthenticated access is rejected (anonymous AI use is not a documented requirement)', async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(caller.ai.chat({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(invokeLLM).not.toHaveBeenCalled();
  });

  it('excessive requests from one user are rate limited (burst protection)', async () => {
    const caller = appRouter.createCaller(makeCtx(1));
    const outcomes: string[] = [];
    for (let i = 0; i < 8; i++) {
      try {
        await caller.ai.chat({ messages: [{ role: 'user', content: `msg ${i}` }] });
        outcomes.push('ok');
      } catch (err: any) {
        outcomes.push(err.code);
      }
    }
    // Burst limit is 5 per 10s per user - the 6th+ rapid call in the same window must be blocked.
    expect(outcomes.filter(o => o === 'ok')).toHaveLength(5);
    expect(outcomes.filter(o => o === 'TOO_MANY_REQUESTS')).toHaveLength(3);
  });

  it('one user hitting their limit does not block a different user', async () => {
    const callerA = appRouter.createCaller(makeCtx(1, '9.9.9.9'));
    const callerB = appRouter.createCaller(makeCtx(2, '8.8.8.8'));
    for (let i = 0; i < 5; i++) {
      await callerA.ai.chat({ messages: [{ role: 'user', content: `msg ${i}` }] });
    }
    await expect(callerA.ai.chat({ messages: [{ role: 'user', content: 'one more' }] })).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    // A different user on a different IP is unaffected.
    await expect(callerB.ai.chat({ messages: [{ role: 'user', content: 'hi' }] })).resolves.toEqual({ content: 'Hello!' });
  });

  it('many distinct users sharing one IP are still capped by the per-IP limit', async () => {
    const sharedIp = '203.0.113.5';
    const outcomes: string[] = [];
    for (let i = 0; i < 12; i++) {
      const caller = appRouter.createCaller(makeCtx(1000 + i, sharedIp));
      try {
        await caller.ai.chat({ messages: [{ role: 'user', content: 'hi' }] });
        outcomes.push('ok');
      } catch (err: any) {
        outcomes.push(err.code);
      }
    }
    // Per-IP burst limit is 10 per 10s, even though each call is a distinct user (so the
    // per-user limiter alone would have allowed all 12).
    expect(outcomes.filter(o => o === 'ok')).toHaveLength(10);
    expect(outcomes.filter(o => o === 'TOO_MANY_REQUESTS')).toHaveLength(2);
  });

  it('rejects an oversized message history', async () => {
    const caller = appRouter.createCaller(makeCtx(1));
    const messages = Array.from({ length: 41 }, (_, i) => ({ role: 'user' as const, content: `msg ${i}` }));
    await expect(caller.ai.chat({ messages })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(invokeLLM).not.toHaveBeenCalled();
  });

  it('rejects an oversized individual message', async () => {
    const caller = appRouter.createCaller(makeCtx(1));
    const messages = [{ role: 'user' as const, content: 'x'.repeat(6001) }];
    await expect(caller.ai.chat({ messages })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(invokeLLM).not.toHaveBeenCalled();
  });

  it('rejects an empty message array', async () => {
    const caller = appRouter.createCaller(makeCtx(1));
    await expect(caller.ai.chat({ messages: [] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(invokeLLM).not.toHaveBeenCalled();
  });

  it('enforces a server-side max_tokens ceiling regardless of client input', async () => {
    const caller = appRouter.createCaller(makeCtx(1));
    await caller.ai.chat({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(invokeLLM).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 1024 }));
  });

  it('the response never carries API credentials to the client', async () => {
    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.ai.chat({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(Object.keys(result)).toEqual(['content']);
  });
});
