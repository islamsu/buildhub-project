import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * AI attachments, end to end: what BuildHub accepts, what it refuses, and who
 * is allowed to read a file once it exists.
 *
 * The authorization tests here are the ones that matter most. An attachment id
 * is a small integer, so "can user 2 read user 1's file by guessing 1?" is not
 * a theoretical question - it is the first thing anyone would try.
 */

const storage = vi.hoisted(() => {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    put: vi.fn(async (key: string, data: Buffer) => { objects.set(key, Buffer.from(data)); }),
    get: vi.fn(async (key: string) => {
      const found = objects.get(key);
      if (!found) throw new Error('NoSuchKey');
      return found;
    }),
    signedGetUrl: vi.fn(async () => 'https://storage.example/signed'),
  };
});

vi.mock('./db', () => ({ getDb: vi.fn() }));
vi.mock('./_core/objectStorage', async () => {
  const actual = await vi.importActual<typeof import('./_core/objectStorage')>('./_core/objectStorage');
  return {
    ...actual,
    // An in-memory backend, and ONLY for tests. Production resolves the backend
    // from configuration in resolveObjectStorage(); nothing here changes that,
    // which is why this fake lives in the test file rather than in the adapter.
    getObjectStorage: () => ({ id: 'memory', ...storage }),
    isObjectStorageConfigured: () => true,
  };
});
vi.mock('./_core/ai', async () => {
  const actual = await vi.importActual<typeof import('./_core/ai')>('./_core/ai');
  return { ...actual, generateAIResponse: vi.fn(), isAiConfigured: () => true };
});

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { generateAIResponse } from './_core/ai';
import { getDb } from './db';
import { resetAiChatLimiters, resetContentLimiters } from './_core/rateLimit';
import { validateAiAttachment, toModelContent, attachmentInstruction } from './_core/aiAttachments';
import { authorizeStorageKey } from './_core/storageProxy';
import { safeAttachmentName, MAX_AI_ATTACHMENT_SIZE, MAX_AI_ATTACHMENTS_PER_MESSAGE } from '@shared/aiAttachments';

// ── Real byte sequences. A test that validates a made-up buffer proves nothing
//    about a validator whose whole job is reading real signatures.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 3)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(64, 1),
]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 5)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function makeCtx(userId: number | null): TrpcContext {
  return {
    user: userId === null ? null : {
      id: userId, openId: `user-${userId}`, email: `u${userId}@test.com`, name: `User ${userId}`,
      loginMethod: 'manus', role: 'user', userRole: 'homeowner', accountStatus: 'active',
      isDummy: false, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: 'https', headers: { 'x-forwarded-for': '1.2.3.4' } } as TrpcContext['req'],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  } as TrpcContext;
}

/** A tiny fake of the attachment table, enough to exercise the real queries. */
type Row = { id: number; userId: number; name: string; contentType: string; fileKey: string; deletedAt: Date | null };
let rows: Row[] = [];
let nextId = 1;

function fakeDb() {
  return {
    select: (_columns?: unknown) => ({
      from: () => ({
        where: (predicate: unknown) => {
          const filter = predicate as { __filter?: (row: Row) => boolean };
          return Promise.resolve(rows.filter(filter.__filter ?? (() => true)));
        },
      }),
    }),
    insert: () => ({
      values: (value: Omit<Row, 'id' | 'deletedAt'>) => {
        const row: Row = { ...value, id: nextId++, deletedAt: null };
        rows.push(row);
        return Promise.resolve({ insertId: row.id });
      },
    }),
    update: () => ({
      set: (patch: Partial<Row>) => ({
        where: (predicate: unknown) => {
          const filter = predicate as { __filter?: (row: Row) => boolean };
          rows.filter(filter.__filter ?? (() => false)).forEach(row => Object.assign(row, patch));
          return Promise.resolve({});
        },
      }),
    }),
  };
}

// drizzle's operators are opaque objects; these stand in for them so the real
// router code runs unmodified and the predicates it builds are actually applied.
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  const named = (column: unknown): string => String((column as { name?: string })?.name ?? '');
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => ({ __filter: (row: Row) => (row as never as Record<string, unknown>)[named(column)] === value }),
    isNull: (column: unknown) => ({ __filter: (row: Row) => (row as never as Record<string, unknown>)[named(column)] === null }),
    inArray: (column: unknown, values: unknown[]) => ({ __filter: (row: Row) => values.includes((row as never as Record<string, unknown>)[named(column)]) }),
    and: (...parts: { __filter?: (row: Row) => boolean }[]) => ({
      __filter: (row: Row) => parts.every(part => (part?.__filter ? part.__filter(row) : true)),
    }),
  };
});

