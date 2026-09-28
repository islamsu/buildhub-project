/**
 * ── A REQUEST A FIRST-TIME HOMEOWNER CAN ACTUALLY PUBLISH ───────────────
 *
 * The rule most of these protect is the escape hatch. A person who has just
 * taken delivery of a shell apartment does not know what finishing level they
 * want, and a form that insists produces one of two things: an abandoned form,
 * or an invented answer that a contractor then prices.
 *
 * So `لا أعرف / ساعدني في الاختيار` is a stored state, it never blocks
 * publication, and it is never silently replaced with a value. Those three are
 * asserted separately because they fail separately.
 *
 * The other half is the distinction between ABSENT and UNKNOWN. "Not asked yet"
 * and "asked, and they said they do not know" are different facts, and only the
 * second should make the assistant offer to explain.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  UNKNOWN, UNKNOWN_LABEL, isUnknown, statedOrUnknown,
  REQUESTING_PARTIES, isProfessionalParty, requestingPartyLabel,
  FINISHING_KINDS, FINISHING_LEVELS, FINISHING_AREAS, FINISHING_TRADES,
  PROPERTY_TYPES, CURRENT_CONDITIONS,
  finishingLevelLabel, finishingKindLabel, finishingAreaLabel, finishingTradeLabel,
  propertyTypeLabel, currentConditionLabel,
  PRICING_PREFERENCES, pricingPreferenceLabel, methodAllowedByPreference,
  HELPABLE_BRIEF_FIELDS, unknownFields, briefArea, briefBlocksPublication,
  type FinishingBrief,
} from '../shared/finishing';
import { PRICING_METHODS } from '../shared/quotationPricing';

const ROOT = join(import.meta.dirname, '..');
const code = (relative: string) => readSourceForAssertions(readFileSync(join(ROOT, relative), 'utf8'));

describe('"I don\'t know" is a stored answer, not a missing one', () => {
  it('it is a sentinel distinct from null and from empty', () => {
    expect(isUnknown(UNKNOWN)).toBe(true);
    expect(isUnknown(null)).toBe(false);
    expect(isUnknown(undefined)).toBe(false);
    expect(isUnknown('')).toBe(false);
    expect(isUnknown('standard')).toBe(false);
  });

  it('and it reads as itself in both languages, never as a value', () => {
    expect(statedOrUnknown(UNKNOWN, finishingLevelLabel, 'ar')).toBe(UNKNOWN_LABEL.ar);
    expect(statedOrUnknown(UNKNOWN, finishingLevelLabel, 'en')).toBe(UNKNOWN_LABEL.en);
    expect(UNKNOWN_LABEL.ar).toContain('لا أعرف');
  });

  it('ABSENT AND UNKNOWN ARE DIFFERENT, and both are distinct from a value', () => {
    // Absent is "not asked". Unknown is "asked, and they said they do not know".
    // Only the second should make the assistant offer to explain.
    expect(statedOrUnknown(null, finishingLevelLabel, 'en')).toBeNull();
    expect(statedOrUnknown(undefined, finishingLevelLabel, 'en')).toBeNull();
    expect(statedOrUnknown('standard', finishingLevelLabel, 'en')).toBe('Standard');
  });

  it('IT IS NEVER REPLACED WITH A DEFAULT', () => {
    /*
     * The failure this catches: defaulting an unknown level to "standard" puts a
     * number on a bid for a standard nobody chose, and neither party ever finds
     * out it was guessed.
     */
    for (const lang of ['en', 'ar'] as const) {
      const rendered = statedOrUnknown(UNKNOWN, finishingLevelLabel, lang);
      for (const level of FINISHING_LEVELS) {
        expect(rendered).not.toBe(finishingLevelLabel(level, lang));
      }
    }
  });

  it('and a brief full of unknowns still publishes', () => {
    const brief: FinishingBrief = {
      kind: UNKNOWN, propertyType: UNKNOWN, currentCondition: UNKNOWN,
      areaSqm: UNKNOWN, level: UNKNOWN, materialPreferences: UNKNOWN, siteConstraints: UNKNOWN,
    };
    expect(briefBlocksPublication(brief)).toBe(false);
    expect(briefBlocksPublication(null)).toBe(false);
    expect(briefBlocksPublication({})).toBe(false);
  });
});

