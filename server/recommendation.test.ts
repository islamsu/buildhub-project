/**
 * The recommendation engine.
 *
 * The property under test throughout is that BuildHub decides the ranking and
 * the model only explains it - and that a signal BuildHub does not store never
 * becomes a signal the answer claims.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// vi.hoisted, because vi.mock is hoisted above ordinary top-level consts and a
// plain `const fn = vi.fn()` is not initialised by the time the factory runs.
const { listDirectoryVendors } = vi.hoisted(() => ({ listDirectoryVendors: vi.fn() }));
vi.mock('./vendorDirectory', async () => {
  const actual = await vi.importActual<typeof import('./vendorDirectory')>('./vendorDirectory');
  return { ...actual, listDirectoryVendors };
});

import { detectIntent } from './_core/aiIntent';
import { scoreProvider, recommendProviders, formatCandidatesForModel, MAX_RECOMMENDATIONS } from './recommendation';
import type { DirectoryVendor } from './vendorDirectory';

const vendor = (over: Partial<DirectoryVendor> & { id: number }): DirectoryVendor => ({
  name: `Vendor ${over.id}`, bio: null, avatar: null, location: 'Cairo',
  userRole: 'contractor', verified: false, createdAt: new Date('2025-01-01'),
  categories: [], averageRating: null, reviewCount: 0, ...over,
});

describe('scoring uses only signals BuildHub actually stores', () => {
  it('an exact service-category match outranks everything else combined', () => {
    const exact = scoreProvider(vendor({ id: 1, categories: ['waterproofing'] }), { category: 'waterproofing' });
    const decorated = scoreProvider(
      vendor({ id: 2, verified: true, averageRating: 5, reviewCount: 50, categories: ['painting'] }),
      { category: 'waterproofing' });
    expect(exact.score).toBeGreaterThan(decorated.score);
  });

  it('a related category scores, but below an exact one', () => {
    const exact = scoreProvider(vendor({ id: 1, categories: ['waterproofing'] }), { category: 'waterproofing' });
    const related = scoreProvider(vendor({ id: 2, categories: ['waterproofing and insulation'] }), { category: 'waterproofing' });
    expect(related.score).toBeGreaterThan(0);
    expect(related.score).toBeLessThan(exact.score);
  });

  it('location matters', () => {
    const near = scoreProvider(vendor({ id: 1, location: 'Cairo, Egypt' }), { location: 'Cairo' });
    const far = scoreProvider(vendor({ id: 2, location: 'Riyadh' }), { location: 'Cairo' });
    expect(near.score).toBeGreaterThan(far.score);
    expect(near.reasons.join()).toMatch(/listed in Cairo/i);
  });

  it('verification counts', () => {
    expect(scoreProvider(vendor({ id: 1, verified: true }), {}).score)
      .toBeGreaterThan(scoreProvider(vendor({ id: 2, verified: false }), {}).score);
  });

  it('a rating with NO reviews behind it scores nothing and is never described', () => {
    // The fabrication this guards against: a 5.0 default on an unreviewed
    // account reading as a five-star provider.
    const unreviewed = scoreProvider(vendor({ id: 1, averageRating: 5, reviewCount: 0 }), {});
    expect(unreviewed.score).toBe(0);
    expect(unreviewed.reasons.join()).not.toMatch(/5\.0|review/i);
  });

  it('a real rating is scored and quoted exactly as stored', () => {
    const reviewed = scoreProvider(vendor({ id: 1, averageRating: 4.5, reviewCount: 12 }), {});
    expect(reviewed.score).toBeGreaterThan(0);
    expect(reviewed.reasons.join()).toContain('4.5/5 from 12 reviews');
  });

  it('a provider with no matching signals gets a reason saying so, not an invented one', () => {
    const bare = scoreProvider(vendor({ id: 1 }), { category: 'waterproofing' });
    expect(bare.score).toBe(0);
    expect(bare.reasons).toEqual([]);
  });
});

describe('search BuildHub first, then broaden, then admit no match', () => {
  beforeEach(() => { listDirectoryVendors.mockReset(); });

  it('exact matches are returned as exact', async () => {
    listDirectoryVendors.mockResolvedValueOnce([vendor({ id: 1, categories: ['waterproofing'] })]);
    const out = await recommendProviders({ category: 'waterproofing', location: 'Cairo' });
    expect(out.matchQuality).toBe('exact');
    expect(out.broadenedBy).toEqual([]);
    expect(out.candidates).toHaveLength(1);
  });

  it('no local match broadens the LOCATION and says so', async () => {
    listDirectoryVendors
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([vendor({ id: 2, location: 'Alexandria', categories: ['waterproofing'] })]);
    const out = await recommendProviders({ category: 'waterproofing', location: 'Cairo' });
    expect(out.matchQuality).toBe('related');
    expect(out.broadenedBy.join()).toContain('Cairo');
    expect(out.appliedCriteria.location).toBeUndefined();
  });

  it('no category match broadens the CATEGORY and says so', async () => {
    listDirectoryVendors
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([vendor({ id: 3 })]);
    const out = await recommendProviders({ category: 'waterproofing', location: 'Cairo' });
    expect(out.matchQuality).toBe('related');
    expect(out.broadenedBy.join()).toContain('waterproofing');
  });

  it('nothing anywhere returns none - never a filled list', async () => {
    listDirectoryVendors.mockResolvedValue([]);
    const out = await recommendProviders({ category: 'waterproofing', location: 'Cairo' });
    expect(out.matchQuality).toBe('none');
    expect(out.candidates).toEqual([]);
  });

  it('results are capped', async () => {
    listDirectoryVendors.mockResolvedValueOnce(
      Array.from({ length: 30 }, (_, i) => vendor({ id: i + 1, categories: ['waterproofing'] })));
    const out = await recommendProviders({ category: 'waterproofing' });
    expect(out.candidates.length).toBeLessThanOrEqual(MAX_RECOMMENDATIONS);
  });

  it('unauthorized providers are excluded because the DIRECTORY excludes them', async () => {
    // The engine never queries users directly - it inherits the directory's
    // approved/active/non-deactivated filter. A second filter here could drift
    // out of step with that one, so there deliberately is not one.
    const SOURCE = (await import('node:fs')).readFileSync(new URL('./recommendation.ts', import.meta.url), 'utf8');
    expect(SOURCE).toContain("from './vendorDirectory'");
    for (const forbidden of ['getDb', 'drizzle/schema', 'db.select', 'onboardingStatus', 'accountStatus']) {
      expect(SOURCE).not.toContain(forbidden);
    }
  });

  it('ordering is stable for identical scores', async () => {
    listDirectoryVendors.mockResolvedValueOnce([vendor({ id: 9 }), vendor({ id: 3 }), vendor({ id: 7 })]);
    const first = await recommendProviders({});
    listDirectoryVendors.mockResolvedValueOnce([vendor({ id: 7 }), vendor({ id: 9 }), vendor({ id: 3 })]);
    const second = await recommendProviders({});
    expect(first.candidates.map(c => c.vendor.id)).toEqual(second.candidates.map(c => c.vendor.id));
  });
});

describe('what the model is handed', () => {
  it('the model is told the order is not its to change', () => {
    const block = formatCandidatesForModel({
      matchQuality: 'exact', broadenedBy: [], appliedCriteria: {},
      candidates: [{ vendor: vendor({ id: 1, verified: true }), score: 15, reasons: ['is a verified BuildHub provider'] }],
    }, 'en');
    expect(block).toMatch(/Present them in THIS ORDER/);
    expect(block.replace(/\s+/g, ' ')).toMatch(/must not re-order it/);
  });

  it('the absent signals are NAMED so they cannot be imagined', () => {
    const block = formatCandidatesForModel({
      matchQuality: 'exact', broadenedBy: [], appliedCriteria: {},
      candidates: [{ vendor: vendor({ id: 1 }), score: 0, reasons: [] }],
    }, 'en');
    for (const absent of ['availability', 'response time', 'years of experience', 'portfolio relevance', 'pricing fits any budget']) {
      expect(block).toContain(absent);
    }
    expect(block.replace(/\s+/g, ' ')).toMatch(/Do not state, estimate or imply any of them/);
  });

  it('no-match forbids naming a provider and offers the RFQ route', () => {
    const block = formatCandidatesForModel({ matchQuality: 'none', broadenedBy: [], candidates: [], appliedCriteria: {} }, 'en');
    expect(block).toMatch(/NO SUITABLE BUILDHUB-LISTED PROVIDER/);
    expect(block.replace(/\s+/g, ' ')).toMatch(/Do NOT name any provider/);
    expect(block).toMatch(/post an RFQ/);
  });

  it('external providers must be labelled and never implied to be endorsed', () => {
    const block = formatCandidatesForModel({ matchQuality: 'none', broadenedBy: [], candidates: [], appliedCriteria: {} }, 'en');
    expect(block).toContain('External recommendation - not currently listed on BuildHub');
    expect(block.replace(/\s+/g, ' ')).toMatch(/not imply BuildHub has verified or endorsed/);
  });

  it('a related result is labelled as related, not passed off as exact', () => {
    const block = formatCandidatesForModel({
      matchQuality: 'related', broadenedBy: ['no match in "Cairo" - searched all locations'], appliedCriteria: {},
      candidates: [{ vendor: vendor({ id: 1 }), score: 0, reasons: [] }],
    }, 'en');
    expect(block).toMatch(/RELATED/);
    expect(block).toMatch(/do not present them as matches for the original request/);
  });

  it('unreviewed providers are shown as unreviewed, not as unrated-but-good', () => {
    const block = formatCandidatesForModel({
      matchQuality: 'exact', broadenedBy: [], appliedCriteria: {},
      candidates: [{ vendor: vendor({ id: 1 }), score: 0, reasons: [] }],
    }, 'en');
    expect(block).toContain('rating: no reviews yet');
  });

  it('superlatives are forbidden', () => {
    const block = formatCandidatesForModel({
      matchQuality: 'exact', broadenedBy: [], appliedCriteria: {},
      candidates: [{ vendor: vendor({ id: 1 }), score: 0, reasons: [] }],
    }, 'en');
    expect(block).toMatch(/best match based on the available BuildHub data/);
    expect(block).toMatch(/Do not claim any provider is the best in a city/);
  });
});

describe('a partial match is never presented as an exact one', () => {
  const candidate = {
    matchQuality: 'exact' as const,
    broadenedBy: [] as string[],
    appliedCriteria: { role: 'contractor' },
    candidates: [{
      score: 25,
      reasons: ['role matches'],
      vendor: {
        id: 1, name: 'QA contractor', userRole: 'contractor', location: null,
        verified: true, averageRating: null, reviewCount: 0, categories: [] as string[],
      },
    }],
  };

  it('says PARTIAL, and names what it could not match on', () => {
    // matchQuality is now the single source of truth for the header, so a
    // PARTIAL outcome is constructed rather than inferred from the argument.
    const block = formatCandidatesForModel(
      { ...candidate, matchQuality: 'partial' as const },
      'en',
      ['Aswan', 'the specific trade asked for'],
    );
    expect(block).toContain('MATCH QUALITY: PARTIAL');
    expect(block).toContain('WHAT BUILDHUB COULD NOT MATCH ON');
    expect(block).toContain('Aswan');
    expect(block).toMatch(/do not\s+imply any of them specialises in it/);
    expect(block).toMatch(/RFQ/);
  });

  it('still says EXACT when nothing was dropped', () => {
    const block = formatCandidatesForModel(candidate, 'en', []);
    expect(block).toContain('MATCH QUALITY: EXACT');
    expect(block).not.toContain('COULD NOT MATCH ON');
  });

  it('the router passes the unmapped qualifiers through - not a default of none', () => {
    const routers = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    expect(routers).toContain('formatCandidatesForModel(outcome, lang, intent.unmappedQualifiers)');
  });
});

describe('Part 8: a generic provider is never an EXACT match for a specialist request', () => {
  it('"swimming pool specialist contractor in Aswan" is PARTIAL, not exact', async () => {
    // The exact defect from the audit, asserted end to end through the real
    // intent router rather than with hand-built criteria - because the bug was
    // in the handoff between the two, not in either half.
    const intent = detectIntent('I need a swimming pool specialist contractor in Aswan. Who is on BuildHub?');
    listDirectoryVendors.mockResolvedValue([
      { id: 1, name: 'QA contractor', userRole: 'contractor', location: null, verified: true, averageRating: null, reviewCount: 0, categories: [] },
    ]);

    const outcome = await recommendProviders({
      role: intent.role,
      category: intent.category,
      location: intent.location,
      unmatchedQualifiers: intent.unmappedQualifiers,
    });

    expect(outcome.matchQuality).toBe('partial');
    expect(outcome.matchQuality).not.toBe('exact');
    expect(outcome.candidates.length).toBeGreaterThan(0);
  });

  it('a request with nothing dropped IS exact', async () => {
    listDirectoryVendors.mockResolvedValue([
      { id: 1, name: 'W', userRole: 'contractor', location: 'Cairo', verified: true, averageRating: null, reviewCount: 0, categories: ['waterproofing'] },
    ]);
    const intent = detectIntent('Can you recommend a waterproofing contractor in Cairo?');
    expect(intent.unmappedQualifiers).toEqual([]);

    const outcome = await recommendProviders({
      role: intent.role, category: intent.category, location: intent.location,
      unmatchedQualifiers: intent.unmappedQualifiers,
    });
    expect(outcome.matchQuality).toBe('exact');
  });

  it('the four levels are distinct and none is a synonym for another', () => {
    const levels: Array<'exact' | 'partial' | 'related' | 'none'> = ['exact', 'partial', 'related', 'none'];
    const headers = levels.filter(level => level !== 'none').map(level =>
      formatCandidatesForModel({
        matchQuality: level,
        broadenedBy: level === 'related' ? ['dropped the location'] : [],
        appliedCriteria: { role: 'contractor' },
        candidates: [{
          score: 25, reasons: ['role matches'],
          vendor: { id: 1, name: 'X', userRole: 'contractor', location: null, verified: true, averageRating: null, reviewCount: 0, categories: [] },
        }],
      }, 'en'));
    expect(new Set(headers).size).toBe(3);
    expect(headers[0]).toContain('EXACT');
    expect(headers[1]).toContain('PARTIAL');
    expect(headers[2]).toContain('RELATED');
  });
});
