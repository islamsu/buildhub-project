/**
 * ── A BUDGET IS A NUMBER AND A CURRENCY, NEVER A NUMBER AND A HABIT ──────
 *
 * The provider's enquiry screen rendered the customer's budget as
 *
 *     {t('common.egp')} {Number(detail.budget).toLocaleString()}
 *
 * - the digits from the record, the currency from a TRANSLATION KEY. That key
 * is 'EGP' in English and 'جنيه' in Arabic, and it does not know what the
 * request is denominated in, because a translation table cannot know that.
 *
 * So a Saudi request with a 500,000 SAR budget rendered as "EGP 500,000" to
 * the supplier deciding what to bid against it. That is not a formatting nit.
 * At today's rates it is a request that looks roughly a fifth of its real
 * size, in front of the one person whose job is to price it.
 *
 * CLAUDE.md §87 settles where the answer comes from: THE RFQ decides the
 * currency, and every quotation against it inherits that currency. Neither
 * the supplier's country, nor BuildHub's subscription billing currency, nor
 * the language the page happens to be rendered in.
 *
 * This file pins the whole path - the column is selected, the procedure
 * returns it, the component formats with it, and nothing on the enquiry
 * surfaces reaches for the EGP key again.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatMoney } from '../shared/money';
import { listEnquiryQueue } from './enquiryQueue';
import { readSourceForAssertions } from './_testing/sourceText';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const src = (relative: string) => readSourceForAssertions(read(relative));

const QUEUE_SRC = src('./enquiryQueue.ts');
const ROUTERS = src('./routers.ts');
const COMPONENT = src('../client/src/components/EnquiryQueue.tsx');

/** The same fake the queue's own suite uses: a chain that resolves to rows. */
function fakeDb(rows: any[], total = rows.length) {
  const chain = (isCount: boolean): any => {
    const self: any = {
      leftJoin: () => self,
      where: () => self,
      groupBy: () => self,
      orderBy: () => self,
      limit: () => self,
      offset: () => Promise.resolve(rows),
      then: (ok: any, err: any) =>
        Promise.resolve(isCount ? [{ count: total }] : rows).then(ok, err),
    };
    return self;
  };
  return {
    select: (projection: any) => {
      const isCount = !!projection && Object.keys(projection).length === 1 && 'count' in projection;
      return { from: () => chain(isCount) };
    },
    selectDistinct: () => ({ from: () => chain(false) }),
  } as any;
}

