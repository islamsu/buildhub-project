import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./env";

/**
 * ── Object storage adapter (Slice 5) ───────────────────────────────────────
 *
 * Every file BuildHub holds - vendor registration documents, project drawings,
 * message attachments, avatars - is written through Forge, a Manus-platform
 * service reached with BUILT_IN_FORGE_API_URL / BUILT_IN_FORGE_API_KEY. It is
 * the last live coupling to that platform (the other four modules that import
 * it are scaffold with no callers at all, removed in this slice).
 *
 * Forge is not a storage engine of its own: it hands out presigned S3 URLs and
 * the app PUTs straight to S3. So the migration is not a rewrite, it is
 * addressing the same protocol directly - and Vultr Object Storage, the chosen
 * production target, speaks S3.
 *
 * Both implementations live behind this interface. The backend is chosen by
 * configuration, never by a caller, and both `server/storage.ts` and the
 * `/manus-storage` download proxy go through it - so there is exactly one place
 * that knows where a file physically lives.
 */

export interface ObjectStorage {
  /** Stable identifier, surfaced in diagnostics. 'none' means unusable. */
  readonly id: string;
  put(key: string, data: Buffer | Uint8Array | string, contentType: string): Promise<void>;
  /** A short-lived URL the browser can be redirected to. Never a public URL. */
  signedGetUrl(key: string): Promise<string>;
  /**
   * The stored bytes, read back by the SERVER.
   *
   * Added for AI attachments, which the server has to forward to the model
   * itself. The alternative was to hand OpenAI a signed URL and let it fetch
   * the object directly, which would mean a third party holding a credential
   * to BuildHub's private storage - short-lived, but still a URL that grants
   * access to a user's file existing outside BuildHub's control. Reading the
   * bytes here keeps the whole transfer inside the request BuildHub already
   * authorised.
   *
   * The browser is NOT a caller: it goes through /manus-storage, which checks
   * ownership and then redirects to a signed URL.
   */
  get(key: string): Promise<Buffer>;
}

export class ObjectStorageNotConfiguredError extends Error {
  constructor(operation: string) {
    super(
      `No object storage backend is configured; cannot ${operation}. ` +
        `Set S3_BUCKET (with S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY) ` +
        `or BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY.`,
    );
    this.name = "ObjectStorageNotConfiguredError";
  }
}

/** How long a download redirect stays valid. Long enough for a browser to follow it. */
const SIGNED_URL_TTL_SECONDS = 300;

/**
 * The original path: ask Forge to presign, then talk to S3 directly. Preserved
 * byte-for-byte in behaviour so a deployment that still has Forge keeps working
 * exactly as before.
 */
export class ForgeObjectStorage implements ObjectStorage {
  readonly id = "forge";

  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
  ) {}

  private endpoint(operation: "put" | "get", key: string): URL {
    const url = new URL(`v1/storage/presign/${operation}`, `${this.apiUrl.replace(/\/+$/, "")}/`);
    url.searchParams.set("path", key);
    return url;
  }

  private async presign(operation: "put" | "get", key: string): Promise<string> {
    const response = await fetch(this.endpoint(operation, key), {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`Storage presign (${operation}) failed (${response.status}): ${detail}`);
    }
    const { url } = (await response.json()) as { url?: string };
    if (!url) throw new Error(`Storage presign (${operation}) returned an empty URL`);
    return url;
  }

  async put(key: string, data: Buffer | Uint8Array | string, contentType: string): Promise<void> {
    const target = await this.presign("put", key);
    const body = typeof data === "string" ? new Blob([data], { type: contentType }) : new Blob([data as BlobPart], { type: contentType });
    const response = await fetch(target, { method: "PUT", headers: { "Content-Type": contentType }, body });
    if (!response.ok) {
      throw new Error(`Storage upload to S3 failed (${response.status})`);
    }
  }

  signedGetUrl(key: string): Promise<string> {
    return this.presign("get", key);
  }

  async get(key: string): Promise<Buffer> {
    const response = await fetch(await this.presign("get", key));
    if (!response.ok) {
      throw new Error(`Storage read failed (${response.status})`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

/**
 * Direct S3, for any S3-compatible provider. Vultr Object Storage, AWS S3,
 * MinIO and Backblaze B2 all work through this without a code change; only the
 * endpoint and credentials differ.
 *
 * Path-style addressing by default: virtual-host style requires a wildcard
 * TLS certificate on the endpoint, which most non-AWS providers do not offer.
 */
export class S3ObjectStorage implements ObjectStorage {
  readonly id = "s3";
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    options: { endpoint?: string; region: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean },
  ) {
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      forcePathStyle: options.forcePathStyle,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async put(key: string, data: Buffer | Uint8Array | string, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: typeof data === "string" ? Buffer.from(data) : Buffer.from(data),
        ContentType: contentType,
        // Objects are reached only through the authorizing /manus-storage proxy,
        // which issues a short-lived signed URL per request. Nothing is public.
        ACL: "private",
      }),
    );
  }

  signedGetUrl(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = result.Body;
    if (!body) throw new Error(`Storage read returned no body for ${key}`);
    return Buffer.from(await body.transformToByteArray());
  }
}

/** The default when nothing is configured: refuses loudly on first use. */
export class UnconfiguredObjectStorage implements ObjectStorage {
  readonly id = "none";
  async put(): Promise<void> {
    throw new ObjectStorageNotConfiguredError("store a file");
  }
  async signedGetUrl(): Promise<string> {
    throw new ObjectStorageNotConfiguredError("read a file");
  }
  async get(): Promise<Buffer> {
    throw new ObjectStorageNotConfiguredError("read a file");
  }
}

/**
 * Resolve the backend from configuration.
 *
 * S3 wins when a bucket is configured, so a deployment migrating off Forge
 * switches by setting S3_* and needs no code change and no redeploy of
 * different artefacts. Forge remains the fallback so existing deployments are
 * unaffected by this slice.
 */
export function resolveObjectStorage(env = ENV): ObjectStorage {
  if (env.s3Bucket && env.s3AccessKeyId && env.s3SecretAccessKey) {
    return new S3ObjectStorage(env.s3Bucket, {
      endpoint: env.s3Endpoint || undefined,
      region: env.s3Region || "us-east-1",
      accessKeyId: env.s3AccessKeyId,
      secretAccessKey: env.s3SecretAccessKey,
      forcePathStyle: env.s3ForcePathStyle,
    });
  }
  if (env.forgeApiUrl && env.forgeApiKey) {
    return new ForgeObjectStorage(env.forgeApiUrl, env.forgeApiKey);
  }
  return new UnconfiguredObjectStorage();
}

let active: ObjectStorage | null = null;

export function getObjectStorage(): ObjectStorage {
  if (!active) active = resolveObjectStorage();
  return active;
}

/** Override for tests, and for a startup that wants to pin a backend. */
export function setObjectStorage(storage: ObjectStorage | null): void {
  active = storage;
}

export function isObjectStorageConfigured(): boolean {
  return getObjectStorage().id !== "none";
}
