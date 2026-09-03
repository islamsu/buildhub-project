import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { stripComments } from './_testing/sourceText';

vi.mock('./db', () => ({ getDb: vi.fn() }));
import { getDb } from './db';
import { requireDb } from './_core/requireDb';

/**
 * AN OUTAGE IS NOT AN EMPTY STATE.
 *
 * `const db = await getDb(); if (!db) return [];` appeared FORTY-FIVE times in
 * routers.ts, plus eight more returning a zeroed shape. Every one of them turns
 * an unreachable database into a confident statement about the user's data:
 *
 *   "No disputes have been filed"      (an administrator stops looking)
 *   "0 registered users"               (on the public homepage)
 *   "0 unread"                         (real notifications, hidden)
 *   "no subscription"                  (a billing decision, acted on)
 *
 * The mandate is that ZERO REAL DATA MUST PRODUCE A TRUTHFUL EMPTY STATE. The
 * corollary is the one that was broken: an outage must never produce one.
 */

const SERVER = new URL('.', import.meta.url);
const ROUTERS = stripComments(readFileSync(new URL('routers.ts', SERVER), 'utf8'));

describe('requireDb is the one way to say "unavailable"', () => {
  it('throws INTERNAL_SERVER_ERROR rather than returning nothing', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(requireDb()).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });

  it('says plainly that this is NOT an empty result', async () => {
    // The message is what a support conversation quotes back. It has to
    // distinguish the two cases in words, not only in a status code.
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(requireDb()).rejects.toThrow(/not an empty result/i);
  });

  it('names BuildHub, not the storage engine', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(requireDb()).rejects.toThrow(/BuildHub/);
    await expect(requireDb()).rejects.not.toThrow(/mysql|mariadb|drizzle/i);
  });

  it('returns the database untouched when there is one', async () => {
    const db = { marker: 'the real handle' };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    await expect(requireDb()).resolves.toBe(db);
  });
});

describe('no procedure reports an outage as an empty result', () => {
  it('routers.ts contains no "if (!db) return" at all', () => {
    // Not a count that can drift - none. The shapes were `return []`,
    // `return { count: 0 }`, `return null` and `return DEFAULT_...`, and each
    // reads to somebody as a fact about their data.
    const offenders = ROUTERS.split('\n')
      .map((line, index) => ({ line: index + 1, text: line.trim() }))
      .filter(entry => /if \(!db\) return/.test(entry.text));
    expect(
      offenders.map(o => `routers.ts:${o.line} ${o.text}`),
      'an unreachable database is being reported as data',
    ).toEqual([]);
  });

  it('and requireDb is genuinely used, not merely imported', () => {
    const uses = ROUTERS.split('requireDb()').length - 1;
    expect(uses).toBeGreaterThanOrEqual(50);
  });

  it('the sweep can still SEE the pattern - otherwise the rule above is vacuous', () => {
    const planted = '    const db = await getDb();\n    if (!db) return [];\n';
    expect(planted.split('\n').some(line => /if \(!db\) return/.test(line.trim()))).toBe(true);
  });
});

describe('what still degrades quietly does so deliberately', () => {
  const read = (name: string) => stripComments(readFileSync(new URL(name, SERVER), 'utf8'));

  it('the analytics recorder still swallows - a metric must not fail a mutation', () => {
    // The deliberate asymmetry. recordEvent is a side-channel: failing a
    // supplier's product listing because a KPI could not be written would be
    // the worse outcome, and nobody reads an analytics gap as a fact about
    // their own data.
    expect(read('analytics/events.ts')).not.toContain('requireDb');
  });

  it('the commercial audit helper still swallows, for the same reason', () => {
    expect(read('_core/commercialAudit.ts')).not.toContain('requireDb');
  });

  it('but the ACCOUNT audit trail still THROWS - a privileged action must be recorded', () => {
    // Unchanged, and named here so the three policies read as one decision:
    // reads fail, side-channels swallow, privileged writes throw.
    const audit = read('_core/accountAudit.ts');
    expect(audit).toContain('await db.insert(userAccountAuditEvents)');
    expect(audit).not.toContain('catch');
  });

  it('isSessionRevoked still fails CLOSED, which is the same instinct', () => {
    const db = read('db.ts');
    const block = db.slice(db.indexOf('export async function isSessionRevoked'));
    expect(block.slice(0, 200)).toContain('if (!db) return true;');
  });
});

describe('the client can tell the difference', () => {
  /**
   * A screen that destructures only `isLoading` renders its empty state on a
   * FAILED query. AdminDashboard did exactly that for disputes: a failed fetch
   * read "No disputes have been filed".
   *
   * The rule is narrow on purpose - it applies to screens that render an empty
   * state at all, because those are the ones where the confusion is possible.
   */
  const CLIENT = new URL('../client/src/', import.meta.url);

  function pages(dir = CLIENT, found: { path: string; text: string }[] = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) { pages(child, found); continue; }
      if (!entry.name.endsWith('.tsx')) continue;
      found.push({ path: child.pathname.replace(/.*\/client\/src\//, ''), text: readFileSync(child, 'utf8') });
    }
    return found;
  }

  it('the sweep reads real pages', () => {
    const all = pages();
    expect(all.length).toBeGreaterThan(40);
    expect(all.some(p => p.path === 'pages/AdminDashboard.tsx')).toBe(true);
  });

  it.each([
    ['disputes', 'disputesFailed'],
    ['compliance', 'complianceFailed'],
    ['the user directory', 'usersFailed'],
  ])('AdminDashboard renders a FAILURE for %s, not its empty state', (_section, flag) => {
    const text = readFileSync(new URL('pages/AdminDashboard.tsx', CLIENT), 'utf8');
    // Observed AND rendered. `usersFailed` was already destructured here and
    // used nowhere - the observation existed, the honesty did not, and a test
    // that only looked for the word would have passed on that.
    expect(text, `${flag} is not observed`).toContain(`isError: ${flag}`);
    expect(text, `${flag} is observed but never rendered`).toContain(`{${flag} ? <LoadFailed`);
  });

  it('and the failure says plainly that it is not an empty result', () => {
    const text = readFileSync(new URL('pages/AdminDashboard.tsx', CLIENT), 'utf8');
    expect(text).toContain('This is not an empty result');
    // Both languages. An Arabic-reading administrator needs the same sentence.
    expect(text).toContain('ليست نتيجة فارغة');
  });

  it('the failure offers Retry rather than forcing a reload that loses the filters', () => {
    const text = readFileSync(new URL('pages/AdminDashboard.tsx', CLIENT), 'utf8');
    expect(text).toContain('onRetry={() => void refetchDisputes()}');
    expect(text).toContain('onRetry={() => void refetchCompliance()}');
    expect(text).toContain('onRetry={() => void refetchUsers()}');
  });

  it('and the admin category page does too', () => {
    const text = readFileSync(new URL('pages/AdminCategories.tsx', CLIENT), 'utf8');
    expect(text).toContain('categories.isError');
    expect(text).toContain('data-testid="category-error"');
  });
});