describe('the currency travels with the amount it belongs to', () => {
  it('the queue selects the RFQ currency alongside the budget', () => {
    // Not selected means not available means defaulted by whatever renders it,
    // which is exactly how the EGP key got there.
    expect(QUEUE_SRC).toContain('currency: rfqs.currency');
    expect(QUEUE_SRC).toContain('budget: rfqs.budget');
    expect(QUEUE_SRC).toContain('marketCode: rfqs.marketCode');
  });

  it('and a row carries it out of the server unchanged', async () => {
    const rows = await listEnquiryQueue(fakeDb([
      { rfqId: 1, rfqStatus: 'open', source: 'category', responseState: 'available',
        budget: '500000.00', currency: 'SAR', marketCode: 'SA', openedAt: null, invitedAt: null },
      { rfqId: 2, rfqStatus: 'open', source: 'category', responseState: 'available',
        budget: '250000.00', currency: 'EGP', marketCode: 'EG', openedAt: null, invitedAt: null },
    ]), { userId: 7, declaredCategories: ['concrete'] });

    expect(rows.rows[0].currency).toBe('SAR');
    expect(rows.rows[1].currency).toBe('EGP');
    // The queue does not normalise, convert or default anything on the way out.
    expect(rows.rows[0].budget).toBe('500000.00');
  });

  it('the dashboard list returns it too', () => {
    const start = ROUTERS.indexOf('eligible: approvedProviderProcedure');
    const end = ROUTERS.indexOf('queue: approvedProviderProcedure', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(ROUTERS.slice(start, end)).toContain('currency: row.currency');
  });
});

describe('THE SAUDI REGRESSION: a SAR request never reads as Egyptian pounds', () => {
  it('formats a SAR budget in SAR, in both languages', () => {
    const en = formatMoney('500000.00', 'SAR', 'en');
    const ar = formatMoney('500000.00', 'SAR', 'ar');
    for (const rendered of [en, ar]) {
      expect(rendered).toBeTruthy();
      expect(rendered!).toContain('SAR');
      // The failure this file exists for, asserted directly.
      expect(rendered!, 'a Saudi budget was labelled in Egyptian pounds').not.toContain('EGP');
      expect(rendered!, 'a Saudi budget was labelled in Egyptian pounds').not.toContain('جنيه');
    }
    expect(en).toMatch(/500,000/);
  });

  it('and an Egyptian one still reads as EGP', () => {
    // The fix must not simply stop saying EGP; it must say the right thing.
    const egp = formatMoney('250000.00', 'EGP', 'en');
    expect(egp).toContain('EGP');
    expect(egp).toMatch(/250,000/);
  });

  it('a three-decimal currency keeps its three decimals', () => {
    // GCC_SCALE_READINESS §53: KWD/BHD/OMR are thousandths. A global cap at
    // two would silently round a Kuwaiti budget.
    expect(formatMoney('1234.567', 'KWD', 'en')).toContain('1,234.567');
  });

  it('an amount with no currency is a bare number, never a guessed one', () => {
    // A record that does not say what it is denominated in gets no label. The
    // alternative - falling back to 'EGP' - is how the original defect would
    // return the first time a column came back null.
    const bare = formatMoney('1000', null, 'en');
    expect(bare).toBe('1,000');
    expect(bare).not.toContain('EGP');
  });

  it('absent is absent, never zero', () => {
    // §10: a missing budget is not a free project.
    expect(formatMoney(null, 'SAR', 'en')).toBeNull();
    expect(formatMoney(undefined, 'SAR', 'en')).toBeNull();
    expect(formatMoney('', 'SAR', 'en')).toBeNull();
  });
});

describe('the enquiry screen cannot reach for the EGP key again', () => {
  it('renders money only through the canonical formatter', () => {
    expect(COMPONENT).toContain("from '@shared/money'");
    expect(COMPONENT).toContain('formatMoney(row.budget, row.currency, lang)');
    expect(COMPONENT).toContain('formatMoney(detail.budget, detail.currency, lang)');
  });

  it('and the EGP translation key is gone from every enquiry surface', () => {
    // Comments are stripped: this file's own explanation quotes the removed
    // code, and an assertion that trips on its own documentation proves
    // nothing about the product.
    for (const relative of [
      '../client/src/components/EnquiryQueue.tsx',
      '../client/src/components/EnquirySummaryCard.tsx',
      '../client/src/pages/EnquiriesPage.tsx',
    ]) {
      expect(src(relative), `${relative} still labels money from a translation key`)
        .not.toContain('common.egp');
    }
  });

  it('and no enquiry surface builds a currency string by hand', () => {
    // `${x} EGP`, 'EGP ' + x, 'SAR' inline - every spelling that bypasses the
    // one formatter is the same defect wearing different punctuation.
    for (const code of ['EGP', 'SAR', 'AED', 'KWD']) {
      expect(COMPONENT, `${code} is hard-coded in the enquiry screen`)
        .not.toMatch(new RegExp(`['"\`][^'"\`]*\\b${code}\\b`));
    }
  });

  it('the deleted component is really deleted, not merely unmounted', () => {
    // Two lists of one thing came back once already. A file left in place
    // "for reference" is one import away from being rendered again.
    expect(() => read('../client/src/components/QualifiedEnquiries.tsx')).toThrow();
    for (const relative of [
      '../client/src/pages/EnquiriesPage.tsx',
      '../client/src/pages/RolePlatform.tsx',
    ]) {
      expect(src(relative)).not.toContain('QualifiedEnquiries');
    }
  });
});
