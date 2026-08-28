import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseLinkedRfqId } from '@shared/linkedRfq';

/**
 * THE PROVIDER'S JOURNEY FROM A REQUEST TO A RESPONSE.
 *
 * Every piece of this existed and the journey still did not work. `/rfq/:id`
 * rendered a request. `/provider` had a qualified-enquiry inbox and a working
 * quotation form. The link between them threw the id away: "Continue to
 * respond" went to a bare `/provider`, so a provider arrived on a dashboard
 * and had to find in a list the request they had been reading a second ago.
 *
 * That is the difference between "every screen exists" and "the workflow
 * works", and it is invisible to a test that checks screens.
 */

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const strip = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// ══ 1. THE ID SURVIVES THE HOP ═════════════════════════════════════════════

describe('the request id travels with the provider', () => {
  const DETAIL = strip(read('../client/src/pages/RFQDetail.tsx'));

  it('the respond CTA carries the RFQ id, not a bare dashboard link', () => {
    expect(DETAIL).toMatch(/<Link href=\{`\/provider\?rfq=\$\{rfq\.id\}`\}>/);
  });

  it('and it still does not spend anything on the way', () => {
    // The whole argument for letting a provider read before they buy.
    expect(DETAIL).not.toContain('openEnquiry');
    expect(DETAIL).not.toContain('submitQuotation');
  });
});

// ══ 2. WHAT ARRIVES IS PARSED, NOT COERCED ═════════════════════════════════

describe('parseLinkedRfqId', () => {
  /**
   * This value comes out of a URL - a bookmark, a shared message, an address
   * bar. It is NOT a security boundary: every procedure it reaches is
   * authorized server-side and this only decides what to scroll to and
   * preselect. It is parsed in one place anyway, because coercing it at each
   * use site is how the same string ends up meaning three different numbers.
   */
  it('accepts a plain positive integer', () => {
    expect(parseLinkedRfqId('?rfq=42')).toBe(42);
    expect(parseLinkedRfqId('rfq=42')).toBe(42);
  });

  it('rejects everything that is not one', () => {
    for (const search of [
      '', '?', '?rfq=', '?rfq=abc', '?rfq=-1', '?rfq=1.5', '?rfq=1e3', '?rfq=0x10',
      '?rfq=%20', '?rfq=null', '?rfq=undefined', '?rfq=NaN', '?rfq=Infinity',
      '?rfq[]=1', '?other=42',
    ]) {
      expect(parseLinkedRfqId(search), `${JSON.stringify(search)} must not parse`).toBeUndefined();
    }
    expect(parseLinkedRfqId(null)).toBeUndefined();
    expect(parseLinkedRfqId(undefined)).toBeUndefined();
  });

  it('rejects 0, because 0 is the form\'s "nothing selected" sentinel', () => {
    // Accepting it from a URL would produce a form that LOOKS targeted and is
    // not - the worst of the available outcomes.
    expect(parseLinkedRfqId('?rfq=0')).toBeUndefined();
    expect(parseLinkedRfqId('?rfq=00')).toBeUndefined();
  });

  it('rejects an id past the safe-integer range rather than rounding it', () => {
    // Number('9007199254740993') silently becomes 9007199254740992, which is a
    // different record.
    expect(parseLinkedRfqId('?rfq=9007199254740993')).toBeUndefined();
  });

  it('takes the FIRST value when the parameter is repeated', () => {
    // URLSearchParams.get returns the first. Asserted rather than assumed,
    // because "which one wins" is exactly the kind of thing that differs
    // between a parser and whatever a reader expects.
    expect(parseLinkedRfqId('?rfq=7&rfq=9')).toBe(7);
  });
});

// ══ 3. WHERE THEY LAND ═════════════════════════════════════════════════════

