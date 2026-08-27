import { ENV } from './env';
import { getAiClient } from './ai';

/**
 * Vector embeddings for semantic retrieval.
 *
 * WHY EMBEDDINGS AND NOT A HOSTED VECTOR STORE. The corpus is small enough that
 * the vectors fit comfortably in memory, and keeping them in the process means
 * there is no ingestion job to fall out of sync with the repository, no second
 * home for content, and no extra network hop on the read path. What a hosted
 * store would add at this size is operational surface, not capability. The
 * threshold for revisiting is concrete: when the corpus outgrows what a linear
 * scan can rank inside a request - low thousands of documents - move the
 * vectors out and keep this module's interface.
 *
 * WHY THIS IS ALLOWED TO FAIL. Retrieval is an ENHANCEMENT to an answer, not a
 * precondition for one. If the embeddings endpoint is slow, unconfigured or
 * erroring, the right behaviour is to fall back to lexical scoring and still
 * answer, not to fail a question the assistant could have answered anyway.
 * Every function here therefore returns null rather than throwing, and the
 * caller treats null as "no semantic signal available".
 */

/**
 * Small, cheap, and adequate for ranking a few dozen documents. The larger
 * model costs materially more per call for a difference that does not show up
 * at this corpus size - and this runs on EVERY question, so the per-call price
 * is the one that matters.
 */
const EMBEDDING_MODEL = 'text-embedding-3-small';

/** Requests are per-question, so a slow embed must not hold up the answer. */
const EMBEDDING_TIMEOUT_MS = 10_000;

/** Inputs are truncated well inside the model's window; a document body is not a token budget. */
const MAX_INPUT_CHARS = 8_000;

export type Vector = readonly number[];

export const isEmbeddingAvailable = (): boolean => ENV.openAiApiKey.trim().length > 0;

/**
 * Cosine similarity, in [-1, 1]. Both inputs are already unit-normalised by the
 * provider, so this is a dot product - but the normalisation is done anyway
 * because relying on an undocumented property of someone else's output is how
 * ranking silently degrades after a model upgrade.
 */
export function cosineSimilarity(a: Vector, b: Vector): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Query vectors, memoised by exact text.
 *
 * Bounded, because an unbounded map keyed by user input is a memory leak with a
 * friendly name. Questions repeat far more than they look like they do - the
 * eight tool cards on /ai send fixed opening prompts - so even a small cache
 * removes a real fraction of the calls.
 */
const QUERY_CACHE_LIMIT = 500;
const queryCache = new Map<string, Vector>();

const remember = (key: string, vector: Vector): void => {
  if (queryCache.size >= QUERY_CACHE_LIMIT) {
    const oldest = queryCache.keys().next().value;
    if (oldest !== undefined) queryCache.delete(oldest);
  }
  queryCache.set(key, vector);
};

/** Test seam, and the reset an operator would want after a model change. */
export const resetEmbeddingCache = (): void => { queryCache.clear(); };

async function embedBatch(inputs: string[]): Promise<Vector[] | null> {
  if (!isEmbeddingAvailable() || inputs.length === 0) return null;
  try {
    const response = await getAiClient().embeddings.create(
      {
        model: EMBEDDING_MODEL,
        input: inputs.map(text => text.slice(0, MAX_INPUT_CHARS)),
      },
      { timeout: EMBEDDING_TIMEOUT_MS },
    );
    const vectors = response.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map(item => item.embedding as Vector);
    return vectors.length === inputs.length ? vectors : null;
  } catch {
    // Deliberately silent to the caller and deliberately non-fatal. The reason
    // is logged by the provider layer; here, a failure means "rank lexically".
    return null;
  }
}

/** One text's vector, or null when semantic ranking is unavailable. */
export async function embedQuery(text: string): Promise<Vector | null> {
  const key = text.trim().toLowerCase();
  if (key.length === 0) return null;

  const cached = queryCache.get(key);
  if (cached) return cached;

  const vectors = await embedBatch([key]);
  if (!vectors) return null;

  remember(key, vectors[0]);
  return vectors[0];
}

/** Vectors for the corpus. Embedded once per process, in one request. */
export async function embedDocuments(texts: string[]): Promise<Vector[] | null> {
  return embedBatch(texts);
}

export const embeddingModelName = (): string => EMBEDDING_MODEL;
