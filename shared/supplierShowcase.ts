/**
 * ── SUPPLIER SHOWCASE ───────────────────────────────────────────────────
 *
 * CLAUDE.md §18 keeps three things apart, and they are not variations of
 * one idea:
 *
 *   FEATURED           BuildHub editorial curation. Admin authority.
 *   SPONSORED          commercial promotion. Admin-granted, bounded by
 *                      dates, revocable, priced later.
 *   SUPPLIER SHOWCASE  the supplier's own emphasis, WITHIN THEIR OWN
 *                      STOREFRONT.
 *
 * ── THE CONFINEMENT RULE, WHICH IS THE WHOLE INTEGRITY QUESTION ─────────
 *
 * A showcase selection must never influence marketplace discovery, category
 * ranking, search ordering, or any surface shared with another supplier.
 *
 * The reason is not tidiness. If a supplier's own pick could move them in a
 * shared list, they would have granted themselves a placement: Sponsored
 * inventory with no admin decision behind it, no period, no revocation and
 * no label. It would silently break the one ordering rule §18 states -
 * FEATURED, then clearly labelled SPONSORED, then ORGANIC - because a fourth
 * kind of promotion would be competing in it unannounced, and BuildHub could
 * not tell a buyer why one supplier appeared above another.
 *
 * So the showcase is confined BY CONSTRUCTION: the only reader that resolves
 * it is the one storefront it belongs to, keyed by that supplier's id. There
 * is no scope, no surface and no priority field for it to leak through,
 * because none is defined here.
 *
 * ── WHY IT IS NOT A `vendorSponsorships` ROW ────────────────────────────
 *
 * That table carries grantedBy, grantedReason, revokedAt, revokedBy,
 * startsAt, endsAt, priority, package and surface. Every one of them is an
 * ADMIN decision about a SHARED surface. A showcase has none: no granting
 * authority, no period, no priority against anybody else, no surface beyond
 * the supplier's own page.
 *
 * §11 says reuse a canonical system. It does not say put unlike things in
 * one table because the columns nearly fit - and here the cost of doing so
 * would be a showcase row sitting in the store the placement engine reads,
 * one missing WHERE clause away from becoming real marketplace placement.
 */

/**
 * The three things a storefront actually renders, so the three things a
 * supplier can emphasise on it. Nothing else is showcaseable, because
 * nothing else is on the page to be emphasised.
 */
export const SHOWCASE_ITEM_KINDS = ['product', 'service', 'portfolio'] as const;
export type ShowcaseItemKind = (typeof SHOWCASE_ITEM_KINDS)[number];

export function isShowcaseItemKind(value: unknown): value is ShowcaseItemKind {
  return typeof value === 'string'
    && (SHOWCASE_ITEM_KINDS as readonly string[]).includes(value);
}

/**
 * SIX, AND THE LIMIT IS THE POINT.
 *
 * A showcase that can hold the whole catalogue is not emphasis - it is the
 * catalogue again, one section higher, and a buyer learns nothing from it.
 * The supplier is being asked to choose.
 */
export const MAX_SHOWCASE_ITEMS = 6;

/** One entry as the client sends it and the server stores it. */
export type ShowcaseEntry = {
  kind: ShowcaseItemKind;
  itemId: number;
};

export function showcaseKey(kind: string, itemId: number): string {
  return `${kind}:${itemId}`;
}

/**
 * Normalise a submitted selection: drop malformed entries, de-duplicate, and
 * bound it.
 *
 * DE-DUPLICATION MATTERS MORE THAN IT LOOKS. The same product twice is two
 * slots spent on one thing, and with a cap of six that is a third of the
 * showcase silently lost. The client cannot be trusted to have deduplicated;
 * the server calls this too.
 */
export function normaliseShowcase(entries: readonly unknown[]): ShowcaseEntry[] {
  const seen = new Set<string>();
  const out: ShowcaseEntry[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as { kind?: unknown; itemId?: unknown };
    if (!isShowcaseItemKind(candidate.kind)) continue;
    const itemId = Number(candidate.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) continue;
    const key = showcaseKey(candidate.kind, itemId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: candidate.kind, itemId });
    if (out.length >= MAX_SHOWCASE_ITEMS) break;
  }
  return out;
}

/** What each kind is called, in both languages. Never a raw enum (§55). */
export function showcaseKindLabel(kind: string, lang: 'en' | 'ar'): string {
  const ar = lang === 'ar';
  switch (kind) {
    case 'product': return ar ? 'منتج' : 'Product';
    case 'service': return ar ? 'خدمة' : 'Service';
    case 'portfolio': return ar ? 'عمل سابق' : 'Past work';
    default: return kind;
  }
}
