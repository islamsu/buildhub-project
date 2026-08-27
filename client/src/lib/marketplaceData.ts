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

export interface ProductCategory {
  id: string;
  en: string;
  ar: string;
  icon: string;
}

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  { id: 'cement', en: 'Cement & Concrete', ar: 'أسمنت وخرسانة', icon: '🏗️' },
  { id: 'steel', en: 'Steel & Reinforcement', ar: 'حديد وتسليح', icon: '⚙️' },
  { id: 'bricks', en: 'Bricks & Blocks', ar: 'طوب وبلوكات', icon: '🧱' },
  { id: 'sand', en: 'Sand & Aggregates', ar: 'رمل وركام', icon: '⛰️' },
  { id: 'paints', en: 'Paints & Coatings', ar: 'دهانات وطلاءات', icon: '🎨' },
  { id: 'ceramics', en: 'Ceramics & Porcelain', ar: 'سيراميك وبورسلين', icon: '🏺' },
  { id: 'marble', en: 'Marble & Granite', ar: 'رخام وجرانيت', icon: '🪨' },
  { id: 'flooring', en: 'Flooring', ar: 'أرضيات', icon: '🟫' },
  { id: 'doors', en: 'Doors', ar: 'أبواب', icon: '🚪' },
  { id: 'windows', en: 'Windows', ar: 'نوافذ', icon: '🪟' },
  { id: 'aluminum', en: 'Aluminum Systems', ar: 'أنظمة ألوميتال', icon: '🔩' },
  { id: 'glass', en: 'Glass', ar: 'زجاج', icon: '🔮' },
  { id: 'wood', en: 'Wood & Timber', ar: 'خشب وأخشاب', icon: '🪵' },
  { id: 'kitchens', en: 'Kitchens', ar: 'مطابخ', icon: '🍳' },
  { id: 'wardrobes', en: 'Wardrobes', ar: 'دواليب', icon: '🚪' },
  { id: 'furniture', en: 'Furniture', ar: 'أثاث', icon: '🛋️' },
  { id: 'lighting', en: 'Lighting', ar: 'إضاءة', icon: '💡' },
  { id: 'electrical', en: 'Electrical Supplies', ar: 'مستلزمات كهربائية', icon: '⚡' },
  { id: 'plumbing', en: 'Plumbing Supplies', ar: 'مستلزمات سباكة', icon: '🔧' },
  { id: 'hvac', en: 'HVAC Systems', ar: 'أنظمة تكييف وتهوية', icon: '❄️' },
  { id: 'gypsum', en: 'Gypsum & Ceilings', ar: 'جبس وأسقف', icon: '🏛️' },
  { id: 'waterproofing', en: 'Waterproofing', ar: 'عزل مائي', icon: '💧' },
  { id: 'roofing', en: 'Roofing', ar: 'أسقف وتغطيات', icon: '🏠' },
  { id: 'firefighting', en: 'Fire Fighting Systems', ar: 'أنظمة إطفاء حريق', icon: '🧯' },
  { id: 'firealarm', en: 'Fire Alarm Systems', ar: 'أنظمة إنذار حريق', icon: '🚨' },
  { id: 'smarthome', en: 'Smart Home Solutions', ar: 'حلول المنزل الذكي', icon: '🏡' },
  { id: 'solar', en: 'Solar Energy Systems', ar: 'أنظمة طاقة شمسية', icon: '☀️' },
  { id: 'elevators', en: 'Elevators', ar: 'مصاعد', icon: '🛗' },
  { id: 'landscaping', en: 'Landscaping Materials', ar: 'مواد تنسيق حدائق', icon: '🌿' },
  { id: 'pools', en: 'Swimming Pool Equipment', ar: 'معدات حمامات سباحة', icon: '🏊' },
  { id: 'decorative', en: 'Decorative Materials', ar: 'مواد ديكور', icon: '🖼️' },
  { id: 'hardware', en: 'Hardware & Tools', ar: 'عدد وأدوات', icon: '🔨' },
  { id: 'safety', en: 'Safety Equipment', ar: 'معدات سلامة', icon: '🦺' },
];







export const DESIGN_CATEGORIES: ProductCategory[] = [
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





export const FINISHING_CATEGORIES: ProductCategory[] = [
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


