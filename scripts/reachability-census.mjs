/**
 * ── WHO CAN ACTUALLY GET TO THIS? ────────────────────────────────────────
 *
 * server/reachability.test.ts already refuses a procedure with NO client
 * caller, and it walks the import graph from the entry point so a component
 * nothing renders does not count as a caller. That catches the loudest case.
 *
 * It does not catch the quieter one the owner named: a capability whose only
 * caller sits behind a door no real role can open. A procedure with a caller,
 * a button and a permission nobody holds is unreachable in exactly the way
 * that matters, and it passes every existing check.
 *
 * So this walks the same import graph and then asks, for every procedure,
 * WHICH ROLE'S SCREENS lead to the file that calls it.
 *
 * WHAT IT CANNOT DECIDE, and does not pretend to: whether the control inside
 * that file is rendered, enabled and clickable for that role. Static analysis
 * cannot answer that, and a census that claimed to would be the "grep sees
 * import" reasoning the directive rules out. This produces the SHORTLIST;
 * anything it flags is confirmed in a real browser before it is called a
 * finding.
 */
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT = 'client/src/';
const ROUTERS = readFileSync('server/routers.ts', 'utf8');

/** Files the application actually reaches, and how it got to each. */
function importGraph() {
  const parents = new Map();
  const resolve = (from, spec) => {
    let base;
    if (spec.startsWith('@/')) base = join(CLIENT, spec.slice(2));
    else if (spec.startsWith('.')) base = join(from, '..', spec);
    else return null;
    for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
      try { if (statSync(c).isFile()) return c; } catch { /* not this one */ }
    }
    return null;
  };
  const visit = (path, from) => {
    if (parents.has(path)) { if (from) parents.get(path).add(from); return; }
    parents.set(path, new Set(from ? [from] : []));
    let text;
    try { text = readFileSync(path, 'utf8'); } catch { return; }
    for (const m of text.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g)) {
      const next = resolve(path, m[1]);
      if (next) visit(next, path);
    }
  };
  for (const entry of ['main.tsx', 'App.tsx']) visit(join(CLIENT, entry), null);
  return parents;
}

const parents = importGraph();

/**
 * Every route the app declares, and the page component behind it.
 *
 * WRAPPERS ARE FOLLOWED. `/products/new` renders `NewProductPage`, a one-line
 * local function that renders `<ProductFormPage mode="create" />`. Mapping a
 * route to a component NAME and stopping there reported the product form as
 * unreachable - and a marketplace where suppliers cannot list anything would
 * be a P0, so a census that invents one is worse than no census. The first
 * version of this file did exactly that.
 */
