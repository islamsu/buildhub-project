import { useCallback, useEffect, useState } from 'react';
import {
  addToBasket, basketSubtotal, parseBasket, removeFromBasket,
  setQuantity as setItemQuantity, setSpecifications as setItemSpecifications,
  MAX_BASKET_ITEMS, type BasketItem,
} from '@shared/rfqBasket';

/**
 * THE RFQ BASKET.
 *
 * What was here before: a single localStorage key, `bh-rfq-product`, written
 * with setItem. Adding a second product OVERWROTE the first, under a button
 * labelled "Add to RFQ list". On the marketplace grid the same button fired a
 * success toast and did nothing at all.
 *
 * One key, holding an ARRAY, with every mutation going through the shared
 * reducer in @shared/rfqBasket so the browser and the server agree on the
 * limits.
 */
const STORAGE_KEY = 'bh-rfq-basket';
/** The account the basket belongs to, so it cannot survive into another one. */
const OWNER_KEY = 'bh-rfq-basket-owner';

/** Same-tab listeners: `storage` only fires in OTHER tabs. */
const listeners = new Set<() => void>();
function announce() { listeners.forEach(notify => notify()); }

function read(): BasketItem[] {
  try { return parseBasket(localStorage.getItem(STORAGE_KEY)); } catch { return []; }
}
function write(items: BasketItem[]) {
  try {
    if (items.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch { /* private mode, quota - the basket is a convenience, not a record */ }
  announce();
}

/**
 * THE BASKET DOES NOT CROSS AN ACCOUNT BOUNDARY.
 *
 * A basket left behind by the previous user of a shared machine, reappearing
 * under the next person's account, is the same class of fault as a stale
 * cached record - even though the contents are public catalogue ids. Called
 * with the current user id (or null when signed out); a change clears it.
 */
export function reconcileBasketOwner(userId: number | null) {
  try {
    const previous = localStorage.getItem(OWNER_KEY);
    const current = userId == null ? '' : String(userId);
    if (previous !== null && previous !== current) {
      localStorage.removeItem(STORAGE_KEY);
      announce();
    }
    if (current) localStorage.setItem(OWNER_KEY, current);
    else localStorage.removeItem(OWNER_KEY);
  } catch { /* storage unavailable */ }
}

/**
 * Clear the basket outright. Called from the logout path so it does not depend
 * on a React effect running afterwards - a logout that navigates away, or one
 * driven by an expired session, must still leave nothing behind.
 */
export function clearBasketStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(OWNER_KEY);
  } catch { /* storage unavailable */ }
  announce();
}

export function useRfqBasket() {
  const [items, setItems] = useState<BasketItem[]>(() => read());

  useEffect(() => {
    const refresh = () => setItems(read());
    listeners.add(refresh);
    // Another tab of the same browser.
    window.addEventListener('storage', refresh);
    return () => { listeners.delete(refresh); window.removeEventListener('storage', refresh); };
  }, []);

  const add = useCallback((item: Omit<BasketItem, 'key'>) => {
    const next = addToBasket(read(), item);
    write(next);
    setItems(next);
    // `addToBasket` refuses silently past the cap; the caller needs to know.
    return next.length > read().length - 1 && next.length <= MAX_BASKET_ITEMS;
  }, []);

  const update = useCallback((key: string, quantity: number) => {
    const next = setItemQuantity(read(), key, quantity);
    write(next); setItems(next);
  }, []);

  const remove = useCallback((key: string) => {
    const next = removeFromBasket(read(), key);
    write(next); setItems(next);
  }, []);

  const specify = useCallback((key: string, specifications: string) => {
    const next = setItemSpecifications(read(), key, specifications);
    write(next); setItems(next);
  }, []);

  const clear = useCallback(() => { write([]); setItems([]); }, []);

  return {
    items,
    count: items.length,
    /** Total UNITS, which is what a "3 items" badge should mean to a buyer. */
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: basketSubtotal(items),
    isFull: items.length >= MAX_BASKET_ITEMS,
    add, update, remove, specify, clear,
  };
}
