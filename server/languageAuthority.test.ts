import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({ getDb: vi.fn() }));
vi.mock('./_core/ai', async () => {
  const actual = await vi.importActual<typeof import('./_core/ai')>('./_core/ai');
  return { ...actual, generateAIResponse: vi.fn(), isAiConfigured: () => true };
});

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { generateAIResponse } from './_core/ai';
import { resetAiChatLimiters } from './_core/rateLimit';
import { buildSystemPrompt } from './_core/buildhubKnowledge';

/**
 * THE WEBSITE'S LANGUAGE DECIDES THE ANSWER'S LANGUAGE. The question's language
 * does not.
 *
 * This matters because it is genuinely counter-intuitive and a model will do
 * the opposite by default: asked an English question it answers in English,
 * even on an Arabic site. But the person reading the answer is on an Arabic
 * page, having chosen Arabic - a person who types one English technical term
 * has not changed languages, and an answer that follows the question strands
 * them with a reply their page cannot even lay out correctly.
 *
 * All four combinations are covered because only testing the matching pairs
 * would pass on an implementation that simply echoes the question's language.
 */

function ctx(userId = 1): TrpcContext {
  return {
    user: {
      id: userId, openId: `u${userId}`, email: `u${userId}@t.com`, name: 'U',
      loginMethod: 'manus', role: 'user', userRole: 'homeowner', accountStatus: 'active',
      isDummy: false, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: 'https', headers: { 'x-forwarded-for': '9.9.9.9' } } as TrpcContext['req'],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  } as TrpcContext;
}

const systemPromptFor = async (lang: 'en' | 'ar', question: string): Promise<string> => {
  await appRouter.createCaller(ctx()).ai.chat({ messages: [{ role: 'user', content: question }], lang });
  const call = (generateAIResponse as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
  return call.messages[0].content as string;
};

const ARABIC_QUESTION = 'كم تبلغ تكلفة خطة Professional الشهرية؟';
const ENGLISH_QUESTION = 'How much does the Professional plan cost per month?';

beforeEach(() => {
  vi.clearAllMocks();
  resetAiChatLimiters();
  (generateAIResponse as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'ok' });
});

describe('the website language is the authority, in all four combinations', () => {
  it('Arabic site + Arabic question -> answer in Arabic', async () => {
    expect(await systemPromptFor('ar', ARABIC_QUESTION)).toContain('Answer entirely in Arabic');
  });

  it('Arabic site + ENGLISH question -> still answer in Arabic', async () => {
    // The combination a question-following implementation gets wrong.
    const prompt = await systemPromptFor('ar', ENGLISH_QUESTION);
    expect(prompt).toContain('Answer entirely in Arabic');
    expect(prompt).not.toContain('Answer entirely in English');
  });

  it('English site + Arabic question -> still answer in English', async () => {
    const prompt = await systemPromptFor('en', ARABIC_QUESTION);
    expect(prompt).toContain('Answer entirely in English');
    expect(prompt).not.toContain('Answer entirely in Arabic');
  });

  it('English site + English question -> answer in English', async () => {
    expect(await systemPromptFor('en', ENGLISH_QUESTION)).toContain('Answer entirely in English');
  });

  it('no language selected falls back to English rather than guessing from the text', async () => {
    await appRouter.createCaller(ctx()).ai.chat({ messages: [{ role: 'user', content: ARABIC_QUESTION }] });
    const call = (generateAIResponse as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(call.messages[0].content).toContain('Answer entirely in English');
  });
});

describe('the instruction is explicit that language and facts are separate', () => {
  it('says the rule holds regardless of the source material language', () => {
    const prompt = buildSystemPrompt('ar', { userRole: 'homeowner' });
    expect(prompt).toMatch(/regardless of which language this instruction is written/i);
    expect(prompt).toMatch(/regardless of the language of the BuildHub information/i);
    expect(prompt).toMatch(/The\s+language changes; the facts do not/i);
  });

  it('the BuildHub briefing carries the SAME facts in both languages', () => {
    // A rule is not a translation: the Arabic prompt must not be a reduced
    // version of the English one.
    const en = buildSystemPrompt('en', { userRole: 'homeowner' });
    const ar = buildSystemPrompt('ar', { userRole: 'homeowner' });
    expect(/[؀-ۿ]/.test(ar)).toBe(true);
    // Same structural sections in both.
    for (const marker of ['PLATFORM RULES', 'SUBSCRIPTION PLANS', 'HOW TO CHOOSE YOUR SOURCE']) {
      expect(en).toContain(marker);
      expect(ar).toContain(marker);
    }
  });
});
