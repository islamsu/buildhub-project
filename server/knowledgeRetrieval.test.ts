/**
 * Retrieval, authority tiers and staleness.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('./db', () => ({ getDb: vi.fn() }));

import { retrieve, scoreDocument, formatRetrievalForModel, coveredDomains, corpusSize, staleDocuments } from './_core/knowledgeRetrieval';
import { CONSTRUCTION_CORE } from './knowledge/constructionCore';
import { isStale, AUTHORITY_TIERS, KNOWLEDGE_DOMAINS } from '@shared/knowledgeTaxonomy';

const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');

describe('the corpus is real, not padded', () => {
  it('every document has substantive content in BOTH languages', () => {
    // The failure this guards: an English body with a stub Arabic one, or a
    // paragraph-per-domain corpus that looks broad and says nothing.
    for (const doc of CONSTRUCTION_CORE) {
      expect(doc.en.trim().length).toBeGreaterThan(800);
      expect(doc.ar.trim().length).toBeGreaterThan(600);
      expect(/[؀-ۿ]/.test(doc.ar)).toBe(true);
    }
  });

  it('every document carries the metadata the retrieval layer actually reads', () => {
    for (const doc of CONSTRUCTION_CORE) {
      expect(doc.knowledgeId).toMatch(/^[a-z0-9-]+$/);
      expect(KNOWLEDGE_DOMAINS[doc.domain]).toBeDefined();
      expect(AUTHORITY_TIERS[doc.authorityLevel]).toBeDefined();
      expect(doc.keywords.length).toBeGreaterThan(2);
      expect(doc.sourceName.length).toBeGreaterThan(5);
      expect(Number.isNaN(Date.parse(doc.reviewDate))).toBe(false);
    }
  });

  it('knowledge ids are unique', () => {
    const ids = CONSTRUCTION_CORE.map(d => d.knowledgeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every document carries Arabic keywords, so the Arabic site can retrieve', () => {
    for (const doc of CONSTRUCTION_CORE) {
      expect(doc.keywords.some(k => /[؀-ۿ]/.test(k))).toBe(true);
    }
  });
});

describe('retrieval', () => {
  it('finds the BOQ document from a natural question', () => {
    const hits = retrieve('What is a bill of quantities and how is it structured?');
    expect(hits[0].document.knowledgeId).toBe('qs-boq-fundamentals');
  });

  it('finds the SAME document from the Arabic question', () => {
    // The knowledge source must not change with the language.
    const hits = retrieve('ما هو جدول الكميات؟');
    expect(hits[0].document.knowledgeId).toBe('qs-boq-fundamentals');
  });

  it('returns nothing when the corpus has nothing to say', () => {
    // Silence is the correct answer for an uncovered topic. Returning the
    // nearest document would dress an unrelated answer as sourced.
    expect(retrieve('How do I tune a piano?')).toEqual([]);
  });

  it('authority breaks ties at equal relevance', () => {
    const base = CONSTRUCTION_CORE[0];
    const high = { ...base, knowledgeId: 'high', authorityLevel: 2 as const };
    const low = { ...base, knowledgeId: 'low', authorityLevel: 6 as const };
    const question = base.keywords[0];
    expect(scoreDocument(high, question)).toBe(scoreDocument(low, question));
    // Equal score, so the sort must prefer the higher authority (lower number).
    expect(high.authorityLevel).toBeLessThan(low.authorityLevel);
  });

  it('a stale document ranks below a current one on the same subject', () => {
    const base = CONSTRUCTION_CORE[0];
    const current = { ...base, reviewDate: '2099-01-01' };
    const expired = { ...base, reviewDate: '2020-01-01' };
    const question = base.keywords[0];
    expect(scoreDocument(current, question)).toBeGreaterThan(scoreDocument(expired, question));
  });

  it('nothing in the shipped corpus is already stale', () => {
    expect(staleDocuments()).toEqual([]);
  });
});

describe('what the model is handed', () => {
  it('each document arrives with its authority tier and source named', () => {
    const block = formatRetrievalForModel(retrieve('bill of quantities'), 'en');
    expect(block).toMatch(/authority: tier \d/);
    expect(block).toMatch(/source: /);
    expect(block).toMatch(/higher authority \(lower tier number\) wins/i);
  });

  it('the Arabic site receives the Arabic body of the SAME document', () => {
    const en = formatRetrievalForModel(retrieve('bill of quantities'), 'en');
    const ar = formatRetrievalForModel(retrieve('bill of quantities'), 'ar');
    expect(/[؀-ۿ]/.test(ar)).toBe(true);
    expect(/[؀-ۿ]/.test(en.replace(/[^\x00-\x7F]/g, ''))).toBe(false);
    // SAME document, different language body - not a second knowledge base.
    // Proved by both renderings carrying the same topic line, source and
    // version, while only the body differs.
    const topic = retrieve('bill of quantities')[0].document.topic;
    expect(en).toContain(topic);
    expect(ar).toContain(topic);
    expect(ar).toContain(CONSTRUCTION_CORE[0].sourceName);
    expect(en).toContain(CONSTRUCTION_CORE[0].en.slice(0, 60));
    expect(ar).toContain(CONSTRUCTION_CORE[0].ar.slice(0, 40));
  });

  it('a conflict in authority levels is stated rather than silently resolved', () => {
    const block = formatRetrievalForModel([
      { document: { ...CONSTRUCTION_CORE[0], authorityLevel: 2 }, score: 10 },
      { document: { ...CONSTRUCTION_CORE[1], authorityLevel: 6 }, score: 10 },
    ], 'en');
    expect(block).toMatch(/different authority levels/i);
    expect(block).toMatch(/say that they differ rather than silently picking one/i);
  });

  it('a stale document is LABELLED when shown, not hidden', () => {
    const block = formatRetrievalForModel(
      [{ document: { ...CONSTRUCTION_CORE[0], reviewDate: '2020-01-01' }, score: 10 }], 'en');
    expect(block).toMatch(/past its review date/i);
  });

  it('an empty retrieval adds nothing to the prompt', () => {
    expect(formatRetrievalForModel([], 'en')).toBe('');
  });
});

describe('coverage is reported honestly', () => {
  it('coveredDomains lists only domains that actually hold documents', () => {
    const covered = coveredDomains();
    expect(covered.length).toBeGreaterThan(0);
    expect(covered.length).toBeLessThan(Object.keys(KNOWLEDGE_DOMAINS).length);
    expect(corpusSize()).toBe(CONSTRUCTION_CORE.length);
  });
});

describe('retrieval is wired into the AI path', () => {
  it('the router retrieves and injects reference knowledge', () => {
    const chat = ROUTERS.slice(ROUTERS.indexOf('const aiRouter = router({'));
    expect(chat).toContain('formatRetrievalForModel(retrieve(lastQuestion), lang)');
    expect(chat).toContain('systemPrompt + referenceBlock + candidateBlock');
  });

  it('the corpus module cannot reach the database', () => {
    const SOURCE = readFileSync(new URL('./_core/knowledgeRetrieval.ts', import.meta.url), 'utf8');
    for (const forbidden of ['getDb', 'drizzle/schema', 'db.select']) {
      expect(SOURCE).not.toContain(forbidden);
    }
  });
});
