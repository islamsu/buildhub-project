import { useState } from 'react';
import { useLocation } from 'wouter';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import {
  Star, MapPin, Clock, Package, ShieldCheck, Award, Users, Briefcase,
  MessageSquare, FileText, Heart, Building2, Wrench, BadgeCheck, Truck,
  CalendarCheck, Banknote, ShieldAlert,
} from 'lucide-react';
import type { Vendor, Designer, FinishingCompany } from '@/lib/marketplaceData';

type ProfileEntity =
  | { kind: 'vendor'; data: Vendor }
  | { kind: 'designer'; data: Designer }
  | { kind: 'finishing'; data: FinishingCompany };

interface Props {
  entity: ProfileEntity | null;
  onClose: () => void;
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-center">
      <Icon className="mx-auto mb-1 h-4 w-4 text-primary" />
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export default function MarketplaceProfileSheet({ entity, onClose }: Props) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [, navigate] = useLocation();
  const [following, setFollowing] = useState(false);

  if (!entity) return null;
  const { kind, data } = entity;

  const name = ar ? (data as any).nameAr : data.name;
  const description = ar ? (data as any).descriptionAr : (data as any).description;
  const location = ar ? (data as any).locationAr : (data as any).location;

  const badges: { label: string; className: string }[] = [];
  if ((data as any).verified) badges.push({ label: ar ? 'موثّق' : 'Verified', className: 'bg-emerald-100 text-emerald-700' });
  if ((data as any).topRated) badges.push({ label: ar ? 'الأعلى تقييماً' : 'Top Rated', className: 'bg-amber-100 text-amber-700' });
  if ((data as any).awardWinning) badges.push({ label: ar ? 'حائز على جوائز' : 'Award-Winning', className: 'bg-amber-100 text-amber-700' });
  if ((data as any).recommended) badges.push({ label: ar ? 'موصى به' : 'Recommended', className: 'bg-blue-100 text-blue-700' });
  if ((data as any).trending) badges.push({ label: ar ? 'رائج' : 'Trending', className: 'bg-rose-100 text-rose-700' });
  if ((data as any).fastResponse) badges.push({ label: ar ? 'استجابة سريعة' : 'Fast Response', className: 'bg-sky-100 text-sky-700' });
  if ((data as any).isNew) badges.push({ label: ar ? 'جديد' : 'New', className: 'bg-violet-100 text-violet-700' });

  const requestQuote = () => {
    toast.success(ar ? 'سيتم توجيهك إلى صفحة طلب العروض' : 'Taking you to the RFQ page');
    onClose();
    navigate('/rfq');
  };
  const sendMessage = () => {
    onClose();
    navigate('/messages');
  };
  const toggleFollow = () => {
    setFollowing(f => !f);
    toast.success(following ? (ar ? 'تم إلغاء المتابعة' : 'Unfollowed') : (ar ? 'تمت المتابعة' : 'Following'));
  };

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side={ar ? 'left' : 'right'} className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="sr-only">{name}</SheetTitle>
        </SheetHeader>

        {/* Header */}
        <div className="flex items-start gap-4 px-1">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border bg-muted text-3xl">
            {(data as any).logo}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold leading-tight">{name}</h2>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              <span className="font-semibold text-foreground">{data.rating}</span>
              <span>({data.reviewCount} {ar ? 'تقييم' : 'reviews'})</span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> {location}
            </div>
          </div>
        </div>

