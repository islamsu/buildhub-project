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
import { Search, Star, BadgeCheck, MapPin, Users, ArrowLeft, ArrowRight, HardHat, MessageSquare, FileText, Zap, ShieldCheck, Briefcase } from 'lucide-react';
import { FINISHING_COMPANIES, FINISHING_CATEGORIES, type FinishingCompany } from '@/lib/marketplaceData';

export default function FinishingDirectory() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [, navigate] = useLocation();
  const [, params] = useRoute('/marketplace/finishing/:id');
  const [search, setSearch] = useState('');
  const [svcFilter, setSvcFilter] = useState('all');
  const [sortBy, setSortBy] = useState('featured');
  const [profile, setProfile] = useState<FinishingCompany | null>(null);

  const selected: FinishingCompany | undefined = params?.id ? FINISHING_COMPANIES.find(f => f.id === Number(params.id)) : undefined;

  const filtered = useMemo(() => {
    let list = FINISHING_COMPANIES.filter(f => {
      const q = search.trim().toLowerCase();
      const matchQ = !q || f.name.toLowerCase().includes(q) || f.nameAr.includes(q) || f.services.some(s => s.toLowerCase().includes(q)) || f.servicesAr.some(s => s.includes(q));
      const cat = FINISHING_CATEGORIES.find(c => c.id === svcFilter);
      const matchSvc = svcFilter === 'all' || (cat && f.services.includes(cat.en));
      return matchQ && matchSvc;
    });
    switch (sortBy) {
      case 'rating': list = [...list].sort((a, b) => b.rating - a.rating); break;
      case 'projects': list = [...list].sort((a, b) => b.completedProjects - a.completedProjects); break;
      case 'years': list = [...list].sort((a, b) => b.yearsInBusiness - a.yearsInBusiness); break;
      default: list = [...list].sort((a, b) => Number(b.featured) - Number(a.featured) || b.rating - a.rating);
    }
    return list;
  }, [search, svcFilter, sortBy]);

  const Back = ar ? ArrowRight : ArrowLeft;

  const badges = (f: FinishingCompany) => (
    <div className="flex flex-wrap gap-1">
      {f.verified && <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs"><BadgeCheck className="w-3 h-3 me-0.5" />{ar ? 'موثق' : 'Verified'}</Badge>}
      {f.topRated && <Badge className="bg-amber-100 text-amber-700 border-0 text-xs">⭐ {ar ? 'الأعلى تقييماً' : 'Top Rated'}</Badge>}
      {f.fastResponse && <Badge className="bg-cyan-100 text-cyan-700 border-0 text-xs"><Zap className="w-3 h-3 me-0.5" />{ar ? 'استجابة سريعة' : 'Fast Response'}</Badge>}
      {f.isNew && <Badge className="bg-violet-100 text-violet-700 border-0 text-xs">✨ {ar ? 'جديد' : 'New'}</Badge>}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-16">
        <div className="bg-gradient-to-br from-orange-700 to-amber-600 text-white py-12">
          <div className="container">
            <button className="flex items-center gap-1 text-white/80 hover:text-white text-sm mb-4" onClick={() => navigate('/marketplace')}>
              <Back className="w-4 h-4" /> {ar ? 'السوق' : 'Marketplace'}
            </button>
            <h1 className="text-3xl md:text-4xl font-bold mb-2 flex items-center gap-3"><HardHat className="w-8 h-8" /> {ar ? 'شركات التشطيبات' : 'Finishing Companies'}</h1>
            <p className="text-white/80 max-w-2xl">{ar ? 'شركات متخصصة في الإنشاءات والتشطيبات والتجهيز والتجديد — من الهيكل حتى التسليم النهائي' : 'Specialists in construction, finishing, fit-out, and renovation — from core & shell to final handover'}</p>
          </div>
        </div>

        <div className="container py-8">
          <div className="flex gap-2 overflow-x-auto pb-3 mb-4">
            <Button size="sm" variant={svcFilter === 'all' ? 'default' : 'outline'} className="rounded-full flex-shrink-0" onClick={() => setSvcFilter('all')}>{ar ? 'الكل' : 'All'}</Button>
            {FINISHING_CATEGORIES.map(c => (
              <Button key={c.id} size="sm" variant={svcFilter === c.id ? 'default' : 'outline'} className="rounded-full flex-shrink-0" onClick={() => setSvcFilter(c.id)}>
                <span className="me-1">{c.icon}</span>{ar ? c.ar : c.en}
              </Button>
            ))}
          </div>

          <div className="flex flex-col md:flex-row gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="ps-9" placeholder={ar ? 'ابحث عن شركة تشطيبات…' : 'Search finishing companies…'} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full md:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="featured">{ar ? 'مميز أولاً' : 'Featured first'}</SelectItem>
                <SelectItem value="rating">{ar ? 'الأعلى تقييماً' : 'Highest rated'}</SelectItem>
                <SelectItem value="projects">{ar ? 'الأكثر مشاريع' : 'Most projects'}</SelectItem>
                <SelectItem value="years">{ar ? 'الأقدم خبرة' : 'Most experienced'}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p className="text-sm text-muted-foreground mb-4">{filtered.length} {ar ? 'شركة' : 'companies'}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {filtered.map(f => (
              <Card key={f.id} className="p-5 cursor-pointer hover:shadow-xl transition-all hover:-translate-y-0.5" onClick={() => setProfile(f)}>
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-2xl flex-shrink-0">{f.logo}</div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold truncate">{ar ? f.nameAr : f.name}</h3>
                    <p className="text-xs text-muted-foreground truncate">{(ar ? f.servicesAr : f.services).join(' · ')}</p>
                  </div>
                  <div className="flex items-center gap-1 text-sm flex-shrink-0">
                    <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                    <span className="font-semibold">{f.rating}</span>
                    <span className="text-muted-foreground text-xs">({f.reviewCount})</span>
                  </div>
                </div>
                <div className="mb-3">{badges(f)}</div>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{ar ? f.descriptionAr : f.description}</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {ar ? f.locationAr : f.location}</span>
                  <span className="flex items-center gap-1"><Briefcase className="w-3.5 h-3.5" /> {f.completedProjects}+ {ar ? 'مشروع منجز' : 'completed'}</span>
                  <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {f.teamSize} {ar ? 'فرد' : 'team'} · {f.engineers} {ar ? 'مهندس' : 'engineers'}</span>
                  <span className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> {ar ? f.warrantyAr : f.warranty}</span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={open => { if (!open) navigate('/marketplace/finishing'); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <span className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-2xl">{selected.logo}</span>
                  <span>
                    {ar ? selected.nameAr : selected.name}
                    <span className="block text-sm font-normal text-muted-foreground">{ar ? selected.locationAr : selected.location}</span>
                  </span>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1">{badges(selected)}</div>
                <p className="text-sm">{ar ? selected.descriptionAr : selected.description}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                  {[
                    { v: selected.rating, l: ar ? 'التقييم' : 'Rating' },
                    { v: `${selected.completedProjects}+`, l: ar ? 'مشاريع منجزة' : 'Completed' },
                    { v: selected.activeProjects, l: ar ? 'مشاريع جارية' : 'Active' },
                    { v: selected.yearsInBusiness, l: ar ? 'سنوات الخبرة' : 'Years' },
                  ].map((s, i) => (
                    <div key={i} className="bg-muted rounded-lg p-3">
                      <div className="text-lg font-bold">{s.v}</div>
                      <div className="text-xs text-muted-foreground">{s.l}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <h4 className="text-sm font-semibold mb-1.5">{ar ? 'الخدمات' : 'Services'}</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {(ar ? selected.servicesAr : selected.services).map(s => <Badge key={s} variant="outline">{s}</Badge>)}
                  </div>
                </div>
                <div className="text-sm space-y-2">
                  <p className="flex items-center gap-2"><MapPin className="w-4 h-4 text-muted-foreground" /> {ar ? 'مناطق الخدمة:' : 'Service areas:'} {ar ? selected.serviceAreasAr : selected.serviceAreas}</p>
                  <p className="flex items-center gap-2"><Briefcase className="w-4 h-4 text-muted-foreground" /> {ar ? 'نموذج التسعير:' : 'Pricing:'} {ar ? selected.pricingModelAr : selected.pricingModel}</p>
                  <p className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-muted-foreground" /> {ar ? 'الضمان:' : 'Warranty:'} {ar ? selected.warrantyAr : selected.warranty}</p>
                  <p className="flex items-center gap-2"><Users className="w-4 h-4 text-muted-foreground" /> {selected.teamSize} {ar ? 'فرد' : 'team members'} · {selected.engineers} {ar ? 'مهندس' : 'engineers'}</p>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button className="flex-1" onClick={() => navigate('/rfq')}><FileText className="w-4 h-4 me-1.5" /> {ar ? 'طلب عرض سعر' : 'Request Quote'}</Button>
                  <Button variant="outline" className="flex-1" onClick={() => toast.info(ar ? 'المراسلة متاحة بعد تسجيل الدخول' : 'Messaging available after sign-in')}><MessageSquare className="w-4 h-4 me-1.5" /> {ar ? 'مراسلة' : 'Message'}</Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <MarketplaceProfileSheet entity={profile ? { kind: 'finishing', data: profile } : null} onClose={() => setProfile(null)} />
    </div>
  );
}

