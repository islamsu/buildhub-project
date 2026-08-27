import { checkUploadedFile } from './fileType';
import {
  AI_ATTACHMENT_TYPES,
  isAiAttachmentImage,
  isValidAiAttachmentSize,
  extensionMatchesType,
  safeAttachmentName,
  MAX_AI_ATTACHMENT_SIZE,
  type AiAttachmentType,
} from '@shared/aiAttachments';

/**
 * Validating an AI attachment, and turning it into something the model can read.
 *
 * The validation here deliberately REUSES server/_core/fileType.ts rather than
 * re-deriving it. That module is the outcome of audit item A10 - it sniffs the
 * real bytes, refuses SVG/HTML/XML outright, and rejects a file whose bytes
 * disagree with its declared type. Writing a second, parallel gate for AI
 * uploads would mean two places to keep correct and one of them eventually
 * being wrong; the AI path narrows fileType's allowlist instead of replacing it.
 */

export type AttachmentRejection = {
  /** Stable code, safe to show a user and safe to assert on in a test. */
  code: 'too-large' | 'empty' | 'unsupported-type' | 'extension-mismatch' | 'content-mismatch';
  message: string;
};

export type ValidatedAttachment = {
  name: string;
  contentType: AiAttachmentType;
  bytes: Buffer;
};

/**
 * Everything that must be true before a byte of this file reaches storage or a
 * provider. Order matters: the cheap structural checks run before the byte
 * inspection, so an oversized file is refused without being sniffed.
 */
export function validateAiAttachment(params: {
  name: string;
  declaredType: string;
  bytes: Buffer;
}): AttachmentRejection | ValidatedAttachment {
  const declared = params.declaredType.split(';')[0].trim().toLowerCase();

  if (params.bytes.length === 0) {
    return { code: 'empty', message: 'That file is empty.' };
  }
  if (!isValidAiAttachmentSize(params.bytes.length)) {
    return {
      code: 'too-large',
      message: `That file is larger than the ${Math.floor(MAX_AI_ATTACHMENT_SIZE / (1024 * 1024))} MB limit.`,
    };
  }
  if (!(AI_ATTACHMENT_TYPES as readonly string[]).includes(declared)) {
    return {
      code: 'unsupported-type',
      message: 'BuildHub AI can read PNG, JPEG, WEBP and PDF files.',
    };
  }

  const contentType = declared as AiAttachmentType;
  const name = safeAttachmentName(params.name);

  if (!extensionMatchesType(name, contentType)) {
    return {
      code: 'extension-mismatch',
      message: 'That file name does not match the kind of file it says it is.',
    };
  }

  // The authority. A caller controls the declared type AND the extension; only
  // the bytes are hard to lie about.
  const problem = checkUploadedFile(contentType, params.bytes, AI_ATTACHMENT_TYPES);
  if (problem) {
    return { code: 'content-mismatch', message: problem.message };
  }

  return { name, contentType, bytes: params.bytes };
}

/**
 * The attachment as a Responses API content part.
 *
 * Images go in as `input_image` and PDFs as `input_file`, which is the split
 * the API itself draws - a PDF pushed through the image channel is not read as
 * a document, and an image base64'd into a text prompt is not looked at at all.
 * Both carry the bytes INLINE as a data URL / file_data rather than as a URL
 * pointing back at BuildHub: the provider never receives a credential to
 * BuildHub storage, and no object is created on the provider's side that would
 * later need deleting.
 */
export function toModelContent(attachment: { name: string; contentType: string; bytes: Buffer }):
  | { type: 'input_image'; image_url: string; detail: 'auto' }
  | { type: 'input_file'; filename: string; file_data: string } {
  const base64 = attachment.bytes.toString('base64');

  if (isAiAttachmentImage(attachment.contentType)) {
    return {
      type: 'input_image',
      image_url: `data:${attachment.contentType};base64,${base64}`,
      detail: 'auto',
    };
  }

  return {
    type: 'input_file',
    filename: attachment.name,
    file_data: `data:${attachment.contentType};base64,${base64}`,
  };
}

/**
 * What the model is told about an attachment it has been given.
 *
 * The source-priority rule from the brief lives here rather than in the global
 * system prompt, because it applies only when a file is actually present:
 * telling the model on every request to "prefer the attachment" when there is
 * no attachment is how a model starts inventing one.
 */
export function attachmentInstruction(names: string[], lang: 'en' | 'ar'): string {
  const list = names.join(', ');
  return `=== ATTACHED FILE${names.length > 1 ? 'S' : ''} ===
The person has attached: ${list}.

This file is the SUBJECT of their question and it OUTRANKS every other source
you have, including BuildHub's own knowledge and your general construction
expertise, for any fact ABOUT THIS FILE.

  - Read the attachment and answer from what is actually in it. Do not answer
    from what a document of this kind usually contains.
  - If the attachment contradicts a general assumption, THE ATTACHMENT GOVERNS
    for that specific product, drawing or document - say so plainly.
  - If the attachment does not contain what was asked for, say that it does not,
    rather than filling the gap from general knowledge and presenting it as if
    you had read it.
  - If the file is unreadable, unclear or partly illegible, say which part.
  - Never invent a figure, dimension, quantity, rate, certification or product
    name that is not in the file.

After you have answered from the attachment, you may add BuildHub information
or general construction guidance - clearly separated, and clearly labelled as
context rather than as something the file says.${lang === 'ar' ? '\nAnswer in Arabic.' : ''}
=== END ATTACHED FILE${names.length > 1 ? 'S' : ''} ===`;
}
