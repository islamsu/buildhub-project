#!/usr/bin/env node
/**
 * ── The repository's inventory of itself ────────────────────────────────────
 *
 * Every previous audit worked from a list somebody typed. A typed list is a
 * claim about the code; this is a reading of it. Routes, procedures, tables,
 * notification writers and upload endpoints are all derived from the source at
 * the moment it runs, so a new route that nobody documented shows up here on
 * its own, and a route somebody deleted stops showing up.
 *
 * It also carries ONE invariant rather than being a pure listing, because a
 * listing nobody checks rots into decoration:
 *
 *   A route that declares a :param whose component never reads a param is a
 *   DEAD PARAM ROUTE.
 *
 * That is not a style rule. /marketplace/vendors/:id rendered the whole vendor
 * directory and silently dropped the id, so a link to one vendor delivered a
 * page listing all of them - a control that appears to work and does not. The
 * invariant is what catches the next one.
 *
 * Writes docs/inventory.json (machine, read by server/inventory.test.ts) and
 * docs/INVENTORY.md (human). Run: node scripts/inventory.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * Component -> source file. Both spellings are real in App.tsx: the lazy ones
 * and the two eager imports that were deliberately left eager.
 */
function componentSources(app) {
  const map = {};
  for (const m of app.matchAll(/const (\w+) = lazy\(\(\) => import\("([^"]+)"\)\)/g)) {
    map[m[1]] = m[2];
  }
  for (const m of app.matchAll(/^import (\w+) from "([^"]+\/pages\/[^"]+)"/gm)) {
    map[m[1]] = m[2];
  }
  return map;
}

function resolveSource(spec) {
  const cleaned = spec.replace(/^@\//, 'client/src/').replace(/^\.\//, 'client/src/');
  for (const ext of ['.tsx', '.ts']) {
    if (existsSync(join(ROOT, cleaned + ext))) return cleaned + ext;
  }
  return null;
}

/**
 * Does this component read a route parameter?
 *
 * wouter offers several ways and the codebase uses more than one, so this
 * accepts any of them rather than pinning a single idiom: useParams(),
 * useRoute() (which returns [match, params]), or the params prop wouter passes
 * to a route component.
 *
 * The generic argument is load-bearing here, not decoration. The codebase
 * writes `useParams<{ id: string }>()`, so a naive `useParams\s*\(` matches
 * nothing and reports every working detail page as dead. The first run of this
 * script flagged /vendor/:id, /rfq/:id, /projects/:id and
 * /marketplace/products/:id - four pages that were live-verified working -
 * which is how the bug surfaced. `<[^>]*>` optionally absorbs the type
 * argument.
 *
 * `window.location.pathname` counts, and that case is worth naming.
 * /platform/:role does NOT trust its own parameter: RolePlatform derives the
 * role from the authenticated account and reads the pathname only to detect a
 * mismatch, so a homeowner typing /platform/admin gets their own workspace.
 * That is the correct design, not a dead route - the param is consulted and
 * deliberately overruled. A detector that cannot see the difference would push
 * somebody to "fix" a security property.
 */
const READS_PARAM = /useParams\s*(<[^>]*>)?\s*\(|useRoute\s*(<[^>]*>)?\s*\(|\bparams\s*[.[]|\{\s*params\s*\}|props\.params|window\.location\.pathname/;

/**
 * The body of a component declared inside App.tsx, from `function Name(` to the
 * next top-level `}`. Crude but sufficient: these inline components are a few
 * lines each, and the only question asked of the text is whether it reads a
 * route param.
 */
function extractComponent(app, name) {
  const start = app.indexOf(`function ${name}(`);
  if (start === -1) return null;
  const end = app.indexOf('\n}', start);
  return end === -1 ? app.slice(start) : app.slice(start, end + 2);
}

function routes() {
  const app = read('client/src/App.tsx');
  const sources = componentSources(app);
  const out = [];
  for (const m of app.matchAll(/<Route path=\{?"([^"]+)"\}?\s+component=\{(\w+)\}/g)) {
    const [, path, component] = m;
    // A route component is usually an imported page, but not always: small
    // ones (RedirectToVendor, NotFound) are declared in App.tsx itself. Falling
    // back to App.tsx's own body matters - without it every inline component
    // resolves to no source, reads no param by definition, and is reported as
    // dead. That is how RedirectToVendor, whose entire job is reading the
    // param, appeared in the dead list the moment it was added.
    const src = sources[component] ? resolveSource(sources[component]) : null;
    const body = src ? read(src) : extractComponent(app, component);
    const declaresParam = /:\w+/.test(path);
    const readsParam = body ? READS_PARAM.test(body) : false;
    out.push({
      path,
      component,
      source: src,
      declaresParam,
      readsParam,
      deadParamRoute: declaresParam && !readsParam,
    });
  }
  return out;
}

// ── Server procedures ───────────────────────────────────────────────────────

/**
 * Procedure name -> the base procedure it is built on, which IS its
 * authorization tier. Read from the router source so a procedure that quietly
 * drops from protectedProcedure to publicProcedure is visible as a diff here.
 */
function procedures() {
  const src = read('server/routers.ts');
  const out = [];
  // TWO SHAPES, because the first version knew only one and the census was
  // wrong for it.
  //
  //   name: adminProcedure          a named base procedure
  //   name: adminWith('billing.manage')   a permission-scoped admin procedure
  //
  // Matching only the first hid EVERY adminWith procedure - the whole vendor
  // billing surface, marketplace moderation, support and audit reads - from an
  // inventory whose entire purpose is to show what exists and at what
  // authorization tier. An authorization census with a silent hole in it is
  // worse than no census, because it is trusted.
  //
  // For the second shape the permission IS the tier, and naming it is strictly
  // more informative than a bare `adminProcedure` would have been.
  const re = /^(\s+)(\w+):\s*(?:(\w*[Pp]rocedure)\b|adminWith\(\s*'([^']+)'\s*\))/gm;
  for (const m of src.matchAll(re)) {
    out.push({ name: m[2], tier: m[3] ?? `adminWith:${m[4]}`, indent: m[1].length });
  }
  return out;
}

function tiers(procs) {
  const counts = {};
  for (const p of procs) counts[p.tier] = (counts[p.tier] ?? 0) + 1;
  return counts;
}

// ── Database ────────────────────────────────────────────────────────────────

function tables() {
  const src = read('drizzle/schema.ts');
  const out = [];
  for (const m of src.matchAll(/export const (\w+) = mysqlTable\(\s*'([^']+)'([\s\S]*?)\n\}\)/g)) {
    const [, ident, name, body] = m;
    out.push({
      ident,
      name,
      columns: (body.match(/^\s{2}\w+:/gm) ?? []).length,
      references: (body.match(/\.references\(/g) ?? []).length,
      notNull: (body.match(/\.notNull\(\)/g) ?? []).length,
      unique: (body.match(/\.unique\(\)/g) ?? []).length,
    });
  }
  return out;
}

// ── Behavioural sites ───────────────────────────────────────────────────────

/**
 * Every place a notification is raised.
 *
 * Looking for `insert(notifications)` found ZERO sites in a product that
 * demonstrably sends notifications: they all go through the notifyUser /
 * notifyUsers helpers, which is where the bilingual rendering lives. Matching
 * the helper is matching the real event map; matching the raw insert would
 * only ever catch somebody bypassing it - so both are recorded, and a direct
 * insert is flagged, because bypassing the helper means an unlocalised
 * notification in a bilingual product.
 */
function notificationWrites() {
  const files = ['server/routers.ts', 'server/notifications.ts', 'server/workflow.ts']
    .filter(f => existsSync(join(ROOT, f)));
  const out = [];
  for (const file of files) {
    read(file).split('\n').forEach((line, i) => {
      const helper = /\bnotify(?:User|Users)\s*\(/.test(line);
      const raw = /insert\(notifications\)/.test(line);
      if (!helper && !raw) return;
      // The two inserts inside server/notifications.ts ARE notifyUser and
      // notifyUsers - the sanctioned seam, and the only place the table should
      // ever be written. Flagging them would be flagging the rule itself. The
      // violation is a raw insert anywhere else, which skips the messageKey /
      // messageParams the bilingual renderer needs.
      const via = helper
        ? 'notifyUser'
        : file === 'server/notifications.ts'
          ? 'helper implementation'
          : 'RAW INSERT - bypasses localisation';
      out.push({ file, line: i + 1, via });
    });
  }
  return out;
}

/** Upload and download surfaces, which are the ones that need storage. */
function storageSurfaces(procs) {
  return procs
    .filter(p => /^(upload|download)/i.test(p.name) || /Attachment$|Image$|Avatar$|Document$/.test(p.name))
    .map(p => ({ name: p.name, tier: p.tier }));
}

// ── Roles ───────────────────────────────────────────────────────────────────

function roles() {
  const src = read('shared/roleWorkspaceSections.ts');
  const m = src.match(/ROLE_SECTIONS: Record<WorkspaceRole, SectionId\[\]> = \{([\s\S]*?)\n\}/);
  const workspace = m ? [...m[1].matchAll(/^\s{2}(\w+):/gm)].map(x => x[1]) : [];
  return { workspace, additional: ['admin', 'anonymous'] };
}

// ── Emit ────────────────────────────────────────────────────────────────────

/**
 * Exported so server/inventory.test.ts can derive the inventory FRESH and
 * compare it with the committed docs/inventory.json. A test that regenerated
 * the file and then read it back would pass no matter how stale the committed
 * copy was - it would be testing that writeFileSync works.
 */
export function buildInventory() {
  const procs = procedures();
  return {
    routes: routes(),
    procedures: procs,
    procedureTiers: tiers(procs),
    tables: tables(),
    notificationWrites: notificationWrites(),
    storageSurfaces: storageSurfaces(procs),
    roles: roles(),
  };
}

// Everything below runs only when this file is executed directly, so importing
// it from a test derives data without rewriting the repository.
const RUN_DIRECTLY = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (!RUN_DIRECTLY) {
  // eslint-disable-next-line no-empty-function
} else {

const inventory = buildInventory();

const dead = inventory.routes.filter(r => r.deadParamRoute);

writeFileSync(join(ROOT, 'docs/inventory.json'), JSON.stringify(inventory, null, 2) + '\n');

const md = [
  '# BuildHub inventory',
  '',
  '> Generated by `node scripts/inventory.mjs` from the source itself. Do not edit by hand.',
  '> `server/inventory.test.ts` fails if this file is stale.',
  '',
  `## Routes (${inventory.routes.length})`,
  '',
  '| Path | Component | Declares `:param` | Reads it |',
  '|---|---|---|---|',
  ...inventory.routes.map(r =>
    `| \`${r.path}\` | ${r.component} | ${r.declaresParam ? 'yes' : '—'} | ${
      r.declaresParam ? (r.readsParam ? 'yes' : '**NO — dead param route**') : '—'
    } |`),
  '',
  `Dead param routes: **${dead.length}**`,
  '',
  `## Server procedures (${inventory.procedures.length})`,
  '',
  ...Object.entries(inventory.procedureTiers)
    .sort((a, b) => b[1] - a[1])
    .map(([tier, n]) => `- \`${tier}\` — ${n}`),
  '',
  `## Tables (${inventory.tables.length})`,
  '',
  '| Table | Columns | FK refs | NOT NULL | UNIQUE |',
  '|---|---|---|---|---|',
  ...inventory.tables.map(t =>
    `| \`${t.name}\` | ${t.columns} | ${t.references} | ${t.notNull} | ${t.unique} |`),
  '',
  `## Notification write sites (${inventory.notificationWrites.length})`,
  '',
  ...inventory.notificationWrites.map(n => `- ${n.file}:${n.line} — ${n.via}`),
  '',
  `## Storage-dependent surfaces (${inventory.storageSurfaces.length})`,
  '',
  ...inventory.storageSurfaces.map(s => `- \`${s.name}\` (${s.tier})`),
  '',
  '## Roles',
  '',
  `- Workspace roles: ${inventory.roles.workspace.map(r => `\`${r}\``).join(', ')}`,
  `- Additional: ${inventory.roles.additional.map(r => `\`${r}\``).join(', ')}`,
  '',
].join('\n');

writeFileSync(join(ROOT, 'docs/INVENTORY.md'), md);

console.log(`routes=${inventory.routes.length} procedures=${inventory.procedures.length} ` +
  `tables=${inventory.tables.length} notificationWrites=${inventory.notificationWrites.length} ` +
  `storageSurfaces=${inventory.storageSurfaces.length}`);
if (dead.length) {
  console.log(`\nDEAD PARAM ROUTES (${dead.length}):`);
  for (const r of dead) console.log(`  ${r.path} -> ${r.component} (${r.source})`);
}

}
