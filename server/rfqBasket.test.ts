import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  addToBasket, basketItemKey, basketSubtotal, clampQuantity, parseBasket,
  removeFromBasket, setQuantity, setSpecifications,
  MAX_BASKET_ITEMS, MAX_ITEM_QUANTITY, MIN_ITEM_QUANTITY,
} from '@shared/rfqBasket';

vi.mock('./db', () => ({ getDb: vi.fn() }));
import { appRouter } from './routers';
import { getDb } from './db';
import type { TrpcContext } from './_core/context';

/**
 * THERE WAS NO RFQ BASKET.
 *
 * Two buttons said there was. On the marketplace grid, "Add to RFQ list" ran
 *
 *     onClick={event => { event.stopPropagation(); toast.success('Added to RFQ list'); }}
 *
 * and did nothing else - no storage, no state, no navigation. Proven live:
 * localStorage was byte-identical before and after the click, and the customer
 * was told their product had been added to a list that did not exist.
 *
 * On the product page it wrote ONE localStorage key with setItem, so adding a
 * second product silently discarded the first. Proven live: after adding
 * product 1 then product 2 the stored value was {"productId":2,...} and
 * product 1 was gone - under a button labelled "list" / "قائمة".
 *
 * Underneath both, the RFQ could not represent items at all: no rfqItems
 * table, no quantity column, no unit, no specification. A customer pricing a
 * bathroom needs tiles AND cement AND rebar in one request.
 */

/**
 * A FRESH USER ID PER TEST. `rfq.create` is rate-limited per user, so tests
 * sharing one id start failing with TOO_MANY_REQUESTS partway through the file
 * - which looks like a defect in the procedure and is a defect in the fixture.
 */
let nextUserId = 9000;
const freshCaller = () => appRouter.createCaller(ctx(nextUserId += 1));

