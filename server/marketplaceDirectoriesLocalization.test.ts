import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readClientFile = (relativePath: string) =>
  readFileSync(new URL(`../client/src/${relativePath}`, import.meta.url), 'utf8');

/**
 * Pages that render their own copy and must therefore localise it themselves.
 *
 * CLOSURE PASS: DesignersDirectory and FinishingDirectory used to be here.
 * They no longer render any copy - each is now a four-line wrapper that renders
 * VendorsDirectoryView with a category preset, because the lists they used to
 * show were fabricated. A wrapper with no strings cannot make eighteen t()
 * calls, and requiring it to would be requiring copy back.
 *
 * The rule follows the copy: it now applies to the component that renders it,
 * and the wrappers are held to a DIFFERENT and equally strict rule below -
 * they must pass translation KEYS, never literals.
 */
const DIRECTORY_PAGES = [
  { file: 'pages/VendorsDirectory.tsx', minTCalls: 20 },
  { file: 'pages/MarketplaceHub.tsx', minTCalls: 25 },
];

/** Pages that delegate their rendering, and the keys they must hand over. */
const DELEGATING_PAGES = [
  { file: 'pages/DesignersDirectory.tsx', titleKey: 'designersDir.title', subtitleKey: 'designersDir.subtitle' },
  { file: 'pages/FinishingDirectory.tsx', titleKey: 'finishingDir.title', subtitleKey: 'finishingDir.subtitle' },
];

// Extracts the `en: { ... }` / `ar: { ... }` translation blocks from the shared LanguageContext
// dictionary and returns their key sets, mirroring the parsing the audit itself did by hand.
function parseTranslationKeys(source: string) {
  const enBlock = source.match(/en: \{([\s\S]*?)\n {2}\},\n {2}ar: \{/)?.[1] ?? '';
  const arBlock = source.match(/ar: \{([\s\S]*?)\n {2}\},\n\};/)?.[1] ?? '';
  const keyRe = /'([a-zA-Z0-9_.]+)':/g;
  const enKeys = [...enBlock.matchAll(keyRe)].map(m => m[1]);
  const arKeys = [...arBlock.matchAll(keyRe)].map(m => m[1]);
  return { enKeys, arKeys };
}

describe('marketplace directory pages use the shared t() translation system, not ad-hoc strings', () => {
  for (const { file, minTCalls } of DIRECTORY_PAGES) {
    it(`${file} imports useLanguage, destructures t, and uses it for static copy`, () => {
      const source = readClientFile(file);
      expect(source).toContain("from '@/contexts/LanguageContext'");
      expect(source).toMatch(/const \{ lang, t \} = useLanguage\(\);/);

      const tCallCount = (source.match(/\bt\('/g) ?? []).length;
      expect(tCallCount).toBeGreaterThanOrEqual(minTCalls);
    });

    it(`${file} has no leftover hardcoded 'ar ? "..." : "..."' static-string ternaries`, () => {
      const source = readClientFile(file);
      // Static UI copy must go through t(); the only legitimate remaining `ar ? x : y`
      // ternaries are for per-record data (e.g. `ar ? vendor.nameAr : vendor.name`) or
      // direction-only logic (e.g. picking ArrowLeft vs ArrowRight), never inline string
      // literals on both sides.
      expect(source).not.toMatch(/ar \? '[^']*' : '[^']*'/);
      expect(source).not.toMatch(/ar\s*\?\s*"[^"]*"\s*:\s*"[^"]*"/);
    });
  }
});

describe('a page that delegates its rendering still owes its copy to t()', () => {
  for (const { file, titleKey, subtitleKey } of DELEGATING_PAGES) {
    it(`${file} passes translation KEYS, never literal copy`, () => {
      const source = readClientFile(file);
      expect(source).toContain('VendorsDirectoryView');
      expect(source).toContain(`titleKey="${titleKey}"`);
      expect(source).toContain(`subtitleKey="${subtitleKey}"`);
    });

    it(`${file} renders no user-facing string of its own`, () => {
      // The failure this guards against is a wrapper that starts adding a
      // heading or a note inline, outside the dictionary, because it is "just
      // one string".
      const code = readClientFile(file)
        .split('\n')
        .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
        .join('\n');
      expect(code).not.toMatch(/ar \? '[^']*' : '[^']*'/);
      expect(code).not.toMatch(/>[A-Za-z][A-Za-z ,.'-]{4,}</);
    });

    it(`${file} hands over a category from the shared taxonomy`, () => {
      const source = readClientFile(file);
      const preset = /presetCategory="([^"]+)"/.exec(source)?.[1];
      expect(preset, 'no preset category').toBeTruthy();
      const taxonomy = readFileSync(new URL('../shared/rfqCategories.ts', import.meta.url), 'utf8');
      expect(taxonomy, `${preset} is not in the RFQ taxonomy`).toContain(`'${preset}'`);
    });
  }
});

describe('translation dictionary integrity', () => {
  it('English and Arabic translation maps have exactly matching keys', () => {
    const source = readClientFile('contexts/LanguageContext.tsx');
    const { enKeys, arKeys } = parseTranslationKeys(source);

    expect(enKeys.length).toBeGreaterThan(0);
    expect(enKeys.length).toBe(arKeys.length);

    const enSet = new Set(enKeys);
    const arSet = new Set(arKeys);
    const missingInAr = enKeys.filter(k => !arSet.has(k));
    const missingInEn = arKeys.filter(k => !enSet.has(k));
    expect(missingInAr).toEqual([]);
    expect(missingInEn).toEqual([]);
  });

  it('the four directory pages\' new translation keys are present with non-empty English and Arabic values', () => {
    const source = readClientFile('contexts/LanguageContext.tsx');
    const spotCheckKeys = [
      'vendorsDir.title', 'vendorsDir.searchPlaceholder', 'vendorsDir.badgeTopRated',
      'designersDir.title', 'designersDir.requestDesign', 'designersDir.badgeAwardWinning',
      'finishingDir.title', 'finishingDir.servicesLabel', 'finishingDir.badgeFastResponse',
      'marketHub.exploreTitle', 'marketHub.featuredVendors', 'marketHub.suggestionVendor',
      'common.back_to_marketplace', 'common.message', 'common.request_quote',
    ];
    for (const key of spotCheckKeys) {
      const matches = [...source.matchAll(new RegExp(`'${key.replace('.', '\\.')}': '([^']+)'`, 'g'))];
      expect(matches.length, `expected exactly 2 entries (en + ar) for key "${key}"`).toBe(2);
      for (const m of matches) {
        expect(m[1].trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('the t() fallback chain (lang -> en -> raw key) is unchanged', () => {
    const source = readClientFile('contexts/LanguageContext.tsx');
    expect(source).toContain("return translations[lang][key] ?? translations['en'][key] ?? key;");
  });
});
