// ── ACCESSIBILITY INVARIANTS THAT SOURCE CAN HOLD ─────────────────────────
//
// The real pass is `evidence/zg-a11y.mjs`, which loads pages, computes the
// accessible name of every interactive element the way a screen reader would,
// walks the heading outline, tabs through the page and follows focus through a
// dialog. Source cannot do any of that.
//
// What source CAN do is stop two specific regressions from reappearing, both
// of which were found by that probe and neither of which is visible by reading
// a component on its own.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const CLIENT = new URL('../client/src/', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, CLIENT), 'utf8');

function tsxFiles(dir = CLIENT, prefix = ''): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) { out.push(...tsxFiles(child, `${prefix}${entry.name}/`)); continue; }
    if (!entry.name.endsWith('.tsx')) continue;
    out.push({ path: `${prefix}${entry.name}`, text: readFileSync(child, 'utf8') });
  }
  return out;
}

/** A JSX tag's attributes, brace-aware - `onCheckedChange={v => …}` contains `>`. */
function tagAttributes(text: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return text.slice(from, i);
  }
  return text.slice(from, from + 400);
}

describe('a toggle a screen reader can name', () => {
  /*
   * Radix renders Switch and Checkbox as a <button>. A WRAPPING <label> does
   * not name a button - label/for names form controls - so the text beside the
   * control is there for sighted readers only and the announcement is
   * "button". Four of these shipped, each one wrapped in a label that looked
   * like it was doing the job.
   */
  it('every Switch and Checkbox carries its own accessible name', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles()) {
      if (file.path.includes('ComponentShowcase')) continue;
      for (const match of file.text.matchAll(/<(Switch|Checkbox)\b/g)) {
        // wouter's router <Switch> is a different component with the same name.
        if (file.path === 'App.tsx') continue;
        const attrs = tagAttributes(file.text, match.index! + match[0].length);
        if (/aria-label|aria-labelledby|\sid=/.test(attrs)) continue;
        offenders.push(`${file.path}: <${match[1]}>`);
      }
    }
    expect(offenders, `these announce as "button":\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('the scanner is brace-aware - otherwise it reports false positives', () => {
    // POSITIVE AND NEGATIVE CONTROL for the parser itself. The first version
    // of this census split on the first `>`, which lands inside
    // `onCheckedChange={value => …}`, so it cut the attribute list in half and
    // reported controls that ARE named.
    const named = `<Switch onCheckedChange={v => set(v)} aria-label="Include tests" />`;
    expect(tagAttributes(named, '<Switch'.length)).toContain('aria-label');
    const unnamed = `<Switch onCheckedChange={v => set(v)} />`;
    expect(tagAttributes(unnamed, '<Switch'.length)).not.toContain('aria-label');
  });
});

describe('a dialog gives focus back', () => {
  /*
   * Almost every dialog here is driven by STATE rather than a DialogTrigger.
   * Closing sets the state back to null, which re-renders the list the opener
   * lives in; Radix's saved node is replaced, and focus falls to <body>. A
   * keyboard user who opened a row's dialog was returned to the top of the
   * page. Proved in a browser, fixed once in the primitive.
   */
  const DIALOG = read('components/ui/dialog.tsx');

  it('the opener is captured when the content node ATTACHES', () => {
    // Not in an effect (Radix has already moved focus), not in a useRef
    // initialiser (this component is in the tree from page load, so it would
    // capture <body>), and not from a focusin listener (invisible to a
    // headless browser, so unprovable). A callback ref fires on insertion,
    // before any effect.
    expect(DIALOG).toContain('const captureOpener = React.useCallback((node: HTMLDivElement | null)');
    expect(DIALOG).toContain('ref={captureOpener}');
    expect(DIALOG).toContain('document.activeElement');
  });

  it('and it is restored on close, by identity or by test id', () => {
    expect(DIALOG).toContain('onCloseAutoFocus={handleCloseAutoFocus}');
    expect(DIALOG).toContain('opener.isConnected');
    // The list re-renders as the dialog closes, so the node may be new while
    // the test id is stable.
    expect(DIALOG).toContain('data-testid="${CSS.escape(testId)}"');
  });

  it('the restore only acts when focus was actually dropped', () => {
    // A dialog that closes into a deliberate destination must be left alone.
    expect(DIALOG).toContain("if (document.activeElement && document.activeElement !== document.body) return;");
  });

  it('every dialog in the product goes through this primitive', () => {
    const rogue = tsxFiles()
      .filter(f => !f.path.startsWith('components/ui/'))
      .filter(f => /@radix-ui\/react-dialog/.test(f.text))
      .map(f => f.path);
    expect(rogue, `these import Radix dialog directly and skip the fix:\n  ${rogue.join('\n  ')}`)
      .toEqual([]);
  });
});
