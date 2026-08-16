import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { trpc } from '@/lib/trpc';
import { useState } from 'react';
import { Search, SlidersHorizontal, Star, Package, ShoppingCart, Zap, ArrowLeft, ArrowRight, Heart, Scale, X } from 'lucide-react';
import { toast } from 'sonner';
import { useLocation } from 'wouter';
import { DEMO_PRODUCTS } from '@/lib/marketplaceCatalog';

const CATEGORY_ICONS: Record<string, string> = {
  'Materials': '🧱', 'Furniture': '🛋️', 'Lighting': '💡', 'Electrical': '⚡',
  'Plumbing': '🔧', 'HVAC': '❄️', 'Paint': '🎨', 'Ceramics': '🏺',
  'Granite': '🪨', 'Marble': '🪨', 'Wood': '🪵', 'Doors': '🚪',
  'Windows': '🪟', 'Roofing': '🏠', 'Glass': '🔮', 'Steel': '⚙️',
  'Concrete': '🏗️', 'Waterproofing': '💧', 'Solar': '☀️', 'Smart Home': '🏡',
  'Pools': '🏊', 'Landscaping': '🌿', 'Security': '🔒', 'Fire Fighting': '🔥',
  'Cleaning': '🧹', 'Maintenance': '🔨', 'Moving': '📦',
};


const CATEGORY_AR: Record<string, string> = {
  'All': 'الكل', 'Materials': 'مواد البناء', 'Furniture': 'أثاث', 'Lighting': 'إضاءة',
  'Electrical': 'كهرباء', 'Plumbing': 'سباكة', 'HVAC': 'تكييف وتهوية', 'Paint': 'دهانات',
  'Ceramics': 'سيراميك', 'Granite': 'جرانيت', 'Marble': 'رخام', 'Wood': 'خشب',
  'Doors': 'أبواب', 'Windows': 'نوافذ', 'Roofing': 'أسقف', 'Glass': 'زجاج',
  'Steel': 'حديد', 'Concrete': 'خرسانة', 'Waterproofing': 'عزل مائي', 'Solar': 'طاقة شمسية',
  'Smart Home': 'المنزل الذكي', 'Pools': 'مسابح', 'Landscaping': 'تنسيق حدائق',
  'Security': 'أمن وحماية', 'Fire Fighting': 'إطفاء حريق', 'Cleaning': 'نظافة',
  'Maintenance': 'صيانة', 'Moving': 'نقل عفش',
};

