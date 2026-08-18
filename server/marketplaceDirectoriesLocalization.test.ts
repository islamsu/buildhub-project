import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readClientFile = (relativePath: string) =>
  readFileSync(new URL(`../client/src/${relativePath}`, import.meta.url), 'utf8');

const DIRECTORY_PAGES = [
  { file: 'pages/VendorsDirectory.tsx', minTCalls: 20 },
  { file: 'pages/DesignersDirectory.tsx', minTCalls: 18 },
  { file: 'pages/FinishingDirectory.tsx', minTCalls: 20 },
  { file: 'pages/MarketplaceHub.tsx', minTCalls: 25 },
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
