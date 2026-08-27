import OpenAI, { APIError } from 'openai';
import { ENV } from './env';
import { toModelContent } from './aiAttachments';

/**
 * BuildHub's AI provider boundary.
 *
 * Everything the application knows about talking to a model lives here. The
 * router calls generateAIResponse() and receives text or a typed failure; it
 * has no URL, no header, no SDK and no key. That separation is the point -
 * this is the second provider this feature has had, and the migration off the
 * first one touched exactly one router line because the first version did NOT
 * keep that boundary and the second one does.
 *
 * Provider:  OpenAI, directly.
 * API:       the Responses API (POST /v1/responses), which is the interface
 *            OpenAI documents for reasoning models - Chat Completions still
 *            works but is no longer where the model behaviour is best.
 * Model:     ENV.openAiModel, defaulting to gpt-5.6-luna.
 * Transport: the official `openai` npm SDK, so retries, timeouts, error types
 *            and request shaping are the vendor's problem rather than ours.
 */

export type AiMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/**
 * A user file to be read by the model on THIS request. Already validated and
 * already authorised by the time it reaches this module - see
 * server/_core/aiAttachments.ts and the ai.chat procedure.
 */
export type AiAttachment = { name: string; contentType: string; bytes: Buffer };

/** The application's contract. Deliberately narrow: no provider object escapes. */
export type AiResult = { text: string };

export type AiFailureCategory =
  | 'config-missing'
  | 'provider-auth'
  | 'provider-quota'
  | 'provider-rate-limit'
  | 'provider-unavailable'
  | 'provider-bad-request'
  | 'provider-network'
  | 'provider-timeout'
  | 'response-empty'
  | 'response-parse';

