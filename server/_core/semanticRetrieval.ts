import {
  AUTHORITY_TIERS, isStale,
  type KnowledgeDocument, type JurisdictionCode,
} from '@shared/knowledgeTaxonomy';
import { CONSTRUCTION_CORE } from '../knowledge/constructionCore';
import { CONSTRUCTION_DEPTH } from '../knowledge/constructionDepth';
import { CONSTRUCTION_TRADES } from '../knowledge/constructionTrades';
import { scoreDocument } from './knowledgeRetrieval';
import { embedQuery, embedDocuments, cosineSimilarity, isEmbeddingAvailable, type Vector } from './embeddings';

/**
 * HYBRID retrieval: semantic similarity, lexical overlap, and the metadata that
 * decides which of two relevant documents should be believed.
 *
 * WHY NOT PURE SEMANTIC. Embeddings solve the failure keyword matching cannot:
 * "how do I stop moisture penetrating a basement wall" shares almost no
 * vocabulary with a document about waterproofing membranes, and a keyword
 * ranker scores it zero. But embeddings introduce their own failure - they are
 * confidently approximate, and a question containing an exact BuildHub term or
 * a code designation like "SBC 201" should match on THAT, not on vibes. Keeping
 * both signals means neither failure mode is load-bearing.
 *
 * WHY METADATA IS PART OF THE SCORE AND NOT A FILTER. Filtering discards; a
 * jurisdiction mismatch should push a document DOWN, not make it invisible,
 * because a GLOBAL document about waterproofing is still the best answer to an
 * Egyptian question about waterproofing. The only thing that filters is
 * relevance falling below the floor.
 *
 * DEGRADATION IS A FEATURE. Retrieval improves an answer; it is not a
 * precondition for one. When embeddings are unavailable - no key, a timeout, a
 * provider outage - this falls back to lexical scoring and still answers. The
 * assistant getting slightly worse context is a far better outcome than the
 * assistant refusing a question it could have answered.
 */

const CORPUS: KnowledgeDocument[] = [...CONSTRUCTION_CORE, ...CONSTRUCTION_DEPTH, ...CONSTRUCTION_TRADES];

const MATCH_LIMIT = 3;

/**
 * Below this cosine similarity a document is not about the question. Set from
 * observed behaviour of text-embedding-3-small on this corpus: unrelated
 * construction topics sit around 0.1-0.2, genuinely related ones above 0.3.
 * Too low and every question retrieves everything, which is worse than
 * retrieving nothing because it fills the context with plausible irrelevance.
 */
const SEMANTIC_FLOOR = 0.28;

/** Weights. Lexical stays significant: an exact term match is strong evidence. */
const WEIGHTS = {
  /** Cosine in [0,1] scaled to a comparable range with lexical hits. */
  semantic: 60,
  /** The existing keyword score, which already weights topic over body. */
  lexical: 1,
  /** Tier 1 outranks tier 7 by this much at equal relevance. */
  authorityPerTier: 4,
  /** An exact jurisdiction match, when the question named one. */
  jurisdictionMatch: 12,
  /** A document that is not GLOBAL and not the asked-for jurisdiction. */
  jurisdictionMismatch: -10,
  /** Past its review date: still shown, ranked lower, and labelled. */
  stale: -8,
  /** Superseded content ranks below current content on the same subject. */
  superseded: -15,
};

export type SemanticHit = {
  document: KnowledgeDocument;
  score: number;
  /** Kept for evidence: a test can assert WHY something ranked where it did. */
  signals: {
    semantic: number | null;
    lexical: number;
    authority: number;
    jurisdiction: number;
    freshness: number;
  };
};

/** Corpus vectors, embedded once per process. */
let corpusVectors: Vector[] | null = null;
let corpusEmbedAttempted = false;

/** Test seam: re-embed on the next call. */
export const resetCorpusVectors = (): void => {
  corpusVectors = null;
  corpusEmbedAttempted = false;
};

