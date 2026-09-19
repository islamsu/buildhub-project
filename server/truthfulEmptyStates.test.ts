import { describe, expect, it, vi } from 'vitest';
import { adminRegistrationSurface } from './_testing/adminSurface';
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

/**
 * THE CLIENT TREE, READ ONCE, SHARED BY EVERY ASSERTION BELOW.
 *
 * Hoisted out of the first describe when the census joined this file: the
 * named-screen rules and the whole-tree rule are the same rule and must read
 * the same tree, or they can disagree about which files exist.
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

  it('isSessionRevoked still fails CLOSED - and now says WHICH closed', () => {
    // The same instinct as requireDb, and it belongs in this file for the same
    // reason. It used to answer `true` on an outage - "this session was signed
    // out" - which the authenticator repeated to the browser verbatim, so a
    // database outage presented to an administrator as a sign-out and sent
    // them to a page where they could not sign in.
    //
    // Refusing is still refusing; an exception stops the caller exactly as
    // `true` did. It just no longer asserts a fact about the session that
    // nobody checked. productionHardening.test.ts holds the security half -
    // that it can never resolve FALSE.
    const db = read('db.ts');
    const block = db.slice(db.indexOf('export async function isSessionRevoked'));
    expect(block.slice(0, 400)).toMatch(/if \(!db\) \{[\s\S]*throw new Error/);
    expect(block.slice(0, 400), 'an outage must not be answered "not revoked"')
      .not.toContain('if (!db) return false;');
  });

  it('and an unanswerable session question is not reported as a sign-out', () => {
    // The chain this sat at the bottom of: the context caught EVERY error from
    // the authenticator and set `user = null` under a comment about public
    // procedures, so infrastructure failure became an anonymous request;
    // `auth.me` answered null, and the whole client reads that one procedure
    // to decide whether somebody is signed in.
    const context = read('_core/context.ts');
    expect(context, 'the context cannot tell the two apart').toContain('authUnavailable');
    expect(context, 'a genuine auth failure is still an auth failure')
      .toContain('authUnavailable = !(error instanceof HttpError)');

    const trpc = read('_core/trpc.ts');
    expect(trpc, 'the guard still reports an outage as UNAUTHORIZED')
      .toContain('if (ctx.authUnavailable)');
    // UNAUTHORIZED is what sends the browser to the sign-in screen, so it must
    // come from the branch that knows there is no session - not from the one
    // that could not look.
    const refusal = trpc.slice(trpc.indexOf('function refuseUnauthenticated'));
    expect(refusal.indexOf('INTERNAL_SERVER_ERROR')).toBeLessThan(refusal.indexOf('UNAUTHORIZED'));

    const routers = read('routers.ts');
    expect(routers, 'auth.me still answers null when it does not know')
      .toContain('if (opts.ctx.authUnavailable)');
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



  it('the sweep reads real pages', () => {
    const all = pages();
    expect(all.length).toBeGreaterThan(40);
    expect(all.some(p => p.path === 'pages/AdminDashboard.tsx')).toBe(true);
  });

  it.each([
    ['compliance', 'complianceFailed'],
    ['the user directory', 'usersFailed'],
  ])('AdminDashboard renders a FAILURE for %s, not its empty state', (_section, flag) => {
    // The WHOLE admin surface, not one filename: the compliance failure state
    // moved with its query into AdminRegistrations when the management
    // interface left the dashboard. A filename-bound census reports the guard
    // missing while it is rendered correctly next door.
    const text = adminRegistrationSurface();
    // Observed AND rendered. `usersFailed` was already destructured here and
    // used nowhere - the observation existed, the honesty did not, and a test
    // that only looked for the word would have passed on that.
    expect(text, `${flag} is not observed`).toContain(`isError: ${flag}`);
    expect(text, `${flag} is observed but never rendered`).toContain(`{${flag} ? <LoadFailed`);
  });

  /*
   * DISPUTES MOVED, THE RULE DID NOT.
   *
   * The dispute queue left AdminDashboard for its own component when it gained
   * pagination, filtering and a real detail view. Restated against where it now
   * lives, and STRENGTHENED while it was here: the old assertion covered only
   * the failure branch, and the screen has a second way to mislead - an empty
   * result under an active filter reading as "no disputes have been filed",
   * which is the sentence that stops an administrator looking.
   */
  it('AdminDisputes renders a FAILURE for the queue, not its empty state', () => {
    const text = readFileSync(new URL('components/AdminDisputes.tsx', CLIENT), 'utf8');
    expect(text, 'the query failure is not observed').toContain('queue.isError ?');
    expect(text, 'the failure is observed but never rendered').toContain('<LoadFailed');
  });

  it('and distinguishes "nothing matches this filter" from "nothing has ever been filed"', () => {
    const text = readFileSync(new URL('components/AdminDisputes.tsx', CLIENT), 'utf8');
    expect(text).toContain('No disputes match this search.');
    expect(text).toContain('No disputes have been filed.');
    // Both languages, both sentences.
    expect(text).toContain('لا توجد نزاعات مطابقة لهذا البحث.');
    expect(text).toContain('لم يُسجَّل أي نزاع.');
  });

  it('and the failure says plainly that it is not an empty result', () => {
    // THE SENTENCE MOVED TO ITS SHARED HOME, and is asserted there.
    //
    // This screen and AdminRegistrations each carried their own identical copy
    // of it, both under a comment claiming it was "worded once, not per tab" -
    // true inside each file, false across the two. Both now read the canonical
    // copy, and the client census below requires that no third one appears.
    const shared = readFileSync(new URL('components/LoadFailed.tsx', CLIENT), 'utf8');
    expect(shared).toContain('This is not an empty result');
    // Both languages. An Arabic-reading administrator needs the same sentence.
    expect(shared).toContain('ليست نتيجة فارغة');
    // And this surface must genuinely use it rather than keep a private copy.
    expect(adminRegistrationSurface()).toContain('loadFailedCopy(lang === \'ar\')');
  });

  it('the failure offers Retry rather than forcing a reload that loses the filters', () => {
    // The WHOLE admin surface, not one filename: the compliance failure state
    // moved with its query into AdminRegistrations when the management
    // interface left the dashboard. A filename-bound census reports the guard
    // missing while it is rendered correctly next door.
    const text = adminRegistrationSurface();
    expect(text).toContain('onRetry={() => void refetchCompliance()}');
    expect(text).toContain('onRetry={() => void refetchUsers()}');
    // The dispute queue's own retry, where it now lives.
    const disputes = readFileSync(new URL('components/AdminDisputes.tsx', CLIENT), 'utf8');
    expect(disputes).toContain('onRetry={() => void queue.refetch()}');
    expect(disputes).toContain('onRetry={() => void detail.refetch()}');
  });

  it('and the admin category page does too', () => {
    const text = readFileSync(new URL('pages/AdminCategories.tsx', CLIENT), 'utf8');
    expect(text).toContain('categories.isError');
    expect(text).toContain('data-testid="category-error"');
  });
});

