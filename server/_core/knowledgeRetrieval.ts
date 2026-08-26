import {
  KNOWLEDGE_DOMAINS, AUTHORITY_TIERS, isStale,
  type KnowledgeDocument, type DomainId,
} from '@shared/knowledgeTaxonomy';
import { CONSTRUCTION_CORE } from '../knowledge/constructionCore';

/**
 * Retrieval over the BuildHub knowledge corpus.
 *
 * WHY THIS IS KEYWORD RETRIEVAL AND NOT A VECTOR STORE.
 *
 * A hosted vector store is the right answer at thousands of documents. At this
 * corpus size it would add an external dependency, an ingestion job that can
 * silently fall out of sync with the repository, a second place for content to
 * live, and a per-request network call - to rank a few dozen documents that
 * carry hand-written keyword lists. The simplest reliable architecture wins
 * here, and this one has a property the hosted alternative does not: the corpus
 * is in the repository, so it is versioned, reviewable in a pull request, and
 * deployed atomically with the code that uses it. There is no state to re-sync.
 *
 * The threshold for revisiting is concrete rather than aesthetic: when the
 * corpus outgrows what keywords can discriminate - roughly a few hundred
 * documents, or when authors start guessing which keywords to add - move the
 * bodies into a vector store and keep this module's interface. Nothing above
 * this layer would need to change.
 *
 * CONFLICTS ARE SURFACED, NOT SILENTLY RESOLVED. When two documents on the same
 * topic disagree in authority, the higher tier is presented first AND the
 * conflict is stated, because a regulator disagreeing with an industry source
 * is information the reader wants.
 */

const CORPUS: KnowledgeDocument[] = [...CONSTRUCTION_CORE];

export type RetrievedDocument = { document: KnowledgeDocument; score: number };

const MATCH_LIMIT = 3;

/** Keyword hits, weighted so a topic-line hit beats an incidental body hit. */
export function scoreDocument(document: KnowledgeDocument, question: string): number {
  const text = question.toLowerCase();
  let score = 0;
  for (const keyword of document.keywords) {
    if (text.includes(keyword.toLowerCase())) score += 10;
  }
  for (const word of document.topic.toLowerCase().split(/\W+/).filter(w => w.length > 4)) {
    if (text.includes(word)) score += 2;
  }
  // A stale document still matches - hiding it would be worse - but it ranks
  // below a current one on the same subject and is labelled when shown.
  if (isStale(document, new Date())) score -= 5;
  return score;
}

export function retrieve(question: string, limit = MATCH_LIMIT): RetrievedDocument[] {
  return CORPUS
    .map(document => ({ document, score: scoreDocument(document, question) }))
    .filter(hit => hit.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      // Authority breaks ties: tier 1 outranks tier 6 at equal relevance.
      a.document.authorityLevel - b.document.authorityLevel)
    .slice(0, limit);
}

/** Domains that actually hold documents. Used to tell the model where coverage ends. */
export function coveredDomains(): string[] {
  const ids = CORPUS.map(d => d.domain).filter((id, i, all) => all.indexOf(id) === i) as DomainId[];
  return ids.sort((a, b) => a - b).map(id => `${id} ${KNOWLEDGE_DOMAINS[id]}`);
}

export function corpusSize(): number {
  return CORPUS.length;
}

/** Documents past their review date. The staleness report, for operators. */
export function staleDocuments(now = new Date()): KnowledgeDocument[] {
  return CORPUS.filter(document => isStale(document, now));
}

/**
 * The retrieved block handed to the model, in the site's language.
 *
 * Every document states its authority tier and its source, so the model can
 * follow the hierarchy rather than treat all context as equally true.
 */
export function formatRetrievalForModel(hits: RetrievedDocument[], lang: 'en' | 'ar'): string {
  if (hits.length === 0) return '';

  const now = new Date();
  const blocks = hits.map(({ document }) => {
    const body = lang === 'ar' ? document.ar : document.en;
    const stale = isStale(document, now)
      ? `\n  NOTE: past its review date (${document.reviewDate}) - treat as possibly out of date and say so if it matters.`
      : '';
    return `--- ${document.topic}
  authority: tier ${document.authorityLevel} (${AUTHORITY_TIERS[document.authorityLevel]})
  source: ${document.sourceName}${document.sourceUrl ? ` <${document.sourceUrl}>` : ''}
  jurisdiction: ${document.jurisdiction} | version ${document.version}${stale}

${body}`;
  }).join('\n\n');

  // Conflicting authority levels on retrieved material are worth naming.
  const tiers = hits.map(h => h.document.authorityLevel).filter((t, i, all) => all.indexOf(t) === i);
  const conflictNote = tiers.length > 1
    ? `\nNOTE: these sources sit at different authority levels. Where they disagree, the LOWER tier number wins, and say that they differ rather than silently picking one.`
    : '';

  return `=== BUILDHUB REFERENCE KNOWLEDGE ===
Retrieved for this question. Higher authority (lower tier number) wins over
lower authority, and all of it outranks your general recollection.${conflictNote}

${blocks}
=== END REFERENCE KNOWLEDGE ===`;
}
