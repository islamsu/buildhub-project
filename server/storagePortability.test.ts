import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Slice 5 — removing the last live coupling to the Manus platform.
 *
 * Every file BuildHub holds is written through Forge
 * (BUILT_IN_FORGE_API_URL / BUILT_IN_FORGE_API_KEY): vendor registration
 * documents, project drawings, message attachments, avatars. On infrastructure
 * the owner controls, that service is not reachable and uploads simply fail.
 *
 * Forge is not a storage engine of its own — it hands out presigned S3 URLs and
 * the app PUTs straight to S3 — so this is addressing the same protocol
 * directly rather than a rewrite.
 *
 * The property that matters most here is that NOTHING about authorization
 * changed. `/manus-storage/{key}` still verifies every private category against
 * the owning database row, and still fails closed on an unknown prefix.
 */

import {
  ForgeObjectStorage,
  ObjectStorageNotConfiguredError,
  S3ObjectStorage,
  UnconfiguredObjectStorage,
  resolveObjectStorage,
  setObjectStorage,
  isObjectStorageConfigured,
  type ObjectStorage,
} from './_core/objectStorage';
import { storageGet, storageGetSignedUrl, storagePut } from './storage';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const STORAGE_SOURCE = read('./storage.ts');
const PROXY_SOURCE = read('./_core/storageProxy.ts');
const ROUTERS_SOURCE = read('./routers.ts');

const BASE_ENV = {
  appId: '', cookieSecret: '', databaseUrl: '', oAuthServerUrl: '', ownerOpenId: '',
  isProduction: false, forgeApiUrl: '', forgeApiKey: '', appBaseUrl: '',
  s3Endpoint: '', s3Region: '', s3Bucket: '', s3AccessKeyId: '', s3SecretAccessKey: '',
  s3ForcePathStyle: true,
};

function recordingStorage() {
  const puts: { key: string; contentType: string; size: number }[] = [];
  const storage: ObjectStorage = {
    id: 'test',
    async put(key, data, contentType) {
      puts.push({ key, contentType, size: typeof data === 'string' ? data.length : data.byteLength });
    },
    async signedGetUrl(key) {
      return `https://storage.test/${key}?signature=abc`;
    },
  };
  setObjectStorage(storage);
  return puts;
}

afterEach(() => setObjectStorage(null));

// ── §1 Backend selection ───────────────────────────────────────────────────

describe('§1 which backend answers is decided by configuration', () => {
  it('picks S3 when a bucket and credentials are present', () => {
    const storage = resolveObjectStorage({
      ...BASE_ENV, s3Bucket: 'buildhub-uploads', s3AccessKeyId: 'key', s3SecretAccessKey: 'secret',
      s3Endpoint: 'https://ewr1.vultrobjects.com', s3Region: 'ewr1',
    });
    expect(storage).toBeInstanceOf(S3ObjectStorage);
    expect(storage.id).toBe('s3');
  });

  it('S3 wins over Forge, so migrating is a configuration change and not a redeploy', () => {
    const storage = resolveObjectStorage({
      ...BASE_ENV,
      forgeApiUrl: 'https://forge.example', forgeApiKey: 'forge-key',
      s3Bucket: 'buildhub-uploads', s3AccessKeyId: 'key', s3SecretAccessKey: 'secret',
    });
    expect(storage.id).toBe('s3');
  });

  it('falls back to Forge, so existing deployments are unaffected by this slice', () => {
    const storage = resolveObjectStorage({
      ...BASE_ENV, forgeApiUrl: 'https://forge.example', forgeApiKey: 'forge-key',
    });
    expect(storage).toBeInstanceOf(ForgeObjectStorage);
    expect(storage.id).toBe('forge');
  });

  it('an incomplete S3 configuration does NOT silently half-select S3', () => {
    // A bucket with no credentials would produce confusing 403s at upload time
    // rather than an obvious configuration error.
    const noCredentials = resolveObjectStorage({ ...BASE_ENV, s3Bucket: 'buildhub-uploads' });
    expect(noCredentials.id).toBe('none');
    const noBucket = resolveObjectStorage({ ...BASE_ENV, s3AccessKeyId: 'key', s3SecretAccessKey: 'secret' });
    expect(noBucket.id).toBe('none');
  });

  it('with nothing configured it refuses loudly rather than pretending to store', async () => {
    const storage = resolveObjectStorage(BASE_ENV);
    expect(storage).toBeInstanceOf(UnconfiguredObjectStorage);
    await expect(storage.put('k', 'data', 'text/plain')).rejects.toBeInstanceOf(ObjectStorageNotConfiguredError);
    await expect(storage.signedGetUrl('k')).rejects.toBeInstanceOf(ObjectStorageNotConfiguredError);
  });

  it('the refusal names both ways to fix it', async () => {
    const error = await new UnconfiguredObjectStorage().put().catch((e: Error) => e.message);
    expect(error).toContain('S3_BUCKET');
    expect(error).toContain('BUILT_IN_FORGE_API_URL');
  });
});