/*
 * ── THE SAME RULE, ON THE CLIENT, AS A CENSUS ─────────────────────────────
 *
 * Everything above is about the SERVER refusing to answer an outage with an
 * empty list. The client half is the same mandate and was applied only where
 * the defect had been noticed: a component destructures `{ data = [],
 * isLoading }`, the request fails, `isLoading` goes false, the default empty
 * array survives, and the screen states in confident language that there is
 * nothing there.
 *
 * What it says depends on where it happens, and none of it is true:
 *
 *   "Project not found."               a claim about a record's EXISTENCE,
 *                                      made to an administrator mid-investigation
 *   "No placements booked yet"         a commercial zero, under a heading
 *                                      about reach
 *   "0 vendors" on the public hub      a statement about the size of the
 *                                      business, on a page visitors judge it by
 *   "No products yet. Add your first"  told to a supplier with a full
 *                                      catalogue, inviting a duplicate listing
 *   "No matching vendors."             told to an administrator acting on an
 *                                      account that does exist
 *   a permanent "Loading…"             the pricing page, hung, on the one
 *                                      question it exists to answer
 *
 * So the rule stops being a habit applied screen by screen and becomes a
 * census with a written-down debt list.
 */
/** A surface that both reads data and can tell the reader there is none. */
const EMPTY_PHRASE =
  /No [a-z][a-z ]*(yet|found|matching|records|results)|لا توجد|لا يوجد|not found|غير موجود/i;

function surfaces() {
  return pages()
    .filter(p => p.path.startsWith('pages/') || p.path.startsWith('components/'))
    // COMMENTS STRIPPED. The phrase has to be one the product SAYS, not one
    // a comment uses to explain itself: Home was on the debt list because it
    // carries the note "nothing where there is no count yet" - describing the
    // very honesty this rule asks for.
    .filter(p => p.text.includes('useQuery') && EMPTY_PHRASE.test(stripComments(p.text)))
    .map(p => p.path);
}

const sourceOf = (rel: string) => readFileSync(new URL(rel, CLIENT), 'utf8');

/**
 * DOES THIS SURFACE OBSERVE ITS QUERY'S FAILURE?
 *
 * THREE SPELLINGS, ALL REAL, and the census had to learn each of them by
 * getting a file wrong first:
 *
 *   isError                       the common one
 *   const { error } = trpc.…      AdminDataQuality destructures and renders it
 *   query.error                   RFQRespondPage holds the query object and
 *                                 reads the property off it
 *
 * The last two must be tied to a QUERY. A census that accepted a bare `error`
 * would have passed AdminFeaturedProviders, which holds an `error` state for
 * its MUTATIONS while its query's failure went unobserved - the exact file
 * this rule existed to catch.
 */
