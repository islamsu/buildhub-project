export const MAX_RFQ_ATTACHMENT_SIZE = 8 * 1024 * 1024;
export const MAX_RFQ_ATTACHMENTS = 6;

export function isAllowedRfqAttachmentType(contentType: string): boolean {
  return contentType.startsWith('image/') || contentType === 'application/pdf';
}

export function isValidRfqAttachmentSize(size: number): boolean {
  return Number.isFinite(size) && size > 0 && size <= MAX_RFQ_ATTACHMENT_SIZE;
}
