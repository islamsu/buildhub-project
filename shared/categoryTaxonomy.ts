/**
 * THE CANONICAL PRODUCT CATEGORY TAXONOMY - SEED AND RECONCILIATION.
 *
 * BuildHub had three unrelated product-category vocabularies, none of them
 * administrable, and the reported bug was one of them refusing a value another
 * has carried all along:
 *
 *   A  shared/productCategories.ts        19 flat English strings, the WRITE-PATH
 *                                         validator for both single product and
 *                                         bulk import. What products are stored as.
 *   B  client/src/lib/marketplaceData.ts  33 browse chips with slug, English,
 *                                         Arabic and icon. Shares NO value with A.
 *   C  shared/rfqCategories.ts            9 SERVICE categories for RFQ-to-vendor
 *                                         matching. A separate concern, NOT merged.
 *
 * "Waterproofing" and "Pools" were never missing from BuildHub. They are in B
 * (`waterproofing` / عزل مائي, and `pools` / "Swimming Pool Equipment"), and
 * simply could not be listed against because A is what the validator reads.
 * A shopper clicking either chip could never find a product.
 *
 * B IS THE CANONICAL SET, because it is bilingual, carries stable slugs, and is
 * broader. A's values must all remain RESOLVABLE, because products and import
 * templates hold them - so each is mapped below, deliberately, one at a time.
 *
 * TWO PLACES WHERE MERGING WOULD HAVE CHANGED MEANING, and so was not done:
 *
 *   B's chip "Marble & Granite" covers two DISTINCT categories in A - `Marble`
 *   and `Granite`. Collapsing them would silently recategorise every granite
 *   product as marble. They are seeded as two canonical categories instead, and
 *   "Marble & Granite" is deliberately NOT registered as an alias: it is
 *   genuinely ambiguous, and an ambiguous name must be refused, never guessed.
 *
 *   A's `Materials` is a broad umbrella with no equivalent in B. It is kept as
 *   its own canonical category rather than being folded into `Cement & Concrete`
 *   or anything else.
 */

export type CategoryScope = 'PRODUCT' | 'SERVICE' | 'BOTH';
export type CategoryStatus = 'active' | 'hidden' | 'archived';

export type SeedCategory = {
  slug: string;
  nameEn: string;
  nameAr: string;
  icon?: string;
  scope?: CategoryScope;
  /**
   * Controlled second names that resolve to THIS category and no other.
   *
   * Every alias here is a value the product taxonomy already used, so an
   * existing product, a saved import template or a vendor's spreadsheet keeps
   * working. Aliases are never invented from an upload - see §10 of the brief.
   */
  aliases?: string[];
};

/**
 * NORMALISATION FOR LOOKUP.
 *
 * Case, surrounding whitespace and runs of internal whitespace are noise:
 * "Waterproofing", " waterproofing " and "WATERPROOFING" are the same category.
 * Arabic tatweel (ـ) is a presentational elongation that carries no meaning, and
 * the zero-width joiners are invisible, so both are stripped.
 *
 * This is deliberately NOT fuzzy. Nothing here computes an edit distance or a
 * similarity score, because a near-match that silently picks the wrong category
 * is worse than an error the uploader can act on.
 */
