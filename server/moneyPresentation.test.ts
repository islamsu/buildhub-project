/**
 * ── NO SCREEN NAMES A CURRENCY THE RECORD DID NOT ────────────────────────
 *
 * The owner asked for one instance of this to be fixed: an RFQ budget in the
 * supplier's enquiry queue rendered `{t('common.egp')} {budget}`, a hard-coded
 * Egyptian pound label on a number whose currency the RFQ itself states. That
 * one was fixed. THIRTEEN MORE WERE NOT, and a census found them across the
 * quotation list, the RFQ list, both project surfaces, both homeowner
 * dashboards and a supplier's public catalogue.
 *
 * Every one of them had a currency available on the record it was rendering.
 *
 * ── AND TWO OF THEM WERE WORSE THAN A LABEL ─────────────────────────────
 *
 * The "Total Budget" and "Total Spent" tiles read
 *
 *   `EGP ${projects.reduce((sum, p) => sum + Number(p.budget))}`
 *
 * Adding every project's budget together is only a total while every project
 * is denominated in one currency. The day a buyer runs one project in Egypt
 * and one in Saudi Arabia, that tile is two currencies summed as though they
 * were one unit, labelled with whichever the view hard-coded. No formatter can
 * fix that, because the mistake is the addition - so `sumByCurrency` groups
 * first and `formatMoneyTotals` renders one total per currency.
 *
 * §86 says stop introducing EGP hard-codes and establish one formatting layer.
 * This file is what makes that checkable: the translation key is gone, and its
 * return would fail here rather than be noticed by a buyer in Riyadh.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatMoney, formatMoneyTotals, sumByCurrency } from '../shared/money';
import { readSourceForAssertions } from './_testing/sourceText';

const CLIENT = join(import.meta.dirname, '../client/src');
const raw = (relative: string) => readFileSync(join(CLIENT, relative), 'utf8');
/*
 * COMMENTS STRIPPED, deliberately. The notes explaining what was removed have
 * to QUOTE the removed code - `reduce((s, p) => s + Number(p.budget))` and
 * `t('common.egp')` both appear in this pass's own documentation - and an
 * assertion that fails on the explanation of the fix teaches people to stop
 * writing the explanation.
 */
const read = (relative: string) => readSourceForAssertions(raw(relative));

/** Every surface the census found, plus the two it had already fixed. */
const MONEY_SURFACES = [
  'pages/HomeownerDashboard.tsx',
  'pages/RolePlatform.tsx',
  'pages/ProjectDetail.tsx',
  'pages/RFQPage.tsx',
  'pages/VendorProfile.tsx',
  'components/QuotationComparison.tsx',
  'components/EnquiryQueue.tsx',
  'contexts/LanguageContext.tsx',
];

