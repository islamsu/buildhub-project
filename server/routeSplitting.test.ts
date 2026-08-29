import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

/**
 * A VISITOR DOWNLOADED THE WHOLE PRODUCT TO SEE THE FRONT PAGE.
 *
 * Every page was imported eagerly into the entry chunk, so somebody landing on
 * the home page fetched the admin dashboard, the compliance review queue, the
 * AI assistant and its markdown/syntax-highlighting stack before anything
 * rendered: 2469 KB raw, 676 KB gzipped, measured on the built artefact.
 *
 * With route-level splitting the entry is 627 KB raw / 187 KB gzipped, and a
 * real browser against the production build transferred 186 KB of JavaScript
 * for the landing page. That is the number a person on an Egyptian mobile
 * connection actually waits for.
 *
 * These tests pin the shape, not the byte count - a size assertion would fail
 * on every unrelated feature and get relaxed until it meant nothing.
 */

const APP = readSourceForAssertions(readFileSync(new URL('../client/src/App.tsx', import.meta.url), 'utf8'));

/** Pages that must NOT be in the entry chunk: nobody needs them on arrival. */
const MUST_BE_LAZY = [
  'AdminDashboard', 'AdminLogin', 'AdminAdmins', 'AdminAcceptInvitation',
  'AIAssistantPage', 'CompliancePage', 'RolePlatform', 'ProjectDetail',
  'MessagesPage', 'RFQDetail', 'ProductDetail',
];

/** Pages that must stay eager: deferring them trades bytes for a blank frame. */
const MUST_BE_EAGER = ['Home', 'AuthPage'];

describe('the first page does not carry the whole application', () => {
  it.each(MUST_BE_LAZY)('%s is loaded on demand, not on arrival', (page) => {
    expect(APP, `${page} must not be in the entry chunk`)
      .not.toContain(`import ${page} from "./pages/${page}"`);
    expect(APP).toContain(`const ${page} = lazy(() => import("./pages/${page}"))`);
  });

  it.each(MUST_BE_EAGER)('%s stays eager - it is what a visitor sees first', (page) => {
    expect(APP).toContain(`import ${page} from "./pages/${page}"`);
    expect(APP).not.toContain(`const ${page} = lazy(`);
  });

  it('every lazy route is inside a Suspense boundary', () => {
    // Without one, React throws on the first navigation to a split route -
    // every one of them, not an edge case.
    expect(APP).toContain('<Suspense fallback={<RouteFallback />}>');
    const suspenseStart = APP.indexOf('<Suspense');
    const switchStart = APP.indexOf('<Switch>');
    const suspenseEnd = APP.indexOf('</Suspense>');
    expect(suspenseStart).toBeGreaterThan(-1);
    expect(switchStart).toBeGreaterThan(suspenseStart);
    expect(suspenseEnd).toBeGreaterThan(APP.indexOf('</Switch>'));
  });

  it('the fallback does not flash a spinner for a chunk that arrives in 40ms', () => {
    expect(APP).toContain('function RouteFallback()');
    expect(APP).not.toMatch(/RouteFallback[\s\S]{0,300}(Spinner|Loader2|animate-spin)/);
  });

  it('every lazily imported page actually exists and exports a default', () => {
    // A lazy import that resolves to no default export renders nothing and
    // leaves the route stuck on the fallback - which looks like a blank page,
    // not an error.
    const names = [...APP.matchAll(/lazy\(\(\) => import\("\.\/pages\/([A-Za-z]+)"\)\)/g)].map(m => m[1]);
    expect(names.length, 'the split must actually cover routes').toBeGreaterThan(15);
    for (const name of names) {
      const path = new URL(`../client/src/pages/${name}.tsx`, import.meta.url);
      expect(existsSync(path), `${name}.tsx must exist`).toBe(true);
      expect(readFileSync(path, 'utf8'), `${name} must export default`).toContain('export default');
    }
  });
});

describe('the built entry chunk stays small', () => {
  const assets = 'dist/public/assets';
  const built = existsSync(assets);

  it('the entry chunk is a fraction of what it was before splitting', () => {
    if (!built) return expect(built).toBe(false); // nothing built in this run
    const entry = readdirSync(assets).find(f => /^index-.*\.js$/.test(f));
    expect(entry).toBeDefined();
    const bytes = statSync(`${assets}/${entry}`).size;
    // It was 2 528 KB. A generous ceiling that still fails loudly if every
    // page is pulled back into the entry, without breaking on real growth.
    expect(bytes, `entry chunk is ${Math.round(bytes / 1024)} KB`).toBeLessThan(1_200_000);
  });
});
