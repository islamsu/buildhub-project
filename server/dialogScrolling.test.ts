/**
 * ── A DIALOG MUST FIT ON THE SCREEN IT OPENS ON ─────────────────────────
 *
 * `DialogContent` is `fixed`, centred with a translate, and carried no maximum
 * height and no overflow. A dialog taller than the viewport ran off BOTH edges,
 * and because it is fixed the page behind it could not be scrolled to reach the
 * rest. The Post RFQ form hit it the moment تشطيب was selected: the finishing
 * brief appeared, the form outgrew the screen, and the submit button became
 * unreachable - so a finishing request could not be published at all.
 *
 * Measured with the bound removed, on the real page: the dialog spanned
 * `top -756` to `bottom 1357` in a 600px viewport, with the submit button at
 * `top 1296`. At an ordinary 1440x900 it was `top -606` to `bottom 1507`, so
 * this was never only a short-screen bug - a 1080p screenshot simply hid it.
 *
 * Four of the product's thirty-seven dialogs had already hand-patched
 * `max-h-[90vh] overflow-y-auto` onto themselves, which is what a defect in a
 * shared component looks like from outside. These tests hold the bound where it
 * belongs.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';

const ROOT = join(import.meta.dirname, '..');
const code = (relative: string) => readSourceForAssertions(readFileSync(join(ROOT, relative), 'utf8'));

/** Every .tsx under client/src, for the census below. */
function tsxFiles(dir = join(ROOT, 'client/src'), found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) tsxFiles(path, found);
    else if (entry.endsWith('.tsx')) found.push(path);
  }
  return found;
}

const dialog = code('client/src/components/ui/dialog.tsx');

describe('the shared dialog is bounded to the viewport', () => {
  it('carries a maximum height, which it did not', () => {
    expect(dialog).toContain('max-h-[calc(100dvh-2rem)]');
  });

  it('and uses dvh rather than vh, because of the on-screen keyboard', () => {
    /*
     * `vh` is the tallest the viewport EVER gets - it ignores browser chrome and
     * the keyboard. A keyboard opening over a `90vh` dialog pushes the submit
     * button back underneath it, which is the same defect on a phone.
     */
    const bound = dialog.slice(dialog.indexOf('max-h-['), dialog.indexOf('max-h-[') + 40);
    expect(bound).toContain('dvh');
    expect(bound).not.toMatch(/\d+vh/);
  });

  it('scrolls by default, so every existing dialog is reachable with no call-site change', () => {
    expect(dialog).toContain('"overflow-y-auto"');
  });
});

describe('and a long form gets header / scrolling body / reachable actions', () => {
  it('scrollBody switches the content box to three rows and stops IT scrolling', () => {
    expect(dialog).toContain('grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden');
  });

  it('with minmax(0,1fr), because a bare 1fr never shrinks', () => {
    /*
     * A grid row's default `min-height: auto` floors at the content's height, so
     * the middle row would stay as tall as the form and the overflow would never
     * engage - the dialog grows instead, which is the original defect with extra
     * steps.
     */
    expect(dialog).toContain('minmax(0,1fr)');
  });

  it('and DialogBody declares min-h-0 for the same reason', () => {
    const body = dialog.slice(dialog.indexOf('function DialogBody'));
    expect(body.slice(0, 900)).toContain('min-h-0');
    expect(body.slice(0, 900)).toContain('overflow-y-auto');
  });

  it('exactly one scroll container: scrollBody and overflow-y-auto are exclusive', () => {
    // The ternary is what guarantees it - they cannot both be applied.
    const classes = dialog.slice(dialog.indexOf('max-h-[calc(100dvh-2rem)]'));
    expect(classes.slice(0, 600)).toContain('scrollBody');
    expect(classes.slice(0, 600)).toContain('? "grid-rows-');
    expect(classes.slice(0, 600)).toContain(': "overflow-y-auto"');
  });

  it('DialogBody is exported, so a call site can actually use it', () => {
    expect(dialog).toMatch(/export \{[\s\S]*DialogBody/);
  });
});

describe('the Post RFQ dialog uses it', () => {
  const page = code('client/src/pages/RFQPage.tsx');

  it('declares scrollBody', () => {
    expect(page).toContain('scrollBody');
  });

  it('puts the form in a DialogBody', () => {
    expect(page).toContain('<DialogBody');
    expect(page).toContain('data-testid="rfq-post-body"');
  });

  it('AND THE SUBMIT BUTTON IS OUTSIDE THE SCROLL REGION', () => {
    /*
     * A submit button that is the last child of a long scrolling form is only
     * reachable by scrolling to the end of it. As the dialog's third grid row it
     * is on screen from the moment the dialog opens, however tall the form gets.
     */
    const body = page.indexOf('data-testid="rfq-post-body"');
    const bodyEnd = page.indexOf('</DialogBody>', body);
    const submit = page.indexOf('data-testid="rfq-create-submit"');
    expect(body).toBeGreaterThan(-1);
    expect(bodyEnd).toBeGreaterThan(-1);
    expect(submit).toBeGreaterThan(bodyEnd);
  });

  it('inside a DialogFooter, which is the canonical place for actions', () => {
    expect(page).toContain('<DialogFooter');
  });
});

describe('no dialog patches the bound onto itself any more', () => {
  it('because the shared component carries it', () => {
    /*
     * Four dialogs had `max-h-[90vh] overflow-y-auto` of their own. They are
     * harmless now but they are also the evidence of the original defect, and a
     * NEW one would mean the shared bound had stopped working. This counts them
     * so the number can only go down.
     */
    const offenders: string[] = [];
    for (const path of tsxFiles()) {
      if (path.endsWith('ui/dialog.tsx')) continue;
      const text = readSourceForAssertions(readFileSync(path, 'utf8'));
      for (const match of text.matchAll(/<DialogContent[^>]*className="([^"]*)"/g)) {
        if (/max-h-\[\d+vh\]/.test(match[1])) {
          offenders.push(path.replace(join(ROOT, 'client/src/'), ''));
        }
      }
    }
    // The four that pre-date the shared bound. This must not grow.
    expect(offenders.length, `dialogs still bounding themselves: ${offenders.join(', ')}`)
      .toBeLessThanOrEqual(4);
  });
});

