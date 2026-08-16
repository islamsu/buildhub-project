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
