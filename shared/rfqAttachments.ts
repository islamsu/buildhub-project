export type RfqAttachmentMetadata = {
  key: string;
  url: string;
  name: string;
  type: string;
  size: number;
};

export function parseRfqAttachments(raw: string | null | undefined): RfqAttachmentMetadata[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RfqAttachmentMetadata => {
      if (!item || typeof item !== 'object') return false;
      const value = item as Record<string, unknown>;
      return typeof value.key === 'string'
        && typeof value.url === 'string'
        && typeof value.name === 'string'
        && typeof value.type === 'string'
        && typeof value.size === 'number';
    });
  } catch {
    return [];
  }
}

/**
 * A marketplace product carried into an RFQ, parsed engine-independently.
 *
 * `rfqs.productReference` is declared json() in the schema, and the two engines
 * BuildHub runs on disagree about what that means:
 *
 *   MariaDB 10.11  JSON is an alias for LONGTEXT, so the driver hands back a
 *                  STRING.
 *   MySQL 8        JSON is a native type, so the driver hands back a parsed
 *                  OBJECT.
 *
 * The previous normaliser lived in the client and required an object, so on
 * MariaDB it returned null for every RFQ and the whole marketplace-to-RFQ
 * product handoff was silently dead. It would have started working by itself on
 * a MySQL 8 staging database, which is a worse failure than staying broken:
 * behaviour that changes with the storage engine is behaviour nobody can
 * reason about.
 *
 * Accepting both shapes here makes the feature independent of which engine is
 * underneath, which is the property that actually matters.
 */
export type RfqProductReference = {
  productId: number;
  variantId: string;
  variantLabel: string;
};

export function parseProductReference(value: unknown): RfqProductReference | null {
  if (value === null || value === undefined) return null;

  // MariaDB path: a JSON string that still needs parsing.
  let candidate: unknown = value;
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (trimmed.length === 0) return null;
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;

  return typeof record.productId === 'number'
    && Number.isFinite(record.productId)
    && typeof record.variantId === 'string'
    && record.variantId.length > 0
    && typeof record.variantLabel === 'string'
    && record.variantLabel.length > 0
    ? {
        productId: record.productId,
        variantId: record.variantId,
        variantLabel: record.variantLabel,
      }
    : null;
}
