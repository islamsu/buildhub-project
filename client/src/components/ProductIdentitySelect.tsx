import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Package, Search, X } from 'lucide-react';

export default function ProductIdentitySelect({
  value,
  onChange,
  label,
  testId,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
  testId: string;
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [searchText, setSearchText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<{ id: number; name: string; brand: string | null } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(searchText.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (value === null) {
      setSelected(null);
      setSearchText('');
    }
  }, [value]);

  const { data: results = [], isFetching } = trpc.marketplace.list.useQuery(
    { search: debounced || undefined, limit: 10 },
    { enabled: debounced.length >= 2 },
  );

  const choose = (product: { id: number; name: string; brand: string | null }) => {
    setSelected(product);
    setSearchText('');
    setOpen(false);
    onChange(product.id);
  };

  const clear = () => {
    setSelected(null);
    setSearchText('');
    setOpen(false);
    onChange(null);
  };

  return (
    <div className="relative" ref={boxRef}>
      <label className="text-xs text-muted-foreground">{label}</label>
      {selected ? (
        <div className="mt-1 flex min-h-9 items-center justify-between gap-2 rounded-md border bg-muted/20 px-2">
          <span className="min-w-0 truncate text-sm">{selected.name}</span>
          <button type="button" onClick={clear} aria-label={ar ? 'مسح المنتج' : 'Clear product'}>
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      ) : (
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-testid={testId}
            className="h-9 ps-8"
            placeholder={ar ? 'ابحث عن منتج…' : 'Search a product…'}
            value={searchText}
            onChange={event => { setSearchText(event.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}
          />
        </div>
      )}
      {open && debounced.length >= 2 && !selected && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border bg-popover text-popover-foreground shadow-lg">
          {isFetching ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">{ar ? 'جارٍ البحث…' : 'Searching…'}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">{ar ? 'لا توجد منتجات مطابقة.' : 'No matching products.'}</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {results.map(product => (
                <li key={product.id}>
                  <button type="button" className="flex w-full items-start gap-2 px-3 py-2 text-start hover:bg-muted" onClick={() => choose(product)}>
                    <Package className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{product.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{product.brand || '—'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {selected && <Badge variant="secondary" className="mt-1">{selected.brand || '—'}</Badge>}
    </div>
  );
}
