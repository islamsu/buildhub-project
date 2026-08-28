import type { TRPCError } from '@trpc/server';

/**
 * Server-side error classification.
 *
 * The browser is deliberately told nothing: every INTERNAL_SERVER_ERROR is
 * rewritten to "Something went wrong. Please try again." by the error
 * formatter in ./trpc, which is the right behaviour and must not change.
 * The problem was that NOTHING was written down on the server either - no
 * onError handler was mounted on the tRPC middleware at all - so an operator
 * reading the deployment logs saw an AI feature failing for every user with no
 * indication of why. The /ai incident was diagnosed by timing a request from
 * outside, which is not a reasonable way to run a service.
 *
 * What is logged is a CATEGORY and never the underlying text. Provider error
 * bodies are excluded on purpose: `LLM invoke failed: <status> - <body>`
 * interpolates whatever the provider returned, and a provider that echoes the
 * request would put user prompt content into the log line. The category plus
 * the numeric status is enough to tell "nobody configured a key" apart from
 * "the key is refused", "we are out of quota" and "the network broke", which
 * is the whole diagnostic question.
 */

export type ErrorCategory =
  | 'config-missing'
  | 'provider-auth'
  | 'provider-quota'
  | 'provider-unavailable'
  | 'provider-bad-request'
  | 'provider-network'
  | 'response-parse'
  | 'database'
  | 'unclassified';

const providerStatus = (message: string): number | undefined => {
  const m = /(?:LLM invoke failed|List LLM models failed):\s*(\d{3})\b/.exec(message);
  return m ? Number(m[1]) : undefined;
};

export function classifyError(error: unknown): { category: ErrorCategory; status?: number } {
  const message = error instanceof Error ? error.message : String(error ?? '');

  // MATCHED BY TYPE, NOT BY PROSE. `ObjectStorageNotConfiguredError` says "No
  // object storage backend is configured" - which does not contain the literal
  // "is not configured" the regex below looks for, so every upload on a
  // deployment with no storage configured logged as 'unclassified' and told
  // the operator to go read the deployment logs. It WAS the deployment log.
  //
  // A classifier that recognises errors by their message is one rewording away
  // from being wrong, so the errors this codebase defines are matched by name.
  const name = error instanceof Error ? error.name : '';
  if (name === 'ObjectStorageNotConfiguredError') return { category: 'config-missing' };

  if (/is not configured/i.test(message)) return { category: 'config-missing' };

  const status = providerStatus(message);
  if (status !== undefined) {
    if (status === 401 || status === 403) return { category: 'provider-auth', status };
    if (status === 429) return { category: 'provider-quota', status };
    if (status >= 500) return { category: 'provider-unavailable', status };
    if (status >= 400) return { category: 'provider-bad-request', status };
  }

  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|exhausting retries|aborted/i.test(message)) {
    return { category: 'provider-network' };
  }
  if (/Unexpected token|is not valid JSON|Cannot read properties of undefined/i.test(message)) {
    return { category: 'response-parse' };
  }
  if (/ER_[A-Z_]+|ECONNRESET|Access denied for user|Unknown column/i.test(message)) {
    return { category: 'database' };
  }
  return { category: 'unclassified' };
}

/**
 * What the operator should do about it. Kept next to the category so the log
 * line is actionable without anybody having to read this file.
 */
const REMEDY: Record<ErrorCategory, string> = {
  'config-missing': 'a required environment variable is unset on this deployment',
  'provider-auth': 'the provider rejected the credential',
  'provider-quota': 'the provider is rate limiting or the quota is exhausted',
  'provider-unavailable': 'the provider returned a server error',
  'provider-bad-request': 'the provider rejected the request shape',
  'provider-network': 'the provider could not be reached',
  'response-parse': 'the provider replied in an unexpected shape',
  'database': 'the database rejected or dropped the query',
  'unclassified': 'no classification matched - the origin below is where it was thrown',
};

/**
 * The one thing an operator can be given about an unrecognised error without
 * risking user data in a log line: WHERE it came from.
 *
 * The message is still withheld - a database error interpolates the offending
 * value, a provider error echoes the request - but the error's class name and
 * the first frames of its own stack are written by the runtime, not by a user,
 * and they are what turns "something failed" into a file and a line number.
 *
 * Errors are also unwrapped: drizzle wraps a driver error in a
 * DrizzleQueryError, so classifying only the outermost cause reported
 * `unclassified` for a failure the `database` rule would have matched one
 * level down.
 */
function originOf(error: unknown): string {
  const chain: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    chain.push(current.name || current.constructor?.name || 'Error');
    current = (current as { cause?: unknown }).cause;
  }
  const frames = (error instanceof Error && typeof error.stack === 'string')
    // Frame lines only - never the first line, which is the message.
    ? error.stack.split('\n').filter(line => /^\s+at /.test(line)).slice(0, 3)
      .map(line => line.trim().replace(/^at /, ''))
    : [];
  const origin = chain.length > 0 ? chain.join(' <- ') : 'non-Error thrown';
  return frames.length > 0 ? `${origin} at ${frames.join(' | ')}` : origin;
}

/** Walks the cause chain so a wrapped driver error is still classified. */
export function classifyErrorChain(error: unknown): { category: ErrorCategory; status?: number } {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    const result = classifyError(current);
    if (result.category !== 'unclassified') return result;
    if (!(current instanceof Error)) break;
    const cause = (current as { cause?: unknown }).cause;
    if (cause === undefined || cause === null) break;
    current = cause;
  }
  return { category: 'unclassified' };
}

export function onError(opts: { error: TRPCError; path?: string; type: string }): void {
  // Expected, server-authored refusals (NOT_FOUND, FORBIDDEN, SERVICE_UNAVAILABLE,
  // TOO_MANY_REQUESTS, …) already say what they mean to the caller and are part
  // of normal operation. Only the ones the caller is told nothing about need a
  // record here.
  if (opts.error.code !== 'INTERNAL_SERVER_ERROR') return;

  const root = opts.error.cause ?? opts.error;
  const { category, status } = classifyErrorChain(root);
  console.error(
    `[trpc] ${opts.type} ${opts.path ?? '<no path>'} failed: ${category}` +
    `${status !== undefined ? ` (provider status ${status})` : ''} - ${REMEDY[category]}` +
    // Only when nothing matched. A classified line is already actionable, and
    // this is the case where the remedy would otherwise be circular.
    `${category === 'unclassified' ? ` [origin: ${originOf(root)}]` : ''}`,
  );
}
