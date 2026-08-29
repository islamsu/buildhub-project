/**
 * THE PRODUCT TAXONOMY.
 *
 * This list lived as a private const inside RolePlatform.tsx, and the server's
 * `marketplace.create` accepted `category: z.string().min(1)` - any string at
 * all. A supplier could list under "buildingmaterials", "Building Materials "
 * or a typo, and the marketplace category filter would then never find that
 * product again: it is a dropdown of THIS list, and a value outside it matches
 * no filter and appears under no heading.
 *
 * One shared list, enforced on every write path - the dialog, and bulk import.
 */
export const PRODUCT_CATEGORIES = [
  'Materials', 'Furniture', 'Lighting', 'Electrical', 'Plumbing', 'HVAC',
  'Paint', 'Ceramics', 'Granite', 'Marble', 'Wood', 'Doors', 'Windows',
  'Roofing', 'Glass', 'Steel', 'Concrete', 'Solar', 'Smart Home',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export function isProductCategory(value: unknown): value is ProductCategory {
  return typeof value === 'string' && (PRODUCT_CATEGORIES as readonly string[]).includes(value);
}
