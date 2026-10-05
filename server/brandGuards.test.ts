import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import { join } from 'node:path';
import { BLUEPRINT_INVARIANTS, parseBlueprint } from './_testing/blueprintInvariants';

/**
 * ── WHAT THE REBRAND MUST NOT TOUCH ─────────────────────────────────────
 *
 * The customer-facing product is RAKIZA. The machinery underneath is still
 * named buildhub, and that is deliberate rather than unfinished.
 *
 * A rebrand is the single easiest way to turn a cosmetic change into an
 * outage, because the brand name is also, by accident of history, an
 * IDENTIFIER: a storage key the browser already holds, a cookie a half-finished
 * sign-up is carrying, a Render service with a disk attached, a discriminant
 * stored in rows, a filename in an applied migration journal. Renaming any of
 * those produces no customer benefit and a specific, non-obvious failure:
 *
 *   buildhub_lang            every returning visitor silently reverts to English
 *   __Host-buildhub_*        sign-ups and OAuth logins in flight break at the cut
 *   BUILDHUB_* env vars      a deploy-coordination change wearing a brand costume
 *   buildhub-staging-mysql   a Render service whose NAME IS A HANDLE ON A DISK;
 *                            a Blueprint rename provisions a new service with a
 *                            new empty disk and the staging database is gone
 *   buildhub (db / user)     same, one layer down - inside that disk
 *   VITE_APP_ID              the session-JWT audience claim, not a service name
 *   buildhub-staging         the .onrender.com HOSTNAME, which a rename never
 *                            changes, so it outlives the RAKIZA rebrand
 *   'buildhub_policy'        a stored value; renaming it orphans existing rows
 *   drizzle/                 editing an applied migration desynchronises the journal
 *   buildhub.eg              DOMAIN MIGRATION IS A SEPARATE RELEASE (owner, §10)
 *
 * These assertions are not style. Each one is a thing that would have been
 * caught in production rather than in CI, by a user, as a bug with no obvious
 * connection to the commit that caused it.
 *
 * TO CHANGE ONE OF THESE DELIBERATELY: do the migration first - a dual-read
 * window for a storage key, a Blueprint plan for a service, a data migration
 * for a discriminant - and change the assertion in the same commit as the
 * mechanism that makes it safe. Never alone.
 */

const ROOT = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

describe('browser-held identifiers survive the rebrand', () => {
  it('the language key is still buildhub_lang', () => {
    /*
     * Held in localStorage by every visitor who has ever chosen Arabic.
     * Renaming it does not migrate them - it orphans the old key, the read
     * misses, and the site silently decides they want English. The only
     * visible symptom is "the site forgot my language", which nobody connects
     * to a logo change.
     */
    const ctx = read('client/src/contexts/LanguageContext.tsx');
    expect(ctx).toContain("localStorage.getItem('buildhub_lang')");
    expect(ctx).toContain("localStorage.setItem('buildhub_lang'");
  });

  it('the OAuth and sign-up cookies keep their names and their __Host- prefix', () => {
    /*
     * Both are one-time, in-flight state. A user who is mid sign-up when the
     * deploy lands holds the old cookie and the new code looks for the new
     * name - so the flow fails for exactly the people who were using it at
     * that moment. The __Host- prefix is a security property, not a brand one.
     */
    const consts = read('shared/const.ts');
    expect(consts).toContain('"__Host-buildhub_return_to"');
    expect(consts).toContain('"__Host-buildhub_signup_username"');
  });
});

/**
 * ── WHY THIS BLOCK PARSES THE BLUEPRINT INSTEAD OF GREPPING IT ──────────
 *
 * It used to read:
 *
 *   expect(yaml).toContain('name: buildhub-staging');
 *   expect(yaml).toContain('name: buildhub-staging-mysql');
 *
 * and the first of those COULD NEVER FAIL while the second passed, because
 * "name: buildhub-staging" is a substring of "name: buildhub-staging-mysql".
 * The assertion that read as though it pinned the web service was satisfied
 * by the line below it, so a complete web-service rename - the declaration
 * and the `fromService` self-reference both - left all three green. That was
 * proven by mutation before it was replaced.
 *
 * The invariants themselves live in _testing/blueprintInvariants.ts so that
 * blueprintGuardMutation.test.ts can exercise THE SAME predicates rather than
 * a restatement of them. A mutation test that re-implements what it tests
 * proves only that two copies agree.
 */

describe('deployment identity survives the rebrand', () => {
  const blueprint = parseBlueprint(read('render.yaml'));

  for (const invariant of BLUEPRINT_INVARIANTS) {
    it(invariant.name, () => invariant.check(blueprint));
  }
});

describe('stored values survive the rebrand', () => {
  it("the compliance provenance discriminant is still 'buildhub_policy'", () => {
    /*
     * This is a VALUE, not a label. It separates a requirement imposed by a
     * government from one imposed by the platform - the distinction the owner
     * required compliance to make. It is written into rows. Renaming the
     * constant without migrating them leaves requirements whose provenance no
     * longer matches any known kind, and the safe reading of an unknown
     * provenance is "unverified, blocked".
     */
    expect(read('shared/complianceAuthority.ts')).toContain("'buildhub_policy'");
  });
});

