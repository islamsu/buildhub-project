import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CURRENCY_FRACTION_DIGITS, MAX_CURRENCY_FRACTION_DIGITS, fractionDigitsFor, MARKETS,
} from '../shared/markets';
import { SUPPORTED_CURRENCIES } from '../shared/billing';
import { formatMoney } from '../shared/money';
import { roundToScale, computeQuotationTotals } from '../shared/quotationPricing';

/**
 * ── THREE FRACTIONAL DIGITS, END TO END ─────────────────────────────────
 *
 * Owner directive Phase 0 item 3. Three of the six registered GCC currencies
 * divide into 1,000 minor units: KWD, BHD and OMR. Every money column was
 * DECIMAL(n,2), and MySQL does not refuse an over-scaled insert - it rounds
 * and carries on, so 1,234.567 OMR became 1234.57 and the third digit was
 * gone from the database rather than merely mis-shown.
 *
 * Migration 0063 widened the eight money columns. These tests hold the line in
 * the places a later change could quietly undo it.
 *
 * WHAT THESE TESTS DO AND DO NOT COVER. The storage round-trip was verified
 * against a real MariaDB instance (write 1234.567 -> read 1234.567, legacy
 * 1450.00 -> 1450.000, integer capacity preserved at ten digits). That cannot
 * run here, because this suite has no database. What IS asserted here is every
 * layer that does not need one: the schema the ORM writes through, the
 * arithmetic, and the formatter - plus the guard that the DB migration and the
 * schema cannot drift apart unnoticed.
 */

const ROOT = join(import.meta.dirname, '..');
const schema = readFileSync(join(ROOT, 'drizzle/schema.ts'), 'utf8');

