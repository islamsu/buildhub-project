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

/**
 * Both of these were found by a LIVE staging run, not by reasoning about the
 * code. Scenario 29.8 asked "I need a swimming pool specialist contractor in
 * Aswan. Who is on BuildHub?" and the router said no - so the directory was
 * never searched, and the model answered "I can't access BuildHub's live vendor
 * directory". That answer is honest about the model and wrong about BuildHub:
 * BuildHub CAN answer it, and the true answer is "nobody listed matches".
 */
describe('asking for a provider without using the word "recommend"', () => {
  it.each([
    'I need a swimming pool specialist contractor in Aswan. Who is on BuildHub?',
    'I need a contractor in Cairo',
    'We need an architect for a villa in Giza',
    'Who do you have for waterproofing in Alexandria? I want a contractor.',
    'Are there any suppliers listed on BuildHub for steel?',
    'أحتاج مهندس في القاهرة',
    'هل لديكم مقاول تشطيبات؟',
  ])('routes to the BuildHub directory: %s', question => {
    expect(detectIntent(question).wantsProviderRecommendation).toBe(true);
  });

  it('still extracts the filters from a needs-based phrasing', () => {
    const intent = detectIntent('I need a waterproofing contractor in Cairo');
    expect(intent.role).toBe('contractor');
    expect(intent.category).toBe('waterproofing');
    expect(intent.location).toBe('Cairo');
  });

  it('a city BuildHub does not list yields NO location filter, so the search stays wide', () => {
    // Aswan is not a served city. Guessing it would filter every real provider
    // out; leaving it off lets the broadening ladder answer honestly.
    const intent = detectIntent('I need a contractor in Aswan');
    expect(intent.wantsProviderRecommendation).toBe(true);
    expect(intent.location).toBeUndefined();
  });

  it('a stated need FAR from the role word is not a request for a provider', () => {
    // This is the reason the demand cue is windowed rather than matched
    // anywhere in the sentence. Routing this to the directory would answer
    // "BuildHub has no listed contractor" to someone asking about cost.
    const intent = detectIntent(
      'I need a rough cost estimate for finishing a 120 m2 apartment, and I am curious what a contractor typically charges for that',
    );
    expect(intent.wantsProviderRecommendation).toBe(false);
  });

  it('naming a role with no demand and no asking cue still does not fire', () => {
    expect(detectIntent('What does a main contractor do on site?').wantsProviderRecommendation).toBe(false);
    expect(detectIntent('The engineer signs off the structural drawings').wantsProviderRecommendation).toBe(false);
  });
});

/**
 * Limitation 19.2 from the previous handoff, closed.
 *
 * The staging answer that exposed it passed its check: asked for a "swimming
 * pool specialist contractor in Aswan", BuildHub returned a generic contractor
 * as "the best matches based on the available BuildHub data" - because neither
 * qualifier is in its vocabulary, both were silently dropped, and the search
 * then reported an EXACT match on the one criterion that survived.
 */
describe('qualifiers BuildHub cannot map are carried, not dropped', () => {
  it('reports both the unserved city and the unlisted trade', () => {
    const intent = detectIntent('I need a swimming pool specialist contractor in Aswan. Who is on BuildHub?');
    expect(intent.wantsProviderRecommendation).toBe(true);
    expect(intent.location).toBeUndefined();
    expect(intent.unmappedQualifiers).toContain('Aswan');
    expect(intent.unmappedQualifiers).toContain('the specific trade asked for');
  });

  it('reports nothing when everything asked for WAS mapped', () => {
    const intent = detectIntent('Can you recommend a waterproofing contractor in Cairo?');
    expect(intent.category).toBe('waterproofing');
    expect(intent.location).toBe('Cairo');
    expect(intent.unmappedQualifiers).toEqual([]);
  });

  it('a served city is never reported as unmapped', () => {
    expect(detectIntent('I need a plumbing contractor in Alexandria').unmappedQualifiers).toEqual([]);
  });

  it('is empty when no recommendation was requested at all', () => {
    expect(detectIntent('What causes honeycombing in concrete?').unmappedQualifiers).toEqual([]);
  });

  it('does not mistake a common phrase after "in" for a place name', () => {
    const intent = detectIntent('I need a contractor in the event that my current one withdraws');
    expect(intent.unmappedQualifiers).not.toContain('the');
  });
});