const APP = readFileSync(join(CLIENT, 'App.tsx'), 'utf8');
const WRAPPERS = new Map(
  [...APP.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*\{[\s\S]{0,400}?return\s*\(?\s*<(\w+)/g)]
    .map(m => [m[1], m[2]]),
);
const unwrap = name => {
  const seen = new Set();
  let current = name;
  while (WRAPPERS.has(current) && !seen.has(current)) { seen.add(current); current = WRAPPERS.get(current); }
  return current;
};
const ROUTES = [...APP.matchAll(/path=\{?["'`]([^"'`]+)["'`]\}?\s+component=\{(\w+)\}/g)]
  .map(m => ({ path: m[1], component: unwrap(m[2]), declaredAs: m[2] }));

/** Which page files a file is reachable from, by walking parents upward. */
function pagesReaching(path, seen = new Set()) {
  if (seen.has(path)) return new Set();
  seen.add(path);
  const out = new Set();
  if (path.includes('/pages/')) out.add(path);
  for (const parent of parents.get(path) ?? []) {
    for (const p of pagesReaching(parent, seen)) out.add(p);
  }
  return out;
}

/** The procedures each reached file calls. */
const callers = new Map();
for (const path of parents.keys()) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { continue; }
  for (const m of text.matchAll(/(?:trpc|utils)(?:\.useUtils\(\))?\.([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)/g)) {
    const key = `${m[1]}.${m[2]}`;
    if (!callers.has(key)) callers.set(key, new Set());
    callers.get(key).add(path);
  }
}

/** Every procedure the server declares, with the tier that guards it. */
function procedures() {
  const out = [];
  const nsRe = /^const (\w+)Router = router\(\{$/gm;
  const namespaces = [...ROUTERS.matchAll(nsRe)].map(m => m[1]);
  for (const ns of namespaces) {
    const start = ROUTERS.indexOf(`const ${ns}Router = router({`);
    const end = ROUTERS.indexOf('\n});', start);
    const body = ROUTERS.slice(start, end);
    for (const m of body.matchAll(/^\s{2}(\w+):\s*(adminWith\([^)]*\)|superAdminProcedure|adminProcedure|protectedProcedure|publicProcedure|approvedProviderProcedure|complianceProcedure|\w+Procedure)/gm)) {
      out.push({ ns, name: m[1], tier: m[2] });
    }
  }
  return out;
}

const ALL = procedures();
const rows = ALL.map(p => {
  const key = `${p.ns}.${p.name}`;
  const files = [...(callers.get(key) ?? [])];
  const pages = new Set();
  for (const f of files) for (const page of pagesReaching(f)) pages.add(page);
  const routed = [...pages].map(page => {
    const base = page.split('/').pop().replace(/\.tsx?$/, '');
    return ROUTES.filter(r => r.component === base).map(r => r.path);
  }).flat();
  return { key, tier: p.tier, files: files.length, pages: [...pages].length, routes: [...new Set(routed)] };
});

const unrouted = rows.filter(r => r.files > 0 && r.routes.length === 0);
const uncalled = rows.filter(r => r.files === 0);

console.log(`procedures=${rows.length} called=${rows.length - uncalled.length} uncalled=${uncalled.length}`);
console.log(`\nCALLED BUT NO ROUTE REACHES THE CALLER (${unrouted.length}) - the shortlist:`);
for (const r of unrouted) console.log(`  ${r.key.padEnd(46)} ${r.tier}`);
console.log(`\nNO CLIENT CALLER (${uncalled.length}):`);
for (const r of uncalled) console.log(`  ${r.key.padEnd(46)} ${r.tier}`);

/**
 * ── THE QUIETER CLASS: A VALUE COMPUTED AND NEVER SHOWN ──────────────────
 *
 * A procedure with a caller can still return a field nothing reads. That is
 * how `adminAttention` came to compute a name-change count that no screen
 * rendered, and how `projects.spent` came to be accepted by an endpoint no UI
 * ever sent. Both looked like working features and neither was reachable.
 *
 * This reads the literal `return { ... }` shapes in routers.ts and asks
 * whether any REACHED client file mentions each key by name.
 *
 * IT IS A SHORTLIST, NOT A VERDICT, and deliberately so. A key reached
 * through a spread, a rename in a destructure, or a generic table renderer
 * will show up here and be fine. The value is that the list is SHORT enough
 * to read, and the dangerous class has always been in it.
 */
/*
 * CLIENT FILES ONLY. The import graph legitimately reaches OUT of client/src -
 * `lib/trpc.ts` imports the AppRouter TYPE from server/routers.ts - so the
 * naive version of this concatenated the server's own source into "what the
 * client mentions". Every field then matched its own declaration and the
 * census reported zero findings forever.
 *
 * Caught by planting a field nothing reads and watching the census not see
 * it. A census that has never been shown to detect the thing it looks for is
 * not evidence of anything.
 */
const CLIENT_TEXT = [...parents.keys()]
  .filter(f => f.startsWith(CLIENT))
  .map(f => { try { return readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');

/** Keys of the literal object a procedure returns, where it returns one. */
function returnedKeys(ns, name) {
  const anchor = new RegExp(`^\\s{2}${name}:\\s`, 'm');
  const start = ROUTERS.search(anchor);
  if (start === -1) return [];
  // The body ends where the next sibling procedure begins.
  const rest = ROUTERS.slice(start + 1);
  const nextAt = rest.search(/^\s{2}\w+:\s*(adminWith\(|superAdminProcedure|adminProcedure|protectedProcedure|publicProcedure|approvedProviderProcedure|complianceProcedure)/m);
  const body = nextAt === -1 ? rest.slice(0, 4000) : rest.slice(0, nextAt);
  const keys = new Set();
  for (const m of body.matchAll(/return \{([^}]{0,600})\}/g)) {
    for (const k of m[1].matchAll(/(?:^|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*[:,]/g)) keys.add(k[1]);
  }
  return [...keys];
}

const NOISE = new Set(['ok', 'success', 'id', 'count', 'total', 'rows', 'page', 'pageSize', 'data']);
const unread = [];
for (const p of ALL) {
  const key = `${p.ns}.${p.name}`;
  if (!callers.has(key)) continue;
  for (const field of returnedKeys(p.ns, p.name)) {
    if (NOISE.has(field)) continue;
    if (!new RegExp(`\\b${field}\\b`).test(CLIENT_TEXT)) unread.push(`${key}.${field}`);
  }
}
console.log(`\nRETURNED BUT NEVER MENTIONED CLIENT-SIDE (${unread.length}) - investigate each:`);
for (const u of unread) console.log(`  ${u}`);
