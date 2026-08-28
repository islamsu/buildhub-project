/**
 * THE RFQ BASKET — one contract, used by the client that collects the items
 * and by the server that turns them into rows.
 *
 * WHY IT IS SHARED. The limits below are enforced on the server, which is the
 * only place enforcement counts. They live here so the browser can refuse the
 * same thing with a sensible message instead of letting a customer fill a
 * basket the server will reject on submit.
 *
 * WHY THE BASKET IS CLIENT-SIDE AND THE RFQ IS NOT. Browsing the catalogue is
 * public - `marketplace.list` is a publicProcedure and a visitor can collect
 * items before they have an account. A server-side basket would need a session
 * that does not exist yet. So the basket is a pre-submission draft in the
 * browser, and the DURABLE record is the RFQ and its rfqItems rows, written in
 * one transaction on submit. Nothing commercial depends on basket state.
 */

/** More lines than this is a bill of quantities, not a request for quotation. */
export const MAX_BASKET_ITEMS = 30;

/** Guards a decimal(12,2) column and rejects a fat-fingered order. */
export const MAX_ITEM_QUANTITY = 9_999_999;
export const MIN_ITEM_QUANTITY = 0.01;

export const MAX_ITEM_NAME = 255;
export const MAX_ITEM_UNIT = 40;
export const MAX_ITEM_VARIANT = 120;
export const MAX_ITEM_SPECIFICATIONS = 2000;

/** One line as the browser holds it, before it becomes a row. */
export type BasketItem = {
  /** Stable key for React and for de-duplication: productId + variant. */
  key: string;
  /** Null for a free-text line the customer typed themselves. */
  productId: number | null;
  name: string;
  variantLabel: string | null;
  quantity: number;
  unit: string | null;
  specifications: string | null;
  /** Catalogue price when added. Reference only - it is not a quotation. */
  unitPrice: number | null;
};

export function basketItemKey(productId: number | null, variantLabel: string | null): string {
  return `${productId ?? 'custom'}::${variantLabel ?? ''}`;
}

/**
 * Adding the same product+variant twice increases the quantity rather than
 * creating a second identical line. A customer who clicks "Add" twice means
 * "two of these", not "list this product two times" - and a supplier reading
 * two identical lines cannot tell which reading was intended.
 */
export function addToBasket(items: BasketItem[], incoming: Omit<BasketItem, 'key'>): BasketItem[] {
  const key = basketItemKey(incoming.productId, incoming.variantLabel);
  const existing = items.findIndex(item => item.key === key);
  if (existing >= 0) {
    const merged = [...items];
    merged[existing] = {
      ...merged[existing],
      quantity: clampQuantity(merged[existing].quantity + incoming.quantity),
    };
    return merged;
  }
  if (items.length >= MAX_BASKET_ITEMS) return items;
  return [...items, { ...incoming, key, quantity: clampQuantity(incoming.quantity) }];
}

export function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return MIN_ITEM_QUANTITY;
  // Two decimal places, matching the column. 0.005 must not round to zero.
  const rounded = Math.round(value * 100) / 100;
  return Math.min(MAX_ITEM_QUANTITY, Math.max(MIN_ITEM_QUANTITY, rounded));
}

export function setQuantity(items: BasketItem[], key: string, quantity: number): BasketItem[] {
  return items.map(item => item.key === key ? { ...item, quantity: clampQuantity(quantity) } : item);
}

export function removeFromBasket(items: BasketItem[], key: string): BasketItem[] {
  return items.filter(item => item.key !== key);
}

export function setSpecifications(items: BasketItem[], key: string, specifications: string): BasketItem[] {
  return items.map(item => item.key === key
    ? { ...item, specifications: specifications.slice(0, MAX_ITEM_SPECIFICATIONS) || null }
    : item);
}

/**
 * Reading a basket back out of storage. Anything malformed is DROPPED rather
 * than repaired: a half-understood line silently becomes a wrong order, and
 * localStorage is editable by anyone sitting at the machine.
 */
export function parseBasket(raw: string | null): BasketItem[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const items: BasketItem[] = [];
  for (const candidate of parsed.slice(0, MAX_BASKET_ITEMS)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const row = candidate as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.slice(0, MAX_ITEM_NAME) : '';
    if (!name) continue;
    const productId = typeof row.productId === 'number' && Number.isInteger(row.productId) && row.productId > 0
      ? row.productId : null;
    const quantity = typeof row.quantity === 'number' ? clampQuantity(row.quantity) : MIN_ITEM_QUANTITY;
    const variantLabel = typeof row.variantLabel === 'string' && row.variantLabel
      ? row.variantLabel.slice(0, MAX_ITEM_VARIANT) : null;
    items.push({
      key: basketItemKey(productId, variantLabel),
      productId,
      name,
      variantLabel,
      quantity,
      unit: typeof row.unit === 'string' && row.unit ? row.unit.slice(0, MAX_ITEM_UNIT) : null,
      specifications: typeof row.specifications === 'string' && row.specifications
        ? row.specifications.slice(0, MAX_ITEM_SPECIFICATIONS) : null,
      unitPrice: typeof row.unitPrice === 'number' && Number.isFinite(row.unitPrice) ? row.unitPrice : null,
    });
  }
  // De-duplicate keys that storage tampering could have introduced.
  const seen = new Set<string>();
  return items.filter(item => seen.has(item.key) ? false : (seen.add(item.key), true));
}

/** The indicative total, clearly not a price: nothing has been quoted yet. */
export function basketSubtotal(items: BasketItem[]): number | null {
  const priced = items.filter(item => item.unitPrice != null);
  if (priced.length === 0) return null;
  return priced.reduce((sum, item) => sum + (item.unitPrice ?? 0) * item.quantity, 0);
}
