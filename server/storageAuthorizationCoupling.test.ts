import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * THIS TRIPWIRE FIRED, AND THIS FILE IS ITS SECOND EDITION.
 *
 * The first edition guarded a rule it did not agree with. storageProxy served
 * anything under `rfq-attachments/` to any authenticated user, justified by a
 * comment saying rfq.list and rfq.get already exposed full RFQ detail to any
 * authenticated user - which was true when it was written. This file existed to
 * fail loudly the moment that stopped being true, and named the file that would
 * have to change with it.
 *
 * Slice 9 narrowed RFQ visibility: rfq.list gained a column allowlist that omits
 * `attachments`, and rfq.get became owner-scoped. The proxy did not narrow with
 * it, which is exactly the divergence predicted here - the storage layer was
 * left as the loosest surface, still serving requesters' drawings, BOQs and site
 * photos to anyone who could name a key.
 *
 * The proxy has now been narrowed to match: the requester, plus any provider who
 * has PAID to open a qualified enquiry on that RFQ. These tests guard the NEW
 * coupling in the same spirit - they fail if the proxy drifts back toward a
 * prefix-only rule, or if the paid-enquiry gate stops being what buys access.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const ROUTERS = read('../server/routers.ts');
const PROXY = read('../server/_core/storageProxy.ts');

/** The rfq router's own list/get declarations, isolated from other routers. */
const rfqBlock = () => {
  const start = ROUTERS.indexOf('const rfqRouter');
  expect(start, 'rfqRouter not found - this test needs rewiring').toBeGreaterThan(-1);
  return ROUTERS.slice(start, start + 4000);
};

/**
 * The body of authorizeStorageKey, sliced by real anchors.
 *
 * Throws rather than returning '' when an anchor is missing. A slice that
 * silently collapses to the empty string makes every `not.toContain` below pass
 * for the wrong reason, which is the failure mode these assertions exist to
 * avoid in the first place.
 */
const authorizeFn = () => {
  const start = PROXY.indexOf('export async function authorizeStorageKey');
  const end = PROXY.indexOf('export function registerStorageProxy');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('authorizeStorageKey could not be located in storageProxy.ts - rewire this test');
  }
  return PROXY.slice(start, end);
};

describe('storage authorization stays coupled to RFQ visibility', () => {
  it('rfq-attachments is no longer a blanket allow', () => {
    const fn = authorizeFn();
    const branch = fn.slice(fn.indexOf("key.startsWith('rfq-attachments/')"));
    expect(branch.length, 'the rfq-attachments branch has vanished').toBeGreaterThan(0);
    // The exact shape of the old bug: an unconditional true inside the branch.
    //
    // Bounded at the NEXT category marker, whatever it happens to be, rather
    // than at a named one. It used to stop at '// Category D', and when
    // 'Category G: product images' - a deliberate public blanket-allow - was
    // inserted above D, its `return true` fell inside this slice and failed a
    // test about a different branch entirely. The assertion was right; its
    // window was tied to file order.
    const nextCategory = branch.indexOf('// Category', 1);
    expect(nextCategory, 'the branch is no longer followed by another category').toBeGreaterThan(0);
    const firstReturn = branch.slice(0, nextCategory);
    expect(
      firstReturn,
      'rfq-attachments must not return true on the prefix alone - that was the finding',
    ).not.toMatch(/\{\s*\n\s*return true;\s*\n\s*\}/);
  });

  it('rfq-attachments access is derived from the paid enquiry, not from the prefix', () => {
    const fn = authorizeFn();
    expect(fn, 'the proxy must consult qualifiedEnquiries - that is what the credit buys')
      .toContain('qualifiedEnquiries');
    expect(fn, 'the proxy must resolve the owning RFQ rather than trusting the key')
      .toContain('rfqs.requesterId');
    expect(fn, 'attachment keys must be parsed with the shared parser, not re-implemented')
      .toContain('parseRfqAttachments');
  });

  it('the enquiry lookup is scoped to BOTH the RFQ and the caller', () => {
    // Either half alone is useless: rfqId alone authorizes anyone once ONE
    // provider has paid; userId alone authorizes a provider for every RFQ once
    // they have paid for any single one.
    const fn = authorizeFn();
    expect(fn).toContain('eq(qualifiedEnquiries.rfqId');
    expect(fn).toContain('eq(qualifiedEnquiries.userId');
  });

  it('RFQ detail visibility and the proxy narrow together', () => {
    // The coupling, stated as an assertion. rfq.get is owner-scoped and
    // rfq.list omits attachments; if either loosens, the proxy's stricter rule
    // is no longer the matching one and this file should be revisited.
    const block = rfqBlock();
    expect(block, 'rfq.list must stay protectedProcedure').toMatch(/list:\s*protectedProcedure/);
    expect(block, 'rfq.get must stay protectedProcedure').toMatch(/get:\s*protectedProcedure/);
    expect(
      block,
      'rfq.get must stay scoped by requesterId, or the proxy rule is no longer the matching one',
    ).toContain('eq(rfqs.requesterId, ctx.user.id)');
  });

  it('rfq.list still does not hand out attachment keys', () => {
    // The proxy is now stricter than the feed, which is the safe direction. But
    // if the feed started returning `attachments` again, every key would be
    // public knowledge and the proxy would be the only thing standing - a much
    // more load-bearing position than it is designed for.
    const block = rfqBlock();
    const list = block.slice(block.indexOf('list: protectedProcedure'), block.indexOf('myList:'));
    expect(list.length, 'rfq.list could not be isolated - rewire this test').toBeGreaterThan(0);
    expect(list, 'rfq.list must not select attachments').not.toContain('attachments');
  });

  it('RFQ targeting is still discovery, not access control', () => {
    expect(
      ROUTERS,
      'the note recording that rfq.list has no per-vendor targeting has moved or changed',
    ).toContain('has no per-vendor targeting');
  });

  it('the proxy still fails closed for unclassified prefixes', () => {
    expect(authorizeFn().trimEnd().endsWith('return false;\n}')).toBe(true);
  });

  it('ownership-checked categories are still ownership-checked', () => {
    for (const prefix of ['registration/', 'message-attachments/', 'project-documents/']) {
      expect(PROXY).toContain(`key.startsWith('${prefix}')`);
    }
    expect(PROXY).toContain('registrationDocumentSubmissions.fileKey');
    expect(PROXY).toContain('messages.fileUrl');
  });

  it('the proxy requires authentication before any prefix is consulted', () => {
    const fn = authorizeFn();
    expect(fn.indexOf('if (!user) return false;')).toBeLessThan(fn.indexOf('rfq-attachments/'));
  });

  it('only the two PUBLIC-BY-DESIGN categories are unlocked by prefix alone', () => {
    // Deliberate, and the list is short on purpose. Recording it as an
    // assertion means a future blanket-allow has to be ARGUED FOR HERE rather
    // than added quietly - which is exactly what happened when product images
    // were added, and why this test needed a considered edit rather than a
    // relaxed regex.
    //
    //   avatars/        - already on every public vendor card and directory row
    //   product-images/ - on every marketplace card and public product page
    //
    // Both are content a buyer is meant to see. The ownership rule for product
    // images lives on the WRITE side instead: setProductImages refuses any URL
    // outside the caller's own prefix, so a supplier cannot claim another
    // supplier's photo. Reading one is not sensitive; claiming one is.
    const fn = authorizeFn();
    const blanket = [...fn.matchAll(/key\.startsWith\('([^']+)'\)\)\s*\{\s*\n\s*return true;/g)]
      .map(m => m[1]);
    expect(blanket).toEqual(['avatars/', 'product-images/']);
  });
});