const distinguishesError = (rel: string) => {
  const source = sourceOf(rel);
  if (/\bisError\b/.test(source)) return true;
  if (/const\s*\{[^}]*\berror\b[^}]*\}\s*=\s*trpc\./.test(source)) return true;
  // A query held as an object, then read by property.
  const held = [...source.matchAll(/const\s+(\w+)\s*=\s*trpc\.[\w.]*useQuery/g)].map(m => m[1]);
  return held.some(name => new RegExp(`\\b${name}\\.error\\b`).test(source));
};

/**
 * SURFACES THAT STILL CANNOT TELL THE TWO APART.
 *
 * A DEBT LIST, NOT AN EXEMPTION LIST.
 *
 * Five names came off it without a line of product code changing, because the
 * census was wrong about them rather than they about the rule:
 *
 *   AdminDataQuality, AdminRfqInvestigation, VendorReputation  destructure
 *     `error` from the query and render it - a spelling the first census could
 *     not see.
 *   Home  carries the note "nothing where there is no count yet", which
 *     DESCRIBES the honesty this rule asks for. Comments are stripped now.
 *   RFQRespondPage  says "No attachments" about files the supplier has just
 *     attached in this form - local state, not a query result at all. Every entry is a real instance of the
 * defect above, waiting its turn; none of them is here because the rule does
 * not apply. It is written down so that the count can only go DOWN - the test
 * below fails both when a NEW surface joins the list and when an entry is
 * fixed and not removed from it, so it cannot quietly become permanent.
 */
const KNOWN_GAPS: readonly string[] = [
];

describe('the census finds real surfaces', () => {
  it('reads a believable number of them', () => {
    // POSITIVE CONTROL. Without it, a broken walk or a regex that stops
    // matching makes every assertion below pass over an empty list.
    const all = surfaces();
    expect(all.length).toBeGreaterThan(30);
    expect(all).toContain('pages/AdminProjectDetail.tsx');
    expect(all).toContain('components/PlacementPerformance.tsx');
  });
});

