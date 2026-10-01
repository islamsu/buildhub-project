import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';

/**
 * ── THE BRAND SYSTEM, HELD IN PLACE ─────────────────────────────────────
 *
 * A brand degrades one convenient shortcut at a time: a second logo assembled
 * inline because importing felt heavy, a role tinted green because green was
 * to hand, a raw `bg-blue-600` because nobody knew `bg-brand-600` existed.
 * Every one of those is individually reasonable and collectively fatal.
 *
 * These assertions are about the shortcuts, not about taste. None of them
 * says a colour is pretty; each says a decision has exactly one home.
 */

const ROOT = join(import.meta.dirname, '..');
/** Repo-relative read. */
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');
/** Repo-relative, comments stripped. */
const code = (file: string) => readSourceForAssertions(read(file));
/**
 * Absolute-path read, for the files `walk` returns.
 *
 * Kept separate from `code` on purpose: the first version passed walk's
 * absolute paths into the relative reader, which joined ROOT twice and threw
 * ENOENT on every file. One reader taking both shapes is how that happens.
 */
const codeAbs = (file: string) => readSourceForAssertions(readFileSync(file, 'utf8'));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}
const CLIENT = walk(join(ROOT, 'client/src'));
const rel = (file: string) => file.slice(ROOT.length).replace(/^\/+/, '');

const PALETTE = /\b(bg|text|border|from|to|via|ring)-(blue|amber|orange|green|purple|teal|emerald|sky|indigo|violet|rose|red|yellow|cyan|lime|pink|fuchsia)-[0-9]{2,3}\b/g;

describe('the logo has exactly one source', () => {
  it('no surface assembles a logo from a UI icon and a tinted box', () => {
    /*
     * There were FOUR copies, and the fourth is the reason this is a test.
     * A census for `gradient-brand` found three - Navbar, Home, AuthPage - and
     * missed the AuthPage desktop panel, which used `bg-white/20` instead and
     * so looked like an unrelated component. Four slightly different logos,
     * none of them intended.
     */
    const offenders: string[] = [];
    for (const file of CLIENT) {
      if (rel(file).includes('components/brand/')) continue;
      const source = codeAbs(file);
      // A Lucide building glyph sitting inside a sized, tinted container next
      // to the word BuildHub is the shape of a hand-rolled logo.
      const logoish =
        /Building2\s+className="w-[45] h-[45]/.test(source)
        && /BuildHub/.test(source);
      if (logoish) offenders.push(rel(file));
    }
    expect(offenders, 'a logo is being assembled outside components/brand/').toEqual([]);
  });

  it('every brand surface renders the shared component', () => {
    for (const file of [
      'client/src/components/Navbar.tsx',
      'client/src/pages/Home.tsx',
      'client/src/pages/AuthPage.tsx',
    ]) {
      expect(code(file), `${file} does not use BuildHubLogo`).toContain('BuildHubLogo');
    }
  });

  it('the wordmark casing is fixed in one place, so it cannot drift', () => {
    // BUILDHUB, Build Hub and buildhub are all one careless edit away when the
    // word is typed per surface.
    /* COMMENTS STRIPPED. The first version read the raw file and tripped on
       this component's own heading, "THE BUILDHUB BRAND LOCK-UP" - a guard
       that cannot tell code from the prose describing it teaches the next
       person to delete the prose. */
    const logo = code('client/src/components/brand/BuildHubLogo.tsx');
    expect(logo).toContain('BuildHub');
    expect(logo).not.toContain('BUILDHUB');
    expect(logo).not.toMatch(/>\s*Build Hub\s*</);
  });

  it('the mark survives a favicon, because its members are thick enough', () => {
    /*
     * THE ONE MEASURABLE THING ABOUT A LOGO. On a 32-unit grid a 6-unit member
     * is 18.75% of the width, so at 24px it renders about 4.5px and the open
     * bay stays open. Thin-stroke marks fail here: at 16px a 2-unit member is
     * a single pixel and the whole thing turns to grey mush.
     */
    const logo = read('client/src/components/brand/BuildHubLogo.tsx');
    expect(logo).toContain('viewBox="0 0 32 32"');
    const widths = [...logo.matchAll(/width="(\d+)"\s+height="(\d+)"/g)]
      .flatMap(m => [Number(m[1]), Number(m[2])]);
    expect(widths.length).toBeGreaterThan(0);
    const thinnest = Math.min(...widths);
    expect(thinnest / 32, 'a member is too thin to survive 24px').toBeGreaterThanOrEqual(0.15);
  });

  it('documents where final artwork goes instead of pretending to be final', () => {
    const logo = read('client/src/components/brand/BuildHubLogo.tsx');
    expect(logo).toContain('BRAND_ARTWORK_NOTE');
    expect(logo).toMatch(/placeholder/i);
  });
});

