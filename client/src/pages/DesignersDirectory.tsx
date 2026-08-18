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
import { Search, Star, BadgeCheck, MapPin, Users, ArrowLeft, ArrowRight, PenTool, MessageSquare, FileText, Trophy, Flame } from 'lucide-react';
import { DESIGNERS, DESIGN_CATEGORIES, type Designer } from '@/lib/marketplaceData';

export default function DesignersDirectory() {
  const { lang, t } = useLanguage();
  const ar = lang === 'ar';
  const [, navigate] = useLocation();
  const [, params] = useRoute('/marketplace/designers/:id');
  const [search, setSearch] = useState('');
  const [specFilter, setSpecFilter] = useState('all');
  const [sortBy, setSortBy] = useState('featured');
  const [profile, setProfile] = useState<Designer | null>(null);

  const selected: Designer | undefined = params?.id ? DESIGNERS.find(d => d.id === Number(params.id)) : undefined;

  const filtered = useMemo(() => {
    let list = DESIGNERS.filter(d => {
      const q = search.trim().toLowerCase();
      const matchQ = !q || d.name.toLowerCase().includes(q) || d.nameAr.includes(q) || d.specialties.some(s => s.toLowerCase().includes(q)) || d.specialtiesAr.some(s => s.includes(q));
      const cat = DESIGN_CATEGORIES.find(c => c.id === specFilter);
      const matchSpec = specFilter === 'all' || (cat && d.specialties.includes(cat.en));
      return matchQ && matchSpec;
    });
    switch (sortBy) {
      case 'rating': list = [...list].sort((a, b) => b.rating - a.rating); break;
      case 'projects': list = [...list].sort((a, b) => b.projectCount - a.projectCount); break;
      case 'experience': list = [...list].sort((a, b) => b.yearsExperience - a.yearsExperience); break;
      default: list = [...list].sort((a, b) => Number(b.featured) - Number(a.featured) || b.rating - a.rating);
    }
    return list;
  }, [search, specFilter, sortBy]);

  const Back = ar ? ArrowRight : ArrowLeft;

  const badges = (d: Designer) => (
    <div className="flex flex-wrap gap-1">
      {d.verified && <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs"><BadgeCheck className="w-3 h-3 me-0.5" />{t('common.verified')}</Badge>}
      {d.awardWinning && <Badge className="bg-amber-100 text-amber-700 border-0 text-xs"><Trophy className="w-3 h-3 me-0.5" />{t('designersDir.badgeAwardWinning')}</Badge>}
      {d.trending && <Badge className="bg-rose-100 text-rose-700 border-0 text-xs"><Flame className="w-3 h-3 me-0.5" />{t('designersDir.badgeTrending')}</Badge>}
      {d.recommended && <Badge className="bg-blue-100 text-blue-700 border-0 text-xs">👍 {t('designersDir.badgeRecommended')}</Badge>}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-16">
        <div className="bg-gradient-to-br from-violet-700 to-purple-600 text-white py-12">
          <div className="container">
            <button className="flex items-center gap-1 text-white/80 hover:text-white text-sm mb-4" onClick={() => navigate('/marketplace')}>
              <Back className="w-4 h-4" /> {t('common.back_to_marketplace')}
            </button>
            <h1 className="text-3xl md:text-4xl font-bold mb-2 flex items-center gap-3"><PenTool className="w-8 h-8" /> {t('designersDir.title')}</h1>
            <p className="text-white/80 max-w-2xl">{t('designersDir.subtitle')}</p>
          </div>
        </div>

        <div className="container py-8">
          {/* Specialty chips */}
          <div className="flex gap-2 overflow-x-auto pb-3 mb-4">
            <Button size="sm" variant={specFilter === 'all' ? 'default' : 'outline'} className="rounded-full flex-shrink-0" onClick={() => setSpecFilter('all')}>{t('designersDir.specialtyAll')}</Button>
            {DESIGN_CATEGORIES.map(c => (
              <Button key={c.id} size="sm" variant={specFilter === c.id ? 'default' : 'outline'} className="rounded-full flex-shrink-0" onClick={() => setSpecFilter(c.id)}>
                <span className="me-1">{c.icon}</span>{ar ? c.ar : c.en}
              </Button>
            ))}
          </div>

          <div className="flex flex-col md:flex-row gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="ps-9" placeholder={t('designersDir.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full md:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="featured">{t('designersDir.sortFeatured')}</SelectItem>
                <SelectItem value="rating">{t('designersDir.sortRating')}</SelectItem>
                <SelectItem value="projects">{t('designersDir.sortProjects')}</SelectItem>
                <SelectItem value="experience">{t('designersDir.sortExperience')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p className="text-sm text-muted-foreground mb-4">{filtered.length} {t('designersDir.countSuffix')}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map(d => (
              <Card key={d.id} className="p-5 cursor-pointer hover:shadow-xl transition-all hover:-translate-y-0.5" onClick={() => setProfile(d)}>
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-2xl flex-shrink-0">{d.logo}</div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold truncate">{ar ? d.nameAr : d.name}</h3>
                    <p className="text-xs text-muted-foreground truncate">{(ar ? d.specialtiesAr : d.specialties).join(' · ')}</p>
                  </div>
                  <div className="flex items-center gap-1 text-sm flex-shrink-0">
                    <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                    <span className="font-semibold">{d.rating}</span>
                  </div>
                </div>
                <div className="mb-3">{badges(d)}</div>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{ar ? d.descriptionAr : d.description}</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {(ar ? d.stylesAr : d.styles).map(s => <Badge key={s} variant="secondary" className="text-xs font-normal">{s}</Badge>)}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {ar ? d.locationAr : d.location}</span>
                  <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {d.teamSize} {t('designersDir.teamSuffix')}</span>
                  <span>{d.projectCount}+ {t('designersDir.projectsSuffix')}</span>
                  <span>{d.yearsExperience} {t('designersDir.yearsExpSuffix')}</span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={open => { if (!open) navigate('/marketplace/designers'); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <span className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-2xl">{selected.logo}</span>
                  <span>
                    {ar ? selected.nameAr : selected.name}
                    <span className="block text-sm font-normal text-muted-foreground">{(ar ? selected.specialtiesAr : selected.specialties).join(' · ')}</span>
                  </span>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1">{badges(selected)}</div>
                <p className="text-sm">{ar ? selected.descriptionAr : selected.description}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                  {[
                    { v: selected.rating, l: t('common.rating') },
                    { v: `${selected.projectCount}+`, l: t('designersDir.dialogStatProjects') },
                    { v: selected.yearsExperience, l: t('designersDir.dialogStatYears') },
                    { v: selected.teamSize, l: t('designersDir.dialogStatTeamSize') },
                  ].map((s, i) => (
                    <div key={i} className="bg-muted rounded-lg p-3">
                      <div className="text-lg font-bold">{s.v}</div>
                      <div className="text-xs text-muted-foreground">{s.l}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <h4 className="text-sm font-semibold mb-1.5">{t('designersDir.designStyles')}</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {(ar ? selected.stylesAr : selected.styles).map(s => <Badge key={s} variant="outline">{s}</Badge>)}
                  </div>
                </div>
                <p className="text-sm flex items-center gap-2"><MapPin className="w-4 h-4 text-muted-foreground" /> {ar ? selected.locationAr : selected.location}</p>
                <div className="flex gap-2 pt-2">
                  <Button className="flex-1" onClick={() => navigate('/rfq')}><FileText className="w-4 h-4 me-1.5" /> {t('designersDir.requestDesign')}</Button>
                  <Button variant="outline" className="flex-1" onClick={() => toast.info(t('common.messaging_after_signin'))}><MessageSquare className="w-4 h-4 me-1.5" /> {t('common.message')}</Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <MarketplaceProfileSheet entity={profile ? { kind: 'designer', data: profile } : null} onClose={() => setProfile(null)} />
    </div>
  );
}
