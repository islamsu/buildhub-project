// ── A LIST THAT STOPS WITHOUT SAYING SO ────────────────────────────────────
//
// `.limit(250)` on a list, with no offset and no count, is not a bounded read -
// it is a SILENT TRUNCATION. It has bitten this codebase three times:
// `admin.users` (P0-3), `admin.disputes` (DSP-6), and then `products`,
// `projects`, `placements` and `vendorNameChanges` all at once, each with a
// client that searched the truncated result in the browser and answered "no
// matching rows" with total confidence.
//
// This finds the shape from source and holds it against a written-down list of
// the reads that are bounded BY NATURE rather than by truncation.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const ROUTERS_RAW = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');

/**
 * THE CENSUS READS CODE, NOT PROSE.
 *
 * Comments are stripped first. This file's own explanation of a defect quotes
 * the `.limit(50)` it replaced, and the first version of the census read that
 * quotation as the defect itself - reporting a procedure that had just been
 * paged. An instrument that cannot tell a fix from its description is worse
 * than none, because the false report costs the trust the true ones need.
 *
 * Line lengths are preserved so an offset into this text still lands in the
 * same place as the original.
 */
const ROUTERS = ROUTERS_RAW
  .replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (all, lead) => lead + ' '.repeat(all.length - lead.length));

/**
 * A limit this large is a truncation guess, not a business rule.
 *
 * Below it, a limit is a deliberate cap on something whose size is known and
 * small - the ten most recent of something, a single row. Above it, somebody
 * picked a round number they hoped was big enough, which is precisely the
 * judgement that has been wrong three times.
 */
const TRUNCATION_THRESHOLD = 50;

/**
 * READS WHOSE SIZE IS BOUNDED BY THE DOMAIN, not by a hopeful number.
 *
 * Each entry says why the bound cannot be exceeded in practice. This is not a
 * place to park a list somebody has not got round to paging - a growing table
 * does not belong here however slowly it grows.
 */
const BOUNDED_BY_NATURE: Record<string, string> = {
  'disputes.get':
    'The messages and evidence of ONE dispute, capped at 200 and 100. A dispute is a '
    + 'conversation between two named people about one thing, and the whole of it is what '
    + 'the page exists to show - there is no page 2 of an argument.',
  'admin.complianceApplicant':
    'The registration documents of ONE applicant, capped at 100. An applicant uploads a '
    + 'handful of documents once; the reviewer needs all of them on the screen at once.',
  'admin.enquiryNotes':
    'The notes on ONE enquiry, capped at 100. Written by administrators by hand, one at a '
    + 'time, on a single enquiry that is worked and closed.',
  'admin.accountAudit':
    'The audit trail of ONE account, capped at 100, inside that account\'s own dialog. It is '
    + 'read while looking at that person, not browsed.',
  'admin.userNotes':
    'The notes on ONE user, capped at 100. Written by administrators by hand, one at a time.',
  'admin.testLoginLinks':
    'QA login links. They exist only in non-production environments, are issued by hand one '
    + 'at a time, and are revoked rather than accumulated.',
  'admin.fullAuditReport':
    'The 1000 most recent account events, presented as a recent-activity feed on the '
    + 'operations screen. It is explicitly the latest N; the per-account trail is the view '
    + 'that answers a question about one person.',
  'notifications.list':
    'The 50 most recent notifications, which is what a notification bell shows. It is a '
    + 'feed, not an index. This becomes a truncation the day BuildHub gains a notifications '
    + 'archive page, and it should be paged then.',
  'profile.myVendorNameChanges':
    'A vendor\'s own name-change requests, capped at 50. Each one is reviewed by an '
    + 'administrator before another is useful, so the count is bounded by the process.',
};

/**
 * Every `name: procedure` in routers.ts, with its body.
 *
 * The body ends where its DELIMITERS BALANCE, not at the next line that looks
 * like a procedure. The first version used the latter and reported five false
 * positives - `admin.addUserNote`, `auth.updateRole` and others whose bodies
 * ran on into a neighbour's `.limit()`. A census that cries wolf fills its own
 * declaration list with noise, which is how an exemption list stops being read.
 */
function procedures(): Array<{ name: string; namespace: string; body: string }> {
  const found: Array<{ name: string; namespace: string; body: string }> = [];
  const re = /^  ([a-zA-Z_]\w*):\s*(adminWith|protectedProcedure|publicProcedure|approvedProviderProcedure)/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(ROUTERS)) !== null) {
    // Walk from the start of the value until parens and braces balance and the
    // chain ends - that is the whole procedure and nothing after it.
    let depth = 0;
    let i = match.index + match[0].length;
    let end = i;
    for (; i < ROUTERS.length; i++) {
      const ch = ROUTERS[i];
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          // The chain may continue: `.input(...).query(...)`. Keep going while
          // the next non-space character starts another call.
          const after = /^\s*\.[a-zA-Z]/.exec(ROUTERS.slice(i + 1));
          if (!after) { end = i + 1; break; }
        }
        if (depth < 0) { end = i; break; }
      }
    }
    found.push({
      name: match[1],
      namespace: namespaceOf(match.index),
      body: ROUTERS.slice(match.index, end || match.index + 4000),
    });
  }
  return found;
}

