// File storage entry points.
//
// Slice 5: the Forge-specific logic that used to live here moved into
// server/_core/objectStorage.ts, which now holds two interchangeable backends -
// the original Forge presign client and a direct S3 client for any
// S3-compatible provider (Vultr Object Storage, AWS S3, MinIO). The backend is
// chosen by configuration; nothing below knows or cares which one answers.
//
// The three exported signatures are unchanged, so all five upload call sites in
// server/routers.ts and the /manus-storage download proxy keep working exactly
// as before, and the storage-key authorization rules in
// server/_core/storageProxy.ts are untouched.
//
// The `/manus-storage/{key}` URL shape is deliberately preserved even on S3:
// it is stored in the database (messages.fileUrl, documents.fileKey,
// registrationDocumentSubmissions.fileKey), and rewriting it would mean a data
// migration to gain nothing. It is a route on this server, not a Manus address.

import { getObjectStorage } from "./_core/objectStorage";

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

/**
 * Appended to every uploaded key. Two vendors uploading "licence.pdf" a second
 * apart must not collide, and a predictable key would let one guess another's -
 * though the proxy verifies ownership against the database regardless, so this
 * is a second line rather than the authorization itself.
 */
function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  await getObjectStorage().put(key, data, contentType);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  return getObjectStorage().signedGetUrl(normalizeKey(relKey));
}
