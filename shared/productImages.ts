/**
 * Product image limits, shared so the client and the server agree.
 *
 * A client that allows six files against a server that accepts five produces a
 * failure the user cannot understand, at the end of the slowest step in the
 * flow. One constant, imported by both.
 */

/** Formats a product photo may be. Images only - a photo is not a PDF. */
export const PRODUCT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ProductImageType = (typeof PRODUCT_IMAGE_TYPES)[number];

/**
 * 5 MB. Smaller than the 8 MB used for RFQ attachments on purpose: an RFQ
 * attachment is a drawing or a BOQ someone needs to read in detail, a product
 * photo is a catalogue thumbnail and a hero image.
 */
export const MAX_PRODUCT_IMAGE_SIZE = 5 * 1024 * 1024;

/**
 * Eight images per product. The FIRST one is the primary - the marketplace card
 * and the top of the detail page both render images[0] - so ordering and
 * choosing a primary are the same operation, and there is no separate
 * primaryImageId that could drift out of step with the array.
 */
export const MAX_PRODUCT_IMAGES = 8;

export const isProductImageType = (contentType: string): contentType is ProductImageType =>
  (PRODUCT_IMAGE_TYPES as readonly string[]).includes(contentType.split(';')[0].trim().toLowerCase());

/**
 * `products.images` is a TEXT column holding a JSON array. Older rows may hold
 * a comma-separated string, so the fallback is kept rather than assumed away.
 * One parser, used by every surface that renders product photos.
 */
export function parseProductImages(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
}
