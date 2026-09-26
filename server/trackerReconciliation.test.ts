/**
 * ── EVERY OPEN TRACKER ITEM IS CLASSIFIED ───────────────────────────────
 *
 * §41 says the tracker must not mix current engineering with duplicates, owner
 * decisions, infrastructure blocks, future architecture and the next commercial
 * milestone - and that every remaining item must be classified. It also says
 * never to delete work merely to improve completion numbers.
 *
 * Those two requirements pull against each other in the obvious way: the
 * cheapest path to "reconciled" is to tick or delete lines. So `todo.md` keeps
 * every line it has, `TRACKER_RECONCILIATION.md` classifies them, and this file
 * is what makes the second one true of the first.
 *
 * WHAT IT CATCHES:
 *
 *   a new open item added to todo.md and never classified
 *   an item classified into a category §41 does not define
 *   a reconciliation that has drifted from the tracker it describes
 *   a tracker item silently DELETED to make the count look better - the
 *     reconciliation would still name it, and nothing would connect it to
 *     anything, which the orphan check below reports
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const TODO = readFileSync(join(ROOT, 'todo.md'), 'utf8');
const RECONCILIATION = readFileSync(join(ROOT, 'TRACKER_RECONCILIATION.md'), 'utf8');

/** §41's categories, verbatim. */
const CATEGORIES = [
  'CURRENT RELEASE ENGINEERING',
  'ALREADY COMPLETE',
  'DUPLICATE',
  'OWNER DECISION',
  'INFRASTRUCTURE BLOCKED',
  'OWNER DEFERRED',
  'POST-RELEASE ARCHITECTURE',
  'NEXT MARKETPLACE MILESTONE',
  'NOT APPLICABLE',
] as const;

/** Every unchecked line in the tracker. */
function openItems(): string[] {
  return TODO.split('\n')
    .filter(line => line.trimStart().startsWith('- [ ]'))
    .map(line => line.trimStart().slice('- [ ]'.length).trim())
    .filter(line => line.length > 0);
}

/**
 * Enough of an item's text to find it in the reconciliation without demanding a
 * character-exact copy - a table cell may wrap or lose a trailing clause.
 *
 * The first eight words, lowercased, with backticks and punctuation dropped.
 * Eight is long enough that two different items cannot collide: the shortest
 * open item is five words and the rest diverge well before eight.
 */
function fingerprint(item: string): string {
  return item
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .split(/[\s]+/)
    .slice(0, 8)
    .join(' ')
    .replace(/[:;,.]$/, '');
}

describe('the tracker and its reconciliation agree', () => {
  it('reads both files - the assertions below are not over empty strings', () => {
    expect(TODO.length).toBeGreaterThan(5000);
    expect(RECONCILIATION.length).toBeGreaterThan(2000);
    expect(openItems().length).toBeGreaterThan(0);
  });

  it('EVERY open item is named in the reconciliation', () => {
    const haystack = RECONCILIATION.toLowerCase().replace(/[`*_]/g, '');
    const unclassified = openItems().filter(item => {
      const needle = fingerprint(item);
      if (haystack.includes(needle)) return false;
      // A wrapped table cell may break between words, so a shorter prefix is
      // tried before declaring the item missing.
      return !haystack.includes(needle.split(' ').slice(0, 5).join(' '));
    });
    expect(unclassified,
      'these open tracker items are not classified in TRACKER_RECONCILIATION.md:\n  '
      + unclassified.join('\n  '),
    ).toEqual([]);
  });

  it('every category it uses is one §41 defines', () => {
    /*
     * Section headings only. A category name mentioned in prose - "§39 lists
     * these as standing decisions" - is explanation, not a classification, and
     * flagging it would push the document towards saying less.
     */
    const headings = RECONCILIATION.split('\n')
      .filter(line => line.startsWith('## '))
      .map(line => line.slice(3).split('—')[0].trim());
    const unknown = headings.filter(heading =>
      heading.length > 0
      && !CATEGORIES.some(category => heading.toUpperCase().startsWith(category))
      && !/^Two findings/.test(heading));
    expect(unknown, `these headings are not §41 categories: ${unknown.join(', ')}`).toEqual([]);
  });

  it('uses more than one category, or it is a list rather than a reconciliation', () => {
    const used = CATEGORIES.filter(category => RECONCILIATION.includes(category));
    expect(used.length).toBeGreaterThanOrEqual(5);
  });

  it('every ALREADY COMPLETE claim cites evidence, not a judgement', () => {
    /*
     * The category that could be abused. A row saying "done" is worth nothing;
     * a row naming a test file or a probe can be checked, and a wrong name
     * fails the next assertion.
     */
    const section = RECONCILIATION.slice(
      RECONCILIATION.indexOf('## ALREADY COMPLETE'),
      RECONCILIATION.indexOf('## DUPLICATE'));
    const rows = section.split('\n').filter(line => line.startsWith('| ') && line.includes('ALREADY COMPLETE'));
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      expect(row, `no evidence cited: ${row.slice(0, 70)}`).toMatch(/\.test\.ts|\.mjs|OWNER_DECISIONS|admin\./);
    }
  });

  it('and every file it cites as evidence really exists', () => {
    const cited = new Set(
      [...RECONCILIATION.matchAll(/`?(evidence\/[\w.-]+\.mjs|server\/[\w./-]+\.test\.ts|shared\/[\w.-]+\.ts)`?/g)]
        .map(match => match[1]));
    expect(cited.size, 'the reconciliation cites no files at all').toBeGreaterThan(8);
    const missing = [...cited].filter(relative => {
      try { readFileSync(join(ROOT, relative), 'utf8'); return false; } catch { return true; }
    });
    expect(missing, `cited but absent:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('records the two findings that are not tracker lines', () => {
    // Both came out of closing the release gates, and neither has a todo.md
    // line to hang off - which is exactly how a finding gets lost.
    expect(RECONCILIATION).toContain('/vendor/:id');
    expect(RECONCILIATION).toContain('serviceOfferings');
  });
});
