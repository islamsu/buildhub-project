// ── Upload content-type verification (Slice 9, audit item A10) ─────────────
//
// Every upload endpoint in BuildHub validated the content type the CLIENT
// declared and then stored the bytes under that type without ever looking at
// them. A caller controls both halves of that, so the check confirmed only that
// the caller was willing to type a permitted string.
//
// Two consequences, one boring and one not:
//
//   The boring one: a PDF declared as image/png is served back with the wrong
//   Content-Type and simply fails to render. Compliance reviewers see a broken
//   document and no explanation.
//
//   The one that matters: `image/svg+xml` satisfies every `startsWith('image/')`
//   check in the codebase, and SVG is not a picture format - it is an XML
//   document that can carry <script>. BuildHub serves uploads by 307-redirecting
//   to a signed URL on the object-storage origin, so such a file would execute
//   there rather than on BuildHub's own origin. That is narrower than same-origin
//   stored XSS, and it is still a hostile page served from a BuildHub-branded
//   storage domain, reached through a BuildHub link, with the user's trust
//   attached to it.
//
// So: sniff the real bytes, require them to agree with the declaration, and
// refuse the formats whose whole problem is that they are executable documents.

/** Magic-byte signatures, checked at a fixed offset. */
type Signature = {
  readonly mime: string;
  readonly offset: number;
  readonly bytes: readonly number[];
  /** Optional second window that must also match (WEBP's 'WEBP' at byte 8). */
  readonly also?: { readonly offset: number; readonly bytes: readonly number[] };
};

const ASCII = (text: string) => Array.from(text, character => character.charCodeAt(0));

const SIGNATURES: readonly Signature[] = [
  { mime: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', offset: 0, bytes: ASCII('GIF87a') },
  { mime: 'image/gif', offset: 0, bytes: ASCII('GIF89a') },
  {
    mime: 'image/webp',
    offset: 0,
    bytes: ASCII('RIFF'),
    also: { offset: 8, bytes: ASCII('WEBP') },
  },
  { mime: 'application/pdf', offset: 0, bytes: ASCII('%PDF-') },
];

function matches(buffer: Buffer, signature: Signature): boolean {
  const window = (offset: number, bytes: readonly number[]) => {
    if (buffer.length < offset + bytes.length) return false;
    return bytes.every((byte, index) => buffer[offset + index] === byte);
  };
  if (!window(signature.offset, signature.bytes)) return false;
  return signature.also ? window(signature.also.offset, signature.also.bytes) : true;
}

/**
 * The format the bytes actually are, or null when nothing recognises them.
 *
 * Null is not "safe" - it means unrecognised, and every caller here treats it
 * as a rejection. An allowlist of formats BuildHub can serve is the point.
 */
export function sniffContentType(buffer: Buffer): string | null {
  for (const signature of SIGNATURES) {
    if (matches(buffer, signature)) return signature.mime;
  }
  return null;
}

/**
 * Formats refused outright, whatever their bytes say.
 *
 * SVG is the reason this list exists. It passes every `image/*` check while
 * being a scriptable document; there is no version of "user-uploaded SVG served
 * back to other users" that is worth the review burden, and no BuildHub feature
 * needs it - avatars, compliance documents, RFQ attachments and product images
 * are all photographs and scans.
 */
const REFUSED_TYPES: ReadonlySet<string> = new Set([
  'image/svg+xml',
  'image/svg',
  'text/html',
  'application/xhtml+xml',
  'application/xml',
  'text/xml',
]);

export type FileTypeProblem = { reason: 'refused' | 'unrecognised' | 'mismatch'; message: string };

/**
 * Check a declared content type against the bytes that arrived.
 *
 * Returns a problem to report, or null when the upload is consistent and of a
 * format BuildHub is willing to store. Callers turn the problem into their own
 * error type so this module stays free of tRPC.
 *
 * `jpg`/`jpeg` naming and the several GIF versions are normalised inside
 * sniffContentType, so a caller only ever compares canonical MIME strings.
 */
export function checkUploadedFile(
  declaredContentType: string,
  buffer: Buffer,
  allowed: readonly string[],
): FileTypeProblem | null {
  const declared = declaredContentType.split(';')[0].trim().toLowerCase();

  if (REFUSED_TYPES.has(declared)) {
    return {
      reason: 'refused',
      message: `${declared} files are not accepted. Please upload a PNG, JPEG, GIF, WEBP or PDF.`,
    };
  }

  const actual = sniffContentType(buffer);
  if (actual === null) {
    return {
      reason: 'unrecognised',
      message: 'This file is not a readable image or PDF. Please upload a PNG, JPEG, GIF, WEBP or PDF.',
    };
  }

  // The bytes must be a format this endpoint accepts - checked against the
  // SNIFFED type, so an endpoint that permits only images cannot be handed a
  // PDF wearing an image/png label.
  if (!allowed.includes(actual)) {
    return {
      reason: 'mismatch',
      message: `${actual} files are not accepted here.`,
    };
  }

  if (actual !== declared) {
    return {
      reason: 'mismatch',
      message: `This file is a ${actual}, not the ${declared} it was uploaded as.`,
    };
  }

  return null;
}

/** Every format BuildHub will store. Endpoints narrow this, never widen it. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const DOCUMENT_TYPES = [...IMAGE_TYPES, 'application/pdf'] as const;
