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
  'unclassified': 'no classification matched - inspect the deployment logs around this line',
};

export function onError(opts: { error: TRPCError; path?: string; type: string }): void {
  // Expected, server-authored refusals (NOT_FOUND, FORBIDDEN, SERVICE_UNAVAILABLE,
  // TOO_MANY_REQUESTS, …) already say what they mean to the caller and are part
  // of normal operation. Only the ones the caller is told nothing about need a
  // record here.
  if (opts.error.code !== 'INTERNAL_SERVER_ERROR') return;

  const { category, status } = classifyError(opts.error.cause ?? opts.error);
  console.error(
    `[trpc] ${opts.type} ${opts.path ?? '<no path>'} failed: ${category}` +
    `${status !== undefined ? ` (provider status ${status})` : ''} - ${REMEDY[category]}`,
  );
}
