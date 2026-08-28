export const PROJECT_DOCUMENT_TYPES = ['drawing', 'boq', 'photo', 'contract', 'invoice', 'other'] as const;
export type ProjectDocumentType = (typeof PROJECT_DOCUMENT_TYPES)[number];

/**
 * The content types a project document may declare.
 *
 * THIS LIST MUST MATCH WHAT THE SERVER CAN ACTUALLY VERIFY. It used to be
 * wider than that: it accepted `text/*` and any `image/*`, while the byte
 * sniffer the upload runs immediately afterwards accepts only PNG, JPEG, GIF,
 * WebP and PDF - the formats with a magic number to check. So a .txt or a
 * .svg passed validation, reached the sniffer, and came back rejected. The
 * product advertised uploads it could never accept, and the refusal arrived
 * after the user had already picked the file.
 *
 * Narrowing this is the honest direction: a declared type nothing can verify
 * is not a capability, and `server/projectFeatures.test.ts` holds the two
 * lists against each other so they cannot drift apart again.
 */
export const PROJECT_DOCUMENT_CONTENT_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
] as const;

export function isAllowedProjectDocumentType(contentType: string): boolean {
  return (PROJECT_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(contentType);
}

export function clampProjectProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
