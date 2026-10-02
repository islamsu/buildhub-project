import { useId, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Search } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadFailedInline, loadFailedCopy } from '@/components/LoadFailed';

/**
 * ── ONE SEARCH, TWO SURFACES ────────────────────────────────────────────
 *
 * The approved homepage puts a search field in the hero. The Marketplace Hub
 * already had a working typeahead over the same public data, and the owner's
 * direction for this release was explicit: reuse and generalise it rather than
 * build a universal search platform.
 *
 * So this is that typeahead, extracted. Both surfaces now render the same
 * component against the same two authorized public queries, which is the
 * difference between one search that behaves consistently and two that drift.
 *
 * ── WHAT THIS DELIBERATELY IS NOT ───────────────────────────────────────
 *
 * There is no universal cross-entity search in this product. `platformSearch`
 * exists and is `adminProcedure` - reaching for it here would widen an
 * authorization surface to reproduce a mockup, which the owner ruled out.
 *
 * So the suggestion list is drawn ONLY from what a signed-out visitor may
 * already read: the public category taxonomy, and the vendor directory, which
 * excludes unapproved and unverified accounts server-side. Nothing is invented
 * for an entity type that cannot be searched publicly. Projects, RFQs,
 * quotations and people are absent because there is no public listing of them.
 *
 * ── THE SUBMIT PATH IS REAL, NOT DECORATIVE ─────────────────────────────
 *
 * Pressing Search without choosing a suggestion goes to the product catalogue
 * with `?q=`, which performs a genuine server-side search - `marketplace.list`
 * has always taken a `search` argument. A Search button that only closed a
 * dropdown would be a control that looks like a capability and is not one.
 */

export type SourcingSearchVariant =
  /** On the dark hero: a tall white field with the amber action beside it. */
  | 'hero'
  /** On a light panel: the same field, sized for a page section. */
  | 'panel';

type Suggestion = { type: string; label: string; href: string };

