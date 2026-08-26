/**
 * Intent routing.
 *
 * Two decisions matter and both are expensive to get wrong: querying BuildHub
 * for a provider request (getting it wrong means the model invents companies)
 * and running a paid web search (getting it wrong means paying for every
 * "what is a BOQ?"). Both must be conservative and both must be testable.
 */
import { describe, expect, it } from 'vitest';
import { detectIntent, extractCategory, extractLocation } from './_core/aiIntent';

describe('provider recommendation detection', () => {
  it.each([
    'Can you recommend a contractor in Cairo?',
    'I am looking for a waterproofing contractor',
    'Which supplier should I use for steel?',
    'رشح لي مقاول تشطيبات في القاهرة',
    'أبحث عن مورد ألمنيوم',
  ])('detects a recommendation request: %s', question => {
    expect(detectIntent(question).wantsProviderRecommendation).toBe(true);
  });

  it.each([
    'What does a main contractor actually do?',
    'What is the difference between an architect and an engineer?',
    'How do I calculate concrete quantities?',
    'ما هو دور المقاول الرئيسي؟',
  ])('does NOT fire on a question that merely mentions a role: %s', question => {
    // "What does a contractor do?" names a role and asks for knowledge, not a
    // shortlist. Firing here would query the directory and tempt the model to
    // answer with company names.
    expect(detectIntent(question).wantsProviderRecommendation).toBe(false);
  });

  it('extracts role, category and location together', () => {
    const intent = detectIntent('Please recommend a waterproofing contractor in Alexandria');
    expect(intent.role).toBe('contractor');
    expect(intent.category).toBe('waterproofing');
    expect(intent.location).toBe('Alexandria');
  });

  it('extracts the Arabic equivalents to the SAME canonical values', () => {
    const intent = detectIntent('رشح لي مقاول عزل في الإسكندرية');
    expect(intent.role).toBe('contractor');
    expect(intent.category).toBe('waterproofing');
    expect(intent.location).toBe('Alexandria');
  });

  it('an unrecognised city yields NO location rather than a guess', () => {
    // Guessing wrongly filters real providers out of the search, which is worse
    // than not filtering at all.
    expect(extractLocation('recommend a contractor in Tanta')).toBeUndefined();
  });

  it('an unrecognised trade yields NO category rather than a guess', () => {
    expect(extractCategory('recommend a contractor for chandelier restoration')).toBeUndefined();
  });
});

describe('current-information detection', () => {
  it.each([
    'What is the current price of cement in Egypt?',
    'What is the latest edition of the Saudi Building Code?',
    'What are steel market prices right now?',
    'ما هو السعر الحالي للأسمنت؟',
  ])('fires for time-sensitive questions: %s', question => {
    expect(detectIntent(question).wantsCurrentInformation).toBe(true);
  });

  it.each([
    'What is a bill of quantities?',
    'How do I calculate the cost of concrete per cubic metre?',
    'What is the difference between C25 and C30 concrete?',
    'ما هو جدول الكميات؟',
  ])('does NOT fire for timeless questions: %s', question => {
    // These read as cost questions but the answer is a method, not a number
    // that changes weekly. Searching for them is latency and money for nothing.
    expect(detectIntent(question).wantsCurrentInformation).toBe(false);
  });

  it('a plain construction question triggers neither branch', () => {
    const intent = detectIntent('What causes honeycombing in concrete?');
    expect(intent.wantsProviderRecommendation).toBe(false);
    expect(intent.wantsCurrentInformation).toBe(false);
  });
});
