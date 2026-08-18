import { ENV } from './_core/env';
import { invokeLLM, type InvokeParams, type InvokeResult } from './_core/llm';

export const OPENAI_MODELS = {
  gpt4o: 'gpt-4o',
  gpt4oMini: 'gpt-4o-mini',
  gpt35Turbo: 'gpt-3.5-turbo',
} as const;

export async function invokeOpenAI(params: InvokeParams & { apiKey?: string; useDirectOpenAI?: boolean }): Promise<InvokeResult> {
  const directKey = params.apiKey || process.env.OPENAI_API_KEY;
  if (params.useDirectOpenAI && directKey) {
    const messages = params.messages;
    const model = params.model || OPENAI_MODELS.gpt4oMini;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${directKey}`,
      },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        })),
        max_tokens: params.max_tokens ?? params.maxTokens,
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errText}`);
    }
    const data = await response.json() as any;
    return {
      id: data.id || 'openai-direct',
      created: data.created || Date.now(),
      model: data.model || model,
      choices: data.choices || [],
      usage: data.usage,
    };
  }

  // Fallback to Manus managed LLM / Forge proxy with OPENAI_API_KEY or Forge API key
  return invokeLLM(params);
}

export function getOpenAIConfigStatus() {
  return {
    hasDirectOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    hasForgeApiKey: Boolean(ENV.forgeApiKey),
    defaultModel: OPENAI_MODELS.gpt4oMini,
  };
}
