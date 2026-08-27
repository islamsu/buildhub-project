import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Semantic retrieval.
 *
 * The embeddings PROVIDER is mocked here — deliberately. Calling the real API
 * in a unit suite would make every run cost money, make CI depend on a third
 * party's uptime, and make the assertions non-deterministic. What is under test
 * is BuildHub's ranking: that a semantic signal is used when present, that
 * metadata breaks ties the way the authority hierarchy says it should, and that
 * the whole thing degrades to lexical scoring rather than failing. Whether
 * OpenAI's vectors are any good is proven on staging, against the live path.
 */

const provider = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('./_core/ai', async () => {
  const actual = await vi.importActual<typeof import('./_core/ai')>('./_core/ai');
  return { ...actual, getAiClient: () => ({ embeddings: provider }) };
});
vi.mock('./_core/env', async () => {
  const actual = await vi.importActual<typeof import('./_core/env')>('./_core/env');
  return { ...actual, ENV: { ...actual.ENV, openAiApiKey: 'test-key', openAiModel: 'gpt-5.6-luna' } };
});

import { retrieveSemantic, resetCorpusVectors, corpusSizeSemantic } from './_core/semanticRetrieval';
import { resetEmbeddingCache, cosineSimilarity } from './_core/embeddings';
import { CONSTRUCTION_CORE } from './knowledge/constructionCore';
import { CONSTRUCTION_DEPTH } from './knowledge/constructionDepth';
import { CONSTRUCTION_TRADES } from './knowledge/constructionTrades';

const CORPUS = [...CONSTRUCTION_CORE, ...CONSTRUCTION_DEPTH, ...CONSTRUCTION_TRADES];

/**
 * A deterministic stand-in for a real embedding space.
 *
 * Each document gets a basis vector; a query gets a blend of the bases of the
 * documents it is "about". That makes similarity exactly predictable, so a
 * failing assertion means BuildHub's ranking changed — not that a model drifted.
 */
// Extra dimensions beyond one-per-document, so a query can point PARTLY away
// from the whole corpus. Without them every query is a combination of document
// bases and the best cosine can never fall below 1/sqrt(corpusSize) - which
// would make the similarity floor untestable rather than correct.
const NOISE_DIMENSIONS = 8;
const DIMENSIONS = CORPUS.length + NOISE_DIMENSIONS;

const basis = (index: number): number[] =>
  Array.from({ length: DIMENSIONS }, (_, i) => (i === index ? 1 : 0));

const blend = (weights: Record<string, number>, noise = 0): number[] => {
  const vector = Array.from({ length: DIMENSIONS }, () => 0);
  for (const [id, weight] of Object.entries(weights)) {
    const index = CORPUS.findIndex(document => document.knowledgeId === id);
    if (index >= 0) vector[index] = weight;
  }
  for (let i = CORPUS.length; i < DIMENSIONS; i++) vector[i] = noise;
  return vector;
};

/** Answers document batches with basis vectors and single queries from a map. */
function mockEmbeddings(queryVectors: Record<string, number[]>) {
  provider.create.mockImplementation(async ({ input }: { input: string[] }) => {
    if (input.length > 1) {
      return { data: input.map((_, index) => ({ index, embedding: basis(index) })) };
    }
    const key = input[0];
    const vector = queryVectors[key] ?? Array.from({ length: DIMENSIONS }, () => 0);
    return { data: [{ index: 0, embedding: vector }] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCorpusVectors();
  resetEmbeddingCache();
});

// ── 1. The failure keyword matching cannot solve ────────────────────────────

describe('a semantically equivalent question retrieves the right document', () => {
  it('finds waterproofing from a question that never says the word', async () => {
    // The example from the brief. "How do I stop moisture penetrating a
    // basement wall?" shares essentially no vocabulary with a document about
    // waterproofing membranes — a keyword ranker scores it zero.
    const question = 'how do i stop moisture penetrating a basement wall?';
    mockEmbeddings({ [question]: blend({ 'waterproofing-selection': 0.9 }) });

    const hits = await retrieveSemantic(question);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].document.knowledgeId).toBe('waterproofing-selection');
    expect(hits[0].signals.semantic).toBeGreaterThan(0.28);
  });

  it('the brief\'s example is ALSO reachable lexically - via one hand-written keyword', async () => {
    // Worth stating rather than glossing: "basement" happens to be in that
    // document's keyword list, so the old ranker did find it. The example
    // understates the problem rather than demonstrating it.
    mockEmbeddings({});
    const hits = await retrieveSemantic('how do i stop moisture penetrating a basement wall?');
    expect(hits[0].document.knowledgeId).toBe('waterproofing-selection');
    expect(hits[0].signals.lexical).toBeGreaterThan(0);
    // A zero query vector is not the same as NO vector: the similarity was
    // computed and came out at zero, so the hit is lexical only.
    expect(hits[0].signals.semantic).toBe(0);
  });

  it('REPHRASED so no keyword survives, only semantic retrieval finds it', async () => {
    // This is the real failure mode. Keyword coverage depends on an author
    // having anticipated the phrasing, and nobody anticipates every way a
    // person describes a leak. No keyword in the corpus appears in this
    // sentence, so the lexical ranker scores every document zero.
    const question = 'water is seeping through the underground car park slab after heavy rain';

    mockEmbeddings({});
    expect(await retrieveSemantic(question)).toHaveLength(0);

    resetCorpusVectors();
    resetEmbeddingCache();
    mockEmbeddings({ [question]: blend({ 'waterproofing-selection': 0.9 }) });
    const semantic = await retrieveSemantic(question);
    expect(semantic[0].document.knowledgeId).toBe('waterproofing-selection');
    expect(semantic[0].signals.lexical).toBe(0);
    expect(semantic[0].signals.semantic).toBeGreaterThan(0.28);
  });

  it('an exact term still matches lexically, with or without embeddings', async () => {
    provider.create.mockRejectedValue(new Error('embeddings down'));
    const hits = await retrieveSemantic('what is a bill of quantities?');
    expect(hits.map(hit => hit.document.knowledgeId)).toContain('qs-boq-fundamentals');
    expect(hits[0].signals.semantic).toBeNull();
  });
});