describe('a surface that can say "nothing here" can also say "I could not look"', () => {
  it('NO SURFACE OUTSIDE THE DEBT LIST CONFLATES THE TWO', () => {
    const offenders = surfaces().filter(rel => !distinguishesError(rel) && !KNOWN_GAPS.includes(rel));
    expect(offenders, `these render an empty state and never look at the error:\n  ${offenders.join('\n  ')}`)
      .toEqual([]);
  });

  it('AN OBSERVED FAILURE IS ALSO ACTED ON, not merely destructured', () => {
    /*
     * `usersFailed` was once destructured on this very surface and used
     * nowhere - the observation existed and the honesty did not, and a rule
     * that only looked for the word passed on it.
     *
     * So every alias a surface gives its error flag has to appear again
     * somewhere other than the line that created it. Disabling a branch while
     * leaving `isError: somethingFailed` in the destructure is exactly the
     * shape of that regression, and it survived this file until this ran.
     */
    const offenders: string[] = [];
    for (const rel of surfaces()) {
      const source = sourceOf(rel);
      for (const [line, alias] of [...source.matchAll(/^.*\bisError:\s*(\w+).*$/gm)].map(m => [m[0], m[1]])) {
        const elsewhere = source
          .split('\n')
          .filter(other => other !== line)
          .some(other => new RegExp(`\\b${alias}\\b`).test(other));
        if (!elsewhere) offenders.push(`${rel}: ${alias}`);
      }
    }
    expect(offenders, `observed and then ignored:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('THE DEBT LIST ONLY SHRINKS - a fixed surface must leave it', () => {
    // Without this the list becomes a place to put things. An entry that now
    // handles its error is no longer debt, and leaving it listed would let the
    // next real gap hide behind a stale name.
    const stale = KNOWN_GAPS.filter(rel => distinguishesError(rel));
    expect(stale, `these are fixed and should be removed from KNOWN_GAPS:\n  ${stale.join('\n  ')}`)
      .toEqual([]);
  });

  it('every entry in the debt list is a file that still exists', () => {
    for (const rel of KNOWN_GAPS) {
      expect(() => sourceOf(rel), `${rel} is listed as debt but is not there`).not.toThrow();
    }
  });
});

describe('the failure state is one sentence, not one per screen', () => {
  it('both shapes read from the same copy', () => {
    const source = sourceOf('components/LoadFailed.tsx');
    expect(source).toContain('export function LoadFailed(');
    expect(source).toContain('export function LoadFailedInline(');
    expect(source).toContain('export function loadFailedCopy(');
    // The sentence itself says the thing the defect got wrong.
    expect(source).toContain('This is not an empty result');
    expect(source, 'the Arabic copy is an English fallback').toMatch(/[؀-ۿ]/);
  });

  it('nobody has grown a second version of the GENERIC sentence', () => {
    // Narrowed deliberately. A screen may word a SPECIFIC failure in its own
    // terms - "the taxonomy could not be loaded" says more than the generic
    // line and is not a rival to it. What must not exist twice is the general
    // statement itself, which is what AdminDashboard and AdminRegistrations
    // each carried their own copy of, both under a comment claiming it was
    // "worded once".
    const rivals = pages()
      .map(p => p.path)
      .filter(rel => rel !== 'components/LoadFailed.tsx')
      .filter(rel => /This is not an empty result|ليست نتيجة فارغة/.test(sourceOf(rel)));
    expect(rivals, `these carry their own copy of the general sentence:\n  ${rivals.join('\n  ')}`)
      .toEqual([]);
  });

  it('and the two screens that did now read from the shared copy', () => {
    for (const rel of ['pages/AdminDashboard.tsx', 'components/AdminRegistrations.tsx']) {
      expect(sourceOf(rel), rel).toContain('loadFailedCopy(lang === \'ar\')');
    }
  });
});

describe('the six surfaces fixed in this pass, by what each of them claimed', () => {
  it('AdminProjectDetail no longer calls a failed fetch "not found"', () => {
    const source = sourceOf('pages/AdminProjectDetail.tsx');
    expect(source).toContain('isError, refetch');
    // The order is the whole point: the error arm must come BEFORE the arm
    // that concludes the record does not exist. Measured inside the RENDERED
    // JSX - the doc comment above quotes "Project not found." while explaining
    // why it was wrong, and comparing file offsets scored that as the failure.
    const jsx = source.slice(source.indexOf('return ('));
    expect(jsx.indexOf(': isError ? (')).toBeGreaterThan(-1);
    expect(jsx.indexOf(': isError ? (')).toBeLessThan(jsx.indexOf('Project not found.'));
  });

  it('PlacementPerformance no longer reports a failure as zero placements', () => {
    const source = sourceOf('components/PlacementPerformance.tsx');
    expect(source).toContain('isError, refetch');
    // Every arm that renders a figure or a "none booked" claim is guarded.
    for (const arm of ['rows.length === 0', 'rows.length > 0']) {
      const at = source.indexOf(`!isError && ${arm}`);
      expect(at, `${arm} renders without checking the error`).toBeGreaterThan(-1);
    }
  });

  it('the public hub does not count a failed request as a real zero', () => {
    const source = sourceOf('pages/MarketplaceHub.tsx');
    expect(source).toContain('isError: directoryFailed');
    expect(source).toContain('isError: taxonomyFailed');
    // EVERY card, not "the file mentions the helper somewhere". Reverting one
    // card to `${directory.length}` left three others using the helper, and
    // the first version of this assertion passed on that.
    const cards = source.slice(source.indexOf('const sections = ['));
    const stats = [...cards.matchAll(/stat: ([^\n]+),/g)].map(m => m[1]);
    expect(stats.length).toBe(4);
    for (const stat of stats) expect(stat, stat).toContain('countOrUnknown(');
  });

  it('the supplier catalogue does not tell a stocked supplier to add their first product', () => {
    const source = sourceOf('pages/RolePlatform.tsx');
    expect(source).toContain('productsQuery.isError ? (');
    const jsx = source.slice(source.indexOf('return ('));
    expect(jsx.indexOf('productsQuery.isError')).toBeLessThan(jsx.indexOf('No products yet'));
  });

  it('both admin typeaheads say so instead of "no match"', () => {
    for (const rel of ['components/VendorIdentitySelect.tsx', 'components/ProductIdentitySelect.tsx']) {
      const source = sourceOf(rel);
      expect(source, rel).toContain('<LoadFailedInline');
      const jsx = source.slice(source.indexOf('return ('));
      expect(jsx.indexOf(': isError ? ('), rel).toBeGreaterThan(-1);
      expect(jsx.indexOf(': isError ? ('), rel).toBeLessThan(jsx.indexOf('results.length === 0'));
    }
  });

  it('the pricing page stops loading forever when the request fails', () => {
    const source = sourceOf('pages/Pricing.tsx');
    // The old guard was `isLoading || !data`, which routed a failure into the
    // spinner. Loading and failed must be different branches.
    expect(source).not.toContain('if (isLoading || !data)');
    expect(source).toContain('if (isLoading) {');
    expect(source).toContain('if (isError || !data) {');
  });
});
