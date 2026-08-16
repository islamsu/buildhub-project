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

export const DEMO_PRODUCTS: MarketplaceCatalogProduct[] = [
  { id: 1, name: 'Premium Ceramic Floor Tiles', nameAr: 'بلاط سيراميك فاخر', description: 'Durable ceramic floor tiles for residential and commercial finishing.', descriptionAr: 'بلاط سيراميك متين للتشطيبات السكنية والتجارية.', category: 'Ceramics', brand: 'Cleopatra', price: '450', currency: 'EGP', unit: 'm²', rating: '4.8', reviewCount: 124, stock: 500, images: '/manus-storage/ceramic-tiles_74dab71a.jpg', origin: 'Egypt', deliveryDays: 3, warranty: '2 years', specs: 'Water-resistant, matte finish, 60×60 cm', featured: true },
  { id: 2, name: 'Italian Marble Slabs', nameAr: 'رخام إيطالي فاخر', description: 'Premium marble slabs for kitchens, bathrooms, and feature walls.', descriptionAr: 'ألواح رخام فاخرة للمطابخ والحمامات والجدران المميزة.', category: 'Marble', brand: 'Carrara', price: '2800', currency: 'EGP', unit: 'm²', rating: '4.9', reviewCount: 87, stock: 200, images: '/manus-storage/marble-slab_d4dcd0da.jpg', origin: 'Italy', deliveryDays: 14, warranty: '5 years', specs: 'Polished, natural stone, custom cutting', featured: true },
  { id: 3, name: 'Split Air Conditioner 2.25HP', nameAr: 'مكيف سبليت 2.25 حصان', description: 'Efficient split air conditioner for medium-sized rooms.', descriptionAr: 'مكيف سبليت موفر للطاقة للغرف متوسطة الحجم.', category: 'HVAC', brand: 'Carrier', price: '12500', currency: 'EGP', unit: 'unit', rating: '4.7', reviewCount: 156, stock: 40, images: '/manus-storage/hvac-unit_c5e4fb99.jpg', origin: 'USA', deliveryDays: 7, warranty: '5 years', specs: '2.25 HP, inverter, energy class A', featured: true },
  { id: 4, name: 'Solar Panel 400W', nameAr: 'لوح طاقة شمسية 400 واط', description: 'High-efficiency solar panel for residential energy systems.', descriptionAr: 'لوح شمسي عالي الكفاءة لأنظمة الطاقة المنزلية.', category: 'Solar', brand: 'SunPower', price: '3500', currency: 'EGP', unit: 'panel', rating: '4.6', reviewCount: 43, stock: 80, images: '/manus-storage/solar-panel_28c472ca.jpg', origin: 'USA', deliveryDays: 10, warranty: '10 years', specs: '400W output, monocrystalline, weather resistant', featured: true },
  { id: 5, name: 'Modular Kitchen Cabinet', nameAr: 'خزانة مطبخ مودرن', description: 'Modular cabinet set with configurable storage.', descriptionAr: 'مجموعة خزائن معيارية بمساحات تخزين قابلة للتخصيص.', category: 'Furniture', brand: 'IKEA', price: '8500', currency: 'EGP', unit: 'set', rating: '4.5', reviewCount: 201, stock: 30, images: '/manus-storage/kitchen-cabinet_84c6ca2d.jpg', origin: 'Sweden', deliveryDays: 21, warranty: '1 year', specs: 'Moisture-resistant panels, soft-close hinges', featured: false },
  { id: 6, name: 'High-Pressure Water Pump', nameAr: 'طلمبة مياه عالية الضغط', description: 'Reliable pump for homes requiring consistent water pressure.', descriptionAr: 'مضخة موثوقة للمنازل التي تحتاج ضغط مياه ثابت.', category: 'Plumbing', brand: 'Grundfos', price: '2200', currency: 'EGP', unit: 'unit', rating: '4.7', reviewCount: 38, stock: 60, images: '/manus-storage/water-pump_8d32d40a.jpg', origin: 'Denmark', deliveryDays: 5, warranty: '2 years', specs: 'Quiet motor, automatic pressure control', featured: false },
  { id: 7, name: 'Thermal Insulation Boards', nameAr: 'ألواح عزل حراري', description: 'Thermal insulation boards for walls and roofs.', descriptionAr: 'ألواح عزل حراري للجدران والأسطح.', category: 'Materials', brand: 'Rockwool', price: '180', currency: 'EGP', unit: 'm²', rating: '4.4', reviewCount: 92, stock: 1000, images: '/manus-storage/insulation-boards_3479c166.jpg', origin: 'Denmark', deliveryDays: 4, warranty: '10 years', specs: 'Fire resistant, acoustic insulation, 50mm', featured: false },
  { id: 8, name: 'Smart Home Security System', nameAr: 'نظام أمان منزلي ذكي', description: 'Connected security system with cameras and mobile alerts.', descriptionAr: 'نظام أمان متصل بكاميرات وتنبيهات للهاتف.', category: 'Security', brand: 'Hikvision', price: '4500', currency: 'EGP', unit: 'set', rating: '4.8', reviewCount: 67, stock: 45, images: '/manus-storage/security-system_5bddcf47.jpg', origin: 'China', deliveryDays: 7, warranty: '2 years', specs: '4 cameras, night vision, mobile app', featured: true },
  { id: 9, name: 'LED Ceiling Panel Light 50W', nameAr: 'لوح إضاءة LED سقفي 50 واط', description: 'Slim LED ceiling panel for bright, efficient lighting.', descriptionAr: 'لوح إضاءة LED سقفي نحيف لإضاءة موفرة ومشرقة.', category: 'Lighting', brand: 'Philips', price: '320', currency: 'EGP', unit: 'unit', rating: '4.6', reviewCount: 183, stock: 300, images: '/manus-storage/led-panel_fb7cac42.jpg', origin: 'Netherlands', deliveryDays: 3, warranty: '2 years', specs: '50W, 4000K neutral white, 120° beam', featured: true },
  { id: 10, name: 'Premium Granite Countertop Slab', nameAr: 'بلاطة جرانيت فاخرة للمطبخ', description: 'Granite countertop slab for durable kitchen surfaces.', descriptionAr: 'بلاطة جرانيت متينة لأسطح المطابخ.', category: 'Granite', brand: 'StoneWorks', price: '1800', currency: 'EGP', unit: 'm²', rating: '4.7', reviewCount: 55, stock: 150, images: '/manus-storage/granite-slab_26ca65cd.png', origin: 'Brazil', deliveryDays: 10, warranty: '5 years', specs: 'Natural stone, polished, stain resistant', featured: true },
];
