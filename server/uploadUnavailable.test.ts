import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { appRouter } from './routers';
import { getDb } from './db';
import { classifyError } from './_core/trpcErrorLog';
import {
  ObjectStorageNotConfiguredError, UnconfiguredObjectStorage, setObjectStorage,
} from './_core/objectStorage';
import type { TrpcContext } from './_core/context';

/**
 * WHAT A DEPLOYMENT WITH NO OBJECT STORAGE TELLS PEOPLE.
 *
 * Found by running the product against a real database with no S3 configured
 * - which is exactly the state a deployment is in when an environment variable
 * is missing on launch day. Every upload failed, and:
 *
 *   THE CUSTOMER was told "Something went wrong. Please try again." for a
 *   condition retrying can never fix.
 *
 *   THE OPERATOR got "unclassified - inspect the deployment logs around this
 *   line". It WAS the deployment log.
 *
 * Both halves were already solved elsewhere in this codebase - the AI
 * attachment upload returned a clear 503, and the download proxy returned one
 * too, its comment even citing the attachment path as precedent. The fix was
 * known and applied in two places out of eight.
 */

const ctx = (id = 7): TrpcContext => ({
  user: {
    id, openId: `u${id}`, email: `u${id}@t.com`, name: 'U', username: `u${id}`,
    loginMethod: 'password', role: 'user', userRole: 'homeowner',
    accountStatus: 'active', onboardingStatus: 'approved', isDummy: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as TrpcContext['user'],
  req: { protocol: 'https', headers: {} } as TrpcContext['req'],
  res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
});

// ══ 1. THE OPERATOR'S HALF ═════════════════════════════════════════════════

describe('the log line an operator actually gets', () => {
  it('classifies unconfigured storage as a missing configuration', () => {
    const category = classifyError(new ObjectStorageNotConfiguredError('store a file')).category;
    expect(category).toBe('config-missing');
  });

  it('does so by TYPE, so rewording the message cannot break it', () => {
    // This is the whole defect. The classifier looked for the literal string
    // "is not configured"; the error says "No object storage backend is
    // configured". One word apart, and every upload logged as unclassified.
    const reworded = new ObjectStorageNotConfiguredError('store a file');
    reworded.message = 'storage unavailable';
    expect(classifyError(reworded).category).toBe('config-missing');
  });

  it('still classifies the string-matched cases it always did', () => {
    // The name check is added in front of the regex, not instead of it.
    expect(classifyError(new Error('OPENAI_API_KEY is not configured')).category)
      .toBe('config-missing');
    expect(classifyError(new Error('ER_NO_SUCH_TABLE: nope')).category).toBe('database');
  });

  it('an unrelated error is still unclassified - the net did not get sloppy', () => {
    expect(classifyError(new Error('something odd happened')).category).toBe('unclassified');
  });
});

// ══ 2. THE CUSTOMER'S HALF ═════════════════════════════════════════════════

describe('what the user is told', () => {
  beforeEach(() => setObjectStorage(new UnconfiguredObjectStorage()));
  afterEach(() => setObjectStorage(null));

  it('SERVICE_UNAVAILABLE, not a generic 500', async () => {
    // The request was fine. The feature is off on this deployment. Saying so
    // stops somebody retrying into the same wall.
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: 1 }]) }) }),
      insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
    });

    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]);
    await expect(
      appRouter.createCaller(ctx()).projects.uploadDocument({
        projectId: 1, name: 'drawing.png', type: 'drawing',
        contentType: 'image/png', base64: png.toString('base64'),
      }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('the message names the situation without naming a bucket or a credential', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: 1 }]) }) }),
      insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
    });
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]);
    try {
      await appRouter.createCaller(ctx()).projects.uploadDocument({
        projectId: 1, name: 'drawing.png', type: 'drawing',
        contentType: 'image/png', base64: png.toString('base64'),
      });
      throw new Error('expected a refusal');
    } catch (error) {
      const message = (error as { message: string }).message;
      expect(message).toMatch(/not available on this deployment/i);
      // The underlying error names S3_BUCKET, S3_ACCESS_KEY_ID and the rest.
      // None of that may reach a customer.
      for (const secret of ['S3_', 'FORGE', 'BUCKET', 'KEY']) {
        expect(message, `"${secret}" must not reach the client`).not.toContain(secret);
      }
    }
  });
});