describe('migration history is immutable', () => {
  /*
   * Drizzle records what it has applied by filename and hash. Editing an
   * applied migration - even to change a comment - makes the deployed database
   * and the repository disagree about what ran, with no mechanism to
   * reconcile them. There is no customer-visible string in here at all: it is
   * SQL and table names.
   */
  it('no applied migration mentions the new brand', () => {
    const dir = join(ROOT, 'drizzle');
    const offenders = readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .filter(f => /rakiza/i.test(readFileSync(join(dir, f), 'utf8')));
    expect(offenders, 'a migration was edited for branding').toEqual([]);
  });

  it('the journal still lists every migration file on disk', () => {
    const journal = JSON.parse(read('drizzle/meta/_journal.json')) as {
      entries: { tag: string }[];
    };
    const onDisk = new Set(
      readdirSync(join(ROOT, 'drizzle')).filter(f => f.endsWith('.sql')).map(f => f.replace(/\.sql$/, '')),
    );
    for (const entry of journal.entries) {
      expect(onDisk.has(entry.tag), `${entry.tag} is journalled but missing`).toBe(true);
    }
    expect(journal.entries.length, 'a migration was removed from the journal')
      .toBe(onDisk.size);
  });
});

describe('the domain is NOT migrated by this release', () => {
  it('the canonical origin is unchanged', () => {
    /*
     * Owner directive §10: brand migration and domain migration are separate
     * releases. Pointing canonical URLs, OAuth callbacks and CORS at a host
     * that does not resolve is an outage, and doing it "because the brand
     * changed" is how it happens without anyone deciding to.
     *
     * This asserts the CURRENT state so that changing it has to be a decision.
     * When the domain does move, this assertion moves with the DNS, not before.
     */
    expect(read('shared/seo.ts')).toContain('buildhub.eg');
  });
});

/**
 * ── THE CENSUS: NO ENGLISH SURFACE STILL SAYS BUILDHUB ──────────────────
 *
 * R3 migrated 69 string literals in the client, 21 in shared and 107 in the
 * server. What stops the 198th from coming back is this, not memory.
 *
 * LINE-BASED ON PURPOSE. An earlier pass used a hand-written segmenter to tell
 * code from string from comment, and it did not know that a regex literal can
 * contain a quote character. `/Building2\s+className="w-[45] h-[45]/` put it
 * into string mode and it silently rewrote a regex inside a NEGATIVE assertion,
 * inverting what that assertion tested — and the inverted test still passed.
 * It also desynchronised in the other direction and MISSED two real strings,
 * one of them a customer-visible validation message in routers.ts.
 *
 * That was found by reading the diff. This guard is deliberately dumber than
 * the thing that got it wrong: it reads lines, and the only cleverness is
 * stripping comments with the shared reader the rest of the suite uses.
 */
describe('no English customer surface still carries the old brand', () => {
  const ARABIC = /[؀-ۿ]/;
  /* A line naming one of these is about an IDENTIFIER, not about the brand. */
  const FROZEN = [
    'buildhub_lang', 'buildhub_policy', '__Host-buildhub', 'buildhub-source-of-truth',
    'buildhub-staging', 'BUILDHUB_', 'buildhub.eg', 'buildhubKnowledge', 'buildhub.test',
    'BuildHubRole', 'BUILDHUB_ROLES', 'isBuildHubRole', 'buildhubSpecific',
  ];

  function walkTs(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walkTs(full, out);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  const FILES = [
    ...walkTs(join(ROOT, 'client/src')),
    ...walkTs(join(ROOT, 'shared')),
    ...walkTs(join(ROOT, 'server')),
  ].filter(f => !f.endsWith('brandSystem.test.ts') && !f.endsWith('brandGuards.test.ts'));

  function offenders(predicate: (line: string) => boolean) {
    const found: string[] = [];
    for (const file of FILES) {
      const stripped = readSourceForAssertions(readFileSync(file, 'utf8'));
      stripped.split('\n').forEach((line, i) => {
        if (!/BuildHub|BUILDHUB/.test(line)) return;
        if (FROZEN.some(f => line.includes(f))) return;
        /* A line naming BOTH brands is deliberately about the transition - a
           detector that must keep catching the old name, or a routing cue that
           still has to understand what people used to call the product. */
        if (/Rakiza|RAKIZA|rakiza/.test(line)) return;
        if (!predicate(line)) return;
        found.push(`${file.slice(ROOT.length + 1)}:${i + 1}  ${line.trim().slice(0, 110)}`);
      });
    }
    return found;
  }

  it('no line of English code or copy names BuildHub', () => {
    expect(offenders(line => !ARABIC.test(line))).toEqual([]);
  });

  it('no Arabic line names the old brand either', () => {
    /*
     * R4 CLOSED THIS. It was a counted exemption at 56 while the Arabic was
     * hand-reviewed, because Arabic agreement is grammatical rather than
     * lexical: "يرسل BuildHub" treats the brand as a masculine token, and
     * ركيزة is feminine, so the VERB has to change too - "ترسل ركيزة". A
     * scripted swap would have left a trail of wrong agreement that nobody
     * reading English would ever see.
     *
     * Three strings were rebuilt rather than patched: the hero line, which
     * moved to verb-first order as Arabic prefers; the notification
     * preference line, where the relative clause had to re-agree; and the AI
     * assistant's greeting, because "Rakiza AI" has no natural Arabic reading
     * as a bare name.
     *
     * The old transliteration بيلد هَب / بيلدهَب is gone with it.
     */
    expect(offenders(line => ARABIC.test(line))).toEqual([]);
  });

  it('the retired Arabic transliteration is gone everywhere', () => {
    // It was never the brand; it was the English name spelled in Arabic
    // letters. ركيزة is a real Arabic word, which is the point of it.
    const found: string[] = [];
    for (const file of FILES) {
      const stripped = readSourceForAssertions(readFileSync(file, 'utf8'));
      if (/بيلد\s?هَب/.test(stripped)) found.push(file.slice(ROOT.length + 1));
    }
    expect(found, 'the old Arabic transliteration survives').toEqual([]);
  });
});
