import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { appRouter } from './routers';
import { getDb } from './db';
import { authorizeStorageKey } from './_core/storageProxy';
import type { TrpcContext } from './_core/context';
import { MAX_PRODUCT_IMAGES } from '@shared/productImages';

/**
 * SUPPLIER CATALOGUE MANAGEMENT.
 *
 * `marketplace.create` existed and nothing else did. A supplier could list a
 * product and then never correct a price, fix a typo, add a photo, or take it
 * down. `products.images` was read by three surfaces and written by none, and
 * `products.active` gated buyer visibility while nothing could ever set it.
 *
 * The interesting tests are the refusals. "A supplier can edit their product"
 * is the easy half; "and cannot touch anybody else's" is the half that decides
 * whether this is safe to put in front of real suppliers.
 */

function ctxFor(id: number, over: Partial<TrpcContext['user']> = {}): TrpcContext {
  return {
    user: {
      id, openId: `u-${id}`, email: `u${id}@t.com`, name: `User ${id}`, username: `u${id}`,
      loginMethod: 'password', role: 'user', userRole: 'supplier',
      accountStatus: 'active', onboardingStatus: 'approved', isDummy: false,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
      ...over,
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  };
}

/**
 * The stub returns whatever ownership row the test declares and records writes.
 * It does NOT apply the predicate itself - the procedure's own ownership check
 * is what is under test, and a stub that pre-filtered would do the procedure's
 * job and let every refusal pass for free.
 */
function stubDb(ownedRow: Record<string, unknown> | null, laterRows: unknown[][] = []) {
  const setCalls: Record<string, unknown>[] = [];
  // The FIRST select is the ownership row every procedure here reads. Anything
  // after it - the live-placement lookup the archive guard makes - is answered
  // from `laterRows`, which defaults to empty. Returning the ownership row to
  // every query made the placement guard fire on a product with no placement,
  // which is a harness artefact wearing the costume of a product rule.
  let call = 0;
  const set = vi.fn((patch: Record<string, unknown>) => {
    setCalls.push(patch);
    return { where: vi.fn().mockResolvedValue(undefined) };
  });
  const update = vi.fn(() => ({ set }));
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
    select: vi.fn(() => ({
      from: () => ({
        // `.limit()` as well as a bare await: the lifecycle service reads its
        // row with `.limit(1)`, and a stub missing that would fail the
        // procedure for a harness reason rather than a product one.
        where: () => {
          const answer = () => {
            const first = call++ === 0;
            return Promise.resolve(first ? (ownedRow ? [ownedRow] : []) : (laterRows.shift() ?? []));
          };
          let pending: Promise<unknown> | null = null;
          const take = () => (pending ??= answer());
          return Object.assign(take(), { limit: () => take() });
        },
        innerJoin: () => ({ where: () => Promise.resolve(ownedRow ? [ownedRow] : []) }),
      }),
    })),
    update,
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([{ insertId: 11 }]) })),
  });
  return { update, setCalls };
}

const OWNER = 5;
const mine = { id: 3 };
const img = (n: number) => `/manus-storage/product-images/user-${OWNER}/photo${n}.png`;

// ══ 1. EDITING ═════════════════════════════════════════════════════════════