        {/* Badges */}
        {badges.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 px-1">
            {badges.map(b => (
              <Badge key={b.label} variant="secondary" className={b.className}>
                <BadgeCheck className="me-1 h-3 w-3" /> {b.label}
              </Badge>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 grid grid-cols-3 gap-2 px-1">
          <Button onClick={requestQuote} className="gap-1.5">
            <FileText className="h-4 w-4" /> {ar ? 'طلب عرض' : 'Request Quote'}
          </Button>
          <Button variant="outline" onClick={sendMessage} className="gap-1.5">
            <MessageSquare className="h-4 w-4" /> {ar ? 'مراسلة' : 'Message'}
          </Button>
          <Button variant={following ? 'secondary' : 'outline'} onClick={toggleFollow} className="gap-1.5">
            <Heart className={`h-4 w-4 ${following ? 'fill-rose-500 text-rose-500' : ''}`} />
            {following ? (ar ? 'متابَع' : 'Following') : (ar ? 'متابعة' : 'Follow')}
          </Button>
        </div>

        <Separator className="my-5" />

        {/* Overview */}
        <div className="px-1">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {ar ? 'نبذة' : 'Overview'}
          </h3>
          <p className="text-sm leading-relaxed text-foreground/90">{description}</p>
        </div>

        {/* Stats grid per kind */}
        <div className="mt-5 grid grid-cols-3 gap-2 px-1">
          {kind === 'vendor' && (() => { const v = data as Vendor; return (
            <>
              <Stat icon={Package} label={ar ? 'طلبات منفذة' : 'Orders'} value={v.completedOrders.toLocaleString()} />
              <Stat icon={Briefcase} label={ar ? 'سنوات الخبرة' : 'Years'} value={`${v.yearsInBusiness}`} />
              <Stat icon={Building2} label={ar ? 'فروع' : 'Branches'} value={`${v.branches}`} />
              <Stat icon={Clock} label={ar ? 'زمن الاستجابة' : 'Response'} value={v.responseTime} />
              <Stat icon={Truck} label={ar ? 'التغطية' : 'Coverage'} value={ar ? v.deliveryCoverageAr : v.deliveryCoverage} />
              <Stat icon={Star} label={ar ? 'التقييم' : 'Rating'} value={`${v.rating}/5`} />
            </>
          ); })()}
          {kind === 'designer' && (() => { const d = data as Designer; return (
            <>
              <Stat icon={Briefcase} label={ar ? 'مشروعات' : 'Projects'} value={`${d.projectCount}+`} />
              <Stat icon={CalendarCheck} label={ar ? 'سنوات الخبرة' : 'Experience'} value={`${d.yearsExperience} ${ar ? 'سنة' : 'yrs'}`} />
              <Stat icon={Users} label={ar ? 'حجم الفريق' : 'Team'} value={`${d.teamSize}`} />
            </>
          ); })()}
          {kind === 'finishing' && (() => { const c = data as FinishingCompany; return (
            <>
              <Stat icon={Briefcase} label={ar ? 'مشروعات منفذة' : 'Completed'} value={`${c.completedProjects}+`} />
              <Stat icon={Wrench} label={ar ? 'مشروعات جارية' : 'Active'} value={`${c.activeProjects}`} />
              <Stat icon={CalendarCheck} label={ar ? 'سنوات الخبرة' : 'Years'} value={`${c.yearsInBusiness}`} />
              <Stat icon={Users} label={ar ? 'الفريق' : 'Team'} value={`${c.teamSize}`} />
              <Stat icon={ShieldCheck} label={ar ? 'مهندسون' : 'Engineers'} value={`${c.engineers}`} />
              <Stat icon={Star} label={ar ? 'التقييم' : 'Rating'} value={`${c.rating}/5`} />
            </>
          ); })()}
        </div>

        {/* Kind-specific details */}
        <div className="mt-5 space-y-4 px-1 pb-8">
          {kind === 'vendor' && (() => { const v = data as Vendor; return (
            <>
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {ar ? 'الفئة' : 'Category'}
                </h3>
                <Badge variant="outline">{ar ? v.categoryAr : v.category}</Badge>
              </div>
              {v.certifications.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {ar ? 'الشهادات والاعتمادات' : 'Certifications'}
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {v.certifications.map(c => (
                      <Badge key={c} variant="secondary" className="gap-1"><Award className="h-3 w-3" />{c}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </>
          ); })()}
          {kind === 'designer' && (() => { const d = data as Designer; return (
            <>
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {ar ? 'الخدمات والتخصصات' : 'Services & Specialties'}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {(ar ? d.specialtiesAr : d.specialties).map(s => (
                    <Badge key={s} variant="outline">{s}</Badge>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {ar ? 'أساليب التصميم' : 'Design Styles'}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {(ar ? d.stylesAr : d.styles).map(s => (
                    <Badge key={s} variant="secondary">{s}</Badge>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border bg-primary/5 p-3 text-sm">
                <CalendarCheck className="mb-1 h-4 w-4 text-primary" />
                {ar
                  ? 'احجز استشارة تصميم عبر زر "طلب عرض" وسيتواصل معك الاستوديو خلال 24 ساعة.'
                  : 'Book a design consultation via "Request Quote" — the studio responds within 24 hours.'}
              </div>
            </>
          ); })()}
          {kind === 'finishing' && (() => { const c = data as FinishingCompany; return (
            <>
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {ar ? 'الخدمات' : 'Services'}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {(ar ? c.servicesAr : c.services).map(s => (
                    <Badge key={s} variant="outline">{s}</Badge>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
                    <Banknote className="h-3.5 w-3.5" /> {ar ? 'نموذج التسعير' : 'Pricing Model'}
                  </div>
                  <div className="text-sm font-medium">{ar ? c.pricingModelAr : c.pricingModel}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
                    <ShieldAlert className="h-3.5 w-3.5" /> {ar ? 'الضمان' : 'Warranty'}
                  </div>
                  <div className="text-sm font-medium">{ar ? c.warrantyAr : c.warranty}</div>
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {ar ? 'مناطق الخدمة' : 'Service Areas'}
                </h3>
                <div className="flex items-center gap-1.5 text-sm"><MapPin className="h-4 w-4 text-primary" />{ar ? c.serviceAreasAr : c.serviceAreas}</div>
              </div>
            </>
          ); })()}
        </div>
      </SheetContent>
    </Sheet>
  );
}
