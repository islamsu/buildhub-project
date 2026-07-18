// Shared demo data for the BuildHub Marketplace Discovery Hub.
// All entries are demonstration placeholders, replaceable by real platform users.

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

export interface Vendor {
  id: number;
  name: string;
  nameAr: string;
  logo: string; // emoji or initial fallback
  category: string;
  categoryAr: string;
  rating: number;
  reviewCount: number;
  completedOrders: number;
  yearsInBusiness: number;
  verified: boolean;
  featured: boolean;
  topRated: boolean;
  recommended: boolean;
  isNew: boolean;
  location: string;
  locationAr: string;
  branches: number;
  responseTime: string; // e.g. "< 1h"
  description: string;
  descriptionAr: string;
  certifications: string[];
  deliveryCoverage: string;
  deliveryCoverageAr: string;
}

export const VENDORS: Vendor[] = [
  { id: 1, name: 'Ezz Steel', nameAr: 'حديد عز', logo: '🏭', category: 'Steel & Reinforcement', categoryAr: 'حديد وتسليح', rating: 4.9, reviewCount: 512, completedOrders: 12800, yearsInBusiness: 30, verified: true, featured: true, topRated: true, recommended: true, isNew: false, location: 'Cairo', locationAr: 'القاهرة', branches: 14, responseTime: '< 1h', description: 'Egypt\'s largest steel producer, supplying rebar and flat steel to mega projects nationwide.', descriptionAr: 'أكبر منتج للصلب في مصر، يورد حديد التسليح والصلب المسطح للمشروعات الكبرى في جميع أنحاء البلاد.', certifications: ['ISO 9001', 'ISO 14001', 'CARES'], deliveryCoverage: 'All Egypt', deliveryCoverageAr: 'جميع أنحاء مصر' },
  { id: 2, name: 'Elsewedy Electric', nameAr: 'السويدي إليكتريك', logo: '⚡', category: 'Electrical Supplies', categoryAr: 'مستلزمات كهربائية', rating: 4.8, reviewCount: 448, completedOrders: 9600, yearsInBusiness: 85, verified: true, featured: true, topRated: true, recommended: true, isNew: false, location: 'Cairo', locationAr: 'القاهرة', branches: 20, responseTime: '< 2h', description: 'Global provider of cables, transformers, and integrated energy solutions.', descriptionAr: 'مزود عالمي للكابلات والمحولات وحلول الطاقة المتكاملة.', certifications: ['ISO 9001', 'IEC', 'UL'], deliveryCoverage: 'All Egypt + MENA', deliveryCoverageAr: 'مصر والشرق الأوسط' },
  { id: 3, name: 'Ceramica Cleopatra', nameAr: 'سيراميكا كليوباترا', logo: '🏺', category: 'Ceramics & Porcelain', categoryAr: 'سيراميك وبورسلين', rating: 4.7, reviewCount: 620, completedOrders: 25400, yearsInBusiness: 40, verified: true, featured: true, topRated: false, recommended: true, isNew: false, location: 'Suez', locationAr: 'السويس', branches: 35, responseTime: '< 3h', description: 'Leading ceramic and porcelain tile manufacturer in the Middle East.', descriptionAr: 'الشركة الرائدة في تصنيع السيراميك والبورسلين في الشرق الأوسط.', certifications: ['ISO 9001', 'CE'], deliveryCoverage: 'All Egypt', deliveryCoverageAr: 'جميع أنحاء مصر' },
  { id: 4, name: 'Jotun Egypt', nameAr: 'جوتن مصر', logo: '🎨', category: 'Paints & Coatings', categoryAr: 'دهانات وطلاءات', rating: 4.8, reviewCount: 305, completedOrders: 7800, yearsInBusiness: 25, verified: true, featured: false, topRated: true, recommended: true, isNew: false, location: '6th of October', locationAr: 'السادس من أكتوبر', branches: 12, responseTime: '< 2h', description: 'Premium decorative paints and high-performance protective coatings.', descriptionAr: 'دهانات ديكورية فاخرة وطلاءات حماية عالية الأداء.', certifications: ['ISO 9001', 'Green Building'], deliveryCoverage: 'Greater Cairo + Alex', deliveryCoverageAr: 'القاهرة الكبرى والإسكندرية' },
  { id: 5, name: 'Sipes Egypt', nameAr: 'سايبس مصر', logo: '🖌️', category: 'Paints & Coatings', categoryAr: 'دهانات وطلاءات', rating: 4.6, reviewCount: 214, completedOrders: 5400, yearsInBusiness: 42, verified: true, featured: false, topRated: false, recommended: false, isNew: false, location: 'Alexandria', locationAr: 'الإسكندرية', branches: 9, responseTime: '< 4h', description: 'Trusted Egyptian paints brand for decorative and industrial applications.', descriptionAr: 'علامة دهانات مصرية موثوقة للتطبيقات الديكورية والصناعية.', certifications: ['ISO 9001'], deliveryCoverage: 'All Egypt', deliveryCoverageAr: 'جميع أنحاء مصر' },
  { id: 6, name: 'GLC Paints', nameAr: 'دهانات جي إل سي', logo: '🪣', category: 'Paints & Coatings', categoryAr: 'دهانات وطلاءات', rating: 4.5, reviewCount: 189, completedOrders: 4200, yearsInBusiness: 60, verified: true, featured: false, topRated: false, recommended: false, isNew: false, location: 'Cairo', locationAr: 'القاهرة', branches: 8, responseTime: '< 5h', description: 'Heritage Egyptian paint manufacturer with a wide decorative range.', descriptionAr: 'شركة دهانات مصرية عريقة بمجموعة ديكورية واسعة.', certifications: ['ISO 9001'], deliveryCoverage: 'All Egypt', deliveryCoverageAr: 'جميع أنحاء مصر' },
  { id: 7, name: 'Misr Marble', nameAr: 'رخام مصر', logo: '🪨', category: 'Marble & Granite', categoryAr: 'رخام وجرانيت', rating: 4.7, reviewCount: 156, completedOrders: 3600, yearsInBusiness: 22, verified: true, featured: false, topRated: true, recommended: false, isNew: false, location: 'Shaq El Thoaban', locationAr: 'شق الثعبان', branches: 4, responseTime: '< 3h', description: 'Premium Egyptian marble and granite quarries and processing.', descriptionAr: 'محاجر ومصانع رخام وجرانيت مصري فاخر.', certifications: ['ISO 9001'], deliveryCoverage: 'All Egypt + Export', deliveryCoverageAr: 'مصر والتصدير' },
  { id: 8, name: 'Royal Ceramica', nameAr: 'رويال سيراميكا', logo: '✨', category: 'Ceramics & Porcelain', categoryAr: 'سيراميك وبورسلين', rating: 4.4, reviewCount: 240, completedOrders: 8900, yearsInBusiness: 18, verified: true, featured: false, topRated: false, recommended: false, isNew: false, location: '10th of Ramadan', locationAr: 'العاشر من رمضان', branches: 16, responseTime: '< 6h', description: 'Quality ceramic tiles with modern designs at competitive prices.', descriptionAr: 'بلاط سيراميك عالي الجودة بتصميمات عصرية وأسعار تنافسية.', certifications: ['ISO 9001'], deliveryCoverage: 'All Egypt', deliveryCoverageAr: 'جميع أنحاء مصر' },
  { id: 9, name: 'Kiriazi', nameAr: 'كريازي', logo: '🔌', category: 'Home Appliances', categoryAr: 'أجهزة منزلية', rating: 4.6, reviewCount: 890, completedOrders: 32000, yearsInBusiness: 45, verified: true, featured: true, topRated: false, recommended: true, isNew: false, location: 'Cairo', locationAr: 'القاهرة', branches: 42, responseTime: '< 2h', description: 'Leading Egyptian home appliances manufacturer.', descriptionAr: 'الشركة المصرية الرائدة في تصنيع الأجهزة المنزلية.', certifications: ['ISO 9001', 'CE'], deliveryCoverage: 'All Egypt', deliveryCoverageAr: 'جميع أنحاء مصر' },
  { id: 10, name: 'Fresh Electric', nameAr: 'فريش إليكتريك', logo: '🌀', category: 'Home Appliances', categoryAr: 'أجهزة منزلية', rating: 4.3, reviewCount: 410, completedOrders: 18700, yearsInBusiness: 35, verified: true, featured: false, topRated: false, recommended: false, isNew: false, location: '10th of Ramadan', locationAr: 'العاشر من رمضان', branches: 28, responseTime: '< 4h', description: 'Affordable and reliable home appliances made in Egypt.', descriptionAr: 'أجهزة منزلية موثوقة وبأسعار مناسبة صنع في مصر.', certifications: ['ISO 9001'], deliveryCoverage: 'All Egypt', deliveryCoverageAr: 'جميع أنحاء مصر' },
  { id: 11, name: 'Unionaire', nameAr: 'يونيون إير', logo: '❄️', category: 'HVAC Systems', categoryAr: 'أنظمة تكييف وتهوية', rating: 4.5, reviewCount: 325, completedOrders: 14500, yearsInBusiness: 28, verified: true, featured: false, topRated: false, recommended: true, isNew: false, location: 'Cairo', locationAr: 'القاهرة', branches: 22, responseTime: '< 3h', description: 'Egyptian air conditioning and home appliances manufacturer.', descriptionAr: 'شركة مصرية لتصنيع أجهزة التكييف والأجهزة المنزلية.', certifications: ['ISO 9001', 'CE'], deliveryCoverage: 'All Egypt', deliveryCoverageAr: 'جميع أنحاء مصر' },
  { id: 12, name: 'Hassan Allam Trading', nameAr: 'حسن علام للتجارة', logo: '🏢', category: 'Building Materials', categoryAr: 'مواد بناء', rating: 4.7, reviewCount: 178, completedOrders: 5200, yearsInBusiness: 15, verified: true, featured: false, topRated: true, recommended: false, isNew: false, location: 'New Cairo', locationAr: 'القاهرة الجديدة', branches: 6, responseTime: '< 2h', description: 'Integrated building materials trading arm of Hassan Allam Holding.', descriptionAr: 'ذراع تجارة مواد البناء المتكاملة لمجموعة حسن علام.', certifications: ['ISO 9001'], deliveryCoverage: 'Greater Cairo', deliveryCoverageAr: 'القاهرة الكبرى' },
  { id: 13, name: 'Almonairy Building Materials', nameAr: 'المنيري لمواد البناء', logo: '🧱', category: 'Building Materials', categoryAr: 'مواد بناء', rating: 4.2, reviewCount: 96, completedOrders: 2800, yearsInBusiness: 12, verified: false, featured: false, topRated: false, recommended: false, isNew: true, location: 'Giza', locationAr: 'الجيزة', branches: 3, responseTime: '< 8h', description: 'Cement, bricks, sand and aggregates supplier for Greater Cairo.', descriptionAr: 'مورد أسمنت وطوب ورمل وركام للقاهرة الكبرى.', certifications: [], deliveryCoverage: 'Giza + 6th October', deliveryCoverageAr: 'الجيزة وأكتوبر' },
  { id: 14, name: 'El Safa Marble & Granite', nameAr: 'الصفا للرخام والجرانيت', logo: '💎', category: 'Marble & Granite', categoryAr: 'رخام وجرانيت', rating: 4.4, reviewCount: 68, completedOrders: 1900, yearsInBusiness: 9, verified: false, featured: false, topRated: false, recommended: false, isNew: true, location: 'Shaq El Thoaban', locationAr: 'شق الثعبان', branches: 2, responseTime: '< 6h', description: 'Specialized marble and granite cutting, finishing and installation.', descriptionAr: 'متخصصون في قص وتشطيب وتركيب الرخام والجرانيت.', certifications: [], deliveryCoverage: 'Greater Cairo', deliveryCoverageAr: 'القاهرة الكبرى' },
];

