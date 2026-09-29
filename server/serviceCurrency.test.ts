/**
 * ── THE LAST MONEY COLUMN WITH NOTHING BESIDE IT ────────────────────────
 *
 * `serviceOfferings` had `priceMin`, `priceMax` and no currency. It was the one
 * place in the schema where a money surface had genuinely nothing on the record
 * to read, which is why the two screens that render it each carried
 *
 *   const currency = ar ? 'ج.م' : 'EGP';
 *
 * in identical local formatters. That was declared debt in
 * `server/marketReadiness.test.ts`, with the reason stated plainly: the debt was
 * the column, not the view.
 *
 * Migration 0061 adds it. This file holds the three properties that make the
 * addition honest rather than merely present.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';
import { formatMoneyRange } from '../shared/money';

const ROOT = join(import.meta.dirname, '..');
const raw = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');
const code = (relative: string) => readSourceForAssertions(raw(relative));

describe('migration 0061', () => {
  const sql = raw('drizzle/0061_service_offering_currency.sql');

  it('exists, is additive, and is registered in the journal', () => {
    expect(sql).toContain('ALTER TABLE `serviceOfferings`');
    expect(sql).toContain('ADD COLUMN `currency`');
    // Additive only. A migration that rewrote or dropped anything here would be
    // changing the meaning of rows it is supposed to be describing.
    expect(sql).not.toMatch(/\bDROP\b|\bMODIFY\b|\bDELETE\b|\bUPDATE\b/i);
    const journal = JSON.parse(raw('drizzle/meta/_journal.json')) as { entries: { tag: string }[] };
    expect(journal.entries.map(entry => entry.tag)).toContain('0061_service_offering_currency');
  });

  it('backfills to EGP, which is what every existing row already meant', () => {
    /*
     * §88 allows exactly this and nothing more: "an explicit unknown market code
     * must never silently become Egypt; only legitimate legacy absence may use
     * the Egypt launch default/backfill." These rows have no market code to
     * contradict, because the column did not exist when they were written.
     */
    expect(sql).toContain("DEFAULT 'EGP'");
    expect(sql).toContain('NOT NULL');
  });

  it('and says so - the reasoning is in the migration, not only in a commit', () => {
    expect(sql).toContain('legacy');
    expect(sql.length).toBeGreaterThan(1200);
  });
});

describe('a new offering does not rely on the default', () => {
  it('services.create writes the currency from the market', () => {
    /*
     * A column whose default is the only thing setting it is the assumption the
     * migration exists to remove - it would simply be reintroduced one
     * migration later, invisibly.
     */
    const routers = code('server/routers.ts');
    const create = routers.slice(routers.indexOf('db.insert(serviceOfferings).values({'));
    expect(create.slice(0, 900)).toContain('currency: requireCurrencyForMarket(DEFAULT_MARKET)');
  });

  it('through requireCurrencyForMarket, which THROWS on an unknown market', () => {
    // §88's other half: an explicit unknown market must not become Egypt. The
    // nullable reader would have allowed that; this one refuses.
    const routers = code('server/routers.ts');
    const create = routers.slice(routers.indexOf('db.insert(serviceOfferings).values({'), 
      routers.indexOf('db.insert(serviceOfferings).values({') + 900);
    expect(create).not.toContain('currencyForMarket(DEFAULT_MARKET)');
  });
});

describe('both readers return it, so the screens can read it', () => {
  it('the public storefront reader selects it and types it', () => {
    const catalogue = code('server/serviceCatalogue.ts');
    expect(catalogue).toContain('currency: serviceOfferings.currency');
    expect(catalogue).toContain('currency: string;');
  });

  it('and the supplier\'s own catalogue reader selects it too', () => {
    const routers = code('server/routers.ts');
    const mine = routers.slice(routers.indexOf('mine: complianceProcedure'));
    expect(mine.slice(0, 1400)).toContain('currency: serviceOfferings.currency');
  });
});

describe('both screens render from the record', () => {
  const manager = code('client/src/components/ServiceCatalogueManager.tsx');
  const profile = code('client/src/pages/VendorProfile.tsx');

  it('the formatter takes the currency as an argument', () => {
    for (const [name, source] of [['manager', manager], ['profile', profile]] as const) {
      expect(source, name).toMatch(/function (formatRange|publicPriceRange)\(min: unknown, max: unknown, currency: string \| null \| undefined, ar: boolean\)/);
    }
  });

  it('the call site passes the offering\'s own currency', () => {
    expect(manager).toContain('formatRange(row.priceMin, row.priceMax, row.currency, ar)');
    expect(profile).toContain('publicPriceRange(service.priceMin, service.priceMax, service.currency, ar)');
  });

  it('no currency literal or market constant is left on either screen', () => {
    for (const [name, source] of [['manager', manager], ['profile', profile]] as const) {
      expect(source, name).not.toContain('ج.م');
      expect(source, name).not.toContain('SERVICE_PRICE_CURRENCY');
      expect(source, name).not.toContain('requireCurrencyForMarket');
      expect(source, name).not.toContain('DEFAULT_MARKET');
    }
  });

  it('and they still go through the ONE canonical formatter', () => {
    for (const [name, source] of [['manager', manager], ['profile', profile]] as const) {
      expect(source, name).toContain('formatMoneyRange(');
    }
  });
});

describe('the declared hard-code list shrank for the right reason', () => {
  it('neither service screen is declared any more', () => {
    const market = code('server/marketReadiness.test.ts');
    const declared = market.slice(
      market.indexOf('const DECLARED_CURRENCY_HARDCODES'),
      market.indexOf('describe(', market.indexOf('const DECLARED_CURRENCY_HARDCODES')));
    expect(declared).not.toContain('ServiceCatalogueManager');
    expect(declared).not.toContain('VendorProfile');
  });

  it('but the subscription currency legitimately remains', () => {
    /*
     * `shared/billing.ts` holds the currency BuildHub bills its own
     * subscriptions in - a different commercial relationship from anything a
     * buyer or supplier transacts in (§87), and not a defect to remove.
     */
    const market = code('server/marketReadiness.test.ts');
    expect(market).toContain('shared/billing.ts');
  });
});

describe('the formatter behaves for a second currency', () => {
  it('renders a range in whatever the record states', () => {
    expect(formatMoneyRange(120, 260, 'SAR', 'en')).toContain('SAR');
    expect(formatMoneyRange(120, 260, 'SAR', 'en')).not.toContain('EGP');
    expect(formatMoneyRange(120, 260, 'EGP', 'en')).toContain('EGP');
  });

  it('and an open end stays open rather than becoming a zero', () => {
    expect(formatMoneyRange(120, null, 'SAR', 'en', { from: 'from', upTo: 'up to' })).toMatch(/^from .*SAR/);
    expect(formatMoneyRange(null, null, 'SAR', 'en')).toBeNull();
  });
});