const ctx = (id: number): TrpcContext => ({
  user: {
    id, openId: `u${id}`, email: `u${id}@t.com`, name: 'U', username: `u${id}`,
    loginMethod: 'password', role: 'user', userRole: 'homeowner',
    accountStatus: 'active', onboardingStatus: 'approved', isDummy: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as TrpcContext['user'],
  req: { protocol: 'https', headers: {} } as TrpcContext['req'],
  res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
});

const item = (over: Partial<Parameters<typeof addToBasket>[1]> = {}) => ({
  productId: 1, name: 'Rebar 12mm', variantLabel: null, quantity: 1,
  unit: 'tonne', specifications: null, unitPrice: 1200, ...over,
});

// ══ 1. THE BASKET HOLDS MORE THAN ONE THING ════════════════════════════════

describe('the basket is a list', () => {
  it('a second product does not replace the first', () => {
    // The exact defect, in one assertion.
    let basket = addToBasket([], item({ productId: 1, name: 'Rebar' }));
    basket = addToBasket(basket, item({ productId: 2, name: 'Cement' }));
    expect(basket).toHaveLength(2);
    expect(basket.map(row => row.productId)).toEqual([1, 2]);
  });

  it('holds a realistic multi-trade request', () => {
    let basket: ReturnType<typeof addToBasket> = [];
    for (const [id, name] of [[1, 'Rebar'], [2, 'Cement'], [3, 'Tile'], [4, 'Grout']] as const) {
      basket = addToBasket(basket, item({ productId: id, name }));
    }
    expect(basket).toHaveLength(4);
  });

  it('adding the same product twice raises the quantity instead of duplicating it', () => {
    // "I clicked add twice" means two of them, not list it twice - and a
    // supplier reading two identical lines cannot tell which was meant.
    let basket = addToBasket([], item({ quantity: 2 }));
    basket = addToBasket(basket, item({ quantity: 3 }));
    expect(basket).toHaveLength(1);
    expect(basket[0].quantity).toBe(5);
  });

  it('the same product in a DIFFERENT variant is a separate line', () => {
    let basket = addToBasket([], item({ variantLabel: 'bag' }));
    basket = addToBasket(basket, item({ variantLabel: 'pallet' }));
    expect(basket).toHaveLength(2);
  });

  it('refuses to grow past the cap rather than accepting an unbounded list', () => {
    let basket: ReturnType<typeof addToBasket> = [];
    for (let i = 1; i <= MAX_BASKET_ITEMS + 5; i += 1) {
      basket = addToBasket(basket, item({ productId: i, name: `Item ${i}` }));
    }
    expect(basket).toHaveLength(MAX_BASKET_ITEMS);
  });
});

// ══ 2. QUANTITY, REMOVAL, SPECIFICATIONS ═══════════════════════════════════

describe('the customer can change what they asked for', () => {
  it('a quantity can be changed', () => {
    const basket = setQuantity(addToBasket([], item()), basketItemKey(1, null), 40);
    expect(basket[0].quantity).toBe(40);
  });

  it('a line can be removed', () => {
    let basket = addToBasket([], item({ productId: 1 }));
    basket = addToBasket(basket, item({ productId: 2 }));
    basket = removeFromBasket(basket, basketItemKey(1, null));
    expect(basket.map(row => row.productId)).toEqual([2]);
  });

  it('a specification can be attached to one line without touching the others', () => {
    let basket = addToBasket([], item({ productId: 1 }));
    basket = addToBasket(basket, item({ productId: 2 }));
    basket = setSpecifications(basket, basketItemKey(1, null), 'Grade 60, mill certificate');
    expect(basket[0].specifications).toBe('Grade 60, mill certificate');
    expect(basket[1].specifications).toBeNull();
  });

  it('a quantity is bounded at both ends and never becomes zero', () => {
    expect(clampQuantity(0)).toBe(MIN_ITEM_QUANTITY);
    expect(clampQuantity(-5)).toBe(MIN_ITEM_QUANTITY);
    expect(clampQuantity(Number.NaN)).toBe(MIN_ITEM_QUANTITY);
    expect(clampQuantity(1e12)).toBe(MAX_ITEM_QUANTITY);
    expect(clampQuantity(2.345)).toBe(2.35);
  });

  it('the catalogue total is marked as reference, and absent when nothing is priced', () => {
    expect(basketSubtotal([])).toBeNull();
    expect(basketSubtotal(addToBasket([], item({ unitPrice: null })))).toBeNull();
    expect(basketSubtotal(addToBasket([], item({ quantity: 3, unitPrice: 100 })))).toBe(300);
  });
});

// ══ 3. STORAGE IS UNTRUSTED ════════════════════════════════════════════════

describe('a basket read back out of storage is not trusted', () => {
  it('survives malformed JSON without throwing', () => {
    expect(parseBasket('not json')).toEqual([]);
    expect(parseBasket('{"not":"an array"}')).toEqual([]);
    expect(parseBasket(null)).toEqual([]);
  });

  it('drops a line with no name rather than inventing one', () => {
    // A half-understood line silently becomes a wrong order.
    expect(parseBasket(JSON.stringify([{ productId: 1, quantity: 5 }]))).toEqual([]);
  });

  it('coerces a tampered quantity into the allowed range', () => {
    const parsed = parseBasket(JSON.stringify([{ name: 'X', productId: 1, quantity: -99999 }]));
    expect(parsed[0].quantity).toBe(MIN_ITEM_QUANTITY);
  });

  it('caps a storage-stuffed basket at the maximum', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ name: `X${i}`, productId: i + 1, quantity: 1 }));
    expect(parseBasket(JSON.stringify(many)).length).toBeLessThanOrEqual(MAX_BASKET_ITEMS);
  });

  it('de-duplicates keys that tampering could have introduced', () => {
    const dupes = [{ name: 'A', productId: 7, quantity: 1 }, { name: 'A again', productId: 7, quantity: 1 }];
    expect(parseBasket(JSON.stringify(dupes))).toHaveLength(1);
  });
});

// ══ 4. THE SERVER DOES NOT TRUST THE BASKET EITHER ═════════════════════════

