/**
 * THE RFQ ID CARRIED IN A LINK.
 *
 * `/rfq/:id` sends a provider to `/provider?rfq=<id>` so they arrive at the
 * request they were reading rather than on a generic dashboard. That id comes
 * out of a URL, which means it comes from whoever wrote the link - a bookmark,
 * a shared message, an address bar somebody typed into.
 *
 * It is not a security boundary: every procedure it eventually reaches is
 * authorized server-side, and this value only decides which row to scroll to
 * and which id to preselect in a form. But it IS the point where an arbitrary
 * string becomes a number used as a mutation argument, so it is parsed in one
 * place with one rule instead of being coerced at each use site.
 *
 * Anything that is not a positive integer becomes `undefined`, which every
 * caller treats as "no linked request" - the pre-existing behaviour. `0` is
 * rejected along with the rest: it is the sentinel the quotation form uses for
 * "nothing selected", so accepting it from a URL would let a link produce a
 * form that looks targeted and is not.
 */
export function parseLinkedRfqId(search: string | null | undefined): number | undefined {
  if (!search) return undefined;
  const raw = new URLSearchParams(search).get('rfq');
  if (raw === null || raw.trim() === '') return undefined;
  // Number() accepts '1e3', ' 12 ', '0x10' and '12.0'. An id in a link is
  // written in decimal digits or it is not an id, so the shape is checked
  // before the conversion rather than after it.
  if (!/^[0-9]+$/.test(raw.trim())) return undefined;
  const parsed = Number(raw.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
