import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { oklchToRgb, contrast, rgbToHex, hexToRgb } from '../scripts/brand/palette.mjs';
import { readSourceForAssertions } from './_testing/sourceText';

/**
 * ── THE PALETTE IS ACCESSIBLE, AND THAT IS COMPUTED, NOT ASSERTED ───────
 *
 * The approved RAKIZA palette contains a colour that cannot be used the way
 * the approved mockup uses it. Accent Amber #F59E0B is 2.15:1 against white:
 * it fails AA for normal text, for large text and for non-text UI. The mockup
 * shows white "Sign Up" and "Search" labels sitting on amber fills, and an
 * amber underline as the sole indicator of the active nav item.
 *
 * The owner resolved this directly: preserve the approved amber, but
 * accessibility overrides literal screenshot reproduction. So amber controls
 * carry Text Dark (8.26:1), amber never becomes a text colour on a light
 * surface, Neutral Gray never becomes body text, and the active nav item
 * says so with more than a colour.
 *
 * THE POINT OF COMPUTING RATHER THAN LISTING. A test that hard-codes "primary
 * on background is 13.58:1" passes forever after someone edits the token,
 * because the number in the test is a memory of a palette rather than a
 * measurement of one. These read the tokens out of index.css, convert them,
 * and divide. Change a token and the arithmetic changes with it.
 */

const ROOT = join(import.meta.dirname, '..');
const CSS = readFileSync(join(ROOT, 'client/src/index.css'), 'utf8');

/** The token block for a selector, so `:root` and `.dark` are read separately. */
function block(selector: string): string {
  const at = CSS.indexOf(selector);
  expect(at, `${selector} not found in index.css`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}' && --depth === 0) return CSS.slice(open, i);
  }
  throw new Error(`${selector} is unterminated`);
}

const ROOT_TOKENS = block(':root');
const DARK_TOKENS = block('.dark');
const THEME_TOKENS = block('@theme inline');

/**
 * `--token: oklch(L% C H)` or `--token: #RRGGBB` -> sRGB.
 *
 * Both notations are deliberate in index.css: the six approved anchors are
 * written as the exact hexes from the brand sheet so a reviewer can compare
 * them directly, and the generated steps stay in oklch. A reader of a token
 * should not have to care which, so this handles both. Alpha-bearing values
 * are not tokens and are not accepted.
 */
function colour(source: string, token: string): [number, number, number] {
  const oklch = source.match(
    new RegExp(`${token}\\s*:\\s*oklch\\(\\s*([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`));
  if (oklch) {
    return oklchToRgb(Number(oklch[1]) / 100, Number(oklch[2]), Number(oklch[3])) as [number, number, number];
  }
  const hex = source.match(new RegExp(`${token}\\s*:\\s*(#[0-9A-Fa-f]{6})\\b`));
  expect(hex, `${token} is missing, or is neither a plain oklch() nor a 6-digit hex`).toBeTruthy();
  return hexToRgb(hex![1]) as [number, number, number];
}

/** Reads a token from `.dark` if it overrides, else from `:root`. */
const darkColour = (token: string) =>
  new RegExp(`${token}\\s*:`).test(DARK_TOKENS)
    ? colour(DARK_TOKENS, token)
    : colour(ROOT_TOKENS, token);

const ratio = (a: [number, number, number], b: [number, number, number]) => contrast(a, b);

/** WCAG 2.2 AA. 4.5 normal text, 3.0 large text and non-text UI. */
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