// ══ 3. EVERY SITE, NOT THE ONE THAT LOOKED RISKIEST ════════════════════════

describe('all upload paths behave the same way', () => {
  const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'))
    ;

  it('no procedure calls storagePut directly any more', () => {
    // The census, not a spot check. This codebase has made this exact mistake
    // before and recorded the lesson in assertUploadedFileMatches: "applied at
    // all five upload endpoints rather than the one that looked riskiest,
    // because the gap was identical in each." It was not applied here.
    // The wrapper's own body is excluded - it is the one place that is
    // SUPPOSED to call the real thing, and including it would make this
    // assertion impossible to satisfy rather than merely hard.
    const wrapperStart = ROUTERS.indexOf('async function storagePutOrUnavailable');
    const wrapperEnd = ROUTERS.indexOf('const MAX_REGISTRATION_DOCUMENT_SIZE');
    expect(wrapperStart).toBeGreaterThan(-1);
    expect(wrapperEnd).toBeGreaterThan(wrapperStart);
    const outsideWrapper = ROUTERS.slice(0, wrapperStart) + ROUTERS.slice(wrapperEnd);

    const direct = [...outsideWrapper.matchAll(/await storagePut\(/g)];
    expect(direct, 'every call site must go through storagePutOrUnavailable').toHaveLength(0);
  });

  it('and there are still as many upload sites as before', () => {
    // Guards the other direction: satisfying the check above by deleting
    // uploads would be worse than the defect.
    const wrapped = [...ROUTERS.matchAll(/await storagePutOrUnavailable\(/g)];
    // EIGHT since a supplier gained the ability to attach a proposal, a
    // specification, a certificate or a photograph to their quotation - the
    // eighth upload path, and the first that flows provider -> customer.
    expect(wrapped.length).toBe(8);
  });

  it('anything that is NOT a configuration problem still propagates', () => {
    // A wrapper that swallowed real storage failures into "not available"
    // would hide a broken bucket behind a message saying the feature is off.
    const wrapper = ROUTERS.slice(
      ROUTERS.indexOf('async function storagePutOrUnavailable'),
      ROUTERS.indexOf('const MAX_REGISTRATION_DOCUMENT_SIZE'),
    );
    expect(wrapper).toContain('instanceof ObjectStorageNotConfiguredError');
    expect(wrapper).toMatch(/\n\s*throw error;\n/);
  });

  it('the OPERATOR is still told why, which the 503 alone does not say', () => {
    // Turning a 500 into a 503 fixed the customer's half and silently removed
    // the operator's: the tRPC classifier only reports INTERNAL_SERVER_ERROR,
    // so a well-formed refusal is logged nowhere. The access log would have
    // shown 503s on every upload and never said why.
    const wrapper = ROUTERS.slice(
      ROUTERS.indexOf('async function storagePutOrUnavailable'),
      ROUTERS.indexOf('const MAX_REGISTRATION_DOCUMENT_SIZE'),
    );
    expect(wrapper).toContain('upload_rejected_storage_unconfigured');
    expect(wrapper).toMatch(/S3_BUCKET/);
  });

  it('the remedy names variables to a LOG, never to the customer', () => {
    // The same words in the two places have opposite values: actionable for an
    // operator, an information leak in a toast. The customer-facing message is
    // asserted clean in the section above; this asserts they stay separate.
    const wrapper = ROUTERS.slice(
      ROUTERS.indexOf('async function storagePutOrUnavailable'),
      ROUTERS.indexOf('const MAX_REGISTRATION_DOCUMENT_SIZE'),
    );
    const clientMessage = /message: 'File uploads[^']*'/.exec(wrapper)?.[0] ?? '';
    expect(clientMessage).not.toMatch(/S3_|FORGE|BUCKET/);
    expect(wrapper.indexOf('S3_BUCKET')).toBeLessThan(wrapper.indexOf(clientMessage));
  });

  it('the download proxy already answered this way, and still does', () => {
    const proxy = readSourceForAssertions(readFileSync(new URL('./_core/storageProxy.ts', import.meta.url), 'utf8'));
    expect(proxy).toContain('res.status(503)');
    expect(proxy).toContain('isObjectStorageConfigured()');
  });
});
