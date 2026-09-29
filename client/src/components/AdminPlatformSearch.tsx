/**
 * ── Finding the record (Part 48) ───────────────────────────────────────────
 *
 * This sits directly above the dispute investigation because that is where the
 * problem is: the investigation asks for a request id, and an administrator
 * taking a support call has a name, an email or a phrase from a title. Until
 * this existed, the investigation was reachable only by someone who already
 * knew the answer.
 *
 * A SEGMENT THIS ADMINISTRATOR MAY NOT READ IS NAMED, NOT HIDDEN. The server
 * returns `omitted` separately from an empty result, and this page prints it:
 * "requests - you do not have access". Rendering nothing would teach a
 * MARKETPLACE_ADMIN that a customer does not exist when in truth they simply
 * cannot look. Showing the segment is not a leak - the row count is not
 * revealed, only the fact that the door is closed to them.
 */

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { searchStatusLabel, type SearchSegment } from '@/lib/searchStatusLabels';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, AlertTriangle, Lock } from 'lucide-react';
// The one map from a result to a destination, held as data so a test can
// check every kind the server can emit against the routes App.tsx registers.
import { searchHitHref } from '@/lib/adminSearchDestinations';

const SEGMENT_LABEL: Record<string, { en: string; ar: string }> = {
  users: { en: 'People & businesses', ar: 'الأشخاص والشركات' },
  rfqs: { en: 'Requests', ar: 'الطلبات' },
  quotations: { en: 'Bids', ar: 'العروض' },
  products: { en: 'Products', ar: 'المنتجات' },
  projects: { en: 'Projects', ar: 'المشاريع' },
  disputes: { en: 'Disputes', ar: 'النزاعات' },
  tickets: { en: 'Support tickets', ar: 'تذاكر الدعم' },
  enquiries: { en: 'Vendor enquiries', ar: 'استفسارات الموردين' },
};

export default function AdminPlatformSearch() {
  const { lang, t } = useLanguage();
  const ar = lang === 'ar';
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');

  const enabled = query.trim().length > 0;
  const { data, isLoading, error } = trpc.admin.platformSearch.useQuery(
    { query: query.trim() || 'x' }, { enabled, retry: false },
  );

  const label = (key: string) => (SEGMENT_LABEL[key] ? (ar ? SEGMENT_LABEL[key].ar : SEGMENT_LABEL[key].en) : key);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="w-5 h-5" />
          {ar ? 'ابحث في المنصة' : 'Find a record'}
        </CardTitle>
        <p className="pt-2 text-sm text-muted-foreground">
          {ar
            ? 'اسم، شركة، بريد إلكتروني، أو مرجع سجل مثل DSP-2026-000012 أو ENQ-501-10. الأقسام التي لا تملك صلاحية قراءتها تُذكر صراحةً بدلاً من أن تظهر فارغة.'
            : 'A name, a company, an email address, or a record reference such as DSP-2026-000012 or ENQ-501-10. Sections you may not read are named rather than shown empty.'}
        </p>
        <div className="flex flex-wrap items-end gap-2 pt-3">
          <div className="w-full sm:w-80">
            <Input
              data-testid="search-input"
              placeholder={ar ? 'ابحث…' : 'Search…'}
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') setQuery(draft); }}
              aria-label={ar ? 'ابحث في المنصة' : 'Search the platform'}
            />
          </div>
          <Button data-testid="search-go" onClick={() => setQuery(draft)} disabled={!draft.trim()}>
            {ar ? 'ابحث' : 'Search'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!enabled && (
          <p className="text-sm text-muted-foreground" data-testid="search-empty">
            {ar
              ? 'ابحث باسم أو شركة أو بريد إلكتروني أو مرجع سجل — حساب، طلب، عرض، منتج، مشروع، نزاع، تذكرة دعم أو استفسار مورد.'
              : 'Search by name, company, email or record reference — accounts, requests, bids, products, projects, disputes, support tickets and vendor enquiries.'}
          </p>
        )}

        {enabled && isLoading && <p className="text-sm text-muted-foreground">…</p>}

        {enabled && error && (
          <p className="flex items-start gap-2 text-sm text-destructive" data-testid="search-error" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error.message}</span>
          </p>
        )}

        {enabled && data && (
          <div className="space-y-4" data-testid="search-results">
            {data.segments.map(segment => (
              <section key={segment.key} className="rounded-xl border" data-testid="search-segment" data-segment={segment.key}>
                <p className="flex items-center justify-between p-3 text-sm font-medium">
                  {label(segment.key)}
                  <Badge variant="outline">{segment.hits.length}</Badge>
                </p>
                {segment.hits.length === 0 ? (
                  <p className="border-t p-3 text-sm text-muted-foreground">{ar ? 'لا نتائج' : 'No matches'}</p>
                ) : segment.hits.map(hit => {
                  const href = searchHitHref(hit.link);
                  return (
                    <div
                      key={`${segment.key}-${hit.ref ?? hit.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-sm"
                      data-testid="search-hit"
                    >
                      <span className="min-w-0">
                        {/* THE HUMAN REFERENCE LEADS. A dispute is
                            DSP-2026-000012 to everyone who has discussed it;
                            the row id is technical metadata and sits second. */}
                        <span className="font-mono text-xs text-muted-foreground" data-testid="search-hit-id">
                          {hit.ref ?? `#${hit.id}`}
                        </span>{' '}
                        {href
                          ? <a className="underline underline-offset-2" href={href} data-testid="search-hit-link">{hit.label}</a>
                          : <span>{hit.label}</span>}
                        {hit.detail && <span className="text-muted-foreground"> · {hit.detail}</span>}
                      </span>
                      {/* The stored enum was rendered here - `in_progress`,
                          `awaiting_user`, `update_required` - in every one of
                          the eight segments, and identically in Arabic. The
                          label comes from the SEGMENT's own vocabulary rather
                          than from a ninth one written inside this card. */}
                      {hit.status && (
                        <Badge variant="secondary" data-testid={`search-status-${hit.id}`}>
                          {searchStatusLabel(segment.key as SearchSegment, hit.status, lang, t)}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}

            {data.omitted.length > 0 && (
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="search-omitted">
                <Lock className="h-3 w-3" />
                {ar ? 'أقسام لا تملك صلاحية قراءتها: ' : 'Sections you do not have access to: '}
                {data.omitted.map(key => (
                  <Badge key={key} variant="outline" data-testid="search-omitted-item" data-segment={key}>
                    {label(key)}
                  </Badge>
                ))}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