const upload = (userId: number, fileName: string, contentType: string, bytes: Buffer) =>
  appRouter.createCaller(makeCtx(userId)).ai.uploadAttachment({
    fileName, contentType, base64: bytes.toString('base64'),
  });

beforeEach(() => {
  vi.clearAllMocks();
  resetAiChatLimiters();
  resetContentLimiters();
  rows = [];
  nextId = 1;
  storage.objects.clear();
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(fakeDb());
  (generateAIResponse as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'Answer.' });
});

// ── 1. What is accepted ────────────────────────────────────────────────────

describe('accepted formats', () => {
  it.each([
    ['drawing.png', 'image/png', PNG],
    ['photo.jpg', 'image/jpeg', JPEG],
    ['photo.jpeg', 'image/jpeg', JPEG],
    ['render.webp', 'image/webp', WEBP],
    ['boq.pdf', 'application/pdf', PDF],
  ])('accepts %s', async (name, type, bytes) => {
    const result = await upload(1, name, type, bytes as Buffer);
    expect(result.contentType).toBe(type);
    expect(result.size).toBe((bytes as Buffer).length);
    expect(result.id).toBeGreaterThan(0);
  });

  it('returns an id and metadata but NEVER a URL or a storage key', async () => {
    // The browser has no reason to hold a path to this file: the server reads
    // it on the next chat request. Handing one out would create a second way
    // to reach the bytes that the chat authorization does not police.
    const result = await upload(1, 'drawing.png', 'image/png', PNG);
    expect(Object.keys(result).sort()).toEqual(['contentType', 'id', 'name', 'size']);
    expect(JSON.stringify(result)).not.toContain('manus-storage');
    expect(JSON.stringify(result)).not.toContain('ai-attachments/');
  });
});

// ── 2. What is refused ─────────────────────────────────────────────────────

describe('refused uploads', () => {
  it('refuses a type BuildHub does not advertise (DOCX)', () => {
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(32)]);
    const result = validateAiAttachment({
      name: 'spec.docx',
      declaredType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: docx,
    });
    expect(result).toMatchObject({ code: 'unsupported-type' });
  });

  it('refuses SVG, which passes every "image/*" test while being a script host', () => {
    const result = validateAiAttachment({ name: 'logo.svg', declaredType: 'image/svg+xml', bytes: SVG });
    expect(result).toMatchObject({ code: 'unsupported-type' });
  });

  it('refuses an SVG WEARING a PNG label - the bytes are the authority', async () => {
    const result = validateAiAttachment({ name: 'logo.png', declaredType: 'image/png', bytes: SVG });
    expect(result).toMatchObject({ code: 'content-mismatch' });
    await expect(upload(1, 'logo.png', 'image/png', SVG)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a PDF declared as an image', () => {
    const result = validateAiAttachment({ name: 'boq.png', declaredType: 'image/png', bytes: PDF });
    expect(result).toMatchObject({ code: 'content-mismatch' });
  });

  it('refuses a name whose extension disagrees with its own declared type', () => {
    const result = validateAiAttachment({ name: 'boq.pdf', declaredType: 'image/png', bytes: PNG });
    expect(result).toMatchObject({ code: 'extension-mismatch' });
  });

  it('refuses an oversized file', () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(MAX_AI_ATTACHMENT_SIZE + 1)]);
    expect(validateAiAttachment({ name: 'big.png', declaredType: 'image/png', bytes: huge }))
      .toMatchObject({ code: 'too-large' });
  });

  it('refuses an empty file', () => {
    expect(validateAiAttachment({ name: 'empty.png', declaredType: 'image/png', bytes: Buffer.alloc(0) }))
      .toMatchObject({ code: 'empty' });
  });

  it('refuses a malformed file whose signature is truncated', () => {
    expect(validateAiAttachment({ name: 'broken.png', declaredType: 'image/png', bytes: Buffer.from([0x89, 0x50]) }))
      .toMatchObject({ code: 'content-mismatch' });
  });

  it('a refused file is never stored', async () => {
    await expect(upload(1, 'logo.png', 'image/png', SVG)).rejects.toThrow();
    expect(storage.put).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
});

// ── 3. Filename safety ─────────────────────────────────────────────────────

