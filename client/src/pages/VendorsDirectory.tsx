import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/Navbar';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLocation, useRoute } from 'wouter';
import { useMemo, useState } from 'react';
import MarketplaceProfileSheet from '@/components/MarketplaceProfileSheet';
import { toast } from 'sonner';
import { Search, Star, BadgeCheck, MapPin, Clock, Truck, Award, ArrowLeft, ArrowRight, Store, MessageSquare, FileText, LayoutGrid, List } from 'lucide-react';
import { VENDORS, type Vendor } from '@/lib/marketplaceData';

export default function VendorsDirectory() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [, navigate] = useLocation();
  const [, params] = useRoute('/marketplace/vendors/:id');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [locFilter, setLocFilter] = useState('all');
  const [sortBy, setSortBy] = useState('featured');
  const [profile, setProfile] = useState<Vendor | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const selected: Vendor | undefined = params?.id ? VENDORS.find(v => v.id === Number(params.id)) : undefined;

  const categories = useMemo(() => Array.from(new Set(VENDORS.map(v => v.category))), []);
  const locations = useMemo(() => Array.from(new Set(VENDORS.map(v => v.location))), []);

  const filtered = useMemo(() => {
    let list = VENDORS.filter(v => {
      const q = search.trim().toLowerCase();
      const matchQ = !q || v.name.toLowerCase().includes(q) || v.nameAr.includes(q) || v.category.toLowerCase().includes(q) || v.categoryAr.includes(q);
      const matchCat = catFilter === 'all' || v.category === catFilter;
      const matchLoc = locFilter === 'all' || v.location === locFilter;
      return matchQ && matchCat && matchLoc;
    });
    switch (sortBy) {
      case 'rating': list = [...list].sort((a, b) => b.rating - a.rating); break;
      case 'orders': list = [...list].sort((a, b) => b.completedOrders - a.completedOrders); break;
      case 'years': list = [...list].sort((a, b) => b.yearsInBusiness - a.yearsInBusiness); break;
      default: list = [...list].sort((a, b) => Number(b.featured) - Number(a.featured) || b.rating - a.rating);
    }
    return list;
  }, [search, catFilter, locFilter, sortBy]);

  const Back = ar ? ArrowRight : ArrowLeft;

  const badges = (v: Vendor) => (
    <div className="flex flex-wrap gap-1">
      {v.verified && <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs"><BadgeCheck className="w-3 h-3 me-0.5" />{ar ? 'موثق' : 'Verified'}</Badge>}
      {v.topRated && <Badge className="bg-amber-100 text-amber-700 border-0 text-xs">⭐ {ar ? 'الأعلى تقييماً' : 'Top Rated'}</Badge>}
      {v.recommended && <Badge className="bg-blue-100 text-blue-700 border-0 text-xs">👍 {ar ? 'موصى به' : 'Recommended'}</Badge>}
      {v.isNew && <Badge className="bg-violet-100 text-violet-700 border-0 text-xs">✨ {ar ? 'جديد' : 'New'}</Badge>}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-16">
        <div className="bg-gradient-to-br from-emerald-700 to-teal-600 text-white py-12">
          <div className="container">
            <button className="flex items-center gap-1 text-white/80 hover:text-white text-sm mb-4" onClick={() => navigate('/marketplace')}>
              <Back className="w-4 h-4" /> {ar ? 'السوق' : 'Marketplace'}
            </button>
            <h1 className="text-3xl md:text-4xl font-bold mb-2 flex items-center gap-3"><Store className="w-8 h-8" /> {ar ? 'دليل الموردين' : 'Vendors Directory'}</h1>
            <p className="text-white/80 max-w-2xl">{ar ? 'موردون ومصنعون موثوقون لمواد البناء والتشطيب في جميع أنحاء مصر' : 'Trusted suppliers and manufacturers of building and finishing materials across Egypt'}</p>
          </div>
        </div>

        <div className="container py-8">
          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="ps-9" placeholder={ar ? 'ابحث عن مورد…' : 'Search vendors…'} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger className="w-full md:w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{ar ? 'كل الفئات' : 'All Categories'}</SelectItem>
                {categories.map(c => <SelectItem key={c} value={c}>{ar ? (VENDORS.find(v => v.category === c)?.categoryAr ?? c) : c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={locFilter} onValueChange={setLocFilter}>
              <SelectTrigger className="w-full md:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{ar ? 'كل المواقع' : 'All Locations'}</SelectItem>
                {locations.map(l => <SelectItem key={l} value={l}>{ar ? (VENDORS.find(v => v.location === l)?.locationAr ?? l) : l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full md:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="featured">{ar ? 'مميز أولاً' : 'Featured first'}</SelectItem>
                <SelectItem value="rating">{ar ? 'الأعلى تقييماً' : 'Highest rated'}</SelectItem>
                <SelectItem value="orders">{ar ? 'الأكثر طلبات' : 'Most orders'}</SelectItem>
                <SelectItem value="years">{ar ? 'الأقدم خبرة' : 'Most experienced'}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-1 border border-border rounded-md p-0.5">
              <Button size="icon" variant={view === 'grid' ? 'secondary' : 'ghost'} className="h-8 w-8" onClick={() => setView('grid')}><LayoutGrid className="w-4 h-4" /></Button>
              <Button size="icon" variant={view === 'list' ? 'secondary' : 'ghost'} className="h-8 w-8" onClick={() => setView('list')}><List className="w-4 h-4" /></Button>
            </div>
          </div>

          <p className="text-sm text-muted-foreground mb-4">{filtered.length} {ar ? 'مورد' : 'vendors'}</p>

          <div className={view === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5' : 'space-y-4'}>
            {filtered.map(v => (
              <Card key={v.id} className="p-5 cursor-pointer hover:shadow-xl transition-all hover:-translate-y-0.5" onClick={() => setProfile(v)}>
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-2xl flex-shrink-0">{v.logo}</div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold truncate">{ar ? v.nameAr : v.name}</h3>
                    <p className="text-xs text-muted-foreground">{ar ? v.categoryAr : v.category}</p>
                  </div>
                  <div className="flex items-center gap-1 text-sm flex-shrink-0">
                    <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                    <span className="font-semibold">{v.rating}</span>
                    <span className="text-muted-foreground text-xs">({v.reviewCount})</span>
                  </div>
                </div>
                <div className="mb-3">{badges(v)}</div>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{ar ? v.descriptionAr : v.description}</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {ar ? v.locationAr : v.location} · {v.branches} {ar ? 'فرع' : 'branches'}</span>
                  <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {ar ? 'يرد خلال' : 'Responds'} {v.responseTime}</span>
                  <span className="flex items-center gap-1"><Truck className="w-3.5 h-3.5" /> {ar ? v.deliveryCoverageAr : v.deliveryCoverage}</span>
                  <span className="flex items-center gap-1"><Award className="w-3.5 h-3.5" /> {v.completedOrders.toLocaleString()} {ar ? 'طلب' : 'orders'}</span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* Vendor profile dialog */}
      <Dialog open={!!selected} onOpenChange={open => { if (!open) navigate('/marketplace/vendors'); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <span className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-2xl">{selected.logo}</span>
                  <span>
                    {ar ? selected.nameAr : selected.name}
                    <span className="block text-sm font-normal text-muted-foreground">{ar ? selected.categoryAr : selected.category}</span>
                  </span>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1">{badges(selected)}</div>
                <p className="text-sm">{ar ? selected.descriptionAr : selected.description}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                  {[
                    { v: selected.rating, l: ar ? 'التقييم' : 'Rating' },
                    { v: selected.completedOrders.toLocaleString(), l: ar ? 'الطلبات' : 'Orders' },
                    { v: selected.yearsInBusiness, l: ar ? 'سنوات الخبرة' : 'Years' },
                    { v: selected.branches, l: ar ? 'الفروع' : 'Branches' },
                  ].map((s, i) => (
                    <div key={i} className="bg-muted rounded-lg p-3">
                      <div className="text-lg font-bold">{s.v}</div>
                      <div className="text-xs text-muted-foreground">{s.l}</div>
                    </div>
                  ))}
                </div>
                <div className="text-sm space-y-2">
                  <p className="flex items-center gap-2"><MapPin className="w-4 h-4 text-muted-foreground" /> {ar ? selected.locationAr : selected.location}</p>
                  <p className="flex items-center gap-2"><Truck className="w-4 h-4 text-muted-foreground" /> {ar ? selected.deliveryCoverageAr : selected.deliveryCoverage}</p>
                  <p className="flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground" /> {ar ? 'يرد خلال' : 'Responds within'} {selected.responseTime}</p>
                </div>
                {selected.certifications.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-1.5">{ar ? 'الشهادات' : 'Certifications'}</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {selected.certifications.map(c => <Badge key={c} variant="outline">{c}</Badge>)}
                    </div>
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <Button className="flex-1" onClick={() => navigate('/rfq')}><FileText className="w-4 h-4 me-1.5" /> {ar ? 'طلب عرض سعر' : 'Request Quote'}</Button>
                  <Button variant="outline" className="flex-1" onClick={() => toast.info(ar ? 'المراسلة متاحة بعد تسجيل الدخول' : 'Messaging available after sign-in')}><MessageSquare className="w-4 h-4 me-1.5" /> {ar ? 'مراسلة' : 'Message'}</Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <MarketplaceProfileSheet entity={profile ? { kind: 'vendor', data: profile } : null} onClose={() => setProfile(null)} />
    </div>
  );
}