describe('the EGP hard-code is gone, everywhere', () => {
  it('reads the real files, so the assertions below are not about nothing', () => {
    // POSITIVE CONTROL. A path typo would make every check here pass.
    for (const surface of MONEY_SURFACES) {
      expect(raw(surface).length, surface).toBeGreaterThan(500);
      expect(read(surface).length, `${surface} stripped to nothing`).toBeGreaterThan(300);
    }
  });

  it('no surface renders money through a hard-coded currency label', () => {
    const offenders = MONEY_SURFACES.filter(surface => read(surface).includes("'common.egp'"));
    expect(offenders, `these name a currency the record did not:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('the translation key itself no longer exists to be reached for', () => {
    // A key that resolves is a key somebody will use. Removed, so a new
    // `t('common.egp')` renders the key name - visible in review - and fails
    // the check above.
    const context = read('contexts/LanguageContext.tsx');
    expect(context).not.toContain("'common.egp':");
  });

  it('each converted surface reads a currency from the record it renders', () => {
    for (const [surface, expression] of [
      ['pages/RFQPage.tsx', 'rfq.currency'],
      ['pages/VendorProfile.tsx', 'product.currency'],
      ['pages/RolePlatform.tsx', 'quote.currency'],
      ['pages/RolePlatform.tsx', 'rfq.currency'],
      ['pages/HomeownerDashboard.tsx', 'project.currency'],
      ['pages/ProjectDetail.tsx', 'projectCurrency'],
    ] as const) {
      expect(read(surface), `${surface} should read ${expression}`).toContain(expression);
    }
  });

  it('the summed tiles group by currency instead of adding across them', () => {
    for (const surface of ['pages/HomeownerDashboard.tsx', 'pages/RolePlatform.tsx']) {
      const code = read(surface);
      expect(code, surface).toContain('sumByCurrency');
      expect(code, surface).toContain('formatMoneyTotals');
      // The reduce that added budgets as one number must be gone.
      expect(code, surface).not.toMatch(/reduce\(\([^)]*\)\s*=>\s*\w+\s*\+\s*Number\(\w+\.budget/);
      expect(code, surface).not.toMatch(/reduce\(\([^)]*\)\s*=>\s*\w+\s*\+\s*Number\(\w+\.spent/);
    }
  });

  it('a form that asks for an amount derives its unit from the market', () => {
    const code = read('pages/HomeownerDashboard.tsx');
    expect(code).toContain('requireCurrencyForMarket(DEFAULT_MARKET)');
  });
});

describe('formatting one amount', () => {
  it('shows the currency the record states, not Egypt', () => {
    expect(formatMoney(12000, 'SAR', 'en')).toContain('SAR');
    expect(formatMoney(12000, 'SAR', 'en')).not.toContain('EGP');
    expect(formatMoney(12000, 'EGP', 'en')).toContain('EGP');
  });

  it('is absent for an absent amount, never zero', () => {
    for (const empty of [null, undefined, '']) {
      expect(formatMoney(empty, 'EGP', 'en')).toBeNull();
    }
  });

  it('keeps a currency with three decimal places at three', () => {
    // KWD, BHD and OMR are divided into 1,000. Capping at two does not shorten
    // a number, it changes it.
    const kwd = formatMoney(1234.567, 'KWD', 'en');
    expect(kwd).toContain('567');
  });
});

describe('compact notation, for a KPI tile', () => {
  it('shortens the number and still names the currency', () => {
    const compact = formatMoney(1_248_300, 'EGP', 'en', { compact: true });
    expect(compact).toContain('EGP');
    expect(compact).toMatch(/1\.2M/);
  });

  it('is the same layer, so a tile cannot invent its own label', () => {
    // The whole reason the option exists: a dashboard that needed a short
    // number wrote its own string and hard-coded the currency into it.
    const compact = formatMoney(1_248_300, 'SAR', 'en', { compact: true });
    expect(compact).toContain('SAR');
    expect(compact).not.toContain('EGP');
  });

  it('leaves a full amount alone when not asked', () => {
    expect(formatMoney(1_248_300, 'EGP', 'en')).toMatch(/1,248,300/);
  });
});

describe('totalling across projects', () => {
  it('sums within a currency', () => {
    const totals = sumByCurrency([
      { amount: 100, currency: 'EGP' },
      { amount: '250.50', currency: 'EGP' },
    ]);
    expect(totals).toEqual([{ currency: 'EGP', total: 350.5 }]);
  });

  it('REFUSES to sum across currencies', () => {
    const totals = sumByCurrency([
      { amount: 1000, currency: 'EGP' },
      { amount: 400, currency: 'SAR' },
    ]);
    expect(totals.length).toBe(2);
    expect(totals.map(entry => entry.currency).sort()).toEqual(['EGP', 'SAR']);
    // And no entry is the arithmetic sum of the two.
    expect(totals.some(entry => entry.total === 1400)).toBe(false);
  });

  it('orders by size, so a partial view leads with the largest', () => {
    const totals = sumByCurrency([
      { amount: 10, currency: 'EGP' },
      { amount: 900, currency: 'SAR' },
      { amount: 500, currency: 'AED' },
    ]);
    expect(totals.map(entry => entry.currency)).toEqual(['SAR', 'AED', 'EGP']);
  });

  it('keeps an unstated currency in its own bucket rather than folding it into a real one', () => {
    const totals = sumByCurrency([
      { amount: 100, currency: 'EGP' },
      { amount: 50, currency: null },
      { amount: 25, currency: 'not-a-code' },
    ]);
    const egp = totals.find(entry => entry.currency === 'EGP');
    expect(egp?.total).toBe(100);
    const unknown = totals.find(entry => entry.currency === '');
    expect(unknown?.total).toBe(75);
  });

  it('ignores amounts that are not numbers', () => {
    expect(sumByCurrency([
      { amount: 'abc', currency: 'EGP' },
      { amount: null, currency: 'EGP' },
      { amount: undefined, currency: 'EGP' },
      { amount: '', currency: 'EGP' },
    ])).toEqual([]);
  });

  it('renders nothing for nothing, so a fresh account shows no invented figure', () => {
    expect(formatMoneyTotals([], 'en')).toBeNull();
  });

  it('renders every currency it was given, up to the cap', () => {
    const rendered = formatMoneyTotals([
      { currency: 'EGP', total: 1000 },
      { currency: 'SAR', total: 400 },
    ], 'en');
    expect(rendered).toContain('EGP');
    expect(rendered).toContain('SAR');
  });

  it('COUNTS the remainder rather than dropping it', () => {
    const rendered = formatMoneyTotals([
      { currency: 'EGP', total: 1000 },
      { currency: 'SAR', total: 400 },
      { currency: 'AED', total: 300 },
      { currency: 'QAR', total: 200 },
    ], 'en', 2);
    expect(rendered).toContain('EGP');
    expect(rendered).toContain('SAR');
    // Showing the largest two as though they were everything would be false.
    expect(rendered).toContain('+2 more');
  });

  it('counts the remainder in Arabic too', () => {
    const rendered = formatMoneyTotals([
      { currency: 'EGP', total: 1000 },
      { currency: 'SAR', total: 400 },
    ], 'ar', 1);
    expect(rendered).toMatch(/[؀-ۿ]/);
    expect(rendered).not.toContain('more');
  });
});