describe('light mode clears AA where it has to', () => {
  const pairs: [string, string, string, number][] = [
    ['body text on the page', '--foreground', '--background', AA_TEXT],
    ['body text on a card', '--foreground', '--card', AA_TEXT],
    ['helper text on the page', '--muted-foreground', '--background', AA_TEXT],
    ['helper text on a card', '--muted-foreground', '--card', AA_TEXT],
    ['helper text on a muted panel', '--muted-foreground', '--muted', AA_TEXT],
    ['a primary button label', '--primary-foreground', '--primary', AA_TEXT],
    ['a destructive button label', '--destructive-foreground', '--destructive', AA_TEXT],
    ['a secondary button label', '--secondary-foreground', '--secondary', AA_TEXT],
    ['an accent surface label', '--accent-foreground', '--accent', AA_TEXT],
    ['the focus ring against the page', '--ring', '--background', AA_NON_TEXT],
    ['sidebar text', '--sidebar-foreground', '--sidebar', AA_TEXT],
    ['the active sidebar item', '--sidebar-accent-foreground', '--sidebar-accent', AA_TEXT],
    ['the sidebar primary', '--sidebar-primary', '--sidebar', AA_NON_TEXT],
  ];
  for (const [label, fg, bg, min] of pairs) {
    it(`${label} is at least ${min}:1`, () => {
      const r = ratio(colour(ROOT_TOKENS, fg), colour(ROOT_TOKENS, bg));
      expect(r, `${fg} on ${bg} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
    });
  }
});

describe('dark mode clears AA too, which is where it used to be skipped', () => {
  const pairs: [string, string, string, number][] = [
    ['body text on the page', '--foreground', '--background', AA_TEXT],
    ['body text on a card', '--foreground', '--card', AA_TEXT],
    ['helper text on the page', '--muted-foreground', '--background', AA_TEXT],
    ['a primary button label', '--primary-foreground', '--primary', AA_TEXT],
    ['a destructive button label', '--destructive-foreground', '--destructive', AA_TEXT],
    ['the focus ring against the page', '--ring', '--background', AA_NON_TEXT],
  ];
  for (const [label, fg, bg, min] of pairs) {
    it(`${label} is at least ${min}:1`, () => {
      const r = ratio(darkColour(fg), darkColour(bg));
      expect(r, `${fg} on ${bg} is ${r.toFixed(2)}:1 in dark mode`).toBeGreaterThanOrEqual(min);
    });
  }
});

describe('amber is the exception, and the exception is enforced', () => {
  const amber = colour(THEME_TOKENS, '--color-brand-accent-500');
  const amberDark = colour(THEME_TOKENS, '--color-brand-accent-600');
  const textDark = colour(ROOT_TOKENS, '--foreground');
  const white: [number, number, number] = [255, 255, 255];

  it('the approved amber really is the approved amber', () => {
    // If this drifts, every number below is about a different colour.
    expect(rgbToHex(amber)).toBe('#F59E0B');
  });

  it('white on amber fails, which is the whole reason for the rule', () => {
    // Asserted as a FAILURE on purpose. If a future palette edit made white
    // legible on the accent, the prohibition below would be unnecessary and
    // this test should be the thing that says so.
    expect(ratio(white, amber)).toBeLessThan(AA_NON_TEXT);
  });

  it('Text Dark on amber clears AA, so amber controls have a usable label', () => {
    expect(ratio(textDark, amber)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratio(textDark, amberDark), 'hover darkens past legibility')
      .toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('Neutral Gray is not the helper text colour', () => {
    /*
     * #94A3B8 is 2.56:1 on white. It is in the palette for dividers and rules.
     * The failure mode this prevents is somebody reading "Neutral Gray" off
     * the brand sheet and assigning it to --muted-foreground because that is
     * the grey-looking token.
     */
    const neutral = colour(THEME_TOKENS, '--color-brand-neutral');
    expect(rgbToHex(neutral)).toBe('#94A3B8');
    expect(ratio(neutral, white)).toBeLessThan(AA_TEXT);
    const helper = colour(ROOT_TOKENS, '--muted-foreground');
    expect(rgbToHex(helper), 'helper text was set to Neutral Gray').not.toBe('#94A3B8');
  });

  it('the accent scale stays three steps long', () => {
    const steps = [...THEME_TOKENS.matchAll(/--color-brand-accent-(\d+):/g)].map(m => m[1]);
    expect(steps.sort()).toEqual(['400', '500', '600']);
  });

  it('secondary blue is bounded the same way and is not the primary', () => {
    const steps = [...THEME_TOKENS.matchAll(/--color-brand-blue-(\d+):/g)].map(m => m[1]);
    expect(steps.sort()).toEqual(['400', '500', '600']);
    expect(rgbToHex(colour(THEME_TOKENS, '--color-brand-blue-500'))).toBe('#1B6BFF');
    // Navy stays dominant: the primary is the navy anchor, not the blue.
    expect(rgbToHex(colour(ROOT_TOKENS, '--primary'))).toBe('#0F2D5B');
  });

  it('the navy anchor sits at step 800 exactly', () => {
    expect(rgbToHex(colour(THEME_TOKENS, '--color-brand-800'))).toBe('#0F2D5B');
  });
});

describe('no component pairs amber with a light label', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }
  const FILES = walk(join(ROOT, 'client/src'));
  const rel = (f: string) => f.slice(ROOT.length).replace(/^\/+/, '');
  const source = (f: string) => readSourceForAssertions(readFileSync(f, 'utf8'));

  it('no element sets a white label on an amber fill', () => {
    /*
     * The mockup does exactly this, twice - the Sign Up button and the Search
     * button - at 2.15:1. Reproducing it faithfully would ship two illegible
     * controls on the most important page in the product.
     *
     * The detector is per class-string rather than per file, because a file
     * may legitimately contain both an amber fill and a white label on
     * different elements.
     */
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const match of source(file).matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
        const classes = match[1] ?? match[2] ?? match[3] ?? '';
        const amberFill = /\bbg-brand-accent-\d{3}\b/.test(classes);
        const lightLabel = /\btext-(white|primary-foreground|brand-50|brand-100)\b/.test(classes);
        if (amberFill && lightLabel) offenders.push(`${rel(file)} :: ${classes.trim().slice(0, 120)}`);
      }
    }
    expect(offenders, 'a white label sits on an amber fill at 2.15:1').toEqual([]);
  });

  it('amber is never a text colour at the two steps that cannot be one', () => {
    /*
     * accent-400 is 1.67:1 on white and accent-500 is 2.15:1. Neither can be
     * text on a LIGHT surface under any size rule. accent-600 is 3.11:1 and is
     * permitted for large text and non-text, so it is not forbidden here.
     *
     * ── THE EXCEPTION, AND WHY IT IS AN ATTRIBUTE ──────────────────────
     *
     * On a dark surface the same amber is fine - 6.3:1 against the navy
     * anchor, 8.9:1 against brand-950 - and the approved design uses exactly
     * that for the hero's trust-strip icons. A class string cannot see its own
     * background, so the only honest way to allow it is to make the author say
     * so: `data-on-dark` on the element itself.
     *
     * That keeps the rule absolute rather than fuzzy. The exception cannot be
     * applied by accident, it is one grep away for a reviewer, and a careless
     * `text-brand-accent-500` on a white card still fails.
     */
    const offenders: string[] = [];
    for (const file of FILES) {
      const text = source(file);
      for (const m of text.matchAll(/\btext-brand-accent-(400|500)\b/g)) {
        /* The element's own attributes: from the opening `<` before the match
           to the `>` after it. Narrow on purpose - a sibling's opt-out must
           not excuse this one. */
        const open = text.lastIndexOf('<', m.index!);
        const close = text.indexOf('>', m.index!);
        const element = open >= 0 && close > open ? text.slice(open, close) : '';
        if (/data-on-dark/.test(element)) continue;
        offenders.push(`${rel(file)} :: ${m[0]}`);
      }
    }
    expect(offenders, 'amber is being used as text below 3:1 on a light surface').toEqual([]);
  });

  it('and the dark-surface exception is used sparingly enough to review', () => {
    /*
     * A RATCHET ON AN ESCAPE HATCH. `data-on-dark` is correct where it is
     * used and corrosive if it spreads: the moment it is the habit rather
     * than the exception, the rule above stops meaning anything.
     */
    const uses = FILES.reduce(
      (sum, file) => sum + [...source(file).matchAll(/data-on-dark/g)].length, 0);
    expect(uses, 'the dark-surface exception is spreading').toBeLessThanOrEqual(2);
  });
});