function stubDb(catalogue: { id: number; name: string; unit: string | null; price: string | null; active: boolean }[]) {
  const inserted: { table: string; rows: unknown }[] = [];
  const tx = {
    insert: (table: unknown) => ({
      values: (rows: unknown) => {
        inserted.push({ table: String((table as { _?: { name?: string } })?._?.name ?? 'unknown'), rows });
        return Promise.resolve([{ insertId: 4242 }]);
      },
    }),
  };
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
    select: () => ({ from: () => ({ where: () => Promise.resolve(catalogue) }) }),
    transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx),
    insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
  });
  return inserted;
}
const PRODUCT = { id: 1, name: 'Rebar 12mm', unit: 'tonne', price: '1200.00', active: true };

describe('a catalogue line is re-read from the catalogue', () => {
  it('stores the CATALOGUE name, not the name the client sent', async () => {
    // A basket is editable in localStorage. Without this, a request could name
    // "Premium Italian Marble" while carrying a cement product's id.
    const inserted = stubDb([PRODUCT]);
    await freshCaller().rfq.create({
      title: 'Bathroom', category: 'Materials',
      items: [{ productId: 1, name: 'Premium Italian Marble', quantity: 2 }],
    });
    const items = inserted.find(row => Array.isArray(row.rows))?.rows as { name: string }[];
    expect(items[0].name).toBe('Rebar 12mm');
    expect(items[0].name).not.toBe('Premium Italian Marble');
  });

  it('refuses an item whose product does not exist', async () => {
    stubDb([]);
    await expect(
      freshCaller().rfq.create({
        title: 'X', category: 'Materials',
        items: [{ productId: 999999, name: 'Ghost', quantity: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses an item whose product has been WITHDRAWN', async () => {
    // A customer who thinks they asked for three things must not get two.
    stubDb([{ ...PRODUCT, active: false }]);
    await expect(
      freshCaller().rfq.create({
        title: 'X', category: 'Materials',
        items: [{ productId: 1, name: 'Rebar 12mm', quantity: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('a free-text line keeps the customer\'s own words', async () => {
    const inserted = stubDb([]);
    await freshCaller().rfq.create({
      title: 'X', category: 'Materials',
      items: [{ productId: null, name: 'Bespoke steel staircase', quantity: 1, unit: 'job' }],
    });
    const items = inserted.find(row => Array.isArray(row.rows))?.rows as { name: string; productId: number | null }[];
    expect(items[0]).toMatchObject({ name: 'Bespoke steel staircase', productId: null });
  });

  it('the unit falls back to the catalogue unit when the client sends none', async () => {
    const inserted = stubDb([PRODUCT]);
    await freshCaller().rfq.create({
      title: 'X', category: 'Materials',
      items: [{ productId: 1, name: 'Rebar 12mm', quantity: 3 }],
    });
    const items = inserted.find(row => Array.isArray(row.rows))?.rows as { unit: string }[];
    expect(items[0].unit).toBe('tonne');
  });

  it('rejects more lines than the cap, at the input boundary', async () => {
    stubDb([PRODUCT]);
    const tooMany = Array.from({ length: MAX_BASKET_ITEMS + 1 }, (_, i) => ({ productId: null, name: `L${i}`, quantity: 1 }));
    await expect(
      freshCaller().rfq.create({ title: 'X', category: 'Materials', items: tooMany }),
    ).rejects.toThrow();
  });

  it('rejects a quantity outside the column\'s range', async () => {
    stubDb([PRODUCT]);
    await expect(
      freshCaller().rfq.create({
        title: 'X', category: 'Materials',
        items: [{ productId: null, name: 'L', quantity: MAX_ITEM_QUANTITY * 10 }],
      }),
    ).rejects.toThrow();
  });

  it('an RFQ with no items is still a valid RFQ', async () => {
    // Not every request is a shopping list; a free-text brief is legitimate.
    const inserted = stubDb([]);
    await expect(
      freshCaller().rfq.create({ title: 'Advice needed', category: 'Materials' }),
    ).resolves.toMatchObject({ id: 4242 });
    expect(inserted.some(row => Array.isArray(row.rows))).toBe(false);
  });
});

// ══ 5. THE UI THAT LIED IS GONE ════════════════════════════════════════════

const MARKET = readSourceForAssertions(readFileSync(new URL('../client/src/pages/Marketplace.tsx', import.meta.url), 'utf8'));
const DETAIL = readSourceForAssertions(readFileSync(new URL('../client/src/pages/ProductDetail.tsx', import.meta.url), 'utf8'));
const RFQ = readSourceForAssertions(readFileSync(new URL('../client/src/pages/RFQPage.tsx', import.meta.url), 'utf8'));

describe('both buttons now do what they say', () => {
  it('the marketplace button no longer only fires a toast', () => {
    expect(MARKET).not.toMatch(/onClick=\{event => \{ event\.stopPropagation\(\); toast\.success\([^)]*\); \}\}/);
    expect(MARKET).toContain('basket.add({');
  });

  it('the product page no longer overwrites a single storage key', () => {
    expect(DETAIL).not.toContain("localStorage.setItem('bh-rfq-product'");
    expect(DETAIL).toContain('basket.add({');
  });

  it('the RFQ form sends the collected lines to the server', () => {
    expect(RFQ).toContain('items: basket.items.length > 0');
  });

  it('the basket is emptied only after the RFQ exists', () => {
    // Clearing on click would lose the lines if the mutation failed.
    const success = RFQ.slice(RFQ.indexOf('onSuccess'), RFQ.indexOf('onError'));
    expect(success).toContain('basket.clear()');
  });

  it('quantity and removal are reachable in the review panel', () => {
    expect(RFQ).toContain('data-testid="rfq-basket-quantity"');
    expect(RFQ).toContain('data-testid="rfq-basket-remove"');
    expect(RFQ).toContain('data-testid="rfq-basket-spec"');
  });

  it('every basket control carries an accessible name', () => {
    // A row of unlabelled number inputs is unusable with a screen reader.
    expect(RFQ).toMatch(/data-testid="rfq-basket-quantity"[\s\S]{0,200}aria-label=/);
    expect(RFQ).toMatch(/data-testid="rfq-basket-remove"[\s\S]{0,200}aria-label=/);
  });
});

// ══ 6. THE BASKET DOES NOT CROSS AN ACCOUNT BOUNDARY ═══════════════════════

const AUTH = readSourceForAssertions(readFileSync(new URL('../client/src/_core/hooks/useAuth.ts', import.meta.url), 'utf8'));
const HOOK = readSourceForAssertions(readFileSync(new URL('../client/src/hooks/useRfqBasket.ts', import.meta.url), 'utf8'));

describe('a basket left on a shared machine does not become the next person\'s', () => {
  it('logout clears it outright, not via an effect that may never run', () => {
    // A logout that navigates away, or one caused by an expired session, must
    // still leave nothing behind - so this cannot depend on a re-render.
    expect(AUTH).toContain('clearBasketStorage()');
    const logoutBody = AUTH.slice(AUTH.indexOf('const logout ='), AUTH.indexOf('const state ='));
    expect(logoutBody, 'the clear must be inside the logout path').toContain('clearBasketStorage()');
  });

  it('a change of identity also clears it', () => {
    expect(AUTH).toContain('reconcileBasketOwner(meQuery.data?.id ?? null)');
    expect(HOOK).toContain('export function reconcileBasketOwner');
  });

  it('the owner marker is removed on the way out, not left pointing at somebody', () => {
    const clearBody = HOOK.slice(HOOK.indexOf('export function clearBasketStorage'), HOOK.indexOf('export function useRfqBasket'));
    expect(clearBody).toContain('removeItem(STORAGE_KEY)');
    expect(clearBody).toContain('removeItem(OWNER_KEY)');
  });

  it('storage failure never breaks sign-out', () => {
    // Private mode and quota errors throw on localStorage access.
    const clearBody = HOOK.slice(HOOK.indexOf('export function clearBasketStorage'), HOOK.indexOf('export function useRfqBasket'));
    expect(clearBody).toContain('catch');
  });
});