describe('the finishing form reflows instead of overflowing', () => {
  const brief = code('client/src/components/FinishingBriefFields.tsx');

  it('its chips may wrap, because Button is whitespace-nowrap by default', () => {
    /*
     * "لا أعرف / ساعدني في الاختيار" is a sentence. A chip that can neither wrap
     * nor shrink pushes its row sideways out of the dialog, which is what the
     * owner's screenshot shows.
     */
    expect(brief).toContain('whitespace-normal');
    expect(brief).toContain('min-w-0');
    expect(brief).toContain('max-w-full');
  });

  it('and keep a real touch target when they do wrap', () => {
    const chip = brief.slice(brief.indexOf('const CHIP ='), brief.indexOf('const CHIP =') + 200);
    expect(chip).toContain('h-auto');
    expect(chip).toContain('py-2');
  });

  it('ITS TWO-COLUMN PAIRS ASK ABOUT THE CONTAINER, NOT THE VIEWPORT', () => {
    /*
     * They were `sm:grid-cols-2`, and `sm:` is a VIEWPORT question. Inside a
     * max-w-lg dialog on a 1440px desktop that condition is satisfied, so two
     * columns were rendered into roughly 230px each however much screen there
     * was - the cramped Materials / Site constraints pair the owner saw.
     */
    expect(brief).toContain('@container/brief');
    expect(brief).toContain('@[30rem]/brief:grid-cols-2');
    expect(brief).not.toContain('sm:grid-cols-2');
  });
});

describe('the AI affordance carries context from every surface', () => {
  const component = code('client/src/components/AskAiAbout.tsx');

  it('builds a subject-carrying href rather than a bare /ai', () => {
    expect(component).toContain("params = new URLSearchParams({ subject })");
    expect(component).toContain("params.set('id'");
  });

  it('and renders a Link, so it is in the tab order and openable in a new tab', () => {
    expect(component).toContain('<Link href={askAiHref(');
  });

  it('IT NAVIGATES AND ASKS NOTHING', () => {
    // No mutation, no message, no submit - following it selects a subject.
    for (const forbidden of ['useMutation', 'onSendMessage', 'handleSend', 'ai.chat']) {
      expect(component, `AskAiAbout ${forbidden}`).not.toContain(forbidden);
    }
  });

  it.each([
    ['client/src/pages/RFQDetail.tsx', 'request'],
    ['client/src/pages/RFQRespondPage.tsx', 'request'],
    ['client/src/pages/QuotationDetail.tsx', 'quotation'],
    ['client/src/pages/VendorProfile.tsx', 'provider'],
    ['client/src/pages/ProjectDetail.tsx', 'project'],
    ['client/src/components/FinishingBriefFields.tsx', 'category'],
  ])('%s hands over its %s', (path, subject) => {
    const text = code(path);
    expect(text).toContain('AskAiAbout');
    expect(text).toContain(`subject="${subject}"`);
  });

  it('and the project page no longer uses the old ad-hoc query string', () => {
    const project = code('client/src/pages/ProjectDetail.tsx');
    expect(project).not.toContain('`/ai?project=${projectId}`');
  });
});

describe('percentage pricing is quotation-level, and says so', () => {
  it('THE SCHEMA HAS ONE PERCENTAGE PER QUOTATION', () => {
    /*
     * The decision, held by the shape of the data: `percentageRate` and
     * `materialBaseAmount` are columns on `quotations`, not rows of a per-trade
     * table. Trade-level rates are the BOQ's job, where every `quotationItems`
     * line carries its own `tradeGroup` and its own `rate`.
     */
    const schema = code('drizzle/schema.ts');
    const quotations = schema.slice(schema.indexOf('export const quotations = mysqlTable'),
      schema.indexOf('export const quotationItems'));
    expect(quotations).toContain("percentageRate:     decimal('percentageRate'");
    expect(quotations).toContain("materialBaseAmount: decimal('materialBaseAmount'");
    for (const forbidden of ['tradePercentages', 'percentageByTrade', 'quotationPercentages']) {
      expect(schema, `${forbidden} would be a second pricing model`).not.toContain(forbidden);
    }
  });

  it('and quotationItems is where trade-level rates live', () => {
    const schema = code('drizzle/schema.ts');
    const items = schema.slice(schema.indexOf('export const quotationItems'));
    expect(items.slice(0, 2000)).toContain("tradeGroup:  varchar('tradeGroup'");
    expect(items.slice(0, 2000)).toContain("rate:        decimal('rate'");
  });

  it('the MD states the contract instead of promising a per-trade table', () => {
    const md = readFileSync(join(ROOT, 'FINISHING_AND_AI_CONTEXT.md'), 'utf8');
    expect(md).toContain('The percentage is QUOTATION-LEVEL');
    // The wording that read as a feature promise is gone.
    expect(md).not.toContain('Whole-scope or per-trade percentages are supported');
  });

  it('AND THE FORM SAYS IT TOO, where a contractor would go looking', () => {
    const fields = code('client/src/components/QuotationPricingFields.tsx');
    expect(fields).toContain('data-testid="pricing-percentage-scope"');
    expect(fields).toContain('use detailed pricing');
  });
});