describe('the provider surface uses the linked id', () => {
  const PLATFORM = strip(read('../client/src/pages/RolePlatform.tsx'));
  const ENQUIRIES = strip(read('../client/src/components/QualifiedEnquiries.tsx'));

  it('parses the link through the shared parser, not inline', () => {
    expect(PLATFORM).toContain('parseLinkedRfqId(useSearch())');
  });

  it('passes it to the enquiry inbox so the row can be found', () => {
    expect(PLATFORM).toMatch(/<QualifiedEnquiries highlightRfqId=\{linkedRfqId\} \/>/);
  });

  it('preselects the quotation form with it', () => {
    expect(PLATFORM).toMatch(/rfqId: linkedRfqId \?\? 0/);
  });

  it('HIGHLIGHTING NEVER SPENDS A CREDIT', () => {
    // The most valuable assertion in this file. Auto-opening the enquiry for
    // the linked RFQ would turn following a link into a charge, and it would
    // look helpful right up until a vendor's allowance drained from browsing.
    // The highlight only scrolls and marks; the vendor still presses the
    // button that spends.
    const highlightEffect = ENQUIRIES.slice(
      ENQUIRIES.indexOf('const highlightRef'),
      ENQUIRIES.indexOf('}, [highlightRfqId'),
    );
    expect(highlightEffect.length).toBeGreaterThan(0);
    expect(highlightEffect).not.toContain('open.mutate');
    expect(highlightEffect).toContain('scrollIntoView');
  });

  it('the highlight marks a row that is already in the list, never adds one', () => {
    // Rendering a row for an RFQ the server did not return would be inventing
    // eligibility client-side.
    expect(ENQUIRIES).toMatch(/items\.map\(item =>/);
    expect(ENQUIRIES).toMatch(/item\.id === highlightRfqId \? highlightRef : undefined/);
  });
});

// ══ 4. THE FORM SAYS WHAT IT IS ABOUT ══════════════════════════════════════

describe('the quotation form names its target', () => {
  const PLATFORM = strip(read('../client/src/pages/RolePlatform.tsx'));

  it('shows which request the bid is against', () => {
    // A dialog whose only field is "Your price" is a way to bid on the wrong
    // thing, and the provider has no way to notice.
    expect(PLATFORM).toContain('data-testid="quote-target"');
    expect(PLATFORM).toMatch(/const quoteTarget = rfqs\.find\(/);
  });

  it('cannot be submitted with no target at all', () => {
    // rfqId 0 reached the server and came back a BAD_REQUEST toast, which is
    // safe and useless.
    expect(PLATFORM).toMatch(/disabled=\{submitQuote\.isPending \|\| !quoteForm\.price \|\| !quoteForm\.rfqId\}/);
  });
});

// ══ 5. THE DEAD END IS NAMED ═══════════════════════════════════════════════

describe('a request that is not eligible says so', () => {
  const ENQUIRIES = strip(read('../client/src/components/QualifiedEnquiries.tsx'));
  const LANG = read('../client/src/contexts/LanguageContext.tsx');

  it('tells a provider whose linked request is absent from the list', () => {
    // Otherwise they scan an inbox for something that was never going to be in
    // it, and conclude the product is broken.
    expect(ENQUIRIES).toContain('data-testid="enquiry-not-eligible"');
    expect(ENQUIRIES).toMatch(/!items\.some\(item => item\.id === highlightRfqId\)/);
  });

  it('states both possible reasons rather than asserting one', () => {
    // Only the server knows which applies, and it is not asked here. Naming
    // one as fact would be inventing a reason.
    const en = /'enquiries\.notInList': '([^']+)'/.exec(LANG)?.[1] ?? '';
    expect(en).toMatch(/closed/i);
    expect(en).toMatch(/categor/i);
  });

  it('is translated in both languages, like everything else on this surface', () => {
    expect((LANG.match(/'enquiries\.notInList':/g) ?? []).length).toBe(2);
    // The Arabic string is Arabic, not an English fallback pasted twice.
    const both = [...LANG.matchAll(/'enquiries\.notInList': '([^']+)'/g)].map(m => m[1]);
    expect(both).toHaveLength(2);
    expect(both[1]).toMatch(/[؀-ۿ]/);
  });

  it('the notice never claims the provider was charged or refused by the server', () => {
    // It is a client-side observation about a list, not a server verdict.
    const both = [...LANG.matchAll(/'enquiries\.notInList': '([^']+)'/g)].map(m => m[1]);
    for (const message of both) {
      expect(message).not.toMatch(/credit|رصيد/i);
    }
  });
});