describe('updateProduct', () => {
  it('the owner can change a price - the positive control', async () => {
    const { update, setCalls } = stubDb(mine);
    const result = await appRouter.createCaller(ctxFor(OWNER)).marketplace
      .updateProduct({ id: 3, price: 1250.5 });
    expect(result).toEqual({ id: 3 });
    expect(update).toHaveBeenCalledTimes(1);
    // decimal(12,2) is a string column; a number would be coerced silently.
    expect(setCalls[0]).toEqual({ price: '1250.5' });
  });

  it('a product that is not yours is NOT_FOUND, and nothing is written', async () => {
    // The stub returns no owned row, which is what the real predicate does for
    // somebody else's product.
    const { update } = stubDb(null);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace.updateProduct({ id: 3, price: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(update).not.toHaveBeenCalled();
  });

  it('a PATCH does not blank the fields it omits', async () => {
    // The defect this prevents: `set({...input})` writes undefined over every
    // column the caller did not send, silently clearing a description.
    const { setCalls } = stubDb(mine);
    await appRouter.createCaller(ctxFor(OWNER)).marketplace
      .updateProduct({ id: 3, brand: 'Acme' });
    // ASSERTED ON THE KEYS, not with toEqual - toEqual treats a property whose
    // value is `undefined` as equal to an absent one, which makes it a poor
    // instrument for exactly this question.
    //
    // HONEST NOTE: replacing the procedure's filter loop with `{ ...rest }`
    // does NOT break this, and that is not a gap in the test. zod omits absent
    // optionals rather than setting them to undefined, so over JSON the two
    // forms are equivalent. What this pins is the OUTCOME - only the field the
    // caller sent is written - which is the property that matters however the
    // implementation gets there.
    expect(Object.keys(setCalls[0]).sort()).toEqual(['brand']);
    expect(setCalls[0].brand).toBe('Acme');
  });

  it('a patch with no fields writes nothing at all', async () => {
    const { update } = stubDb(mine);
    const result = await appRouter.createCaller(ctxFor(OWNER)).marketplace.updateProduct({ id: 3 });
    expect(result).toEqual({ id: 3 });
    expect(update).not.toHaveBeenCalled();
  });

  it('REFUSES a negative price - that is not a discount', async () => {
    stubDb(mine);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace.updateProduct({ id: 3, price: -1 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('REFUSES negative stock and an absurd lead time', async () => {
    stubDb(mine);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace.updateProduct({ id: 3, stock: -5 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace.updateProduct({ id: 3, deliveryDays: 99999 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('REFUSES clearing a notNull column to empty', async () => {
    stubDb(mine);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace.updateProduct({ id: 3, name: '' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('a non-supplier role is FORBIDDEN even if approved', async () => {
    stubDb(mine);
    await expect(
      appRouter.createCaller(ctxFor(OWNER, { userRole: 'contractor' })).marketplace
        .updateProduct({ id: 3, price: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// ══ 2. PUBLISH / DELIST ════════════════════════════════════════════════════

describe('setProductStatus', () => {
  /**
   * This replaced `setProductActive(active: boolean)`. The three claims the old
   * tests made are all still made below - the owner can move a product, cannot
   * touch anybody else's, and taking one down UPDATES rather than deletes - but
   * a boolean could only say two things, so the questions "is this a draft" and
   * "was this discontinued" had no answer at all. The transition table itself
   * is pinned in productLifecycle.test.ts; these are the procedure's claims.
   */
  const live = { id: 3, supplierId: OWNER, status: 'active' as const };
  const off = { id: 3, supplierId: OWNER, status: 'inactive' as const };

  it('the owner can take a live product off sale, and put it back', async () => {
    const { setCalls } = stubDb(live);
    const result = await appRouter.createCaller(ctxFor(OWNER)).marketplace
      .setProductStatus({ id: 3, status: 'inactive' });
    expect(result).toMatchObject({ ok: true, from: 'active', to: 'inactive' });
    expect(setCalls[0]).toMatchObject({ status: 'inactive', active: false });

    const { setCalls: back } = stubDb(off);
    await appRouter.createCaller(ctxFor(OWNER)).marketplace.setProductStatus({ id: 3, status: 'active' });
    expect(back[0]).toMatchObject({ status: 'active', active: true });
  });

  it('THE LEGACY BOOLEAN IS DERIVED, never sent by the caller', async () => {
    // `products.active` is kept for one migration so the 0049 backfill stays
    // reversible by inspection. If it could be set independently of the status
    // the two would disagree, which is the exact shape this codebase has been
    // burned by before.
    const { setCalls } = stubDb(live);
    await appRouter.createCaller(ctxFor(OWNER)).marketplace.setProductStatus({ id: 3, status: 'archived' });
    expect(setCalls[0]).toMatchObject({ status: 'archived', active: false });
  });

  it('cannot move somebody else\'s product, and is told NOT FOUND rather than FORBIDDEN', async () => {
    const { update } = stubDb({ id: 3, supplierId: OWNER + 1, status: 'active' });
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace.setProductStatus({ id: 3, status: 'inactive' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(update).not.toHaveBeenCalled();
  });

  it('a product that does not exist answers the same way', async () => {
    const { update } = stubDb(null);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace.setProductStatus({ id: 3, status: 'inactive' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(update).not.toHaveBeenCalled();
  });

  it('taking a product down UPDATES rather than deletes', async () => {
    // Questions, quotations, placements and history reference the row.
    // Destroying it to hide it would take the history with it - which is why
    // there is no delete in this vocabulary at all.
    const { update } = stubDb(live);
    await appRouter.createCaller(ctxFor(OWNER)).marketplace.setProductStatus({ id: 3, status: 'archived' });
    expect(update).toHaveBeenCalled();
  });

  it('ARCHIVING A PRODUCT WITH A LIVE PLACEMENT IS REFUSED, not silently accepted', async () => {
    // A paid slot points at this row and publicPlacement filters on the same
    // status, so archiving would leave the placement rendering nothing while
    // the vendor's entitlement went on being consumed. Telling the supplier to
    // end the placement first is a real answer; quietly breaking it is not.
    const { update } = stubDb(live, [[{ id: 77 }]]);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace.setProductStatus({ id: 3, status: 'archived' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(update).not.toHaveBeenCalled();
  });

  it('an UNDECLARED move is refused, and the refusal names both states', async () => {
    const { update } = stubDb({ id: 3, supplierId: OWNER, status: 'archived' });
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace.setProductStatus({ id: 3, status: 'active' }),
    ).rejects.toThrow(/Archived.*Live/);
    expect(update).not.toHaveBeenCalled();
  });

  it('a non-supplier provider is refused even though the tier lets them in', async () => {
    const { update } = stubDb(live);
    await expect(
      appRouter.createCaller(ctxFor(OWNER, { userRole: 'contractor' })).marketplace
        .setProductStatus({ id: 3, status: 'inactive' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(update).not.toHaveBeenCalled();
  });
});

// ══ 3. IMAGES — THE OWNERSHIP RULE THAT MATTERS ════════════════════════════

describe('setProductImages', () => {
  it('accepts the supplier\'s own images, in order', async () => {
    const { setCalls } = stubDb(mine);
    const images = [img(1), img(2)];
    const result = await appRouter.createCaller(ctxFor(OWNER)).marketplace
      .setProductImages({ id: 3, images });
    expect(result).toEqual({ id: 3, images });
    // Stored as a JSON array, which is what parseProductImages reads.
    expect(JSON.parse(String(setCalls[0].images))).toEqual(images);
  });

  it('ORDER IS PRESERVED - images[0] is the primary photo', async () => {
    const { setCalls } = stubDb(mine);
    await appRouter.createCaller(ctxFor(OWNER)).marketplace
      .setProductImages({ id: 3, images: [img(2), img(1)] });
    expect(JSON.parse(String(setCalls[0].images))[0]).toBe(img(2));
  });

  it('REFUSES an image uploaded by a DIFFERENT supplier', async () => {
    // The attack: point your listing at a competitor's photo. It would also
    // launder that key past the storage proxy via your own product row.
    const { update } = stubDb(mine);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace.setProductImages({
        id: 3,
        images: ['/manus-storage/product-images/user-999/stolen.png'],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(update).not.toHaveBeenCalled();
  });

  it('REFUSES a key outside the product-images prefix entirely', async () => {
    const { update } = stubDb(mine);
    for (const hostile of [
      `/manus-storage/rfq-attachments/user-${OWNER}/drawing.pdf`,
      `/manus-storage/registration/user-${OWNER}/licence.pdf`,
      'https://evil.example.com/tracker.png',
      `/manus-storage/product-images/user-${OWNER}/../../secret.png`,
    ]) {
      await expect(
        appRouter.createCaller(ctxFor(OWNER)).marketplace.setProductImages({ id: 3, images: [hostile] }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('REFUSES duplicates - "reorder" would otherwise be a lie', async () => {
    stubDb(mine);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace
        .setProductImages({ id: 3, images: [img(1), img(1)] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('REFUSES more images than the shared limit allows', async () => {
    stubDb(mine);
    const tooMany = Array.from({ length: MAX_PRODUCT_IMAGES + 1 }, (_, i) => img(i));
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace.setProductImages({ id: 3, images: tooMany }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('an empty list CLEARS the images rather than storing "[]"', async () => {
    const { setCalls } = stubDb(mine);
    await appRouter.createCaller(ctxFor(OWNER)).marketplace.setProductImages({ id: 3, images: [] });
    expect(setCalls[0].images).toBeNull();
  });

  it('cannot set images on somebody else\'s product', async () => {
    const { update } = stubDb(null);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace.setProductImages({ id: 3, images: [img(1)] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(update).not.toHaveBeenCalled();
  });

  it('checks the URL prefix BEFORE it checks ownership of the product', async () => {
    // Ordering matters: a hostile URL must be refused even when the product id
    // is one the caller does not own, so the two refusals cannot be used
    // together as an oracle for which products exist.
    stubDb(null);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace.setProductImages({
        id: 4242,
        images: ['/manus-storage/product-images/user-999/stolen.png'],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// ══ 4. UPLOAD VALIDATION ═══════════════════════════════════════════════════

describe('uploadProductImage', () => {
  // A one-pixel PNG. A test that uploads a made-up buffer proves nothing,
  // because the point of the check is that the BYTES are inspected.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  it('REFUSES a PDF, however it is declared', async () => {
    stubDb(mine);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace.uploadProductImage({
        fileName: 'spec.pdf',
        // @ts-expect-error - deliberately outside the enum
        contentType: 'application/pdf',
        base64: PNG.toString('base64'),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('REFUSES bytes that disagree with the declared type', async () => {
    // An executable wearing a .png extension is the case this stops.
    //
    // ASSERTED ON THE SPECIFIC REFUSAL. An earlier version used
    // `.rejects.toBeTruthy()`, which passed even with the byte check removed -
    // the call then reached storagePut, which throws because object storage is
    // unconfigured in tests. It rejected for the wrong reason and proved
    // nothing. BAD_REQUEST distinguishes "we looked at the bytes and refused"
    // from "something downstream fell over".
    stubDb(mine);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace.uploadProductImage({
        fileName: 'photo.png',
        contentType: 'image/png',
        base64: Buffer.from('MZ\x90\x00 not a png at all').toString('base64'),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('ACCEPTS a real PNG as far as the byte check - the positive control', async () => {
    // Without this, a build that refused EVERY upload would satisfy all the
    // refusals above. It fails at storage (unconfigured in tests), which is
    // downstream of validation and is exactly the boundary being asserted.
    stubDb(mine);
    await appRouter.createCaller(ctxFor(OWNER)).marketplace.uploadProductImage({
      fileName: 'photo.png', contentType: 'image/png', base64: PNG.toString('base64'),
    }).catch((error: { code: string }) => {
      expect(error.code).not.toBe('BAD_REQUEST');
    });
  });

  it('REFUSES an empty file', async () => {
    stubDb(mine);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace.uploadProductImage({
        fileName: 'photo.png', contentType: 'image/png', base64: '',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('a non-supplier role is FORBIDDEN', async () => {
    stubDb(mine);
    await expect(
      appRouter.createCaller(ctxFor(OWNER, { userRole: 'contractor' })).marketplace
        .uploadProductImage({ fileName: 'p.png', contentType: 'image/png', base64: PNG.toString('base64') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// ══ 5. THE STORAGE SIDE ════════════════════════════════════════════════════

describe('product images are readable, and that is deliberate', () => {
  const buyer = {
    id: 77, role: 'user', userRole: 'homeowner', accountStatus: 'active',
  } as unknown as Parameters<typeof authorizeStorageKey>[1];

  it('any authenticated user may fetch a product photo', async () => {
    // A product photo appears on the public marketplace card. Locking these to
    // the uploader would break every catalogue listing for every buyer - the
    // same failure the missing avatars/ branch caused once before.
    await expect(
      authorizeStorageKey('product-images/user-5/photo_ab12cd34.png', buyer),
    ).resolves.toBe(true);
  });

  it('an unauthenticated caller still gets nothing', async () => {
    await expect(authorizeStorageKey('product-images/user-5/photo.png', null)).resolves.toBe(false);
  });

  it('a traversal key is still refused', async () => {
    await expect(
      authorizeStorageKey('product-images/../../etc/passwd', buyer),
    ).resolves.toBe(false);
  });
});
