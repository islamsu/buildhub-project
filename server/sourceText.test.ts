import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments, readSourceForAssertions } from './_testing/sourceText';

/**
 * THE TEST HELPER THAT WAS QUIETLY BREAKING OTHER TESTS.
 *
 * Twelve test files read a source file and removed its comments before
 * asserting on it, each with `replace(/\/\*[\s\S]*?\*\//g, '')`.
 *
 * `accept="image/*,application/pdf"` contains `/*`. In RFQPage.tsx that opened
 * a false comment which ran to the next `*​/` and swallowed 6,045 characters -
 * including the RFQ form's submit button.
 *
 * The failures that shout are the harmless ones. The dangerous case is
 * `expect(source).not.toContain(x)`, which passes on text that was deleted
 * before anybody looked at it: a guardian asserting something bad is absent
 * cannot distinguish "absent" from "never examined".
 */

describe('stripComments does not treat a MIME wildcard as a comment', () => {
  it('leaves `image/*` alone', () => {
    const source = 'const a = 1;\nconst accept = "image/*,application/pdf";\nconst b = 2;';
    expect(stripComments(source)).toContain('image/*,application/pdf');
    expect(stripComments(source)).toContain('const b = 2;');
  });

  it('THE EXACT REGRESSION: code after a MIME wildcard survives', () => {
    // This is the shape that hid the submit button - a wildcard, then a real
    // block comment later, then the code under test.
    const source = [
      'accept="image/*,application/pdf"',
      'const middle = "kept";',
      '/* a genuine comment */',
      'disabled={x || !form.category}',
    ].join('\n');
    const out = stripComments(source);
    expect(out).toContain('const middle = "kept";');
    expect(out).toContain('disabled={x || !form.category}');
    expect(out).not.toContain('a genuine comment');
  });

  it('the naive regex this replaces really does lose that code', () => {
    // The negative control. Without it, the test above proves only that the
    // new helper works, not that the old one was broken.
    const source = [
      'accept="image/*,application/pdf"',
      'const middle = "kept";',
      '/* a genuine comment */',
      'disabled={x || !form.category}',
    ].join('\n');
    const naive = source.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(naive, 'the old idiom swallows real code').not.toContain('const middle = "kept";');
  });
});

describe('it still removes what it is supposed to', () => {
  it('block comments', () => {
    expect(stripComments('a\n/* gone */\nb')).not.toContain('gone');
  });
  it('line comments', () => {
    expect(stripComments('a // gone\nb')).not.toContain('gone');
  });
  it('JSX comment wrappers collapse away', () => {
    expect(readSourceForAssertions('<div>\n{/* gone */}\n<p/></div>')).not.toContain('gone');
  });
  it('but never a comment marker inside a string', () => {
    for (const source of [
      `const s = "// not a comment";`,
      `const s = '/* not a comment */';`,
      'const s = `a // b`;',
      `const url = "https://example.test/path";`,
    ]) {
      expect(stripComments(source), source).toBe(source);
    }
  });
  it('an escaped quote does not end the string early', () => {
    const source = `const s = "he said \\" /* still a string */ ";`;
    expect(stripComments(source)).toBe(source);
  });
  it('an unterminated block comment consumes the rest, rather than looping', () => {
    expect(stripComments('a /* never closed')).toBe('a ');
  });
});

describe('the files this repository actually asserts on', () => {
  it('RFQPage keeps its submit guard, which the old idiom hid', () => {
    const page = readSourceForAssertions(readFileSync('client/src/pages/RFQPage.tsx', 'utf8'));
    expect(page).toContain('disabled={createRfq.isPending');
    expect(page).toContain('rfq-category-required');
  });

  it('and the guard refuses a genuinely catastrophic strip', () => {
    expect(() => readSourceForAssertions('/*' + 'x'.repeat(500))).toThrow(/catastrophic/);
  });
});
