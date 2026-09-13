// Browse VOCABULARY for the Marketplace Discovery Hub - category chips only.
//
// CLOSURE PASS: this file also held VENDORS, DESIGNERS and FINISHING_COMPANIES,
// hardcoded "providers" carrying invented ratings, review counts, project
// counts, years of experience, team sizes and `verified: true` badges. Several
// named real Egyptian companies that have no BuildHub account and never agreed
// to a rating being published about them.
//
// They are gone. Every provider surface now reads marketplace.vendors, where a
// rating comes from verified reviews and a verification badge comes from the
// compliance decision. What remains here is taxonomy: labels for browsing,
// which assert nothing about anybody.

/**
 * PRODUCT_CATEGORIES USED TO LIVE HERE, AND IT WAS THE LATENT DEFECT.
 *
 * Thirty-three product browse chips that shared NO values with the nineteen the
 * write path accepted - so a shopper clicking any of them could never find a
 * product, because nothing could be listed under those names. The reported
 * "Waterproofing is not a BuildHub category" was the same disagreement seen
 * from the supplier's side.
 *
 * The product taxonomy is now a database table with one canonical name, one
 * Arabic name and one icon per category, served by marketplace.categories and
 * administered at /admin/categories. Nothing about products belongs in this
 * file any more.
 *
 * DESIGN_CATEGORIES and FINISHING_CATEGORIES below are a different vocabulary:
 * they label the two PROVIDER directories, not products, and no write path
 * validates against them. They stay until those directories get the same
 * treatment.
 */

/** The shape those two lists share. Renamed from ProductCategory, which it no longer is. */
export interface BrowseCategory {
  id: string;
  en: string;
  ar: string;
  icon: string;
}

export const DESIGN_CATEGORIES: BrowseCategory[] = [
  { id: 'architecture', en: 'Architecture', ar: 'عمارة', icon: '🏛️' },
  { id: 'interior', en: 'Interior Design', ar: 'تصميم داخلي', icon: '🛋️' },
  { id: 'landscape', en: 'Landscape Design', ar: 'تصميم لاندسكيب', icon: '🌳' },
  { id: 'kitchen', en: 'Kitchen Design', ar: 'تصميم مطابخ', icon: '🍳' },
  { id: 'bathroom', en: 'Bathroom Design', ar: 'تصميم حمامات', icon: '🛁' },
  { id: 'lightingdesign', en: 'Lighting Design', ar: 'تصميم إضاءة', icon: '💡' },
  { id: 'furnituredesign', en: 'Furniture Design', ar: 'تصميم أثاث', icon: '🪑' },
  { id: 'bim', en: 'BIM Services', ar: 'خدمات BIM', icon: '📐' },
  { id: '3dviz', en: '3D Visualization', ar: 'تصور ثلاثي الأبعاد', icon: '🖥️' },
  { id: 'vr', en: 'VR Walkthroughs', ar: 'جولات واقع افتراضي', icon: '🥽' },
  { id: 'exterior', en: 'Exterior Design', ar: 'تصميم واجهات', icon: '🏢' },
  { id: 'urban', en: 'Urban Design', ar: 'تصميم عمراني', icon: '🌆' },
  { id: 'commercialdesign', en: 'Commercial Design', ar: 'تصميم تجاري', icon: '🏬' },
  { id: 'hospitality', en: 'Hospitality Design', ar: 'تصميم ضيافة', icon: '🏨' },
];





export const FINISHING_CATEGORIES: BrowseCategory[] = [
  { id: 'turnkey', en: 'Complete Turnkey Solutions', ar: 'حلول تسليم مفتاح', icon: '🔑' },
  { id: 'coreshell', en: 'Core & Shell', ar: 'هيكل خرساني', icon: '🏗️' },
  { id: 'semifinished', en: 'Semi-Finished', ar: 'نصف تشطيب', icon: '🔨' },
  { id: 'fullyfinished', en: 'Fully Finished', ar: 'تشطيب كامل', icon: '✅' },
  { id: 'superdeluxe', en: 'Super Deluxe', ar: 'سوبر ديلوكس', icon: '⭐' },
  { id: 'luxury', en: 'Luxury Finishing', ar: 'تشطيب فاخر', icon: '💎' },
  { id: 'ultraluxury', en: 'Ultra Luxury Finishing', ar: 'تشطيب ألترا لوكس', icon: '👑' },
  { id: 'villa', en: 'Villa Construction', ar: 'بناء فلل', icon: '🏡' },
  { id: 'apartment', en: 'Apartment Finishing', ar: 'تشطيب شقق', icon: '🏢' },
  { id: 'commercialfitout', en: 'Commercial Fit-Out', ar: 'تجهيز تجاري', icon: '🏬' },
  { id: 'officefitout', en: 'Office Fit-Out', ar: 'تجهيز مكاتب', icon: '💼' },
  { id: 'hotelfitout', en: 'Hotel Fit-Out', ar: 'تجهيز فنادق', icon: '🏨' },
  { id: 'restaurantfitout', en: 'Restaurant Fit-Out', ar: 'تجهيز مطاعم', icon: '🍽️' },
  { id: 'retailfitout', en: 'Retail Fit-Out', ar: 'تجهيز محلات', icon: '🛍️' },
  { id: 'industrial', en: 'Industrial Projects', ar: 'مشروعات صناعية', icon: '🏭' },
  { id: 'maintenance', en: 'Maintenance', ar: 'صيانة', icon: '🔧' },
  { id: 'renovation', en: 'Renovation', ar: 'تجديد وترميم', icon: '🔄' },
  { id: 'smarthomeinstall', en: 'Smart Home Installation', ar: 'تركيب منزل ذكي', icon: '🏡' },
  { id: 'solarinstall', en: 'Solar Installation', ar: 'تركيب طاقة شمسية', icon: '☀️' },
  { id: 'landscapinginstall', en: 'Landscaping', ar: 'تنسيق حدائق', icon: '🌿' },
  { id: 'poolsinstall', en: 'Swimming Pools', ar: 'حمامات سباحة', icon: '🏊' },
];