export default function Marketplace() {
  const { t, lang } = useLanguage();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sortBy, setSortBy] = useState('featured');
  const [wishlist, setWishlist] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem('bh-wishlist') || '[]'); } catch { return []; }
  });
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [showCompare, setShowCompare] = useState(false);

  const toggleWishlist = (id: number) => {
    setWishlist(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      localStorage.setItem('bh-wishlist', JSON.stringify(next));
      toast.success(prev.includes(id)
        ? (lang === 'ar' ? 'تمت الإزالة من المفضلة' : 'Removed from wishlist')
        : (lang === 'ar' ? 'تمت الإضافة إلى المفضلة' : 'Added to wishlist'));
      return next;
    });
  };
  const toggleCompare = (id: number) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 3) {
        toast.info(lang === 'ar' ? 'يمكن مقارنة 3 منتجات كحد أقصى' : 'You can compare up to 3 products');
        return prev;
      }
      return [...prev, id];
    });
  };
  const BackIcon = lang === 'ar' ? ArrowRight : ArrowLeft;

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
            <button className="flex items-center gap-1 text-primary-foreground/70 hover:text-primary-foreground text-sm mb-4 transition-colors" onClick={() => navigate('/marketplace')}>
              <BackIcon className="w-4 h-4" /> {lang === 'ar' ? 'السوق' : 'Marketplace'}
            </button>
            <h1 className="text-3xl font-bold mb-2">{t('nav.marketplace')}</h1>
            <p className="text-primary-foreground/80 mb-6">{t('market.subtitle')}</p>
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
                  <SelectItem value="featured">{t('market.featured')}</SelectItem>
                  <SelectItem value="price_asc">{t('market.sort.price_asc')}</SelectItem>
                  <SelectItem value="price_desc">{t('market.sort.price_desc')}</SelectItem>
                  <SelectItem value="rating">{t('market.sort.rating')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="container py-8">
          <div className="flex gap-8">
            {/* Sidebar Categories */}
            <aside className="hidden lg:block w-56 flex-shrink-0">
              <h3 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">{lang === 'ar' ? 'الفئات' : 'Categories'}</h3>
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
                    {lang === 'ar' ? (CATEGORY_AR[cat] ?? cat) : cat}
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
                    {lang === 'ar' ? (CATEGORY_AR[cat] ?? cat) : cat}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-muted-foreground">{filtered.length} {lang === 'ar' ? 'منتج' : 'products'}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map(product => (
                  <Card key={product.id} className="card-hover overflow-hidden group cursor-pointer" role="button" tabIndex={0} onClick={() => navigate(`/marketplace/products/${product.id}`)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') navigate(`/marketplace/products/${product.id}`); }}>
                   {/* Product Image Placeholder */}
                   <div className="h-48 bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center relative">
                      {product.images ? (
                        <img
                          src={product.images}
                          alt={lang === 'ar' && product.nameAr ? product.nameAr : product.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <Package className="w-16 h-16 text-muted-foreground/30" />
                      )}
                      {product.featured && (
                        <Badge className="absolute top-2 left-2 bg-amber-500 text-white text-xs">
                          <Zap className="w-3 h-3 mr-1" /> {lang === 'ar' ? 'مميز' : 'Featured'}
                        </Badge>
                      )}
                      <Badge variant="secondary" className="absolute top-2 right-2 text-xs">
                        {lang === 'ar' ? (CATEGORY_AR[product.category] ?? product.category) : product.category}
                      </Badge>
                      <div className="absolute bottom-2 right-2 flex gap-1.5">
                        <button
                          aria-label="wishlist"
                          onClick={e => { e.stopPropagation(); toggleWishlist(product.id); }}
                          className="h-8 w-8 rounded-full bg-white/90 shadow flex items-center justify-center hover:bg-white transition-colors"
                        >
                          <Heart className={`w-4 h-4 ${wishlist.includes(product.id) ? 'fill-rose-500 text-rose-500' : 'text-slate-500'}`} />
                        </button>
                        <button
                          aria-label="compare"
                          onClick={e => { e.stopPropagation(); toggleCompare(product.id); }}
                          className={`h-8 w-8 rounded-full shadow flex items-center justify-center transition-colors ${compareIds.includes(product.id) ? 'bg-primary text-primary-foreground' : 'bg-white/90 text-slate-500 hover:bg-white'}`}
                        >
                          <Scale className="w-4 h-4" />
                        </button>
                      </div>
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
                        <span className="text-xs text-muted-foreground ml-auto">🚚 {product.deliveryDays}{lang === 'ar' ? 'ي' : 'd'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-bold text-primary">{Number(product.price).toLocaleString()} {product.currency}</span>
                          <span className="text-xs text-muted-foreground">/{product.unit}</span>
                        </div>
                        <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={event => { event.stopPropagation(); toast.success(lang === 'ar' ? 'تمت الإضافة إلى قائمة الطلبات' : 'Added to RFQ list'); }}>
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

      {/* Compare floating bar */}
      {compareIds.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full border bg-background px-4 py-2 shadow-xl">
          <Scale className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">
            {compareIds.length} {lang === 'ar' ? 'منتج للمقارنة' : 'to compare'}
          </span>
          <Button size="sm" className="rounded-full" disabled={compareIds.length < 2} onClick={() => setShowCompare(true)}>
            {lang === 'ar' ? 'قارن الآن' : 'Compare Now'}
          </Button>
          <button aria-label="clear compare" onClick={() => setCompareIds([])} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Compare dialog */}
      <Dialog open={showCompare} onOpenChange={setShowCompare}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{lang === 'ar' ? 'مقارنة المنتجات' : 'Product Comparison'}</DialogTitle>
          </DialogHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-start text-muted-foreground font-medium">{lang === 'ar' ? 'الخاصية' : 'Attribute'}</th>
                  {compareIds.map(id => {
                    const p = DEMO_PRODUCTS.find(x => x.id === id)!;
                    return (
                      <th key={id} className="p-2 text-start">
                        <div className="w-28">
                          {p.images && <img src={p.images} alt="" className="mb-1 h-16 w-full rounded object-cover" />}
                          <div className="font-semibold leading-tight">{lang === 'ar' && p.nameAr ? p.nameAr : p.name}</div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {([
                  { key: 'price', label: lang === 'ar' ? 'السعر' : 'Price', render: (p: any) => `${p.price.toLocaleString()} ${lang === 'ar' ? 'جنيه' : 'EGP'}${p.unit ? '/' + p.unit : ''}` },
                  { key: 'rating', label: lang === 'ar' ? 'التقييم' : 'Rating', render: (p: any) => `${p.rating} ★ (${p.reviews})` },
                  { key: 'brand', label: lang === 'ar' ? 'العلامة التجارية' : 'Brand', render: (p: any) => p.brand },
                  { key: 'origin', label: lang === 'ar' ? 'بلد المنشأ' : 'Origin', render: (p: any) => p.origin },
                  { key: 'category', label: lang === 'ar' ? 'الفئة' : 'Category', render: (p: any) => lang === 'ar' ? (CATEGORY_AR[p.category] ?? p.category) : p.category },
                  { key: 'delivery', label: lang === 'ar' ? 'التوصيل' : 'Delivery', render: (p: any) => `${p.deliveryDays}${lang === 'ar' ? 'ي' : 'd'}` },
                ]).map(row => (
                  <tr key={row.key} className="border-t">
                    <td className="p-2 font-medium text-muted-foreground">{row.label}</td>
                    {compareIds.map(id => {
                      const p = DEMO_PRODUCTS.find(x => x.id === id)!;
                      return <td key={id} className="p-2">{row.render(p)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