export interface Designer {
  id: number;
  name: string;
  nameAr: string;
  logo: string;
  specialties: string[];
  specialtiesAr: string[];
  rating: number;
  reviewCount: number;
  projectCount: number;
  yearsExperience: number;
  verified: boolean;
  featured: boolean;
  awardWinning: boolean;
  trending: boolean;
  recommended: boolean;
  location: string;
  locationAr: string;
  teamSize: number;
  description: string;
  descriptionAr: string;
  styles: string[];
  stylesAr: string[];
}

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

export const DESIGNERS: Designer[] = [
  { id: 1, name: 'Alchemy Design Studio', nameAr: 'استوديو الكيمياء للتصميم', logo: '✨', specialties: ['Interior Design', 'Hospitality Design'], specialtiesAr: ['تصميم داخلي', 'تصميم ضيافة'], rating: 4.9, reviewCount: 87, projectCount: 240, yearsExperience: 15, verified: true, featured: true, awardWinning: true, trending: true, recommended: true, location: 'Zamalek, Cairo', locationAr: 'الزمالك، القاهرة', teamSize: 35, description: 'Award-winning interior architecture studio behind Egypt\'s finest restaurants and hotels.', descriptionAr: 'استوديو حائز على جوائز في العمارة الداخلية وراء أرقى مطاعم وفنادق مصر.', styles: ['Contemporary', 'Luxury', 'Eclectic'], stylesAr: ['معاصر', 'فاخر', 'انتقائي'] },
  { id: 2, name: 'Studio Meraki', nameAr: 'استوديو ميراكي', logo: '🎨', specialties: ['Interior Design', 'Furniture Design'], specialtiesAr: ['تصميم داخلي', 'تصميم أثاث'], rating: 4.8, reviewCount: 64, projectCount: 180, yearsExperience: 10, verified: true, featured: true, awardWinning: false, trending: true, recommended: true, location: 'New Cairo', locationAr: 'القاهرة الجديدة', teamSize: 18, description: 'Residential interior design with warm modern aesthetics and custom furniture.', descriptionAr: 'تصميم داخلي سكني بجماليات عصرية دافئة وأثاث مخصص.', styles: ['Modern', 'Scandinavian', 'Minimalist'], stylesAr: ['حديث', 'إسكندنافي', 'بسيط'] },
  { id: 3, name: 'Raef Fahmi Architects', nameAr: 'رائف فهمي معماريون', logo: '🏛️', specialties: ['Architecture', 'Urban Design'], specialtiesAr: ['عمارة', 'تصميم عمراني'], rating: 4.9, reviewCount: 52, projectCount: 320, yearsExperience: 28, verified: true, featured: true, awardWinning: true, trending: false, recommended: true, location: 'Heliopolis, Cairo', locationAr: 'مصر الجديدة، القاهرة', teamSize: 60, description: 'Iconic Egyptian architecture firm known for cultural and residential landmarks.', descriptionAr: 'مكتب عمارة مصري أيقوني معروف بالمعالم الثقافية والسكنية.', styles: ['Contemporary', 'Cultural', 'Sustainable'], stylesAr: ['معاصر', 'ثقافي', 'مستدام'] },
  { id: 4, name: 'EKLEGO Design', nameAr: 'إكليجو للتصميم', logo: '🖼️', specialties: ['Interior Design', 'Commercial Design'], specialtiesAr: ['تصميم داخلي', 'تصميم تجاري'], rating: 4.7, reviewCount: 45, projectCount: 150, yearsExperience: 20, verified: true, featured: false, awardWinning: true, trending: false, recommended: false, location: 'Maadi, Cairo', locationAr: 'المعادي، القاهرة', teamSize: 25, description: 'Multidisciplinary design house for offices, retail, and high-end homes.', descriptionAr: 'دار تصميم متعددة التخصصات للمكاتب والمتاجر والمنازل الراقية.', styles: ['Industrial', 'Contemporary', 'Luxury'], stylesAr: ['صناعي', 'معاصر', 'فاخر'] },
  { id: 5, name: 'GreenScape Egypt', nameAr: 'جرين سكيب مصر', logo: '🌿', specialties: ['Landscape Design'], specialtiesAr: ['تصميم لاندسكيب'], rating: 4.6, reviewCount: 38, projectCount: 95, yearsExperience: 12, verified: true, featured: false, awardWinning: false, trending: true, recommended: false, location: 'Sheikh Zayed', locationAr: 'الشيخ زايد', teamSize: 15, description: 'Landscape architecture for villas, compounds, and resorts.', descriptionAr: 'عمارة لاندسكيب للفلل والكمبوندات والمنتجعات.', styles: ['Tropical', 'Desert', 'Mediterranean'], stylesAr: ['استوائي', 'صحراوي', 'متوسطي'] },
  { id: 6, name: 'PixelArch Visualization', nameAr: 'بيكسل أرك للتصور', logo: '🖥️', specialties: ['3D Visualization', 'VR Walkthroughs', 'BIM Services'], specialtiesAr: ['تصور ثلاثي الأبعاد', 'جولات واقع افتراضي', 'خدمات BIM'], rating: 4.8, reviewCount: 71, projectCount: 410, yearsExperience: 8, verified: true, featured: false, awardWinning: false, trending: true, recommended: true, location: 'Nasr City, Cairo', locationAr: 'مدينة نصر، القاهرة', teamSize: 12, description: 'Photorealistic 3D renders, BIM modeling, and immersive VR walkthroughs.', descriptionAr: 'عروض ثلاثية الأبعاد واقعية ونمذجة BIM وجولات واقع افتراضي غامرة.', styles: ['Photorealistic', 'Technical'], stylesAr: ['واقعي', 'تقني'] },
  { id: 7, name: 'Nour Lighting Studio', nameAr: 'استوديو نور للإضاءة', logo: '💡', specialties: ['Lighting Design'], specialtiesAr: ['تصميم إضاءة'], rating: 4.5, reviewCount: 29, projectCount: 88, yearsExperience: 9, verified: false, featured: false, awardWinning: false, trending: false, recommended: false, location: 'Downtown Cairo', locationAr: 'وسط البلد، القاهرة', teamSize: 8, description: 'Architectural and decorative lighting concepts for homes and hospitality.', descriptionAr: 'مفاهيم إضاءة معمارية وديكورية للمنازل والضيافة.', styles: ['Ambient', 'Dramatic', 'Minimal'], stylesAr: ['محيطي', 'درامي', 'بسيط'] },
  { id: 8, name: 'Kitchen Lab', nameAr: 'كيتشن لاب', logo: '🍳', specialties: ['Kitchen Design', 'Bathroom Design'], specialtiesAr: ['تصميم مطابخ', 'تصميم حمامات'], rating: 4.7, reviewCount: 56, projectCount: 230, yearsExperience: 11, verified: true, featured: false, awardWinning: false, trending: false, recommended: true, location: 'New Cairo', locationAr: 'القاهرة الجديدة', teamSize: 14, description: 'German-standard kitchen and bathroom design with smart storage solutions.', descriptionAr: 'تصميم مطابخ وحمامات بمعايير ألمانية مع حلول تخزين ذكية.', styles: ['Modern', 'German', 'Smart'], stylesAr: ['حديث', 'ألماني', 'ذكي'] },
];