/** Which router a position sits inside - the nearest declaration above it. */
function namespaceOf(position: number): string {
  const before = ROUTERS.slice(0, position);
  const all = [...before.matchAll(/const (\w+)Router = router\(\{/g)];
  return all.length > 0 ? all[all.length - 1][1] : 'unknown';
}

function silentTruncations(): string[] {
  const offenders: string[] = [];
  for (const { name, namespace, body } of procedures()) {
    for (const m of body.matchAll(/\.limit\((\d+)\)/g)) {
      const size = Number(m[1]);
      if (size < TRUNCATION_THRESHOLD) continue;
      // A limit beside an offset is a page, not a truncation.
      if (/\.offset\(/.test(body)) continue;
      offenders.push(`${namespace}.${name}`);
      break;
    }
  }
  return [...new Set(offenders)].sort();
}

describe('the truncation census reads what is actually there', () => {
  it('finds procedures and their bodies', () => {
    const all = procedures();
    expect(all.length).toBeGreaterThan(150);
    expect(all.map(p => p.name)).toEqual(expect.arrayContaining(['users', 'disputes', 'products']));
  });

  /*
   * THE INSTRUMENT IS PROVEN AGAINST A KNOWN CASE before its silence is
   * trusted: `admin.users` and `admin.disputes` were both truncating and both
   * now page, so both must be absent - and a body with a bare large limit must
   * be detected.
   */
  it('recognises a paged read and a truncating one apart', () => {
    // Both of these page - `users` inline, `disputes` through a service - so
    // neither may be reported, and the census must say so for the right reason.
    expect(silentTruncations()).not.toContain('admin.users');
    expect(silentTruncations()).not.toContain('admin.disputes');
    const users = procedures().find(p => p.name === 'users')!;
    expect(users.body).toMatch(/pageSize/);
  });

  /*
   * AND IT MUST NOT READ A COMMENT AS CODE. This is the mutation that caught
   * the stripper being absent: a procedure whose comment quotes the limit it
   * replaced was reported as still having it.
   */
  it('ignores a limit that appears only inside a comment', () => {
    const directory = procedures().find(p => p.name === 'directory');
    expect(directory, 'projects.directory not found').toBeTruthy();
    expect(directory!.body, 'the comment quoting `.limit(50)` was not stripped')
      .not.toMatch(/\.limit\(50\)/);
    expect(silentTruncations()).not.toContain('projects.directory');
  });
});

describe('no administration list stops without saying so', () => {
  it('every large unpaged limit is one whose size the domain bounds', () => {
    const undeclared = silentTruncations().filter(name => !(name in BOUNDED_BY_NATURE));
    expect(
      undeclared,
      'These read a large fixed number of rows with no offset and no total, so the screen '
      + 'cannot tell a short list from a truncated one. Page them with server/adminList.ts, '
      + 'or declare in BOUNDED_BY_NATURE why the size cannot exceed the limit:\n  '
      + undeclared.join('\n  '),
    ).toEqual([]);
  });

  it('and nothing is declared that is not actually doing it', () => {
    const actual = new Set(silentTruncations());
    const stale = Object.keys(BOUNDED_BY_NATURE).filter(name => !actual.has(name));
    expect(
      stale,
      'Declared as bounded-by-nature but no longer reads that way - remove them:\n  ' + stale.join('\n  '),
    ).toEqual([]);
  });

  it('every declaration gives a reason, not a shrug', () => {
    for (const [name, reason] of Object.entries(BOUNDED_BY_NATURE)) {
      expect(reason.length, `${name} has no real reason`).toBeGreaterThan(60);
    }
  });
});

describe('the pager makes the count and the rows agree by construction', () => {
  it('a caller supplies the filter once, and cannot apply it to only one of them', () => {
    const helper = readFileSync(new URL('./adminList.ts', import.meta.url), 'utf8');
    // The single `where` reaches both queries inside adminPage.
    expect(helper).toContain('const [totalRow] = where ? await countQuery.where(where) : await countQuery;');
    expect(helper).toContain('const rows = await (where ? rowsQuery.where(where) : rowsQuery)');
    // And the page size is clamped, so a caller cannot ask for the whole table.
    expect(helper).toContain('Math.min(ADMIN_PAGE_SIZE_MAX');
  });

  /*
   * An empty filter list must be `undefined`, not `and()`. Drizzle renders a
   * bare `and()` as SQL matching nothing, so an unfiltered list would come back
   * empty and read as "there is nothing here" - the confident wrong answer this
   * whole file exists to remove.
   */
  it('no filters means no where clause, not a where clause that matches nothing', async () => {
    const { allOf } = await import('./adminList');
    const and = (...parts: unknown[]) => ({ and: parts });
    expect(allOf(and, [])).toBeUndefined();
    expect(allOf(and, [null, undefined, false])).toBeUndefined();
    expect(allOf(and, ['a'])).toEqual({ and: ['a'] });
  });
});