export default function SourcingSearch({
  variant = 'hero',
  className,
}: {
  variant?: SourcingSearchVariant;
  className?: string;
}) {
  const { t, lang } = useLanguage();
  const ar = lang === 'ar';
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [highlight, setHighlight] = useState(-1);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  /* The same two public reads the hub uses. `retry: false` so a failure is
     visible promptly rather than after three silent attempts. */
  const { data: taxonomy, isError: taxonomyFailed } =
    trpc.marketplace.categories.useQuery({ view: 'public' }, { retry: false });
  const { data: directory = [], isError: directoryFailed } =
    trpc.marketplace.vendors.useQuery({ limit: 100 }, { retry: false });

  const productCategories = taxonomy?.categories ?? [];
  const sourcesFailed = taxonomyFailed && directoryFailed;

  const suggestions = useMemo<Suggestion[]>(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: Suggestion[] = [];
    /* The link carries the CANONICAL English name, which is what the
       marketplace filter and products.category both hold. */
    productCategories
      .filter((c: any) => c.nameEn.toLowerCase().includes(q) || c.nameAr.includes(q))
      .slice(0, 4)
      .forEach((c: any) => out.push({
        type: t('marketHub.suggestionProductCategory'),
        label: ar ? c.nameAr : c.nameEn,
        href: `/marketplace/products?cat=${encodeURIComponent(c.nameEn)}`,
      }));
    const named = (rows: any[]) => rows.filter(v => (v.name ?? '').toLowerCase().includes(q));
    /* /vendor/:id, not /marketplace/vendors/:id - the latter renders the whole
       directory and drops the id, so picking one provider delivered a page
       listing all of them. */
    named(directory).slice(0, 3).forEach((v: any) =>
      out.push({ type: t('marketHub.suggestionVendor'), label: v.name ?? `#${v.id}`, href: `/vendor/${v.id}` }));
    named(directory.filter((v: any) => v.categories?.includes('Design'))).slice(0, 3).forEach((d: any) =>
      out.push({ type: t('marketHub.suggestionDesigner'), label: d.name ?? `#${d.id}`, href: `/vendor/${d.id}` }));
    named(directory.filter((v: any) => v.categories?.includes('Renovation'))).slice(0, 3).forEach((f: any) =>
      out.push({ type: t('marketHub.suggestionFinishingCompany'), label: f.name ?? `#${f.id}`, href: `/vendor/${f.id}` }));
    return out.slice(0, 8);
  }, [search, ar, t, directory, productCategories]);

  const open = search.trim().length >= 2 && (suggestions.length > 0 || sourcesFailed);

  const go = (href: string) => {
    setSearch('');
    setHighlight(-1);
    navigate(href);
  };

  /** Search with nothing highlighted: the catalogue's own text search. */
  const submit = () => {
    const q = search.trim();
    if (!q) { inputRef.current?.focus(); return; }
    if (highlight >= 0 && suggestions[highlight]) { go(suggestions[highlight].href); return; }
    go(`/marketplace/products?q=${encodeURIComponent(q)}`);
  };

  /*
   * KEYBOARD, BECAUSE A DROPDOWN THAT ONLY TAKES A MOUSE IS NOT NAVIGATION.
   * Down and Up move, Enter commits, Escape clears the list without clearing
   * the field - the behaviour a combobox is expected to have (§62).
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => (suggestions.length === 0 ? -1 : (h + 1) % suggestions.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => (suggestions.length === 0 ? -1 : (h - 1 + suggestions.length) % suggestions.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      setHighlight(-1);
      setSearch('');
    }
  };

  const hero = variant === 'hero';

  return (
    <div className={`relative ${className ?? ''}`} data-testid="sourcing-search">
      <div className="flex items-stretch gap-2">
        <div className="relative flex-1">
          <Search
            className={`pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 ${hero ? 'h-5 w-5' : 'h-4 w-4'} text-muted-foreground`}
            aria-hidden="true"
          />
          {/* aria-label, not placeholder. A placeholder is not an accessible
              name: it disappears the moment there is text in the field, so a
              screen-reader user reviewing what they typed hears an unnamed
              edit box. */}
          <Input
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={highlight >= 0 ? `${listId}-${highlight}` : undefined}
            aria-label={t('marketHub.searchPlaceholder')}
            placeholder={t('marketHub.searchPlaceholder')}
            className={`bg-white text-foreground shadow-lg rounded-xl ps-12 ${hero ? 'h-14 text-base' : 'h-12'}`}
            value={search}
            onChange={e => { setSearch(e.target.value); setHighlight(-1); }}
            onKeyDown={onKeyDown}
            data-testid="sourcing-search-input"
          />
        </div>
        {/* The one amber control on the page, and the variant owns the dark
            label the contrast floor requires. */}
        <Button
          variant="accent"
          className={`shrink-0 rounded-xl px-7 ${hero ? 'h-14 text-base' : 'h-12'}`}
          onClick={submit}
          data-testid="sourcing-search-submit"
        >
          {t('search.submit')}
        </Button>
      </div>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={t('marketHub.searchPlaceholder')}
          className="absolute top-full mt-2 inset-x-0 z-50 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
        >
          {sourcesFailed ? (
            /* AN OUTAGE IS NOT "NO MATCHES". A typeahead that answers an empty
               list when it could not look tells the visitor this marketplace
               has nothing of what they asked for. */
            <LoadFailedInline text={loadFailedCopy(ar).text} />
          ) : (
            suggestions.map((s, i) => (
              <button
                key={`${s.href}-${i}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={highlight === i}
                type="button"
                className={`flex w-full items-center justify-between px-4 py-3 text-start transition-colors ${
                  highlight === i ? 'bg-muted' : 'hover:bg-muted'
                }`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => go(s.href)}
              >
                <span className="text-sm font-medium">{s.label}</span>
                <Badge variant="secondary" className="text-xs">{s.type}</Badge>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