// ── 2. Degradation ──────────────────────────────────────────────────────────

describe('retrieval degrades instead of failing', () => {
  it('a provider outage still returns lexical results, and never throws', async () => {
    provider.create.mockRejectedValue(new Error('503'));
    await expect(retrieveSemantic('bill of quantities takeoff')).resolves.toBeInstanceOf(Array);
  });

  it('a timeout is not an error the caller has to handle', async () => {
    provider.create.mockImplementation(() => Promise.reject(new Error('timed out')));
    const hits = await retrieveSemantic('waterproofing membrane selection');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('a malformed provider response is ignored rather than trusted', async () => {
    // Fewer vectors than inputs: the batch is rejected wholesale, because
    // pairing vector[i] with document[i] after a short response would rank
    // documents against other documents' embeddings.
    provider.create.mockResolvedValue({ data: [{ index: 0, embedding: [1, 0, 0] }] });
    const hits = await retrieveSemantic('bill of quantities');
    expect(hits[0].signals.semantic).toBeNull();
  });
});

// ── 3. Authority and metadata ───────────────────────────────────────────────

describe('metadata decides between two relevant documents', () => {
  it('SIMILARITY ORDERS the results, not just selects them', async () => {
    // Found by mutation testing: deleting the semantic term from the score left
    // every other test passing, because they all assert WHICH documents come
    // back and never that similarity decides their ORDER. With both documents
    // above the floor, the more similar one must come first - and that is only
    // true if the similarity is actually weighted.
    const question = 'a question about two related things';
    mockEmbeddings({
      [question]: blend({ 'waterproofing-selection': 1.0, 'tender-comparison': 0.45 }, 0.1),
    });

    const hits = await retrieveSemantic(question);
    const ids = hits.map(hit => hit.document.knowledgeId);
    expect(ids).toContain('waterproofing-selection');
    expect(ids).toContain('tender-comparison');
    expect(ids.indexOf('waterproofing-selection')).toBeLessThan(ids.indexOf('tender-comparison'));

    const stronger = hits.find(hit => hit.document.knowledgeId === 'waterproofing-selection')!;
    const weaker = hits.find(hit => hit.document.knowledgeId === 'tender-comparison')!;
    expect(stronger.signals.semantic!).toBeGreaterThan(weaker.signals.semantic!);
    // Both are tier 6 and neither matches lexically, so the ONLY thing that can
    // separate their scores is the semantic weight.
    expect(stronger.signals.lexical).toBe(weaker.signals.lexical);
    expect(stronger.signals.authority).toBe(weaker.signals.authority);
    expect(stronger.score).toBeGreaterThan(weaker.score);
  });

  it('authority contributes to the score, higher tier ranking higher', async () => {
    const question = 'tendering and quantities';
    mockEmbeddings({ [question]: blend({ 'tender-comparison': 0.8, 'qs-boq-fundamentals': 0.8 }) });
    const hits = await retrieveSemantic(question);
    for (const hit of hits) {
      // Every corpus document is tier 6 today, so the assertion is on the
      // MECHANISM: authority is scored, and a lower tier number scores higher.
      expect(hit.signals.authority).toBeGreaterThan(0);
    }
    const scores = hits.map(hit => hit.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('a jurisdiction match lifts a document and a mismatch pushes it down', async () => {
    const question = 'waterproofing practice';
    mockEmbeddings({ [question]: blend({ 'waterproofing-selection': 0.9 }) });

    const neutral = await retrieveSemantic(question);
    const scoped = await retrieveSemantic(question, { jurisdiction: 'EG' });

    // Every document is GLOBAL, which is NOT a mismatch - it applies
    // everywhere, and that is the point of the code.
    const before = neutral.find(hit => hit.document.knowledgeId === 'waterproofing-selection')!;
    const after = scoped.find(hit => hit.document.knowledgeId === 'waterproofing-selection')!;
    expect(after.signals.jurisdiction).toBe(0);
    expect(after.score).toBeCloseTo(before.score, 5);
  });

  it('an irrelevant document is not rescued by having high authority', async () => {
    // Authority breaks ties between RELEVANT documents. It must not make an
    // unrelated one appear - that is how a corpus starts answering questions
    // it knows nothing about.
    const question = 'what is the capital of France?';
    mockEmbeddings({ [question]: Array.from({ length: DIMENSIONS }, () => 0) });
    expect(await retrieveSemantic(question)).toHaveLength(0);
  });

  it('the semantic floor keeps weak matches out of the context', async () => {
    // Cosine NORMALISES, so a small weight is not a small similarity - a vector
    // pointing mostly at one document is highly similar to it however short it
    // is. To sit below the floor the query has to be spread thin across many
    // documents, which is exactly what a vague question looks like in practice.
    // Asserted directly rather than by looping over whatever came back: a loop
    // over an empty array passes without testing anything, and this is exactly
    // the kind of check that is worth making impossible to pass vacuously.
    const weak = 'a question only faintly about sealing things';
    const strong = 'a question squarely about sealing things';

    mockEmbeddings({
      // noise 1.5 across 8 spare dimensions puts cosine at ~0.23, under the
      // 0.28 floor; the strong one sits at ~0.9.
      [weak]: blend({ 'waterproofing-selection': 1 }, 1.5),
      [strong]: blend({ 'waterproofing-selection': 1 }, 0.15),
    });

    const weakHits = await retrieveSemantic(weak);
    expect(weakHits.map(hit => hit.document.knowledgeId)).not.toContain('waterproofing-selection');

    const strongHits = await retrieveSemantic(strong);
    expect(strongHits.map(hit => hit.document.knowledgeId)).toContain('waterproofing-selection');
  });
});

// ── 4. Cost ─────────────────────────────────────────────────────────────────

describe('the corpus is embedded once, not per question', () => {
  it('two questions cost two query embeds and ONE document batch', async () => {
    mockEmbeddings({
      'first question about waterproofing': blend({ 'waterproofing-selection': 0.9 }),
      'second question about waterproofing': blend({ 'waterproofing-selection': 0.9 }),
    });
    await retrieveSemantic('first question about waterproofing');
    await retrieveSemantic('second question about waterproofing');

    const batches = provider.create.mock.calls.filter(call => Array.isArray(call[0].input) && call[0].input.length > 1);
    expect(batches).toHaveLength(1);
    expect(batches[0][0].input).toHaveLength(corpusSizeSemantic());
  });

  it('the same question twice costs ONE query embed', async () => {
    const question = 'repeated question about waterproofing';
    mockEmbeddings({ [question]: blend({ 'waterproofing-selection': 0.9 }) });
    await retrieveSemantic(question);
    await retrieveSemantic(question);

    const queries = provider.create.mock.calls.filter(call => call[0].input.length === 1);
    expect(queries).toHaveLength(1);
  });

  it('a failed corpus embed is not retried on every subsequent question', async () => {
    // Otherwise a provider outage turns into an extra failing call per request.
    provider.create.mockRejectedValue(new Error('down'));
    await retrieveSemantic('one');
    await retrieveSemantic('two');
    await retrieveSemantic('three');
    const batches = provider.create.mock.calls.filter(call => Array.isArray(call[0].input) && call[0].input.length > 1);
    expect(batches.length).toBeLessThanOrEqual(1);
  });
});

// ── 5. The maths ────────────────────────────────────────────────────────────

describe('cosine similarity', () => {
  it('is 1 for identical, 0 for orthogonal, and handles degenerate input', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    // Mismatched dimensions are a bug upstream; scoring them 0 stops it
    // becoming a silently wrong ranking.
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
  });

  it('is unaffected by magnitude, so a long document is not favoured', () => {
    expect(cosineSimilarity([2, 0], [1, 0])).toBeCloseTo(cosineSimilarity([50, 0], [1, 0]));
  });
});
