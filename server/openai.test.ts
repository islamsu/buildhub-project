import { describe, it, expect } from 'vitest';
import { getOpenAIConfigStatus, OPENAI_MODELS } from './openaiIntegration';

describe('OpenAI Integration Helper', () => {
  it('correctly reports configuration status and models', () => {
    const status = getOpenAIConfigStatus();
    expect(status).toHaveProperty('hasDirectOpenAIKey');
    expect(status).toHaveProperty('hasForgeApiKey');
    expect(status.defaultModel).toBe(OPENAI_MODELS.gpt4oMini);
  });
});
