export const PROJECT_DOCUMENT_TYPES = ['drawing', 'boq', 'photo', 'contract', 'invoice', 'other'] as const;
export type ProjectDocumentType = (typeof PROJECT_DOCUMENT_TYPES)[number];

export function isAllowedProjectDocumentType(contentType: string): boolean {
  return contentType.startsWith('image/') || contentType === 'application/pdf' || contentType.startsWith('text/');
}

export function clampProjectProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
