/**
 * What BuildHub AI will accept as an attachment, shared by the browser and the
 * server so the two cannot disagree about it.
 *
 * WHY THIS LIST AND NOT A LONGER ONE. The brief asked us to evaluate PDF, PNG,
 * JPEG, WEBP, TXT, CSV, DOCX and XLSX, and to advertise nothing the
 * implementation cannot actually process. Applying that honestly rules three
 * groups out for now, and the reasons are worth keeping next to the list:
 *
 *   TXT and CSV have NO magic bytes. BuildHub's upload gate
 *   (server/_core/fileType.ts) works by sniffing the real bytes and refusing
 *   anything it cannot recognise - that gate is what stops an SVG or an HTML
 *   document arriving as "image/png". Admitting a format defined by the absence
 *   of a signature means admitting ANY byte sequence under a text/* label,
 *   which turns the gate off for the one content type most likely to be used to
 *   smuggle something else. Supporting them safely means a content inspector
 *   (valid UTF-8, no NUL bytes, a delimiter shape for CSV), not a wider
 *   allowlist.
 *
 *   DOCX and XLSX are ZIP containers. Their signature is PK\x03\x04, which is
 *   also the signature of every other zip on earth, so sniffing cannot tell an
 *   XLSX from an arbitrary archive without opening it and reading the parts
 *   inside. Doing that safely means bounding decompression (zip bombs), and
 *   deciding what to do about embedded macros and external relationships.
 *   That is a real piece of work, not a line in an array.
 *
 *   GIF is sniffable and BuildHub already stores it, but it is excluded here on
 *   purpose: an animated GIF is a video in a picture's clothing, and what the
 *   model receives from one frame of it is not what the user believes they
 *   sent.
 *
 * So the supported set is exactly what BuildHub can verify AND the model can
 * genuinely read: three raster formats and PDF. Everything else is reported to
 * the user as unsupported rather than accepted and silently mishandled.
 */

/** Images the model can look at, and BuildHub can prove are images. */
export const AI_ATTACHMENT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Documents the model can read directly. */
export const AI_ATTACHMENT_DOCUMENT_TYPES = ['application/pdf'] as const;

export const AI_ATTACHMENT_TYPES = [
  ...AI_ATTACHMENT_IMAGE_TYPES,
  ...AI_ATTACHMENT_DOCUMENT_TYPES,
] as const;

export type AiAttachmentType = (typeof AI_ATTACHMENT_TYPES)[number];

/**
 * 8 MB, matching MAX_RFQ_ATTACHMENT_SIZE rather than inventing a second number.
 * A user who can attach an 8 MB drawing to an RFQ should not discover a
 * different limit one page away.
 */
export const MAX_AI_ATTACHMENT_SIZE = 8 * 1024 * 1024;

/**
 * One attachment per message for now. Multi-file comparison ("compare this
 * quotation against this BOQ") is a genuinely useful feature and is NOT
 * implemented here - see the handoff. Raising this constant is not sufficient
 * to deliver it: the answer has to attribute each fact to the right document,
 * and nothing in the current prompt or evaluation suite checks that it does.
 */
export const MAX_AI_ATTACHMENTS_PER_MESSAGE = 1;

export const isAiAttachmentType = (contentType: string): contentType is AiAttachmentType =>
  (AI_ATTACHMENT_TYPES as readonly string[]).includes(contentType.split(';')[0].trim().toLowerCase());

export const isAiAttachmentImage = (contentType: string): boolean =>
  (AI_ATTACHMENT_IMAGE_TYPES as readonly string[]).includes(contentType.split(';')[0].trim().toLowerCase());

export const isValidAiAttachmentSize = (size: number): boolean =>
  Number.isFinite(size) && size > 0 && size <= MAX_AI_ATTACHMENT_SIZE;

/**
 * The filename reduced to characters that are safe in a storage key and in a
 * Content-Disposition header.
 *
 * Path separators, "..", control characters and leading dots all collapse to
 * underscores, so a name like `../../etc/passwd` cannot climb out of its
 * prefix. The result is also length-bounded, because the storage key embeds it.
 */
export function safeAttachmentName(rawName: string): string {
  const withoutPath = rawName.replace(/^.*[\\/]/, '');
  const collapsed = withoutPath.replace(/[^\w.-]+/g, '_').replace(/\.{2,}/g, '_');
  const trimmed = collapsed.replace(/^[._]+/, '').slice(0, 120);
  return trimmed.length > 0 ? trimmed : 'attachment';
}

/** The extension the NAME claims, lowercased and without the dot. */
export const attachmentExtension = (name: string): string => {
  const match = /\.([A-Za-z0-9]+)$/.exec(name);
  return match ? match[1].toLowerCase() : '';
};

/**
 * Extensions consistent with each accepted content type. The extension is never
 * the authority - the sniffed bytes are - but a name that disagrees with its
 * own bytes is worth refusing rather than silently renaming, because the user
 * is about to be told what BuildHub thinks they sent.
 */
const EXTENSIONS: Record<AiAttachmentType, readonly string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
};

export const extensionMatchesType = (name: string, contentType: AiAttachmentType): boolean => {
  const extension = attachmentExtension(name);
  return extension.length === 0 ? false : EXTENSIONS[contentType].includes(extension);
};
