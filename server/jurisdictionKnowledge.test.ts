import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  REGULATORY_REFERENCES, findRegulatory, formatRegulatoryForModel, COVERED_JURISDICTIONS,
} from './knowledge/jurisdictions';
import { JURISDICTIONS } from '@shared/knowledgeTaxonomy';

const SOURCE = readFileSync(new URL('./knowledge/jurisdictions.ts', import.meta.url), 'utf8');
const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');

describe('regulatory records are pointers, never contents', () => {
  it('every record carries the provenance a reader needs to check it', () => {
    for (const reference of REGULATORY_REFERENCES) {
      expect(reference.authority.length).toBeGreaterThan(10);
      expect(reference.authorityAr.length).toBeGreaterThan(5);
      // An edition is OPTIONAL, and its absence is only acceptable alongside an
      // explicit unverified status - a record may not simply go quiet about it.
      if (reference.edition === undefined) {
        expect(reference.status).toBe('unverified');
        // The substance, not one phrasing: the note must make clear BuildHub
        // does not hold a confirmed edition. Jordan's record says WHY there is
        // no single edition to hold, which is better than the stock sentence.
        expect(reference.note).toMatch(/not established|issuing bodies only|no single edition/i);
      } else {
        expect(reference.edition.length).toBeGreaterThan(0);
      }
      expect(Number.isNaN(Date.parse(reference.reviewDate))).toBe(false);
      expect(reference.sourceUrl).toMatch(/^https:\/\//);
      expect(Number.isNaN(Date.parse(reference.lastVerified))).toBe(false);
      expect(reference.keywords.length).toBeGreaterThan(3);
      expect(['current', 'superseded-in-part', 'unverified']).toContain(reference.status);
    }
  });

  it('both languages are populated for every field a user will read', () => {
    for (const reference of REGULATORY_REFERENCES) {
      expect(/[؀-ۿ]/.test(reference.authorityAr)).toBe(true);
      expect(/[؀-ۿ]/.test(reference.codeAr)).toBe(true);
      expect(/[؀-ۿ]/.test(reference.scopeAr)).toBe(true);
      expect(/[؀-ۿ]/.test(reference.noteAr)).toBe(true);
    }
  });

  it('NO record reproduces clause text, a table, or a numeric requirement', () => {
    // The copyright line and the accuracy line are the same line here: a code
    // requirement stated from memory is both an infringement risk and the most
    // dangerous kind of wrong answer this assistant could give.
    for (const reference of REGULATORY_REFERENCES) {
      const body = `${reference.scope} ${reference.note} ${reference.scopeAr} ${reference.noteAr}`;
      // No clause-shaped citations, no dimensional requirements.
      expect(body).not.toMatch(/clause\s+\d+\.\d+/i);
      expect(body).not.toMatch(/table\s+\d+\.\d+/i);
      expect(body).not.toMatch(/\b\d+\s?(mm|cm)\b/i);
      expect(body).not.toMatch(/\bminimum of \d+/i);
    }
  });

  it('the module holds no clause content at all, by construction', () => {
    // Stated as a property of the FILE, so adding a "helpful" requirement to a
    // record fails here rather than reaching a user.
    const withoutComments = SOURCE.split('\n').filter(line => !line.trim().startsWith('*') && !line.trim().startsWith('//')).join('\n');
    expect(withoutComments).not.toMatch(/shall not be less than/i);
    expect(withoutComments).not.toMatch(/minimum cover/i);
  });
});

describe('a superseded edition is never presented as the current one', () => {
  it('the Saudi record states that a newer edition exists', () => {
    const sbc = REGULATORY_REFERENCES.find(reference => reference.id === 'sa-sbc')!;
    expect(sbc.status).toBe('superseded-in-part');
    expect(sbc.edition).toMatch(/2024/);
    expect(sbc.note).toMatch(/2024/);
    expect(sbc.note).toMatch(/confirm/i);
  });

  it('the UAE record states that local emirate amendments govern', () => {
    const fire = REGULATORY_REFERENCES.find(reference => reference.id === 'ae-fire-code')!;
    expect(fire.status).toBe('superseded-in-part');
    expect(fire.note).toMatch(/amend/i);
    expect(fire.note).toMatch(/Civil Defence/i);
  });

  it('the Egyptian record admits BuildHub has not verified a later edition', () => {
    // The honest status. Claiming 'current' for an edition nobody checked is
    // the exact failure this field exists to prevent.
    const ecp = REGULATORY_REFERENCES.find(reference => reference.id === 'eg-ecp-203')!;
    expect(ecp.status).toBe('unverified');
    expect(ecp.note).toMatch(/confirm the current edition/i);
    expect(ecp.note).toMatch(/Arabic text is the official one/i);
  });

  it('any record NOT marked current must say why in its note', () => {
    for (const reference of REGULATORY_REFERENCES.filter(item => item.status !== 'current')) {
      expect(reference.note.length).toBeGreaterThan(80);
      // Whatever the reason, the note must send the reader to the authority
      // rather than leaving them with BuildHub's uncertainty and nothing to do.
      expect(reference.note).toMatch(/confirm|amend|newer|later|obtain|not established|check|review|raise/i);
    }
  });
});

describe('coverage is reported honestly', () => {
  it('all eight supported markets now have a record', () => {
    const supported = Object.keys(JURISDICTIONS).filter(code => code !== 'GLOBAL');
    expect([...COVERED_JURISDICTIONS].sort()).toEqual([...supported].sort());
  });

  it('COVERAGE IS NOT THE SAME AS CONFIRMATION - most records are unverified', () => {
    // The honest shape of this corpus: BuildHub knows who regulates every
    // market and has confirmed the current edition in almost none of them.
    // A test that only counted markets would read as "8/8 done".
    const unverified = REGULATORY_REFERENCES.filter(reference => reference.status === 'unverified');
    expect(unverified.length).toBeGreaterThan(0);
    expect(REGULATORY_REFERENCES.every(reference => reference.status === 'current')).toBe(false);
  });

  it('a market whose edition is unknown says so, rather than borrowing a neighbour\'s', () => {
    // Reasoning by analogy from Saudi to Kuwait is how a project gets designed
    // to the wrong country's code. The record names the authority and stops.
    const kuwait = REGULATORY_REFERENCES.find(reference => reference.jurisdiction === 'KW')!;
    expect(kuwait.edition).toBeUndefined();
    const block = formatRegulatoryForModel([kuwait], 'en');
    expect(block).toContain('NOT ESTABLISHED BY BUILDHUB');
    expect(block).toMatch(/Do NOT supply\s+an edition from your own recollection/);
    expect(block).not.toMatch(/undefined/);
  });

  it('a question naming no covered instrument retrieves nothing', () => {
    expect(findRegulatory('what colour should I paint my kitchen?')).toHaveLength(0);
    expect(formatRegulatoryForModel([], 'en')).toBe('');
  });

  it('the jurisdiction filter keeps one country\'s question off another country\'s code', () => {
    const saudiOnly = findRegulatory('which building code applies here?', 'SA');
    expect(saudiOnly.every(reference => reference.jurisdiction === 'SA')).toBe(true);
  });
});

describe('retrieval and the instruction block', () => {
  it('finds the right instrument from a natural question, in both languages', () => {
    expect(findRegulatory('which edition of the saudi building code applies?').map(r => r.id)).toContain('sa-sbc');
    expect(findRegulatory('ما هي النسخة السارية من كود البناء السعودي؟').map(r => r.id)).toContain('sa-sbc');
    expect(findRegulatory('what does the uae fire code require for stairs?').map(r => r.id)).toContain('ae-fire-code');
    expect(findRegulatory('هل الكود المصري ECP 203 محدث؟').map(r => r.id)).toContain('eg-ecp-203');
  });

  it('the block forbids reconstructing a requirement and demands the edition be stated', () => {
    const block = formatRegulatoryForModel(findRegulatory('saudi building code'), 'en');
    expect(block).toMatch(/POINTERS TO INSTRUMENTS, not their contents/);
    expect(block).toMatch(/DO NOT quote, paraphrase or reconstruct/);
    expect(block).toMatch(/STATE THE EDITION AND ITS STATUS EXPLICITLY/);
    expect(block).toMatch(/presenting a superseded edition as\s+current is a serious error/);
    expect(block).toMatch(/If the person has not said which country/);
  });

  it('the block carries the official source and the verification date', () => {
    const block = formatRegulatoryForModel(findRegulatory('saudi building code'), 'en');
    expect(block).toContain('https://sbc.gov.sa/');
    expect(block).toContain('2026-08-26');
    expect(block).toContain('status: superseded-in-part');
  });

  it('the Arabic block is Arabic', () => {
    const block = formatRegulatoryForModel(findRegulatory('كود البناء السعودي'), 'ar');
    expect(/[؀-ۿ]/.test(block)).toBe(true);
    expect(block).toContain('اللجنة الوطنية لكود البناء السعودي');
  });

  it('the router injects the regulatory block into the AI request', () => {
    const chat = ROUTERS.slice(ROUTERS.indexOf('const aiRouter = router({'));
    // The jurisdiction comes from the QUESTION, not the account - see
    // extractJurisdiction. A Saudi question asked by an Egyptian customer is a
    // Saudi question.
    expect(chat).toContain('formatRegulatoryForModel(findRegulatory(lastQuestion, intent.jurisdiction), lang)');
    expect(chat).toContain('regulatoryBlock');
  });
});