describe('filename safety', () => {
  it.each([
    // The basename, not a flattened path: keeping "etc_passwd" would preserve
    // the attacker's directory names in a filename BuildHub then shows back to
    // the user. Dropping everything before the last separator is stricter.
    ['../../etc/passwd.png', 'passwd.png'],
    ['..\\..\\windows\\system32.png', 'system32.png'],
    ['  spaced name .png', 'spaced_name_.png'],
    ['....png', 'png'],
  ])('%s cannot climb out of its prefix', (raw, expected) => {
    const safe = safeAttachmentName(raw);
    expect(safe).toBe(expected);
    expect(safe).not.toContain('/');
    expect(safe).not.toContain('\\');
    expect(safe).not.toContain('..');
  });

  it('the stored key stays inside the user-scoped prefix', async () => {
    await upload(7, '../../escape.png', 'image/png', PNG);
    const key = storage.put.mock.calls[0][0] as string;
    expect(key.startsWith('ai-attachments/user-7/')).toBe(true);
    expect(key).not.toContain('..');
  });
});

// ── 4. Authorization: the part that matters ────────────────────────────────

describe('cross-user access', () => {
  it('user 2 cannot use user 1 attachment id in a chat request', async () => {
    const mine = await upload(1, 'drawing.png', 'image/png', PNG);
    const attacker = appRouter.createCaller(makeCtx(2));
    await expect(attacker.ai.chat({
      messages: [{ role: 'user', content: 'What is in this?' }],
      attachmentIds: [mine.id],
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // And crucially: the provider was never called, so the bytes never left.
    expect(generateAIResponse).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('a non-existent id is refused with the SAME error as someone else\'s id', async () => {
    const mine = await upload(1, 'drawing.png', 'image/png', PNG);
    const attacker = appRouter.createCaller(makeCtx(2));
    const stolen = await attacker.ai.chat({
      messages: [{ role: 'user', content: 'q' }], attachmentIds: [mine.id],
    }).catch((error: { code: string; message: string }) => error);
    const missing = await attacker.ai.chat({
      messages: [{ role: 'user', content: 'q' }], attachmentIds: [999],
    }).catch((error: { code: string; message: string }) => error);
    // Identical, deliberately: a different message would confirm which ids
    // exist, turning the endpoint into an enumeration oracle.
    expect(stolen.code).toBe(missing.code);
    expect(stolen.message).toBe(missing.message);
  });

  it('the owner CAN use their own attachment', async () => {
    const mine = await upload(1, 'drawing.png', 'image/png', PNG);
    await expect(appRouter.createCaller(makeCtx(1)).ai.chat({
      messages: [{ role: 'user', content: 'What is in this?' }],
      attachmentIds: [mine.id],
    })).resolves.toEqual({ content: 'Answer.' });
    expect(generateAIResponse).toHaveBeenCalledTimes(1);
  });

  it('the storage proxy refuses another user, and refuses a deleted file', async () => {
    const mine = await upload(1, 'drawing.png', 'image/png', PNG);
    const key = rows.find(row => row.id === mine.id)!.fileKey;
    const owner = { id: 1, role: 'user' } as never;
    const other = { id: 2, role: 'user' } as never;

    expect(await authorizeStorageKey(key, owner)).toBe(true);
    expect(await authorizeStorageKey(key, other)).toBe(false);
    expect(await authorizeStorageKey(key, null)).toBe(false);

    await appRouter.createCaller(makeCtx(1)).ai.deleteAttachment({ id: mine.id });
    expect(await authorizeStorageKey(key, owner)).toBe(false);
  });

  it('an unauthenticated caller cannot upload at all', async () => {
    await expect(appRouter.createCaller(makeCtx(null)).ai.uploadAttachment({
      fileName: 'x.png', contentType: 'image/png', base64: PNG.toString('base64'),
    })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

// ── 5. Removal ─────────────────────────────────────────────────────────────

describe('removal', () => {
  it('a removed attachment can no longer be sent to the model', async () => {
    const mine = await upload(1, 'drawing.png', 'image/png', PNG);
    const caller = appRouter.createCaller(makeCtx(1));
    await caller.ai.deleteAttachment({ id: mine.id });
    await expect(caller.ai.chat({
      messages: [{ role: 'user', content: 'q' }], attachmentIds: [mine.id],
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('one user cannot delete another user\'s attachment', async () => {
    const mine = await upload(1, 'drawing.png', 'image/png', PNG);
    await appRouter.createCaller(makeCtx(2)).ai.deleteAttachment({ id: mine.id });
    // Reports success either way - see the endpoint - but the row is untouched,
    // which is the property that actually matters.
    expect(rows.find(row => row.id === mine.id)!.deletedAt).toBeNull();
  });
});

// ── 6. What reaches the provider ───────────────────────────────────────────

describe('what the model receives', () => {
  it('an image goes as input_image and a PDF as input_file', () => {
    expect(toModelContent({ name: 'a.png', contentType: 'image/png', bytes: PNG }))
      .toMatchObject({ type: 'input_image', detail: 'auto' });
    expect(toModelContent({ name: 'a.pdf', contentType: 'application/pdf', bytes: PDF }))
      .toMatchObject({ type: 'input_file', filename: 'a.pdf' });
  });

  it('the bytes travel INLINE, never as a BuildHub URL the provider would fetch', () => {
    const image = toModelContent({ name: 'a.png', contentType: 'image/png', bytes: PNG });
    const payload = JSON.stringify(image);
    expect(payload).toContain('data:image/png;base64,');
    expect(payload).not.toContain('manus-storage');
    expect(payload).not.toContain('http');
  });

  it('the attachment is carried on the LAST user turn, with the question', async () => {
    const mine = await upload(1, 'drawing.png', 'image/png', PNG);
    await appRouter.createCaller(makeCtx(1)).ai.chat({
      messages: [
        { role: 'user', content: 'earlier question' },
        { role: 'assistant', content: 'earlier answer' },
        { role: 'user', content: 'what is wrong with this drawing?' },
      ],
      attachmentIds: [mine.id],
    });
    const call = (generateAIResponse as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.attachments).toHaveLength(1);
    expect(call.attachments[0].name).toBe('drawing.png');
    expect(call.messages[0].content).toContain('ATTACHED FILE');
  });

  it('the instruction makes the file outrank BuildHub knowledge for facts about itself', () => {
    const instruction = attachmentInstruction(['datasheet.pdf'], 'en');
    expect(instruction).toMatch(/OUTRANKS/);
    expect(instruction).toMatch(/THE ATTACHMENT GOVERNS/);
    expect(instruction).toMatch(/does not contain what was asked for, say that it does not/i);
    expect(instruction).toMatch(/[Nn]ever invent a figure/);
  });

  it('the Arabic instruction still pins the answer language', () => {
    expect(attachmentInstruction(['x.pdf'], 'ar')).toContain('Answer in Arabic.');
  });

  it('no attachment instruction is injected when there is no attachment', async () => {
    await appRouter.createCaller(makeCtx(1)).ai.chat({ messages: [{ role: 'user', content: 'hi' }] });
    const call = (generateAIResponse as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // Telling a model to prefer "the attachment" when none exists is how a
    // model starts describing one.
    expect(call.messages[0].content).not.toContain('ATTACHED FILE');
    expect(call.attachments).toEqual([]);
  });
});

// ── 7. Failure handling ────────────────────────────────────────────────────

describe('failures are reported, never silently absorbed', () => {
  it('unreadable storage fails the request instead of answering WITHOUT the file', async () => {
    const mine = await upload(1, 'drawing.png', 'image/png', PNG);
    storage.objects.clear(); // the bytes are gone
    await expect(appRouter.createCaller(makeCtx(1)).ai.chat({
      messages: [{ role: 'user', content: 'what is in this?' }], attachmentIds: [mine.id],
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    // The critical half: it did NOT fall through and answer from general
    // knowledge, which would look to the user exactly like a working answer.
    expect(generateAIResponse).not.toHaveBeenCalled();
  });

  it('a provider failure surfaces as a provider failure', async () => {
    const mine = await upload(1, 'drawing.png', 'image/png', PNG);
    const { AiError } = await vi.importActual<typeof import('./_core/ai')>('./_core/ai');
    (generateAIResponse as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new AiError('provider-timeout', undefined, 'too slow'));
    await expect(appRouter.createCaller(makeCtx(1)).ai.chat({
      messages: [{ role: 'user', content: 'q' }], attachmentIds: [mine.id],
    })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('more attachments than the limit are refused by the schema', async () => {
    await expect(appRouter.createCaller(makeCtx(1)).ai.chat({
      messages: [{ role: 'user', content: 'q' }], attachmentIds: [1, 2],
    })).rejects.toThrow();
  });
});

// ── 8. Leakage ─────────────────────────────────────────────────────────────

describe('no leakage', () => {
  it('a rejection message carries no path, no key and no stack', async () => {
    const error = await upload(1, 'logo.png', 'image/png', SVG).catch((problem: { message: string }) => problem);
    const message = String(error.message);
    expect(message).not.toMatch(/\/home\/|\/var\/|node_modules|at Object\./);
    expect(message).not.toContain('ai-attachments/');
    expect(message).not.toMatch(/OPENAI|sk-|Bearer/i);
  });

  it('an upload response carries no credential or provider detail', async () => {
    const result = await upload(1, 'drawing.png', 'image/png', PNG);
    const payload = JSON.stringify(result);
    for (const secret of ['OPENAI_API_KEY', 'api.openai.com', 'Bearer', 'S3_SECRET', 'DATABASE_URL']) {
      expect(payload).not.toContain(secret);
    }
  });
});

describe('an unconfigured deployment says so, instead of looking broken', () => {
  it('reports SERVICE_UNAVAILABLE with a plain reason, not a generic internal error', async () => {
    // Found on a GREEN staging run: the gate passed, and the skip line read
    // "Something went wrong. Please try again." That is the right message for a
    // genuine internal fault and the wrong one for an operator who has not
    // configured storage - it sends them hunting a bug instead of a setting,
    // which is exactly what made the original AI outage slow to diagnose.
    const { ObjectStorageNotConfiguredError } = await vi.importActual<typeof import('./_core/objectStorage')>('./_core/objectStorage');
    storage.put.mockRejectedValueOnce(new ObjectStorageNotConfiguredError('store a file'));

    const failure = await upload(1, 'drawing.png', 'image/png', PNG)
      .catch((error: { code: string; message: string }) => error);

    expect(failure.code).toBe('SERVICE_UNAVAILABLE');
    expect(failure.message).toBe('File attachments are not available on this deployment.');
    // And it must not leak the adapter's own message, which names env vars.
    expect(failure.message).not.toMatch(/S3_BUCKET|S3_ENDPOINT|FORGE/);
    // Nothing was recorded for a file that was never stored.
    expect(rows).toHaveLength(0);
  });

  it('a genuine storage fault is still an internal error, not a config claim', async () => {
    // The discrimination has to work in BOTH directions: telling an operator
    // "not configured" when the bucket is configured but erroring would send
    // them to change a setting that was already correct.
    storage.put.mockRejectedValueOnce(new Error('connection reset by peer'));
    const failure = await upload(1, 'drawing.png', 'image/png', PNG)
      .catch((error: { code: string }) => error);
    expect(failure.code).not.toBe('SERVICE_UNAVAILABLE');
  });
});

describe('multi-file is an ARCHITECTURE question, not a constant', () => {
  it('the provider layer is already plural - attachments[], not one attachment', async () => {
    // Part 10 of the brief: multi-file must be addable without rewriting the
    // provider layer. It already is - generateAIResponse takes a list and maps
    // over it, so the limit is a policy at the router boundary rather than a
    // shape baked into the integration.
    const source = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('./_core/ai.ts', import.meta.url), 'utf8'));
    expect(source).toContain('attachments?: AiAttachment[]');
    expect(source).toContain('attachments.map(toModelContent)');
  });

  it('the limit is ONE shared constant, enforced at the router', () => {
    expect(MAX_AI_ATTACHMENTS_PER_MESSAGE).toBe(1);
    const routers = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    expect(routers).toContain('.max(MAX_AI_ATTACHMENTS_PER_MESSAGE)');
  });

  it('RAISING THE CONSTANT WOULD NOT DELIVER THE FEATURE, and this records why', () => {
    // Deliberately a test rather than a comment, so the reasoning is in front
    // of whoever next opens the file to "just bump it to 3".
    //
    // Two files would reach the model and be read. What would NOT happen is
    // attribution: nothing in the attachment instruction tells the model to say
    // WHICH document each fact came from, and nothing in the evaluation suite
    // checks that it does. "Compare this quotation against this BOQ" answered
    // without attribution is worse than a refusal, because the reader cannot
    // tell which document a discrepancy was found in.
    const instruction = attachmentInstruction(['BOQ.pdf', 'Quotation.pdf'], 'en');
    // The instruction pluralises - so the wording is ready - but it carries no
    // per-document attribution requirement, which is the actual missing piece.
    expect(instruction).toContain('ATTACHED FILES');
    expect(instruction).not.toMatch(/say which (file|document)/i);
  });
});