/** Every `decimal(...)` column in the ORM schema, with its table. */
function decimalColumns(): { table: string; column: string; precision: number; scale: number }[] {
  const out: { table: string; column: string; precision: number; scale: number }[] = [];
  let table = '';
  for (const line of schema.split('\n')) {
    const t = /^export const (\w+) = mysqlTable/.exec(line);
    if (t) table = t[1];
    const d = /decimal\('(\w+)',\s*\{\s*precision:\s*(\d+),\s*scale:\s*(\d+)/.exec(line);
    if (d) out.push({ table, column: d[1], precision: Number(d[2]), scale: Number(d[3]) });
  }
  return out;
}

/**
 * The columns that hold money and may be denominated in ANY market's currency.
 * Named explicitly rather than pattern-matched on "price|amount|budget",
 * because a pattern would silently stop covering a column somebody renames.
 */
const MARKET_MONEY = [
  'projects.budget', 'projects.spent', 'products.price', 'rfqs.budget',
  'rfqItems.unitPriceSnapshot', 'serviceOfferings.priceMin', 'serviceOfferings.priceMax',
  'expenses.amount', 'quotations.price', 'quotations.baseAmount',
  'quotations.discountAmount', 'quotations.vatAmount', 'quotations.materialBaseAmount',
  'quotations.packageRate', 'quotationItems.rate', 'quotationItems.lineTotal',
];

/**
 * Deliberately NOT widened, each for a stated reason. This list is the
 * argument: a money column that drifts onto it needs a reason written down,
 * and a reader can check the reason rather than assume one existed.
 */
const NOT_MARKET_MONEY: Record<string, string> = {
  'users.rating': 'a 0.00-5.00 rating, not an amount',
  'products.rating': 'a 0.00-5.00 rating, not an amount',
  'rfqItems.quantity': 'a quantity (pieces, m2), not an amount',
  'quotations.packageQuantity': 'an area or quantity, not an amount',
  'vendorSubscriptions.priceAmount': 'money, but billing-domain and EGP-only - see the guard below',
};

describe('every market-denominated money column can hold three digits', () => {
  it('all sixteen are scale 3', () => {
    const byKey = new Map(decimalColumns().map(c => [`${c.table}.${c.column}`, c]));
    for (const key of MARKET_MONEY) {
      const col = byKey.get(key);
      expect(col, `${key} is not in drizzle/schema.ts - renamed?`).toBeDefined();
      expect(col!.scale, `${key} cannot hold a KWD/BHD/OMR amount`).toBe(3);
    }
  });

  it('and INTEGER capacity was preserved, not traded away for scale', () => {
    /*
     * The failure this catches: raising scale 2 -> 3 without raising precision
     * costs a column a factor of ten of headroom. DECIMAL(12,2) holds ten
     * integer digits; DECIMAL(12,3) holds nine. That turns a precision fix
     * into a range regression, and it would surface as a large legitimate
     * budget being refused rather than as anything about currencies.
     */
    const byKey = new Map(decimalColumns().map(c => [`${c.table}.${c.column}`, c]));
    for (const key of MARKET_MONEY) {
      const col = byKey.get(key)!;
      expect(col.precision - col.scale, `${key} has lost integer headroom`)
        .toBeGreaterThanOrEqual(10);
    }
  });

  it('no money column is left at scale 2 without an explicit reason', () => {
    // The census, re-derived each run rather than remembered: anything at
    // scale 2 must appear in the justified list above.
    const unexplained = decimalColumns()
      .filter(c => c.scale === 2)
      .map(c => `${c.table}.${c.column}`)
      .filter(key => !(key in NOT_MARKET_MONEY));
    expect(unexplained, 'a scale-2 decimal column with no recorded reason').toEqual([]);
  });

  it('the schema and migration 0063 name the SAME eight columns', () => {
    /*
     * The two could drift: schema.ts is what the ORM writes through, the
     * migration is what the database actually becomes. If a column were
     * widened in one and not the other, drizzle would be writing three digits
     * into a two-digit column - which rounds silently, the original defect.
     */
    const sql = readFileSync(join(ROOT, 'drizzle/0063_money_scale.sql'), 'utf8');
    for (const pair of [
      ['projects', 'budget'], ['projects', 'spent'], ['products', 'price'],
      ['rfqs', 'budget'], ['rfqItems', 'unitPriceSnapshot'],
      ['serviceOfferings', 'priceMin'], ['serviceOfferings', 'priceMax'],
      ['expenses', 'amount'],
    ]) {
      expect(sql, `0063 does not widen ${pair[0]}.${pair[1]}`)
        .toMatch(new RegExp(`ALTER TABLE\\s+\`${pair[0]}\`\\s+MODIFY\\s+\`${pair[1]}\``));
    }
    expect(sql).toContain('DECIMAL(13,3)');
    expect(sql).toContain('DECIMAL(15,3)');
  });

  it('0063 preserves NOT NULL and the default it found', () => {
    // MySQL MODIFY replaces the WHOLE column definition, so omitting these
    // drops them. expenses.amount is NOT NULL and projects.spent defaults.
    const sql = readFileSync(join(ROOT, 'drizzle/0063_money_scale.sql'), 'utf8');
    expect(sql).toMatch(/`expenses`\s+MODIFY\s+`amount`\s+DECIMAL\(13,3\)\s+NOT NULL/);
    expect(sql).toMatch(/`spent`\s+DECIMAL\(15,3\)\s+DEFAULT '0\.000'/);
  });
});

describe('the billing assumption is enforced, not remembered', () => {
  it('vendorSubscriptions.priceAmount stays scale 2 only while billing is 2-digit', () => {
    /*
     * THE GUARD THAT REPLACES SPECULATIVE WIDENING. Subscription billing is a
     * separate domain (owner §87) whose currency set is EGP alone, so widening
     * that column would imply a three-digit billing currency no code can
     * produce. The assumption is fine; leaving it UNCHECKED is not. The day
     * SUPPORTED_CURRENCIES gains KWD, this fails instead of rounding a real
     * invoice.
     */
    const worst = Math.max(...SUPPORTED_CURRENCIES.map(c => fractionDigitsFor(c) ?? 0));
    const col = decimalColumns().find(c =>
      c.table === 'vendorSubscriptions' && c.column === 'priceAmount')!;
    expect(col.scale, `billing supports a ${worst}-digit currency but the column holds ${col.scale}`)
      .toBeGreaterThanOrEqual(worst);
  });

  it('every supported billing currency has a declared scale at all', () => {
    for (const c of SUPPORTED_CURRENCIES) expect(fractionDigitsFor(c)).not.toBeNull();
  });
});

describe('the arithmetic keeps the third digit', () => {
  it('roundToScale(_, 3) does not round to hundredths', () => {
    expect(roundToScale(1234.567, 3)).toBe(1234.567);
    expect(roundToScale(0.0005, 3)).toBe(0.001);
    // And still rounds correctly AT two, for a two-digit currency.
    expect(roundToScale(1234.567, 2)).toBe(1234.57);
  });

  it('a quotation total in a 3-digit currency survives computation', () => {
    const totals = computeQuotationTotals(
      { method: 'custom', statedAmount: 1234.567, vatRate: null, currency: 'OMR' },
    );
    expect(totals.total).toBe(1234.567);
    /*
     * WHERE THE UNSTATED-VAT INVARIANT ACTUALLY LIVES. "An unstated VAT rate
     * is NULL, not zero" is a property of the RATE, which is echoed as
     * `number | null` precisely so a reader can tell "0% VAT" from "VAT not
     * stated". The AMOUNT is the arithmetic contribution to the total, and
     * when nothing was stated it contributes nothing - so 0 is correct there
     * and a null would make the payable total unrepresentable.
     */
    expect(totals.vatRate).toBeNull();
    expect(totals.vatAmount).toBe(0);
  });

  it('and the SAME figure in a 2-digit currency rounds to the currency, not to 3', () => {
    // The scale follows the currency, which is the whole point of the layer.
    const totals = computeQuotationTotals(
      { method: 'custom', statedAmount: 1234.567, vatRate: null, currency: 'EGP' });
    expect(totals.total).toBe(1234.57);
  });
});

describe('the formatter uses each currency OWN scale', () => {
  it('shows three digits for OMR, KWD and BHD', () => {
    for (const currency of ['OMR', 'KWD', 'BHD']) {
      const shown = formatMoney(1234.567, currency, 'en');
      expect(shown, `${currency} lost a digit`).toContain('.567');
    }
  });

  it('caps EGP, SAR, AED and QAR at two - and does NOT pad to two', () => {
    /*
     * `minimumFractionDigits: 0` is a deliberate product choice, documented in
     * shared/money.ts: a whole-unit price must not drag a trailing ".00"
     * through a dense table. So the rule is a CAP, not a fixed width, and this
     * test asserts the rule the product actually has rather than the
     * trailing-zero convention it explicitly declined.
     */
    for (const currency of ['EGP', 'SAR', 'AED', 'QAR']) {
      expect(formatMoney(1234.5, currency, 'en'), `${currency} padded`).toContain('1,234.5');
      expect(formatMoney(1234.5, currency, 'en'), `${currency} padded`).not.toContain('.500');
      // The cap bites where it matters: a third digit is dropped for a
      // two-digit currency, because in that currency it is not a real amount.
      expect(formatMoney(1234.567, currency, 'en'), `${currency} kept a 3rd digit`)
        .not.toContain('.567');
    }
  });

  it('every ENABLED and DISABLED market currency formats without losing a digit', () => {
    // Runs over the registry rather than a copied list, so a market added
    // later is covered the day its row appears.
    for (const market of MARKETS) {
      const digits = fractionDigitsFor(market.currency)!;
      // A value that uses exactly the currency's own scale must survive whole.
      const value = digits === 3 ? 9.999 : 9.99;
      const shown = formatMoney(value, market.currency, 'en');
      expect(shown, `${market.code}/${market.currency} formatted as ${shown}`)
        .toContain(String(value));
    }
  });

  it('MAX_CURRENCY_FRACTION_DIGITS still matches the table it summarises', () => {
    expect(MAX_CURRENCY_FRACTION_DIGITS)
      .toBe(Math.max(...Object.values(CURRENCY_FRACTION_DIGITS)));
  });
});