// ── §2 The public surface did not change ───────────────────────────────────

describe('§2 storage.ts keeps its contract', () => {
  it('storagePut returns the same /manus-storage/{key} shape the database already stores', async () => {
    recordingStorage();
    const result = await storagePut('avatars/7/photo.png', Buffer.from('x'), 'image/png');
    expect(result.url).toBe(`/manus-storage/${result.key}`);
    expect(result.key.startsWith('avatars/7/photo_')).toBe(true);
    expect(result.key.endsWith('.png')).toBe(true);
  });

  it('every upload still gets a collision-resistant suffix', async () => {
    recordingStorage();
    const first = await storagePut('registration/1/licence.pdf', 'a', 'application/pdf');
    const second = await storagePut('registration/1/licence.pdf', 'a', 'application/pdf');
    expect(first.key).not.toBe(second.key);
  });

  it('passes the caller content type straight through to the backend', async () => {
    const puts = recordingStorage();
    await storagePut('project-documents/user-3/project-9/plan.pdf', Buffer.from('pdf'), 'application/pdf');
    expect(puts[0].contentType).toBe('application/pdf');
  });

  it('storageGet still resolves to a proxy path and never to a backend URL', async () => {
    recordingStorage();
    const result = await storageGet('/message-attachments/user-3/photo.jpg');
    expect(result.url).toBe('/manus-storage/message-attachments/user-3/photo.jpg');
    expect(result.url).not.toContain('http');
  });

  it('storageGetSignedUrl delegates to the active backend', async () => {
    recordingStorage();
    await expect(storageGetSignedUrl('avatars/7/photo.png')).resolves.toBe(
      'https://storage.test/avatars/7/photo.png?signature=abc',
    );
  });

  it('leading slashes are normalised, so a key cannot address outside the bucket', async () => {
    const puts = recordingStorage();
    await storagePut('///avatars/7/photo.png', 'x', 'image/png');
    expect(puts[0].key.startsWith('avatars/')).toBe(true);
  });

  it('every upload call site in routers.ts still goes through the adapter', () => {
    // `storagePutOrUnavailable` wraps `storagePut` so an unconfigured
    // deployment answers 503 rather than 500. It still goes through the
    // adapter - it IS the adapter call plus one translated error - so this
    // counts the wrapper and the invariant is untouched.
    // `await` anchors this to CALL SITES: a bare name match also catches the
    // wrapper's own declaration and reads 8 where there are 7.
    const calls = ROUTERS_SOURCE.match(/await storagePutOrUnavailable\(/g) ?? [];
    // SEVEN since the supplier catalogue gained image management. Asserted
    // exactly so a new upload path has to be acknowledged here rather than
    // bypassing the adapter unnoticed.
    expect(calls.length).toBe(7);
    for (const prefix of [
      'registration/', 'project-documents/', 'message-attachments/', 'avatars/',
      // AI attachments get their own prefix so the proxy can classify them,
      // and so they are never mistaken for a category with a wider audience.
      'ai-attachments/',
      // Product images likewise: a separate prefix is what lets the proxy
      // treat them as public-by-design without widening any other category.
      'product-images/',
    ]) {
      expect(ROUTERS_SOURCE).toContain(prefix);
    }
  });
});

// ── §3 Authorization is unchanged — the part that must not regress ─────────

describe('§3 the download proxy still authorizes exactly as before', () => {
  it('keeps a per-category rule for every private prefix', () => {
    for (const category of ['registration/', 'project-documents/', 'message-attachments/', 'rfq-attachments/', 'avatars/']) {
      expect(PROXY_SOURCE).toContain(`key.startsWith('${category}')`);
    }
  });

  it('still fails closed on an unknown prefix', () => {
    const authorize = PROXY_SOURCE.slice(
      PROXY_SOURCE.indexOf('export async function authorizeStorageKey'),
      PROXY_SOURCE.indexOf('export function registerStorageProxy'),
    );
    expect(authorize.trimEnd().endsWith('return false;\n}')).toBe(true);
  });

  it('still requires authentication before authorization', () => {
    const handler = PROXY_SOURCE.slice(PROXY_SOURCE.indexOf('app.get("/manus-storage/*"'));
    expect(handler.indexOf('authenticateStorageRequest')).toBeLessThan(handler.indexOf('authorizeStorageKey'));
    expect(handler).toContain('res.status(401)');
    expect(handler).toContain('res.status(403)');
  });

  it('still verifies private categories against the owning database row', () => {
    expect(PROXY_SOURCE).toContain('registrationDocumentSubmissions.fileKey');
    expect(PROXY_SOURCE).toContain('documents.fileKey');
    expect(PROXY_SOURCE).toContain('messages.fileUrl');
  });

  it('never caches the signed redirect — the URL grants access on its own', () => {
    expect(PROXY_SOURCE).toContain('"Cache-Control", "no-store"');
    expect(PROXY_SOURCE).toContain('res.redirect(307');
  });
});

// ── §4 One place knows where files live ────────────────────────────────────

describe('§4 no module addresses a storage backend directly any more', () => {
  it('storage.ts holds no provider-specific code', () => {
    const code = STORAGE_SOURCE.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    expect(code).not.toContain('forgeApiUrl');
    expect(code).not.toContain('Authorization: `Bearer');
    expect(code).not.toContain('presign');
    expect(code).toContain('getObjectStorage()');
  });

  it('REGRESSION: the proxy no longer builds a Forge URL inline', () => {
    // Two places used to know where files physically live, and a migration
    // would have moved only one of them.
    const code = PROXY_SOURCE.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    expect(code).not.toContain('v1/storage/presign');
    expect(code).not.toContain('ENV.forgeApiKey');
    expect(code).toContain('getObjectStorage().signedGetUrl(key)');
  });

  it('objectStorage.ts is the only module naming a provider', () => {
    for (const source of [STORAGE_SOURCE, PROXY_SOURCE]) {
      const code = source.split('\n').filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*')).join('\n');
      expect(code).not.toContain('S3Client');
      expect(code).not.toContain('PutObjectCommand');
    }
  });

  it('S3 objects are written private — access comes only through the proxy', () => {
    expect(read('./_core/objectStorage.ts')).toContain('ACL: "private"');
  });

  it('signed URLs are short-lived', () => {
    const source = read('./_core/objectStorage.ts');
    expect(source).toContain('SIGNED_URL_TTL_SECONDS');
    const ttl = Number(source.match(/SIGNED_URL_TTL_SECONDS = (\d+)/)?.[1]);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(900);
  });

  it('defaults to path-style addressing, which non-AWS providers require', () => {
    expect(resolveObjectStorage({ ...BASE_ENV }).id).toBe('none');
    const source = read('./_core/env.ts');
    expect(source).toContain('S3_FORCE_PATH_STYLE ?? "true"');
  });
});

// ── §5 Dead Manus scaffold removed ─────────────────────────────────────────

describe('§5 the unused Forge-dependent modules are gone', () => {
  const removed = [
    './_core/imageGeneration.ts',
    './_core/voiceTranscription.ts',
    './_core/heartbeat.ts',
    './_core/map.ts',
    '../client/src/components/Map.tsx',
  ];

  it('none of the five files exists any more', () => {
    for (const relative of removed) {
      expect(existsSync(new URL(relative, import.meta.url))).toBe(false);
    }
  });

  it('nothing imported them, which is why removing them is safe', () => {
    // Verified before deletion by searching every .ts/.tsx in server, client and
    // shared for an import of each module; all five had zero importers. The
    // whole suite and tsc passing after removal is the standing proof.
    for (const name of ['imageGeneration', 'voiceTranscription', 'heartbeat']) {
      expect(ROUTERS_SOURCE).not.toContain(name);
    }
  });
});

// ── §6 Configuration is documented ─────────────────────────────────────────

describe('§6 .env.example', () => {
  const ENV_EXAMPLE = read('../.env.example');

  it('documents every S3 variable the adapter reads', () => {
    for (const key of ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE']) {
      expect(ENV_EXAMPLE).toContain(key);
    }
  });

  it('says which backend wins, so the precedence is not a surprise', () => {
    expect(ENV_EXAMPLE).toMatch(/S3 takes precedence/i);
  });

  it('contains no real credential', () => {
    for (const line of ENV_EXAMPLE.split('\n')) {
      if (/^S3_(ACCESS_KEY_ID|SECRET_ACCESS_KEY)=/.test(line)) {
        expect(line.split('=')[1]).toBe('');
      }
    }
  });
});

// ── §7 The adapter is wired, not merely written ────────────────────────────

describe('§7 the S3 client is constructed from configuration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('an S3 backend is constructible with a custom endpoint', () => {
    const storage = new S3ObjectStorage('buildhub-uploads', {
      endpoint: 'https://ewr1.vultrobjects.com',
      region: 'ewr1',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      forcePathStyle: true,
    });
    expect(storage.id).toBe('s3');
  });

  it('a Forge backend still presigns against the configured host', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ url: 'https://s3.example/signed' }), { status: 200 });
    }) as typeof fetch;
    try {
      const storage = new ForgeObjectStorage('https://forge.example/', 'forge-key');
      await expect(storage.signedGetUrl('avatars/1/x.png')).resolves.toBe('https://s3.example/signed');
      expect(calls[0]).toContain('https://forge.example/v1/storage/presign/get');
      expect(calls[0]).toContain('path=avatars');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('a Forge presign failure surfaces as an error rather than an empty URL', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    try {
      await expect(new ForgeObjectStorage('https://forge.example', 'k').signedGetUrl('a')).rejects.toThrow(/presign/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('isObjectStorageConfigured reflects the registered backend', () => {
    setObjectStorage(new UnconfiguredObjectStorage());
    expect(isObjectStorageConfigured()).toBe(false);
    setObjectStorage(new ForgeObjectStorage('https://forge.example', 'k'));
    expect(isObjectStorageConfigured()).toBe(true);
  });
});