describe('the unknowns are reported for exactly the fields that carry them', () => {
  it('names only the fields explicitly marked unknown', () => {
    const brief: FinishingBrief = { level: UNKNOWN, kind: 'full', areaSqm: 120 };
    expect(unknownFields(brief)).toEqual(['level']);
  });

  it('an absent field is NOT an unknown one', () => {
    expect(unknownFields({ kind: 'full' })).toEqual([]);
    expect(unknownFields({})).toEqual([]);
    expect(unknownFields(null)).toEqual([]);
  });

  it('and every helpable field is actually detectable', () => {
    // A field in the list that unknownFields cannot see would be an offer of
    // help that never appears.
    const all: Record<string, unknown> = {};
    for (const field of HELPABLE_BRIEF_FIELDS) all[field] = UNKNOWN;
    expect(unknownFields(all as FinishingBrief)).toEqual([...HELPABLE_BRIEF_FIELDS]);
  });
});

describe('the area a comparison may divide by', () => {
  it('is the stated number when there is one', () => {
    expect(briefArea({ areaSqm: 145 })).toBe(145);
  });

  it('and is NULL for unknown, absent, zero or negative', () => {
    /*
     * A rate per square metre computed from an area nobody stated is the number a
     * customer would use to choose between bids. Null, never a guess.
     */
    expect(briefArea({ areaSqm: UNKNOWN })).toBeNull();
    expect(briefArea({})).toBeNull();
    expect(briefArea(null)).toBeNull();
    expect(briefArea({ areaSqm: 0 })).toBeNull();
    expect(briefArea({ areaSqm: -20 })).toBeNull();
  });
});

