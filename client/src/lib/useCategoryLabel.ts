import { useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';

/**
 * ── ONE CATEGORY, ONE NAME, IN BOTH LANGUAGES ───────────────────────────
 *
 * `products.category` stores the CANONICAL ENGLISH name - that is what the
 * write path resolves to and what the marketplace filter matches on. So any
 * surface rendering a product's category in Arabic has to look the Arabic
 * name up in the taxonomy, and a surface that forgets shows an English
 * fragment on an Arabic page (§67).
 *
 * The rule already existed, correctly, inside Marketplace.tsx and nowhere
 * else - so the Saved page showed "Cement & Concrete" under a product whose
 * own name was in Arabic. Extracted rather than copied: §11, one canonical
 * rule, because the interesting half is the fallback and a second copy of it
 * would drift.
 *
 * THE FALLBACK IS THE POINT. A product's stored category may name one that
 * has since been archived, or one stored before the taxonomy existed.
 * Showing the STORED value is truthful; inventing a translation for a
 * category BuildHub no longer has would not be.
 */
export function useCategoryLabel() {
  const { lang } = useLanguage();
  const { data: taxonomy } = trpc.marketplace.categories.useQuery(
    { view: 'public' },
    { retry: false },
  );
  const categories = taxonomy?.categories ?? [];

  const display = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories) {
      map.set(category.nameEn, lang === 'ar' ? category.nameAr : category.nameEn);
    }
    return map;
  }, [categories, lang]);

  return useMemo(
    () => (name: string | null | undefined) => {
      if (!name) return '';
      return display.get(name) ?? name;
    },
    [display],
  );
}
