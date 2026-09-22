import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  DEFAULT_MARKET, MARKETS, currencyForMarket, enabledMarkets,
  isEnabledMarket, marketFor, suggestMarket,
} from '@shared/markets';
import { formatMoney, formatMoneyRange } from '@shared/money';
import {
  COMPLIANCE_REQUIREMENTS_BY_MARKET, getComplianceRequirements, hasComplianceRequirements,
} from '@shared/compliance';

/**
 * ── EGYPT-FIRST, NOT EGYPT-LOCKED ───────────────────────────────────────
 *
 * CLAUDE.md §86-87, GCC_SCALE_READINESS.md §32-52.
 *
 * The owner's requirement is not that BuildHub launch in the GCC. It is that
 * the day it does, the work is a configuration change rather than an
 * archaeology project. That means the assumptions have to stop accumulating
 * NOW, while there is one market and every one of them is still harmless.
 *
 * This file is the regression check §86 asks for. It does two things:
 *
 *   it holds the five facts apart that the owner's policy says must never be
 *     confused - authentication, active market, project/RFQ location, RFQ
 *     currency, subscription billing
 *   it FAILS when a new Egypt-only assumption appears in a surface that
 *     carries a commercial number, with the existing ones declared below
 *     rather than hidden by a loose pattern
 *
 * The declared list is not an allowlist for skipping work. Every entry says
 * what it is and why it is still there.
 */

const ROOT = new URL('..', import.meta.url).pathname;
/**
 * COMMENTS STRIPPED, for every assertion about what the CODE does.
 *
 * The note explaining why the subscription currency was removed from the
 * quotation necessarily names the thing that was removed. Asserting against
 * the raw file made that explanation fail the test, which teaches people to
 * stop writing explanations - the opposite of what this codebase wants.
 */
const ROUTERS = readSourceForAssertions(readFileSync(join(ROOT, 'server/routers.ts'), 'utf8'));

describe('the market table is architecture, not a launch', () => {
  it('Egypt is the only market BuildHub operates in', () => {
    // A country appearing in a dropdown is never sufficient to call that
    // market launched (§86). The GCC rows exist so the code that will need
    // them is written against real values, and `enabled` is what decides.
    expect(enabledMarkets().map(market => market.code)).toEqual(['EG']);
    expect(DEFAULT_MARKET).toBe('EG');
  });

  it('but the GCC markets are defined, with real currencies and timezones', () => {
    for (const code of ['SA', 'AE', 'QA', 'KW', 'BH', 'OM']) {
      const market = MARKETS.find(entry => entry.code === code);
      expect(market, `${code} is not in the market table`).toBeDefined();
      expect(market!.currency, `${code} has no currency`).toMatch(/^[A-Z]{3}$/);
      expect(market!.timezone, `${code} has no timezone`).toContain('/');
      expect(market!.nameAr, `${code} has no Arabic name`).toMatch(/[؀-ۿ]/);
    }
  });

  it('a disabled market cannot be selected', () => {
    expect(isEnabledMarket('SA')).toBe(false);
    expect(isEnabledMarket('EG')).toBe(true);
    expect(isEnabledMarket('ZZ')).toBe(false);
  });

  it('an unknown market reads as Egypt rather than crashing or inventing one', () => {
    // A row written before markets existed means Egypt, because that is what
    // it meant when it was written.
    expect(marketFor(null).code).toBe('EG');
    expect(marketFor('ZZ').code).toBe('EG');
    expect(currencyForMarket(undefined)).toBe('EGP');
  });
});

