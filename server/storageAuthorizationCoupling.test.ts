import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The storage proxy's RFQ rule DUPLICATES the application's RFQ visibility
 * rule instead of deriving from it.
 *
 * storageProxy.authorizeStorageKey lets any authenticated user fetch anything
 * under `rfq-attachments/`, and the comment justifying that says rfq.list and
 * rfq.get already expose full RFQ detail to any authenticated user, so the
 * attachment is no more secret than the RFQ carrying it. That reasoning is
 * currently CORRECT - I checked - and it is why this is not a finding today.
 *
 * The risk is that it is correct by coincidence rather than by construction.
 * The keys are `rfq-attachments/user-{id}/{filename}` with no random component,
 * so access rests entirely on that prefix rule. The day RFQ visibility narrows
 * - private RFQs, or targeting becoming an access control rather than the
 * discovery aid it is today - the storage layer will NOT narrow with it. It
 * will silently keep serving attachments to everyone, and nothing would fail.
 *
 * So these tests fail loudly at exactly that moment, and name the file that
 * must change alongside.
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

describe('storage authorization stays coupled to RFQ visibility', () => {
  it('the proxy still grants rfq-attachments to any authenticated user', () => {
    // The state this whole file is guarding. If this changes, the assertions
    // below stop being the right question and should be revisited.
    expect(PROXY).toContain("key.startsWith('rfq-attachments/')");
  });

  it('RFQ detail is still visible to any authenticated user', () => {
    // If this stops being protectedProcedure - narrowed to the owner, to
    // targeted providers, or to a subscription tier - then the prefix rule in
    // storageProxy.ts is now MORE permissive than the data it guards, and the
    // attachments become readable by users who cannot see the RFQ itself.
    const block = rfqBlock();
    expect(block, 'rfq.list must stay protectedProcedure, or storageProxy.ts must narrow with it')
      .toMatch(/list:\s*protectedProcedure/);
    expect(block, 'rfq.get must stay protectedProcedure, or storageProxy.ts must narrow with it')
      .toMatch(/get:\s*protectedProcedure/);
  });

  it('RFQ targeting is still discovery, not access control', () => {
    // Targeting decides who is NOTIFIED, not who may READ. The moment it gates
    // reads, rfq-attachments must be gated the same way.
    expect(
      ROUTERS,
      'the note recording that rfq.list has no per-vendor targeting has moved or changed - ' +
        'if targeting now gates READS, storageProxy.ts must gate attachments the same way',
    ).toContain('has no per-vendor targeting');
  });

  it('the proxy still fails closed for unclassified prefixes', () => {
    // Every category not explicitly listed must be denied, so a new upload
    // prefix is unreadable until someone deliberately classifies it.
    const fn = PROXY.slice(
      PROXY.indexOf('export async function authorizeStorageKey'),
      PROXY.indexOf('export function registerStorageProxy'),
    );
    expect(fn.trimEnd().endsWith('return false;\n}')).toBe(true);
  });

  it('ownership-checked categories are still ownership-checked', () => {
    // These are the categories where a prefix alone must never be enough.
    for (const prefix of ['registration/', 'message-attachments/']) {
      expect(PROXY).toContain(`key.startsWith('${prefix}')`);
    }
    expect(PROXY).toContain('registrationDocumentSubmissions.fileKey');
    expect(PROXY).toContain('messages.fileUrl');
  });

  it('the proxy requires authentication before any prefix is consulted', () => {
    const fn = PROXY.slice(PROXY.indexOf('export async function authorizeStorageKey'));
    expect(fn.indexOf('if (!user) return false;')).toBeLessThan(fn.indexOf('rfq-attachments/'));
  });
});
