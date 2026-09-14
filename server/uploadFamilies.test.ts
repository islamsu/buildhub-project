import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TRPCError } from '@trpc/server';
import { readSourceForAssertions } from './_testing/sourceText';
import { assertOwnedUploads, ownedUploadPrefix } from './_core/ownedUpload';

/**
 * ── EVERY UPLOAD FAMILY MUST BE READABLE AGAIN ────────────────────────────
 *
 * BuildHub writes files under a prefix per family, and the download proxy
 * decides access by dispatching on that prefix - with a closing `return false`
 * so an unrecognised key fails closed. That default is right, and it has now
 * twice turned a MISSING BRANCH into a dead feature rather than a boundary:
 * first `avatars/`, then `portfolio-images/`, where a provider uploaded work
 * samples that nobody - not even the provider - could ever load.
 *
 * A fail-closed default only protects you if something notices when a new
 * family arrives without its branch. Nothing did. So this reads the WRITERS
 * out of the router and the CLASSIFIED PREFIXES out of the proxy, and fails if
 * the two sets disagree. It is a census, not a list somebody maintains by
 * hand: add a fourteenth upload site tomorrow and this goes red until the
 * proxy is taught to serve it.
 */
const ROUTERS = readSourceForAssertions(
  readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));
const PROXY = readSourceForAssertions(
  readFileSync(new URL('./_core/storageProxy.ts', import.meta.url), 'utf8'));

/** The prefix of every key handed to the one storage-write helper. */
const writerPrefixes = [...new Set(
  [...ROUTERS.matchAll(/storagePutOrUnavailable\(\s*`([a-z-]+)\//g)].map(m => m[1]),
)].sort();

/** Every prefix the proxy's classifier dispatches on, either quote style. */
const classifiedPrefixes = [...new Set(
  [...PROXY.matchAll(/startsWith\(["']([a-z-]+)\//g)].map(m => m[1]),
)].sort();

describe('the upload family census', () => {
  it('finds the real writers, or it is asserting nothing', () => {
    // A regex that silently matched zero call sites would make every
    // assertion below vacuously true.
    expect(writerPrefixes.length).toBeGreaterThanOrEqual(9);
    expect(writerPrefixes).toContain('portfolio-images');
    expect(writerPrefixes).toContain('product-images');
  });

  it('finds the real classifier branches too', () => {
    expect(classifiedPrefixes.length).toBeGreaterThanOrEqual(9);
  });

  it('EVERY family a router writes, the proxy knows how to serve', () => {
    const unreachable = writerPrefixes.filter(p => !classifiedPrefixes.includes(p));
    expect(
      unreachable,
      `these upload families fail closed on download, so the files are unreadable: ${unreachable.join(', ')}`,
    ).toEqual([]);
  });
});

/**
 * ── CLAIMING A FILE IS NOT READING ONE ────────────────────────────────────
 *
 * Product and portfolio images are readable by any signed-in user, because a
 * catalogue nobody can see is not a catalogue. That makes the WRITE side the
 * only place a theft can be stopped - pointing your own listing at a rival's
 * photograph - so the rule is asserted here rather than assumed.
 */
describe('assertOwnedUploads', () => {
  const mine = ownedUploadPrefix('portfolio-images', 7);

  it('accepts a file under the caller own prefix', () => {
    expect(() => assertOwnedUploads([`${mine}kitchen.png`], 'portfolio-images', 7)).not.toThrow();
  });

  it('refuses another user file', () => {
    expect(() => assertOwnedUploads(
      ['/manus-storage/portfolio-images/user-8/kitchen.png'], 'portfolio-images', 7,
    )).toThrow(TRPCError);
  });

  it('refuses a traversal that STARTS inside the caller prefix', () => {
    // The case startsWith alone cannot catch, and the reason the helper does
    // more than a prefix comparison.
    expect(() => assertOwnedUploads(
      [`${mine}../../user-8/kitchen.png`], 'portfolio-images', 7,
    )).toThrow(TRPCError);
  });

  it('refuses an empty remainder - the bare prefix is not a file', () => {
    expect(() => assertOwnedUploads([mine], 'portfolio-images', 7)).toThrow(TRPCError);
  });

  it('refuses a different family under the same user id', () => {
    expect(() => assertOwnedUploads(
      ['/manus-storage/product-images/user-7/kitchen.png'], 'portfolio-images', 7,
    )).toThrow(TRPCError);
  });

  it('refuses FORBIDDEN, not a generic failure', () => {
    try {
      assertOwnedUploads(['/manus-storage/portfolio-images/user-8/x.png'], 'portfolio-images', 7);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as TRPCError).code).toBe('FORBIDDEN');
    }
  });
});

describe('both image families enforce it, on every write path', () => {
  it('the product catalogue calls the shared rule', () => {
    expect(ROUTERS).toContain("assertOwnedUploads(input.images, 'product-images', ctx.user.id)");
  });

  it('and the portfolio does, on create AND on edit', () => {
    const calls = [...ROUTERS.matchAll(/assertOwnedUploads\([^)]*'portfolio-images'/g)];
    expect(calls.length, 'create and update must both check').toBe(2);
  });
});
