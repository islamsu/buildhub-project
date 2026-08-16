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
