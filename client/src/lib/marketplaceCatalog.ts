export type MarketplaceVariant = { id: string; label: string; labelAr: string; unitMultiplier: number };

export const DEFAULT_PRODUCT_VARIANTS: MarketplaceVariant[] = [
  { id: 'standard', label: 'Standard unit', labelAr: 'الوحدة القياسية', unitMultiplier: 1 },
  { id: 'bulk', label: 'Bulk order', labelAr: 'طلب كميات كبيرة', unitMultiplier: 10 },
];

export function getProductVariants(product: { unit?: string | null; variants?: MarketplaceVariant[] } | null | undefined): MarketplaceVariant[] {
  if (product?.variants?.length) return product.variants;
  return DEFAULT_PRODUCT_VARIANTS.map(variant => ({ ...variant, label: variant.id === 'standard' && product?.unit ? product.unit : variant.label, labelAr: variant.id === 'standard' && product?.unit ? product.unit : variant.labelAr }));
}

export type MarketplaceCatalogProduct = {
  id: number;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  category: string;
  brand: string;
  price: string;
  currency: string;
  unit: string;
  rating: string;
  reviewCount: number;
  stock: number;
  images: string;
  origin: string;
  deliveryDays: number;
  warranty: string;
  specs: string;
  featured: boolean;
  variants?: MarketplaceVariant[];
};

// DEMO_PRODUCTS lived here: ten hardcoded fictional products with invented
// brands, prices, stock levels and ratings, rendered unconditionally on the
// public marketplace as though they were real inventory. Removed - the
// marketplace now reads the database, like the vendor directory has since
// Phase 4B.3. The variant helpers above are real and stay.