export class AiError extends Error {
  constructor(
    readonly category: AiFailureCategory,
    readonly status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/**
 * Whether this deployment can answer an AI request at all. The capability
 * endpoint and the /ai page both read this, so an unconfigured deployment says
 * so instead of offering tools that cannot work.
 */
export const isAiConfigured = (): boolean =>
  ENV.openAiApiKey.trim().length > 0 && ENV.openAiModel.trim().length > 0;

/** Reported to operators; never sent to a browser. */
export const aiModelName = (): string => ENV.openAiModel;

// Bounded, and bounded deliberately.
//
// The previous implementation retried five times with exponential backoff, so
// a provider outage cost every user ~3.75s of sleeping before an error they
// could not act on. The SDK retries idempotent failures (429, 5xx, connection
// errors) and honours Retry-After. Two retries - three attempts - is enough to
// ride out a transient blip without turning an outage into a retry storm.
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 60_000;

// Reasoning tokens are billed as output tokens and are counted INSIDE
// max_output_tokens. Set the ceiling too low and a reasoning model can spend
// the entire budget thinking, returning status "incomplete" with an empty
// output_text - billed, and with nothing to show the user. 'low' effort plus
// headroom keeps a chat assistant responsive and cheap; the empty case is
// still handled explicitly below rather than trusted not to happen.
const REASONING_EFFORT = 'low' as const;
const MAX_OUTPUT_TOKENS = 4096;
// A search-backed answer spends tokens reading results before it writes
// anything, so the same ceiling would truncate it into the empty-output failure
// this module already guards against.
const MAX_OUTPUT_TOKENS_WITH_SEARCH = 8192;

let client: OpenAI | undefined;
const getClient = (): OpenAI => {
  if (!client) {
    client = new OpenAI({
      apiKey: ENV.openAiApiKey,
      ...(ENV.openAiBaseUrl ? { baseURL: ENV.openAiBaseUrl } : {}),
      maxRetries: MAX_RETRIES,
      timeout: REQUEST_TIMEOUT_MS,
    });
  }
  return client;
};

/** Test seam. The module memoises its client; tests need to un-memoise it. */
export const resetAiClient = (): void => { client = undefined; };

/**
 * The shared client, for the OTHER OpenAI surface this application uses:
 * embeddings, in server/_core/embeddings.ts.
 *
 * Exported rather than duplicated so there is still exactly ONE place that
 * holds the credential, the base URL, the timeout and the retry budget. A
 * second client built next to the first is how two halves of an integration
 * end up on different configuration.
 */
export const getAiClient = getClient;

/**
 * Split BuildHub's conversation into the two things the Responses API wants:
 * `instructions` (system-level steering) and `input` (the actual turns).
 *
 * The eight modes on /ai are prompts, not providers - Cost Estimator and Risk
 * Detector differ only in the opening user message - so nothing here is
 * mode-aware and nothing needs to be.
 */
const splitConversation = (messages: AiMessage[], attachments: AiAttachment[] = []) => {
  const instructions = messages
    .filter(m => m.role === 'system')
    .map(m => m.content)
    .join('\n\n');

  const turns = messages.filter(m => m.role !== 'system');

  // Attachments belong to the turn the person is asking RIGHT NOW, so they are
  // attached to the last user message rather than sent as a turn of their own.
  // A bare file with no question reads to the model as context with no request;
  // the file and the sentence about it have to arrive together.
  const lastUserIndex = turns.map(m => m.role).lastIndexOf('user');

  const input = turns.map((message, index) => {
    if (attachments.length === 0 || index !== lastUserIndex) {
      return { role: message.role as 'user' | 'assistant', content: message.content };
    }
    return {
      role: 'user' as const,
      content: [
        { type: 'input_text' as const, text: message.content },
        ...attachments.map(toModelContent),
      ],
    };
  });

  return { instructions, input };
};

const classify = (error: unknown): AiError => {
  if (error instanceof AiError) return error;

  if (error instanceof APIError) {
    const status = error.status;
    // Quota exhausted and rate limiting are both 429 but need different
    // operator responses: one is "wait", the other is "go and pay".
    if (status === 429) {
      const isQuota = /quota|billing|insufficient_quota/i.test(error.code ?? error.type ?? '');
      return new AiError(isQuota ? 'provider-quota' : 'provider-rate-limit', status, 'AI provider is throttling or out of quota');
    }
    if (status === 401 || status === 403) return new AiError('provider-auth', status, 'AI provider rejected the credential');
    if (status === 400 || status === 404 || status === 422) {
      return new AiError('provider-bad-request', status, 'AI provider rejected the request');
    }
    if (typeof status === 'number' && status >= 500) {
      return new AiError('provider-unavailable', status, 'AI provider returned a server error');
    }
    return new AiError('provider-unavailable', status, 'AI provider request failed');
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/timeout|timed out|aborted/i.test(message)) {
    return new AiError('provider-timeout', undefined, 'AI provider did not respond in time');
  }
  return new AiError('provider-network', undefined, 'AI provider could not be reached');
};

/**
 * The one function the rest of the application uses.
 *
 * Throws AiError - never a raw SDK error, and never a string carrying a
 * provider body. Callers map the category to a user-facing message; nothing
 * here is safe to show a browser verbatim and nothing here is meant to be.
 */
export async function generateAIResponse(params: {
  messages: AiMessage[];
  /**
   * Turns on OpenAI's hosted web_search tool for THIS request only.
   *
   * Off by default and decided in code (server/_core/aiIntent.ts), never by the
   * model: a search on every question would add latency and cost to
   * "what is a BOQ?", which the briefing already answers. It is switched on for
   * the questions where model memory is actively dangerous - current prices,
   * current code editions - where a confident stale answer is worse than a slow
   * one.
   */
  webSearch?: boolean;
  /**
   * Files the person attached to this message. Validated and ownership-checked
   * BEFORE they get here; this module does not decide who may read what.
   */
  attachments?: AiAttachment[];
}): Promise<AiResult> {
  if (!isAiConfigured()) {
    throw new AiError('config-missing', undefined, 'OPENAI_API_KEY is not configured');
  }

  const { instructions, input } = splitConversation(params.messages, params.attachments ?? []);

  let response: Awaited<ReturnType<OpenAI['responses']['create']>>;
  try {
    response = await getClient().responses.create({
      model: ENV.openAiModel,
      ...(instructions ? { instructions } : {}),
      input,
      ...(params.webSearch ? { tools: [{ type: 'web_search' as const }] } : {}),
      max_output_tokens: params.webSearch ? MAX_OUTPUT_TOKENS_WITH_SEARCH : MAX_OUTPUT_TOKENS,
      reasoning: { effort: REASONING_EFFORT },
      // No `temperature`. GPT-5 family models are reasoning models and reject
      // it; sending it turns every request into a 400.
    });
  } catch (error) {
    throw classify(error);
  }

  // `output_text` is the SDK's helper: it concatenates the text out of the
  // typed output array. Reading it rather than indexing into output[0] means a
  // response carrying a reasoning item first does not silently read as empty.
  const text = typeof response.output_text === 'string' ? response.output_text.trim() : '';

  if (!text) {
    // A truncated reasoning-only response is the specific trap here: status
    // "incomplete" with reason "max_output_tokens" produces NO message item,
    // so output_text is empty even though the request was billed. Returning
    // that as success would show the user a blank answer and call it working.
    const reason = response.status === 'incomplete'
      ? `truncated: ${response.incomplete_details?.reason ?? 'unknown'}`
      : `status: ${response.status ?? 'unknown'}`;
    throw new AiError('response-empty', undefined, `AI provider returned no text (${reason})`);
  }

  return { text };
}
