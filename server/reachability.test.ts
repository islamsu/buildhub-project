// ── A PROCEDURE NOBODY CALLS IS NOT IN THE PRODUCT ─────────────────────────
//
// 26 procedures had no client caller, and they were three different things
// wearing the same face: a referral engine that could never fire, a dispute
// list users could not read, superseded readers nobody deleted, and a handful
// of capabilities that are deliberately unreachable. Undistinguished, the real
// defects hid among the deliberate ones.
//
// This computes the set FROM SOURCE on every run and holds it against
// server/reachability.ts. A new procedure with no caller fails here until
// somebody wires it, deletes it, or writes down why. A declared one that gains
// a caller fails too, so the reasons cannot go stale.

import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UNCALLED_BY_DESIGN, UNCALLED_PROCEDURES } from './reachability';

const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
const CLIENT_DIR = new URL('../client/src/', import.meta.url).pathname;

/** The namespaces the appRouter actually exposes, and the variable behind each. */
function namespaces(): Array<[string, string]> {
  const start = ROUTERS.indexOf('export const appRouter = router({');
  const body = ROUTERS.slice(start, ROUTERS.indexOf('\n});', start));
  return [...body.matchAll(/^\s{2}(\w+):\s*(\w+),/gm)].map(match => [match[1], match[2]]);
}

/** One router's own procedure names, read from its balanced body. */
function proceduresIn(variableName: string): string[] {
  const start = ROUTERS.indexOf(`const ${variableName} = router({`);
  if (start === -1) return [];
  let depth = 0, end = -1;
  for (let i = ROUTERS.indexOf('{', start); i < ROUTERS.length; i++) {
    if (ROUTERS[i] === '{') depth++;
    else if (ROUTERS[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = ROUTERS.slice(start, end);
  return [...new Set([...body.matchAll(/^\s{2}(\w+):\s*(?:[A-Za-z]\w*)/gm)].map(m => m[1]))];
}

/**
 * ── FILES THE APP ACTUALLY REACHES ─────────────────────────────────────────
 *
 * A component that exists in the tree but nothing renders is not in the
 * product, and neither are the procedures it calls. The first version of this
 * census read EVERY file under client/src, so deleting a component's only
 * `<MyActivity />` still left its `trpc.audit.mine` counted as reachable - the
 * guard passed on exactly the defect it exists to catch, and a mutation proved
 * it. This walks the import graph from the entry point instead.
 *
 * `/admin/admins` was reachable by URL and by nothing else for the whole of
 * this product's life. A census that counts unreferenced files repeats that.
 */
function reachableFiles(): string[] {
  const seen = new Set<string>();
  const resolve = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith('@/')) base = join(CLIENT_DIR, spec.slice(2));
    else if (spec.startsWith('.')) base = join(from, '..', spec);
    else return null; // a package, or @shared - neither calls trpc
    for (const candidate of [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
      try { if (statSync(candidate).isFile()) return candidate; } catch { /* not this one */ }
    }
    return null;
  };
  const visit = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    const text = readFileSync(path, 'utf8');
    for (const m of text.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g)) {
      const next = resolve(path, m[1]);
      if (next) visit(next);
    }
  };
  for (const entry of ['main.tsx', 'App.tsx']) {
    try { visit(join(CLIENT_DIR, entry)); } catch { /* entry point moved */ }
  }
  return [...seen];
}

/** Every `trpc.x.y` and `utils.x.y` a REACHED client file mentions. */
function calledByClient(): Set<string> {
  const called = new Set<string>();
  for (const path of reachableFiles()) {
    const text = readFileSync(path, 'utf8');
    for (const m of text.matchAll(/(?:trpc|utils)(?:\.useUtils\(\))?\.([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)/g)) {
      called.add(`${m[1]}.${m[2]}`);
    }
  }
  return called;
}

function uncalled(): string[] {
  const called = calledByClient();
  const dead: string[] = [];
  for (const [ns, variableName] of namespaces()) {
    for (const name of proceduresIn(variableName)) {
      if (!called.has(`${ns}.${name}`)) dead.push(`${ns}.${name}`);
    }
  }
  return dead.sort();
}

describe('the reachability census reads what is actually there', () => {
  /*
   * THE INSTRUMENT IS CHECKED BEFORE ITS OUTPUT IS TRUSTED. A census that
   * silently found no namespaces would report every procedure as reachable and
   * pass forever.
   */
  it('finds the routers and their procedures', () => {
    const found = namespaces();
    expect(found.length).toBeGreaterThan(8);
    expect(found.map(([ns]) => ns)).toEqual(expect.arrayContaining(['auth', 'admin', 'disputes', 'billing']));
    expect(proceduresIn('disputesRouter')).toEqual(expect.arrayContaining(['myDisputes', 'create', 'get']));
  });

  it('reaches the app from its entry point, not by scanning the folder', () => {
    const files = reachableFiles();
    expect(files.length).toBeGreaterThan(50);
    expect(files.some(path => path.endsWith('App.tsx'))).toBe(true);
    // A page only the router names is reached; nothing outside the graph is.
    expect(files.some(path => path.endsWith('MyDisputes.tsx'))).toBe(true);
  });

  it('finds the calls the client makes', () => {
    const called = calledByClient();
    expect(called.size).toBeGreaterThan(80);
    // Things this session wired, which must show up as called.
    expect(called).toContain('disputes.myDisputes');
    expect(called).toContain('admin.disputeDetail');
    expect(called).toContain('rfq.declineInvitation');
  });
});

describe('every procedure is wired, deleted, or declared', () => {
  it('has no procedure that is dead and undeclared', () => {
    const undeclared = uncalled().filter(name => !UNCALLED_PROCEDURES.includes(name));
    expect(
      undeclared,
      'These procedures have no client caller. Wire one, delete the procedure, or '
      + 'add it to UNCALLED_BY_DESIGN in server/reachability.ts with the reason:\n  '
      + undeclared.join('\n  '),
    ).toEqual([]);
  });

  /*
   * AND THE DECLARATION CANNOT GO STALE. A declared procedure that has since
   * been wired, or removed, is a reason describing something that is no longer
   * true - which is worse than no reason, because it is read as current.
   */
  it('declares nothing that is already wired or already gone', () => {
    const dead = new Set(uncalled());
    const stale = UNCALLED_PROCEDURES.filter(name => !dead.has(name));
    expect(
      stale,
      'These are declared as having no caller, but do not: remove them from '
      + 'UNCALLED_BY_DESIGN.\n  ' + stale.join('\n  '),
    ).toEqual([]);
  });

  it('and every declaration says why, at more than a shrug', () => {
    for (const entry of UNCALLED_BY_DESIGN) {
      expect(entry.reason.length, `${entry.procedure} has no real reason`).toBeGreaterThan(60);
    }
    // No duplicates - two reasons for one procedure means one of them is wrong.
    expect(new Set(UNCALLED_PROCEDURES).size).toBe(UNCALLED_PROCEDURES.length);
  });
});