describe('geolocation suggests and never decides', () => {
  /*
   * §32, the governing rule: IP/browser location may SUGGEST an initial
   * market to a signed-out visitor and must never silently determine legal
   * country, project country, RFQ market, quotation currency, tax treatment,
   * compliance eligibility, serviceability or billing country.
   */
  it('a hint for a market BuildHub does not operate in returns nothing', () => {
    // Not a fallback. Offering a market that is not enabled would be worse
    // than offering none.
    expect(suggestMarket('SA')).toBeNull();
    expect(suggestMarket('nonsense')).toBeNull();
    expect(suggestMarket(null)).toBeNull();
  });

  it('and a valid hint is a suggestion, named as one', () => {
    expect(suggestMarket('eg')).toBe('EG');
  });

  it('nothing in the market module reads a request', () => {
    const source = readFileSync(join(ROOT, 'shared/markets.ts'), 'utf8');
    for (const forbidden of ['req.', 'headers', 'x-forwarded-for', 'cf-ipcountry', 'geoip']) {
      expect(source, `markets.ts reads ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('THE QUOTATION CURRENCY IS THE RFQ\'S, NOT THE SUBSCRIPTION\'S', () => {
  /*
   * The defect the owner named directly (§43, §87). `submitQuotation` took
   * `z.literal(BILLING_CURRENCY)` - the currency of the supplier's
   * SUBSCRIPTION PLAN, the amount they pay BuildHub every month - and wrote
   * it onto the bid as though it were the currency of the work.
   *
   * A supplier billed in EGP under an Egypt contract, quoting a Saudi RFQ,
   * bids in SAR. What they pay BuildHub has nothing to do with it. Those are
   * two commercial relationships and this is where they were conflated.
   */
  /*
   * SLICED TO THE NEXT PROCEDURE, AND IT HAS TO EXIST.
   *
   * Two other files slice this same block with `indexOf('withdrawRFQ:')` as
   * the end anchor. THERE IS NO `withdrawRFQ` IN routers.ts - the procedure
   * is `close` - so indexOf returns -1, the slice runs to the end of an
   * 11,000-line file, and every `not.toContain` below it becomes a statement
   * about the whole router rather than about this procedure. That is the
   * vacuous-guard shape: it cannot tell "absent here" from "absent nowhere".
   */
  const submit = (() => {
    const start = ROUTERS.indexOf('  submitQuotation: approvedProviderProcedure');
    expect(start, 'submitQuotation not found in routers.ts').toBeGreaterThan(-1);
    const end = ROUTERS.indexOf('\n  close: protectedProcedure', start);
    expect(end, 'the end anchor is gone - this slice would run to EOF').toBeGreaterThan(start);
    return ROUTERS.slice(start, end);
  })();

  it('submitQuotation does not accept a currency at all', () => {
    // Not validated - ABSENT. No payload can submit a bid in a currency the
    // buyer is not comparing in.
    expect(submit).not.toMatch(/currency:\s*z\./);
    expect(submit, 'the subscription currency is back on the quotation')
      .not.toContain('BILLING_CURRENCY');
  });

  it('it reads the currency off the RFQ instead', () => {
    expect(submit).toContain('currency: rfqs.currency');
    expect(submit).toContain('const quotationCurrency = rfq.currency');
  });

  it('and writes THAT onto the row, not the column default', () => {
    expect(submit).toContain('currency: quotationCurrency');
  });

  it('the RFQ respond form shows the RFQ currency, read-only', () => {
    const page = readSourceForAssertions(readFileSync(join(ROOT, 'client/src/pages/RFQRespondPage.tsx'), 'utf8'));
    expect(page, 'the form still reads the subscription currency')
      .not.toContain('BILLING_CURRENCY');
    expect(page).toContain('rfq.currency || currencyForMarket(rfq.marketCode)');
    expect(page).toContain('readOnly');
  });
});

describe('every commercial record states its own market', () => {
  const schema = readFileSync(join(ROOT, 'drizzle/schema.ts'), 'utf8');

  it('projects carry a market and a currency', () => {
    expect(schema).toContain("marketCode:  varchar('marketCode', { length: 2 })");
    expect(schema).toMatch(/projects = mysqlTable[\s\S]{0,4000}currency:\s+varchar\('currency', \{ length: 3 \}\)/);
  });

  it('RFQs carry their own snapshot rather than reading the project each time', () => {
    // So editing a project later cannot silently reinterpret an RFQ that
    // suppliers have already quoted against (§37).
    expect(schema).toMatch(/rfqs = mysqlTable[\s\S]{0,4000}marketCode:\s+varchar/);
    expect(schema).toMatch(/rfqs = mysqlTable[\s\S]{0,4000}currency:\s+varchar/);
  });

  it('a subscription states where it is BILLED and where its benefit APPLIES', () => {
    // Three separate columns because they are three separate facts (§44).
    expect(schema).toContain("billingMarketCode: varchar('billingMarketCode'");
    expect(schema).toContain("entitlementScope: mysqlEnum('entitlementScope', ['GLOBAL', 'MARKET_SET'])");
  });

  it('and scope is never inferred from currency (§47)', () => {
    const schemaBlock = schema.slice(schema.indexOf('vendorSubscriptions = mysqlTable'));
    expect(schemaBlock.slice(0, 4000)).toContain('entitlementMarkets');
  });

  it('the migration is additive and backfills to what the rows already meant', () => {
    const migration = readFileSync(join(ROOT, 'drizzle/0058_market_context.sql'), 'utf8');
    expect(migration).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE\b/i);
    expect(migration).toContain("DEFAULT 'EG'");
    expect(migration).toContain("DEFAULT 'EGP'");
    expect(migration).toContain("DEFAULT 'GLOBAL'");
  });
});

describe('RFQ and project creation establish the market explicitly', () => {
  it('an RFQ against a project inherits the PROJECT\'s market', () => {
    // The requirement's location is a property of the job, not of the form,
    // so an explicit code cannot file Jeddah work against a Cairo project.
    const create = ROUTERS.slice(ROUTERS.indexOf('  create: protectedProcedure', ROUTERS.indexOf('const rfqRouter')));
    expect(create).toContain('const [project] = await db.select({ marketCode: projects.marketCode })');
    expect(create).toContain('marketCode,');
    expect(create).toContain('currency: marketCurrency');
  });

  it('a disabled market is refused rather than silently accepted', () => {
    // An RFQ in a market BuildHub cannot serve is one no supplier could ever
    // be matched to.
    const create = ROUTERS.slice(ROUTERS.indexOf('  create: protectedProcedure', ROUTERS.indexOf('const rfqRouter')));
    expect(create).toContain('BuildHub does not currently operate in that market.');
  });

  it('and the RFQ feed carries the market and currency beside the budget', () => {
    // §49: do not make the reader guess whether a figure is EGP, SAR or AED.
    expect(ROUTERS).toContain('marketCode: rfqs.marketCode');
    expect([...ROUTERS.matchAll(/marketCode: rfqs\.marketCode/g)].length).toBeGreaterThanOrEqual(2);
  });
});

describe('one money formatter, and it never guesses a currency', () => {
  it('an absent amount is absent, not zero', () => {
    expect(formatMoney(null, 'EGP')).toBeNull();
    expect(formatMoney(undefined, 'EGP')).toBeNull();
    expect(formatMoney('', 'EGP')).toBeNull();
    // Zero is a real amount and renders as one.
    expect(formatMoney(0, 'EGP')).not.toBeNull();
  });

  it('a DECIMAL column arrives as a string and is still formatted', () => {
    // Every money column in this schema is DECIMAL, which mysql2 returns as
    // a string. Parsing at the edge of the view is how a rounding difference
    // gets into a price.
    expect(formatMoney('1250.50', 'EGP')).toContain('1,250.5');
  });

  it('a record with no currency gets a bare number, NEVER a guessed one', () => {
    const shown = formatMoney(1000, null);
    expect(shown).toBe('1,000');
    expect(shown).not.toContain('EGP');
  });

  it('the currency comes from the record, so two markets read differently', () => {
    expect(formatMoney(1000, 'EGP')).toContain('EGP');
    expect(formatMoney(1000, 'SAR')).toContain('SAR');
  });

  it('an unknown ISO code shows the number beside the code it was stored with', () => {
    expect(formatMoney(1000, 'ZZZ')).toContain('ZZZ');
  });

  it('a range across one currency, with open ends handled', () => {
    expect(formatMoneyRange(100, 200, 'EGP')).toContain('–');
    expect(formatMoneyRange(100, null, 'EGP')).toContain('from');
    expect(formatMoneyRange(null, 200, 'EGP')).toContain('up to');
    expect(formatMoneyRange(null, null, 'EGP')).toBeNull();
  });
});

describe('compliance is a property of the market, not just the role', () => {
  it('Egypt is the only market with a confirmed requirement set', () => {
    expect(hasComplianceRequirements('EG')).toBe(true);
    expect(hasComplianceRequirements('SA')).toBe(false);
  });

  it('every existing caller keeps its behaviour', () => {
    // The market defaults to Egypt, so nothing that called this before the
    // parameter existed changed.
    expect(getComplianceRequirements('engineer')).toEqual(getComplianceRequirements('engineer', 'EG'));
    expect(getComplianceRequirements('engineer').length).toBeGreaterThan(0);
  });

  it('a market with no confirmed set returns EMPTY, not Egypt\'s', () => {
    /*
     * "Engineering syndicate license" is نقابة المهندسين - an Egyptian
     * institution. Saudi Arabia has the Saudi Council of Engineers. Falling
     * back to Egypt's list would tell a Saudi engineer to file the wrong
     * papers with confidence, which is worse than an empty list: an empty
     * list is a visible gap that stops the onboarding, a wrong list
     * misdirects it.
     */
    expect(getComplianceRequirements('engineer', 'SA')).toEqual([]);
  });

  it('and nothing invents a requirement set nobody confirmed', () => {
    expect(Object.keys(COMPLIANCE_REQUIREMENTS_BY_MARKET)).toEqual(['EG']);
  });
});

/**
 * ── THE CENSUS ──────────────────────────────────────────────────────────
 *
 * A hard-coded currency on a surface that carries a commercial number is the
 * assumption that costs most later, because it is a WRONG NUMBER shown to
 * somebody making a decision rather than a label somebody has to translate.
 *
 * Everything still carrying one is declared below with what it is. The list
 * is expected to shrink; what this test refuses is for it to grow silently.
 */
/**
 * A currency code written into a string, in any of the three ways this
 * codebase writes strings. Deliberately not `/EGP/`: that matches the word in
 * a sentence, and a census that cries wolf gets a looser pattern rather than
 * a fix.
 */
const CURRENCY_HARDCODE = /(['"`][^'"`]*\b(?:EGP|SAR|AED|QAR|KWD|BHD|OMR)\b[^'"`]*['"`])|(['"`][^'"`]*(?:ج\.م|جنيه)[^'"`]*['"`])/;

const DECLARED_CURRENCY_HARDCODES: readonly { file: string; reason: string }[] = [
  {
    file: 'shared/billing.ts',
    reason: 'BILLING_CURRENCY and SUPPORTED_CURRENCIES - what a supplier pays '
      + 'BuildHub. CORRECTLY Egypt-only: BuildHub bills in one market and has '
      + 'no payment provider. It is no longer read by any sourcing surface, '
      + 'which was the defect; a second billing market needs an approved '
      + 'catalogue price per market (§45), not an FX conversion of this one.',
  },
  {
    file: 'client/src/components/ServiceCatalogueManager.tsx',
    reason: 'Indicative service pricing, supplier-facing, in the one market '
      + 'BuildHub operates in. Moves to the provider\'s served-market currency '
      + 'when market offers land (§42).',
  },
  {
    file: 'client/src/pages/VendorProfile.tsx',
    reason: 'The public storefront\'s indicative price range. Same source and '
      + 'same fix as ServiceCatalogueManager above.',
  },
  {
    file: 'client/src/pages/RFQPage.tsx',
    reason: 'The basket subtotal, labelled "not a quotation". Becomes the '
      + 'RFQ\'s own currency once the create form asks for a market.',
  },
  {
    file: 'client/src/contexts/LanguageContext.tsx',
    reason: "'common.egp' - a currency NAME in the dictionary, which is what a "
      + 'dictionary is for. Its callers are the ones that matter.',
  },
];

describe('no NEW Egypt-only assumption on a commercial surface', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  it('every hard-coded currency is one that was written down', () => {
    const declared = new Set(DECLARED_CURRENCY_HARDCODES.map(entry => entry.file));
    // The two modules that EXIST to hold currency values.
    declared.add('shared/markets.ts');
    declared.add('shared/money.ts');
    declared.add('server/marketReadiness.test.ts');

    const offenders: string[] = [];
    for (const file of [...walk(join(ROOT, 'client/src')), ...walk(join(ROOT, 'shared')), ...walk(join(ROOT, 'server'))]) {
      const relative = file.slice(ROOT.length).replace(/^\/+/, '');
      if (declared.has(relative)) continue;
      const source = readFileSync(file, 'utf8');
      // COMMENTS DO NOT COUNT. Several of the notes explaining why a fallback
      // was removed necessarily quote the thing that was removed, and a
      // census that failed on its own explanation would teach people to stop
      // writing them. Line comments and block-comment bodies are stripped.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
      // The literal, not the word: `ar-EG` is a locale and `EGYPT` in prose
      // is neither.
      // INSIDE A STRING OF ANY KIND, including a template literal - which is
      // exactly how `Catalogue value: EGP ${n}` was written, and how the
      // first version of this census missed it. `ar-EG` is a locale and
      // EGYPT in prose is neither, so the currency code is matched on a word
      // boundary rather than anywhere at all.
      if (CURRENCY_HARDCODE.test(code)) offenders.push(relative);
    }

    expect(
      offenders,
      'A hard-coded currency on a commercial surface is a WRONG NUMBER the day '
      + 'BuildHub lists a second market. Read it from the record, or add it to '
      + 'DECLARED_CURRENCY_HARDCODES with the reason it cannot be.',
    ).toEqual([]);
  });

  it('and every declared file still actually carries one', () => {
    // So a fixed entry cannot sit in the list forever pretending to be debt.
    for (const entry of DECLARED_CURRENCY_HARDCODES) {
      const source = readFileSync(join(ROOT, entry.file), 'utf8');
      expect(source, `${entry.file} no longer hard-codes a currency - remove it from the list`)
        .toMatch(CURRENCY_HARDCODE);
    }
  });

  it('every declaration says WHY, not just WHERE', () => {
    for (const entry of DECLARED_CURRENCY_HARDCODES) {
      expect(entry.reason.length, `${entry.file} has no real reason`).toBeGreaterThan(60);
    }
  });
});
