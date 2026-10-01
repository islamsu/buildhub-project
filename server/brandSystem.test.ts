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

/**
 * Minimal PNG header read. Enough to answer "is the file that ships actually
 * the size the component claims", which is the only thing worth asserting
 * about a binary from a test - and strictly more than the geometry heuristic
 * this replaced, which measured SVG rects that no longer exist.
 */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(join(ROOT, file));
  expect(buf.subarray(0, 8).toString('latin1'), `${file} is not a PNG`)
    .toBe('\x89PNG\r\n\x1a\n');
  expect(buf.subarray(12, 16).toString('latin1'), `${file} has no IHDR`).toBe('IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

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
      // to the brand name is the shape of a hand-rolled logo.
      const logoish =
        /Building2\s+className="w-[45] h-[45]/.test(source)
        && /Rakiza|RAKIZA/.test(source);
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
      expect(code(file), `${file} does not use RakizaLogo`).toContain('RakizaLogo');
    }
  });

  it('nothing imports the retired BuildHub lock-up', () => {
    // The rename is only safe if the old component is gone rather than
    // orphaned next to the new one, waiting to be imported by habit.
    for (const file of CLIENT) {
      expect(codeAbs(file), `${rel(file)} still references the old lock-up`)
        .not.toMatch(/BuildHubLogo|BuildHubMark|BuildHubWordmark/);
    }
  });

  it('the brand forms are fixed in one place, so they cannot drift', () => {
    /*
     * RAKIZA, Rakiza, RAKEZA and rakiza are all one careless edit away when
     * the word is typed per surface. shared/brand.ts owns the forms; this
     * asserts the distinction the design actually depends on - capitals are
     * the drawn logotype, title case is what goes in a sentence.
     */
    const brand = code('shared/brand.ts');
    expect(brand).toContain("BRAND_LOGOTYPE = 'RAKIZA'");
    expect(brand).toContain("BRAND_NAME_EN = 'Rakiza'");
    expect(brand).toContain("BRAND_NAME_AR = 'ركيزة'");
    // The old Arabic brand was a transliteration. It must not survive here.
    expect(brand).not.toContain('بيلد هَب');
  });

  it('every asset the component can request actually ships', () => {
    /*
     * The component picks a path from BRAND_ASSETS by tone. A path that is
     * right in TypeScript and absent on disk is a broken image in the header
     * of every page, and nothing else in the suite would catch it.
     */
    const brand = read('shared/brand.ts');
    const paths = [...brand.matchAll(/'(\/brand\/[a-z0-9.-]+)'/g)].map(m => m[1]);
    expect(paths.length, 'BRAND_ASSETS looks empty').toBeGreaterThanOrEqual(8);
    for (const p of paths) {
      expect(() => readFileSync(join(ROOT, 'client/public', p)), `${p} is missing`).not.toThrow();
    }
  });

  it('the declared intrinsic sizes are the real ones, so the box is reserved correctly', () => {
    /*
     * width and height on the img are what stop the header shifting when the
     * logo lands. Declaring sizes that do not match the file reserves the
     * WRONG box, which is a layout shift that looks deliberate - worse than
     * declaring none. CLS <= 0.1 is a release gate (§63).
     */
    const brand = read('shared/brand.ts');
    const declared = (key: string) => {
      const m = brand.match(new RegExp(`${key}:\\s*\\{\\s*width:\\s*(\\d+),\\s*height:\\s*(\\d+)`));
      expect(m, `${key} has no declared size`).toBeTruthy();
      return { width: Number(m![1]), height: Number(m![2]) };
    };
    expect(pngSize('client/public/brand/rakiza-lockup.png')).toEqual(declared('lockup'));
    expect(pngSize('client/public/brand/rakiza-lockup-inverse.png')).toEqual(declared('lockup'));
    expect(pngSize('client/public/brand/rakiza-mark.png')).toEqual(declared('mark'));
    expect(pngSize('client/public/brand/rakiza-mark-inverse.png')).toEqual(declared('mark'));
  });

  it('the favicon and the social card are the sizes those slots require', () => {
    // 32 because that is what a tab renders; 180 because that is the Apple
    // touch icon size; 1200x630 because that is the Open Graph card.
    expect(pngSize('client/public/brand/favicon-32.png')).toEqual({ width: 32, height: 32 });
    expect(pngSize('client/public/brand/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
    expect(pngSize('client/public/brand/rakiza-og.png')).toEqual({ width: 1200, height: 630 });
  });

  it('the artwork is derived from the owner master, and says so', () => {
    /*
     * The owner's directive was explicit: do not trace the mark, do not crop a
     * screenshot, do not silently ship a reconstruction. The defence is
     * provenance - one master in the repo, one script that derives every
     * served size from it, and a recorded note saying which.
     */
    expect(() => read('brand-source/rakiza-master.png'), 'the master is not in the repo').not.toThrow();
    expect(() => read('scripts/brand/build-assets.py'), 'the derivation is not reproducible').not.toThrow();
    const brand = read('shared/brand.ts');
    expect(brand).toContain('BRAND_ASSET_PROVENANCE');
    expect(brand).toMatch(/brand-source\/rakiza-master\.png/);
    // And the outstanding ask is recorded rather than quietly dropped.
    expect(brand).toMatch(/[Vv]ector master/);
  });

  it('the lock-up reserves its box wherever it is rendered', () => {
    const logo = code('client/src/components/brand/RakizaLogo.tsx');
    expect(logo).toContain('BRAND_ASSET_SIZES');
    // Two img elements - mark and lock-up - and both carry width and height.
    const imgs = [...logo.matchAll(/<img\b[\s\S]*?\/>/g)].map(m => m[0]);
    expect(imgs.length, 'expected the mark and the lock-up').toBe(2);
    for (const img of imgs) {
      expect(img, 'an img ships without intrinsic dimensions').toMatch(/width=\{/);
      expect(img, 'an img ships without intrinsic dimensions').toMatch(/height=\{/);
      expect(img, 'an img ships without an alt decision').toMatch(/alt=\{/);
    }
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

  it('there is a favicon at all, and it is the PNG tile', () => {
    /*
     * There was none at first, so every tab showed the browser's default
     * globe. It is now PNG rather than SVG because the RAKIZA mark is
     * owner-supplied raster artwork; a traced SVG approximation of it is
     * exactly what the owner forbade.
     */
    expect(html).toMatch(/rel="icon"[^>]*href="\/brand\/favicon-32\.png"/);
    expect(html).toMatch(/rel="apple-touch-icon"[^>]*href="\/brand\/apple-touch-icon\.png"/);
    // The retired placeholder must not be left referenced.
    expect(html).not.toContain('favicon.svg');
  });

  it('a social card exists, with dimensions and alt text', () => {
    expect(html).toContain('property="og:image"');
    expect(html).toContain('content="1200"');
    expect(html).toContain('content="630"');
    expect(html).toContain('og:image:alt');
  });

  it('the social card is a PNG, which closes a standing owner note', () => {
    /*
     * The previous card was SVG, carrying a comment that several Slack and
     * WhatsApp versions do not render SVG for og:image - so a shared link
     * showed a bare title with no identity. Asserting the extension is what
     * stops that regressing the next time somebody prefers vector.
     */
    expect(html).toMatch(/property="og:image"\s+content="\/brand\/rakiza-og\.png"/);
    expect(html).not.toContain('og-image.svg');
  });

  it('og:url is NOT hard-coded, because staging and production differ', () => {
    // A wrong canonical URL in a social card is worse than an absent one.
    expect(html).not.toMatch(/property="og:url"\s+content="https?:\/\//);
  });

  it('theme-color is the approved brand anchor, not a stray hex', () => {
    // It was #0f172a, a hex belonging to no token; then #122c45, the old
    // brand-900. Primary Navy is the value the owner approved.
    expect(html).toContain('content="#0F2D5B"');
  });

  it('the page title and social metadata carry the new brand', () => {
    expect(html).toContain('<title>Rakiza');
    expect(html).toContain('content="Rakiza"');
    expect(html, 'the old brand is still in the document head').not.toMatch(/BuildHub/);
  });

  it('the retired placeholder artwork is gone, not merely unreferenced', () => {
    // An orphaned asset next to the real one is an invitation to point at it.
    for (const asset of ['favicon.svg', 'mark.svg', 'mark-inverse.svg', 'og-image.svg']) {
      expect(() => read(`client/public/brand/${asset}`), `${asset} still ships`).toThrow();
    }
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