export interface FinishingCompany {
  id: number;
  name: string;
  nameAr: string;
  logo: string;
  services: string[];
  servicesAr: string[];
  rating: number;
  reviewCount: number;
  completedProjects: number;
  activeProjects: number;
  yearsInBusiness: number;
  teamSize: number;
  engineers: number;
  verified: boolean;
  featured: boolean;
  topRated: boolean;
  fastResponse: boolean;
  isNew: boolean;
  location: string;
  locationAr: string;
  serviceAreas: string;
  serviceAreasAr: string;
  pricingModel: string;
  pricingModelAr: string;
  warranty: string;
  warrantyAr: string;
  description: string;
  descriptionAr: string;
}

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

export const FINISHING_COMPANIES: FinishingCompany[] = [
  { id: 1, name: 'Artline Finishing', nameAr: 'أرت لاين للتشطيبات', logo: '🎯', services: ['Complete Turnkey Solutions', 'Luxury Finishing', 'Apartment Finishing'], servicesAr: ['حلول تسليم مفتاح', 'تشطيب فاخر', 'تشطيب شقق'], rating: 4.9, reviewCount: 142, completedProjects: 480, activeProjects: 22, yearsInBusiness: 16, teamSize: 220, engineers: 28, verified: true, featured: true, topRated: true, fastResponse: true, isNew: false, location: 'New Cairo', locationAr: 'القاهرة الجديدة', serviceAreas: 'Greater Cairo, North Coast', serviceAreasAr: 'القاهرة الكبرى، الساحل الشمالي', pricingModel: 'Per m² / Package', pricingModelAr: 'بالمتر / باقات', warranty: '5 years structural, 2 years finishes', warrantyAr: '٥ سنوات إنشائي، سنتان تشطيبات', description: 'Turnkey finishing contractor for luxury apartments, villas, and penthouses.', descriptionAr: 'مقاول تشطيبات تسليم مفتاح للشقق الفاخرة والفلل والبنتهاوس.' },
  { id: 2, name: 'BuildRight Contracting', nameAr: 'بيلد رايت للمقاولات', logo: '🏗️', services: ['Villa Construction', 'Core & Shell', 'Fully Finished'], servicesAr: ['بناء فلل', 'هيكل خرساني', 'تشطيب كامل'], rating: 4.8, reviewCount: 98, completedProjects: 260, activeProjects: 15, yearsInBusiness: 21, teamSize: 340, engineers: 45, verified: true, featured: true, topRated: true, fastResponse: false, isNew: false, location: 'Sheikh Zayed', locationAr: 'الشيخ زايد', serviceAreas: 'All Egypt', serviceAreasAr: 'جميع أنحاء مصر', pricingModel: 'BOQ-based / Lump sum', pricingModelAr: 'حسب المقايسة / إجمالي', warranty: '10 years structural', warrantyAr: '١٠ سنوات إنشائي', description: 'Full-cycle villa construction from foundation to handover.', descriptionAr: 'بناء فلل متكامل من الأساسات حتى التسليم.', },
  { id: 3, name: 'Deco Masters', nameAr: 'ديكو ماسترز', logo: '🖌️', services: ['Super Deluxe', 'Ultra Luxury Finishing', 'Hotel Fit-Out'], servicesAr: ['سوبر ديلوكس', 'تشطيب ألترا لوكس', 'تجهيز فنادق'], rating: 4.7, reviewCount: 76, completedProjects: 190, activeProjects: 9, yearsInBusiness: 13, teamSize: 150, engineers: 18, verified: true, featured: true, topRated: false, fastResponse: true, isNew: false, location: 'Zamalek, Cairo', locationAr: 'الزمالك، القاهرة', serviceAreas: 'Cairo, Red Sea Resorts', serviceAreasAr: 'القاهرة، منتجعات البحر الأحمر', pricingModel: 'Design & Build packages', pricingModelAr: 'باقات تصميم وتنفيذ', warranty: '3 years finishes', warrantyAr: '٣ سنوات تشطيبات', description: 'Ultra-luxury finishing and hospitality fit-out specialists.', descriptionAr: 'متخصصون في التشطيبات فائقة الفخامة وتجهيز الضيافة.' },
  { id: 4, name: 'OfficeWorks Egypt', nameAr: 'أوفيس ووركس مصر', logo: '💼', services: ['Office Fit-Out', 'Commercial Fit-Out', 'Retail Fit-Out'], servicesAr: ['تجهيز مكاتب', 'تجهيز تجاري', 'تجهيز محلات'], rating: 4.6, reviewCount: 64, completedProjects: 310, activeProjects: 12, yearsInBusiness: 11, teamSize: 95, engineers: 14, verified: true, featured: false, topRated: false, fastResponse: true, isNew: false, location: 'Smart Village', locationAr: 'القرية الذكية', serviceAreas: 'Greater Cairo, Alexandria', serviceAreasAr: 'القاهرة الكبرى، الإسكندرية', pricingModel: 'Per m² / Milestone billing', pricingModelAr: 'بالمتر / فوترة بالمراحل', warranty: '2 years workmanship', warrantyAr: 'سنتان على التنفيذ', description: 'Corporate office and retail fit-out with fast-track delivery.', descriptionAr: 'تجهيز مكاتب الشركات والمحلات بتسليم سريع.' },
  { id: 5, name: 'RenovaPro', nameAr: 'رينوفا برو', logo: '🔄', services: ['Renovation', 'Maintenance', 'Apartment Finishing'], servicesAr: ['تجديد وترميم', 'صيانة', 'تشطيب شقق'], rating: 4.5, reviewCount: 118, completedProjects: 540, activeProjects: 30, yearsInBusiness: 8, teamSize: 80, engineers: 10, verified: true, featured: false, topRated: false, fastResponse: true, isNew: false, location: 'Maadi, Cairo', locationAr: 'المعادي، القاهرة', serviceAreas: 'Greater Cairo', serviceAreasAr: 'القاهرة الكبرى', pricingModel: 'Fixed quotes per scope', pricingModelAr: 'عروض ثابتة حسب النطاق', warranty: '1 year workmanship', warrantyAr: 'سنة على التنفيذ', description: 'Fast, reliable apartment renovation and maintenance services.', descriptionAr: 'خدمات تجديد وصيانة شقق سريعة وموثوقة.' },
  { id: 6, name: 'SmartSpace Integration', nameAr: 'سمارت سبيس للتكامل', logo: '🏡', services: ['Smart Home Installation', 'Solar Installation'], servicesAr: ['تركيب منزل ذكي', 'تركيب طاقة شمسية'], rating: 4.8, reviewCount: 47, completedProjects: 160, activeProjects: 11, yearsInBusiness: 6, teamSize: 35, engineers: 12, verified: true, featured: false, topRated: true, fastResponse: true, isNew: true, location: 'New Cairo', locationAr: 'القاهرة الجديدة', serviceAreas: 'Cairo, North Coast, Gouna', serviceAreasAr: 'القاهرة، الساحل، الجونة', pricingModel: 'System packages', pricingModelAr: 'باقات أنظمة', warranty: '5 years systems', warrantyAr: '٥ سنوات على الأنظمة', description: 'KNX smart home systems and grid-tied solar installations.', descriptionAr: 'أنظمة منزل ذكي KNX وتركيبات طاقة شمسية متصلة بالشبكة.' },
  { id: 7, name: 'AquaBuild Pools', nameAr: 'أكوا بيلد للمسابح', logo: '🏊', services: ['Swimming Pools', 'Landscaping'], servicesAr: ['حمامات سباحة', 'تنسيق حدائق'], rating: 4.4, reviewCount: 33, completedProjects: 120, activeProjects: 7, yearsInBusiness: 10, teamSize: 45, engineers: 6, verified: false, featured: false, topRated: false, fastResponse: false, isNew: false, location: '6th of October', locationAr: 'السادس من أكتوبر', serviceAreas: 'Compounds, North Coast', serviceAreasAr: 'الكمبوندات، الساحل الشمالي', pricingModel: 'Per project', pricingModelAr: 'بالمشروع', warranty: '3 years waterproofing', warrantyAr: '٣ سنوات عزل', description: 'Custom swimming pool construction with landscape integration.', descriptionAr: 'إنشاء حمامات سباحة مخصصة مع تكامل اللاندسكيب.' },
  { id: 8, name: 'Industrial Solutions Co', nameAr: 'شركة الحلول الصناعية', logo: '🏭', services: ['Industrial Projects', 'Core & Shell'], servicesAr: ['مشروعات صناعية', 'هيكل خرساني'], rating: 4.6, reviewCount: 21, completedProjects: 85, activeProjects: 5, yearsInBusiness: 18, teamSize: 260, engineers: 38, verified: true, featured: false, topRated: false, fastResponse: false, isNew: false, location: '10th of Ramadan', locationAr: 'العاشر من رمضان', serviceAreas: 'Industrial zones nationwide', serviceAreasAr: 'المناطق الصناعية بجميع المحافظات', pricingModel: 'BOQ-based', pricingModelAr: 'حسب المقايسة', warranty: '10 years structural', warrantyAr: '١٠ سنوات إنشائي', description: 'Factories, warehouses, and industrial facility construction.', descriptionAr: 'إنشاء مصانع ومخازن ومنشآت صناعية.' },
];
