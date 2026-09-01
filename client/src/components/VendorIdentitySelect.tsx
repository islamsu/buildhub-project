import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Building2, BadgeCheck, Search, X } from 'lucide-react';

type VendorHit = {
  id: number;
  name: string;
  email: string | null;
  userRole: string | null;
  location: string | null;
  verified: boolean | null;
  accountStatus: string | null;
  companyName: string | null;
  tradingName: string | null;
};

export default function VendorIdentitySelect({
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
  const [selected, setSelected] = useState<VendorHit | null>(null);
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

  const { data: results = [], isFetching } = trpc.admin.vendorSearch.useQuery(
    { query: debounced },
    { enabled: debounced.length >= 2 },
  );

  const choose = (vendor: VendorHit) => {
    setSelected(vendor);
    setSearchText('');
    setOpen(false);
    onChange(vendor.id);
  };

  const clear = () => {
    setSelected(null);
    setSearchText('');
    setOpen(false);
    onChange(null);
  };

  return (
    <div className="relative" ref={boxRef}>
      <label className="text-xs text-muted-foreground" htmlFor={testId}>{label}</label>
      {selected ? (
        <div className="mt-1 flex min-h-9 items-start justify-between gap-2 rounded-md border bg-muted/20 px-2 py-1.5">
          <span className="min-w-0">
            <span className="block truncate text-sm">
              {selected.companyName || selected.name}
              {selected.verified && <BadgeCheck className="ms-1 inline h-3.5 w-3.5 text-emerald-600" />}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {selected.userRole ?? ''}
              {selected.email ? ` · ${selected.email}` : ''}
              {selected.location ? ` · ${selected.location}` : ''}
              {selected.accountStatus ? ` · ${selected.accountStatus === 'frozen' ? (ar ? 'معلّق' : 'Suspended') : (ar ? 'نشط' : 'Active')}` : ''}
            </span>
          </span>
          <button type="button" onClick={clear} aria-label={ar ? 'مسح المورّد' : 'Clear vendor'}>
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      ) : (
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={testId}
            data-testid={testId}
            className="h-9 ps-8"
            placeholder={ar ? 'ابحث بالاسم أو الشركة أو البريد…' : 'Search by name, company or email…'}
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
            <p className="px-3 py-3 text-sm text-muted-foreground">{ar ? 'لا يوجد مورّدون مطابقون.' : 'No matching vendors.'}</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {results.map(vendor => (
                <li key={vendor.id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 px-3 py-2 text-start hover:bg-muted"
                    onClick={() => choose(vendor)}
                  >
                    <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 font-medium">
                        {vendor.companyName || vendor.name}
                        {vendor.verified && <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" />}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {vendor.userRole ?? ''}{vendor.email ? ` · ${vendor.email}` : ''}{vendor.location ? ` · ${vendor.location}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selected && (
        <Badge variant="secondary" className="mt-1">
          {selected.userRole || '—'}
        </Badge>
      )}
    </div>
  );
}