export function normalizeCategoryKey(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[ـ​-‏﻿]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * The seed. Order is the default `sortOrder`, so the browse experience keeps
 * the sequence the chips already had.
 */
export const SEED_CATEGORIES: readonly SeedCategory[] = [
  // A's umbrella value, with no equivalent in B. Kept rather than folded in.
  { slug: 'materials', nameEn: 'Materials', nameAr: 'مواد بناء', icon: '🧰' },

  { slug: 'cement', nameEn: 'Cement & Concrete', nameAr: 'أسمنت وخرسانة', icon: '🏗️', aliases: ['Concrete'] },
  { slug: 'steel', nameEn: 'Steel & Reinforcement', nameAr: 'حديد وتسليح', icon: '⚙️', aliases: ['Steel'] },
  { slug: 'bricks', nameEn: 'Bricks & Blocks', nameAr: 'طوب وبلوكات', icon: '🧱' },
  { slug: 'sand', nameEn: 'Sand & Aggregates', nameAr: 'رمل وركام', icon: '⛰️' },
  { slug: 'paints', nameEn: 'Paints & Coatings', nameAr: 'دهانات وطلاءات', icon: '🎨', aliases: ['Paint'] },
  { slug: 'ceramics', nameEn: 'Ceramics & Porcelain', nameAr: 'سيراميك وبورسلين', icon: '🏺', aliases: ['Ceramics'] },

  // SPLIT, not merged - see the header. B grouped these under one chip; A treats
  // them as two categories and products are stored under both names.
  { slug: 'marble', nameEn: 'Marble', nameAr: 'رخام', icon: '🪨' },
  { slug: 'granite', nameEn: 'Granite', nameAr: 'جرانيت', icon: '🪨' },

  { slug: 'flooring', nameEn: 'Flooring', nameAr: 'أرضيات', icon: '🟫' },
  { slug: 'doors', nameEn: 'Doors', nameAr: 'أبواب', icon: '🚪' },
  { slug: 'windows', nameEn: 'Windows', nameAr: 'نوافذ', icon: '🪟' },
  { slug: 'aluminum', nameEn: 'Aluminum Systems', nameAr: 'أنظمة ألوميتال', icon: '🔩' },
  { slug: 'glass', nameEn: 'Glass', nameAr: 'زجاج', icon: '🔮' },
  { slug: 'wood', nameEn: 'Wood & Timber', nameAr: 'خشب وأخشاب', icon: '🪵', aliases: ['Wood'] },
  { slug: 'kitchens', nameEn: 'Kitchens', nameAr: 'مطابخ', icon: '🍳' },
  { slug: 'wardrobes', nameEn: 'Wardrobes', nameAr: 'دواليب', icon: '🚪' },
  { slug: 'furniture', nameEn: 'Furniture', nameAr: 'أثاث', icon: '🛋️' },
  { slug: 'lighting', nameEn: 'Lighting', nameAr: 'إضاءة', icon: '💡' },
  { slug: 'electrical', nameEn: 'Electrical Supplies', nameAr: 'مستلزمات كهربائية', icon: '⚡', aliases: ['Electrical'] },
  { slug: 'plumbing', nameEn: 'Plumbing Supplies', nameAr: 'مستلزمات سباكة', icon: '🔧', aliases: ['Plumbing'] },
  { slug: 'hvac', nameEn: 'HVAC Systems', nameAr: 'أنظمة تكييف وتهوية', icon: '❄️', aliases: ['HVAC'] },
  { slug: 'gypsum', nameEn: 'Gypsum & Ceilings', nameAr: 'جبس وأسقف', icon: '🧱' },

  // THE REPORTED CASE. Already present in the browse taxonomy all along.
  { slug: 'waterproofing', nameEn: 'Waterproofing', nameAr: 'عزل مائي', icon: '💧' },

  { slug: 'roofing', nameEn: 'Roofing', nameAr: 'أسقف وتغطيات', icon: '🏠' },
  { slug: 'firefighting', nameEn: 'Fire Fighting Systems', nameAr: 'أنظمة إطفاء حريق', icon: '🧯' },
  { slug: 'firealarm', nameEn: 'Fire Alarm Systems', nameAr: 'أنظمة إنذار حريق', icon: '🚨' },
  { slug: 'smarthome', nameEn: 'Smart Home Solutions', nameAr: 'حلول المنزل الذكي', icon: '🏡', aliases: ['Smart Home'] },
  { slug: 'solar', nameEn: 'Solar Energy Systems', nameAr: 'أنظمة طاقة شمسية', icon: '☀️', aliases: ['Solar'] },
  { slug: 'elevators', nameEn: 'Elevators', nameAr: 'مصاعد', icon: '🛗' },
  { slug: 'landscaping', nameEn: 'Landscaping Materials', nameAr: 'مواد تنسيق حدائق', icon: '🌳' },

  // THE OTHER REPORTED CASE. The canonical name is the one BuildHub already
  // used; "Pools" is registered as the alias rather than as a second record.
  { slug: 'pools', nameEn: 'Swimming Pool Equipment', nameAr: 'معدات حمامات سباحة', icon: '🏊', aliases: ['Pools'] },

  { slug: 'decorative', nameEn: 'Decorative Materials', nameAr: 'مواد ديكور', icon: '✨' },
  { slug: 'hardware', nameEn: 'Hardware & Tools', nameAr: 'عدد وأدوات', icon: '🛠️' },
  { slug: 'safety', nameEn: 'Safety Equipment', nameAr: 'معدات سلامة', icon: '🦺' },
] as const;

/**
 * THE LEGACY WRITE-PATH VALUES, kept here so a test can prove every one of them
 * still resolves. This is the list products were validated against, so any of
 * them may sit in `products.category` or in a vendor's saved spreadsheet.
 */
export const LEGACY_PRODUCT_CATEGORY_VALUES = [
  'Materials', 'Furniture', 'Lighting', 'Electrical', 'Plumbing', 'HVAC',
  'Paint', 'Ceramics', 'Granite', 'Marble', 'Wood', 'Doors', 'Windows',
  'Roofing', 'Glass', 'Steel', 'Concrete', 'Solar', 'Smart Home',
] as const;