/**
 * What gets embedded for each document.
 *
 * Topic and keywords are included alongside the body deliberately: the body is
 * long, and a long text's embedding is dominated by its bulk rather than its
 * subject. Leading with the subject line is what makes a short question match a
 * long document.
 */
const embeddableText = (document: KnowledgeDocument): string =>
  `${document.topic}. ${document.subcategory ?? ''}. Keywords: ${document.keywords.join(', ')}.\n\n${document.en}`;

async function ensureCorpusVectors(): Promise<Vector[] | null> {
  if (corpusVectors) return corpusVectors;
  // One attempt per process. Retrying on every question would turn a provider
  // outage into an extra failing call on every request.
  if (corpusEmbedAttempted) return null;
  corpusEmbedAttempted = true;

  const vectors = await embedDocuments(CORPUS.map(embeddableText));
  corpusVectors = vectors;
  return corpusVectors;
}

const freshnessPenalty = (document: KnowledgeDocument, now: Date): number => {
  if (document.status === 'superseded') return WEIGHTS.superseded;
  if (isStale(document, now)) return WEIGHTS.stale;
  return 0;
};

const jurisdictionScore = (document: KnowledgeDocument, asked?: JurisdictionCode): number => {
  if (!asked || asked === 'GLOBAL') return 0;
  if (document.jurisdiction === asked) return WEIGHTS.jurisdictionMatch;
  // GLOBAL is not a mismatch - it applies everywhere, which is the point of it.
  if (document.jurisdiction === 'GLOBAL') return 0;
  return WEIGHTS.jurisdictionMismatch;
};

/**
 * Rank the corpus for a question.
 *
 * `jurisdiction` is what the QUESTION asked about, not the user's location -
 * inferring a jurisdiction from an account and then ranking regulatory content
 * by it would answer a Saudi question with Egyptian material because of where
 * someone signed up.
 */
export async function retrieveSemantic(
  question: string,
  options: { limit?: number; jurisdiction?: JurisdictionCode } = {},
): Promise<SemanticHit[]> {
  const limit = options.limit ?? MATCH_LIMIT;
  const now = new Date();

  const queryVector = isEmbeddingAvailable() ? await embedQuery(question) : null;
  const vectors = queryVector ? await ensureCorpusVectors() : null;

  const hits: SemanticHit[] = CORPUS.map((document, index) => {
    const lexical = scoreDocument(document, question);
    const similarity = vectors && queryVector ? cosineSimilarity(queryVector, vectors[index]) : null;

    // A document that is neither semantically nor lexically related scores
    // nothing, whatever its authority. Authority breaks ties between relevant
    // documents; it does not make an irrelevant one relevant.
    const semanticallyRelated = similarity !== null && similarity >= SEMANTIC_FLOOR;
    const related = semanticallyRelated || lexical > 0;

    const authority = (Object.keys(AUTHORITY_TIERS).length - document.authorityLevel) * WEIGHTS.authorityPerTier;
    const jurisdiction = jurisdictionScore(document, options.jurisdiction);
    const freshness = freshnessPenalty(document, now);

    const score = related
      ? (semanticallyRelated ? similarity * WEIGHTS.semantic : 0)
        + lexical * WEIGHTS.lexical
        + authority
        + jurisdiction
        + freshness
      : 0;

    return {
      document,
      score,
      signals: { semantic: similarity, lexical, authority, jurisdiction, freshness },
    };
  });

  return hits
    .filter(hit => hit.score > 0)
    .sort((a, b) =>
      b.score - a.score
      // Authority breaks an exact tie, then id for stability - never database
      // or array order, which is not a reason.
      || a.document.authorityLevel - b.document.authorityLevel
      || a.document.knowledgeId.localeCompare(b.document.knowledgeId))
    .slice(0, limit);
}

/** Whether the last retrieval could use semantic ranking. Reported, not hidden. */
export const semanticRankingAvailable = (): boolean => corpusVectors !== null;

export const corpusSizeSemantic = (): number => CORPUS.length;