describe('a finishing request comes from every requesting party', () => {
  it('all seven the spec names are represented', () => {
    expect([...REQUESTING_PARTIES]).toEqual([
      'property_owner', 'developer', 'consultant', 'main_contractor',
      'subcontractor', 'property_manager', 'organization',
    ]);
  });

  it('each has a bilingual label', () => {
    for (const party of REQUESTING_PARTIES) {
      expect(requestingPartyLabel(party, 'en')).toBeTruthy();
      expect(requestingPartyLabel(party, 'ar')).toBeTruthy();
      expect(requestingPartyLabel(party, 'ar')).not.toBe(requestingPartyLabel(party, 'en'));
    }
  });

  it('the professional parties get the denser intake and the owner does not', () => {
    expect(isProfessionalParty('property_owner')).toBe(false);
    for (const party of REQUESTING_PARTIES.filter(p => p !== 'property_owner')) {
      expect(isProfessionalParty(party), party).toBe(true);
    }
  });

  it('and an unknown or absent party is treated as the simpler form, not the denser one', () => {
    // Guessing "professional" would show a person who has not said who they are
    // a bill-of-quantities form.
    expect(isProfessionalParty(UNKNOWN)).toBe(false);
    expect(isProfessionalParty(null)).toBe(false);
    expect(isProfessionalParty(undefined)).toBe(false);
  });

  it('and this is NOT a second identity taxonomy', () => {
    /*
     * Authorization comes from the account, never from this field. If the module
     * ever started making permission decisions from it, that would be a parallel
     * identity model - the thing the brief forbids.
     */
    const module = code('shared/finishing.ts');
    for (const forbidden of ['userRole', 'accountStatus', 'adminRole', 'canAccess', 'authorize']) {
      expect(module, `finishing.ts reasons about ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('the pricing preference is a preference, never a gate', () => {
  it('the four options include "let the contractor propose"', () => {
    expect([...PRICING_PREFERENCES]).toContain('provider_choice');
    expect(pricingPreferenceLabel('provider_choice', 'ar')).toBe('دع المقاول يقترح طريقة التسعير');
  });

  it('every preference maps onto a real pricing method, except provider_choice', () => {
    for (const preference of PRICING_PREFERENCES) {
      if (preference === 'provider_choice') continue;
      expect([...PRICING_METHODS]).toContain(preference);
    }
  });

  it('ABSENT permits any method, because nothing was asked', () => {
    for (const method of PRICING_METHODS) {
      expect(methodAllowedByPreference(null, method), method).toBe(true);
      expect(methodAllowedByPreference(undefined, method), method).toBe(true);
    }
  });

  it('provider_choice permits any method, because that is what it says', () => {
    for (const method of PRICING_METHODS) {
      expect(methodAllowedByPreference('provider_choice', method), method).toBe(true);
    }
  });

  it('A STATED METHOD IS ENFORCED, which is what makes stating one worth anything', () => {
    expect(methodAllowedByPreference('package', 'package')).toBe(true);
    expect(methodAllowedByPreference('package', 'percentage')).toBe(false);
    expect(methodAllowedByPreference('detailed', 'custom')).toBe(false);
    expect(methodAllowedByPreference('percentage', 'detailed')).toBe(false);
  });

  it('and the server refuses a mismatched method rather than silently repricing', () => {
    const routers = code('server/routers.ts');
    expect(routers).toContain('methodAllowedByPreference(');
    expect(routers).toContain('This request asked to be priced a different way.');
  });

  it('unknown is treated as permissive, not as a constraint nobody chose', () => {
    expect(methodAllowedByPreference(UNKNOWN, 'package')).toBe(true);
  });
});

describe('every brief vocabulary is bilingual and non-empty', () => {
  const tables = [
    ['finishing kind', FINISHING_KINDS, finishingKindLabel],
    ['property type', PROPERTY_TYPES, propertyTypeLabel],
    ['current condition', CURRENT_CONDITIONS, currentConditionLabel],
    ['finishing level', FINISHING_LEVELS, finishingLevelLabel],
    ['area', FINISHING_AREAS, finishingAreaLabel],
    ['trade', FINISHING_TRADES, finishingTradeLabel],
  ] as const;

  it.each(tables)('%s has a distinct label in each language', (_name, values, label) => {
    for (const value of values) {
      const en = (label as (v: string, l: 'en' | 'ar') => string)(value, 'en');
      const ar = (label as (v: string, l: 'en' | 'ar') => string)(value, 'ar');
      expect(en).toBeTruthy();
      expect(ar).toBeTruthy();
      // The Arabic label is a translation, not the raw enum shown to a reader.
      expect(ar).not.toBe(value);
      expect(en).not.toBe(value);
    }
  });

  it('and no raw enum value leaks into a label', () => {
    for (const [, values, label] of tables) {
      for (const value of values) {
        for (const lang of ['en', 'ar'] as const) {
          const rendered = (label as (v: string, l: 'en' | 'ar') => string)(value, lang);
          expect(rendered).not.toMatch(/_/);
        }
      }
    }
  });
});

describe('a finishing request is an rfqs row, not a second request type', () => {
  it('the canonical Renovation category is what carries تشطيب', () => {
    const categories = code('shared/rfqCategories.ts');
    expect(categories).toContain("'Renovation': 'تشطيب وترميم'");
  });

  it('and no new request table was created for it', () => {
    const schema = code('drizzle/schema.ts');
    for (const forbidden of ['finishingRequests', 'finishingRfqs', 'tashteebRequests']) {
      expect(schema, `${forbidden} is a parallel request type`).not.toContain(forbidden);
    }
    // The brief hangs off the existing row.
    expect(schema).toContain("finishingBrief: json('finishingBrief')");
    expect(schema).toContain("pricingPreference: varchar('pricingPreference'");
  });

  it('the brief is validated on write rather than trusted', () => {
    const routers = code('server/routers.ts');
    expect(routers).toContain('const finishingBriefSchema = z.object({');
    expect(routers).toContain('finishingBrief: finishingBriefSchema.optional()');
  });

  it('and it is written explicitly, not swept in by a spread', () => {
    // It would have worked by name coincidence, which is how a renamed column
    // starts silently dropping a customer's brief.
    const routers = code('server/routers.ts');
    expect(routers).toContain('finishingBrief: finishingBrief ?? undefined');
  });

  it('nothing in the brief is required, so publication is never blocked by it', () => {
    const routers = code('server/routers.ts');
    const schema = routers.slice(
      routers.indexOf('const finishingBriefSchema = z.object({'),
      routers.indexOf('const rfqRouter = router({'));
    // Every field in the schema ends in .optional()
    const fields = schema.match(/^\s{2}\w+:/gm) ?? [];
    expect(fields.length).toBeGreaterThan(8);
    const withoutOptional = schema.split('\n')
      .filter(line => /^\s{2}\w+:/.test(line) && !line.includes('.optional()'));
    expect(withoutOptional, withoutOptional.join(' | ')).toEqual([]);
  });
});

describe('the lifecycle is the existing one', () => {
  it('no finishing-only status vocabulary was introduced', () => {
    const schema = code('drizzle/schema.ts');
    const rfqTable = schema.slice(schema.indexOf("export const rfqs = mysqlTable"),
      schema.indexOf('export const rfqItems'));
    expect(rfqTable).toContain("mysqlEnum('status', ['open', 'closed', 'awarded'])");
    for (const forbidden of ['finishing_draft', 'awaiting_brief', 'brief_complete']) {
      expect(rfqTable).not.toContain(forbidden);
    }
  });

  it('and the quotation status vocabulary is untouched', () => {
    const schema = code('drizzle/schema.ts');
    expect(schema).toContain("mysqlEnum('status', ['pending', 'accepted', 'rejected', 'withdrawn'])");
  });

  it('quotation line items inherit the quotation, and cascade with it', () => {
    const schema = code('drizzle/schema.ts');
    const items = schema.slice(schema.indexOf('export const quotationItems'));
    expect(items.slice(0, 1200)).toContain("onDelete: 'cascade'");
  });
});