describe('six roles, one ecosystem', () => {
  it('no surface keeps its own per-role colour table', () => {
    /*
     * The rainbow existed twice - homepage and signup - with the same six hues
     * each time. Six saturated colours read as six unrelated products, and the
     * brand blue became just one of the six.
     */
    /*
     * NARROWED, BECAUSE THE FIRST VERSION WAS WRONG ABOUT WHAT IT WAS LOOKING
     * FOR. It flagged any file naming four roles that also used four palette
     * hues, and caught six - of which four were RFQ and admin screens using
     * emerald/rose/amber for ACCEPTED, REJECTED and PENDING. Those are status
     * colours that happen to live near the word "contractor", and conflating
     * them with the role rainbow would have meant rewriting screens this pass
     * was told to leave alone.
     *
     * What actually defines the defect is a role identifier and a colour bound
     * together - in one object entry, one line, or one record keyed by role. So
     * the detector looks for a role-keyed block containing a palette class, not
     * for two things appearing in the same file.
     *
     * The two genuine offenders it found this way were lib/rolePlatform.ts and
     * the homepage/signup tables, all now on brand tokens.
     */
    const ROLE_IDS = ['homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager'];
    const offenders: string[] = [];
    for (const file of CLIENT) {
      if (rel(file).includes('components/brand/')) continue;
      const source = codeAbs(file);
      for (const id of ROLE_IDS) {
        // A block opened by the role id, up to the next role or closing brace.
        const keyed = new RegExp(`['"\`]?${id}['"\`]?\\s*:\\s*\\{[^}]{0,400}\\}`, 'g');
        const inline = new RegExp(`id:\\s*['"]${id}['"][^\\n]{0,300}`, 'g');
        for (const block of [...source.matchAll(keyed), ...source.matchAll(inline)]) {
          const hues = [...block[0].matchAll(PALETTE)].map(m => m[2]);
          if (hues.length > 0) {
            offenders.push(`${rel(file)} :: ${id} -> ${[...new Set(hues)].join(', ')}`);
          }
        }
      }
    }
    expect(offenders, 'a role is still bound to a palette colour').toEqual([]);
  });

  it('role identity is one list, and differentiation is the icon', () => {
    const identity = read('client/src/components/brand/roleIdentity.ts');
    expect(identity).toContain('ROLE_IDENTITIES');
    // Six roles, each with an icon.
    for (const id of ['homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager']) {
      expect(identity, `${id} missing from the one list`).toContain(`id: '${id}'`);
    }
    // And no palette hues in the identity module itself - only brand tokens.
    expect([...code('client/src/components/brand/roleIdentity.ts').matchAll(PALETTE)]).toEqual([]);
  });

  it('both former call sites read the shared list', () => {
    for (const file of ['client/src/pages/Home.tsx', 'client/src/pages/AuthPage.tsx']) {
      expect(code(file), `${file}`).toContain('ROLE_IDENTITIES');
    }
  });
});

