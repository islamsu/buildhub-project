import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readClientFile = (relativePath: string) =>
  readFileSync(new URL(`../client/src/${relativePath}`, import.meta.url), 'utf8');

describe('site-wide language and responsive layout wiring', () => {
  it('provides an accessible bilingual language toggle that persists through the shared context', () => {
    const toggle = readClientFile('components/LanguageToggle.tsx');
    const context = readClientFile('contexts/LanguageContext.tsx');
    const navbar = readClientFile('components/Navbar.tsx');
    const dashboard = readClientFile('components/DashboardLayout.tsx');

    expect(toggle).toContain('setLang(nextLanguage)');
    expect(toggle).toContain("aria-label={lang === 'en' ? 'Switch to Arabic' : 'التبديل إلى الإنجليزية'}");
    expect(context).toContain("localStorage.setItem('buildhub_lang', l)");
    expect(navbar).toContain('<LanguageToggle');
    expect(dashboard).toContain('<LanguageToggle');
  });

  it('covers standalone auth, password setup, and not-found shells', () => {
    const authPage = readClientFile('pages/AuthPage.tsx');
    const passwordSetup = readClientFile('pages/PasswordSetupPage.tsx');
    const notFound = readClientFile('pages/NotFound.tsx');

    expect(authPage).toContain("import LanguageToggle from '@/components/LanguageToggle';");
    expect(authPage).toContain('<LanguageToggle className="ml-auto" />');
    expect(passwordSetup).toContain('<LanguageToggle />');
    expect(notFound).toContain('<LanguageToggle />');
  });

  it('the flex min-size guard sits in BASE, so an explicit min-* utility still wins', () => {
    /*
     * A flex item defaults to `min-width: auto` and refuses to shrink below
     * its content, so a long unbroken string pushes the page sideways. The
     * defence is zeroing it on every flex element, and the overflow checks at
     * 320, 375, 390 and 430px depend on that rule existing.
     *
     * IT USED TO SIT IN `@layer utilities`, where it had the same specificity
     * as Tailwind's own `.min-h-screen` and was declared later - so it won
     * every collision. `min-h-screen` on a flex container computed to ZERO.
     * The authentication page's branded navy panel stopped 170px short of the
     * bottom of a 900px viewport with a white band under it, and the same
     * silent loss applied to 28 files asking for min-h-screen and to every
     * `min-w-*` written beside a `flex`.
     *
     * Reproduced before it was believed: an injected `<div class="min-h-screen">`
     * computed 900px; the same div with `flex` added computed 0px.
     *
     * In `base` the guard still applies to every flex element that asks for
     * nothing else, and loses to an explicit utility - which is the whole
     * point of the layer order. This pins WHICH layer, because moving it back
     * would reintroduce a defect that no test could see from the markup.
     */
    const css = readClientFile('index.css');
    const rule = '.flex { min-width: 0; min-height: 0; }';
    expect(css, 'the flex min-size guard is gone entirely').toContain(rule);

    const baseStart = css.indexOf('@layer base {');
    const utilitiesStart = css.indexOf('@layer utilities {');
    const ruleAt = css.indexOf(rule);
    expect(baseStart, '@layer base not found').toBeGreaterThan(-1);
    expect(utilitiesStart, '@layer utilities not found').toBeGreaterThan(-1);
    expect(baseStart, 'the layers are not in the expected order').toBeLessThan(utilitiesStart);
    expect(ruleAt, 'the guard is before @layer base').toBeGreaterThan(baseStart);
    expect(ruleAt, 'the guard is back in @layer utilities, where it beats min-h-screen')
      .toBeLessThan(utilitiesStart);
  });

  it('keeps the viewport shrinkable while allowing intentional horizontal overflow to scroll', () => {
    const css = readClientFile('index.css');
    const sidebar = readClientFile('components/ui/sidebar.tsx');
    const dashboard = readClientFile('components/DashboardLayout.tsx');

    expect(css).toContain('overflow-x: auto');
    expect(css).toContain('scrollbar-gutter: stable');
    expect(css).toContain('.horizontal-scroll-rail');
    expect(sidebar).toContain('min-w-0 max-w-full overflow-x-visible');
    expect(sidebar).toContain('w-full min-w-0 flex-1 flex-col');
    expect(dashboard).toContain('min-w-0 flex-1 overflow-x-visible p-4');
  });
});
