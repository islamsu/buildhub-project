import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

/**
 * CONTROLS THAT A SCREEN READER CAN NAME.
 *
 * Found by tabbing through the real application and reading the accessibility
 * tree, not by inspecting source. Three controls had no accessible name at
 * all - they were announced as "button" and "edit box".
 *
 * An icon is not a name. A placeholder is not a name either: it disappears the
 * moment there is text in the field, so a screen-reader user reviewing what
 * they typed hears an unnamed box.
 *
 * WHAT WAS NOT WRONG, recorded because I nearly reported it as a defect: every
 * one of the 23 focusable elements on the RFQ feed DOES have a visible focus
 * indicator. My first probe read `outlineStyle`, which is `none` by design -
 * the buttons use a Tailwind ring, drawn with box-shadow. Measuring the wrong
 * property produced a false finding, and checking both properties removed it.
 */

const NAVBAR = readSourceForAssertions(readFileSync('client/src/components/Navbar.tsx', 'utf8'));
const MARKET = readSourceForAssertions(readFileSync('client/src/pages/MarketplaceHub.tsx', 'utf8'));

describe('icon-only buttons carry a name', () => {
  it('the notifications button', () => {
    const block = NAVBAR.slice(NAVBAR.indexOf("navigate('/messages')") - 500, NAVBAR.indexOf("navigate('/messages')"));
    expect(block).toMatch(/aria-label=/);
  });

  it('the mobile menu toggle - the only way to navigate on a phone', () => {
    const block = NAVBAR.slice(NAVBAR.indexOf('setMobileOpen(!mobileOpen)') - 600, NAVBAR.indexOf('setMobileOpen(!mobileOpen)'));
    expect(block).toMatch(/aria-label=/);
    // Its state is announced too: "open menu" and "close menu" are different
    // actions and a toggle that always says one of them is lying half the time.
    expect(block).toMatch(/aria-expanded=\{mobileOpen\}/);
  });

  it('and both names are bilingual, like every other string', () => {
    for (const marker of ['Messages and notifications', 'Open menu', 'Close menu']) {
      expect(NAVBAR, marker).toContain(marker);
    }
    expect(NAVBAR).toMatch(/[؀-ۿ]/);
  });
});

describe('inputs are named by a label, not by a placeholder', () => {
  it('the marketplace search field', () => {
    const block = MARKET.slice(MARKET.indexOf('marketHub.searchPlaceholder') - 400, MARKET.indexOf('marketHub.searchPlaceholder') + 200);
    expect(block).toMatch(/aria-label=\{t\('marketHub\.searchPlaceholder'\)\}/);
  });

  it('the placeholder stays as well - it is useful, just not sufficient', () => {
    expect(MARKET).toMatch(/placeholder=\{t\('marketHub\.searchPlaceholder'\)\}/);
  });
});