describe('the brand is reachable as utilities, which is why hardcoding stopped', () => {
  const css = read('client/src/index.css');

  it('the full brand scale is exposed to Tailwind', () => {
    /*
     * THE ROOT CAUSE. The scale existed under `:root` as `--brand-*`, visible
     * to hand-written CSS and invisible to Tailwind - so `bg-brand-600` did
     * not exist and 443 raw palette classes accumulated. Not because anyone
     * preferred them, but because the brand had no utility to reach for.
     */
    for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
      expect(css, `--color-brand-${step} not exposed`).toContain(`--color-brand-${step}:`);
    }
  });

  it('the accent scale is deliberately SHORT, which is the guardrail', () => {
    // Three steps. A full eleven-step amber scale would invite it onto
    // backgrounds, borders and body text, which is how a blue product turns
    // orange.
    const accentSteps = [...css.matchAll(/--color-brand-accent-(\d+):/g)].map(m => m[1]);
    expect(accentSteps.sort()).toEqual(['400', '500', '600']);
  });

  it('semantic status is separate from the brand accent', () => {
    /*
     * The real risk in this palette: `warning` and `brand-accent` are
     * neighbouring hues, and if they were one token amber would come to mean
     * "something is wrong". Two tokens means a reviewer can tell which was
     * meant.
     */
    for (const token of ['--color-success', '--color-warning', '--color-info']) {
      expect(css, `${token} not exposed`).toContain(`${token}:`);
    }
    expect(css).toContain('--color-brand-accent-500:');
  });

  it('dark mode answers for status, not only for primary', () => {
    const dark = css.slice(css.indexOf('.dark {'), css.indexOf('}', css.indexOf('.dark {')));
    for (const token of ['--success', '--warning', '--destructive', '--primary']) {
      expect(dark, `${token} has no dark value`).toContain(`${token}:`);
    }
  });

  it('the marketing surfaces use tokens, not raw palette colours', () => {
    for (const file of [
      'client/src/components/Navbar.tsx',
      'client/src/pages/Home.tsx',
      'client/src/pages/AuthPage.tsx',
      'client/src/components/SourcingJourney.tsx',
    ]) {
      const found = [...code(file).matchAll(PALETTE)].map(m => m[0]);
      expect(found, `${file} still hardcodes palette colours`).toEqual([]);
    }
  });

  it('and the rest of the client does not get WORSE', () => {
    /*
     * A RATCHET, NOT A CLAIM OF COMPLETION. 398 raw palette classes remain,
     * almost all in admin and status surfaces where they encode state rather
     * than brand - rewriting them wholesale would be a redesign of screens
     * this pass was told not to touch.
     *
     * What this stops is the count climbing while nobody is looking. Lower it
     * deliberately as those surfaces are migrated; never raise it.
     */
    const total = CLIENT
      .filter(file => !rel(file).includes('components/brand/'))
      .reduce((sum, file) => sum + [...codeAbs(file).matchAll(PALETTE)].length, 0);
    expect(total, 'raw palette usage has grown').toBeLessThanOrEqual(398);
    /*
     * 398 is `readSourceForAssertions`'s count, not a hand-rolled grep's. An
     * earlier number here was three lower because it used a simpler comment
     * stripper - a ratchet set from a different measurement than the one it
     * asserts is a ratchet that fails on a clean tree, which is worse than no
     * ratchet at all.
     */
  });
});

describe('launch assets exist and the metadata is consistent', () => {
  const html = read('client/index.html');

  it('there is a favicon at all', () => {
    // There was none, so every tab showed the browser's default globe - the
    // first branding a visitor sees, before the page paints.
    expect(html).toMatch(/rel="icon"[^>]*href="\/brand\/favicon\.svg"/);
  });

  it('a social card exists, with dimensions and alt text', () => {
    expect(html).toContain('property="og:image"');
    expect(html).toContain('content="1200"');
    expect(html).toContain('content="630"');
    expect(html).toContain('og:image:alt');
  });

  it('og:url is NOT hard-coded, because staging and production differ', () => {
    // A wrong canonical URL in a social card is worse than an absent one.
    expect(html).not.toMatch(/property="og:url"\s+content="https?:\/\//);
  });

  it('theme-color matches a real brand value', () => {
    // It was #0f172a, a hex belonging to no token and matching nothing.
    expect(html).toContain('content="#122c45"');
  });

  it('the brand asset files are present', () => {
    for (const asset of ['favicon.svg', 'mark.svg', 'mark-inverse.svg', 'og-image.svg']) {
      expect(() => read(`client/public/brand/${asset}`), asset).not.toThrow();
    }
  });

  it('the favicon keeps the accent node, which is what distinguishes it at 16px', () => {
    const favicon = read('client/public/brand/favicon.svg');
    expect(favicon).toContain('#f0a44a');
  });
});

describe('positioning says what the product does for a customer', () => {
  it('the implementation label is gone from user-facing copy', () => {
    /*
     * "The AI-powered Construction OS" describes the build to someone who came
     * to source materials. AI is an enabling capability here, not the reason
     * the product exists.
     */
    const copy = code('client/src/contexts/LanguageContext.tsx');
    expect(copy).not.toMatch(/Construction OS/i);
    expect(copy).not.toMatch(/construction operating system/i);
    expect(copy).not.toContain('نظام تشغيل البناء');
  });

  it('both languages carry the positioning, and Arabic is not a transliteration', () => {
    const copy = read('client/src/contexts/LanguageContext.tsx');
    expect(copy).toContain('From sourcing to site');
    // The Arabic line reads naturally rather than word-for-word; asserted on
    // its own terms so a literal back-translation would fail here.
    expect(copy).toContain('من التوريد إلى موقع التنفيذ');
  });

  it('no unsupported superlative entered the marketing copy', () => {
    const copy = code('client/src/contexts/LanguageContext.tsx');
    for (const claim of [/revolutionary/i, /world'?s best/i, /game-?changing/i, /industry-?leading/i]) {
      expect(copy, `${claim} is an unsupported claim`).not.toMatch(claim);
    }
  });
});
