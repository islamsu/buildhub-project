import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { trpc } from '@/lib/trpc';
import { useState } from 'react';
import { Search, SlidersHorizontal, Star, Package, ShoppingCart, Zap } from 'lucide-react';
import { toast } from 'sonner';

const CATEGORY_ICONS: Record<string, string> = {
  'Materials': '🧱', 'Furniture': '🛋️', 'Lighting': '💡', 'Electrical': '⚡',
  'Plumbing': '🔧', 'HVAC': '❄️', 'Paint': '🎨', 'Ceramics': '🏺',
  'Granite': '🪨', 'Marble': '🪨', 'Wood': '🪵', 'Doors': '🚪',
  'Windows': '🪟', 'Roofing': '🏠', 'Glass': '🔮', 'Steel': '⚙️',
  'Concrete': '🏗️', 'Waterproofing': '💧', 'Solar': '☀️', 'Smart Home': '🏡',
  'Pools': '🏊', 'Landscaping': '🌿', 'Security': '🔒', 'Fire Fighting': '🔥',
  'Cleaning': '🧹', 'Maintenance': '🔨', 'Moving': '📦',
};

const DEMO_PRODUCTS = [
  { id: 1, name: 'Premium Ceramic Floor Tiles', nameAr: 'بلاط سيراميك فاخر', category: 'Ceramics', brand: 'Cleopatra', price: '450', currency: 'EGP', unit: 'm²', rating: '4.8', reviewCount: 124, stock: 500, images: null, origin: 'Egypt', deliveryDays: 3, featured: true },
  { id: 2, name: 'Italian Marble Slabs', nameAr: 'ألواح رخام إيطالي', category: 'Marble', brand: 'Carrara', price: '2800', currency: 'EGP', unit: 'm²', rating: '4.9', reviewCount: 87, stock: 200, images: null, origin: 'Italy', deliveryDays: 14, featured: true },
  { id: 3, name: 'LED Smart Lighting System', nameAr: 'نظام إضاءة LED ذكي', category: 'Smart Home', brand: 'Philips', price: '1200', currency: 'EGP', unit: 'set', rating: '4.7', reviewCount: 56, stock: 150, images: null, origin: 'Netherlands', deliveryDays: 7, featured: false },
  { id: 4, name: 'Solar Panel 400W', nameAr: 'لوح طاقة شمسية 400 واط', category: 'Solar', brand: 'SunPower', price: '3500', currency: 'EGP', unit: 'panel', rating: '4.6', reviewCount: 43, stock: 80, images: null, origin: 'USA', deliveryDays: 10, featured: true },
  { id: 5, name: 'Modular Kitchen Cabinet', nameAr: 'خزانة مطبخ مودرن', category: 'Furniture', brand: 'IKEA', price: '8500', currency: 'EGP', unit: 'set', rating: '4.5', reviewCount: 201, stock: 30, images: null, origin: 'Sweden', deliveryDays: 21, featured: false },
  { id: 6, name: 'High-Pressure Water Pump', nameAr: 'طلمبة مياه عالية الضغط', category: 'Plumbing', brand: 'Grundfos', price: '2200', currency: 'EGP', unit: 'unit', rating: '4.7', reviewCount: 38, stock: 60, images: null, origin: 'Denmark', deliveryDays: 5, featured: false },
  { id: 7, name: 'Thermal Insulation Boards', nameAr: 'ألواح عزل حراري', category: 'Materials', brand: 'Rockwool', price: '180', currency: 'EGP', unit: 'm²', rating: '4.4', reviewCount: 92, stock: 1000, images: null, origin: 'Denmark', deliveryDays: 4, featured: false },
  { id: 8, name: 'Smart Home Security System', nameAr: 'نظام أمان منزلي ذكي', category: 'Security', brand: 'Hikvision', price: '4500', currency: 'EGP', unit: 'set', rating: '4.8', reviewCount: 67, stock: 45, images: null, origin: 'China', deliveryDays: 7, featured: true },
];

export default function Marketplace() {
  const { t, lang } = useLanguage();
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sortBy, setSortBy] = useState('featured');

  const { data: categories } = trpc.marketplace.categories.useQuery();

  const allCategories = ['All', ...(categories ?? [])];

  const filtered = DEMO_PRODUCTS.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.brand.toLowerCase().includes(search.toLowerCase());
    const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
    return matchSearch && matchCat;
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-16">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary to-primary/80 text-primary-foreground py-12">
          <div className="container">
            <h1 className="text-3xl font-bold mb-2">{t('nav.marketplace')}</h1>
            <p className="text-primary-foreground/80 mb-6">Browse thousands of construction products from verified suppliers</p>
            <div className="flex gap-3 max-w-2xl">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-10 bg-white text-foreground"
                  placeholder={t('market.search')}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-40 bg-white text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="featured">Featured</SelectItem>
                  <SelectItem value="price_asc">Price: Low to High</SelectItem>
                  <SelectItem value="price_desc">Price: High to Low</SelectItem>
                  <SelectItem value="rating">Top Rated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="container py-8">
          <div className="flex gap-8">
            {/* Sidebar Categories */}
            <aside className="hidden lg:block w-56 flex-shrink-0">
              <h3 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">Categories</h3>
              <div className="space-y-1">
                {allCategories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                      selectedCategory === cat
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <span>{CATEGORY_ICONS[cat] ?? '📦'}</span>
                    {cat}
                  </button>
                ))}
              </div>
            </aside>

            {/* Product Grid */}
            <div className="flex-1 min-w-0">
              {/* Mobile category scroll */}
              <div className="flex gap-2 overflow-x-auto pb-3 mb-6 lg:hidden">
                {allCategories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      selectedCategory === cat ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-muted-foreground">{filtered.length} products</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map(product => (
                  <Card key={product.id} className="card-hover overflow-hidden group">
                    {/* Product Image Placeholder */}
                    <div className="h-48 bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center relative">
                      <Package className="w-16 h-16 text-muted-foreground/30" />
                      {product.featured && (
                        <Badge className="absolute top-2 left-2 bg-amber-500 text-white text-xs">
                          <Zap className="w-3 h-3 mr-1" /> Featured
                        </Badge>
                      )}
                      <Badge variant="secondary" className="absolute top-2 right-2 text-xs">
                        {product.category}
                      </Badge>
                    </div>
                    <CardContent className="p-4">
                      <h3 className="font-semibold text-sm mb-1 line-clamp-2">
                        {lang === 'ar' && product.nameAr ? product.nameAr : product.name}
                      </h3>
                      <p className="text-xs text-muted-foreground mb-2">{product.brand} · {product.origin}</p>
                      <div className="flex items-center gap-1 mb-3">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        <span className="text-xs font-medium">{product.rating}</span>
                        <span className="text-xs text-muted-foreground">({product.reviewCount})</span>
                        <span className="text-xs text-muted-foreground ml-auto">🚚 {product.deliveryDays}d</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-bold text-primary">{Number(product.price).toLocaleString()} {product.currency}</span>
                          <span className="text-xs text-muted-foreground">/{product.unit}</span>
                        </div>
                        <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => toast.success('Added to RFQ list')}>
                          <ShoppingCart className="w-3.5 h-3.5" /> {t('market.add_to_rfq')}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
