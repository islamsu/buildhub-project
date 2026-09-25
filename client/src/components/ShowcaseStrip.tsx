import { Link } from 'wouter';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { showcaseKindLabel } from '@shared/supplierShowcase';
import { Sparkles } from 'lucide-react';

/**
 * ── WHAT THIS SUPPLIER WANTS YOU TO SEE FIRST ───────────────────────────
 *
 * CLAUDE.md §18 names three kinds of emphasis and forbids merging them. This
 * is the third, and the label says whose choice it is: "Selected by this
 * supplier". A buyer must be able to tell it apart from BuildHub's editorial
 * FEATURED and from a paid SPONSORED slot at a glance, because the three
 * carry completely different weight as evidence.
 *
 * It renders NOTHING when the supplier has chosen nothing. An empty
 * "Highlights" heading over a blank row is worse than no section: it reads as
 * a broken page rather than as a supplier who has not curated yet.
 *
 * NO BADGE COLOUR CARRIES THE MEANING (§56). The wording does; the badge is
 * emphasis on top of it.
 */
export default function ShowcaseStrip({ userId }: { userId: number }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const showcase = trpc.profile.showcase.useQuery({ userId }, { retry: false });

  const cards = showcase.data?.cards ?? [];
  // A failed read renders nothing rather than an empty state: this is an
  // optional emphasis strip, and "this supplier highlighted nothing" is a
  // claim the page has not earned when the query simply failed (§10).
  if (showcase.isError || cards.length === 0) return null;

  return (
    <Card className="mt-6" data-testid="showcase-strip">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          {ar ? 'مختارات المورّد' : 'Supplier highlights'}
          {/* WHOSE CHOICE THIS IS, said in words. Without this line a buyer
              cannot tell supplier-selected emphasis from BuildHub's own
              editorial Featured, and the two mean very different things. */}
          <Badge variant="outline" className="font-normal" data-testid="showcase-provenance">
            {ar ? 'اختيار المورّد' : 'Selected by this supplier'}
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {ar
            ? 'اختارها هذا المورّد بنفسه لعرضها أولاً. ليست ترشيحاً من BuildHub ولا مساحة مدفوعة.'
            : 'Chosen by this supplier to show first. Not a BuildHub recommendation, and not a paid placement.'}
        </p>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(card => (
          <Link
            key={`${card.kind}-${card.itemId}`}
            href={card.href}
            className="group flex gap-3 rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-accent/40"
            data-testid={`showcase-card-${card.kind}-${card.itemId}`}
          >
            {card.image ? (
              <img
                src={card.image}
                alt=""
                loading="lazy"
                /* Aspect-ratio controlled and cropped, never stretched (§57). */
                className="h-16 w-16 shrink-0 rounded-md object-cover"
              />
            ) : (
              <div className="h-16 w-16 shrink-0 rounded-md bg-muted" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium group-hover:underline">{card.title}</p>
              {card.subtitle && (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{card.subtitle}</p>
              )}
              <Badge variant="secondary" className="mt-1.5 text-[10px]">
                {showcaseKindLabel(card.kind, lang === 'ar' ? 'ar' : 'en')}
              </Badge>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
